// ─── Reviews Store ────────────────────────────────────────────────────────────
// Manages reviews, sub-ratings, provider replies, reports, and moderation state
// entirely in localStorage (same pattern as useKyc / useFavorites).
// In production every mutation is a POST/PATCH to a server endpoint guarded by
// JWT / session — the client never has write access to other users' reviews.

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Sub-ratings specific to hotel stays */
export interface HotelSubRatings {
  cleanliness: number   // 1–5
  location:    number
  value:       number
  service:     number
}

/** Sub-ratings specific to visa / immigration consultants */
export interface VisaSubRatings {
  communication: number  // 1–5
  honesty:       number
  outcome:       number
  value:         number
  /** "Did the service deliver the result promised?" */
  resultDelivered: 'yes' | 'no' | 'partial'
}

export type ReviewStatus = 'visible' | 'hidden' | 'pending_moderation'

export interface Review {
  id:             string
  providerId:     string
  /** Wallet address of the reviewer */
  reviewerWallet: string
  /** Display name (stored at time of review so it persists) */
  reviewerName:   string
  /** 1–5 overall star rating */
  rating:         number
  body:           string
  /** Optional photo URLs uploaded alongside the review */
  photoUrls:      string[]
  /** True = reviewer went through the platform (booking / inquiry) */
  verifiedInteraction: boolean
  /** Booking/interaction ID that backs the verified flag */
  interactionRef?: string
  status:         ReviewStatus
  /** Reason admin hid this review */
  hiddenReason?:  string
  createdAt:      string
  /** One provider reply (immutable once set) */
  providerReply?: {
    body:       string
    repliedAt:  string
  }
  /** IDs of wallets that reported this review as abusive */
  reportedBy:     string[]
  /** Hotel sub-ratings (only when categoryId === 'hotels-stays') */
  hotelSubRatings?: HotelSubRatings
  /** Visa sub-ratings (only when categoryId === 'visa-immigration') */
  visaSubRatings?:  VisaSubRatings
}

/** Aggregated stats computed from visible reviews */
export interface ReviewAggregate {
  average:      number   // 0–5, 1 dp
  count:        number
  distribution: Record<1|2|3|4|5, number>  // star → count
  hotelAverages?: { cleanliness: number; location: number; value: number; service: number }
  visaAverages?:  { communication: number; honesty: number; outcome: number; value: number }
  resultDeliveredPct?: number  // % that answered 'yes'
}

/** Thin record that tracks one booking/inquiry so we can gate reviews */
export interface Interaction {
  id:             string
  providerId:     string
  customerWallet: string
  type:           'booking' | 'inquiry'
  createdAt:      string
  /** Has the customer already left a review for this interaction? */
  reviewed:       boolean
}

