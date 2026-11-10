// Staff roles, permissions, staff two-factor (TOTP) and two-person approval for sensitive actions.

import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { exec, one, q } from '../db'
import type { AuthEnv } from '../auth'
import { audit } from './audit'
import { decryptSecret, encryptSecret, encryptionConfigured, newTotpSecret, totpUri, verifyTotp } from './crypto'
import { recordEvent } from './risk'

export type Role = 'support' | 'compliance' | 'finance' | 'admin'

export type Permission =
  | 'overview.read' | 'cases.read' | 'cases.write' | 'users.read' | 'restrictions.write' | 'appeals.review'
  | 'orders.read' | 'orders.recheck' | 'audit.read' | 'events.read' | 'incidents.manage' | 'listings.review'
  | 'config.read' | 'config.write' | 'staff.manage' | 'privacy.execute'

export const PERMISSIONS: Record<Permission, Role[]> = {
  'overview.read': ['support', 'compliance', 'finance', 'admin'],
  'cases.read': ['support', 'compliance', 'admin'],
  'cases.write': ['compliance', 'admin'],
  'users.read': ['support', 'compliance', 'finance', 'admin'],
  'restrictions.write': ['compliance', 'admin'],
  'appeals.review': ['compliance', 'admin'],
  'orders.read': ['finance', 'compliance', 'admin'],
  'orders.recheck': ['finance', 'admin'],
  'audit.read': ['compliance', 'finance', 'admin'],
  'events.read': ['support', 'compliance', 'admin'],
  'incidents.manage': ['compliance', 'admin'],
  'listings.review': ['support', 'compliance', 'admin'],
  'config.read': ['compliance', 'admin'],
  'config.write': ['admin'],
  'staff.manage': ['admin'],
  'privacy.execute': ['admin'],
}

export const ROLES: Role[] = ['support', 'compliance', 'finance', 'admin']
export const ELEVATION_MS = 30 * 60_000

/** Bootstrap admins come from the environment, so the first admin never depends on a database row. */
export function bootstrapAdmins(): Set<string> {
  return new Set(
    (process.env.ADMIN_BOOTSTRAP_ADDRESSES ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  )
}

export async function rolesFor(address: string): Promise<Role[]> {
  const out = new Set<Role>()
  if (bootstrapAdmins().has(address)) out.add('admin')
  const rows = await q<{ role: Role }>('SELECT role FROM staff_roles WHERE address = $1', [address])
  for (const r of rows) out.add(r.role)
  return [...out]
}

export const can = (roles: Role[], p: Permission): boolean => roles.some((r) => PERMISSIONS[p].includes(r))

export type StaffEnv = AuthEnv & { Variables: { roles: Role[] } }

/** Staff routes need: a signed-in session, a role with the permission, and a TOTP-elevated session. */
export function requireStaff(permission: Permission): MiddlewareHandler<StaffEnv> {
  return async (c, next) => {
    const user = c.get('user')
    const session = c.get('session')
    const roles = await rolesFor(user.address)
    if (!can(roles, permission)) {
      await recordEvent({ address: user.address, kind: 'staff_denied', severity: 'warn', details: { permission, path: c.req.path } })
      return c.json({ error: 'You do not have permission for this.' }, 403)
    }
    if (session.elevatedUntil < Date.now()) {
      return c.json({ error: 'Confirm your authenticator code to continue.', code: 'elevation_required' }, 401)
    }
    c.set('roles', roles)
    await next()
  }
}

// ── Staff TOTP ───────────────────────────────────────────────────────────
export async function totpStatus(address: string): Promise<{ enrolled: boolean; enabled: boolean }> {
  const r = await one<{ enabled: number }>('SELECT enabled FROM staff_totp WHERE address = $1', [address])
  return { enrolled: !!r, enabled: r?.enabled === 1 }
}

export async function startTotpEnrollment(address: string): Promise<{ secret: string; uri: string }> {
  if (!encryptionConfigured()) throw new Error('Staff authentication is not configured on this server.')
  const status = await totpStatus(address)
  if (status.enabled) throw new Error('An authenticator is already active. Ask an admin to reset it.')
  const secret = newTotpSecret()
  await exec(
    `INSERT INTO staff_totp (address, secret_enc, enabled, created_at) VALUES ($1, $2, 0, $3)
     ON CONFLICT (address) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enabled = 0, created_at = EXCLUDED.created_at`,
    [address, encryptSecret(secret), Date.now()],
  )
  await audit({ actor: address, action: 'staff.totp_enroll_start', target: address })
  return { secret, uri: totpUri(address.slice(0, 10), secret) }
}

export async function checkTotp(address: string, code: string, opts?: { activate?: boolean }): Promise<boolean> {
  const r = await one<{ secret_enc: string; enabled: number }>('SELECT secret_enc, enabled FROM staff_totp WHERE address = $1', [address])
  if (!r) return false
  if (r.enabled !== 1 && !opts?.activate) return false
  const ok = verifyTotp(decryptSecret(r.secret_enc), code)
  if (ok && opts?.activate && r.enabled !== 1) {
    await exec('UPDATE staff_totp SET enabled = 1 WHERE address = $1', [address])
    await audit({ actor: address, action: 'staff.totp_enabled', target: address })
  }
  return ok
}

export async function elevateSession(tokenHash: string): Promise<void> {
  await exec('UPDATE sessions SET elevated_until = $2 WHERE token = $1', [tokenHash, Date.now() + ELEVATION_MS])
}

// ── Two-person approval for sensitive actions ────────────────────────────
export type SensitiveAction = 'staff.grant' | 'staff.revoke' | 'config.update' | 'restriction.indefinite' | 'user.anonymize' | 'totp.reset'

export async function adminCount(): Promise<number> {
  const rows = await q<{ address: string }>("SELECT address FROM staff_roles WHERE role = 'admin'")
  return new Set([...rows.map((r) => r.address), ...bootstrapAdmins()]).size
}

export interface AdminRequest {
  id: string
  action: SensitiveAction
  payload: string
  reason: string
  requested_by: string
  status: 'pending' | 'executed' | 'rejected'
  approved_by: string | null
  created_at: number
  resolved_at: number | null
}

export async function createRequest(action: SensitiveAction, payload: unknown, reason: string, by: string): Promise<string> {
  const id = randomUUID()
  await exec(
    "INSERT INTO admin_requests (id, action, payload, reason, requested_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, action, JSON.stringify(payload), reason.slice(0, 500), by, Date.now()],
  )
  await audit({ actor: by, action: 'request.create', target: id, details: { action, reason } })
  return id
}
