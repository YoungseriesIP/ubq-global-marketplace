// TradePort API: accounts, shops, shared listings, orders, FX rates and wallets.
// Shared app. Entry points: server/index.ts (Bun server) and api/index.ts (Vercel function).

import { Hono } from 'hono'
import { randomBytes, randomUUID } from 'node:crypto'
import { verifyMessage } from 'viem'
import { exec, one, q, type ListingRow, type OrderRow, type UserRow } from './db'
import {
  requireAuth, bearerToken, destroySession, createSession, upsertUser, rateLimit, clientMeta,
  str, optStr, addr, usdcAmount, httpsUrl, countryCode, type AuthEnv,
} from './auth'
import { wallet, circleConfigured, DEFAULT_CHAIN_ID } from './wallet'
import { requireChain } from '../src/onchain-facts'
import { payments } from './sec/payRoutes'
import { security } from './sec/userRoutes'
import { staff } from './sec/staffRoutes'
import { activeRestriction, evaluate, isFreshDevice, levelFor, openCase, recordEvent } from './sec/risk'
import { audit } from './sec/audit'

const CATEGORIES = new Set(['Electronics', 'Fashion', 'Art', 'Books', 'Collectibles', 'Home', 'Sports', 'Other'])
const DEFAULT_CHAIN = requireChain(DEFAULT_CHAIN_ID)

const api = new Hono<AuthEnv>()

// ── Public config ────────────────────────────────────────────────────────
api.get('/health', (c) => c.json({ ok: true }))

api.get('/config', (c) =>
  c.json({
    circleConfigured,
    circleAppId: process.env.VITE_CIRCLE_APP_ID ?? null,
    googleClientId: process.env.VITE_GOOGLE_CLIENT_ID ?? null,
    escrowAddress: process.env.VITE_ESCROW_ADDRESS ?? null,
    chainId: DEFAULT_CHAIN_ID,
  }),
)

// ── FX rates (USD base). USDC is treated as 1 USD. ───────────────────────
let fxCache: { rates: Record<string, number>; updatedAt: number } | null = null

api.get('/fx', async (c) => {
  const now = Date.now()
  if (fxCache && now - fxCache.updatedAt < 60 * 60 * 1000) return c.json({ base: 'USD', ...fxCache })
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`FX upstream ${res.status}`)
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (json.result !== 'success' || !json.rates) throw new Error('FX upstream error')
    fxCache = { rates: json.rates, updatedAt: now }
    return c.json({ base: 'USD', ...fxCache })
  } catch {
    if (fxCache) return c.json({ base: 'USD', ...fxCache, stale: true })
    return c.json({ error: 'Exchange rates are unavailable right now.' }, 503)
  }
})

// ── Wallet-signature sign-in (for people who bring their own wallet) ─────
const signInMessage = (nonce: string) => `Sign in to TradePort\nNonce: ${nonce}`

