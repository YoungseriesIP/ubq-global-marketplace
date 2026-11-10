// Risk engine, limits, restrictions and security events.
// Decisions are risk-based and reversible: nothing here bans anyone permanently or automatically.

import { randomUUID } from 'node:crypto'
import { exec, one, q } from '../db'
import { audit } from './audit'

export type Decision = 'allow' | 'step_up' | 'blocked' | 'review'
export type Scope = 'sell' | 'buy' | 'all'

export interface RiskConfig {
  thresholds: { stepUp: number; blocked: number; review: number }
  weights: {
    newAccount: number
    unverifiedWallet: number
    newDevice: number
    highAmount: number
    orderVelocity: number
    failedAuth: number
    recentRestriction: number
    sharedDevice: number
    listingBurst: number
    prohibitedTerm: number
    newSellerLargeSale: number
  }
  /** Per verification level: largest single payment and largest 24h total, in USDC. Defaults, not legal limits. */
  limits: Record<string, { single: number; daily: number }>
  prohibitedTerms: string[]
  retentionDays: { securityEvents: number; riskAssessments: number }
}

export const DEFAULT_CONFIG: RiskConfig = {
  thresholds: { stepUp: 40, blocked: 70, review: 90 },
  weights: {
    newAccount: 15, unverifiedWallet: 10, newDevice: 15, highAmount: 25, orderVelocity: 20,
    failedAuth: 20, recentRestriction: 25, sharedDevice: 20, listingBurst: 20, prohibitedTerm: 40,
    newSellerLargeSale: 10,
  },
  limits: {
    '0': { single: 500, daily: 1000 },
    '1': { single: 2000, daily: 5000 },
    '2': { single: 10000, daily: 25000 },
    '3': { single: 50000, daily: 100000 },
    '4': { single: 250000, daily: 500000 },
  },
  prohibitedTerms: [
    'fake passport', 'forged visa', 'counterfeit', 'replica passport', 'stolen', 'fake id', 'fake document',
    'illegal firearm', 'hacked account', 'carding',
  ],
  retentionDays: { securityEvents: 365, riskAssessments: 365 },
}

