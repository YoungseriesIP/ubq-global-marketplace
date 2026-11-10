// Staff console API. Every route needs: a signed-in session, a role with the permission, and a TOTP-confirmed session.
// There is deliberately no route that edits an order, a payment or an audit entry.

import { Hono } from 'hono'
import { requireAuth, rateLimit, str, addr, optStr } from '../auth'
import { exec, one, q, type ListingRow, type OrderRow, type UserRow } from '../db'
import { audit } from './audit'
import { encryptionConfigured } from './crypto'
import { staffAdmin } from './staffAdmin'
import { settleOrder } from './payRoutes'
import {
  checkTotp, elevateSession, requireStaff, rolesFor, startTotpEnrollment, totpStatus, type StaffEnv,
} from './rbac'
import { createRestriction, levelFor, openCase, recordEvent, type RestrictionRow } from './risk'
import { adminCount, createRequest } from './rbac'

export const staff = new Hono<StaffEnv>()
staff.use('*', requireAuth)

// ── Own staff status and authenticator (before elevation) ───────────────
staff.get('/me', async (c) => {
  const user = c.get('user')
  const roles = await rolesFor(user.address)
  const totp = await totpStatus(user.address)
  return c.json({
    roles, totp, configured: encryptionConfigured(),
    elevated: c.get('session').elevatedUntil > Date.now(),
    elevatedUntil: c.get('session').elevatedUntil,
  })
})

staff.post('/totp/enroll', rateLimit('totp-enroll', 5, 3_600_000), async (c) => {
  const user = c.get('user')
  if ((await rolesFor(user.address)).length === 0) return c.json({ error: 'Staff only.' }, 403)
  try {
    return c.json(await startTotpEnrollment(user.address))
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Could not start enrollment.' }, 409)
  }
})

async function confirmCode(user: UserRow, tokenHash: string, body: Record<string, unknown>, activate: boolean) {
  const code = str(body.code, 8)
  if (!code) return { ok: false as const, error: 'Enter the 6-digit code.' }
  if ((await rolesFor(user.address)).length === 0) return { ok: false as const, error: 'Staff only.' }
  const ok = await checkTotp(user.address, code, { activate })
  if (!ok) {
    await recordEvent({ address: user.address, kind: 'staff_totp_failed', severity: 'warn' })
    return { ok: false as const, error: 'That code did not match.' }
  }
  await elevateSession(tokenHash)
  await audit({ actor: user.address, action: 'staff.elevate' })
  return { ok: true as const }
}

staff.post('/totp/confirm', rateLimit('totp', 10, 300_000), async (c) => {
  const r = await confirmCode(c.get('user'), c.get('session').tokenHash, (await c.req.json().catch(() => ({}))) as Record<string, unknown>, true)
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 401)
})

staff.post('/elevate', rateLimit('totp', 10, 300_000), async (c) => {
  const r = await confirmCode(c.get('user'), c.get('session').tokenHash, (await c.req.json().catch(() => ({}))) as Record<string, unknown>, false)
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 401)
})

// ── Overview ─────────────────────────────────────────────────────────────
staff.get('/overview', requireStaff('overview.read'), async (c) => {
  const day = Date.now() - 86_400_000
  const [cases, events, restr, appeals, incidents, orders, review, staffCount] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM cases WHERE status <> 'closed'"),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM security_events WHERE at > $1 AND severity IN ('high','critical')", [day]),
    one<{ n: number }>('SELECT COUNT(*)::int AS n FROM restrictions WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $1)', [Date.now()]),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM appeals WHERE status = 'open'"),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM incidents WHERE status <> 'resolved'"),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('unverified','failed')"),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM listings WHERE status = 'review'"),
    adminCount(),
  ])
  return c.json({
    openCases: cases?.n ?? 0, highAlerts24h: events?.n ?? 0, activeRestrictions: restr?.n ?? 0,
    openAppeals: appeals?.n ?? 0, openIncidents: incidents?.n ?? 0, ordersNeedingAttention: orders?.n ?? 0,
    listingsInReview: review?.n ?? 0, admins: staffCount,
  })
})

// ── Cases ────────────────────────────────────────────────────────────────
interface CaseRow {
  id: string; kind: string; status: string; severity: string; subject: string | null; title: string
  summary: string; assignee: string | null; created_by: string; created_at: number; updated_at: number
  closed_at: number | null; resolution: string | null
}

