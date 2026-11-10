// Append-only, hash-chained audit log. Each entry commits to the one before it, so any edit,
// deletion or reordering is detectable. A database trigger also rejects UPDATE/DELETE/TRUNCATE.

import { createHash } from 'node:crypto'
import { q } from '../db'

export interface AuditRow {
  id: number
  at: number
  actor: string
  action: string
  target: string
  details: string
  prev_hash: string
  hash: string
}

const GENESIS = 'genesis'

export function entryHash(
  prev: string,
  e: Pick<AuditRow, 'at' | 'actor' | 'action' | 'target' | 'details'>,
): string {
  return createHash('sha256')
    .update([prev, String(e.at), e.actor, e.action, e.target, e.details].join('|'))
    .digest('hex')
}

/** Recompute the chain and report the first entry that does not match. */
export function verifyChain(rows: AuditRow[]): { ok: boolean; brokenAtId?: number } {
  let prev = GENESIS
  for (const r of rows) {
    if (r.prev_hash !== prev || r.hash !== entryHash(prev, r)) return { ok: false, brokenAtId: r.id }
    prev = r.hash
  }
  return { ok: true }
}

export async function audit(entry: {
  actor: string
  action: string
  target?: string
  details?: Record<string, unknown>
}): Promise<void> {
  const details = JSON.stringify(entry.details ?? {}).slice(0, 4000)
  // Two writers can read the same previous hash; the UNIQUE(prev_hash) constraint rejects one of them, which retries.
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await q<{ hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
    const prev = last[0]?.hash ?? GENESIS
    const at = Date.now()
    const row = { at, actor: entry.actor, action: entry.action, target: entry.target ?? '', details }
    try {
      await q(
        `INSERT INTO audit_log (at, actor, action, target, details, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [at, row.actor, row.action, row.target, details, prev, entryHash(prev, row)],
      )
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!/unique|duplicate/i.test(msg) || attempt === 4) throw e
    }
  }
}

export async function listAudit(limit: number, beforeId?: number): Promise<AuditRow[]> {
  return q<AuditRow>(
    `SELECT * FROM audit_log WHERE ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $1`,
    [Math.min(limit, 200), beforeId ?? null],
  )
}

export async function verifyAuditLog(): Promise<{ ok: boolean; entries: number; brokenAtId?: number }> {
  const rows = await q<AuditRow>('SELECT * FROM audit_log ORDER BY id ASC LIMIT 20000')
  return { entries: rows.length, ...verifyChain(rows) }
}