export async function getConfig(): Promise<RiskConfig> {
  const rows = await q<{ value: string }>("SELECT value FROM security_config WHERE key = 'risk'")
  if (!rows[0]) return DEFAULT_CONFIG
  try {
    const o = JSON.parse(rows[0].value) as Partial<RiskConfig>
    return {
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...o.thresholds },
      weights: { ...DEFAULT_CONFIG.weights, ...o.weights },
      limits: { ...DEFAULT_CONFIG.limits, ...o.limits },
      prohibitedTerms: Array.isArray(o.prohibitedTerms) ? o.prohibitedTerms : DEFAULT_CONFIG.prohibitedTerms,
      retentionDays: { ...DEFAULT_CONFIG.retentionDays, ...o.retentionDays },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

// ── Pure scoring (unit-tested) ───────────────────────────────────────────
export interface Signals {
  accountAgeDays: number
  level: number
  newDevice: boolean
  amountUsdc?: number
  singleLimit?: number
  ordersLastHour?: number
  failedAuth24h?: number
  recentRestrictions?: number
  accountsOnDevice?: number
  listingsLastHour?: number
  prohibitedHits?: string[]
  sellerAgeDays?: number
}

export function scoreSignals(s: Signals, cfg: RiskConfig): { score: number; reasons: string[] } {
  const w = cfg.weights
  let score = 0
  const reasons: string[] = []
  const add = (pts: number, why: string) => {
    if (pts <= 0) return
    score += pts
    reasons.push(`${why} (+${Math.round(pts)})`)
  }
  if (s.accountAgeDays < 7) add(w.newAccount, 'Account is less than 7 days old')
  if (s.level < 1) add(w.unverifiedWallet, 'Wallet-only account with no verified email')
  if (s.newDevice) add(w.newDevice, 'First time on this device')
  if (s.amountUsdc && s.singleLimit) add(w.highAmount * Math.min(1, s.amountUsdc / s.singleLimit), 'Payment size relative to the limit')
  if ((s.ordersLastHour ?? 0) > 3) add(w.orderVelocity, 'More than 3 payments in the last hour')
  if ((s.failedAuth24h ?? 0) >= 5) add(w.failedAuth, 'Repeated failed sign-in attempts in 24 hours')
  if ((s.recentRestrictions ?? 0) > 0) add(w.recentRestriction, 'Previous restriction on this account')
  if ((s.accountsOnDevice ?? 0) >= 4) add(w.sharedDevice, 'Device shared by 4 or more accounts')
  if ((s.listingsLastHour ?? 0) > 10) add(w.listingBurst, 'More than 10 listings in the last hour')
  if (s.prohibitedHits && s.prohibitedHits.length > 0) add(w.prohibitedTerm, `Listing text matches a prohibited term: ${s.prohibitedHits.join(', ')}`)
  if (s.sellerAgeDays !== undefined && s.sellerAgeDays < 7 && (s.amountUsdc ?? 0) > 1000) add(w.newSellerLargeSale, 'Large sale from a seller under 7 days old')
  return { score: Math.min(100, Math.round(score)), reasons }
}

export function decide(score: number, cfg: RiskConfig): Decision {
  if (score >= cfg.thresholds.review) return 'review'
  if (score >= cfg.thresholds.blocked) return 'blocked'
  if (score >= cfg.thresholds.stepUp) return 'step_up'
  return 'allow'
}

export function prohibitedHits(text: string, terms: string[]): string[] {
  const t = text.toLowerCase()
  return terms.filter((term) => term.length > 2 && t.includes(term.toLowerCase()))
}

// ── Events ───────────────────────────────────────────────────────────────
export async function recordEvent(e: {
  address?: string | null
  kind: string
  severity?: 'info' | 'warn' | 'high' | 'critical'
  details?: Record<string, unknown>
  ipHash?: string | null
}): Promise<void> {
  await exec(
    'INSERT INTO security_events (at, address, kind, severity, details, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)',
    [Date.now(), e.address ?? null, e.kind, e.severity ?? 'info', JSON.stringify(e.details ?? {}).slice(0, 2000), e.ipHash ?? null],
  )
}

// ── Restrictions ─────────────────────────────────────────────────────────
export interface RestrictionRow {
  id: string
  address: string
  scope: Scope
  reason: string
  case_id: string | null
  created_by: string
  created_at: number
  expires_at: number | null
  lifted_at: number | null
  lifted_by: string | null
  auto: number
}

export async function activeRestriction(address: string, op: 'sell' | 'buy'): Promise<RestrictionRow | null> {
  return one<RestrictionRow>(
    `SELECT * FROM restrictions
     WHERE address = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > $2)
       AND (scope = 'all' OR scope = $3)
     ORDER BY created_at DESC LIMIT 1`,
    [address, Date.now(), op],
  )
}

export async function createRestriction(r: {
  address: string
  scope: Scope
  reason: string
  by: string
  days: number | null
  caseId?: string | null
  auto?: boolean
}): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await exec(
    `INSERT INTO restrictions (id, address, scope, reason, case_id, created_by, created_at, expires_at, auto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, r.address, r.scope, r.reason.slice(0, 500), r.caseId ?? null, r.by, now, r.days === null ? null : now + r.days * 86_400_000, r.auto ? 1 : 0],
  )
  await audit({ actor: r.by, action: 'restriction.create', target: r.address, details: { id, scope: r.scope, days: r.days, auto: !!r.auto, caseId: r.caseId ?? null } })
  return id
}

// ── Cases ────────────────────────────────────────────────────────────────
export async function openCase(c: {
  kind: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  subject?: string | null
  title: string
  summary?: string
  by: string
}): Promise<string> {
  const id = `C-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`
  const now = Date.now()
  await exec(
    `INSERT INTO cases (id, kind, status, severity, subject, title, summary, created_by, created_at, updated_at)
     VALUES ($1, $2, 'open', $3, $4, $5, $6, $7, $8, $8)`,
    [id, c.kind, c.severity, c.subject ?? null, c.title.slice(0, 200), (c.summary ?? '').slice(0, 2000), c.by, now],
  )
  await audit({ actor: c.by, action: 'case.open', target: id, details: { kind: c.kind, severity: c.severity, subject: c.subject ?? null } })
  return id
}

// ── Evaluate ─────────────────────────────────────────────────────────────
export interface EvalInput {
  action: 'order' | 'listing'
  address: string
  level: number
  amountUsdc?: number
  text?: string
  newDevice: boolean
  deviceHash?: string | null
  sellerAddress?: string
}

export interface EvalResult {
  score: number
  decision: Decision
  reasons: string[]
  overLimit?: { kind: 'single' | 'daily'; limit: number }
  caseId?: string
}

export async function evaluate(input: EvalInput): Promise<EvalResult> {
  const cfg = await getConfig()
  const now = Date.now()
  const hour = now - 3_600_000
  const day = now - 86_400_000
  const lim = cfg.limits[String(input.level)] ?? cfg.limits['0']!

  const [u, fails, restr, orders1h, orders24h, listings1h, shared, seller] = await Promise.all([
    one<{ created_at: number }>('SELECT created_at FROM users WHERE address = $1', [input.address]),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM security_events WHERE address = $1 AND kind = 'login_failed' AND at > $2", [input.address, day]),
    // Restrictions that were overturned on appeal do not count against the account.
    one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM restrictions r WHERE r.address = $1 AND r.created_at > $2
       AND NOT EXISTS (SELECT 1 FROM appeals a WHERE a.restriction_id = r.id AND a.status = 'accepted')`,
      [input.address, now - 90 * 86_400_000],
    ),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE buyer = $1 AND created_at > $2 AND status <> 'failed'", [input.address, hour]),
    one<{ total: string | null }>("SELECT SUM(amount_usdc::numeric)::text AS total FROM orders WHERE buyer = $1 AND created_at > $2 AND status IN ('verified','unverified','pending_payment')", [input.address, day]),
    one<{ n: number }>('SELECT COUNT(*)::int AS n FROM listings WHERE seller = $1 AND created_at > $2', [input.address, hour]),
    input.deviceHash
      ? one<{ n: number }>('SELECT COUNT(DISTINCT address)::int AS n FROM user_devices WHERE device_hash = $1', [input.deviceHash])
      : Promise.resolve(null),
    input.sellerAddress
      ? one<{ created_at: number }>('SELECT created_at FROM users WHERE address = $1', [input.sellerAddress])
      : Promise.resolve(null),
  ])

  const hits = input.text ? prohibitedHits(input.text, cfg.prohibitedTerms) : []
  const { score, reasons } = scoreSignals(
    {
      accountAgeDays: u ? (now - Number(u.created_at)) / 86_400_000 : 0,
      level: input.level,
      newDevice: input.newDevice,
      amountUsdc: input.amountUsdc,
      singleLimit: lim.single,
      ordersLastHour: orders1h?.n,
      failedAuth24h: fails?.n,
      recentRestrictions: restr?.n,
      accountsOnDevice: shared?.n ?? 0,
      listingsLastHour: input.action === 'listing' ? listings1h?.n : 0,
      prohibitedHits: hits,
      sellerAgeDays: seller ? (now - Number(seller.created_at)) / 86_400_000 : undefined,
    },
    cfg,
  )

  let decision = decide(score, cfg)
  const result: EvalResult = { score, decision, reasons }

  if (input.action === 'order' && input.amountUsdc !== undefined) {
    const daily = Number(orders24h?.total ?? 0) + input.amountUsdc
    if (input.amountUsdc > lim.single) result.overLimit = { kind: 'single', limit: lim.single }
    else if (daily > lim.daily) result.overLimit = { kind: 'daily', limit: lim.daily }
    if (result.overLimit && decision === 'allow') decision = 'step_up'
  }
  result.decision = decision

  await exec(
    'INSERT INTO risk_assessments (at, address, action, score, decision, reasons) VALUES ($1, $2, $3, $4, $5, $6)',
    [now, input.address, input.action, score, decision, JSON.stringify(reasons)],
  )

  if (decision === 'review' && input.action === 'order') {
    // Highest tier for a payment: open a case and apply a short, automatic, reversible hold. Never a permanent ban.
    result.caseId = await openCase({
      kind: 'risk_review', severity: 'high', subject: input.address,
      title: `Automatic review: payment scored ${score}`, summary: reasons.join('; '), by: 'system',
    })
    await createRestriction({ address: input.address, scope: 'buy', reason: `Held for review (case ${result.caseId}). You can appeal.`, by: 'system', days: 1, caseId: result.caseId, auto: true })
    await recordEvent({ address: input.address, kind: 'risk_review', severity: 'high', details: { score, caseId: result.caseId } })
  }
  return result
}

