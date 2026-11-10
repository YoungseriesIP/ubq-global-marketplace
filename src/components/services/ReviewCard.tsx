// ─── ReviewCard ───────────────────────────────────────────────────────────────
// Single review row: star rating, body, optional photos, hotel/visa sub-ratings,
// provider reply (read-only for non-provider), report button.

import { useState } from 'react'
import { Star, ShieldCheck, Flag, MessageSquare, ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { Review, HotelSubRatings, VisaSubRatings } from '../../services/useReviews'

// ─── Shared tiny components ───────────────────────────────────────────────────

export function StarRow({
  rating, size = 14,
}: { rating: number; size?: number }) {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={size}
          fill={i < full || (i === full && half) ? '#f59e0b' : 'none'}
          style={{ color: i < full || (i === full && half) ? '#f59e0b' : 'var(--border-strong)' }}
        />
      ))}
    </span>
  )
}

// ─── Sub-rating bar ───────────────────────────────────────────────────────────

function SubRatingRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-muted)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / 5) * 100}%`, background: '#f59e0b' }}
        />
      </div>
      <span className="w-6 text-right font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
        {value.toFixed(1)}
      </span>
    </div>
  )
}

// ─── Hotel sub-ratings display ────────────────────────────────────────────────

function HotelSubRatingsBlock({ sub }: { sub: HotelSubRatings }) {
  return (
    <div className="mt-3 space-y-1.5 pl-1">
      <SubRatingRow label="Cleanliness"  value={sub.cleanliness} />
      <SubRatingRow label="Location"     value={sub.location}    />
      <SubRatingRow label="Value"        value={sub.value}       />
      <SubRatingRow label="Service"      value={sub.service}     />
    </div>
  )
}

// ─── Visa sub-ratings display ─────────────────────────────────────────────────

function VisaSubRatingsBlock({ sub }: { sub: VisaSubRatings }) {
  const resultLabel =
    sub.resultDelivered === 'yes'     ? 'Yes — result delivered as promised'
    : sub.resultDelivered === 'partial' ? 'Partially delivered'
    : 'No — result not delivered'

  const resultColor =
    sub.resultDelivered === 'yes'     ? 'var(--success)'
    : sub.resultDelivered === 'partial' ? '#d97706'
    : 'var(--danger)'

  return (
    <div className="mt-3 space-y-1.5 pl-1">
      <SubRatingRow label="Communication" value={sub.communication} />
      <SubRatingRow label="Honesty"        value={sub.honesty}       />
      <SubRatingRow label="Outcome"        value={sub.outcome}       />
      <SubRatingRow label="Value"          value={sub.value}         />
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Result delivered?</span>
        <span className="text-xs font-semibold" style={{ color: resultColor }}>{resultLabel}</span>
      </div>
    </div>
  )
}

// ─── ReviewCard ───────────────────────────────────────────────────────────────

interface ReviewCardProps {
  review:           Review
  /** Wallet address of the currently connected user — for reply and report actions */
  viewerWallet?:    string
  /** Wallet address of the provider — only they can reply */
  providerWallet?:  string
  onReply?:         (reviewId: string, body: string) => void
  onReport?:        (reviewId: string) => void
  isAdmin?:         boolean
  onAdminHide?:     (reviewId: string) => void
}

export function ReviewCard({
  review, viewerWallet, providerWallet, onReply, onReport, isAdmin, onAdminHide,
}: ReviewCardProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [replyBody,     setReplyBody]     = useState('')
  const [showPhotos,    setShowPhotos]    = useState(false)
  const [reported,      setReported]      = useState(false)

  const isProvider  = !!viewerWallet && !!providerWallet &&
    viewerWallet.toLowerCase() === providerWallet.toLowerCase()
  const alreadyReported = !!viewerWallet &&
    review.reportedBy.includes(viewerWallet.toLowerCase())
  const timeAgo = formatTimeAgo(review.createdAt)

  function handleReport() {
    if (alreadyReported || reported) return
    onReport?.(review.id)
    setReported(true)
  }

  function handleReply() {
    if (!replyBody.trim()) return
    onReply?.(review.id, replyBody.trim())
    setReplyBody('')
    setShowReplyForm(false)
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {/* Avatar initial */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm text-white"
            style={{ background: stringToColor(review.reviewerName) }}
          >
            {review.reviewerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                {review.reviewerName}
              </span>
              {review.verifiedInteraction && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}
                >
                  <ShieldCheck size={10} />
                  Verified customer
                </span>
              )}
            </div>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>{timeAgo}</span>
          </div>
        </div>

        {/* Rating + admin actions */}
        <div className="flex items-center gap-2 shrink-0">
          <StarRow rating={review.rating} size={13} />
          <span className="font-bold tabular-nums text-sm" style={{ color: 'var(--ink)' }}>
            {review.rating.toFixed(1)}
          </span>
          {isAdmin && onAdminHide && (
            <button
              onClick={() => onAdminHide(review.id)}
              className="text-xs px-2 py-0.5 rounded-lg font-semibold"
              style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}
            >
              Hide
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--ink-2)' }}>
        {review.body}
      </p>

      {/* Hotel sub-ratings */}
      {review.hotelSubRatings && <HotelSubRatingsBlock sub={review.hotelSubRatings} />}

      {/* Visa sub-ratings */}
      {review.visaSubRatings && <VisaSubRatingsBlock sub={review.visaSubRatings} />}

      {/* Photos */}
      {review.photoUrls.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowPhotos(!showPhotos)}
            className="flex items-center gap-1 text-xs font-semibold mb-2 transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            {showPhotos ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {review.photoUrls.length} photo{review.photoUrls.length > 1 ? 's' : ''}
          </button>
          {showPhotos && (
            <div className="flex flex-wrap gap-2">
              {review.photoUrls.map((url, i) => (
                <img referrerPolicy="no-referrer"
                  key={i}
                  src={url}
                  alt={`Review photo ${i + 1}`}
                  className="w-20 h-20 object-cover rounded-xl"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Provider reply */}
      {review.providerReply && (
        <div
          className="mt-4 rounded-xl p-3 flex gap-3"
          style={{ background: 'var(--surface-muted)', borderLeft: '3px solid var(--accent)' }}
        >
          <MessageSquare size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-xs font-bold mb-1" style={{ color: 'var(--accent)' }}>
              Provider reply · {formatTimeAgo(review.providerReply.repliedAt)}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {review.providerReply.body}
            </p>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        {/* Provider: reply button (only once, only if no reply yet) */}
        {isProvider && !review.providerReply && onReply && (
          <button
            onClick={() => setShowReplyForm(!showReplyForm)}
            className="flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent)' }}
          >
            <MessageSquare size={12} />
            Reply
          </button>
        )}

        {/* Non-provider: report button */}
        {!isProvider && viewerWallet && onReport && (
          <button
            onClick={handleReport}
            disabled={alreadyReported || reported}
            className="flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: reported || alreadyReported ? 'var(--subtle)' : 'var(--muted)' }}
          >
            {reported || alreadyReported
              ? <><Check size={11} /> Reported</>
              : <><Flag size={11} /> Report</>
            }
          </button>
        )}

        {/* Spacer when no buttons */}
        {!isProvider && !viewerWallet && <span />}
      </div>

      {/* Reply form */}
      {showReplyForm && isProvider && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a professional reply…"
            rows={3}
            maxLength={600}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1.5px solid var(--border)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
            onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>
              {replyBody.length}/600
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReplyForm(false); setReplyBody('') }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleReply}
                disabled={replyBody.trim().length < 5}
                className="px-4 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Post Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** Deterministic colour from a name string */
function stringToColor(str: string): string {
  const PALETTE = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
    '#14b8a6', '#0ea5e9', '#84cc16', '#ef4444',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
