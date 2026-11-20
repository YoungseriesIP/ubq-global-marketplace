import { useEffect, useState } from 'react'
import { X, Copy, ExternalLink, Loader2, CheckCircle2, Droplets } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthContext'
import { useUsdcBalance } from '@/auth/payments'

const FAUCET_URL = 'https://faucet.circle.com'

interface FaucetModalProps {
  chainId: number
  onClose: () => void
}

/**
 * Free test USDC from Circle's public faucet. The faucet page itself is run by Circle;
 * this screen copies the user's address, opens it, and watches the balance so the user
 * can see the tokens arrive without leaving the marketplace.
 */
export function FaucetModal({ chainId, onClose }: FaucetModalProps) {
  const { user, openSignIn } = useAuth()
  const { balance, refresh } = useUsdcBalance(chainId)
  const [startBalance] = useState<number | null>(() => (balance === null ? null : Number(balance)))
  const [opened, setOpened] = useState(false)

  // After the faucet is opened, look for the new balance every few seconds.
  useEffect(() => {
    if (!opened) return
    const t = setInterval(() => refresh(), 5000)
    return () => clearInterval(t)
  }, [opened, refresh])

  const now = balance === null ? null : Number(balance)
  const arrived = opened && now !== null && (startBalance === null ? now > 0 : now > startBalance + 0.0001)

  async function copyAddress() {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.address)
      toast.success('Address copied')
    } catch {
      toast.error('Could not copy. Press and hold the address to copy it.')
    }
  }

  async function openFaucet() {
    if (user) {
      try { await navigator.clipboard.writeText(user.address) } catch { /* the address is shown below anyway */ }
    }
    window.open(FAUCET_URL, '_blank', 'noopener,noreferrer')
    setOpened(true)
    refresh()
    toast.message('Address copied. Paste it on the faucet page.')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(18,45,69,0.45)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div
        className="relative w-full sm:max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="display font-bold text-lg flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Droplets size={18} style={{ color: 'var(--accent)' }} /> Get free test USDC
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {!user ? (
            <>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Sign in first so we know which wallet to send the test money to.</p>
              <button
                onClick={() => { onClose(); openSignIn() }}
                className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
                Test USDC has no real value. Circle&apos;s free faucet sends 20 test USDC to your wallet, once every 2 hours. It also pays the small network fees.
              </p>

              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>Your wallet address</p>
                <button
                  onClick={() => void copyAddress()}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl text-left"
                  style={{ background: 'var(--surface)', border: '1.5px solid var(--border)' }}
                  aria-label="Copy wallet address"
                >
                  <span className="mono text-xs break-all" style={{ color: 'var(--ink)' }}>{user.address}</span>
                  <Copy size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
                </button>
              </div>

              <ol className="text-sm space-y-1.5 list-decimal pl-5" style={{ color: 'var(--ink-2)' }}>
                <li>Tap the button below. Your address is copied and Circle&apos;s faucet opens.</li>
                <li>Choose <strong>Arc Testnet</strong> and <strong>USDC</strong>.</li>
                <li>Paste your address and tap <strong>Send</strong>.</li>
                <li>Come back here. Your balance updates by itself.</li>
              </ol>

              <button
                onClick={() => void openFaucet()}
                className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                <ExternalLink size={15} /> Open Circle faucet
              </button>

              <div
                className="rounded-xl px-4 py-3 flex items-center justify-between text-sm"
                style={{ background: arrived ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)' }}
              >
                <span className="flex items-center gap-2" style={{ color: arrived ? 'var(--success)' : 'var(--muted)' }}>
                  {arrived ? <CheckCircle2 size={15} /> : opened ? <Loader2 size={15} className="animate-spin" /> : null}
                  {arrived ? 'Your test USDC arrived' : opened ? 'Waiting for the tokens…' : 'Your balance'}
                </span>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--ink)' }}>
                  {balance === null ? '…' : `${Number(balance).toFixed(2)} USDC`}
                </span>
              </div>

              {opened && !arrived && (
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Tokens usually arrive within a minute. If the faucet says &quot;limit exceeded&quot;, you already asked in the last 2 hours. Try again later.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
