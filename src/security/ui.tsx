// Small shared pieces for the security screens, in the app's existing visual style.
import type { ReactNode } from 'react'

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border p-5" style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="display font-bold text-base" style={{ color: 'var(--ink)' }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Btn({
  children, onClick, kind = 'primary', disabled, small,
}: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; small?: boolean }) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#fff' },
    ghost: { background: 'var(--surface-muted)', color: 'var(--ink)' },
    danger: { background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' },
  }[kind]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${small ? 'min-h-[36px] px-3 text-xs' : 'min-h-[44px] px-4 text-sm'} rounded-xl font-bold active:scale-[0.98] disabled:opacity-50`}
      style={styles}
    >
      {children}
    </button>
  )
}

export function Field({
  value, onChange, placeholder, multiline, type = 'text',
}: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; type?: string }) {
  const common = {
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    className: 'w-full px-3 py-2.5 rounded-xl text-sm outline-none',
    style: { background: 'var(--surface)', color: 'var(--ink)', border: '1.5px solid var(--border)' },
  }
  return multiline ? <textarea rows={3} {...common} /> : <input type={type} {...common} />
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const t = {
    neutral: ['var(--surface-muted)', 'var(--muted)'],
    good: ['rgba(26,128,71,0.12)', 'var(--success)'],
    warn: ['rgba(245,158,11,0.14)', '#92400e'],
    bad: ['rgba(186,43,76,0.1)', 'var(--danger)'],
  }[tone]
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: t[0], color: t[1] }}>{text}</span>
}

export const when = (ms: number | null | undefined): string => (ms ? new Date(ms).toLocaleString() : 'unknown')
export const short = (a: string | null | undefined): string => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const sevTone = (s: string): 'neutral' | 'good' | 'warn' | 'bad' => (s === 'critical' || s === 'high' ? 'bad' : s === 'warn' || s === 'medium' ? 'warn' : 'neutral')
