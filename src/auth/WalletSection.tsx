import { useMemo, useState } from 'react'
import { Wallet, Loader2, AlertCircle, ExternalLink } from 'lucide-react'
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi'
import type { Connector } from 'wagmi'
import { useAuth } from './AuthContext'
import { walletErrorText } from './walletErrors'

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('wallet-timeout')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const PRIORITY = ['metamask', 'tabby', 'rabby', 'coinbase', 'trust', 'brave', 'okx']
const rank = (c: Connector) => {
  const key = `${c.id} ${c.name}`.toLowerCase()
  const i = PRIORITY.findIndex((p) => key.includes(p))
  return i === -1 ? PRIORITY.length : i
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function WalletSection({ agreed }: { agreed: boolean }) {
  const { signInWithWallet } = useAuth()
  const { address, isConnected, connector: active } = useAccount()
  const { connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const connectors = useConnectors()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { wallets, hasBrowserWallet } = useMemo(() => {
    const announced = connectors.filter((c) => c.id !== 'injected' && c.id !== 'walletConnect' && c.type === 'injected')
    const generic = connectors.find((c) => c.id === 'injected')
    const wc = connectors.find((c) => c.id === 'walletConnect')
    const browser = typeof window !== 'undefined' && 'ethereum' in window
    const list = [...announced].sort((a, b) => rank(a) - rank(b))
    if (list.length === 0 && browser && generic) list.push(generic)
    if (wc) list.push(wc)
    return { wallets: list, hasBrowserWallet: browser || announced.length > 0 }
  }, [connectors])

  async function run(key: string, action: () => Promise<void>) {
    setError('')
    setBusy(key)
    try { await action() } catch (e) { setError(walletErrorText(e)) } finally { setBusy(null) }
  }

  const pick = (c: Connector) => run(c.uid, async () => {
    let account = address
    if (!(isConnected && active?.uid === c.uid && account)) {
      try {
        const res = await withTimeout(connectAsync({ connector: c }), 90_000)
        account = res.accounts[0]
      } catch (e) {
        if ((e as { name?: string }).name !== 'ConnectorAlreadyConnectedError') throw e
      }
    }
    if (!account) throw new Error('Your wallet did not share an account. Unlock it and try again.')
    await signInWithWallet(account)
  })

  // Already connected from an earlier visit: one tap.
  if (isConnected && address) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => void run('continue', () => signInWithWallet(address))}
          disabled={!agreed || busy !== null}
          className="w-full min-h-[44px] py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
        >
          {busy === 'continue' ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
          Continue with {active?.name ?? 'wallet'} ({short(address)})
        </button>
        <button
          onClick={() => void disconnectAsync()}
          className="w-full text-xs underline"
          style={{ color: 'var(--muted)' }}
        >
          Use a different wallet
        </button>
        {error && <ErrorLine text={error} />}
      </div>
    )
  }

  const here = typeof window !== 'undefined' ? window.location.href : ''
  const host = here.replace(/^https?:\/\//, '')

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Or use a crypto wallet</p>

      {wallets.map((c) => (
        <button
          key={c.uid}
          onClick={() => void pick(c)}
          disabled={!agreed || busy !== null}
          className="w-full min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center gap-3 border transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
        >
          {c.icon ? (
            <img referrerPolicy="no-referrer" src={c.icon} alt="" width={24} height={24} className="rounded-md" />
          ) : (
            <Wallet size={20} />
          )}
          <span className="flex-1 text-left">{c.id === 'walletConnect' ? 'Other wallets (scan or open app)' : c.id === 'injected' ? 'Browser wallet' : c.name}</span>
          {busy === c.uid && <Loader2 size={16} className="animate-spin" />}
        </button>
      ))}

      {!hasBrowserWallet && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-muted)' }}>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            No wallet was found in this browser. On a phone, open this page inside your wallet app, or install a wallet extension on a computer.
          </p>
          <div className="flex flex-wrap gap-2">
            <DeepLink label="MetaMask" href={`https://metamask.app.link/dapp/${host}`} />
            <DeepLink label="Coinbase Wallet" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(here)}`} />
            <DeepLink label="Trust Wallet" href={`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(here)}`} />
          </div>
        </div>
      )}

      {!agreed && <p className="text-xs" style={{ color: 'var(--subtle)' }}>Tick the agreement above to continue.</p>}
      {error && <ErrorLine text={error} />}
    </div>
  )
}

function DeepLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
      style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)' }}
    >
      Open in {label} <ExternalLink size={11} />
    </a>
  )
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs p-3 rounded-xl" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
      <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span>{text}</span>
    </div>
  )
}