staff.get('/cases', requireStaff('cases.read'), async (c) => {
  const status = c.req.query('status')
  const rows = await q<CaseRow>(
    `SELECT * FROM cases WHERE ($1::text IS NULL OR status = $1) ORDER BY
     CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT 200`,
    [status ?? null],
  )
  return c.json({ cases: rows })
})

staff.get('/cases/:id', requireStaff('cases.read'), async (c) => {
  const row = await one<CaseRow>('SELECT * FROM cases WHERE id = $1', [c.req.param('id')])
  if (!row) return c.json({ error: 'Case not found.' }, 404)
  const notes = await q<{ id: string; author: string; kind: string; body: string; at: number }>('SELECT id, author, kind, body, at FROM case_notes WHERE case_id = $1 ORDER BY at ASC', [row.id])
  return c.json({ case: row, notes })
})

staff.post('/cases', requireStaff('cases.write'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const title = str(body.title, 200)
  const severity = ['low', 'medium', 'high', 'critical'].includes(String(body.severity)) ? (body.severity as 'low') : 'medium'
  if (!title) return c.json({ error: 'A title is required.' }, 400)
  const id = await openCase({
    kind: str(body.kind, 40) ?? 'manual', severity, subject: addr(body.subject), title, summary: optStr(body.summary, 2000), by: c.get('user').address,
  })
  return c.json({ id }, 201)
})

staff.post('/cases/:id/notes', requireStaff('cases.write'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const text = str(body.body, 3000)
  const kind = ['note', 'finding', 'decision', 'escalation'].includes(String(body.kind)) ? String(body.kind) : 'note'
  if (!text) return c.json({ error: 'Write something first.' }, 400)
  const actor = c.get('user').address
  await exec('INSERT INTO case_notes (case_id, author, kind, body, at) VALUES ($1, $2, $3, $4, $5)', [c.req.param('id'), actor, kind, text, Date.now()])
  await exec('UPDATE cases SET updated_at = $2 WHERE id = $1', [c.req.param('id'), Date.now()])
  await audit({ actor, action: `case.${kind}`, target: c.req.param('id') })
  return c.json({ ok: true }, 201)
})

staff.patch('/cases/:id', requireStaff('cases.write'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const actor = c.get('user').address
  const status = ['open', 'investigating', 'escalated', 'closed'].includes(String(body.status)) ? String(body.status) : null
  const resolution = optStr(body.resolution, 2000)
  if (status === 'closed' && resolution.length < 10) return c.json({ error: 'Record the decision before closing a case.' }, 400)
  await exec(
    `UPDATE cases SET status = COALESCE($2, status), assignee = COALESCE($3, assignee), resolution = CASE WHEN $4 <> '' THEN $4 ELSE resolution END,
       updated_at = $5, closed_at = CASE WHEN $2 = 'closed' THEN $5 ELSE closed_at END WHERE id = $1`,
    [c.req.param('id'), status, addr(body.assignee), resolution, Date.now()],
  )
  await audit({ actor, action: 'case.update', target: c.req.param('id'), details: { status } })
  return c.json({ ok: true })
})

// ── Events and users (reads of customer data are logged) ────────────────
staff.get('/events', requireStaff('events.read'), async (c) => {
  const rows = await q<{ id: string; at: number; address: string | null; kind: string; severity: string; details: string }>(
    `SELECT id, at, address, kind, severity, details FROM security_events
     WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR severity = $2) AND ($3::text IS NULL OR address = $3)
     ORDER BY at DESC LIMIT 200`,
    [c.req.query('kind') ?? null, c.req.query('severity') ?? null, addr(c.req.query('address')) ?? null],
  )
  return c.json({ events: rows.map((e) => ({ ...e, at: Number(e.at) })) })
})

