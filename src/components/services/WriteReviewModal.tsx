// ─── WriteReviewModal ─────────────────────────────────────────────────────────
// Multi-step review form:
//   Step 0 – Interaction gate: user must have contacted/booked or "I contacted them"
//   Step 1 – Star rating + written review
//   Step 2 – Sub-ratings (hotel or visa) if applicable
//   Step 3 – Optional photo URLs
//   Step 4 – Confirmation + submit

import { useState } from 'react'
import { X, Star, Camera, AlertCircle, Check } from 'lucide-react'
import { toast } from 'sonner'
import type { ServiceProvider } from '../../services/types'
import type { ReviewsStore, HotelSubRatings, VisaSubRatings } from '../../services/useReviews'
import type { KycStore } from '../../services/useKyc'

// ─── Props ────────────────────────────────────────────────────────────────────

interface WriteReviewModalProps {
  provider:      ServiceProvider
  reviewerWallet: string
  reviewerName:  string
  reviewStore:   ReviewsStore
  kycStore:      KycStore
  onClose:       () => void
}

// ─── Sub-rating input component ───────────────────────────────────────────────

function SubRatingInput({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium w-36 shrink-0" style={{ color: 'var(--ink-2)' }}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="transition-transform hover:scale-110 active:scale-95"
          >
            <Star
              size={22}
              fill={n <= value ? '#f59e0b' : 'none'}
              style={{ color: n <= value ? '#f59e0b' : 'var(--border-strong)' }}
            />
          </button>
        ))}
        {value > 0 && (
          <span className="ml-1 text-xs font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>
            {value}/5
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function WriteReviewModal({
  provider, reviewerWallet, reviewerName, reviewStore, kycStore, onClose,
}: WriteReviewModalProps) {
  const isHotel = provider.categoryId === 'hotels-stays'
  const isVisa  = provider.categoryId === 'visa-immigration'
  const totalSteps = isHotel || isVisa ? 4 : 3

  const [step,          setStep]          = useState(0)
  const [interactionId, setInteractionId] = useState<string | null>(null)
  const [selfDeclared,  setSelfDeclared]  = useState(false)

  // Step 1
  const [rating,   setRating]   = useState(0)
  const [hoverRating, setHover] = useState(0)
  const [body,     setBody]     = useState('')

  // Step 2 — hotel
  const [hotelSub, setHotelSub] = useState<HotelSubRatings>({
    cleanliness: 0, location: 0, value: 0, service: 0,
  })

  // Step 2 — visa
  const [visaSub, setVisaSub] = useState<VisaSubRatings>({
    communication: 0, honesty: 0, outcome: 0, value: 0, resultDelivered: 'yes',
  })

  // Step 3 — photos
  const [photoInput, setPhotoInput] = useState('')
  const [photoUrls,  setPhotoUrls]  = useState<string[]>([])

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)

  // ── Guards ────────────────────────────────────────────────────────────────

  // KYC guard
  const kycRecord = kycStore.getRecord(reviewerWallet)
  if (kycRecord?.status !== 'verified') {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
          <AlertCircle size={36} style={{ color: 'var(--danger)' }} />
          <div>
            <p className="font-bold text-base mb-1" style={{ color: 'var(--ink)' }}>
              KYC required to leave reviews
            </p>
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              Complete identity verification first. This prevents fake reviews and protects everyone on the platform.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Got it
          </button>
        </div>
      </Backdrop>
    )
  }

  // Already reviewed guard
  if (reviewStore.hasReviewed(provider.id, reviewerWallet)) {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
          <Check size={36} style={{ color: 'var(--success)' }} />
          <div>
            <p className="font-bold text-base mb-1" style={{ color: 'var(--ink)' }}>
              You have already reviewed this provider
            </p>
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              One review per interaction is allowed to keep ratings fair.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Close
          </button>
        </div>
      </Backdrop>
    )
  }

  // ── Step 0 — Interaction gate ─────────────────────────────────────────────

  const existingInteraction = reviewStore.interactions.find(
    (i) =>
      i.providerId === provider.id &&
      i.customerWallet.toLowerCase() === reviewerWallet.toLowerCase() &&
      !i.reviewed,
  )

  function handleInteractionConfirm() {
    if (existingInteraction) {
      setInteractionId(existingInteraction.id)
    } else if (selfDeclared) {
      // Record a self-declared interaction (unverified flag will be false)
      const id = reviewStore.recordInteraction(provider.id, reviewerWallet, 'inquiry')
      setInteractionId(id)
    }
    setStep(1)
  }

  // ── Step validation ───────────────────────────────────────────────────────

  const step1Valid = rating >= 1 && body.trim().length >= 20

  const step2Valid = (() => {
    if (isHotel) {
      return hotelSub.cleanliness > 0 && hotelSub.location > 0 &&
             hotelSub.value > 0 && hotelSub.service > 0
    }
    if (isVisa) {
      return visaSub.communication > 0 && visaSub.honesty > 0 &&
             visaSub.outcome > 0 && visaSub.value > 0
    }
    return true
  })()

  function addPhoto() {
    const url = photoInput.trim()
    if (!url || photoUrls.length >= 4) return
    setPhotoUrls((prev) => [...prev, url])
    setPhotoInput('')
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!interactionId) return
    setSubmitting(true)

    reviewStore.submitReview({
      providerId:          provider.id,
      reviewerWallet,
      reviewerName,
      rating,
      body:                body.trim(),
      photoUrls,
      verifiedInteraction: !!existingInteraction,
      interactionRef:      interactionId,
      hotelSubRatings:     isHotel ? hotelSub : undefined,
      visaSubRatings:      isVisa  ? visaSub  : undefined,
    })

    setTimeout(() => {
      setSubmitting(false)
      setSubmitted(true)
    }, 600)
  }

  if (submitted) {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(26,128,71,0.12)' }}
          >
            <Check size={28} style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <p className="font-bold text-lg mb-1 display" style={{ color: 'var(--ink)' }}>
              Review submitted!
            </p>
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              Thank you. Your review helps other customers make informed decisions.
            </p>
          </div>
          <button
            onClick={() => { toast.success('Review posted!'); onClose() }}
            className="px-6 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Done
          </button>
        </div>
      </Backdrop>
    )
  }

  return (
    <Backdrop onClose={onClose}>
      {/* Step indicator */}
      <div className="flex items-center gap-1.5 justify-center mb-5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all"
            style={{
              width:      i <= step - 1 ? '24px' : '8px',
              background: i <= step - 1 ? 'var(--accent)' : 'var(--border-strong)',
            }}
          />
        ))}
      </div>

      {/* ── Step 0: Interaction gate ── */}
      {step === 0 && (
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Have you used this service?
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            Only people who have contacted or booked <strong>{provider.name}</strong> through this platform can leave a review. This keeps ratings trustworthy.
          </p>

          {existingInteraction ? (
            <div
              className="rounded-xl px-4 py-3 mb-5 flex items-center gap-3"
              style={{ background: 'rgba(26,128,71,0.08)' }}
            >
              <Check size={16} style={{ color: 'var(--success)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                  Verified interaction found
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Your {existingInteraction.type} is on record. Your review will show a "Verified customer" badge.
                </p>
              </div>
            </div>
          ) : (
            <label className="flex items-start gap-3 cursor-pointer mb-5 select-none">
              <input
                type="checkbox"
                checked={selfDeclared}
                onChange={(e) => setSelfDeclared(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[var(--accent)]"
              />
              <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
                I confirm I contacted or used this service. My review will not show a "Verified customer" badge but I certify this is an honest, genuine review.
              </span>
            </label>
          )}

          <button
            onClick={handleInteractionConfirm}
            disabled={!existingInteraction && !selfDeclared}
            className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-40 transition-all active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Step 1: Star rating + written review ── */}
      {step === 1 && (
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Rate your experience
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            How would you rate <strong>{provider.name}</strong> overall?
          </p>

          {/* Star picker */}
          <div className="flex items-center justify-center gap-2 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110 active:scale-95"
              >
                <Star
                  size={36}
                  fill={n <= (hoverRating || rating) ? '#f59e0b' : 'none'}
                  style={{ color: n <= (hoverRating || rating) ? '#f59e0b' : 'var(--border-strong)' }}
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-center text-xs font-semibold mb-4" style={{ color: 'var(--muted)' }}>
              {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][rating]}
            </p>
          )}

          {/* Written review */}
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Your review <span style={{ color: 'var(--muted)' }}>(min 20 characters)</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Tell others about your experience with ${provider.name}…`}
            rows={5}
            maxLength={1200}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none mb-1"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1.5px solid var(--border)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
            onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <div className="flex justify-between mb-5">
            <span className="text-xs" style={{ color: body.length < 20 ? 'var(--danger)' : 'var(--subtle)' }}>
              {body.length < 20 ? `${20 - body.length} more characters required` : `${body.length}/1200`}
            </span>
          </div>

          <StepNav
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextDisabled={!step1Valid}
            nextLabel={isHotel || isVisa ? 'Next: Sub-ratings' : 'Next: Add photos'}
          />
        </div>
      )}

      {/* ── Step 2: Sub-ratings (hotel or visa) ── */}
      {step === 2 && (isHotel || isVisa) && (
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {isHotel ? 'Rate specific aspects' : 'Rate the consultation'}
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            {isHotel
              ? 'Help future guests with detailed scores for each aspect of their stay.'
              : 'These specific ratings help others choose a trustworthy consultant.'}
          </p>

          {isHotel && (
            <div className="space-y-4 mb-6">
              <SubRatingInput label="Cleanliness"  value={hotelSub.cleanliness} onChange={(v) => setHotelSub((p) => ({ ...p, cleanliness: v }))} />
              <SubRatingInput label="Location"     value={hotelSub.location}    onChange={(v) => setHotelSub((p) => ({ ...p, location: v }))}    />
              <SubRatingInput label="Value"        value={hotelSub.value}       onChange={(v) => setHotelSub((p) => ({ ...p, value: v }))}       />
              <SubRatingInput label="Service"      value={hotelSub.service}     onChange={(v) => setHotelSub((p) => ({ ...p, service: v }))}     />
            </div>
          )}

          {isVisa && (
            <div className="space-y-4 mb-5">
              <SubRatingInput label="Communication" value={visaSub.communication} onChange={(v) => setVisaSub((p) => ({ ...p, communication: v }))} />
              <SubRatingInput label="Honesty"        value={visaSub.honesty}       onChange={(v) => setVisaSub((p) => ({ ...p, honesty: v }))}       />
              <SubRatingInput label="Outcome"        value={visaSub.outcome}       onChange={(v) => setVisaSub((p) => ({ ...p, outcome: v }))}       />
              <SubRatingInput label="Value"          value={visaSub.value}         onChange={(v) => setVisaSub((p) => ({ ...p, value: v }))}         />

              <div>
                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>
                  Did the service deliver the result promised?
                </p>
                <div className="flex gap-2">
                  {(['yes', 'partial', 'no'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setVisaSub((p) => ({ ...p, resultDelivered: opt }))}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        background: visaSub.resultDelivered === opt
                          ? opt === 'yes' ? 'rgba(26,128,71,0.12)' : opt === 'partial' ? 'rgba(217,119,6,0.12)' : 'rgba(186,43,76,0.12)'
                          : 'var(--surface-muted)',
                        color: visaSub.resultDelivered === opt
                          ? opt === 'yes' ? 'var(--success)' : opt === 'partial' ? '#d97706' : 'var(--danger)'
                          : 'var(--ink-2)',
                        borderColor: visaSub.resultDelivered === opt
                          ? opt === 'yes' ? 'rgba(26,128,71,0.3)' : opt === 'partial' ? 'rgba(217,119,6,0.3)' : 'rgba(186,43,76,0.3)'
                          : 'var(--border)',
                      }}
                    >
                      {opt === 'yes' ? 'Yes' : opt === 'partial' ? 'Partially' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <StepNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!step2Valid}
            nextLabel="Next: Add photos"
          />
        </div>
      )}

      {/* ── Step 3 / final before confirm: Add photos ── */}
      {step === (isHotel || isVisa ? 3 : 2) && (
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Add photos <span className="font-normal text-base" style={{ color: 'var(--muted)' }}>(optional)</span>
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            Share up to 4 photos to help others. Paste image URLs below.
          </p>

          {photoUrls.length < 4 && (
            <div className="flex gap-2 mb-4">
              <input
                type="url"
                value={photoInput}
                onChange={(e) => setPhotoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhoto() } }}
                placeholder="Paste an image URL…"
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button
                onClick={addPhoto}
                disabled={!photoInput.trim()}
                className="px-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                <Camera size={16} />
              </button>
            </div>
          )}

          {photoUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {photoUrls.map((url, i) => (
                <div key={i} className="relative">
                  <img referrerPolicy="no-referrer" src={url} alt="" className="w-20 h-20 object-cover rounded-xl" />
                  <button
                    onClick={() => setPhotoUrls((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ background: 'var(--danger)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <StepNav
            onBack={() => setStep(isHotel || isVisa ? 2 : 1)}
            onNext={handleSubmit}
            loading={submitting}
            nextLabel="Submit Review"
            nextAccent
          />
        </div>
      )}
    </Backdrop>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Backdrop({
  children, onClose,
}: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
            Write a Review
          </p>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function StepNav({
  onBack, onNext, nextDisabled, nextLabel, loading, nextAccent,
}: {
  onBack:       () => void
  onNext:       () => void
  nextDisabled?: boolean
  nextLabel?:   string
  loading?:     boolean
  nextAccent?:  boolean
}) {
  return (
    <div className="flex gap-3 mt-2">
      <button
        onClick={onBack}
        className="flex-1 py-3 rounded-xl text-sm font-semibold border transition-all"
        style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
      >
        Back
      </button>
      <button
        onClick={onNext}
        disabled={nextDisabled || loading}
        className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-40 transition-all active:scale-[0.98]"
        style={{
          background: nextAccent ? 'var(--accent)' : 'var(--accent)',
          color: '#fff',
        }}
      >
        {loading ? 'Submitting…' : (nextLabel ?? 'Next')}
      </button>
    </div>
  )
}
