import { useState } from 'react'
import { api } from '@/lib/api'
import { Btn, Card, Field, Pill, sevTone, short, when } from './ui'
import { useStaffAction, useStaffData } from './useStaffData'

interface TabProps { onLocked: () => void }
const Empty = ({ text }: { text: string }) => <p className="text-sm" style={{ color: 'var(--muted)' }}>{text}</p>

// ── Incidents ────────────────────────────────────────────────────────────
interface Incident { id: string; title: string; severity: string; status: string; description: string; created_at: number }
interface IncidentDetail { incident: Incident; notes: Array<{ id: string; author: string; body: string; at: number }> }

export function IncidentsTab({ onLocked }: TabProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useStaffData<{ incidents: Incident[] }>('/staff/incidents', onLocked)
  const detail = useStaffData<IncidentDetail>(openId ? `/staff/incidents/${openId}` : null, onLocked)
  const { run, busy } = useStaffAction(onLocked, () => { list.reload(); detail.reload() })
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [sev, setSev] = useState('medium')
  const [note, setNote] = useState('')

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card title="Security incidents">
        <div className="space-y-2 mb-4">
          <Field value={title} onChange={setTitle} placeholder="What happened? (short title)" />
          <Field multiline value={desc} onChange={setDesc} placeholder="Details" />
          <div className="flex gap-2">
            <select value={sev} onChange={(e) => setSev(e.target.value)} className="text-sm rounded-lg px-2" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
              {['low', 'medium', 'high', 'critical'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <Btn small disabled={busy || !title.trim()} onClick={() => void run(async () => { await api('/staff/incidents', { body: { title, description: desc, severity: sev } }); setTitle(''); setDesc('') }, 'Incident opened')}>Open incident</Btn>
          </div>
        </div>
        {list.data?.incidents.length === 0 && <Empty text="No incidents recorded." />}
        <ul className="space-y-2">
          {list.data?.incidents.map((i) => (
            <li key={i.id}>
              <button onClick={() => setOpenId(i.id)} className="w-full text-left rounded-xl p-3" style={{ border: '1px solid var(--border)', background: openId === i.id ? 'var(--surface-muted)' : 'transparent' }}>
                <div className="flex items-center gap-2"><Pill text={i.severity} tone={sevTone(i.severity)} /><Pill text={i.status} /></div>
                <p className="text-sm font-semibold mt-1" style={{ color: 'var(--ink)' }}>{i.title}</p>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>{i.id} · {when(Number(i.created_at))}</p>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={openId ? `Incident ${openId}` : 'Select an incident'}>
        {!detail.data || !openId ? <Empty text="Open an incident to follow its history." /> : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{detail.data.incident.description || 'No details.'}</p>
            <ul className="space-y-2">
              {detail.data.notes.map((n) => (
                <li key={n.id} className="rounded-lg p-2 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>{short(n.author)} · {when(Number(n.at))}</span>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
            <Field multiline value={note} onChange={setNote} placeholder="Add an update" />
            <div className="flex flex-wrap gap-2">
              <Btn small disabled={busy || !note.trim()} onClick={() => void run(async () => { await api(`/staff/incidents/${openId}/notes`, { body: { body: note } }); setNote('') }, 'Update added')}>Add update</Btn>
              {['investigating', 'contained', 'resolved'].map((s) => (
                <Btn key={s} small kind="ghost" disabled={busy} onClick={() => void run(() => api(`/staff/incidents/${openId}`, { method: 'PATCH', body: { status: s } }), `Marked ${s}`)}>{s}</Btn>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Audit log ────────────────────────────────────────────────────────────
interface Entry { id: number; at: number; actor: string; action: string; target: string; details: string }

export function AuditTab({ onLocked }: TabProps) {
  const [before, setBefore] = useState<number | undefined>(undefined)
  const { data, error } = useStaffData<{ entries: Entry[] }>(`/staff/audit${before ? `?before=${before}` : ''}`, onLocked)
  const [verdict, setVerdict] = useState<string | null>(null)
  const { run, busy } = useStaffAction(onLocked, () => undefined)

  return (
    <Card title="Audit log" right={
      <Btn small kind="ghost" disabled={busy} onClick={() => void run(async () => {
        const v = await api<{ ok: boolean; entries: number; brokenAtId?: number }>('/staff/audit/verify')
        setVerdict(v.ok ? `Chain intact across ${v.entries} entries.` : `Chain broken at entry ${v.brokenAtId}. Treat as a security incident.`)
      }, 'Checked')}>Verify chain</Btn>
    }>
      {verdict && <p className="text-sm mb-3 font-semibold" style={{ color: verdict.startsWith('Chain intact') ? 'var(--success)' : 'var(--danger)' }}>{verdict}</p>}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <ul className="space-y-2">
        {data?.entries.map((e) => (
          <li key={e.id} className="text-sm rounded-lg p-2" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
            <span className="font-semibold">{e.action}</span> <span className="font-mono text-xs">{short(e.actor)} → {e.target.length > 14 ? short(e.target) : e.target}</span>
            <span className="block text-xs" style={{ color: 'var(--subtle)' }}>#{e.id} · {when(e.at)}</span>
          </li>
        ))}
      </ul>
      {data && data.entries.length === 50 && (
        <div className="mt-3"><Btn small kind="ghost" onClick={() => setBefore(data.entries[data.entries.length - 1].id)}>Older entries</Btn></div>
      )}
      <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
        Entries are chained by hash and the database refuses edits and deletes, so changes are detectable. There is no way to edit this log from the app.
      </p>
    </Card>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────
interface Cfg {
  thresholds: { stepUp: number; blocked: number; review: number }
  limits: Record<string, { single: number; daily: number }>
  prohibitedTerms: string[]
  [k: string]: unknown
}

export function ConfigTab({ onLocked }: TabProps) {
  const { data, error, reload } = useStaffData<{ config: Cfg }>('/staff/config', onLocked)
  if (error) return <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
  if (!data) return <Empty text="Loading…" />
  return <ConfigForm key={JSON.stringify(data.config.thresholds) + data.config.prohibitedTerms.length} cfg={data.config} onLocked={onLocked} reload={reload} />
}

function ConfigForm({ cfg, onLocked, reload }: { cfg: Cfg; onLocked: () => void; reload: () => void }) {
  const { run, busy } = useStaffAction(onLocked, reload)
  const [t, setT] = useState(cfg.thresholds)
  const [limits, setLimits] = useState(cfg.limits)
  const [terms, setTerms] = useState(cfg.prohibitedTerms.join(', '))
  const [reason, setReason] = useState('')
  const num = (v: string) => Math.max(0, Number(v) || 0)

  return (
    <div className="space-y-4">
      <Card title="Risk thresholds (0 to 100)">
        <div className="grid grid-cols-3 gap-2">
          {(['stepUp', 'blocked', 'review'] as const).map((k) => (
            <label key={k} className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
              {k === 'stepUp' ? 'Ask to sign in again' : k === 'blocked' ? 'Pause this action' : 'Hold for review'}
              <Field type="number" value={String(t[k])} onChange={(v) => setT({ ...t, [k]: num(v) })} />
            </label>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Each must be higher than the one before. Automatic holds last one day and can be appealed.</p>
      </Card>
      <Card title="Payment limits by verification level (USDC)">
        <p className="text-xs mb-2" style={{ color: 'var(--subtle)' }}>These are starting defaults, not legal limits. Set them with your compliance advice for each country.</p>
        <div className="space-y-2">
          {Object.entries(limits).map(([lvl, l]) => (
            <div key={lvl} className="grid grid-cols-3 gap-2 items-center">
              <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Level {lvl}</span>
              <Field type="number" value={String(l.single)} onChange={(v) => setLimits({ ...limits, [lvl]: { ...l, single: num(v) } })} placeholder="per payment" />
              <Field type="number" value={String(l.daily)} onChange={(v) => setLimits({ ...limits, [lvl]: { ...l, daily: num(v) } })} placeholder="per day" />
            </div>
          ))}
        </div>
      </Card>
      <Card title="Prohibited wording">
        <Field multiline value={terms} onChange={setTerms} placeholder="comma separated" />
        <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Listings that contain these words are held for a person to review. They are not rejected automatically.</p>
      </Card>
      <Card title="Save changes">
        <Field value={reason} onChange={setReason} placeholder="Why are you changing this? (required)" />
        <div className="mt-3">
          <Btn disabled={busy || reason.trim().length < 10} onClick={() => void run(
            () => api('/staff/config', {
              method: 'PUT',
              body: {
                reason,
                config: { ...cfg, thresholds: t, limits, prohibitedTerms: terms.split(',').map((x) => x.trim()).filter(Boolean) },
              },
            }),
            'Saved. If a second admin exists, they must approve it under Team.',
          )}>Save settings</Btn>
        </div>
      </Card>
    </div>
  )
}

// ── Team and approvals ───────────────────────────────────────────────────
interface Team { bootstrap: string[]; staff: Array<{ address: string; role: string; totp: boolean; created_at: number }> }
interface Req { id: string; action: string; payload: string; reason: string; requested_by: string; status: string; created_at: number }

export function TeamTab({ onLocked }: TabProps) {
  const team = useStaffData<Team>('/staff/team', onLocked)
  const reqs = useStaffData<{ requests: Req[] }>('/staff/requests', onLocked)
  const { run, busy } = useStaffAction(onLocked, () => { team.reload(); reqs.reload() })
  const [address, setAddress] = useState('')
  const [role, setRole] = useState('support')
  const [reason, setReason] = useState('')

  return (
    <div className="space-y-4">
      <Card title="Waiting for a second admin">
        {reqs.data?.requests.filter((r) => r.status === 'pending').length === 0 && <Empty text="Nothing is waiting." />}
        <ul className="space-y-2">
          {reqs.data?.requests.filter((r) => r.status === 'pending').map((r) => (
            <li key={r.id} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{r.action}</p>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Asked by {short(r.requested_by)} · {when(Number(r.created_at))}</p>
              <p className="text-sm my-1" style={{ color: 'var(--ink-2)' }}>{r.reason}</p>
              <p className="font-mono text-xs break-all mb-2" style={{ color: 'var(--muted)' }}>{r.payload.slice(0, 300)}</p>
              <div className="flex gap-2">
                <Btn small disabled={busy} onClick={() => void run(() => api(`/staff/requests/${r.id}/approve`, { method: 'POST', body: {} }), 'Approved and applied')}>Approve</Btn>
                <Btn small kind="danger" disabled={busy} onClick={() => void run(() => api(`/staff/requests/${r.id}/reject`, { method: 'POST', body: {} }), 'Rejected')}>Reject</Btn>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>You cannot approve your own request.</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Staff">
        <ul className="space-y-2 mb-4">
          {team.data?.bootstrap.map((a) => <li key={a} className="text-sm" style={{ color: 'var(--ink-2)' }}><span className="font-mono">{short(a)}</span> <Pill text="admin (server setting)" tone="good" /></li>)}
          {team.data?.staff.map((s) => (
            <li key={s.address} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--ink-2)' }}><span className="font-mono">{short(s.address)}</span> <Pill text={s.role} /> {s.totp ? <Pill text="authenticator on" tone="good" /> : <Pill text="no authenticator yet" tone="warn" />}</span>
              <span className="flex gap-2">
                <Btn small kind="ghost" disabled={busy || reason.trim().length < 5} onClick={() => void run(() => api('/staff/team/reset-totp', { body: { address: s.address, reason } }), 'Authenticator reset requested')}>Reset authenticator</Btn>
                <Btn small kind="danger" disabled={busy || reason.trim().length < 5} onClick={() => void run(() => api('/staff/team/revoke', { body: { address: s.address, reason } }), 'Access removal requested')}>Remove</Btn>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>Give someone a role</p>
        <div className="grid sm:grid-cols-3 gap-2">
          <Field value={address} onChange={setAddress} placeholder="Wallet address 0x…" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl px-3 text-sm min-h-[44px]" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}>
            {['support', 'compliance', 'finance', 'admin'].map((r) => <option key={r}>{r}</option>)}
          </select>
          <Field value={reason} onChange={setReason} placeholder="Reason (required)" />
        </div>
        <div className="mt-2">
          <Btn small disabled={busy || !address.trim() || reason.trim().length < 5} onClick={() => void run(() => api('/staff/team/grant', { body: { address: address.trim(), role, reason } }), 'Role change requested')}>Grant role</Btn>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
          Support reads cases and alerts. Compliance runs cases, restrictions and appeals. Finance reads payments and the audit log. Admin manages settings and staff.
          With two or more admins, role and settings changes need the other admin to approve.
        </p>
      </Card>
    </div>
  )
}
