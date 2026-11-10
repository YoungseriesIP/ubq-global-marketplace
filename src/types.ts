export interface Listing {
  id: string
  title: string
  description: string
  price: number
  category: string
  location: string
  /** ISO-3166-1 alpha-2 country code, e.g. "NG", "CN", "US" */
  countryCode?: string
  chain: string
  chainId: number
  sellerAddress: string
  imageUrl?: string
  createdAt: Date
  /** Exact USDC price as a decimal string (what actually moves onchain). */
  priceUsdc?: string
  sellerName?: string
  /** Demo listings have placeholder sellers and cannot be bought. */
  isDemo?: boolean
  /** Facts about the seller that the server can check. */
  sellerTrust?: { emailVerified: boolean; verifiedSales: number; complaints: number; trusted: boolean }
}

export type Category =
  | 'Electronics'
  | 'Fashion'
  | 'Art'
  | 'Books'
  | 'Collectibles'
  | 'Home'
  | 'Sports'
  | 'Other'

export type SupportedChain = {
  name: string
  chainId: number
  shortName: string
}