/** Retention: remove old security events and assessments. The audit log is never pruned. */
export async function pruneRetention(): Promise<void> {
  const cfg = await getConfig()
  const day = 86_400_000
  await exec('DELETE FROM security_events WHERE at < $1', [Date.now() - cfg.retentionDays.securityEvents * day])
  await exec('DELETE FROM risk_assessments WHERE at < $1', [Date.now() - cfg.retentionDays.riskAssessments * day])
}

// ── Verification level ───────────────────────────────────────────────────
/**
 * 0 = wallet only (nothing verified), 1 = email verified by the sign-in provider.
 * Levels 2-4 are only ever set from a verified provider record in `verifications`; nothing here invents them.
 */
export async function levelFor(address: string, method: string): Promise<number> {
  const base = method === 'circle' ? 1 : 0
  const v = await one<{ level: number }>(
    "SELECT level FROM verifications WHERE address = $1 AND status = 'verified'",
    [address],
  )
  return Math.max(base, v?.level ?? 0)
}

/**
 * True when this device is new to an account that has used other devices before.
 * A person's very first device is not suspicious.
 */
export async function isFreshDevice(address: string, deviceHash: string | null): Promise<boolean> {
  if (!deviceHash) return false
  const row = await one<{ first_seen: number }>(
    'SELECT first_seen FROM user_devices WHERE address = $1 AND device_hash = $2',
    [address, deviceHash],
  )
  if (!row || Date.now() - Number(row.first_seen) > 10 * 60_000) return false
  const earlier = await one(
    'SELECT 1 AS x FROM user_devices WHERE address = $1 AND device_hash <> $2 AND first_seen < $3 LIMIT 1',
    [address, deviceHash, row.first_seen],
  )
  return !!earlier
}
