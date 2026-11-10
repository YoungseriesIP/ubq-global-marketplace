/* oxlint-disable typescript/no-explicit-any -- parses arbitrary JSON responses from the API under test */
// End-to-end security test against a throwaway local server (port 3002) and the real database.
// It uses fresh wallets created in memory (no real funds, no real identity documents) and deletes its own rows afterwards.
//   bun run scripts/security-live-test.ts
import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { totpAt } from '../server/sec/crypto'

const BASE = 'http://localhost:3002/api'
const sql = neon(process.env.DATABASE_URL)
let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) pass++
  else {
    fail++
    failures.push(`${name} ${extra === undefined ? '' : JSON.stringify(extra)}`)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || extra === undefined ? '' : '  ' + JSON.stringify(extra)}`)
}

const ipOf = new Map<string, string>()
async function call(method: string, path: string, token?: string | null, body?: unknown, who = 'anon') {
  if (!ipOf.has(who)) ipOf.set(who, `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`)
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ipOf.get(who)!,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, any>
  return { status: res.status, json }
}

type Acct = ReturnType<typeof privateKeyToAccount>
async function login(a: Acct, device: string, name: string) {
  const n = await call('POST', '/auth/nonce', null, { address: a.address }, name)
  const signature = await a.signMessage({ message: n.json.message })
  const v = await call('POST', '/auth/verify', null, { address: a.address, signature, deviceId: device }, name)
  return v.json.token as string
}

const admin = privateKeyToAccount(generatePrivateKey())
const seller = privateKeyToAccount(generatePrivateKey())
const buyer = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const extra = privateKeyToAccount(generatePrivateKey())
const victim = privateKeyToAccount(generatePrivateKey())
const all = [admin, seller, buyer, other, extra, victim].map((a) => a.address.toLowerCase())

const server = Bun.spawn(['bun', 'run', 'server/index.ts'], {
  env: { ...process.env, PORT: '3002', ADMIN_BOOTSTRAP_ADDRESSES: admin.address, APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') },
  stdout: 'ignore', stderr: 'ignore',
})

async function cleanup() {
  server.kill()
  const a = all
  const del = (t: string, col: string) => sql.query(`DELETE FROM ${t} WHERE ${col} = ANY($1)`, [a])
  await sql.query('DELETE FROM orders WHERE buyer = ANY($1) OR seller = ANY($1)', [a])
  await sql.query("DELETE FROM reports WHERE listing_id IN (SELECT id FROM listings WHERE seller = ANY($1))", [a])
  for (const [t, c] of [['restrictions', 'address'], ['appeals', 'address'], ['risk_assessments', 'address'], ['security_events', 'address'],
    ['user_devices', 'address'], ['consents', 'address'], ['staff_roles', 'address'], ['staff_totp', 'address'], ['cases', 'subject'],
    ['admin_requests', 'requested_by']] as const) await del(t, c)
  await sql.query("DELETE FROM security_config WHERE key = 'risk'")
  await del('users', 'address')
}

try {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/health`).catch(() => null)
    if (r?.ok) break
    await Bun.sleep(500)
  }
  check('server up', (await call('GET', '/health')).status === 200)

  // ── Sessions, devices, lockout ─────────────────────────────────────────
  const tA1 = await login(seller, 'device-seller-aaaa1111', 'seller')
  const tB = await login(buyer, 'device-buyer-bbbb2222', 'buyer')
  const tO = await login(other, 'device-other-cccc3333', 'other')
  const tE = await login(extra, 'device-extra-dddd4444', 'extra')
  const tAdmin = await login(admin, 'device-admin-eeee5555', 'admin')
  check('wallet sign-in issues sessions', [tA1, tB, tO, tE, tAdmin].every((t) => typeof t === 'string' && t.length > 20))
  check('unauthenticated request is rejected', (await call('GET', '/security/sessions')).status === 401)
  const s1 = await call('GET', '/security/sessions', tA1, undefined, 'seller')
  check('session list shows the current session', s1.json.sessions?.length === 1 && s1.json.sessions[0].current === true, s1.json)
  const tA2 = await login(seller, 'device-seller-NEW99999', 'seller2')
  const ev = await call('GET', '/security/events', tA2, undefined, 'seller2')
  check('a new device raises an alert', ev.json.events?.some((e: any) => e.kind === 'new_device_login'), ev.json)
  const rev = await call('POST', '/security/sessions/revoke-others', tA2, {}, 'seller2')
  check('revoke other sessions works', rev.json.revoked === 1, rev.json)
  check('a revoked session stops working', (await call('GET', '/me', tA1, undefined, 'seller')).status === 401)

  const n = await call('POST', '/auth/nonce', null, { address: victim.address }, 'attacker')
  void n
  const wrong = privateKeyToAccount(generatePrivateKey())
  let last = 0
  for (let i = 0; i < 9; i++) {
    const sig = await wrong.signMessage({ message: n.json.message })
    last = (await call('POST', '/auth/verify', null, { address: victim.address, signature: sig }, 'attacker')).status
  }
  check('repeated bad sign-ins lock the account temporarily', last === 429, last)

  // ── Listings and review ────────────────────────────────────────────────
  const mk = (title: string, price: string, description = 'A perfectly ordinary item for testing the checks.') =>
    call('POST', '/listings', tA2, { title, description, priceUsdc: price, category: 'Other', location: 'Lagos, Nigeria', countryCode: 'NG' }, 'seller2')
  const good = await mk('Security test lamp', '12.50')
  const big = await mk('Security test sofa', '600')
  const bad = await mk('Fake passport for sale', '40', 'Quick forged visa service')
  check('normal listing is published', good.status === 201, good.json)
  check('over-limit price still lists', big.status === 201)
  check('prohibited wording is accepted but held', bad.status === 201)
  const pub = await call('GET', '/listings')
  const ids = (pub.json.listings as any[]).map((l) => l.id)
  check('held listing is not public', !ids.includes(bad.json.listing?.id) && ids.includes(good.json.listing?.id))
  check('seller trust is factual (no identity badge)', pub.json.listings.find((l: any) => l.id === good.json.listing.id)?.sellerTrust?.emailVerified === false)

  // ── Payment intents ────────────────────────────────────────────────────
  check('demo listings cannot be bought', (await call('POST', '/payments/precheck', tB, { listingId: 'seed-1' }, 'buyer')).status === 400)
  check('own listing cannot be bought', (await call('POST', '/payments/precheck', tA2, { listingId: good.json.listing.id }, 'seller2')).status === 400)
  const pc = await call('POST', '/payments/precheck', tB, { listingId: good.json.listing.id }, 'buyer')
  check('precheck approves a normal payment', pc.status === 200 && pc.json.orderId && pc.json.payTo === seller.address.toLowerCase(), pc.json)
  const pc2 = await call('POST', '/payments/precheck', tB, { listingId: good.json.listing.id }, 'buyer')
  check('precheck is idempotent', pc2.json.orderId === pc.json.orderId && pc2.json.reused === true)
  const lim = await call('POST', '/payments/precheck', tB, { listingId: big.json.listing.id }, 'buyer')
  check('amounts above the level limit are refused', lim.status === 403 && lim.json.decision === 'limit', lim.json)
  const fakeTx = `0x${'ab'.repeat(32)}`
  const cf = await call('POST', `/payments/${pc.json.orderId}/confirm`, tB, { txHash: fakeTx }, 'buyer')
  check('an unconfirmed transaction is never marked paid', cf.status === 200 && cf.json.status !== 'verified', cf.json)
  check('another user cannot confirm my order', (await call('POST', `/payments/${pc.json.orderId}/confirm`, tO, { txHash: fakeTx }, 'other')).status === 404)
  check('a bad transaction hash is rejected', (await call('POST', `/payments/${pc.json.orderId}/confirm`, tB, { txHash: '0x123' }, 'buyer')).status === 400)
  const rc = await call('GET', `/payments/${pc.json.orderId}/receipt`, tB, undefined, 'buyer')
  check('receipt shows the true status', rc.json.receipt?.verified === false && rc.json.receipt?.status !== 'verified', rc.json)
  check('legacy self-reported order route is gone', (await call('POST', '/orders', tB, { listingId: good.json.listing.id, txHash: fakeTx }, 'buyer')).status === 404)

  // ── Staff access control ───────────────────────────────────────────────
  check('non-staff cannot open staff routes', (await call('GET', '/staff/cases', tO, undefined, 'other')).status === 403)
  const me = await call('GET', '/staff/me', tAdmin, undefined, 'admin')
  check('bootstrap admin is recognised', me.json.roles?.includes('admin') && me.json.configured === true, me.json)
  const noElev = await call('GET', '/staff/overview', tAdmin, undefined, 'admin')
  check('staff routes need the authenticator code', noElev.status === 401 && noElev.json.code === 'elevation_required', noElev.json)
  const enr = await call('POST', '/staff/totp/enroll', tAdmin, {}, 'admin')
  check('authenticator enrollment returns a secret', typeof enr.json.secret === 'string' && enr.json.secret.length >= 16)
  check('a wrong code does not unlock staff routes', (await call('POST', '/staff/totp/confirm', tAdmin, { code: '000000' }, 'admin')).status === 401)
  const okc = await call('POST', '/staff/totp/confirm', tAdmin, { code: totpAt(enr.json.secret, Date.now()) }, 'admin')
  check('the right code unlocks staff routes', okc.status === 200, okc.json)
  const ov = await call('GET', '/staff/overview', tAdmin, undefined, 'admin')
  check('overview loads after unlock', ov.status === 200 && typeof ov.json.openCases === 'number', ov.json)
  check('outsiders still cannot use a staff route', (await call('GET', '/staff/audit', tO, undefined, 'other')).status === 403)

  // ── Cases, restrictions, appeals ───────────────────────────────────────
  const cases = await call('GET', '/staff/cases?status=open', tAdmin, undefined, 'admin')
  const held = (cases.json.cases as any[]).find((c) => c.kind === 'listing_review' && c.subject === seller.address.toLowerCase())
  check('the held listing opened a case', !!held, cases.json)
  check('closing a case needs a recorded decision', (await call('PATCH', `/staff/cases/${held.id}`, tAdmin, { status: 'closed' }, 'admin')).status === 400)
  check('case notes can be added', (await call('POST', `/staff/cases/${held.id}/notes`, tAdmin, { body: 'Reviewed the listing text.', kind: 'finding' }, 'admin')).status === 201)
  check('a case closes with a decision', (await call('PATCH', `/staff/cases/${held.id}`, tAdmin, { status: 'closed', resolution: 'Wording flagged; seller warned.' }, 'admin')).status === 200)
  const rv = await call('GET', '/staff/listings/review', tAdmin, undefined, 'admin')
  check('held listing waits in the review queue', (rv.json.listings as any[]).some((l) => l.id === bad.json.listing.id), rv.json)
  check('staff can remove a bad listing', (await call('POST', `/staff/listings/${bad.json.listing.id}/decision`, tAdmin, { approve: false, note: 'Prohibited item' }, 'admin')).status === 200)

  const rs = await call('POST', '/staff/restrictions', tAdmin, { address: buyer.address, scope: 'buy', reason: 'Testing the restriction flow', days: 7 }, 'admin')
  check('staff can pause purchases for a user', rs.status === 201, rs.json)
  const blocked = await call('POST', '/payments/precheck', tB, { listingId: good.json.listing.id }, 'buyer')
  check('a restricted user cannot start a payment', blocked.status === 403 && blocked.json.decision === 'blocked', blocked.json)
  const st = await call('GET', '/security/status', tB, undefined, 'buyer')
  check('the user can see the restriction', st.json.restrictions?.length === 1, st.json)
  check('an appeal needs a real explanation', (await call('POST', '/security/appeals', tB, { restrictionId: rs.json.id, message: 'short' }, 'buyer')).status === 400)
  const ap = await call('POST', '/security/appeals', tB, { restrictionId: rs.json.id, message: 'This was a normal purchase for my own use.' }, 'buyer')
  check('the user can appeal', ap.status === 201, ap.json)
  check('only one open appeal per restriction', (await call('POST', '/security/appeals', tB, { restrictionId: rs.json.id, message: 'Trying a second appeal on the same thing.' }, 'buyer')).status === 409)
  check('a decision note is required', (await call('POST', `/staff/appeals/${ap.json.id}/resolve`, tAdmin, { accept: true, note: 'ok' }, 'admin')).status === 400)
  check('staff accepts the appeal', (await call('POST', `/staff/appeals/${ap.json.id}/resolve`, tAdmin, { accept: true, note: 'Looks like a genuine buyer.' }, 'admin')).status === 200)
  check('accepting an appeal lifts the restriction', (await call('POST', '/payments/precheck', tB, { listingId: good.json.listing.id }, 'buyer')).status === 200)

  // ── Reports ────────────────────────────────────────────────────────────
  for (const [t, w] of [[tB, 'buyer'], [tO, 'other'], [tE, 'extra']] as const) {
    await call('POST', `/listings/${good.json.listing.id}/report`, t, { kind: 'counterfeit', details: 'Looks like a copy.' }, w)
  }
  const afterReports = await call('GET', '/listings')
  check('three separate reports hold a listing for review', !(afterReports.json.listings as any[]).some((l) => l.id === good.json.listing.id))
  check('the seller cannot report their own listing', (await call('POST', `/listings/${good.json.listing.id}/report`, tA2, { kind: 'scam' }, 'seller2')).status === 400)
  await call('POST', `/staff/listings/${good.json.listing.id}/decision`, tAdmin, { approve: true, note: 'Genuine item, reports reviewed' }, 'admin')
  check('staff can restore a reviewed listing', ((await call('GET', '/listings')).json.listings as any[]).some((l) => l.id === good.json.listing.id))

  // ── Roles, config, two-person rule ─────────────────────────────────────
  const gr = await call('POST', '/staff/team/grant', tAdmin, { address: other.address, role: 'support', reason: 'Test of a support agent' }, 'admin')
  check('a single admin can grant roles (logged as an override)', gr.status === 200 && gr.json.executed === true, gr.json)
  check('a role alone is not enough without the authenticator', (await call('GET', '/staff/cases', tO, undefined, 'other')).status === 401)
  const cfg = await call('GET', '/staff/config', tAdmin, undefined, 'admin')
  const bad2 = await call('PUT', '/staff/config', tAdmin, { config: { thresholds: { stepUp: 70, blocked: 60, review: 80 } }, reason: 'Invalid ordering test' }, 'admin')
  check('invalid risk settings are refused', bad2.status === 400, bad2.json)
  const good2 = await call('PUT', '/staff/config', tAdmin, { config: { ...cfg.json.config, thresholds: { stepUp: 45, blocked: 65, review: 85 } }, reason: 'Test of configuration change' }, 'admin')
  check('valid settings can be changed and are logged', good2.status === 200, good2.json)
  check('config reads back the change', (await call('GET', '/staff/config', tAdmin, undefined, 'admin')).json.config.thresholds.stepUp === 45)
  await call('POST', '/staff/team/revoke', tAdmin, { address: other.address, reason: 'Test finished' }, 'admin')

  // ── Audit log and privacy ──────────────────────────────────────────────
  const av = await call('GET', '/staff/audit/verify', tAdmin, undefined, 'admin')
  check('audit chain verifies', av.json.ok === true && av.json.entries > 5, av.json)
  let blockedEdit = false
  try { await sql.query("UPDATE audit_log SET actor = 'x' WHERE id = (SELECT MAX(id) FROM audit_log)") } catch { blockedEdit = true }
  check('the database refuses to edit the audit log', blockedEdit)
  let blockedDelete = false
  try { await sql.query('DELETE FROM audit_log WHERE id = (SELECT MAX(id) FROM audit_log)') } catch { blockedDelete = true }
  check('the database refuses to delete from the audit log', blockedDelete)
  const ex = await call('GET', '/security/export', tB, undefined, 'buyer')
  check('data export works and carries no secrets', ex.status === 200 && !JSON.stringify(ex.json).includes('token'), Object.keys(ex.json))
  const dr = await call('POST', '/security/delete-request', tB, {}, 'buyer')
  check('a deletion request opens a case', dr.status === 201 && typeof dr.json.caseId === 'string', dr.json)
} finally {
  await cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) console.log('Failures:\n' + failures.map((f) => ' - ' + f).join('\n'))
process.exit(fail ? 1 : 0)
