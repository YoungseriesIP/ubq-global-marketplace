// Email-code sign-in run by this server. A code is emailed through our own SMTP
// account, checked here, and only then do we ask Circle for a wallet session.
// The email address is never stored: only a keyed hash is kept, and the same
// hash (shortened) becomes the user's pseudonymous Circle user id.

import { Hono } from 'hono'
import nodemailer from 'nodemailer'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { exec, one } from '../db'
import { rateLimit } from '../auth'
import { circleClient } from '../wallet'

export const CODE_TTL_MS = 10 * 60_000
export const MAX_ATTEMPTS = 5
export const RESEND_GAP_MS = 45_000
export const MAX_SENDS_PER_HOUR = 5
const HOUR_MS = 3_600_000

// ── Pure helpers (unit tested) ─────────────────────────────────────────────

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  if (e.length < 6 || e.length > 254) return null
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) ? e : null
}

export function emailHash(email: string, secret: string): string {
  return createHmac('sha256', secret).update(`ubq-email:${email}`).digest('hex')
}

export function circleUserId(email: string, secret: string): string {
  return `e_${createHmac('sha256', secret).update(`ubq-email-user:${email}`).digest('hex').slice(0, 40)}`
}

export function codeHash(code: string, email: string, secret: string): string {
  return createHmac('sha256', secret).update(`ubq-code:${email}:${code}`).digest('hex')
}

export function makeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export interface OtpRow { code_hash: string; expires_at: number; attempts: number }
export type CodeCheck = 'ok' | 'expired' | 'locked' | 'wrong'

export function checkCode(row: OtpRow, code: string, email: string, secret: string, now: number): CodeCheck {
  if (row.attempts >= MAX_ATTEMPTS) return 'locked'
  if (now > row.expires_at) return 'expired'
  const a = Buffer.from(codeHash(code, email, secret), 'hex')
  const b = Buffer.from(row.code_hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong'
}

// ── Sending ────────────────────────────────────────────────────────────────

function secret(): string | null {
  const k = process.env.APP_ENCRYPTION_KEY
  return k && /^[0-9a-f]{64}$/i.test(k) ? k : null
}

// Dev mode prints the code to the server console instead of sending it. It is
// refused on Vercel, so it can never be switched on in production.
const devMode = () => process.env.EMAIL_DEV_MODE === '1' && !process.env.VERCEL
const smtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)

export function emailLoginReady(): boolean {
  return Boolean(circleClient) && secret() !== null && (smtpConfigured() || devMode())
}

async function sendCode(to: string, code: string): Promise<void> {
  if (devMode()) {
    console.log(`[email-dev] ${to} ${code}`)
    return
  }
  const port = Number(process.env.SMTP_PORT ?? 587)
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER
  await transport.sendMail({
    from: `"UBQ Global Marketplace" <${from}>`,
    to,
    subject: `${code} is your UBQ Global Marketplace sign-in code`,
    text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.\n`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#14233f">
      <h2 style="margin:0 0 12px">UBQ Global Marketplace</h2>
      <p style="margin:0 0 8px">Your sign-in code is</p>
      <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:0 0 16px">${code}</p>
      <p style="color:#5a6b86;font-size:13px;margin:0">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</p></div>`,
  })
}

// ── Routes ─────────────────────────────────────────────────────────────────

export const emailAuth = new Hono()

interface Row extends OtpRow { sends: number; window_start: number; last_sent_at: number }

emailAuth.post('/request', rateLimit('email-request', 10, 10 * 60_000), async (c) => {
  const key = secret()
  if (!emailLoginReady() || !key) return c.json({ error: 'Email sign-in is not available right now.' }, 503)
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown }
  const email = normalizeEmail(body.email)
  if (!email) return c.json({ error: 'Enter a valid email address.' }, 400)

  const now = Date.now()
  const h = emailHash(email, key)
  await exec('DELETE FROM email_otps WHERE expires_at < $1', [now - HOUR_MS])
  const row = await one<Row>('SELECT code_hash, expires_at, attempts, sends, window_start, last_sent_at FROM email_otps WHERE email_hash = $1', [h])

  let sends = 1
  let windowStart = now
  if (row) {
    if (now - row.last_sent_at < RESEND_GAP_MS) return c.json({ error: 'Please wait a moment before asking for another code.' }, 429)
    if (now - row.window_start < HOUR_MS) {
      if (row.sends >= MAX_SENDS_PER_HOUR) return c.json({ error: 'Too many codes were requested. Try again in an hour.' }, 429)
      sends = row.sends + 1
      windowStart = row.window_start
    }
  }

  const code = makeCode()
  await exec(
    `INSERT INTO email_otps (email_hash, code_hash, expires_at, attempts, sends, window_start, last_sent_at)
     VALUES ($1, $2, $3, 0, $4, $5, $6)
     ON CONFLICT (email_hash) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
       attempts = 0, sends = EXCLUDED.sends, window_start = EXCLUDED.window_start, last_sent_at = EXCLUDED.last_sent_at`,
    [h, codeHash(code, email, key), now + CODE_TTL_MS, sends, windowStart, now],
  )
  try {
    await sendCode(email, code)
  } catch (e) {
    await exec('DELETE FROM email_otps WHERE email_hash = $1', [h])
    console.error('email send failed:', e instanceof Error ? e.message : 'unknown')
    return c.json({ error: 'We could not send the email. Please try again in a moment.' }, 502)
  }
  return c.json({ ok: true, expiresInSec: CODE_TTL_MS / 1000, resendAfterSec: RESEND_GAP_MS / 1000 })
})

emailAuth.post('/verify', rateLimit('email-verify', 30, 10 * 60_000), async (c) => {
  const key = secret()
  if (!emailLoginReady() || !key || !circleClient) return c.json({ error: 'Email sign-in is not available right now.' }, 503)
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; code?: unknown }
  const email = normalizeEmail(body.email)
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!email || !/^\d{6}$/.test(code)) return c.json({ error: 'Enter the 6-digit code from your email.' }, 400)

  const h = emailHash(email, key)
  const row = await one<OtpRow>('SELECT code_hash, expires_at, attempts FROM email_otps WHERE email_hash = $1', [h])
  if (!row) return c.json({ error: 'That code is not valid. Ask for a new one.' }, 400)

  const result = checkCode(row, code, email, key, Date.now())
  if (result === 'locked') return c.json({ error: 'Too many wrong tries. Ask for a new code.' }, 429)
  if (result === 'expired') return c.json({ error: 'That code has expired. Ask for a new one.' }, 400)
  if (result === 'wrong') {
    await exec('UPDATE email_otps SET attempts = attempts + 1 WHERE email_hash = $1', [h])
    const left = Math.max(0, MAX_ATTEMPTS - row.attempts - 1)
    return c.json({ error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.' }, 400)
  }

  // Code accepted: it can be used once only.
  await exec('DELETE FROM email_otps WHERE email_hash = $1', [h])
  const userId = circleUserId(email, key)
  try {
    await circleClient.createUser({ userId }).catch(() => undefined) // already exists on later sign-ins
    const t = await circleClient.createUserToken({ userId })
    if (!t.data?.userToken || !t.data.encryptionKey) throw new Error('missing token')
    return c.json({ userToken: t.data.userToken, encryptionKey: t.data.encryptionKey })
  } catch {
    return c.json({ error: 'The wallet service is busy. Please try again.' }, 502)
  }
})
