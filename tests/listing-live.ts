// Live check of photo upload, editing and the sold / payment-pending shelf rules.
// Uses the real database; every row it makes is removed at the end.
// Run: bun run tests/listing-live.ts
/* oxlint-disable typescript/no-explicit-any */
import { neon } from '@neondatabase/serverless'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { pruneExpired } from '../server/db'

const PORT = 3004
const BASE = `http://localhost:${PORT}/api`
const sql = neon(process.env.DATABASE_URL!)
const server = Bun.spawn(['bun', 'run', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), VERCEL: '' }, stdout: 'ignore', stderr: 'ignore' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let ok = 0, bad = 0
const check = (n: string, c: boolean, x?: unknown) => { if (c) ok++; else bad++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`) }

type Who = { account: ReturnType<typeof privateKeyToAccount>; token: string; ip: string }
const call = async (method: string, path: string, who?: Who, body?: unknown, raw?: { bytes: Uint8Array; type: string }) => {
  const headers: Record<string, string> = { 'x-forwarded-for': who?.ip ?? '10.4.0.1' }
  if (who) headers.authorization = `Bearer ${who.token}`
  let payload: BodyInit | undefined
  if (raw) { headers['content-type'] = raw.type; payload = raw.bytes as unknown as BodyInit } else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await fetch(BASE + path, { method, headers, body: payload })
  const ct = r.headers.get('content-type') ?? ''
  return { status: r.status, ct, headers: r.headers, json: (ct.includes('json') ? await r.json().catch(() => ({})) : {}) as Record<string, any> }
}
let ipN = 20
const login = async (): Promise<Who> => {
  const account = privateKeyToAccount(generatePrivateKey())
  const ip = `10.4.0.${ipN++}`
  const n = await call('POST', '/auth/nonce', { account, token: '', ip }, { address: account.address })
  const signature = await account.signMessage({ message: n.json.message })
  const v = await call('POST', '/auth/verify', { account, token: '', ip }, { address: account.address, signature, deviceId: `listing-live-${ipN}-device` })
  return { account, token: v.json.token, ip }
}
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(300).fill(7)])
const mk = (extra: Record<string, unknown> = {}) => ({ title: 'Live test item', description: 'Created by an automated check.', priceUsdc: '5.00', category: 'Other', location: 'Test', countryCode: 'NG', ...extra })
const publicIds = async () => ((await call('GET', '/listings')).json.listings as any[]).map((l) => l.id)
const addrs: string[] = []

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch { /* starting */ } await sleep(500) }
  const seller = await login(), buyer = await login(), other = await login()
  addrs.push(...[seller, buyer, other].map((w) => w.account.address.toLowerCase()))

  // Photos
  const up = await call('POST', '/uploads/image', seller, undefined, { bytes: jpeg, type: 'image/jpeg' })
  check('a photo uploads', up.status === 201 && /^\/api\/images\//.test(up.json.url), up)
  const img = await fetch(`http://localhost:${PORT}${up.json.url}`)
  check('the photo is served back with a safe type', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && (img.headers.get('content-security-policy') ?? '').includes('sandbox'), [img.status, img.headers.get('content-type')])
  check('a script posing as a photo is refused', (await call('POST', '/uploads/image', seller, undefined, { bytes: new TextEncoder().encode('<script>alert(1)</script>'.repeat(4)), type: 'image/jpeg' })).status === 400)
  check('an oversized photo is refused', (await call('POST', '/uploads/image', seller, undefined, { bytes: Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(800_000).fill(1)]), type: 'image/jpeg' })).status === 413)
  check('uploading needs a sign-in', (await call('POST', '/uploads/image', undefined, undefined, { bytes: jpeg, type: 'image/jpeg' })).status === 401)

  // Listing with a photo, then editing it
  const made = await call('POST', '/listings', seller, mk({ imageUrl: up.json.url }))
  const id = made.json.listing?.id as string
  check('a listing can use an uploaded photo', made.status === 201 && made.json.listing.imageUrl === up.json.url, made.json)
  check('a made-up local photo address is refused', (await call('POST', '/listings', seller, mk({ imageUrl: '/api/images/not-real' }))).status === 400)

  const edit = await call('PATCH', `/listings/${id}`, seller, { priceUsdc: '7.50', title: 'Renamed item', imageUrl: null })
  check('the seller can change price, title and photo', edit.status === 200 && edit.json.listing.priceUsdc === '7.50' && edit.json.listing.title === 'Renamed item' && edit.json.listing.imageUrl === null, edit.json)
  check('someone else cannot edit it', (await call('PATCH', `/listings/${id}`, other, { priceUsdc: '1.00' })).status === 404)
  check('a bad price is refused', (await call('PATCH', `/listings/${id}`, seller, { priceUsdc: '-3' })).status === 400)
  const held = await call('PATCH', `/listings/${id}`, seller, { description: 'Selling a fake passport and forged visa documents' })
  check('new wording that breaks the rules is held for review', held.status === 200 && held.json.held === true, held.json)
  check('a held listing leaves the public list', !(await publicIds()).includes(id))
  await call('PATCH', `/listings/${id}`, seller, { description: 'Back to a normal description.' })
  await sql.query("UPDATE listings SET status = 'active' WHERE id = $1", [id])
  check('an active listing shows publicly', (await publicIds()).includes(id))

  // A payment that cannot be confirmed yet reserves the item
  const pre = await call('POST', '/payments/precheck', buyer, { listingId: id })
  check('a buyer can start a purchase', pre.status === 200 && !!pre.json.orderId, pre.json)
  await sql.query("UPDATE listings SET price_usdc = '8.00' WHERE id = $1", [id])
  const pre2 = await call('POST', '/payments/precheck', buyer, { listingId: id })
  check('after a price change the old open order is not reused', pre2.status === 200 && pre2.json.orderId !== pre.json.orderId && pre2.json.amountUsdc === '8.00', pre2.json)
  const conf = await call('POST', `/payments/${pre2.json.orderId}/confirm`, buyer, { txHash: '0x' + 'ab'.repeat(32) })
  check('a payment the network cannot show yet is left unconfirmed', conf.status === 200 && conf.json.status === 'unverified', conf.json)
  check('the item is now held and no longer on the public list', !(await publicIds()).includes(id))
  const mine = await call('GET', '/listings/mine', seller)
  check('the seller sees it as payment pending', (mine.json.listings as any[]).find((l) => l.id === id)?.status === 'reserved', mine.json)
  check('another buyer cannot start a purchase on it', (await call('POST', '/payments/precheck', other, { listingId: id })).status === 404)
  check('the seller cannot edit it while a payment is pending', (await call('PATCH', `/listings/${id}`, seller, { priceUsdc: '1.00' })).status === 409)

  // Not confirmed for six hours: back on sale
  await sql.query("UPDATE orders SET created_at = $2 WHERE id = $1", [pre2.json.orderId, Date.now() - 7 * 3_600_000])
  await pruneExpired()
  check('a payment that never confirms puts the item back on sale', (await publicIds()).includes(id))

  // Paid and verified: sold, off the shelf, still listed for the seller
  await sql.query("UPDATE orders SET status = 'verified', verified_at = $2 WHERE id = $1", [pre2.json.orderId, Date.now()])
  await sql.query("UPDATE listings SET status = 'sold' WHERE id = $1", [id])
  check('a sold item is off the public list', !(await publicIds()).includes(id))
  const mine2 = await call('GET', '/listings/mine', seller)
  check('the seller still sees it, marked sold', (mine2.json.listings as any[]).find((l) => l.id === id)?.status === 'sold')
  check('a sold item cannot be edited or bought again', (await call('PATCH', `/listings/${id}`, seller, { priceUsdc: '1.00' })).status === 409 && (await call('POST', '/payments/precheck', other, { listingId: id })).status === 404)
} finally {
  server.kill()
  for (const t of ['security_events', 'user_devices', 'risk_assessments', 'consents', 'images']) {
    await sql.query(`DELETE FROM ${t} WHERE ${t === 'images' ? 'owner' : 'address'} = ANY($1)`, [addrs]).catch(() => undefined)
  }
  await sql.query('DELETE FROM orders WHERE buyer = ANY($1) OR seller = ANY($1)', [addrs]).catch(() => undefined)
  await sql.query('DELETE FROM cases WHERE subject = ANY($1)', [addrs]).catch(() => undefined)
  await sql.query('DELETE FROM users WHERE address = ANY($1)', [addrs]).catch(() => undefined)
  console.log(`\n${ok} passed, ${bad} failed`)
}
