import { useState, useEffect, useCallback } from 'react'
import type { ServiceProvider } from './types'

// ─── localStorage key ────────────────────────────────────────────────────────
const STORAGE_KEY = 'tradeport_service_providers_v1'

// ─── Seed data ───────────────────────────────────────────────────────────────
// Real-looking providers across different categories and locations.
// Wallet addresses are illustrative zeros — real providers use their connected wallet.
const SEED_PROVIDERS: ServiceProvider[] = [
  {
    id: 'sp-1',
    walletAddress: '0x0000000000000000000000000000000000000010',
    name: 'Amara Osei Tailoring Studio',
    tagline: 'Bespoke African & Western wear, Houston TX',
    bio: 'Master tailor with 14 years of experience. Specialising in Ankara designs, suits, bridesmaid dresses and alterations. I work from my studio in Houston and ship finished items within the USA. Nigerian-owned, community trusted.',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&auto=format&fit=crop',
    categoryId: 'fashion-tailoring',
    subcategory: 'Traditional Attire',
    yearsExperience: 14,
    languagesSpoken: ['English', 'Yoruba', 'Igbo'],
    communityTag: 'Nigerian',
    services: [
      { id: 'svc-1a', name: 'Ankara Dress', startingPrice: 120, currency: 'USD' },
      { id: 'svc-1b', name: 'Men\'s Agbada Set', startingPrice: 180, currency: 'USD' },
      { id: 'svc-1c', name: 'Alterations', startingPrice: 30, currency: 'USD' },
    ],
    workingHours: { note: 'Mon–Sat 9am–7pm. Book via WhatsApp.' },
    contact: { phone: '', whatsapp: '+1-713-000-0001', email: 'amara@example.com', instagram: 'amaratailor_htx' },
    location: {
      country: 'United States',
      stateRegion: 'Texas',
      city: 'Houston',
      showFullAddress: false,
      serviceMode: 'shop',
      lat: 29.7604,
      lng: -95.3698,
    },
    portfolio: [
      { id: 'p-1a', url: 'https://images.unsplash.com/photo-1589156191108-c762ff4b96ab?w=600&auto=format&fit=crop', caption: 'Ankara senator set', type: 'image' },
      { id: 'p-1b', url: 'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?w=600&auto=format&fit=crop', caption: 'Bridesmaid dresses', type: 'image' },
    ],
    verificationLevel: 'basic',
    ratingAverage: 4.8,
    reviewCount: 31,
    isActive: true,
    isFeatured: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
  },
  {
    id: 'sp-2',
    walletAddress: '0x0000000000000000000000000000000000000011',
    name: 'Chukwudi\'s Barbershop',
    tagline: 'Precision cuts & fades, East London',
    bio: 'Professional barber since 2016. Known for skin fades, lineups and locs. Walk-ins welcome. Located near Mile End. Nigerian community barber — all are welcome!',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&auto=format&fit=crop',
    categoryId: 'barbering-beauty',
    subcategory: 'Barber',
    yearsExperience: 10,
    languagesSpoken: ['English', 'Igbo'],
    communityTag: 'Nigerian',
    services: [
      { id: 'svc-2a', name: 'Haircut & Fade', startingPrice: 20, currency: 'GBP' },
      { id: 'svc-2b', name: 'Beard Trim', startingPrice: 10, currency: 'GBP' },
      { id: 'svc-2c', name: 'Locs Retwist', startingPrice: 45, currency: 'GBP' },
    ],
    workingHours: { note: 'Tue–Sun 10am–8pm. Closed Mondays.' },
    contact: { phone: '+44-20-0000-0002', whatsapp: '+44-7700-000002', instagram: 'chukwudi_cuts' },
    location: {
      country: 'United Kingdom',
      stateRegion: 'Greater London',
      city: 'London',
      streetAddress: 'Mile End Road, E1',
      showFullAddress: true,
      serviceMode: 'shop',
      lat: 51.5248,
      lng: -0.0397,
    },
    portfolio: [
      { id: 'p-2a', url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&auto=format&fit=crop', caption: 'Clean skin fade', type: 'image' },
      { id: 'p-2b', url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&auto=format&fit=crop', caption: 'Lineup & beard', type: 'image' },
    ],
    verificationLevel: 'basic',
    ratingAverage: 4.9,
    reviewCount: 87,
    isActive: true,
    isFeatured: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
  },
  {
    id: 'sp-3',
    walletAddress: '0x0000000000000000000000000000000000000012',
    name: 'Abubakar Auto Works',
    tagline: 'Trusted mobile mechanic, Tehran',
    bio: 'Nigerian mechanic living in Tehran for 8 years. Full diagnostics, engine repair and air conditioning for Japanese and European cars. I come to you anywhere in Tehran.',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&auto=format&fit=crop',
    categoryId: 'auto-repair',
    subcategory: 'Mobile Mechanic',
    yearsExperience: 12,
    languagesSpoken: ['English', 'Hausa', 'Farsi (basic)'],
    communityTag: 'Nigerian',
    services: [
      { id: 'svc-3a', name: 'Full Diagnostics', startingPrice: 500000, currency: 'IRR' },
      { id: 'svc-3b', name: 'Oil Change & Service', startingPrice: 1200000, currency: 'IRR' },
      { id: 'svc-3c', name: 'AC Repair', startingPrice: 2000000, currency: 'IRR' },
    ],
    workingHours: { note: 'Sat–Thu 8am–6pm. Friday by appointment.' },
    contact: { phone: '+98-912-000-0003', whatsapp: '+98-912-000-0003' },
    location: {
      country: 'Iran',
      stateRegion: 'Tehran Province',
      city: 'Tehran',
      showFullAddress: false,
      serviceMode: 'mobile',
      serviceRadiusKm: 25,
      lat: 35.6892,
      lng: 51.3890,
    },
    portfolio: [
      { id: 'p-3a', url: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=600&auto=format&fit=crop', caption: 'Engine overhaul completed', type: 'image' },
    ],
    verificationLevel: 'basic',
    ratingAverage: 4.7,
    reviewCount: 24,
    isActive: true,
    isFeatured: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60),
  },
  {
    id: 'sp-4',
    walletAddress: '0x0000000000000000000000000000000000000013',
    name: 'Blessing\'s Cakes & Catering',
    tagline: 'Custom cakes & Nigerian cuisine, Toronto',
    bio: 'Pastry chef and caterer. I make celebration cakes, jollof rice, egusi, and pepper soup for events big and small. I cater weddings, birthdays and corporate dinners. Based in Toronto, delivery across GTA.',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1607631568010-a87245c0daf8?w=400&auto=format&fit=crop',
    categoryId: 'food-cakes',
    subcategory: 'Cake Baker',
    yearsExperience: 7,
    languagesSpoken: ['English', 'Yoruba'],
    communityTag: 'Nigerian',
    services: [
      { id: 'svc-4a', name: 'Custom Birthday Cake (2-tier)', startingPrice: 180, currency: 'CAD' },
      { id: 'svc-4b', name: 'Wedding Cake (3-tier)', startingPrice: 600, currency: 'CAD' },
      { id: 'svc-4c', name: 'Nigerian Catering (per head)', startingPrice: 35, currency: 'CAD' },
    ],
    workingHours: { note: 'Orders taken 7 days. Minimum 72hrs notice for cakes.' },
    contact: { phone: '+1-647-000-0004', whatsapp: '+1-647-000-0004', instagram: 'blessingsbakes_to' },
    location: {
      country: 'Canada',
      stateRegion: 'Ontario',
      city: 'Toronto',
      showFullAddress: false,
      serviceMode: 'both',
      serviceRadiusKm: 30,
      lat: 43.6532,
      lng: -79.3832,
    },
    portfolio: [
      { id: 'p-4a', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop', caption: '3-tier wedding cake', type: 'image' },
      { id: 'p-4b', url: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&auto=format&fit=crop', caption: 'Nigerian party spread', type: 'image' },
    ],
    verificationLevel: 'kyc',
    ratingAverage: 5.0,
    reviewCount: 52,
    isActive: true,
    isFeatured: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20),
  },
  {
    id: 'sp-5',
    walletAddress: '0x0000000000000000000000000000000000000014',
    name: 'The Lagos Gateway Hotel',
    tagline: 'Comfortable stays in Victoria Island, Lagos',
    bio: 'Boutique hotel on Victoria Island. Clean, well-maintained rooms with 24/7 power and water. Free breakfast included. Airport transfers available. Ideal for business travellers and diaspora visits.',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&auto=format&fit=crop',
    categoryId: 'hotels-stays',
    subcategory: 'Hotel',
    yearsExperience: 5,
    languagesSpoken: ['English', 'Yoruba', 'Igbo', 'Hausa'],
    services: [],
    workingHours: { note: 'Check-in: 2pm. Check-out: 12pm. 24/7 reception.' },
    contact: { phone: '+234-1-000-0005', email: 'info@lagosgateway.example.com', website: 'https://lagosgateway.example.com' },
    location: {
      country: 'Nigeria',
      stateRegion: 'Lagos State',
      city: 'Lagos',
      streetAddress: 'Victoria Island',
      showFullAddress: true,
      serviceMode: 'shop',
      lat: 6.4281,
      lng: 3.4219,
    },
    portfolio: [
      { id: 'p-5a', url: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&auto=format&fit=crop', caption: 'Deluxe room', type: 'image' },
      { id: 'p-5b', url: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=600&auto=format&fit=crop', caption: 'Pool area', type: 'image' },
    ],
    hotelExtras: {
      roomTypes: [
        { name: 'Standard Room', pricePerNight: 45000, currency: 'NGN' },
        { name: 'Deluxe Room', pricePerNight: 75000, currency: 'NGN' },
        { name: 'Executive Suite', pricePerNight: 120000, currency: 'NGN' },
      ],
      amenities: ['Free WiFi', '24/7 Power', 'Free Breakfast', 'Airport Transfer', 'Swimming Pool', 'Restaurant'],
      checkInTime: '14:00',
      checkOutTime: '12:00',
    },
    verificationLevel: 'business',
    ratingAverage: 4.6,
    reviewCount: 143,
    isActive: true,
    isFeatured: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90),
  },
  {
    id: 'sp-6',
    walletAddress: '0x0000000000000000000000000000000000000015',
    name: 'Adaeze Obi — Visa & Immigration Consulting',
    tagline: 'UK, Canada & Schengen visa expert, Abuja',
    bio: 'Certified immigration consultant with 9 years experience. I help individuals and families with UK spouse visas, Canadian PR, student visas and Schengen applications. Transparent fees, honest advice.',
    profilePhotoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop',
    categoryId: 'visa-immigration',
    subcategory: 'Visa Consultant',
    yearsExperience: 9,
    languagesSpoken: ['English', 'Igbo'],
    services: [
      { id: 'svc-6a', name: 'UK Visa Application Support', startingPrice: 150000, currency: 'NGN' },
      { id: 'svc-6b', name: 'Canada PR Consultation', startingPrice: 200000, currency: 'NGN' },
      { id: 'svc-6c', name: 'Schengen Tourist Visa', startingPrice: 80000, currency: 'NGN' },
    ],
    workingHours: { note: 'Mon–Fri 9am–5pm WAT. Phone consultations available.' },
    contact: { phone: '+234-803-000-0006', email: 'adaeze@example.com', whatsapp: '+234-803-000-0006' },
    location: {
      country: 'Nigeria',
      stateRegion: 'FCT Abuja',
      city: 'Abuja',
      showFullAddress: false,
      serviceMode: 'both',
      serviceRadiusKm: 0,
      lat: 9.0765,
      lng: 7.3986,
    },
    portfolio: [],
    visaAgentExtras: {
      countriesServed: ['United Kingdom', 'Canada', 'Schengen Area', 'United States'],
      visaTypes: ['Spouse Visa', 'Student Visa', 'Tourist Visa', 'Permanent Residence', 'Work Permit'],
      businessRegNumber: 'RC-EXAMPLE-001',
      licenseDetails: 'ICCRC Member (illustrative)',
      feeStructure: 'Consultation: ₦30,000. Full service fees vary by visa type — quoted upfront before engagement.',
    },
    verificationLevel: 'credentials',
    ratingAverage: 4.5,
    reviewCount: 68,
    isActive: true,
    isFeatured: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45),
  },
]

// ─── localStorage persistence ─────────────────────────────────────────────────

function loadFromStorage(): ServiceProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return SEED_PROVIDERS
    const parsed = JSON.parse(raw) as ServiceProvider[]
    // Rehydrate Date objects
    return parsed.map((p) => ({ ...p, createdAt: new Date(p.createdAt) }))
  } catch {
    return SEED_PROVIDERS
  }
}

function saveToStorage(providers: ServiceProvider[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(providers))
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

// ─── useProviders hook ────────────────────────────────────────────────────────

export interface ProvidersStore {
  providers: ServiceProvider[]
  addProvider: (p: ServiceProvider) => void
  updateProvider: (id: string, patch: Partial<ServiceProvider>) => void
  removeProvider: (id: string) => void
  getById: (id: string) => ServiceProvider | undefined
  getByWallet: (address: string) => ServiceProvider | undefined
}

export function useProviders(): ProvidersStore {
  const [providers, setProviders] = useState<ServiceProvider[]>(loadFromStorage)

  useEffect(() => {
    saveToStorage(providers)
  }, [providers])

  const addProvider = useCallback((p: ServiceProvider) => {
    setProviders((prev) => [p, ...prev])
  }, [])

  const updateProvider = useCallback((id: string, patch: Partial<ServiceProvider>) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const removeProvider = useCallback((id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const getById = useCallback(
    (id: string) => providers.find((p) => p.id === id),
    [providers],
  )

  const getByWallet = useCallback(
    (address: string) =>
      providers.find((p) => p.walletAddress.toLowerCase() === address.toLowerCase()),
    [providers],
  )

  return { providers, addProvider, updateProvider, removeProvider, getById, getByWallet }
}
