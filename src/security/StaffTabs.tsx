import { useState } from 'react'
import { api } from '@/lib/api'
import { Btn, Card, Field, Pill, sevTone, short, when } from './ui'
import { useStaffAction, useStaffData } from './useStaffData'

export { IncidentsTab, AuditTab, ConfigTab, TeamTab } from './StaffTabs2'

interface TabProps { onLocked: () => void }

const Empty = ({ text }: { text: string }) => <p className="text-sm" style={{ color: 'var(--muted)' }}>{text}</p>
const Err = ({ text }: { text: string | null }) => (text ? <p className="text-sm" style={{ color: 'var(--danger)' }}>{text}</p> : null)

// ── Overview ─────────────────────────────────────────────────────────────
interface Overview {
  openCases: number; highAlerts24h: number; activeRestrictions: number; openAppeals: number
  openIncidents: number; ordersNeedingAttention: number; listingsInReview: number; admins: number
}

export function OverviewTab({ onLocked, goto }: TabProps & { goto: (t: string) => void }) {
  const { data, error } = useStaffData<Overview>('/staff/overview', onLocked)
  const tiles: Array<[string, number | undefined, string]> = [
    ['Open cases', data?.openCases, 'Cases'],
    ['High alerts (24h)', data?.highAlerts24h, 'Alerts'],
    ['Active restrictions', data?.activeRestrictions, 'Queues'],
    ['Open appeals', data?.openAppeals, 'Queues'],
    ['Payments to check', data?.ordersNeedingAttention, 'Queues'],
    ['Listings in review', data?.listingsInReview, 'Queues'],
    ['Open incidents', data?.openIncidents, 'Incidents'],
    ['Admins', data?.admins, 'Team'],
  ]
  return (
    <div>
      <Err text={error} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(([label, n, tab]) => (
          <button key={label} onClick={() => goto(tab)} className="text-left rounded-2xl border p-4" style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>{label}</p>
            <p className="display font-bold text-3xl tabular-nums mt-1" style={{ color: 'var(--ink)' }}>{n ?? '–'}</p>
          </button>
        ))}
      </div>
      {data && data.admins < 2 && (
        <p className="text-xs mt-4" style={{ color: '#92400e' }}>
          Only one admin exists, so sensitive changes apply immediately (and are logged). Add a second admin to require two-person approval.
        </p>
      )}
    </div>
  )
}

// ── Cases ────────────────────────────────────────────────────────────────
interface CaseRow { id: string; kind: string; status: string; severity: string; subject: string | null; title: string; summary: string; created_at: number }
interface CaseDetail { case: CaseRow & { resolution: string | null }; notes: Array<{ id: string; author: string; kind: string; body: string; at: number }> }

