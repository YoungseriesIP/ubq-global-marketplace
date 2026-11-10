import { useState } from 'react'
import { X, ExternalLink, CheckCircle, AlertCircle, Loader, ShieldCheck, Flag } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { useAuth } from '@/auth/AuthContext'
import { NeedsSignInError, useUsdcBalance, useWalletActions } from '@/auth/payments'
import { useCurrency } from '@/lib/currency'
import { api, ApiError } from '@/lib/api'
import type { Listing } from '../types'

interface BuyModalProps {
  listing: Listing
  onClose: () => void
}

function friendlyError(error: unknown): string {
  if (error instanceof NeedsSignInError) return error.message
  const msg = ((error as { message?: string })?.message ?? '').toLowerCase()
  if (msg.includes('user rejected') || msg.includes('denied') || msg.includes('cancel')) return 'Payment cancelled.'
  if (msg.includes('insufficient') || msg.includes('exceeds balance')) return 'Not enough USDC in your wallet.'
  if (msg.includes('connect the wallet')) return (error as Error).message
  if (msg.includes('network') || msg.includes('timeout')) return 'Network error. Please retry.'
  return 'The payment did not go through. Nothing was charged. Please try again.'
}

export function BuyModal({ listing, onClose }: BuyModalProps) {
  const { user, openSignIn, needsReauth, signOut } = useAuth()
  const { payUsdc, isCircle } = useWalletActions(listing.chainId)
  const { balance, refresh } = useUsdcBalance(listing.chainId)
  const { localText, rateText } = useCurrency()

  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'pending' | 'error'>('idle')
  const [orderId, setOrderId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [stepUp, setStepUp] = useState(false)
  const [checking, setChecking] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reportKind, setReportKind] = useState('counterfeit')
  const [reported, setReported] = useState(false)
  const [hash, setHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const priceUsdc = listing.priceUsdc ?? listing.price.toFixed(2)
  const local = localText(priceUsdc)
  const isOwnListing = !!user && user.address.toLowerCase() === listing.sellerAddress.toLowerCase()
  const hasEnough = balance === null || Number(balance) >= Number(priceUsdc)
  const processing = status === 'paying'
  const explorerUrl = hash ? buildTxExplorerUrl(listing.chainId, hash) : null

  function applyResult(r: { status: string; note: string }) {
    setNote(r.note)
    if (r.status === 'verified') setStatus('success')
    else if (r.status === 'failed') {
      setError(r.note)
      setStatus('error')
    } else setStatus('pending')
  }

  async function handleBuy() {
    if (!user) return
    setStatus('paying')
    setError(null)
    setStepUp(false)
    try {
      // 1. The server checks the purchase first (limits, restrictions, risk) and opens an order.
      const intent = await api<{ orderId: string; payTo: string; amountUsdc: string }>('/payments/precheck', {
        body: { listingId: listing.id },
      })
      setOrderId(intent.orderId)
      // 2. The buyer pays the seller directly.
      const txHash = await payUsdc(intent.payTo as `0x${string}`, intent.amountUsdc)
      setHash(txHash)
      refresh()
      // 3. The server confirms the payment on the network before anything is marked paid.
      applyResult(await api<{ status: string; note: string }>(`/payments/${intent.orderId}/confirm`, { body: { txHash } }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStepUp(true)
      setError(e instanceof ApiError ? e.message : friendlyError(e))
      setStatus('error')
    }
  }

  async function recheck() {
    if (!orderId) return
    setChecking(true)
    try {
      applyResult(await api<{ status: string; note: string }>(`/payments/${orderId}/recheck`, { method: 'POST', body: {} }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check right now.')
    } finally {
      setChecking(false)
    }
  }

  async function submitReport() {
    try {
      await api(`/listings/${listing.id}/report`, { body: { kind: reportKind } })
      setReported(true)
      setReporting(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the report.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(18,45,69,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={!processing ? onClose : undefined}
      />

      <div
        className="relative w-full sm:max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>
            {status === 'success' ? 'Purchase complete' : status === 'pending' ? 'Payment sent' : 'Confirm purchase'}
          </h2>
          {!processing && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {status === 'pending' ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.12)' }}>
                <Loader size={30} className={checking ? 'animate-spin' : ''} style={{ color: '#b45309' }} />
              </div>
              <div className="text-center">
                <p className="font-bold text-base" style={{ color: 'var(--ink)' }}>Waiting for the network</p>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  {note ?? 'Your payment was sent.'} It is only marked paid once we can confirm it, which is usually a few seconds.
                </p>
              </div>
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold hover:opacity-70" style={{ color: 'var(--accent-hover)' }}>
                  View transaction <ExternalLink size={13} />
                </a>
              )}
              {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
              <button onClick={() => void recheck()} disabled={checking} className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold active:scale-[0.98] disabled:opacity-60" style={{ background: 'var(--accent)', color: '#ffffff' }}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
              <button onClick={onClose} className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Close, I will check later in My Shop</button>
            </div>
          ) : status === 'success' ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(26,128,71,0.12)' }}>
                <CheckCircle size={32} style={{ color: 'var(--success)' }} />
              </div>
              <div className="text-center">
                <p className="font-bold text-base" style={{ color: 'var(--ink)' }}>Payment confirmed</p>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  {listing.sellerName ?? 'The seller'} has been paid {priceUsdc} USDC. We verified it on the network.
                </p>
              </div>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm font-semibold hover:opacity-70"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  View receipt <ExternalLink size={13} />
                </a>
              )}
              <button
                onClick={onClose}
                className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold active:scale-[0.98]"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-xl p-4" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--subtle)' }}>
                  You are buying
                </p>
                <p className="font-semibold text-sm line-clamp-1 mb-1" style={{ color: 'var(--ink)' }}>{listing.title}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  from {listing.sellerName ?? 'a seller'} in {listing.location}
                </p>
                {listing.sellerTrust && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {listing.sellerTrust.emailVerified && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
                        <ShieldCheck size={11} /> Email verified
                      </span>
                    )}
                    {listing.sellerTrust.trusted && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
                        <CheckCircle size={11} /> Trusted seller
                      </span>
                    )}
                    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                      {listing.sellerTrust.verifiedSales} verified {listing.sellerTrust.verifiedSales === 1 ? 'sale' : 'sales'}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>Total</span>
                  <span className="display font-bold text-2xl tabular-nums" style={{ color: 'var(--ink)' }}>
                    {local ?? `${priceUsdc} USDC`}
                  </span>
                </div>
                {local && (
                  <div className="flex items-center justify-end gap-1.5 mt-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                    <TokenUSDC variant="branded" size={13} />
                    Settles as {priceUsdc} USDC
                    {rateText() ? ` (${rateText()})` : ''}
                  </div>
                )}
              </div>

              {user && balance !== null && (
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
                  <span>Your balance</span>
                  <span className="tabular-nums font-semibold">{Number(balance).toFixed(2)} USDC</span>
                </div>
              )}

              {listing.isDemo && (
                <div className="rounded-xl px-4 py-3 flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.10)' }}>
                  <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: '#b45309' }} />
                  <p className="text-sm" style={{ color: '#92400e' }}>
                    This is a demo listing with no real seller, so it can&apos;t be bought. Try a listing from a real shop.
                  </p>
                </div>
              )}

              {isOwnListing && (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>This is your own listing.</p>
              )}

              {user && !listing.isDemo && !isOwnListing && !hasEnough && (
                <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(186,43,76,0.08)' }}>
                  <AlertCircle size={15} style={{ color: 'var(--danger)' }} />
                  <span className="text-sm" style={{ color: 'var(--danger)' }}>
                    Not enough USDC. Add test funds from the Arc Studio sidebar.
                  </span>
                </div>
              )}

              {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
              {stepUp && (
                <button
                  onClick={() => { void signOut().then(() => { onClose(); openSignIn() }) }}
                  className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold active:scale-[0.98]"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                >
                  Sign in again to continue
                </button>
              )}

              {!user ? (
                <button
                  onClick={() => { onClose(); openSignIn() }}
                  className="w-full min-h-[44px] py-3.5 rounded-xl text-sm font-bold active:scale-[0.98]"
                  style={{ background: 'var(--accent)', color: '#ffffff' }}
                >
                  Sign in to buy
                </button>
              ) : needsReauth ? (
                <button
                  onClick={() => { onClose(); openSignIn() }}
                  className="w-full min-h-[44px] py-3.5 rounded-xl text-sm font-bold active:scale-[0.98]"
                  style={{ background: 'var(--accent)', color: '#ffffff' }}
                >
                  Verify your account to pay
                </button>
              ) : (
                !listing.isDemo && !isOwnListing && (
                  <>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                        I understand this pays {priceUsdc} USDC directly to the seller and can&apos;t be reversed.
                      </span>
                    </label>

                    <button
                      onClick={() => void handleBuy()}
                      disabled={!confirmed || processing || !hasEnough}
                      className="w-full min-h-[44px] py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--accent)', color: '#ffffff' }}
                    >
                      {processing ? (
                        <>
                          <Loader size={15} className="animate-spin" />
                          {isCircle ? 'Approve with your PIN…' : 'Confirm in your wallet…'}
                        </>
                      ) : (
                        `Pay ${local ?? `${priceUsdc} USDC`}`
                      )}
                    </button>
                  </>
                )
              )}

              {user && !listing.isDemo && !isOwnListing && (
                <div className="pt-1">
                  {reported ? (
                    <p className="text-xs" style={{ color: 'var(--success)' }}>Thanks. We will review this listing.</p>
                  ) : reporting ? (
                    <div className="flex items-center gap-2">
                      <select value={reportKind} onChange={(e) => setReportKind(e.target.value)} className="flex-1 min-h-[40px] rounded-lg px-2 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>
                        <option value="counterfeit">Counterfeit or fake</option>
                        <option value="not_as_described">Not as described</option>
                        <option value="scam">Looks like a scam</option>
                        <option value="prohibited">Prohibited item</option>
                        <option value="other">Something else</option>
                      </select>
                      <button onClick={() => void submitReport()} className="min-h-[40px] px-3 rounded-lg text-sm font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Send</button>
                    </div>
                  ) : (
                    <button onClick={() => setReporting(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                      <Flag size={12} /> Report this listing
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
