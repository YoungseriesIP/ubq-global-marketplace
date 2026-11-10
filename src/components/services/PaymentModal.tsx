// ─── Payment Modal ─────────────────────────────────────────────────────────
// Three ways to pay a provider:
//   1. Direct USDC transfer
//   2. Escrow: funds are held by the ServiceEscrow contract until the customer confirms
//   3. Pay in person
// Works for both account types: email/Google users approve with their PIN in Circle's
// secure window, wallet users approve in their own wallet. See src/auth/payments.ts.

import { useState } from 'react'
import {
  X, Shield, CheckCircle, AlertTriangle, Loader2,
  ArrowRight, ExternalLink, Info, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Address } from 'viem'
import { buildTxExplorerUrl } from '../../onchain-facts'
import { useAuth } from '../../auth/AuthContext'
import { NeedsSignInError, useUsdcBalance, useWalletActions } from '../../auth/payments'
import { useCurrency } from '../../lib/currency'
import type { Booking } from '../../services/useBookings'
import type { BookingsStore } from '../../services/useBookings'

const SAFETY_TIPS_PAYMENT = [
  'Only release escrow funds after you are satisfied with the service.',
  'For visa consultants: never pay more than 30% upfront.',
  'Meet service providers in public for first-time in-person services.',
  'Keep all receipts and written agreements.',
  'If something feels wrong, open a dispute before releasing funds.',
]

interface PaymentModalProps {
  booking:      Booking
  bookingStore: BookingsStore
  onClose:      () => void
}

type FlowTab = 'usdc' | 'escrow' | 'in_person'
type Busy = null | 'pay' | 'deposit' | 'release' | 'claim' | 'dispute'

const AMOUNT_RE = /^\d{1,9}(\.\d{1,6})?$/

