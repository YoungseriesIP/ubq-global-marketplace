// Thin fetch wrapper for the TradePort API. The session token lives in localStorage
// and is sent as a Bearer token; the server authorizes every protected route.

const SESSION_KEY = 'tp_session_token_v1'

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

/** Random id for this browser, used to recognise a returning device. Never contains personal data. */
export function getDeviceId(): string {
  let id = localStorage.getItem('tp_device_v1')
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('tp_device_v1', id)
  }
  return id
}

export function setSessionToken(token: string | null): void {
  if (token) localStorage.setItem(SESSION_KEY, token)
  else localStorage.removeItem(SESSION_KEY)
}

export class ApiError extends Error {
  status: number
  code?: number
  constructor(message: string, status: number, code?: number) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getSessionToken()
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: number }
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json.code)
  return json as T
}

// ── Shared shapes ────────────────────────────────────────────────────────
export interface AppUser {
  address: `0x${string}`
  method: 'circle' | 'wallet'
  email: string | null
  walletId: string | null
  displayName: string
  shopName: string
  shopBio: string
  countryCode: string | null
}

export interface ServerConfig {
  circleConfigured: boolean
  circleAppId: string | null
  googleClientId: string | null
  escrowAddress: string | null
  chainId: number
}

export interface ApiListing {
  id: string
  title: string
  description: string
  priceUsdc: string
  category: string
  location: string
  countryCode: string | null
  chain: string
  chainId: number
  sellerAddress: string
  sellerName: string
  isDemo: boolean
  sellerTrust?: { emailVerified: boolean; verifiedSales: number; complaints: number; trusted: boolean }
  imageUrl: string | null
  createdAt: string
}

export interface ApiOrder {
  id: string
  listingId: string
  title: string
  role: 'buyer' | 'seller'
  amountUsdc: string
  displayCurrency: string | null
  displayAmount: string | null
  txHash: string | null
  status: 'pending_payment' | 'unverified' | 'verified' | 'failed'
  verifiedNote: string | null
  createdAt: string
}

import type { Listing } from '@/types'

export function toListing(a: ApiListing): Listing {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    price: Number(a.priceUsdc),
    priceUsdc: a.priceUsdc,
    category: a.category,
    location: a.location,
    countryCode: a.countryCode ?? undefined,
    chain: a.chain,
    chainId: a.chainId,
    sellerAddress: a.sellerAddress,
    sellerName: a.sellerName,
    isDemo: a.isDemo,
    sellerTrust: a.sellerTrust,
    imageUrl: a.imageUrl ?? undefined,
    createdAt: new Date(a.createdAt),
  }
}