staff.get('/users/:address', requireStaff('users.read'), async (c) => {
  const address = addr(c.req.param('address'))
  if (!address) return c.json({ error: 'Invalid address.' }, 400)
  const u = await one<UserRow>('SELECT * FROM users WHERE address = $1', [address])
  if (!u) return c.json({ error: 'User not found.' }, 404)
  await audit({ actor: c.get('user').address, action: 'user.view', target: address })
  const [restrictions, risk, counts, level] = await Promise.all([
    q<RestrictionRow>('SELECT * FROM restrictions WHERE address = $1 ORDER BY created_at DESC LIMIT 20', [address]),
    q<{ at: number; action: string; score: number; decision: string; reasons: string }>('SELECT at, action, score, decision, reasons FROM risk_assessments WHERE address = $1 ORDER BY at DESC LIMIT 20', [address]),
    one<{ listings: number; orders: number; devices: number }>(
      `SELECT (SELECT COUNT(*)::int FROM listings WHERE seller = $1) AS listings,
              (SELECT COUNT(*)::int FROM orders WHERE buyer = $1 OR seller = $1) AS orders,
              (SELECT COUNT(*)::int FROM user_devices WHERE address = $1) AS devices`, [address]),
    levelFor(address, u.method),
  ])
  return c.json({
    user: { address, method: u.method, shopName: u.shop_name, countryCode: u.country_code, createdAt: Number(u.created_at), isDemo: u.is_demo === 1, level },
    counts, restrictions, risk,
  })
})

// ── Restrictions and appeals ─────────────────────────────────────────────
staff.get('/restrictions', requireStaff('cases.read'), async (c) => {
  const rows = await q<RestrictionRow>(
    `SELECT * FROM restrictions WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $1) ORDER BY created_at DESC LIMIT 200`, [Date.now()])
  return c.json({ restrictions: rows })
})

staff.post('/restrictions', requireStaff('restrictions.write'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const actor = c.get('user').address
  const address = addr(body.address)
  const scope = ['sell', 'buy', 'all'].includes(String(body.scope)) ? (body.scope as 'sell') : null
  const reason = str(body.reason, 500)
  if (!address || !scope || !reason || reason.length < 10) return c.json({ error: 'Address, scope and a reason of at least 10 characters are required.' }, 400)
  if (body.indefinite === true) {
    const id = await createRequest('restriction.indefinite', { address, scope, reason, caseId: str(body.caseId, 40) }, reason, actor)
    return c.json({ requestId: id, needsApproval: true }, 202)
  }
  const days = Math.min(30, Math.max(1, Number(body.days) || 7))
  const id = await createRestriction({ address, scope, reason, by: actor, days, caseId: str(body.caseId, 40) })
  return c.json({ id }, 201)
})

staff.post('/restrictions/:id/lift', requireStaff('restrictions.write'), async (c) => {
  const actor = c.get('user').address
  const gone = await q<{ id: string }>('UPDATE restrictions SET lifted_at = $2, lifted_by = $3 WHERE id = $1 AND lifted_at IS NULL RETURNING id', [c.req.param('id'), Date.now(), actor])
  if (gone.length === 0) return c.json({ error: 'Restriction not found or already lifted.' }, 404)
  await audit({ actor, action: 'restriction.lift', target: c.req.param('id') })
  return c.json({ ok: true })
})

staff.get('/appeals', requireStaff('appeals.review'), async (c) => {
  const rows = await q<{ id: string; address: string; restriction_id: string; message: string; status: string; created_at: number }>(
    "SELECT id, address, restriction_id, message, status, created_at FROM appeals ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100")
  return c.json({ appeals: rows.map((a) => ({ ...a, created_at: Number(a.created_at) })) })
})

staff.post('/appeals/:id/resolve', requireStaff('appeals.review'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const actor = c.get('user').address
  const note = str(body.note, 1000)
  if (!note || note.length < 10) return c.json({ error: 'Record the reason for your decision.' }, 400)
  const accept = body.accept === true
  const a = await one<{ restriction_id: string }>("SELECT restriction_id FROM appeals WHERE id = $1 AND status = 'open'", [c.req.param('id')])
  if (!a) return c.json({ error: 'Open appeal not found.' }, 404)
  await exec('UPDATE appeals SET status = $2, reviewed_by = $3, decision_note = $4, resolved_at = $5 WHERE id = $1', [c.req.param('id'), accept ? 'accepted' : 'rejected', actor, note, Date.now()])
  if (accept) await exec('UPDATE restrictions SET lifted_at = $2, lifted_by = $3 WHERE id = $1 AND lifted_at IS NULL', [a.restriction_id, Date.now(), actor])
  await audit({ actor, action: accept ? 'appeal.accept' : 'appeal.reject', target: c.req.param('id') })
  return c.json({ ok: true })
})

// ── Incidents ────────────────────────────────────────────────────────────
staff.get('/incidents', requireStaff('incidents.manage'), async (c) => {
  const rows = await q('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 100')
  return c.json({ incidents: rows })
})