// Booking ID → bytes32 key for the escrow contract (SHA-256 of the booking id)
async function encodeBookingId(id: string): Promise<`0x${string}`> {
  const data = new TextEncoder().encode(id)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return ('0x' + Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

function friendlyError(e: unknown): string {
  if (e instanceof NeedsSignInError) return e.message
  const msg = ((e as { message?: string })?.message ?? '').toLowerCase()
  if (msg.includes('user rejected') || msg.includes('denied') || msg.includes('cancel')) return 'Cancelled. Nothing was charged.'
  if (msg.includes('insufficient') || msg.includes('exceeds balance')) return 'Not enough USDC in your wallet.'
  if (msg.includes('connect the wallet')) return (e as Error).message
  return 'That did not go through. Nothing was charged. Please try again.'
}

// ── Main component ────────────────────────────────────────────────────────

export function PaymentModal({ booking, bookingStore, onClose }: PaymentModalProps) {
  const { user, openSignIn, needsReauth, config } = useAuth()
  const chainId = config?.chainId ?? 5042002
  const { payUsdc, callEscrow, isCircle, escrowAddress } = useWalletActions(chainId)
  const { balance, refresh } = useUsdcBalance(chainId)
  const { localText } = useCurrency()

  const [amount, setAmount] = useState(booking.agreedAmount?.toString() ?? '')
  const [tab, setTab] = useState<FlowTab>(
    booking.paymentMethod === 'in_person' ? 'in_person'
    : booking.paymentMethod === 'escrow'  ? 'escrow'
    : 'usdc',
  )
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [payHash, setPayHash] = useState<`0x${string}` | undefined>()
  const [releaseDone, setReleaseDone] = useState(false)
  const [claimDone, setClaimDone] = useState(false)

  const amountValid = AMOUNT_RE.test(amount) && Number(amount) > 0
  const enough = balance === null || !amountValid || Number(balance) >= Number(amount)
  const providerWallet = booking.providerWallet as Address
  const localHint = amountValid ? localText(amount) : null

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      refresh()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const handleDirectPay = () => run('pay', async () => {
    const hash = await payUsdc(providerWallet, amount)
    setPayHash(hash)
    bookingStore.attachTx(booking.id, hash)
    bookingStore.completeBooking(booking.id)
  })

  const handleEscrowDeposit = () => run('deposit', async () => {
    if (!escrowAddress) return
    const bookingId = await encodeBookingId(booking.id)
    await callEscrow({ fn: 'approve', amountUsdc: amount })
    await callEscrow({ fn: 'deposit', bookingId, provider: providerWallet, amountUsdc: amount })
    bookingStore.attachEscrow(booking.id, escrowAddress)
    toast.success('Funds are now held in escrow')
  })

  const handleRelease = () => run('release', async () => {
    const bookingId = await encodeBookingId(booking.id)
    await callEscrow({ fn: 'release', bookingId, provider: providerWallet })
    bookingStore.completeBooking(booking.id)
    setReleaseDone(true)
  })

  const handleClaim = () => run('claim', async () => {
    await callEscrow({ fn: 'claim' })
    setClaimDone(true)
  })

  const handleDispute = () => run('dispute', async () => {
    const bookingId = await encodeBookingId(booking.id)
    await callEscrow({ fn: 'dispute', bookingId, counterparty: providerWallet })
    bookingStore.disputeBooking(booking.id, 'Raised by customer from payment screen.')
    toast.success('Dispute opened. Admin will review within 48 hours.')
    onClose()
  })

  const isLoading = busy !== null
  const signInBlock = !user ? (
    <button
      onClick={() => { onClose(); openSignIn() }}
      className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm"
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      Sign in to pay
    </button>
  ) : needsReauth ? (
    <button
      onClick={() => { onClose(); openSignIn() }}
      className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm"
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      Verify your account to pay
    </button>
  ) : null

  const tabs: Array<{ id: FlowTab; label: string }> = [
    { id: 'usdc',      label: 'Pay in USDC'   },
    { id: 'escrow',    label: 'Escrow'         },
    { id: 'in_person', label: 'Pay in Person'  },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={!isLoading ? onClose : undefined} />
      <div
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: 'var(--surface)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="display font-bold text-xl" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>Payment</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              {booking.serviceName} · {booking.providerName}
            </p>
          </div>
          {!isLoading && (
            <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl hover:opacity-70" style={{ color: 'var(--muted)' }}>
              <X size={20} />
            </button>
          )}
        </div>

        {/* Tab row */}
        <div className="flex border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null) }}
              className="flex-1 min-h-[44px] py-3 text-xs font-semibold transition-colors"
              style={{
                color: tab === t.id ? 'var(--accent)' : 'var(--muted)',
                borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <SafetyNoticeCollapsible />

          {error && <div className="mt-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}

          {/* ── USDC direct tab ─── */}
          {tab === 'usdc' && (
            <div className="space-y-4 mt-4">
              {payHash ? (
                <SuccessBlock
                  txHash={payHash}
                  message="Payment sent! The provider has received your USDC."
                  explorerBase={buildTxExplorerUrl(chainId, '')}
                />
              ) : (
                <>
                  <AmountInput amount={amount} setAmount={setAmount} currency="USDC" hint={localHint} />
                  <RecipientRow wallet={booking.providerWallet} />
                  {!enough && (
                    <p className="text-xs" style={{ color: 'var(--danger)' }}>Not enough USDC in your wallet.</p>
                  )}
                  {signInBlock ?? (
                    <button
                      onClick={() => void handleDirectPay()}
                      disabled={isLoading || !amountValid || !enough}
                      className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {busy === 'pay' && <Loader2 size={16} className="animate-spin" />}
                      {busy === 'pay' ? (isCircle ? 'Approve with your PIN…' : 'Confirm in your wallet…') : 'Pay now'}
                      {busy !== 'pay' && <ArrowRight size={16} />}
                    </button>
                  )}
                  <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                    USDC is sent directly to the provider. No escrow protection.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── Escrow tab ─── */}
          {tab === 'escrow' && (
            <div className="space-y-4 mt-4">
              <div className="rounded-xl px-4 py-3 flex items-start gap-2" style={{ background: 'rgba(16,97,166,0.07)', border: '1px solid rgba(16,97,166,0.20)' }}>
                <Shield size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} className="mt-0.5" />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                  Funds are locked in a smart contract and released to the provider only when you confirm completion. Either side can raise a dispute for admin review.
                </p>
              </div>

              {!escrowAddress ? (
                <div className="rounded-xl px-4 py-4 text-center" style={{ background: 'var(--surface-muted)', border: '1.5px dashed var(--border)' }}>
                  <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Escrow is not switched on yet</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Escrow turns on once the escrow contract is deployed. Use direct USDC or pay in person for now.
                  </p>
                </div>
              ) : booking.escrowAddress ? (
                <EscrowDepositedView
                  bookingId={booking.id}
                  escrowAddress={booking.escrowAddress}
                  releasePending={busy === 'release'}
                  releaseSuccess={releaseDone}
                  claimPending={busy === 'claim'}
                  claimSuccess={claimDone}
                  onRelease={() => void handleRelease()}
                  onClaim={() => void handleClaim()}
                  onDispute={() => void handleDispute()}
                  chainId={chainId}
                />
              ) : (
                <>
                  <AmountInput amount={amount} setAmount={setAmount} currency="USDC" hint={localHint} />
                  {!enough && (
                    <p className="text-xs" style={{ color: 'var(--danger)' }}>Not enough USDC in your wallet.</p>
                  )}
                  {signInBlock ?? (
                    <button
                      onClick={() => void handleEscrowDeposit()}
                      disabled={isLoading || !amountValid || !enough}
                      className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {busy === 'deposit' && <Loader2 size={16} className="animate-spin" />}
                      {busy === 'deposit' ? (isCircle ? 'Approve with your PIN…' : 'Confirm in your wallet…') : 'Deposit to escrow'}
                      {busy !== 'deposit' && <Shield size={15} />}
                    </button>
                  )}
                  <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
                    You will be asked to approve two steps: allow the escrow, then deposit.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── In-person tab ─── */}
          {tab === 'in_person' && (
            <div className="space-y-4 mt-4">
              <div className="rounded-xl px-4 py-3 flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} className="mt-0.5" />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                  Paying in person offers no platform protection. Only do this with providers you trust. Keep receipts and written agreements.
                </p>
              </div>

              <div className="rounded-xl px-4 py-4 border" style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>In-person payment tips</p>
                <ul className="space-y-2">
                  {SAFETY_TIPS_PAYMENT.map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
                      <CheckCircle size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => {
                  bookingStore.completeBooking(booking.id)
                  toast.success('Booking marked as paid in person.')
                  onClose()
                }}
                className="w-full min-h-[44px] py-3.5 rounded-xl font-bold text-sm active:scale-[0.98]"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
              >
                Mark as paid in person
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SafetyNoticeCollapsible() {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="rounded-xl border mb-2"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold"
        style={{ color: 'var(--ink-2)' }}
      >
        <span className="flex items-center gap-2">
          <Info size={12} style={{ color: 'var(--accent)' }} />
          Payment safety tips
        </span>
        <span style={{ color: 'var(--subtle)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
          {SAFETY_TIPS_PAYMENT.map((tip) => (
            <p key={tip} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--muted)' }}>
              <CheckCircle size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
              {tip}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function AmountInput({
  amount, setAmount, currency, hint,
}: { amount: string; setAmount: (v: string) => void; currency: string; hint?: string | null }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
        Amount ({currency})
      </label>
      <div className="flex items-center rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
        <span
          className="px-4 py-2.5 text-sm font-bold"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)', borderRight: '1px solid var(--border)' }}
        >
          {currency}
        </span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          min={0}
          step="0.01"
          className="flex-1 px-4 py-2.5 text-sm outline-none tabular-nums"
          style={{ background: 'var(--surface)', color: 'var(--ink)' }}
        />
      </div>
      {hint && (
        <p className="text-xs mt-1.5 tabular-nums" style={{ color: 'var(--muted)' }}>
          about {hint} in your currency
        </p>
      )}
    </div>
  )
}

function RecipientRow({ wallet }: { wallet: string }) {
  function copy() {
    void navigator.clipboard.writeText(wallet).then(() => toast.success('Address copied'))
  }
  return (
    <div>
      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Recipient</p>
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border"
        style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
      >
        <code className="flex-1 text-xs truncate mono" style={{ color: 'var(--ink)' }}>{wallet}</code>
        <button onClick={copy} className="shrink-0 transition-opacity hover:opacity-70" style={{ color: 'var(--muted)' }}>
          <Copy size={13} />
        </button>
      </div>
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const short = message.length > 120 ? message.slice(0, 120) + '…' : message
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-2"
      style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.20)' }}
    >
      <AlertTriangle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: 'var(--danger)' }}>{short}</p>
      </div>
      <button onClick={onDismiss} className="shrink-0 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
        ✕
      </button>
    </div>
  )
}

function SuccessBlock({
  txHash, message, explorerBase,
}: { txHash?: `0x${string}`; message: string; explorerBase: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(26,128,71,0.10)' }}>
        <CheckCircle size={28} style={{ color: 'var(--success)' }} />
      </div>
      <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{message}</p>
      {txHash && (
        <a
          href={`${explorerBase}${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          View on explorer <ExternalLink size={12} />
        </a>
      )}
    </div>
  )
}

function EscrowDepositedView({
  bookingId, escrowAddress,
  releasePending, releaseSuccess,
  claimPending, claimSuccess,
  onRelease, onClaim, onDispute, chainId,
}: {
  bookingId:      string
  escrowAddress:  string
  releasePending: boolean
  releaseSuccess: boolean
  claimPending:   boolean
  claimSuccess:   boolean
  onRelease:      () => void
  onClaim:        () => void
  onDispute:      () => void
  chainId:        number
}) {
  if (claimSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle size={28} style={{ color: 'var(--success)' }} />
        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>USDC claimed to your wallet!</p>
      </div>
    )
  }
  if (releaseSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <CheckCircle size={28} style={{ color: 'var(--success)' }} />
        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Funds released!</p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Booking #{bookingId.slice(0, 8)} complete. The provider can now claim their USDC.
        </p>
        {/* Provider sees a Claim button; customer sees a confirmation */}
        <div
          className="rounded-xl px-4 py-3 w-full"
          style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.20)' }}
        >
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            If you are the provider, click below to withdraw your USDC.
          </p>
          <button
            onClick={onClaim}
            disabled={claimPending}
            className="mt-2 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--success)', color: '#fff' }}
          >
            {claimPending && <Loader2 size={15} className="animate-spin" />}
            {claimPending ? 'Claiming…' : 'Claim Your USDC'}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {/* Escrow contract link */}
      <div className="rounded-xl px-4 py-3 border" style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Escrow contract</p>
        <a
          href={buildTxExplorerUrl(chainId, escrowAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono flex items-center gap-1 transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {escrowAddress.slice(0, 8)}…{escrowAddress.slice(-6)}
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Pull-model note */}
      <div
        className="rounded-xl px-3 py-2 flex items-start gap-2"
        style={{ background: 'rgba(16,97,166,0.06)', border: '1px solid rgba(16,97,166,0.15)' }}
      >
        <Info size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} className="mt-0.5" />
        <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
          After you release, the provider claims their USDC separately. Funds are never pushed — both parties pull when ready.
        </p>
      </div>

      <button
        onClick={onRelease}
        disabled={releasePending}
        className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'var(--success)', color: '#fff' }}
      >
        {releasePending && <Loader2 size={15} className="animate-spin" />}
        {releasePending ? 'Releasing…' : 'Release Funds — Service Complete ✓'}
      </button>

      <button
        onClick={onClaim}
        disabled={claimPending}
        className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 border"
        style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}
      >
        {claimPending && <Loader2 size={15} className="animate-spin" />}
        {claimPending ? 'Claiming…' : 'Claim Your USDC (provider)'}
      </button>

      <button
        onClick={onDispute}
        className="w-full py-3 rounded-xl font-semibold text-sm border transition-opacity hover:opacity-70"
        style={{ background: 'rgba(186,43,76,0.06)', color: 'var(--danger)', borderColor: 'rgba(186,43,76,0.25)' }}
      >
        Open a Dispute
      </button>
    </div>
  )
}