export interface ReviewsStore {
  reviews:      Review[]
  interactions: Interaction[]
  // Queries
  getProviderReviews:  (providerId: string) => Review[]
  getAggregate:        (providerId: string) => ReviewAggregate
  hasInteraction:      (providerId: string, wallet: string) => boolean
  hasReviewed:         (providerId: string, wallet: string) => boolean
  // User actions
  submitReview:        (review: Omit<Review, 'id' | 'status' | 'createdAt' | 'reportedBy' | 'providerReply'>) => void
  addProviderReply:    (reviewId: string, providerWallet: string, body: string) => void
  reportReview:        (reviewId: string, reporterWallet: string) => void
  // Simulated booking / inquiry (so we can gate reviews without a real backend)
  recordInteraction:   (providerId: string, customerWallet: string, type: Interaction['type']) => string
  // Admin actions
  hideReview:          (reviewId: string, reason: string) => void
  unhideReview:        (reviewId: string) => void
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const REVIEWS_KEY      = 'tradeport_reviews_v1'
const INTERACTIONS_KEY = 'tradeport_interactions_v1'

// ─── Seed reviews ─────────────────────────────────────────────────────────────
// Pre-seeded so there is content to display immediately.

const SEED_REVIEWS: Review[] = [
  {
    id: 'rev-1',
    providerId: 'sp-1',   // Amara Osei Tailoring
    reviewerWallet: '0xAAAA000000000000000000000000000000000001',
    reviewerName: 'Chisom A.',
    rating: 5,
    body: 'Absolutely stunning work! Amara made my Ankara senator set for my sister\'s wedding and it came out perfectly. She even added extra embroidery I didn\'t ask for — free of charge. Highly recommend.',
    photoUrls: ['https://images.unsplash.com/photo-1589156191108-c762ff4b96ab?w=400&auto=format&fit=crop'],
    verifiedInteraction: true,
    interactionRef: 'int-seed-1',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    reportedBy: [],
  },
  {
    id: 'rev-2',
    providerId: 'sp-1',
    reviewerWallet: '0xAAAA000000000000000000000000000000000002',
    reviewerName: 'Tunde O.',
    rating: 5,
    body: 'Made a bespoke agbada for me for a traditional wedding. Perfect fit, delivered on time. Communicates very well via WhatsApp.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-2',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    reportedBy: [],
  },
  {
    id: 'rev-3',
    providerId: 'sp-2',  // Chukwudi Barbershop
    reviewerWallet: '0xAAAA000000000000000000000000000000000003',
    reviewerName: 'Kwame B.',
    rating: 5,
    body: 'Best barber in East London, full stop. Skin fade is immaculate every single time. Walk-in friendly too. I\'ve been coming for 3 years.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-3',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    reportedBy: [],
  },
  {
    id: 'rev-4',
    providerId: 'sp-2',
    reviewerWallet: '0xAAAA000000000000000000000000000000000004',
    reviewerName: 'David M.',
    rating: 4,
    body: 'Great cuts and friendly atmosphere. Sometimes a short wait on weekends but worth it.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-4',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
    providerReply: {
      body: 'Thank you David! We\'re working on appointment booking to reduce weekend waits. Appreciate your loyalty!',
      repliedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    },
    reportedBy: [],
  },
  {
    id: 'rev-5',
    providerId: 'sp-5',  // Lagos Gateway Hotel
    reviewerWallet: '0xAAAA000000000000000000000000000000000005',
    reviewerName: 'Funmi L.',
    rating: 5,
    body: 'Stayed for a week on a business trip. Excellent service, 24/7 power as promised, breakfast was delicious. The staff went above and beyond.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-5',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
    reportedBy: [],
    hotelSubRatings: { cleanliness: 5, location: 5, value: 4, service: 5 },
  },
  {
    id: 'rev-6',
    providerId: 'sp-5',
    reviewerWallet: '0xAAAA000000000000000000000000000000000006',
    reviewerName: 'Emeka T.',
    rating: 4,
    body: 'Good hotel overall, clean rooms and great location on VI. WiFi could be faster but that\'s my only complaint.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-6',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString(),
    reportedBy: [],
    hotelSubRatings: { cleanliness: 4, location: 5, value: 4, service: 4 },
  },
  {
    id: 'rev-7',
    providerId: 'sp-6',  // Adaeze Visa
    reviewerWallet: '0xAAAA000000000000000000000000000000000007',
    reviewerName: 'Grace O.',
    rating: 5,
    body: 'Adaeze helped me and my husband get our UK spouse visa approved. She was honest about the chances, explained everything, and responded quickly to every question. 100% recommend.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-7',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    reportedBy: [],
    visaSubRatings: { communication: 5, honesty: 5, outcome: 5, value: 4, resultDelivered: 'yes' },
  },
  {
    id: 'rev-8',
    providerId: 'sp-6',
    reviewerWallet: '0xAAAA000000000000000000000000000000000008',
    reviewerName: 'Michael A.',
    rating: 4,
    body: 'Very knowledgeable consultant. My Schengen visa application was successful. Fees are fair and everything was transparent from day one.',
    photoUrls: [],
    verifiedInteraction: true,
    interactionRef: 'int-seed-8',
    status: 'visible',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    reportedBy: [],
    visaSubRatings: { communication: 4, honesty: 5, outcome: 4, value: 4, resultDelivered: 'yes' },
  },
]

const SEED_INTERACTIONS: Interaction[] = SEED_REVIEWS.map((r) => ({
  id:             r.interactionRef ?? `int-${r.id}`,
  providerId:     r.providerId,
  customerWallet: r.reviewerWallet,
  type:           'booking' as const,
  createdAt:      r.createdAt,
  reviewed:       true,
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadReviews(): Review[] {
  try {
    const raw = localStorage.getItem(REVIEWS_KEY)
    return raw ? (JSON.parse(raw) as Review[]) : SEED_REVIEWS
  } catch { return SEED_REVIEWS }
}

function loadInteractions(): Interaction[] {
  try {
    const raw = localStorage.getItem(INTERACTIONS_KEY)
    return raw ? (JSON.parse(raw) as Interaction[]) : SEED_INTERACTIONS
  } catch { return SEED_INTERACTIONS }
}

function save(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* quota */ }
}

function now() { return new Date().toISOString() }

// Profanity word list — minimal, extend as needed
const PROFANITY = ['badword1', 'badword2']

function censorText(text: string): string {
  let out = text
  for (const word of PROFANITY) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), '*'.repeat(word.length))
  }
  return out
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useReviews(): ReviewsStore {
  const [reviews,      setReviews]      = useState<Review[]>(loadReviews)
  const [interactions, setInteractions] = useState<Interaction[]>(loadInteractions)

  useEffect(() => { save(REVIEWS_KEY,      reviews)      }, [reviews])
  useEffect(() => { save(INTERACTIONS_KEY, interactions) }, [interactions])

  // ── Queries ─────────────────────────────────────────────────────────────────

  const getProviderReviews = useCallback(
    (providerId: string) =>
      reviews
        .filter((r) => r.providerId === providerId && r.status === 'visible')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reviews],
  )

