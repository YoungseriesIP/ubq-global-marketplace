// ─── Service Directory Types ───────────────────────────────────────────────
// Kept separate from src/types.ts (goods marketplace) intentionally.

export type ServiceCategoryId =
  | 'fashion-tailoring'
  | 'barbering-beauty'
  | 'auto-repair'
  | 'food-cakes'
  | 'hotels-stays'
  | 'visa-immigration'
  | 'home-services'
  | 'other'

export interface ServiceCategory {
  id: ServiceCategoryId
  label: string
  subcategories: string[]
  color: string
  icon: string // lucide icon name
}

export interface ServiceOffering {
  id: string
  name: string
  description?: string
  startingPrice?: number
  currency?: string // e.g. "USD", "NGN", "EUR"
}

export interface WorkingHours {
  monday?: string
  tuesday?: string
  wednesday?: string
  thursday?: string
  friday?: string
  saturday?: string
  sunday?: string
  /** Free-text override, e.g. "By appointment only" */
  note?: string
}

export interface ContactInfo {
  phone?: string
  whatsapp?: string
  email?: string
  website?: string
  instagram?: string
  facebook?: string
  twitter?: string
}

export type ServiceMode = 'shop' | 'mobile' | 'both'

export interface LocationInfo {
  country: string
  stateRegion?: string
  city: string
  /** Only shown publicly when showFullAddress is true */
  streetAddress?: string
  showFullAddress: boolean
  lat?: number
  lng?: number
  serviceMode: ServiceMode
  /** Radius in km when serviceMode is 'mobile' or 'both' */
  serviceRadiusKm?: number
}

export interface PortfolioItem {
  id: string
  url: string
  caption?: string
  type: 'image' | 'video'
  /** true = flagged for moderation review */
  flagged?: boolean
}

export type VerificationLevel =
  | 'none'
  | 'basic'       // email/phone verified
  | 'kyc'         // ID verified
  | 'business'    // registration docs verified
  | 'credentials' // visa agent: admin-reviewed license

// Hotel-specific extras
export interface HotelExtras {
  roomTypes: Array<{ name: string; pricePerNight: number; currency: string }>
  amenities: string[]
  checkInTime?: string
  checkOutTime?: string
  totalRooms?: number
}

// Visa agent-specific extras
export interface VisaAgentExtras {
  countriesServed: string[]
  visaTypes: string[]
  businessRegNumber?: string
  licenseDetails?: string
  feeStructure?: string
}

export interface ServiceProvider {
  id: string
  /** Wallet address — acts as the unique identity */
  walletAddress: string
  /** Display name or business name */
  name: string
  /** Short tagline shown on card */
  tagline: string
  /** Longer bio shown on profile */
  bio: string
  profilePhotoUrl?: string
  categoryId: ServiceCategoryId
  subcategory?: string
  yearsExperience?: number
  languagesSpoken: string[]
  services: ServiceOffering[]
  workingHours?: WorkingHours
  contact: ContactInfo
  location: LocationInfo
  portfolio: PortfolioItem[]
  /** Voluntary community/origin tag, e.g. "Nigerian". Never required, never verified. */
  communityTag?: string
  verificationLevel: VerificationLevel
  /** Average star rating (0–5), derived from reviews */
  ratingAverage: number
  reviewCount: number
  /** Whether this provider profile is live/searchable */
  isActive: boolean
  /** Sponsored/featured (paid boost) */
  isFeatured: boolean
  createdAt: Date
  /** Hotel-only extras */
  hotelExtras?: HotelExtras
  /** Visa agent-only extras */
  visaAgentExtras?: VisaAgentExtras
}

// ─── Form state type used in CreateProviderModal ────────────────────────────
export interface ProviderFormState {
  name: string
  tagline: string
  bio: string
  profilePhotoUrl: string
  categoryId: ServiceCategoryId
  subcategory: string
  yearsExperience: string
  languagesSpoken: string // comma-separated input
  communityTag: string
  // Location
  country: string
  stateRegion: string
  city: string
  streetAddress: string
  showFullAddress: boolean
  serviceMode: ServiceMode
  serviceRadiusKm: string
  // Contact
  phone: string
  whatsapp: string
  email: string
  website: string
  instagram: string
  // Services (up to 5 for form simplicity)
  services: Array<{ name: string; description: string; startingPrice: string; currency: string }>
  // Working hours note
  workingHoursNote: string
  // Portfolio URLs (comma-separated for simplicity — real upload needs backend)
  portfolioUrls: string
  // Hotel extras
  hotelRooms: Array<{ name: string; price: string; currency: string }>
  hotelAmenities: string
  hotelCheckIn: string
  hotelCheckOut: string
  // Visa agent extras
  visaCountries: string
  visaTypes: string
  visaRegNumber: string
  visaLicense: string
  visaFeeStructure: string
}
