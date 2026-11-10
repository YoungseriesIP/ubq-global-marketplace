import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { Btn, Card, Field, Pill, sevTone, when } from './ui'

interface Status {
  level: number
  limits: { single: number; daily: number }
  verification: string
  restrictions: Array<{ id: string; scope: string; reason: string; expiresAt: number | null; auto: boolean; appealed: boolean }>
  appeals: Array<{ id: string; restrictionId: string; status: string; note: string | null; createdAt: number }>
}
interface Sess { id: string; current: boolean; device: string; createdAt: number | null; lastSeen: number | null }
interface Evt { id: string; at: number; kind: string; severity: string }

const EVENT_TEXT: Record<string, string> = {
  login: 'Signed in',
  new_device_login: 'Sign-in from a new device',
  login_failed: 'Failed sign-in attempt',
  session_revoked: 'A session was signed out',
  sessions_revoked_all: 'Other sessions were signed out',
  risk_review: 'A payment was held for review',
  listing_held: 'A listing was held for review',
  payment_mismatch: 'A payment did not match its order',
  duplicate_payment: 'A payment was used twice',
  shared_device: 'This device is used by several accounts',
  data_deletion_requested: 'Data deletion requested',
}

export function SecurityPage({ onBack }: { onBack: () => void }) {
  const { user, openSignIn, signOut } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [sessions, setSessions] = useState<Sess[]>([])
  const [events, setEvents] = useState<Evt[]>([])
  const [appealFor, setAppealFor] = useState<string | null>(null)
  const [appealText, setAppealText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, se, ev] = await Promise.all([
      api<Status>('/security/status'),
      api<{ sessions: Sess[] }>('/security/sessions'),
      api<{ events: Evt[] }>('/security/events'),
    ])
    setStatus(s)
    setSessions(se.sessions)
    setEvents(ev.events)
  }, [])

  useEffect(() => {
    if (!user) return
    let live = true
    Promise.all([
      api<Status>('/security/status'),
      api<{ sessions: Sess[] }>('/security/sessions'),
      api<{ events: Evt[] }>('/security/events'),
    ])
      .then(([s, se, ev]) => {
        if (!live) return
        setStatus(s)
        setSessions(se.sessions)
        setEvents(ev.events)
      })
      .catch(() => { /* shown as empty */ })
    return () => { live = false }
  }, [user])

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function exportData() {
    try {
      const data = await api<unknown>('/security/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'my-marketplace-data.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not export your data.')
    }
  }

  const head = (
    <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: 'var(--muted)' }}>
      <ArrowLeft size={15} /> Back
    </button>
  )

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {head}
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>Sign in to see your security settings.</p>
        <Btn onClick={openSignIn}>Sign in</Btn>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      {head}
      <h1 className="display font-bold text-2xl flex items-center gap-2" style={{ color: 'var(--ink)' }}>
        <ShieldCheck size={22} style={{ color: 'var(--accent)' }} /> Security
      </h1>

      {status && (
        <Card title="Your verification and limits">
          <p className="text-sm mb-2" style={{ color: 'var(--ink-2)' }}>
            Level {status.level}: {status.verification}.
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            You can pay up to {status.limits.single} USDC at a time and {status.limits.daily} USDC per day. Higher limits need identity
            verification, which is not switched on yet.
          </p>
        </Card>
      )}

      {status && status.restrictions.length > 0 && (
        <Card title="Restrictions on your account">
          <ul className="space-y-3">
            {status.restrictions.map((r) => (
              <li key={r.id} className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Pill text={r.scope === 'all' ? 'Buying and selling' : r.scope === 'buy' ? 'Buying' : 'Selling'} tone="warn" />
                  <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                    {r.expiresAt ? `until ${when(r.expiresAt)}` : 'until reviewed'}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{r.reason}</p>
                {r.appealed ? (
                  <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Your appeal is waiting for a reviewer.</p>
                ) : appealFor === r.id ? (
                  <div className="mt-3 space-y-2">
                    <Field multiline value={appealText} onChange={setAppealText} placeholder="Tell us what happened (at least 20 characters)" />
                    <div className="flex gap-2">
                      <Btn small disabled={busy || appealText.trim().length < 20} onClick={() => void act(async () => {
                        await api('/security/appeals', { body: { restrictionId: r.id, message: appealText.trim() } })
                        setAppealFor(null)
                        setAppealText('')
                      }, 'Appeal sent')}>Send appeal</Btn>
                      <Btn small kind="ghost" onClick={() => setAppealFor(null)}>Cancel</Btn>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2"><Btn small kind="ghost" onClick={() => setAppealFor(r.id)}>Appeal this</Btn></div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {status && status.appeals.length > 0 && (
        <Card title="Your appeals">
          <ul className="space-y-2">
            {status.appeals.map((a) => (
              <li key={a.id} className="text-sm flex flex-wrap items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                <Pill text={a.status} tone={a.status === 'accepted' ? 'good' : a.status === 'rejected' ? 'bad' : 'neutral'} />
                <span>{when(a.createdAt)}</span>
                {a.note && <span style={{ color: 'var(--muted)' }}>{a.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Where you are signed in"
        right={sessions.length > 1 ? (
          <Btn small kind="ghost" disabled={busy} onClick={() => void act(() => api('/security/sessions/revoke-others', { method: 'POST', body: {} }), 'Other sessions signed out')}>
            Sign out all others
          </Btn>
        ) : undefined}
      >
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-start gap-3 rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
              <MonitorSmartphone size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
                  {s.device} {s.current && <Pill text="This device" tone="good" />}
                </p>
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>Last active {when(s.lastSeen ?? s.createdAt)}</p>
              </div>
              {!s.current && (
                <Btn small kind="danger" disabled={busy} onClick={() => void act(() => api(`/security/sessions/${s.id}`, { method: 'DELETE' }), 'Signed out')}>
                  Sign out
                </Btn>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent activity">
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing to show yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.slice(0, 15).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                  <Pill text={e.severity} tone={sevTone(e.severity)} /> {EVENT_TEXT[e.kind] ?? e.kind}
                </span>
                <span className="text-xs shrink-0" style={{ color: 'var(--subtle)' }}>{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
          If you see a sign-in you do not recognise, sign out all other sessions. Alerts by email turn on once real email sending is set up.
        </p>
      </Card>

      <Card title="Your data">
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
          We never store identity documents. You can download what we hold about you, or ask us to delete your profile data.
          Payment records are kept for the legally required period.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn kind="ghost" onClick={() => void exportData()}><span className="inline-flex items-center gap-1.5"><Download size={14} /> Download my data</span></Btn>
          <Btn kind="ghost" disabled={busy} onClick={() => void act(() => api('/security/delete-request', { method: 'POST', body: {} }), 'Deletion request sent to our team')}>
            Ask to delete my data
          </Btn>
          <Btn kind="danger" onClick={() => void signOut()}><span className="inline-flex items-center gap-1.5"><LogOut size={14} /> Sign out here</span></Btn>
        </div>
      </Card>
    </div>
  )
}