api.post('/auth/nonce', rateLimit('nonce', 20, 60_000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  if (!address) return c.json({ error: 'Valid address required.' }, 400)
  const nonce = randomBytes(16).toString('hex')
  await exec(
    `INSERT INTO nonces (address, nonce, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (address) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
    [address, nonce, Date.now() + 5 * 60_000],
  )
  return c.json({ message: signInMessage(nonce) })
})

api.post('/auth/verify', rateLimit('verify', 20, 60_000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  const signature = str(body.signature, 400)
  if (!address || !signature) return c.json({ error: 'address and signature required.' }, 400)
  const meta = clientMeta(c, body.deviceId)
  const failures = await one<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM security_events WHERE address = $1 AND kind = 'login_failed' AND at > $2",
    [address, Date.now() - 15 * 60_000],
  )
  if ((failures?.n ?? 0) >= 8) {
    return c.json({ error: 'Too many failed attempts. Please wait 15 minutes and try again.' }, 429)
  }
  const row = await one<{ nonce: string; expires_at: number }>(
    'SELECT nonce, expires_at FROM nonces WHERE address = $1',
    [address],
  )
  if (!row || row.expires_at < Date.now()) {
    await recordEvent({ address, kind: 'login_failed', severity: 'warn', ipHash: meta.ipHash, details: { reason: 'expired' } })
    return c.json({ error: 'Sign-in expired. Try again.' }, 401)
  }
  const ok = await verifyMessage({
    address: address as `0x${string}`,
    message: signInMessage(row.nonce),
    signature: signature as `0x${string}`,
  }).catch(() => false)
  if (!ok) {
    await recordEvent({ address, kind: 'login_failed', severity: 'warn', ipHash: meta.ipHash, details: { reason: 'bad_signature' } })
    return c.json({ error: 'Signature did not match this wallet.' }, 401)
  }
  await exec('DELETE FROM nonces WHERE address = $1', [address]) // one-time use
  const user = await upsertUser({ address, method: 'wallet' })
  const { token } = await createSession(address, meta)
  return c.json({ token, user: publicUser(user) })
})

api.post('/auth/logout', async (c) => {
  const t = bearerToken(c)
  if (t) await destroySession(t)
  return c.json({ ok: true })
})

// ── Account / shop ───────────────────────────────────────────────────────
function publicUser(u: UserRow) {
  return {
    address: u.address,
    method: u.method,
    email: u.email,
    walletId: u.circle_wallet_id,
    displayName: u.display_name,
    shopName: u.shop_name,
    shopBio: u.shop_bio,
    countryCode: u.country_code,
  }
}

api.get('/me', requireAuth, (c) => c.json({ user: publicUser(c.get('user')) }))

api.patch('/me', requireAuth, rateLimit('profile', 30, 60_000), async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const displayName = optStr(body.displayName, 60) || user.display_name
  const shopName = optStr(body.shopName, 80)
  const shopBio = optStr(body.shopBio, 500)
  const cc = body.countryCode === undefined ? user.country_code : countryCode(body.countryCode)
  const rows = await q<UserRow>(
    `UPDATE users SET display_name = $1, shop_name = $2, shop_bio = $3, country_code = $4
     WHERE address = $5 RETURNING *`,
    [displayName, shopName, shopBio, cc, user.address],
  )
  return c.json({ user: publicUser(rows[0] ?? user) })
})

api.get('/shops/:address', async (c) => {
  const address = addr(c.req.param('address'))
  if (!address) return c.json({ error: 'Invalid address.' }, 400)
  const u = await one<UserRow>('SELECT * FROM users WHERE address = $1', [address])
  if (!u) return c.json({ error: 'Shop not found.' }, 404)
  const rows = await q<ListingJoin>(
    `SELECT l.*, u.shop_name, u.display_name, u.is_demo, u.method AS seller_method, (SELECT COUNT(*)::int FROM orders o WHERE o.seller = l.seller AND o.status = 'verified') AS verified_sales, (SELECT COUNT(*)::int FROM reports r JOIN listings l2 ON l2.id = r.listing_id WHERE l2.seller = l.seller AND r.status <> 'dismissed') AS complaints FROM listings l JOIN users u ON u.address = l.seller
     WHERE l.seller = $1 AND l.status = 'active' ORDER BY l.created_at DESC`,
    [address],
  )
  return c.json({
    shop: { address: u.address, name: u.shop_name || u.display_name || 'Shop', bio: u.shop_bio, countryCode: u.country_code, isDemo: u.is_demo === 1 },
    listings: rows.map(toListing),
  })
})

// ── Listings ─────────────────────────────────────────────────────────────
type ListingJoin = ListingRow & {
  shop_name: string; display_name: string; is_demo: number
  seller_method: string; verified_sales: number; complaints: number
}

function toListing(r: ListingJoin) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    priceUsdc: r.price_usdc,
    category: r.category,
    location: r.location,
    countryCode: r.country_code,
    chain: r.chain,
    chainId: r.chain_id,
    sellerAddress: r.seller,
    sellerName: r.shop_name || r.display_name || 'Seller',
    isDemo: r.is_demo === 1,
    // Badges only state facts we can check. Identity and business badges appear once a verification provider is connected.
    sellerTrust: {
      emailVerified: r.seller_method === 'circle',
      verifiedSales: r.verified_sales,
      complaints: r.complaints,
      trusted: r.verified_sales >= 3 && r.complaints === 0,
    },
    imageUrl: r.image_url,
    createdAt: new Date(r.created_at).toISOString(),
  }
}

api.get('/listings', async (c) => {
  const rows = await q<ListingJoin>(
    `SELECT l.*, u.shop_name, u.display_name, u.is_demo, u.method AS seller_method, (SELECT COUNT(*)::int FROM orders o WHERE o.seller = l.seller AND o.status = 'verified') AS verified_sales, (SELECT COUNT(*)::int FROM reports r JOIN listings l2 ON l2.id = r.listing_id WHERE l2.seller = l.seller AND r.status <> 'dismissed') AS complaints FROM listings l JOIN users u ON u.address = l.seller
     WHERE l.status = 'active' ORDER BY l.created_at DESC LIMIT 500`,
  )
  return c.json({ listings: rows.map(toListing) })
})

api.post('/listings', requireAuth, rateLimit('listing', 20, 60_000), async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const title = str(body.title, 120)
  const description = str(body.description, 2000)
  const price = usdcAmount(body.priceUsdc)
  const location = str(body.location, 120)
  const category = typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : null
  if (!title || !description || !price || !location || !category) {
    return c.json({ error: 'Title, description, price, category and location are required.' }, 400)
  }
  const imageRaw = body.imageUrl
  const imageUrl = imageRaw ? httpsUrl(imageRaw) : null
  if (imageRaw && !imageUrl) return c.json({ error: 'Image must be a valid https link.' }, 400)
  const cc = countryCode(body.countryCode) ?? user.country_code

  if (await activeRestriction(user.address, 'sell')) {
    return c.json({ error: 'Selling on your account is temporarily paused. You can appeal from the Security page.' }, 403)
  }
  const ev = await evaluate({
    action: 'listing', address: user.address, level: await levelFor(user.address, user.method),
    text: `${title} ${description}`, newDevice: await isFreshDevice(user.address, c.get('session').deviceHash),
    deviceHash: c.get('session').deviceHash,
  })
  // A risky listing is held for a human to review. The seller's account is not restricted for it.
  const flagged = ev.decision === 'review' || ev.decision === 'blocked' || ev.reasons.some((r) => r.startsWith('Listing text matches'))

  const id = randomUUID()
  await exec(
    `INSERT INTO listings (id, seller, title, description, price_usdc, category, location, country_code, chain, chain_id, image_url, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, user.address, title, description, price, category, location, cc, DEFAULT_CHAIN.name.split(' ')[0], DEFAULT_CHAIN_ID, imageUrl, flagged ? 'review' : 'active', Date.now()],
  )
  if (flagged) {
    await openCase({ kind: 'listing_review', severity: ev.decision === 'review' ? 'high' : 'medium', subject: user.address, title: `Listing held for review: ${title.slice(0, 80)}`, summary: ev.reasons.join('; '), by: 'system' })
    await recordEvent({ address: user.address, kind: 'listing_held', severity: 'warn', details: { listingId: id } })
  }
  const row = await one<ListingJoin>(
    `SELECT l.*, u.shop_name, u.display_name, u.is_demo, u.method AS seller_method, (SELECT COUNT(*)::int FROM orders o WHERE o.seller = l.seller AND o.status = 'verified') AS verified_sales, (SELECT COUNT(*)::int FROM reports r JOIN listings l2 ON l2.id = r.listing_id WHERE l2.seller = l.seller AND r.status <> 'dismissed') AS complaints FROM listings l JOIN users u ON u.address = l.seller WHERE l.id = $1`,
    [id],
  )
  if (!row) return c.json({ error: 'Could not save the listing.' }, 500)
  return c.json({ listing: toListing(row), held: flagged }, 201)
})

