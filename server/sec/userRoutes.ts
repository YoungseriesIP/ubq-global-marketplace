// Account-holder security: sessions, alerts, limits, appeals, consent, data export and deletion requests.

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { requireAuth, rateLimit, str, type AuthEnv } from '../auth'
import { exec, one, q } from '../db'
import { audit } from './audit'
import { getConfig, levelFor, openCase, recordEvent, type RestrictionRow } from './risk'

export const security = new Hono<AuthEnv>()
security.use('*', requireAuth)

security.get('/status', async (c) => {
  const user = c.get('user')
  const [cfg, level] = [await getConfig(), await levelFor(user.address, user.method)]
  const restrictions = await q<RestrictionRow>(
    `SELECT * FROM restrictions WHERE address = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $2) ORDER BY created_at DESC`,
    [user.address, Date.now()],
  )
  const appeals = await q<{ id: string; restriction_id: string; status: string; decision_note: string | null; created_at: number }>(
    'SELECT id, restriction_id, status, decision_note, created_at FROM appeals WHERE address = $1 ORDER BY created_at DESC LIMIT 20',
    [user.address],
  )
  const consents = await q<{ kind: string; version: string; at: number }>('SELECT kind, version, at FROM consents WHERE address = $1', [user.address])
  return c.json({
    level,
    limits: cfg.limits[String(level)] ?? cfg.limits['0'],
    verification: level >= 2 ? 'provider-verified' : level === 1 ? 'email verified at sign-in' : 'wallet only',
    restrictions: restrictions.map((r) => ({
      id: r.id, scope: r.scope, reason: r.reason, expiresAt: r.expires_at ? Number(r.expires_at) : null, auto: r.auto === 1,
      appealed: appeals.some((a) => a.restriction_id === r.id && a.status === 'open'),
    })),
    appeals: appeals.map((a) => ({ id: a.id, restrictionId: a.restriction_id, status: a.status, note: a.decision_note, createdAt: Number(a.created_at) })),
    consents,
  })
})

security.get('/sessions', async (c) => {
  const user = c.get('user')
  const current = c.get('session')
  const rows = await q<{ token: string; created_at: number | null; last_seen: number | null; user_agent: string | null; expires_at: number }>(
    'SELECT token, created_at, last_seen, user_agent, expires_at FROM sessions WHERE address = $1 AND expires_at > $2 ORDER BY last_seen DESC NULLS LAST',
    [user.address, Date.now()],
  )
  return c.json({
    sessions: rows.map((r) => ({
      id: r.token.slice(0, 16),
      current: r.token === current.tokenHash,
      device: (r.user_agent ?? 'Unknown device').slice(0, 120),
      createdAt: r.created_at ? Number(r.created_at) : null,
      lastSeen: r.last_seen ? Number(r.last_seen) : null,
    })),
  })
})

security.delete('/sessions/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: 'Invalid session.' }, 400)
  const gone = await q<{ token: string }>('DELETE FROM sessions WHERE address = $1 AND token LIKE $2 RETURNING token', [user.address, `${id}%`])
  if (gone.length === 0) return c.json({ error: 'Session not found.' }, 404)
  await recordEvent({ address: user.address, kind: 'session_revoked', severity: 'info' })
  return c.json({ ok: true })
})

security.post('/sessions/revoke-others', async (c) => {
  const user = c.get('user')
  const current = c.get('session')
  const gone = await q<{ token: string }>('DELETE FROM sessions WHERE address = $1 AND token <> $2 RETURNING token', [user.address, current.tokenHash])
  await recordEvent({ address: user.address, kind: 'sessions_revoked_all', severity: 'info', details: { count: gone.length } })
  return c.json({ revoked: gone.length })
})

