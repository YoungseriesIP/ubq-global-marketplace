// ─── ReviewsSection ────────────────────────────────────────────────────────────
// Full reviews block for a provider profile:
//  • Aggregate stats: average, count, distribution bars
//  • Hotel sub-rating averages (cleanliness/location/value/service)
//  • Visa sub-rating averages + result-delivered percentage
//  • Scrollable review list with load-more pagination
//  • "Write a Review" CTA gated by KYC and interaction

import { useState } from 'react'
import { Star, PenLine, ChevronDown } from 'lucide-react'
import { WriteReviewModal } from './WriteReviewModal'
import { ReviewCard, StarRow } from './ReviewCard'
import type { ServiceProvider } from '../../services/types'
import type { ReviewsStore, ReviewAggregate } from '../../services/useReviews'
import type { KycStore } from '../../services/useKyc'

const PAGE_SIZE = 5

// ─── Props ────────────────────────────────────────────────────────────────────

interface ReviewsSectionProps {
  provider:      ServiceProvider
  reviewStore:   ReviewsStore
  kycStore:      KycStore
  viewerWallet?: string
  viewerName?:   string
  isAdmin?:      boolean
}

// ─── Distribution bar ─────────────────────────────────────────────────────────

function DistBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-3 text-right tabular-nums" style={{ color: 'var(--ink-2)' }}>{star}</span>
      <Star size={11} fill="#f59e0b" style={{ color: '#f59e0b', flexShrink: 0 }} />
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-muted)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: '#f59e0b' }}
        />
      </div>
      <span className="w-5 text-right tabular-nums" style={{ color: 'var(--subtle)' }}>{count}</span>
    </div>
  )
}

// ─── Average score card ───────────────────────────────────────────────────────

function AverageCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col items-center gap-1 p-3 rounded-xl"
      style={{ background: 'var(--surface-muted)' }}
    >
      <span className="tabular-nums font-bold text-lg display" style={{ color: 'var(--ink)' }}>
        {value.toFixed(1)}
      </span>
      <span className="text-xs text-center" style={{ color: 'var(--muted)' }}>{label}</span>
      <div className="flex justify-center">
        <StarRow rating={value} size={10} />
      </div>
    </div>
  )
}

// ─── Aggregate header ─────────────────────────────────────────────────────────

