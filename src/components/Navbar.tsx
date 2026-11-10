import { Globe, Package, ShieldCheck, LogIn } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AccountMenu } from '@/auth/AccountMenu'
import { CURRENCY_OPTIONS, useCurrency } from '@/lib/currency'

export type AppView = 'marketplace' | 'my-listings' | 'services'

function CurrencyPicker() {
  const { currency, isManual, setCurrency } = useCurrency()
  const options = CURRENCY_OPTIONS.includes(currency) ? CURRENCY_OPTIONS : [currency, ...CURRENCY_OPTIONS]
  return (
    <label className="flex items-center">
      <span className="sr-only">Display currency</span>
      <select
        value={isManual ? currency : `auto:${currency}`}
        onChange={(e) => setCurrency(e.target.value.startsWith('auto:') ? null : e.target.value)}
        className="min-h-[44px] px-2 rounded-xl text-sm font-semibold outline-none border"
        style={{ background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}
      >
        <option value={`auto:${currency}`}>{currency} (auto)</option>
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  )
}

interface NavbarProps {
  onSell:    () => void
  view:      AppView
  setView:   (v: AppView) => void
  isAdmin?:  boolean
  onAdmin?:  () => void
}

export function Navbar({ onSell, view, setView, isAdmin, onAdmin }: NavbarProps) {
  const { user, loading, openSignIn, config } = useAuth()
  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md border-b"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent)' }}
          >
            <Globe size={16} color="white" />
          </div>
          <span className="display font-bold text-lg" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            TradePort
          </span>
        </div>

        {/* Nav tabs */}
        <nav className="hidden sm:flex items-center gap-1">
          <button
            onClick={() => setView('marketplace')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: view === 'marketplace' ? 'var(--surface-muted)' : 'transparent',
              color: view === 'marketplace' ? 'var(--ink)' : 'var(--muted)',
            }}
          >
            Marketplace
          </button>
          <button
            onClick={() => setView('services')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: view === 'services' ? 'var(--surface-muted)' : 'transparent',
              color: view === 'services' ? 'var(--ink)' : 'var(--muted)',
            }}
          >
            Services
          </button>
          <button
            onClick={() => setView('my-listings')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: view === 'my-listings' ? 'var(--surface-muted)' : 'transparent',
              color: view === 'my-listings' ? 'var(--ink)' : 'var(--muted)',
            }}
          >
            My Listings
          </button>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button
            onClick={onSell}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--accent)',
              color: '#ffffff',
            }}
            onMouseOver={(e) => {
              (e.currentTarget).style.background = 'var(--accent-hover)'
            }}
            onMouseOut={(e) => {
              (e.currentTarget).style.background = 'var(--accent)'
            }}
          >
            <Package size={15} />
            Sell Item
          </button>
          {isAdmin && (
            <button
              onClick={onAdmin}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}
              title="Admin Panel"
            >
              <ShieldCheck size={14} /> Admin
            </button>
          )}
          <CurrencyPicker />
          {user ? (
            <AccountMenu chainId={config?.chainId ?? 5042002} onOpenShop={() => setView('my-listings')} />
          ) : (
            <button
              onClick={openSignIn}
              disabled={loading}
              className="flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold border transition-all active:scale-95 disabled:opacity-60"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <LogIn size={15} /> Sign in
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      <div
        className="sm:hidden flex border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => setView('marketplace')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{ color: view === 'marketplace' ? 'var(--accent)' : 'var(--muted)' }}
        >
          Marketplace
        </button>
        <button
          onClick={() => setView('services')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{ color: view === 'services' ? 'var(--accent)' : 'var(--muted)' }}
        >
          Services
        </button>
        <button
          onClick={() => setView('my-listings')}
          className="flex-1 py-2 text-xs font-medium transition-colors"
          style={{ color: view === 'my-listings' ? 'var(--accent)' : 'var(--muted)' }}
        >
          My Listings
        </button>
        <button
          onClick={onSell}
          className="flex-1 py-2 text-xs font-semibold transition-colors"
          style={{ color: 'var(--accent)' }}
        >
          + Sell
        </button>
      </div>
    </header>
  )
}