  const getAggregate = useCallback((providerId: string): ReviewAggregate => {
    const visible = reviews.filter((r) => r.providerId === providerId && r.status === 'visible')
    if (visible.length === 0) {
      return { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }
    }
    const dist: Record<1|2|3|4|5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let sum = 0
    for (const r of visible) {
      sum += r.rating
      const star = Math.round(r.rating) as 1|2|3|4|5
      if (star >= 1 && star <= 5) dist[star]++
    }
    const average = Math.round((sum / visible.length) * 10) / 10

    // Hotel sub-averages
    const hotelRated = visible.filter((r) => r.hotelSubRatings)
    let hotelAverages: ReviewAggregate['hotelAverages']
    if (hotelRated.length > 0) {
      const avg = (key: keyof HotelSubRatings) =>
        Math.round((hotelRated.reduce((s, r) => s + (r.hotelSubRatings?.[key] ?? 0), 0) / hotelRated.length) * 10) / 10
      hotelAverages = {
        cleanliness: avg('cleanliness'),
        location:    avg('location'),
        value:       avg('value'),
        service:     avg('service'),
      }
    }

    // Visa sub-averages
    const visaRated = visible.filter((r) => r.visaSubRatings)
    let visaAverages: ReviewAggregate['visaAverages']
    let resultDeliveredPct: number | undefined
    if (visaRated.length > 0) {
      const avg = (key: keyof Omit<VisaSubRatings, 'resultDelivered'>) =>
        Math.round((visaRated.reduce((s, r) => s + (r.visaSubRatings?.[key] ?? 0), 0) / visaRated.length) * 10) / 10
      visaAverages = {
        communication: avg('communication'),
        honesty:       avg('honesty'),
        outcome:       avg('outcome'),
        value:         avg('value'),
      }
      const yesCount = visaRated.filter((r) => r.visaSubRatings?.resultDelivered === 'yes').length
      resultDeliveredPct = Math.round((yesCount / visaRated.length) * 100)
    }

    return { average, count: visible.length, distribution: dist, hotelAverages, visaAverages, resultDeliveredPct }
  }, [reviews])

  const hasInteraction = useCallback(
    (providerId: string, wallet: string) =>
      interactions.some(
        (i) =>
          i.providerId === providerId &&
          i.customerWallet.toLowerCase() === wallet.toLowerCase(),
      ),
    [interactions],
  )

  const hasReviewed = useCallback(
    (providerId: string, wallet: string) =>
      reviews.some(
        (r) =>
          r.providerId === providerId &&
          r.reviewerWallet.toLowerCase() === wallet.toLowerCase() &&
          r.status !== 'hidden',
      ),
    [reviews],
  )

  // ── User actions ─────────────────────────────────────────────────────────────

  const submitReview = useCallback(
    (review: Omit<Review, 'id' | 'status' | 'createdAt' | 'reportedBy' | 'providerReply'>) => {
      const clean: Review = {
        ...review,
        body:   censorText(review.body),
        id:     `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'visible',
        createdAt: now(),
        reportedBy: [],
      }
      setReviews((prev) => [clean, ...prev])
      // Mark the interaction as reviewed
      if (review.interactionRef) {
        setInteractions((prev) =>
          prev.map((i) => i.id === review.interactionRef ? { ...i, reviewed: true } : i),
        )
      }
    },
    [],
  )

  const addProviderReply = useCallback(
    (reviewId: string, _providerWallet: string, body: string) => {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId && !r.providerReply
            ? { ...r, providerReply: { body: censorText(body), repliedAt: now() } }
            : r,
        ),
      )
    },
    [],
  )

  const reportReview = useCallback((reviewId: string, reporterWallet: string) => {
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r
        if (r.reportedBy.includes(reporterWallet.toLowerCase())) return r
        const updated = { ...r, reportedBy: [...r.reportedBy, reporterWallet.toLowerCase()] }
        // Auto-flag for moderation if 3+ reports
        if (updated.reportedBy.length >= 3) updated.status = 'pending_moderation'
        return updated
      }),
    )
  }, [])

  const recordInteraction = useCallback(
    (providerId: string, customerWallet: string, type: Interaction['type']): string => {
      const id = `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const entry: Interaction = {
        id,
        providerId,
        customerWallet: customerWallet.toLowerCase(),
        type,
        createdAt: now(),
        reviewed: false,
      }
      setInteractions((prev) => [entry, ...prev])
      return id
    },
    [],
  )

  // ── Admin actions ─────────────────────────────────────────────────────────────

  const hideReview = useCallback((reviewId: string, reason: string) => {
    setReviews((prev) =>
      prev.map((r) => r.id === reviewId ? { ...r, status: 'hidden', hiddenReason: reason } : r),
    )
  }, [])

  const unhideReview = useCallback((reviewId: string) => {
    setReviews((prev) =>
      prev.map((r) => r.id === reviewId ? { ...r, status: 'visible', hiddenReason: undefined } : r),
    )
  }, [])

  return {
    reviews, interactions,
    getProviderReviews, getAggregate, hasInteraction, hasReviewed,
    submitReview, addProviderReply, reportReview, recordInteraction,
    hideReview, unhideReview,
  }
}
