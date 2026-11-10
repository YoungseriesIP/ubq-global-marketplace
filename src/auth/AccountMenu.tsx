import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, LogOut, Store, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from './AuthContext'
import { useUsdcBalance } from './payments'
import { useCurrency } from '@/lib/currency'

interface AccountMenuProps {
  chainId: number
  onOpenShop: () => void
}

export function AccountMenu({ chainId, onOpenShop }: AccountMenuProps) {
  const { user, signOut, needsReauth, openSignIn } = useAuth()
  const { balance } = useUsdcBalance(chainId)
  const { localText } = useCurrency()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!user) return null

  const label = user.shopName || user.displayName || `${user.address.slice(0, 6)}…${user.address.slice(-4)}`
  const initial = (label[0] ?? '?').toUpperCase()
  const local = balance !== null ? localText(balance) : null

  function copyAddress() {
    void navigator.clipboard.writeText(user?.address ?? '').then(() => toast.success('Wallet address copied'))
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 min-h-[44px] pl-1.5 pr-3 rounded-full border transition-all active:scale-[0.98]"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--ink)' }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {initial}
        </span>
        <span className="hidden sm:block text-sm font-semibold max-w-[110px] truncate">{label}</span>
        <ChevronDown size={14} style={{ color: 'var(--muted)' }} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-72 rounded-2xl overflow-hidden shadow-xl border z-50"
          style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
        >
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Balance</p>
            <p className="display font-bold text-2xl tabular-nums mt-1" style={{ color: 'var(--ink)' }}>
              {balance !== null ? `${Number(balance).toFixed(2)} USDC` : '—'}
            </p>
            {local && <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>about {local}</p>}
            {needsReauth && (
              <button
                onClick={() => { setOpen(false); openSignIn() }}
                className="mt-2 text-xs font-semibold"
                style={{ color: 'var(--accent-hover)' }}
              >
                Verify again to see your balance and pay
              </button>
            )}
          </div>

          <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Wallet size={12} /> Your wallet address
            </p>
            <button
              onClick={copyAddress}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-mono"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
            >
              <span className="truncate">{user.address}</span>
              <Copy size={12} className="shrink-0" />
            </button>
            <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--subtle)' }}>
              To add test money, use &quot;Get test USDC&quot; in the Arc Studio sidebar with this address.
            </p>
          </div>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); onOpenShop() }}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-left transition-opacity hover:opacity-80"
            style={{ color: 'var(--ink)' }}
          >
            <Store size={15} /> My shop
          </button>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); void signOut() }}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-left transition-opacity hover:opacity-80 border-t"
            style={{ color: 'var(--danger)', borderColor: 'var(--border)' }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
