import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Lock, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { Btn, Card, Field } from './ui'
import { AlertsTab, AuditTab, CasesTab, ConfigTab, IncidentsTab, OverviewTab, QueuesTab, TeamTab } from './StaffTabs'

interface Me {
  roles: string[]
  totp: { enrolled: boolean; enabled: boolean }
  configured: boolean
  elevated: boolean
  elevatedUntil: number
}

const TABS = ['Overview', 'Cases', 'Alerts', 'Queues', 'Incidents', 'Audit log', 'Settings', 'Team'] as const
type Tab = (typeof TABS)[number]

export function StaffConsole({ onBack }: { onBack: () => void }) {
  const { user, openSignIn } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const [code, setCode] = useState('')
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!user) return
    let live = true
    api<Me>('/staff/me').then((m) => { if (live) setMe(m) }).catch(() => { if (live) setMe(null) })
    return () => { live = false }
  }, [user, tick])

  const relock = useCallback(() => {
    setMe((m) => (m ? { ...m, elevated: false } : m))
  }, [])

  async function submitCode(activate: boolean) {
    setBusy(true)
    try {
      await api(activate ? '/staff/totp/confirm' : '/staff/elevate', { body: { code: code.trim() } })
      setCode('')
      setEnroll(null)
      setTick((t) => t + 1)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  async function startEnroll() {
    try {
      setEnroll(await api<{ secret: string; uri: string }>('/staff/totp/enroll', { method: 'POST', body: {} }))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start setup.')
    }
  }

  const head = (
    <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: 'var(--muted)' }}>
      <ArrowLeft size={15} /> Back
    </button>
  )

  if (!user) {
    return <div className="max-w-md mx-auto px-4 py-10">{head}<Btn onClick={openSignIn}>Sign in</Btn></div>
  }
  if (!me) return <div className="max-w-md mx-auto px-4 py-10">{head}<p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p></div>

  if (me.roles.length === 0) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        {head}
        <Card title="Staff console">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>This account does not have a staff role.</p>
        </Card>
      </div>
    )
  }

  if (!me.configured) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        {head}
        <Card title="Staff sign-in is not set up">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            The server needs an encryption key (APP_ENCRYPTION_KEY) before staff authenticators can be used. Add it to the server settings and redeploy.
          </p>
        </Card>
      </div>
    )
  }

  if (!me.elevated) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        {head}
        <Card title={me.totp.enabled ? 'Confirm it is you' : 'Set up your authenticator'}>
          <div className="space-y-3">
            <p className="text-sm flex items-start gap-2" style={{ color: 'var(--muted)' }}>
              <Lock size={14} className="mt-0.5 shrink-0" />
              Staff tools need a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy).
            </p>
            {!me.totp.enabled && !enroll && <Btn onClick={() => void startEnroll()}>Set up authenticator</Btn>}
            {enroll && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  In your authenticator app choose &quot;Enter a setup key&quot; and paste this key. Do not share it.
                </p>
                <p className="font-mono text-sm break-all select-all" style={{ color: 'var(--ink)' }}>{enroll.secret}</p>
              </div>
            )}
            {(me.totp.enabled || enroll) && (
              <>
                <Field value={code} onChange={setCode} placeholder="6-digit code" />
                <Btn disabled={busy || code.trim().length !== 6} onClick={() => void submitCode(!me.totp.enabled)}>
                  {me.totp.enabled ? 'Unlock staff tools' : 'Turn on and unlock'}
                </Btn>
              </>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {head}
      <h1 className="display font-bold text-2xl flex items-center gap-2 mb-1" style={{ color: 'var(--ink)' }}>
        <ShieldAlert size={22} style={{ color: 'var(--accent)' }} /> Staff console
      </h1>
      <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
        Roles: {me.roles.join(', ')}. Every action here is written to the audit log. Nothing here can edit a payment or the log itself.
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="shrink-0 min-h-[40px] px-4 rounded-full text-sm font-semibold border"
            style={tab === t
              ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }
              : { background: 'var(--surface-strong)', color: 'var(--ink-2)', borderColor: 'var(--border)' }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && <OverviewTab onLocked={relock} goto={(t) => setTab(t as Tab)} />}
      {tab === 'Cases' && <CasesTab onLocked={relock} />}
      {tab === 'Alerts' && <AlertsTab onLocked={relock} />}
      {tab === 'Queues' && <QueuesTab onLocked={relock} />}
      {tab === 'Incidents' && <IncidentsTab onLocked={relock} />}
      {tab === 'Audit log' && <AuditTab onLocked={relock} />}
      {tab === 'Settings' && <ConfigTab onLocked={relock} />}
      {tab === 'Team' && <TeamTab onLocked={relock} />}
    </div>
  )
}