api.delete('/listings/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const res = await q<{ id: string }>(
    "UPDATE listings SET status = 'removed' WHERE id = $1 AND seller = $2 AND status = 'active' RETURNING id",
    [c.req.param('id'), user.address],
  )
  if (res.length === 0) return c.json({ error: 'Listing not found or not yours.' }, 404)
  return c.json({ ok: true })
})

// ── Reports (counterfeit, authenticity, scams) ───────────────────────────
const REPORT_KINDS = new Set(['counterfeit', 'not_as_described', 'scam', 'prohibited', 'other'])

api.post('/listings/:id/report', requireAuth, rateLimit('report', 10, 3_600_000), async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const kind = typeof body.kind === 'string' && REPORT_KINDS.has(body.kind) ? body.kind : null
  if (!kind) return c.json({ error: 'Choose what is wrong with this listing.' }, 400)
  const l = await one<ListingRow>("SELECT * FROM listings WHERE id = $1 AND status IN ('active','review')", [c.req.param('id')])
  if (!l) return c.json({ error: 'Listing not found.' }, 404)
  if (l.seller === user.address) return c.json({ error: 'You cannot report your own listing.' }, 400)
  const rows = await q<{ id: string }>(
    `INSERT INTO reports (id, listing_id, reporter, kind, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (listing_id, reporter, kind) DO NOTHING RETURNING id`,
    [randomUUID(), l.id, user.address, kind, optStr(body.details, 1000), Date.now()],
  )
  if (rows.length === 0) return c.json({ ok: true, duplicate: true })
  const distinct = await one<{ n: number }>('SELECT COUNT(DISTINCT reporter)::int AS n FROM reports WHERE listing_id = $1', [l.id])
  let caseId = (await one<{ id: string }>("SELECT id FROM cases WHERE kind = 'listing_report' AND subject = $1 AND status <> 'closed' LIMIT 1", [l.seller]))?.id
  if (!caseId) caseId = await openCase({ kind: 'listing_report', severity: 'medium', subject: l.seller, title: `Reports on listing: ${l.title.slice(0, 80)}`, by: 'system' })
  await exec('UPDATE reports SET case_id = $2 WHERE id = $1', [rows[0]!.id, caseId])
  // Three different people reporting hides the listing until staff review it. Staff can restore it.
  if ((distinct?.n ?? 0) >= 3 && l.status === 'active') {
    await exec("UPDATE listings SET status = 'review' WHERE id = $1 AND status = 'active'", [l.id])
    await audit({ actor: 'system', action: 'listing.auto_hold', target: l.id, details: { reporters: distinct?.n } })
  }
  return c.json({ ok: true }, 201)
})