function AggregateHeader({ agg, isHotel, isVisa }: {
  agg: ReviewAggregate
  isHotel: boolean
  isVisa:  boolean
}) {
  if (agg.count === 0) {
    return (
      <div
        className="rounded-2xl p-5 text-center border"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <p className="font-semibold text-sm" style={{ color: 'var(--ink-2)' }}>No reviews yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Be the first to leave an honest review.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-5 border mb-4"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start gap-6 flex-wrap">
        {/* Big average */}
        <div className="flex flex-col items-center gap-1">
          <span
            className="tabular-nums font-bold text-5xl display"
            style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
          >
            {agg.average.toFixed(1)}
          </span>
          <StarRow rating={agg.average} size={16} />
          <span className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {agg.count} {agg.count === 1 ? 'review' : 'reviews'}
          </span>
        </div>

        {/* Distribution bars */}
        <div className="flex-1 min-w-[140px] space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((s) => (
            <DistBar key={s} star={s} count={agg.distribution[s]} total={agg.count} />
          ))}
        </div>
      </div>

      {/* Hotel sub-averages */}
      {isHotel && agg.hotelAverages && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
            Average scores
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <AverageCard label="Cleanliness" value={agg.hotelAverages.cleanliness} />
            <AverageCard label="Location"    value={agg.hotelAverages.location}    />
            <AverageCard label="Value"       value={agg.hotelAverages.value}       />
            <AverageCard label="Service"     value={agg.hotelAverages.service}     />
          </div>
        </div>
      )}

      {/* Visa sub-averages */}
      {isVisa && agg.visaAverages && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
            Average scores
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <AverageCard label="Communication" value={agg.visaAverages.communication} />
            <AverageCard label="Honesty"        value={agg.visaAverages.honesty}       />
            <AverageCard label="Outcome"        value={agg.visaAverages.outcome}       />
            <AverageCard label="Value"          value={agg.visaAverages.value}         />
          </div>
          {agg.resultDeliveredPct !== undefined && (
            <div
              className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{
                background: agg.resultDeliveredPct >= 70
                  ? 'rgba(26,128,71,0.08)'
                  : 'rgba(186,43,76,0.08)',
              }}
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
                Result delivered as promised
              </span>
              <span
                className="font-bold tabular-nums text-lg display"
                style={{
                  color: agg.resultDeliveredPct >= 70 ? 'var(--success)' : 'var(--danger)',
                  letterSpacing: '-0.02em',
                }}
              >
                {agg.resultDeliveredPct}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ReviewsSection ────────────────────────────────────────────────────────────

export function ReviewsSection({
  provider, reviewStore, kycStore, viewerWallet, viewerName, isAdmin,
}: ReviewsSectionProps) {
  const [showWriteModal, setShowWriteModal] = useState(false)
  const [page,           setPage]           = useState(1)

  const isHotel = provider.categoryId === 'hotels-stays'
  const isVisa  = provider.categoryId === 'visa-immigration'

  const allReviews = reviewStore.getProviderReviews(provider.id)
  const agg        = reviewStore.getAggregate(provider.id)
  const paged      = allReviews.slice(0, page * PAGE_SIZE)
  const hasMore    = paged.length < allReviews.length

  const isOwner      = !!viewerWallet &&
    provider.walletAddress.toLowerCase() === viewerWallet.toLowerCase()
  const alreadyReviewed = !!viewerWallet && reviewStore.hasReviewed(provider.id, viewerWallet)
  const kycVerified     = !!viewerWallet &&
    kycStore.getRecord(viewerWallet)?.status === 'verified'

  // Can the viewer write a review?
  const canReview = !!viewerWallet && !isOwner && kycVerified && !alreadyReviewed

  return (
    <div
      className="rounded-2xl p-5 mb-5 border"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      {/* Section heading + CTA */}
      <div className="flex items-center justify-between mb-4">
        <h3
          className="display font-bold text-base"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Reviews {agg.count > 0 && (
            <span className="text-sm font-normal ml-1" style={{ color: 'var(--muted)' }}>
              ({agg.count})
            </span>
          )}
        </h3>

        {viewerWallet && !isOwner && (
          <button
            onClick={() => setShowWriteModal(true)}
            disabled={alreadyReviewed}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-all active:scale-95"
            style={{ background: 'var(--accent)', color: '#fff' }}
            title={
              !kycVerified      ? 'Complete KYC to leave a review'
              : alreadyReviewed ? 'You have already reviewed this provider'
              : 'Write a review'
            }
          >
            <PenLine size={12} />
            {alreadyReviewed ? 'Reviewed' : 'Write a Review'}
          </button>
        )}
      </div>

      {/* KYC nudge for unverified non-owners */}
      {viewerWallet && !isOwner && !kycVerified && (
        <div
          className="rounded-xl px-4 py-3 mb-4 flex items-center gap-2"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}
        >
          <Star size={14} style={{ color: '#f59e0b' }} />
          <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
            Complete identity verification to leave a review and earn a "Verified customer" badge.
          </p>
        </div>
      )}

      {/* Aggregate */}
      <AggregateHeader agg={agg} isHotel={isHotel} isVisa={isVisa} />

      {/* Review list */}
      {allReviews.length > 0 && (
        <div className="space-y-4">
          {paged.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              viewerWallet={viewerWallet}
              providerWallet={provider.walletAddress}
              onReply={(id, body) =>
                reviewStore.addProviderReply(id, provider.walletAddress, body)
              }
              onReport={(id) => {
                if (viewerWallet) reviewStore.reportReview(id, viewerWallet)
              }}
              isAdmin={isAdmin}
              onAdminHide={isAdmin ? (id) => reviewStore.hideReview(id, 'Removed by admin') : undefined}
            />
          ))}

          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border transition-all"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink-2)',
                borderColor: 'var(--border)',
              }}
            >
              <ChevronDown size={15} />
              Show more reviews ({allReviews.length - paged.length} remaining)
            </button>
          )}
        </div>
      )}

      {/* Write review modal */}
      {showWriteModal && viewerWallet && canReview && (
        <WriteReviewModal
          provider={provider}
          reviewerWallet={viewerWallet}
          reviewerName={viewerName ?? `${viewerWallet.slice(0, 6)}…${viewerWallet.slice(-4)}`}
          reviewStore={reviewStore}
          kycStore={kycStore}
          onClose={() => setShowWriteModal(false)}
        />
      )}

      {/* Show modal even to unverified — it will display the KYC wall */}
      {showWriteModal && viewerWallet && !canReview && !alreadyReviewed && (
        <WriteReviewModal
          provider={provider}
          reviewerWallet={viewerWallet}
          reviewerName={viewerName ?? `${viewerWallet.slice(0, 6)}…${viewerWallet.slice(-4)}`}
          reviewStore={reviewStore}
          kycStore={kycStore}
          onClose={() => setShowWriteModal(false)}
        />
      )}
    </div>
  )
}
