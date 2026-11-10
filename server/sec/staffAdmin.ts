// Sensitive staff actions: audit log, configuration, staff roles, two-person approvals, data anonymisation.

import { Hono } from 'hono'
import { addr, optStr, str } from '../auth'
import { exec, one, q, type UserRow } from '../db'
import { audit, listAudit, verifyAuditLog } from './audit'
import {
  ROLES, adminCount, bootstrapAdmins, createRequest, requireStaff, type AdminRequest, type Role, type SensitiveAction, type StaffEnv,
} from './rbac'
import { DEFAULT_CONFIG, createRestriction, getConfig, type RiskConfig } from './risk'

export const staffAdmin = new Hono<StaffEnv>()

// ── Audit log (read-only) ────────────────────────────────────────────────
staffAdmin.get('/audit', requireStaff('audit.read'), async (c) => {
  const before = Number(c.req.query('before')) || undefined
  const rows = await listAudit(50, before)
  return c.json({ entries: rows.map((r) => ({ id: Number(r.id), at: Number(r.at), actor: r.actor, action: r.action, target: r.target, details: r.details })) })
})

staffAdmin.get('/audit/verify', requireStaff('audit.read'), async (c) => {
  return c.json(await verifyAuditLog())
})

// ── Execution of approved sensitive actions ─────────────────────────────
function validConfig(input: unknown): RiskConfig | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Partial<RiskConfig>
  const t = { ...DEFAULT_CONFIG.thresholds, ...o.thresholds }
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (![t.stepUp, t.blocked, t.review].every(num) || !(t.stepUp < t.blocked && t.blocked < t.review) || t.review > 100) return null
  const limits = { ...DEFAULT_CONFIG.limits, ...o.limits }
  if (!Object.values(limits).every((l) => num(l.single) && num(l.daily))) return null
  const terms = Array.isArray(o.prohibitedTerms) ? o.prohibitedTerms.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 200) : DEFAULT_CONFIG.prohibitedTerms
  return {
    thresholds: t,
    weights: { ...DEFAULT_CONFIG.weights, ...o.weights },
    limits,
    prohibitedTerms: terms,
    retentionDays: { ...DEFAULT_CONFIG.retentionDays, ...o.retentionDays },
  }
}

async function execute(action: SensitiveAction, payload: Record<string, unknown>, actor: string): Promise<string> {
  switch (action) {
    case 'staff.grant': {
      const address = addr(payload.address)
      const role = ROLES.find((r) => r === payload.role)
      if (!address || !role) throw new Error('Invalid staff grant.')
      await exec(
        `INSERT INTO staff_roles (address, role, granted_by, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (address) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
        [address, role, actor, Date.now()],
      )
      return `Granted ${role} to ${address}`
    }
    case 'staff.revoke': {
      const address = addr(payload.address)
      if (!address) throw new Error('Invalid address.')
      if (bootstrapAdmins().has(address)) throw new Error('Bootstrap admins are set in the server settings and cannot be revoked here.')
      await exec('DELETE FROM staff_roles WHERE address = $1', [address])
      await exec('DELETE FROM staff_totp WHERE address = $1', [address])
      return `Revoked staff access for ${address}`
    }
    case 'config.update': {
      const cfg = validConfig(payload.config)
      if (!cfg) throw new Error('Invalid configuration.')
      await exec(
        `INSERT INTO security_config (key, value, updated_by, updated_at) VALUES ('risk', $1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(cfg), actor, Date.now()],
      )
      return 'Security configuration updated'
    }
    case 'restriction.indefinite': {
      const address = addr(payload.address)
      const scope = ['sell', 'buy', 'all'].includes(String(payload.scope)) ? (payload.scope as 'sell') : null
      if (!address || !scope) throw new Error('Invalid restriction.')
      const id = await createRestriction({ address, scope, reason: optStr(payload.reason, 500) || 'Restricted after review', by: actor, days: null, caseId: str(payload.caseId, 40) })
      return `Restriction ${id} created`
    }
    case 'user.anonymize': {
      const address = addr(payload.address)
      if (!address) throw new Error('Invalid address.')
      const u = await one<UserRow>('SELECT * FROM users WHERE address = $1', [address])
      if (!u) throw new Error('User not found.')
      // Personal profile data is removed. Payment records stay for legal retention, linked only by wallet address.
      await exec("UPDATE users SET display_name = '', shop_name = '', shop_bio = '', email = NULL, circle_wallet_id = NULL, country_code = NULL WHERE address = $1", [address])
      await exec('DELETE FROM sessions WHERE address = $1', [address])
      await exec('DELETE FROM user_devices WHERE address = $1', [address])
      await exec("UPDATE listings SET status = 'removed' WHERE seller = $1", [address])
      await exec("UPDATE cases SET status = 'closed', closed_at = $2, resolution = 'Profile data anonymised on request' WHERE kind = 'data_deletion' AND subject = $1 AND status <> 'closed'", [address, Date.now()])
      return `Anonymised profile data for ${address}`
    }
    case 'totp.reset': {
      const address = addr(payload.address)
      if (!address) throw new Error('Invalid address.')
      await exec('DELETE FROM staff_totp WHERE address = $1', [address])
      return `Authenticator reset for ${address}`
    }
  }
}