security.get('/events', async (c) => {
  const user = c.get('user')
  const rows = await q<{ id: string; at: number; kind: string; severity: string }>(
    'SELECT id, at, kind, severity FROM security_events WHERE address = $1 ORDER BY at DESC LIMIT 50',
    [user.address],
  )
  return c.json({ events: rows.map((e) => ({ id: e.id, at: Number(e.at), kind: e.kind, severity: e.severity })) })
})

security.post('/appeals', rateLimit('appeal', 10, 3_600_000), async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const restrictionId = str(body.restrictionId, 80)
  const message = str(body.message, 1500)
  if (!restrictionId || !message || message.length < 20) return c.json({ error: 'Please explain your appeal in at least 20 characters.' }, 400)
  const r = await one<RestrictionRow>('SELECT * FROM restrictions WHERE id = $1 AND address = $2 AND lifted_at IS NULL', [restrictionId, user.address])
  if (!r) return c.json({ error: 'Restriction not found.' }, 404)
  const open = await one('SELECT 1 AS x FROM appeals WHERE restriction_id = $1 AND status = $2', [restrictionId, 'open'])
  if (open) return c.json({ error: 'You already have an open appeal for this restriction.' }, 409)
  const id = randomUUID()
  await exec('INSERT INTO appeals (id, address, restriction_id, message, created_at) VALUES ($1, $2, $3, $4, $5)', [id, user.address, restrictionId, message, Date.now()])
  await audit({ actor: user.address, action: 'appeal.create', target: id, details: { restrictionId } })
  return c.json({ id }, 201)
})

security.post('/consent', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const kind = body.kind === 'terms' || body.kind === 'privacy' ? body.kind : null
  const version = str(body.version, 20)
  if (!kind || !version) return c.json({ error: 'kind and version required.' }, 400)
  await exec('INSERT INTO consents (address, kind, version, at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [user.address, kind, version, Date.now()])
  return c.json({ ok: true })
})

/** Everything we hold about the signed-in person (no secrets, no other users' data). */
security.get('/export', rateLimit('export', 5, 3_600_000), async (c) => {
  const user = c.get('user')
  const [listings, orders, events, consents, devices] = await Promise.all([
    q('SELECT id, title, description, price_usdc, category, location, status, created_at FROM listings WHERE seller = $1', [user.address]),
    q('SELECT id, listing_id, buyer, seller, amount_usdc, status, tx_hash, created_at FROM orders WHERE buyer = $1 OR seller = $1', [user.address]),
    q('SELECT at, kind, severity FROM security_events WHERE address = $1 ORDER BY at DESC LIMIT 500', [user.address]),
    q('SELECT kind, version, at FROM consents WHERE address = $1', [user.address]),
    q('SELECT first_seen, last_seen FROM user_devices WHERE address = $1', [user.address]),
  ])
  await audit({ actor: user.address, action: 'privacy.export', target: user.address })
  return c.json({
    exportedAt: new Date().toISOString(),
    profile: {
      address: user.address, signInMethod: user.method, displayName: user.display_name, shopName: user.shop_name,
      shopBio: user.shop_bio, countryCode: user.country_code, createdAt: Number(user.created_at),
    },
    listings, orders, securityEvents: events, consents, devices,
    note: 'Identity documents are never stored by this app. Payment records are kept for the legal retention period.',
  })
})

security.post('/delete-request', rateLimit('delete-request', 3, 86_400_000), async (c) => {
  const user = c.get('user')
  const existing = await one<{ id: string }>("SELECT id FROM cases WHERE kind = 'data_deletion' AND subject = $1 AND status <> 'closed'", [user.address])
  if (existing) return c.json({ caseId: existing.id, alreadyOpen: true })
  const caseId = await openCase({
    kind: 'data_deletion', severity: 'medium', subject: user.address,
    title: 'Data deletion request', summary: 'The account holder asked for their personal data to be deleted. Payment records are retained as required.',
    by: user.address,
  })
  await recordEvent({ address: user.address, kind: 'data_deletion_requested', severity: 'info', details: { caseId } })
  return c.json({ caseId }, 201)
})
