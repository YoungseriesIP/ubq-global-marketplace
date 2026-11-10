// ─── Booking / Inquiry Request Modal ──────────────────────────────────────

import { useState } from 'react'
import { X, Calendar, Clock, Users, AlignLeft, Wallet, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { ServiceProvider } from '../../services/types'
import type { BookingsStore, PaymentMethod } from '../../services/useBookings'

// Stable date string computed once at module load — not inside render (purity)
const TODAY_ISO = new Date().toISOString().slice(0, 10)

interface BookingModalProps {
  provider:      ServiceProvider
  customerWallet: string
  bookingStore:  BookingsStore
  onClose:       () => void
  onGoToPayment?:(bookingId: string) => void
}

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string; desc: string }> = [
  { value: 'usdc',      label: 'Pay in USDC',    desc: 'Direct USDC transfer to provider\'s wallet after confirmation.' },
  { value: 'escrow',    label: 'Pay via Escrow',  desc: 'Funds held in a smart contract. Released when you confirm completion.' },
  { value: 'in_person', label: 'Pay in person',   desc: 'Cash or local payment method agreed with the provider.' },
  { value: 'other',     label: 'Discuss payment', desc: 'You and the provider will agree on payment when they accept.' },
]

export function BookingModal({
  provider, customerWallet, bookingStore, onClose, onGoToPayment,
}: BookingModalProps) {
  const isHotel = provider.categoryId === 'hotels-stays'

  // Form state
  const [serviceName, setServiceName] = useState(
    provider.services.length > 0 ? provider.services[0].name : '',
  )
  const [notes,          setNotes]        = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('escrow')
  const [agreedAmount,  setAgreedAmount]  = useState('')
  const [currency,      setCurrency]      = useState(
    provider.services.length > 0 ? (provider.services[0].currency ?? 'USD') : 'USD',
  )
  // Single-session date/time
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  // Hotel date range
  const [checkIn,  setCheckIn]  = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests,   setGuests]   = useState('1')

  const [submitted, setSubmitted] = useState(false)
  const [bookingId, setBookingId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!serviceName.trim()) e.service = 'Please specify a service.'
    if (isHotel) {
      if (!checkIn)  e.checkIn  = 'Check-in date required.'
      if (!checkOut) e.checkOut = 'Check-out date required.'
      if (checkIn && checkOut && checkIn >= checkOut) {
        e.checkOut = 'Check-out must be after check-in.'
      }
    } else {
      if (!date) e.date = 'Please pick a date.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return

    const booking = bookingStore.createBooking({
      providerId:     provider.id,
      providerWallet: provider.walletAddress,
      providerName:   provider.name,
      customerWallet,
      serviceName,
      notes,
      paymentMethod,
      agreedAmount:   agreedAmount ? Number(agreedAmount) : undefined,
      agreedCurrency: currency || undefined,
      ...(isHotel
        ? { dateRange: { checkIn, checkOut, guests: Number(guests) } }
        : { requestedDate: date, requestedTime: time }),
    })
    setBookingId(booking.id)
    setSubmitted(true)
    toast.success('Booking request sent!')
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-muted)',
    color: 'var(--ink)',
    border: '1.5px solid var(--border)',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: 'var(--surface)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div
          className="px-6 pt-6 pb-4 flex items-center justify-between shrink-0 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <h2 className="display font-bold text-xl" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {isHotel ? 'Book a Room' : 'Request a Service'}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{provider.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl transition-opacity hover:opacity-70" style={{ color: 'var(--muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {submitted ? (
            <SuccessScreen
              bookingId={bookingId}
              providerName={provider.name}
              paymentMethod={paymentMethod}
              onGoToPayment={onGoToPayment}
              onClose={onClose}
            />
          ) : (
            <>
              {/* Service */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                  Service requested *
                </label>
                {provider.services.length > 0 ? (
                  <select
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={inputStyle}
                  >
                    {provider.services.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                    <option value="other">Other (describe below)</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="Describe the service you need"
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{
                      ...inputStyle,
                      borderColor: errors.service ? 'var(--danger)' : 'var(--border)',
                    }}
                  />
                )}
                {errors.service && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.service}</p>}
              </div>

              {/* Date/time or hotel dates */}
              {isHotel ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Calendar size={12} /> Check-in *
                    </label>
                    <input
                      type="date"
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                      min={TODAY_ISO}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ ...inputStyle, borderColor: errors.checkIn ? 'var(--danger)' : 'var(--border)' }}
                    />
                    {errors.checkIn && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.checkIn}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Calendar size={12} /> Check-out *
                    </label>
                    <input
                      type="date"
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                      min={checkIn || TODAY_ISO}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ ...inputStyle, borderColor: errors.checkOut ? 'var(--danger)' : 'var(--border)' }}
                    />
                    {errors.checkOut && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.checkOut}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Users size={12} /> Guests
                    </label>
                    <input
                      type="number"
                      value={guests}
                      onChange={(e) => setGuests(e.target.value)}
                      min={1}
                      max={20}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none tabular-nums"
                      style={inputStyle}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Calendar size={12} /> Date *
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      min={TODAY_ISO}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ ...inputStyle, borderColor: errors.date ? 'var(--danger)' : 'var(--border)' }}
                    />
                    {errors.date && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.date}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Clock size={12} /> Time (optional)
                    </label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}

              {/* Budget */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                    Your budget (optional)
                  </label>
                  <input
                    type="number"
                    value={agreedAmount}
                    onChange={(e) => setAgreedAmount(e.target.value)}
                    placeholder="Amount"
                    min={0}
                    step={1}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none tabular-nums"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={inputStyle}
                  >
                    {['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                  <AlignLeft size={12} /> Notes for the provider
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe your requirements, any special requests, measurements, colour preferences…"
                  rows={3}
                  maxLength={800}
                  className="w-full px-3 py-2.5 rounded-xl text-sm resize-none outline-none"
                  style={inputStyle}
                />
                {notes.length > 600 && (
                  <p className="text-xs text-right mt-0.5" style={{ color: 'var(--subtle)' }}>{notes.length}/800</p>
                )}
              </div>

              {/* Payment method */}
              <div>
                <label className="block text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                  <Wallet size={12} /> Preferred payment method
                </label>
                <div className="space-y-2">
                  {PAYMENT_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all"
                      style={{
                        background: paymentMethod === opt.value ? 'rgba(16,97,166,0.08)' : 'var(--surface-muted)',
                        border: `1.5px solid ${paymentMethod === opt.value ? 'rgba(16,97,166,0.30)' : 'var(--border)'}`,
                      }}
                    >
                      <input
                        type="radio"
                        value={opt.value}
                        checked={paymentMethod === opt.value}
                        onChange={() => setPaymentMethod(opt.value)}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <div>
                        <p className="font-semibold text-xs" style={{ color: 'var(--ink)' }}>{opt.label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Escrow note */}
              {paymentMethod === 'escrow' && (
                <div
                  className="rounded-xl px-4 py-3 flex items-start gap-2"
                  style={{ background: 'rgba(16,97,166,0.06)', border: '1px solid rgba(16,97,166,0.20)' }}
                >
                  <CheckCircle size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} className="mt-0.5" />
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                    Funds are held in a smart contract and released only when you confirm the service is complete. Recommended for orders over $50 or when working with a new provider.
                  </p>
                </div>
              )}

              {/* Visa agent safety */}
              {provider.categoryId === 'visa-immigration' && (
                <div
                  className="rounded-xl px-4 py-3 flex items-start gap-2"
                  style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.20)' }}
                >
                  <span className="text-base shrink-0 mt-0.5">⚠️</span>
                  <div>
                    <p className="text-xs font-bold mb-0.5" style={{ color: 'var(--danger)' }}>Important: Visa Consultant Safety</p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                      Never pay more than 20–30% upfront to any visa consultant. Use escrow where possible. Fake documents and forged visas are illegal and will result in a permanent ban.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div
            className="px-6 py-4 border-t shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <button
              onClick={handleSubmit}
              className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Send Booking Request
            </button>
            <p className="text-xs text-center mt-2" style={{ color: 'var(--subtle)' }}>
              The provider will accept, decline, or propose an alternative time.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Success screen ────────────────────────────────────────────────────────

function SuccessScreen({
  bookingId, providerName, paymentMethod, onGoToPayment, onClose,
}: {
  bookingId:      string
  providerName:   string
  paymentMethod:  PaymentMethod
  onGoToPayment?: (bookingId: string) => void
  onClose:        () => void
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(26,128,71,0.10)' }}
      >
        <CheckCircle size={32} style={{ color: 'var(--success)' }} />
      </div>
      <div>
        <h3 className="display font-bold text-xl mb-1" style={{ color: 'var(--ink)' }}>Request Sent!</h3>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Your booking request has been sent to <strong>{providerName}</strong>.
          They will respond to accept, decline, or propose an alternative.
        </p>
      </div>
      <div
        className="w-full rounded-xl px-4 py-3 text-left"
        style={{ background: 'var(--surface-muted)', border: '1.5px solid var(--border)' }}
      >
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>Booking reference</p>
        <p className="text-xs font-mono" style={{ color: 'var(--ink)' }}>{bookingId}</p>
      </div>
      {paymentMethod === 'usdc' && onGoToPayment && (
        <button
          onClick={() => onGoToPayment(bookingId)}
          className="w-full py-3 rounded-xl font-bold text-sm"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Pay in USDC once accepted
        </button>
      )}
      {paymentMethod === 'escrow' && onGoToPayment && (
        <button
          onClick={() => onGoToPayment(bookingId)}
          className="w-full py-3 rounded-xl font-bold text-sm"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Set up Escrow once accepted
        </button>
      )}
      <button
        onClick={onClose}
        className="text-sm font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'var(--muted)' }}
      >
        Close
      </button>
    </div>
  )
}
