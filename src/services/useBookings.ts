// ─── Bookings / inquiry store ─────────────────────────────────────────────
// Persisted to localStorage. In production, replace with server-side storage.

import { useState, useCallback, useEffect } from 'react'

export type BookingStatus =
  | 'pending'    // customer submitted
  | 'accepted'   // provider accepted
  | 'declined'   // provider declined
  | 'cancelled'  // customer cancelled
  | 'completed'  // both parties confirmed
  | 'disputed'   // escalated to admin

export type PaymentMethod = 'usdc' | 'escrow' | 'in_person' | 'other'

export interface BookingDateRange {
  checkIn:  string // ISO-8601 date
  checkOut: string // ISO-8601 date
  guests?:  number
}

export interface Booking {
  id:             string
  providerId:     string
  providerWallet: string
  providerName:   string
  customerWallet: string
  serviceName:    string
  notes:          string
  /** ISO-8601 datetime for single-session bookings */
  requestedDate?: string
  requestedTime?: string
  /** Used for hotel / accommodation bookings */
  dateRange?:     BookingDateRange
  status:         BookingStatus
  paymentMethod:  PaymentMethod
  agreedAmount?:  number
  agreedCurrency?: string
  /** USDC tx hash if paid direct */
  txHash?:        string
  /** Escrow contract address if using escrow */
  escrowAddress?: string
  /** ISO-8601 */
  createdAt:      string
  updatedAt:      string
  /** Provider's reply when declining */
  declineReason?: string
  /** Provider's counter-proposal */
  counterProposal?: string
  /** Admin dispute notes */
  disputeNotes?:  string
}

export interface BookingsStore {
  bookings:      Booking[]
  createBooking: (b: Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => Booking
  acceptBooking: (id: string, amount?: number, currency?: string) => void
  declineBooking:(id: string, reason: string) => void
  cancelBooking: (id: string) => void
  completeBooking:(id: string) => void
  disputeBooking:(id: string, notes: string) => void
  counterBooking: (id: string, proposal: string) => void
  attachTx:      (id: string, txHash: string) => void
  attachEscrow:  (id: string, escrowAddress: string) => void
  getByProvider: (providerWallet: string) => Booking[]
  getByCustomer: (customerWallet: string) => Booking[]
  getById:       (id: string) => Booking | undefined
  pendingCount:  (providerWallet: string) => number
}

// ── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'tp_bookings_v1'

function load(): Booking[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Booking[]) : []
  } catch { return [] }
}

function save(bookings: Booking[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings)) } catch { /* quota */ }
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

// ── Seed data ─────────────────────────────────────────────────────────────

const SEED: Booking[] = [
  {
    id: 'bk-seed-1',
    providerId: 'seed-1',
    providerWallet: '0x0000000000000000000000000000000000000011',
    providerName: 'Amara Osei',
    customerWallet: '0x0000000000000000000000000000000000000099',
    serviceName: 'Custom Agbada Set',
    notes: 'Royal blue with gold trim. Wedding date: 28 November.',
    requestedDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 40).toISOString().slice(0, 10),
    requestedTime: '10:00',
    status: 'pending',
    paymentMethod: 'escrow',
    agreedAmount: 320,
    agreedCurrency: 'USD',
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: 'bk-seed-2',
    providerId: 'seed-3',
    providerWallet: '0x0000000000000000000000000000000000000033',
    providerName: 'The Lagos Gateway Hotel',
    customerWallet: '0x0000000000000000000000000000000000000099',
    serviceName: 'Deluxe Double Room',
    notes: 'Business trip. Early check-in if possible.',
    dateRange: {
      checkIn:  new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString().slice(0, 10),
      checkOut: new Date(Date.now() + 1000 * 60 * 60 * 24 * 13).toISOString().slice(0, 10),
      guests: 1,
    },
    status: 'accepted',
    paymentMethod: 'usdc',
    agreedAmount: 135,
    agreedCurrency: 'USD',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
]

// ── Hook ──────────────────────────────────────────────────────────────────

export function useBookings(): BookingsStore {
  const [bookings, setBookings] = useState<Booking[]>(() => {
    const stored = load()
    return stored.length > 0 ? stored : SEED
  })

  useEffect(() => { save(bookings) }, [bookings])

  function mutate(id: string, patch: Partial<Booking>) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b,
      ),
    )
  }

  const createBooking = useCallback(
    (data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Booking => {
      const now = new Date().toISOString()
      const booking: Booking = {
        ...data,
        id: uid(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      }
      setBookings((prev) => [booking, ...prev])
      return booking
    },
    [],
  )

  const acceptBooking = useCallback((id: string, amount?: number, currency?: string) => {
    mutate(id, { status: 'accepted', agreedAmount: amount, agreedCurrency: currency })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const declineBooking = useCallback((id: string, reason: string) => {
    mutate(id, { status: 'declined', declineReason: reason })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cancelBooking = useCallback((id: string) => {
    mutate(id, { status: 'cancelled' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const completeBooking = useCallback((id: string) => {
    mutate(id, { status: 'completed' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const disputeBooking = useCallback((id: string, notes: string) => {
    mutate(id, { status: 'disputed', disputeNotes: notes })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counterBooking = useCallback((id: string, proposal: string) => {
    mutate(id, { counterProposal: proposal, status: 'pending' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const attachTx = useCallback((id: string, txHash: string) => {
    mutate(id, { txHash })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const attachEscrow = useCallback((id: string, escrowAddress: string) => {
    mutate(id, { escrowAddress })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getByProvider = useCallback((providerWallet: string): Booking[] => {
    const w = providerWallet.toLowerCase()
    return bookings
      .filter((b) => b.providerWallet.toLowerCase() === w)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [bookings])

  const getByCustomer = useCallback((customerWallet: string): Booking[] => {
    const w = customerWallet.toLowerCase()
    return bookings
      .filter((b) => b.customerWallet.toLowerCase() === w)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [bookings])

  const getById = useCallback((id: string) => bookings.find((b) => b.id === id), [bookings])

  const pendingCount = useCallback((providerWallet: string): number => {
    const w = providerWallet.toLowerCase()
    return bookings.filter(
      (b) => b.providerWallet.toLowerCase() === w && b.status === 'pending',
    ).length
  }, [bookings])

  return {
    bookings,
    createBooking,
    acceptBooking,
    declineBooking,
    cancelBooking,
    completeBooking,
    disputeBooking,
    counterBooking,
    attachTx,
    attachEscrow,
    getByProvider,
    getByCustomer,
    getById,
    pendingCount,
  }
}