/** Two admins approve sensitive actions. With only one admin the action runs at once and is logged as a single-admin override. */
async function runSensitive(action: SensitiveAction, payload: Record<string, unknown>, reason: string, actor: string) {
  if ((await adminCount()) <= 1) {
    const summary = await execute(action, payload, actor)
    await audit({ actor, action: `sensitive.${action}`, details: { payload, reason, mode: 'single_admin_override' } })
    return { executed: true as const, summary }
  }
  const requestId = await createRequest(action, payload, reason, actor)
  return { executed: false as const, requestId }
}

// ── Configuration ────────────────────────────────────────────────────────
staffAdmin.get('/config', requireStaff('config.read'), async (c) => c.json({ config: await getConfig(), defaults: DEFAULT_CONFIG }))

staffAdmin.put('/config', requireStaff('config.write'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const reason = str(body.reason, 500)
  if (!reason || reason.length < 10) return c.json({ error: 'Explain why this change is needed (10+ characters).' }, 400)
  if (!validConfig(body.config)) return c.json({ error: 'Those settings are not valid. Thresholds must rise in order and limits must be positive.' }, 400)
  const r = await runSensitive('config.update', { config: body.config }, reason, c.get('user').address)
  return c.json(r, r.executed ? 200 : 202)
})

// ── Staff accounts and approvals ─────────────────────────────────────────
staffAdmin.get('/team', requireStaff('staff.manage'), async (c) => {
  const rows = await q<{ address: string; role: Role; granted_by: string; created_at: number }>('SELECT * FROM staff_roles ORDER BY created_at DESC')
  const totp = await q<{ address: string; enabled: number }>('SELECT address, enabled FROM staff_totp')
  return c.json({
    bootstrap: [...bootstrapAdmins()],
    staff: rows.map((r) => ({ ...r, created_at: Number(r.created_at), totp: totp.some((t) => t.address === r.address && t.enabled === 1) })),
  })
})

staffAdmin.post('/team/grant', requireStaff('staff.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  const role = ROLES.find((r) => r === body.role)
  const reason = str(body.reason, 500)
  if (!address || !role || !reason) return c.json({ error: 'Address, role and a reason are required.' }, 400)
  const r = await runSensitive('staff.grant', { address, role }, reason, c.get('user').address)
  return c.json(r, r.executed ? 200 : 202)
})

staffAdmin.post('/team/revoke', requireStaff('staff.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  const reason = str(body.reason, 500)
  if (!address || !reason) return c.json({ error: 'Address and a reason are required.' }, 400)
  const r = await runSensitive('staff.revoke', { address }, reason, c.get('user').address)
  return c.json(r, r.executed ? 200 : 202)
})

staffAdmin.post('/team/reset-totp', requireStaff('staff.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  const reason = str(body.reason, 500)
  if (!address || !reason) return c.json({ error: 'Address and a reason are required.' }, 400)
  const r = await runSensitive('totp.reset', { address }, reason, c.get('user').address)
  return c.json(r, r.executed ? 200 : 202)
})

staffAdmin.post('/privacy/anonymize', requireStaff('privacy.execute'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const address = addr(body.address)
  const reason = str(body.reason, 500)
  if (!address || !reason) return c.json({ error: 'Address and a reason are required.' }, 400)
  const r = await runSensitive('user.anonymize', { address }, reason, c.get('user').address)
  return c.json(r, r.executed ? 200 : 202)
})

staffAdmin.get('/requests', requireStaff('staff.manage'), async (c) => {
  const rows = await q<AdminRequest>("SELECT * FROM admin_requests ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 100")
  return c.json({ requests: rows.map((r) => ({ ...r, created_at: Number(r.created_at) })) })
})

staffAdmin.post('/requests/:id/approve', requireStaff('staff.manage'), async (c) => {
  const actor = c.get('user').address
  const req = await one<AdminRequest>("SELECT * FROM admin_requests WHERE id = $1 AND status = 'pending'", [c.req.param('id')])
  if (!req) return c.json({ error: 'Pending request not found.' }, 404)
  if (req.requested_by === actor) return c.json({ error: 'A different admin must approve this.' }, 403)
  const claimed = await q<{ id: string }>("UPDATE admin_requests SET status = 'executed', approved_by = $2, resolved_at = $3 WHERE id = $1 AND status = 'pending' RETURNING id", [req.id, actor, Date.now()])
  if (claimed.length === 0) return c.json({ error: 'Already handled.' }, 409)
  try {
    const summary = await execute(req.action, JSON.parse(req.payload) as Record<string, unknown>, req.requested_by)
    await audit({ actor, action: `sensitive.${req.action}`, target: req.id, details: { requestedBy: req.requested_by, summary, mode: 'two_person' } })
    return c.json({ ok: true, summary })
  } catch (e) {
    await exec("UPDATE admin_requests SET status = 'rejected' WHERE id = $1", [req.id])
    return c.json({ error: e instanceof Error ? e.message : 'Could not apply the change.' }, 400)
  }
})

staffAdmin.post('/requests/:id/reject', requireStaff('staff.manage'), async (c) => {
  const actor = c.get('user').address
  const gone = await q<{ id: string }>("UPDATE admin_requests SET status = 'rejected', approved_by = $2, resolved_at = $3 WHERE id = $1 AND status = 'pending' RETURNING id", [c.req.param('id'), actor, Date.now()])
  if (gone.length === 0) return c.json({ error: 'Pending request not found.' }, 404)
  await audit({ actor, action: 'request.reject', target: c.req.param('id') })
  return c.json({ ok: true })
})
