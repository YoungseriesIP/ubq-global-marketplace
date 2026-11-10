// Session helpers, input validation and a database-backed rate limiter
// (state must live in the database because serverless instances do not share memory).

import { createHash, randomBytes } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { isAddress } from 'viem'
import { exec, one, pruneExpired, q, type UserRow } from './db'
import { privacyHash } from './sec/crypto'
import { recordEvent } from './sec/risk'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionInfo {
  /** Public, non-secret handle for listing and revoking (prefix of the stored hash). */
  id: string
  tokenHash: string
  createdAt: number
  elevatedUntil: number
  deviceHash: string | null
}

export type AuthEnv = { Variables: { user: UserRow; session: SessionInfo } }

export interface ClientMeta {
  userAgent: string
  ipHash: string
  deviceHash: string | null
}

/** Coarse, privacy-preserving client fingerprint. Raw IPs and device ids are never stored. */
export function clientMeta(c: Context, deviceId?: unknown): ClientMeta {
  const ip = (c.req.header('x-forwarded-for') ?? 'local').split(',').pop()!.trim()
  const ua = (c.req.header('user-agent') ?? '').slice(0, 200)
  const dev = typeof deviceId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(deviceId) ? deviceId : null
  return { userAgent: ua, ipHash: privacyHash(ip), deviceHash: dev ? privacyHash(`dev:${dev}`) : null }
}

// Only a hash of each session token is stored, so a leaked database file cannot be used to sign in.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(
  address: string,
  meta: ClientMeta,
): Promise<{ token: string; newDevice: boolean }> {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  await exec(
    `INSERT INTO sessions (token, address, expires_at, created_at, last_seen, device_hash, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [hashToken(token), address, now + SESSION_TTL_MS, now, meta.deviceHash, meta.userAgent, meta.ipHash],
  )

  // Device recognition: the first device is silent, any later new device raises an in-app alert.
  let newDevice = false
  if (meta.deviceHash) {
    const known = await one('SELECT 1 AS x FROM user_devices WHERE address = $1 AND device_hash = $2', [address, meta.deviceHash])
    if (!known) {
      newDevice = true
      const others = await one('SELECT 1 AS x FROM user_devices WHERE address = $1 LIMIT 1', [address])
      await exec(
        'INSERT INTO user_devices (address, device_hash, first_seen, last_seen) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING',
        [address, meta.deviceHash, now],
      )
      if (others) {
        await recordEvent({ address, kind: 'new_device_login', severity: 'warn', ipHash: meta.ipHash, details: { userAgent: meta.userAgent } })
      }
      const shared = await one<{ n: number }>('SELECT COUNT(DISTINCT address)::int AS n FROM user_devices WHERE device_hash = $1', [meta.deviceHash])
      if ((shared?.n ?? 0) >= 4) {
        await recordEvent({ address, kind: 'shared_device', severity: 'warn', details: { accounts: shared?.n } })
      }
    } else {
      await exec('UPDATE user_devices SET last_seen = $3 WHERE address = $1 AND device_hash = $2', [address, meta.deviceHash, now])
    }
  }
  await recordEvent({ address, kind: 'login', severity: 'info', ipHash: meta.ipHash })
  // Housekeeping on roughly 2% of sign-ins keeps the tables small without a scheduler.
  if (Math.random() < 0.02) await pruneExpired().catch(() => undefined)
  return { token, newDevice }
}

export async function destroySession(token: string): Promise<void> {
  await exec('DELETE FROM sessions WHERE token = $1', [hashToken(token)])
}

export function bearerToken(c: Context): string | null {
  const h = c.req.header('authorization')
  if (!h || !h.startsWith('Bearer ')) return null
  const t = h.slice(7).trim()
  return t.length > 0 && t.length < 200 ? t : null
}

interface UserWithSession extends UserRow {
  s_token: string
  s_created: number | null
  s_elev: number | null
  s_device: string | null
  s_seen: number | null
}

export async function userForToken(token: string): Promise<{ user: UserRow; session: SessionInfo } | null> {
  const h = hashToken(token)
  const now = Date.now()
  const row = await one<UserWithSession>(
    `SELECT u.*, s.token AS s_token, s.created_at AS s_created, s.elevated_until AS s_elev,
            s.device_hash AS s_device, s.last_seen AS s_seen
     FROM sessions s JOIN users u ON u.address = s.address
     WHERE s.token = $1 AND s.expires_at > $2`,
    [h, now],
  )
  if (!row) return null
  if (!row.s_seen || now - Number(row.s_seen) > 5 * 60_000) {
    await exec('UPDATE sessions SET last_seen = $2 WHERE token = $1', [h, now])
  }
  const { s_token, s_created, s_elev, s_device, s_seen: _seen, ...user } = row
  void _seen
  return {
    user: user as UserRow,
    session: {
      id: s_token.slice(0, 16),
      tokenHash: s_token,
      createdAt: Number(s_created ?? 0),
      elevatedUntil: Number(s_elev ?? 0),
      deviceHash: s_device,
    },
  }
}

/** Server-side authorization: every protected route goes through this. */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = bearerToken(c)
  const found = token ? await userForToken(token) : null
  if (!found) return c.json({ error: 'Sign in required' }, 401)
  c.set('user', found.user)
  c.set('session', found.session)
  await next()
}

// ── Validation ───────────────────────────────────────────────────────────
export function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= max ? t : null
}

export function optStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function addr(v: unknown): string | null {
  return typeof v === 'string' && isAddress(v) ? v.toLowerCase() : null
}

/** Positive decimal with at most 6 fractional digits, e.g. "12.50". */
export function usdcAmount(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null
  return Number(s) > 0 ? s : null
}

export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 600) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function countryCode(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null
}

// ── Rate limit ───────────────────────────────────────────────────────────
export function rateLimit(name: string, limit: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    // The last hop is the one our own proxy appended; earlier hops can be forged by the client.
    const ip = (c.req.header('x-forwarded-for') ?? 'local').split(',').pop()!.trim()
    const key = `${name}:${ip}`
    const now = Date.now()
    const rows = await q<{ n: number; reset_at: number }>(
      `INSERT INTO rate_limits (key, n, reset_at) VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         n = CASE WHEN rate_limits.reset_at < $3 THEN 1 ELSE rate_limits.n + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at < $3 THEN $2 ELSE rate_limits.reset_at END
       RETURNING n, reset_at`,
      [key, now + windowMs, now],
    )
    const row = rows[0]
    if (row && row.n > limit) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((row.reset_at - now) / 1000))))
      return c.json({ error: 'Too many requests. Please wait a moment.' }, 429)
    }
    await next()
  }
}

export async function upsertUser(input: {
  address: string
  method: 'circle' | 'wallet'
  walletId?: string | null
}): Promise<UserRow> {
  const rows = await q<UserRow>(
    `INSERT INTO users (address, method, circle_wallet_id, display_name, created_at)
     VALUES ($1, $2, $3, '', $4)
     ON CONFLICT (address) DO UPDATE SET circle_wallet_id = COALESCE($3, users.circle_wallet_id)
     RETURNING *`,
    [input.address, input.method, input.walletId ?? null, Date.now()],
  )
  return rows[0]!
}