// ── Orders (read-only here; payments are created and verified under /payments) ──
api.get('/orders/mine', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await q<OrderRow & { title: string }>(
    `SELECT o.*, l.title FROM orders o JOIN listings l ON l.id = o.listing_id
     WHERE o.buyer = $1 OR o.seller = $1 ORDER BY o.created_at DESC LIMIT 200`,
    [user.address],
  )
  return c.json({
    orders: rows.map((o) => ({
      id: o.id,
      listingId: o.listing_id,
      title: o.title,
      role: o.buyer === user.address ? 'buyer' : 'seller',
      amountUsdc: o.amount_usdc,
      displayCurrency: o.display_currency,
      displayAmount: o.display_amount,
      txHash: o.tx_hash,
      status: o.status,
      verifiedNote: o.verify_note,
      createdAt: new Date(Number(o.created_at)).toISOString(),
    })),
  })
})

api.route('/wallet', wallet as unknown as Hono<AuthEnv>)
api.route('/payments', payments)
api.route('/security', security)
api.route('/staff', staff as unknown as Hono<AuthEnv>)

// ── App shell ────────────────────────────────────────────────────────────
const app = new Hono()

// Baseline security headers. (A script-level CSP is not set: it must be tested against every wallet
// provider in a real browser first. These cannot break embedding in a preview or share frame.)
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()')
  c.header('Strict-Transport-Security', 'max-age=15552000')
  c.header('Content-Security-Policy', "object-src 'none'; base-uri 'self'; form-action 'self'")
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
})

// Never echo internals or request data (it can contain tokens) to the client or the logs.
app.onError((err, c) => {
  console.error('request failed:', c.req.method, c.req.path, err instanceof Error ? err.message : 'unknown error')
  return c.json({ error: 'Something went wrong. Please try again.' }, 500)
})
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.route('/api', api)
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

export { app }