export function CasesTab({ onLocked }: TabProps) {
  const [status, setStatus] = useState('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useStaffData<{ cases: CaseRow[] }>(`/staff/cases?status=${status}`, onLocked)
  const detail = useStaffData<CaseDetail>(openId ? `/staff/cases/${openId}` : null, onLocked)
  const { run, busy } = useStaffAction(onLocked, () => { list.reload(); detail.reload() })
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('note')
  const [resolution, setResolution] = useState('')

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card title="Cases" right={
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOpenId(null) }} className="text-sm rounded-lg px-2 py-1" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
          {['open', 'investigating', 'escalated', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      }>
        <Err text={list.error} />
        {list.data?.cases.length === 0 && <Empty text="No cases here." />}
        <ul className="space-y-2">
          {list.data?.cases.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpenId(c.id)} className="w-full text-left rounded-xl p-3" style={{ background: openId === c.id ? 'var(--surface-muted)' : 'transparent', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-1"><Pill text={c.severity} tone={sevTone(c.severity)} /><span className="text-xs" style={{ color: 'var(--subtle)' }}>{c.kind} · {c.id}</span></div>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{c.title}</p>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>{short(c.subject)} · {when(Number(c.created_at))}</p>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={openId ? `Case ${openId}` : 'Select a case'}>
        {!detail.data || !openId ? <Empty text="Open a case to read it and record your findings." /> : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{detail.data.case.summary || 'No summary.'}</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              Possible matches are leads, not confirmed violations. Record what you checked and why you decided.
            </p>
            <ul className="space-y-2">
              {detail.data.notes.map((n) => (
                <li key={n.id} className="rounded-lg p-2 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>{n.kind} · {short(n.author)} · {when(Number(n.at))}</span>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
            {detail.data.case.status !== 'closed' && (
              <>
                <Field multiline value={note} onChange={setNote} placeholder="Add a note, finding or decision" />
                <div className="flex flex-wrap gap-2">
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className="text-sm rounded-lg px-2" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                    {['note', 'finding', 'decision', 'escalation'].map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <Btn small disabled={busy || !note.trim()} onClick={() => void run(async () => { await api(`/staff/cases/${openId}/notes`, { body: { body: note, kind } }); setNote('') }, 'Note added')}>Add</Btn>
                  <Btn small kind="ghost" disabled={busy} onClick={() => void run(() => api(`/staff/cases/${openId}`, { method: 'PATCH', body: { status: 'investigating' } }), 'Marked as investigating')}>Investigating</Btn>
                  <Btn small kind="ghost" disabled={busy} onClick={() => void run(() => api(`/staff/cases/${openId}`, { method: 'PATCH', body: { status: 'escalated' } }), 'Escalated')}>Escalate</Btn>
                </div>
                <Field value={resolution} onChange={setResolution} placeholder="Decision, to close the case (10+ characters)" />
                <Btn small kind="danger" disabled={busy || resolution.trim().length < 10} onClick={() => void run(() => api(`/staff/cases/${openId}`, { method: 'PATCH', body: { status: 'closed', resolution } }), 'Case closed')}>Close case</Btn>
              </>
            )}
            {detail.data.case.resolution && <p className="text-sm" style={{ color: 'var(--ink-2)' }}>Decision: {detail.data.case.resolution}</p>}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Alerts ───────────────────────────────────────────────────────────────
interface EventRow { id: string; at: number; address: string | null; kind: string; severity: string; details: string }

export function AlertsTab({ onLocked }: TabProps) {
  const [severity, setSeverity] = useState('')
  const { data, error } = useStaffData<{ events: EventRow[] }>(`/staff/events${severity ? `?severity=${severity}` : ''}`, onLocked)
  return (
    <Card title="Security alerts" right={
      <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="text-sm rounded-lg px-2 py-1" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
        <option value="">all</option>{['info', 'warn', 'high', 'critical'].map((s) => <option key={s}>{s}</option>)}
      </select>
    }>
      <Err text={error} />
      {data?.events.length === 0 && <Empty text="No alerts." />}
      <ul className="space-y-2">
        {data?.events.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
            <span style={{ color: 'var(--ink-2)' }}><Pill text={e.severity} tone={sevTone(e.severity)} /> {e.kind} <span className="font-mono text-xs" style={{ color: 'var(--subtle)' }}>{short(e.address)}</span></span>
            <span className="text-xs shrink-0" style={{ color: 'var(--subtle)' }}>{when(Number(e.at))}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Queues: appeals, restrictions, listings, payments ───────────────────
interface Appeal { id: string; address: string; message: string; status: string; created_at: number }
interface Restr { id: string; address: string; scope: string; reason: string; expires_at: number | null; auto: number }
interface ListingQ { id: string; title: string; seller: string; reports: number }
interface OrderQ { id: string; title: string; buyer: string; amount_usdc: string; status: string; verify_note: string | null }

export function QueuesTab({ onLocked }: TabProps) {
  const appeals = useStaffData<{ appeals: Appeal[] }>('/staff/appeals', onLocked)
  const restr = useStaffData<{ restrictions: Restr[] }>('/staff/restrictions', onLocked)
  const listings = useStaffData<{ listings: ListingQ[] }>('/staff/listings/review', onLocked)
  const orders = useStaffData<{ orders: OrderQ[] }>('/staff/orders', onLocked)
  const reloadAll = () => { appeals.reload(); restr.reload(); listings.reload(); orders.reload() }
  const { run, busy } = useStaffAction(onLocked, reloadAll)
  const [note, setNote] = useState('')
  const [addr, setAddr] = useState('')
  const [reason, setReason] = useState('')

  return (
    <div className="space-y-4">
      <Card title="Appeals">
        {appeals.data?.appeals.filter((a) => a.status === 'open').length === 0 && <Empty text="No open appeals." />}
        <Field value={note} onChange={setNote} placeholder="Your decision note (required, 10+ characters)" />
        <ul className="space-y-2 mt-3">
          {appeals.data?.appeals.filter((a) => a.status === 'open').map((a) => (
            <li key={a.id} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>{short(a.address)} · {when(Number(a.created_at))}</p>
              <p className="text-sm mb-2" style={{ color: 'var(--ink-2)' }}>{a.message}</p>
              <div className="flex gap-2">
                <Btn small disabled={busy} onClick={() => void run(() => api(`/staff/appeals/${a.id}/resolve`, { body: { accept: true, note } }), 'Appeal accepted, restriction lifted')}>Accept</Btn>
                <Btn small kind="danger" disabled={busy} onClick={() => void run(() => api(`/staff/appeals/${a.id}/resolve`, { body: { accept: false, note } }), 'Appeal rejected')}>Reject</Btn>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Active restrictions">
        <ul className="space-y-2 mb-4">
          {restr.data?.restrictions.length === 0 && <Empty text="No active restrictions." />}
          {restr.data?.restrictions.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
              <span style={{ color: 'var(--ink-2)' }}><Pill text={r.scope} tone="warn" /> {short(r.address)} · {r.reason} {r.auto === 1 && <Pill text="automatic" />} <span className="text-xs" style={{ color: 'var(--subtle)' }}>{r.expires_at ? `until ${when(Number(r.expires_at))}` : 'no end date'}</span></span>
              <Btn small kind="ghost" disabled={busy} onClick={() => void run(() => api(`/staff/restrictions/${r.id}/lift`, { method: 'POST', body: {} }), 'Restriction lifted')}>Lift</Btn>
            </li>
          ))}
        </ul>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>Pause an account for 7 days</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Field value={addr} onChange={setAddr} placeholder="Wallet address 0x…" />
          <Field value={reason} onChange={setReason} placeholder="Reason (10+ characters)" />
        </div>
        <div className="flex gap-2 mt-2">
          {(['buy', 'sell', 'all'] as const).map((scope) => (
            <Btn key={scope} small kind="ghost" disabled={busy || !addr || reason.length < 10} onClick={() => void run(() => api('/staff/restrictions', { body: { address: addr.trim(), scope, reason, days: 7 } }), `Paused ${scope}`)}>
              Pause {scope === 'all' ? 'everything' : scope === 'buy' ? 'buying' : 'selling'}
            </Btn>
          ))}
        </div>
      </Card>

      <Card title="Listings waiting for review">
        {listings.data?.listings.length === 0 && <Empty text="Nothing waiting." />}
        <ul className="space-y-2">
          {listings.data?.listings.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--ink-2)' }}>{l.title} <span className="text-xs" style={{ color: 'var(--subtle)' }}>{short(l.seller)} · {l.reports} reports</span></span>
              <span className="flex gap-2">
                <Btn small disabled={busy} onClick={() => void run(() => api(`/staff/listings/${l.id}/decision`, { body: { approve: true, note: 'Reviewed and approved' } }), 'Listing approved')}>Approve</Btn>
                <Btn small kind="danger" disabled={busy} onClick={() => void run(() => api(`/staff/listings/${l.id}/decision`, { body: { approve: false, note: 'Removed after review' } }), 'Listing removed')}>Remove</Btn>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Payments needing attention">
        <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>You can re-check a payment against the network. You cannot change a payment record.</p>
        {orders.data?.orders.filter((o) => o.status === 'unverified' || o.status === 'failed').length === 0 && <Empty text="All payments are confirmed." />}
        <ul className="space-y-2">
          {orders.data?.orders.filter((o) => o.status === 'unverified' || o.status === 'failed').map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--ink-2)' }}>{o.title} · {o.amount_usdc} USDC <Pill text={o.status} tone={o.status === 'failed' ? 'bad' : 'warn'} /> <span className="text-xs" style={{ color: 'var(--subtle)' }}>{o.verify_note}</span></span>
              <Btn small kind="ghost" disabled={busy} onClick={() => void run(() => api(`/staff/orders/${o.id}/recheck`, { method: 'POST', body: {} }), 'Checked again')}>Re-check</Btn>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
