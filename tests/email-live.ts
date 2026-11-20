// Live check of the email-code sign-in against the real database and Circle's test
// environment. The server runs in dev-mail mode: it prints codes instead of sending them.
// Run: bun run tests/email-live.ts
/* oxlint-disable typescript/no-explicit-any */
import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'node:crypto'
import { emailHash } from '../server/sec/emailAuth'

const PORT = 3003
const BASE = `http://localhost:${PORT}/api`
const key = process.env.APP_ENCRYPTION_KEY!
const sql = neon(process.env.DATABASE_URL!)
const rand = () => randomBytes(5).toString('hex')
const emails = [`live-${rand()}@example.test`, `live-${rand()}@example.test`, `live-${rand()}@example.test`]

const server = Bun.spawn(['bun', 'run', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), EMAIL_DEV_MODE: '1', VERCEL: '' },
  stdout: 'pipe', stderr: 'pipe',
})
const codes = new Map<string, string>()
;(async () => {
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of server.stdout as any) {
    buf += dec.decode(chunk)
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = /\[email-dev\] (\S+) (\d{6})/.exec(line)
      if (m) codes.set(m[1], m[2])
    }
  }
})()

const call = async (path: string, body: unknown, ip: string) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let ok = 0, bad = 0
const check = (n: string, c: boolean, x?: unknown) => { if (c) ok++; else bad++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + JSON.stringify(x)}`) }

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break } catch { /* starting */ } await sleep(500) }
  const cfg = (await (await fetch(BASE + '/config')).json()) as any
  check('server reports its own email sign-in', cfg.emailLogin === 'own', cfg)

  const [a, b, c] = emails
  check('a bad address is refused', (await call('/email/request', { email: 'nope' }, '10.1.0.1')).status === 400)
  const r1 = await call('/email/request', { email: a }, '10.1.0.2')
  check('a code is requested', r1.status === 200 && r1.json.ok === true, r1.json)
  await sleep(500)
  const code = codes.get(a)!
  check('the server produced a 6-digit code', /^\d{6}$/.test(code ?? ''))
  check('asking again straight away is slowed down', (await call('/email/request', { email: a }, '10.1.0.2')).status === 429)

  const wrong = code === '000000' ? '111111' : '000000'
  const w = await call('/email/verify', { email: a, code: wrong }, '10.1.0.3')
  check('a wrong code is refused and counted', w.status === 400 && /tries left/.test(w.json.error ?? ''), w.json)
  check('a malformed code is refused', (await call('/email/verify', { email: a, code: '12ab' }, '10.1.0.3')).status === 400)

  const v = await call('/email/verify', { email: a, code }, '10.1.0.3')
  check('the right code returns a wallet session', v.status === 200 && !!v.json.userToken && !!v.json.encryptionKey, { status: v.status, keys: Object.keys(v.json) })
  check('the code cannot be used twice', (await call('/email/verify', { email: a, code }, '10.1.0.3')).status === 400)

  const s1 = await call('/wallet/session', { userToken: v.json.userToken, deviceId: 'email-live-device-1' }, '10.1.0.4')
  check('a new user has no wallet yet', s1.status === 200 && s1.json.needsWallet === true, s1.json)
  const init = await call('/wallet/initialize', { userToken: v.json.userToken }, '10.1.0.4')
  check('Circle prepares the PIN and wallet setup', init.status === 200 && !!init.json.challengeId, init.json)

  await call('/email/request', { email: b }, '10.1.0.5'); await sleep(500)
  const codeB = codes.get(b)!
  let last: any
  for (let i = 0; i < 5; i++) last = await call('/email/verify', { email: b, code: codeB === '222222' ? '333333' : '222222' }, '10.1.0.6')
  check('five wrong tries lock the code', last.status === 400 && /Ask for a new code/.test(last.json.error ?? ''), last.json)
  const locked = await call('/email/verify', { email: b, code: codeB }, '10.1.0.6')
  check('a locked code stays locked even if it is right', locked.status === 429, locked.json)

  await call('/email/request', { email: c }, '10.1.0.7'); await sleep(500)
  await sql.query('UPDATE email_otps SET expires_at = $1 WHERE email_hash = $2', [Date.now() - 1000, emailHash(c, key)])
  const exp = await call('/email/verify', { email: c, code: codes.get(c)! }, '10.1.0.8')
  check('an expired code is refused', exp.status === 400 && /expired/.test(exp.json.error ?? ''), exp.json)
} finally {
  server.kill()
  await sql.query('DELETE FROM email_otps WHERE email_hash = ANY($1)', [emails.map((e) => emailHash(e, key))])
  console.log(`\n${ok} passed, ${bad} failed`)
}