staff.post('/incidents', requireStaff('incidents.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const title = str(body.title, 200)
  if (!title) return c.json({ error: 'A title is required.' }, 400)
  const severity = ['low', 'medium', 'high', 'critical'].includes(String(body.severity)) ? String(body.severity) : 'medium'
  const id = `INC-${Date.now().toString(36).toUpperCase()}`
  await exec('INSERT INTO incidents (id, title, severity, description, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, title, severity, optStr(body.description, 3000), c.get('user').address, Date.now()])
  await audit({ actor: c.get('user').address, action: 'incident.open', target: id, details: { severity } })
  return c.json({ id }, 201)
})

staff.get('/incidents/:id', requireStaff('incidents.manage'), async (c) => {
  const row = await one('SELECT * FROM incidents WHERE id = $1', [c.req.param('id')])
  if (!row) return c.json({ error: 'Incident not found.' }, 404)
  const notes = await q('SELECT id, author, body, at FROM incident_notes WHERE incident_id = $1 ORDER BY at ASC', [c.req.param('id')])
  return c.json({ incident: row, notes })
})

staff.post('/incidents/:id/notes', requireStaff('incidents.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const text = str(body.body, 3000)
  if (!text) return c.json({ error: 'Write something first.' }, 400)
  await exec('INSERT INTO incident_notes (incident_id, author, body, at) VALUES ($1, $2, $3, $4)', [c.req.param('id'), c.get('user').address, text, Date.now()])
  return c.json({ ok: true }, 201)
})

staff.patch('/incidents/:id', requireStaff('incidents.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const status = ['open', 'investigating', 'contained', 'resolved'].includes(String(body.status)) ? String(body.status) : null
  if (!status) return c.json({ error: 'Invalid status.' }, 400)
  await exec('UPDATE incidents SET status = $2, resolved_at = CASE WHEN $2 = $3 THEN $4 ELSE resolved_at END WHERE id = $1', [c.req.param('id'), status, 'resolved', Date.now()])
  await audit({ actor: c.get('user').address, action: 'incident.update', target: c.req.param('id'), details: { status } })
  return c.json({ ok: true })
})

// ── Orders (read and re-verify only) and listing review ─────────────────
staff.get('/orders', requireStaff('orders.read'), async (c) => {
  const rows = await q<OrderRow & { title: string }>(
    `SELECT o.*, l.title FROM orders o JOIN listings l ON l.id = o.listing_id WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 200`,
    [c.req.query('status') ?? null],
  )
  return c.json({ orders: rows.map((o) => ({ ...o, created_at: Number(o.created_at) })) })
})

staff.post('/orders/:id/recheck', requireStaff('orders.recheck'), async (c) => {
  const o = await one<OrderRow>('SELECT * FROM orders WHERE id = $1', [c.req.param('id')])
  if (!o) return c.json({ error: 'Order not found.' }, 404)
  if (!o.tx_hash) return c.json({ error: 'No payment is attached to this order.' }, 400)
  await audit({ actor: c.get('user').address, action: 'order.recheck', target: o.id })
  return c.json(await settleOrder(o, o.tx_hash))
})

staff.get('/listings/review', requireStaff('listings.review'), async (c) => {
  const rows = await q<ListingRow & { reports: number }>(
    `SELECT l.*, (SELECT COUNT(*)::int FROM reports r WHERE r.listing_id = l.id) AS reports FROM listings l WHERE l.status = 'review' ORDER BY l.created_at DESC LIMIT 100`)
  return c.json({ listings: rows })
})

staff.post('/listings/:id/decision', requireStaff('listings.review'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const note = str(body.note, 500)
  if (!note || note.length < 5) return c.json({ error: 'Add a short reason.' }, 400)
  const next = body.approve === true ? 'active' : 'removed'
  const r = await q<{ id: string }>("UPDATE listings SET status = $2 WHERE id = $1 AND status = 'review' RETURNING id", [c.req.param('id'), next])
  if (r.length === 0) return c.json({ error: 'Listing is not waiting for review.' }, 404)
  await exec("UPDATE reports SET status = 'reviewed' WHERE listing_id = $1", [c.req.param('id')])
  await audit({ actor: c.get('user').address, action: `listing.${next === 'active' ? 'approve' : 'remove'}`, target: c.req.param('id'), details: { note } })
  return c.json({ ok: true })
})

staff.route('/', staffAdmin)
