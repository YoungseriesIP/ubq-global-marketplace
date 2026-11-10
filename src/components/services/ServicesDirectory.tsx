import { useState, useMemo, useCallback } from 'react'
import {
  Search, Users, MapPin, Map as MapIcon, LayoutGrid, SlidersHorizontal,
  Navigation, X, Heart,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { toast } from 'sonner'
import { ProviderCard } from './ProviderCard'
import { ProviderProfilePage } from './ProviderProfilePage'
import { CreateProviderModal } from './CreateProviderModal'
import { MapPinView } from './MapPinView'
import { KycConsentModal } from './KycConsentModal'
import { KycStatusBanner } from './KycStatusBanner'
import { SERVICE_CATEGORIES } from '../../services/categories'
import { useGeolocation } from '../../services/useGeolocation'
import { haversineKm } from '../../services/useDistance'
import { useFavorites } from '../../services/useFavorites'
import type { ServiceProvider, ServiceCategoryId } from '../../services/types'
import type { ProvidersStore } from '../../services/data'
import type { KycStore } from '../../services/useKyc'
import type { ReviewsStore } from '../../services/useReviews'
import type { BookingsStore } from '../../services/useBookings'
import type { MessagesStore } from '../../services/useMessages'
import type { CountryFilter } from '../../services/useCountryFilter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServicesDirectoryProps {
  store:          ProvidersStore
  kycStore:       KycStore
  reviewStore:    ReviewsStore
  bookingStore:   BookingsStore
  messagesStore:  MessagesStore
  countryFilter?: CountryFilter
}

type SortOption = 'featured-first' | 'top-rated' | 'most-reviewed' | 'newest' | 'nearest'

const SORT_LABELS: Record<SortOption, string> = {
  'featured-first': 'Featured first',
  'top-rated':      'Top rated',
  'most-reviewed':  'Most reviewed',
  'newest':         'Newest',
  'nearest':        'Nearest',
}

type ViewMode = 'list' | 'map'

const PAGE_SIZE = 12

// ─── Helper ───────────────────────────────────────────────────────────────────

function isOpenNow(provider: ServiceProvider): boolean {
  // We use the workingHours.note as free-text — a real implementation would parse
  // structured hours. Here we treat providers with no note as "always open".
  if (!provider.workingHours?.note) return true
  // Closed if note contains "closed" (case-insensitive)
  return !provider.workingHours.note.toLowerCase().includes('closed')
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ServicesDirectory({ store, kycStore, reviewStore, bookingStore, messagesStore, countryFilter }: ServicesDirectoryProps) {
  const address = useAuth().user?.address
  const favStore = useFavorites()
  const { geo, request: requestGeo, clear: clearGeo } = useGeolocation()

  const [showKyc, setShowKyc] = useState(false)

  // ── Search & filter state ─────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<ServiceCategoryId | 'all'>('all')
  const [communityFilter, setCommunityFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('featured-first')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)

  // Advanced filters
  const [radiusKm, setRadiusKm] = useState(50)
  const [nearMeActive, setNearMeActive] = useState(false)
  const [manualCity, setManualCity] = useState('')
  const [minRating, setMinRating] = useState(0)
  const [mobileOnly, setMobileOnly] = useState(false)
  const [openNowOnly, setOpenNowOnly] = useState(false)
  const [languageFilter, setLanguageFilter] = useState('')
  const [maxPrice, setMaxPrice] = useState(0) // 0 = no limit
  const [hotelMaxNight, setHotelMaxNight] = useState(0)

  // ── Modal state ───────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false)
  const [profileView, setProfileView] = useState<ServiceProvider | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const myProfile  = address ? store.getByWallet(address) : undefined
  const myKycRecord = address ? kycStore.getRecord(address) : undefined
  // Only verified providers (KYC verified) are visible in search
  const active = store.providers.filter(
    (p) => p.isActive && (
      // Seed providers (dummy wallets starting with 0x000) are always shown in demo
      p.walletAddress.startsWith('0x000') ||
      kycStore.getRecord(p.walletAddress)?.status === 'verified'
    ),
  )

  const userLat = geo.status === 'granted' ? geo.lat : undefined
  const userLng = geo.status === 'granted' ? geo.lng : undefined

  // Unique community tags
  const communityTags = useMemo(() => {
    const tags = new Set<string>()
    active.forEach((p) => { if (p.communityTag) tags.add(p.communityTag) })
    return Array.from(tags).sort()
  }, [active])

  // Unique languages
  const allLanguages = useMemo(() => {
    const langs = new Set<string>()
    active.forEach((p) => p.languagesSpoken.forEach((l) => langs.add(l)))
    return Array.from(langs).sort()
  }, [active])

  // Distance from user to each provider (memoised — only recomputes when geo changes)
  const distances = useMemo((): ReadonlyMap<string, number> => {
    const pairs: Array<[string, number]> = []
    if (userLat !== undefined && userLng !== undefined) {
      for (const p of active) {
        if (p.location.lat !== undefined && p.location.lng !== undefined) {
          pairs.push([p.id, haversineKm(userLat, userLng, p.location.lat, p.location.lng)])
        }
      }
    }
    return new Map(pairs)
  }, [active, userLat, userLng])

  // Activate Near Me
  const handleNearMe = useCallback(() => {
    if (nearMeActive) {
      setNearMeActive(false)
      clearGeo()
      setSortBy((s) => s === 'nearest' ? 'featured-first' : s)
      return
    }
    requestGeo()
    setNearMeActive(true)
    setSortBy('nearest')
  }, [nearMeActive, clearGeo, requestGeo])

  // ── Filter + sort pipeline ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = active

    // ── Country filter (from the global banner) ──────────────────────────
    // Matches against provider.location.country (full name) by comparing to
    // the countryFilter name, e.g. "Nigeria". Providers without a country set
    // pass through so existing data stays visible.
    if (countryFilter?.country && countryFilter.countryName) {
      const targetName = countryFilter.countryName.toLowerCase()
      result = result.filter(
        (p) =>
          !p.location.country ||
          p.location.country.toLowerCase().includes(targetName) ||
          p.location.country.toLowerCase() === countryFilter.country?.toLowerCase(),
      )
    }

    // Favorites only
    if (showFavoritesOnly) {
      result = result.filter((p) => favStore.isFavorite(p.id))
    }

    // Category
    if (activeCategoryId !== 'all') {
      result = result.filter((p) => p.categoryId === activeCategoryId)
    }

    // Community tag
    if (communityFilter) {
      result = result.filter((p) => p.communityTag === communityFilter)
    }

    // Keyword
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q) ||
          p.bio.toLowerCase().includes(q) ||
          p.location.city.toLowerCase().includes(q) ||
          p.location.country.toLowerCase().includes(q) ||
          (p.location.stateRegion?.toLowerCase().includes(q)) ||
          (p.subcategory?.toLowerCase().includes(q)) ||
          p.services.some((s) => s.name.toLowerCase().includes(q)) ||
          (p.communityTag?.toLowerCase().includes(q)) ||
          p.languagesSpoken.some((l) => l.toLowerCase().includes(q)),
      )
    }

    // Manual city filter
    if (manualCity.trim()) {
      const mc = manualCity.toLowerCase()
      result = result.filter(
        (p) =>
          p.location.city.toLowerCase().includes(mc) ||
          p.location.country.toLowerCase().includes(mc) ||
          (p.location.stateRegion?.toLowerCase().includes(mc)),
      )
    }

    // Near me + radius
    if (nearMeActive && geo.status === 'granted') {
      result = result.filter((p) => {
        const d = distances.get(p.id)
        if (d === undefined) return false // no coords — exclude when Near Me active
        // For mobile providers include if service radius overlaps user radius
        if (p.location.serviceMode === 'mobile' && p.location.serviceRadiusKm) {
          return d <= radiusKm + p.location.serviceRadiusKm
        }
        return d <= radiusKm
      })
    }

    // Min rating
    if (minRating > 0) {
      result = result.filter((p) => p.ratingAverage >= minRating)
    }

    // Mobile only
    if (mobileOnly) {
      result = result.filter(
        (p) => p.location.serviceMode === 'mobile' || p.location.serviceMode === 'both',
      )
    }

    // Open now
    if (openNowOnly) {
      result = result.filter(isOpenNow)
    }

    // Language
    if (languageFilter) {
      result = result.filter((p) =>
        p.languagesSpoken.some((l) => l.toLowerCase() === languageFilter.toLowerCase()),
      )
    }

    // Max price (first service)
    if (maxPrice > 0) {
      result = result.filter((p) => {
        if (p.services.length === 0) return true
        const lowestPrice = Math.min(
          ...p.services
            .filter((s) => s.startingPrice !== undefined)
            .map((s) => s.startingPrice as number),
        )
        return lowestPrice <= maxPrice
      })
    }

    // Hotel max night rate
    if (hotelMaxNight > 0 && activeCategoryId === 'hotels-stays') {
      result = result.filter((p) => {
        if (!p.hotelExtras) return true
        const lowestNight = Math.min(
          ...p.hotelExtras.roomTypes.map((r) => r.pricePerNight),
        )
        return lowestNight <= hotelMaxNight
      })
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'nearest') {
        const da = distances.get(a.id) ?? Infinity
        const db = distances.get(b.id) ?? Infinity
        return da - db
      }
      if (sortBy === 'featured-first') {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1
        return b.ratingAverage - a.ratingAverage
      }
      if (sortBy === 'top-rated')     return b.ratingAverage - a.ratingAverage
      if (sortBy === 'most-reviewed') return b.reviewCount - a.reviewCount
      if (sortBy === 'newest')        return b.createdAt.getTime() - a.createdAt.getTime()
      return 0
    })

    return result
  }, [
    active, showFavoritesOnly, favStore, activeCategoryId, communityFilter,
    query, manualCity, nearMeActive, geo, distances, radiusKm,
    minRating, mobileOnly, openNowOnly, languageFilter, maxPrice, hotelMaxNight, sortBy,
    countryFilter,
  ])

  // Paginated slice
  const paged = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = paged.length < filtered.length

  // Reset page when filters change
  const resetPage = useCallback(() => setPage(1), [])

  // Active filter count for badge
  const activeFilterCount = [
    nearMeActive, communityFilter, minRating > 0, mobileOnly,
    openNowOnly, languageFilter, maxPrice > 0, hotelMaxNight > 0, showFavoritesOnly,
  ].filter(Boolean).length

  // ── Profile view ─────────────────────────────────────────────────────────
  if (profileView) {
    return (
      <ProviderProfilePage
        provider={profileView}
        onBack={() => setProfileView(null)}
        favStore={favStore}
        kycStore={kycStore}
        reviewStore={reviewStore}
        bookingStore={bookingStore}
        messagesStore={messagesStore}
        distanceKm={distances.get(profileView.id)}
        isOwner={!!address && profileView.walletAddress.toLowerCase() === address.toLowerCase()}
        viewerWallet={address}
      />
    )
  }

  return (
    <div className="pb-20">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="py-10 px-4">
        <div className="max-w-2xl mx-auto text-center mb-8">
          <h1
            className="display font-bold text-4xl sm:text-5xl mb-3"
            style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}
          >
            Find Local Services
          </h1>
          <p className="text-base text-pretty max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
            Tailors, barbers, mechanics, bakers, hotels, visa consultants and more — near you, from your community and beyond.
          </p>
        </div>

        {/* Search bar */}
        <div className="max-w-xl mx-auto mb-4">
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
            style={{
              background: 'var(--surface-strong)',
              borderColor: 'var(--border)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <Search size={18} style={{ color: 'var(--muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); resetPage() }}
              placeholder="Search by name, service, city, language…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--ink)' }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); resetPage() }}
                className="text-xs font-semibold transition-opacity hover:opacity-70"
                style={{ color: 'var(--muted)' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="max-w-4xl mx-auto mb-4">
          <div className="flex flex-wrap gap-2 justify-center">
            <CategoryChip
              label="All Services"
              active={activeCategoryId === 'all'}
              color="var(--accent)"
              onClick={() => { setActiveCategoryId('all'); resetPage() }}
            />
            {SERVICE_CATEGORIES.map((cat) => (
              <CategoryChip
                key={cat.id}
                label={cat.label}
                active={activeCategoryId === cat.id}
                color={cat.color}
                onClick={() => { setActiveCategoryId(cat.id); resetPage() }}
              />
            ))}
          </div>
        </div>

        {/* Controls row */}
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Near Me + community + favorites */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Near Me button */}
            <NearMeButton
              geo={geo}
              active={nearMeActive}
              onClick={handleNearMe}
            />

            {/* Community filter */}
            {communityTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
                  <Users size={12} /> Community:
                </span>
                {communityTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => { setCommunityFilter(communityFilter === tag ? '' : tag); resetPage() }}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: communityFilter === tag ? 'rgba(18,45,69,0.12)' : 'var(--surface-strong)',
                      color: communityFilter === tag ? 'var(--ink)' : 'var(--ink-2)',
                      border: `1.5px solid ${communityFilter === tag ? 'var(--border-strong)' : 'var(--border)'}`,
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Saved only toggle */}
            <button
              onClick={() => { setShowFavoritesOnly(!showFavoritesOnly); resetPage() }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: showFavoritesOnly ? 'rgba(186,43,76,0.10)' : 'var(--surface-strong)',
                color: showFavoritesOnly ? 'var(--danger)' : 'var(--ink-2)',
                border: `1.5px solid ${showFavoritesOnly ? 'rgba(186,43,76,0.25)' : 'var(--border)'}`,
              }}
            >
              <Heart size={11} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
              Saved
            </button>
          </div>

          {/* Right: filters + sort + view toggle */}
          <div className="flex items-center gap-2 ml-auto">
            {/* Advanced filters button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all relative"
              style={{
                background: showFilters ? 'var(--accent)' : 'var(--surface-strong)',
                color: showFilters ? '#fff' : 'var(--ink-2)',
                border: `1.5px solid ${showFilters ? 'transparent' : 'var(--border)'}`,
              }}
            >
              <SlidersHorizontal size={13} />
              Filters
              {activeFilterCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--danger)', color: '#fff' }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as SortOption); resetPage() }}
              className="text-xs font-semibold px-2 py-1.5 rounded-lg outline-none"
              style={{
                background: 'var(--surface-strong)',
                color: 'var(--ink-2)',
                border: '1.5px solid var(--border)',
              }}
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>

            {/* View mode */}
            <div
              className="flex rounded-lg overflow-hidden border"
              style={{ borderColor: 'var(--border)' }}
            >
              <button
                onClick={() => setViewMode('list')}
                className="px-2.5 py-1.5 transition-colors"
                style={{
                  background: viewMode === 'list' ? 'var(--accent)' : 'var(--surface-strong)',
                  color: viewMode === 'list' ? '#fff' : 'var(--muted)',
                }}
                title="List view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setViewMode('map')}
                className="px-2.5 py-1.5 transition-colors"
                style={{
                  background: viewMode === 'map' ? 'var(--accent)' : 'var(--surface-strong)',
                  color: viewMode === 'map' ? '#fff' : 'var(--muted)',
                }}
                title="Map view"
              >
                <MapIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Near me radius + geo error */}
        {nearMeActive && (
          <div className="max-w-4xl mx-auto mt-3">
            {geo.status === 'loading' && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Getting your location…</p>
            )}
            {geo.status === 'denied' && (
              <div
                className="rounded-xl px-4 py-3 flex items-start gap-2"
                style={{ background: 'rgba(186,43,76,0.08)' }}
              >
                <X size={13} style={{ color: 'var(--danger)' }} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{geo.reason}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    Use the city search below instead.
                  </p>
                </div>
              </div>
            )}
            {geo.status === 'granted' && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Within <strong style={{ color: 'var(--ink)' }}>{radiusKm} km</strong>
                </span>
                <input
                  type="range"
                  min={5}
                  max={500}
                  step={5}
                  value={radiusKm}
                  onChange={(e) => { setRadiusKm(Number(e.target.value)); resetPage() }}
                  className="flex-1 max-w-[200px]"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <button
                  onClick={() => { clearGeo(); setNearMeActive(false); setSortBy('featured-first') }}
                  className="text-xs font-semibold transition-opacity hover:opacity-70"
                  style={{ color: 'var(--danger)' }}
                >
                  Clear location
                </button>
              </div>
            )}
          </div>
        )}

        {/* Advanced filter panel */}
        {showFilters && (
          <AdvancedFilters
            languages={allLanguages}
            languageFilter={languageFilter}
            onLanguage={(v) => { setLanguageFilter(v); resetPage() }}
            minRating={minRating}
            onMinRating={(v) => { setMinRating(v); resetPage() }}
            mobileOnly={mobileOnly}
            onMobileOnly={(v) => { setMobileOnly(v); resetPage() }}
            openNowOnly={openNowOnly}
            onOpenNowOnly={(v) => { setOpenNowOnly(v); resetPage() }}
            maxPrice={maxPrice}
            onMaxPrice={(v) => { setMaxPrice(v); resetPage() }}
            manualCity={manualCity}
            onManualCity={(v) => { setManualCity(v); resetPage() }}
            isHotelView={activeCategoryId === 'hotels-stays'}
            hotelMaxNight={hotelMaxNight}
            onHotelMaxNight={(v) => { setHotelMaxNight(v); resetPage() }}
            onClear={() => {
              setMinRating(0); setMobileOnly(false); setOpenNowOnly(false)
              setLanguageFilter(''); setMaxPrice(0); setManualCity('')
              setHotelMaxNight(0); resetPage()
            }}
          />
        )}

        {/* Result count */}
        <p className="text-center text-xs mt-4" style={{ color: 'var(--subtle)' }}>
          {filtered.length} {filtered.length === 1 ? 'provider' : 'providers'} found
          {nearMeActive && geo.status === 'granted' ? ` within ${radiusKm} km` : ' worldwide'}
        </p>
      </section>

      {/* ── My profile banner ─────────────────────────────────────────────── */}
      {address && (
        <div className="max-w-6xl mx-auto px-4 mb-6 space-y-3">
          {/* KYC status — always show if not verified */}
          {myKycRecord?.status !== 'verified' && (
            <KycStatusBanner
              record={myKycRecord}
              onStartKyc={() => setShowKyc(true)}
              variant="compact"
            />
          )}

          {myProfile ? (
            <div
              className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4 border"
              style={{ background: 'rgba(26,128,71,0.07)', borderColor: 'rgba(26,128,71,0.25)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-white text-base"
                  style={{ background: 'var(--success)' }}
                >
                  {myProfile.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{myProfile.name}</p>
                  <p className="text-xs" style={{ color: 'var(--success)' }}>Your profile is live</p>
                </div>
              </div>
              <button
                onClick={() => setProfileView(myProfile)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: 'var(--success)', color: '#fff' }}
              >
                View my profile
              </button>
            </div>
          ) : (
            <div
              className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4 border"
              style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <MapPin size={18} style={{ color: 'var(--muted)' }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Offer a service?</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Create your free provider profile and reach customers worldwide.</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 shrink-0"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                + Create Profile
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Map / List view ────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4">
        {viewMode === 'map' && (
          <div className="mb-8">
            <MapPinView
              providers={filtered}
              userLat={userLat}
              userLng={userLng}
              onView={setProfileView}
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            onCreateProfile={address && !myProfile ? () => setShowCreate(true) : undefined}
            onClearFilters={() => {
              setQuery(''); setActiveCategoryId('all'); setCommunityFilter('')
              setMinRating(0); setMobileOnly(false); setOpenNowOnly(false)
              setLanguageFilter(''); setMaxPrice(0); setManualCity('')
              setNearMeActive(false); clearGeo(); setShowFavoritesOnly(false)
              resetPage()
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {paged.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onView={setProfileView}
                  distanceKm={distances.get(provider.id)}
                  favStore={favStore}
                />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-8 py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                  style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
                >
                  Show more ({filtered.length - paged.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateProviderModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            store.addProvider(p)
            setShowCreate(false)
            toast.success('Profile created! Complete KYC to make it visible in search.')
          }}
        />
      )}

      {/* KYC modal */}
      {showKyc && address && (
        <KycConsentModal
          walletAddress={address}
          record={myKycRecord}
          store={kycStore}
          onClose={() => setShowKyc(false)}
        />
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryChip({
  label, active, color, onClick,
}: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
      style={{
        background: active ? color : 'var(--surface-strong)',
        color: active ? '#fff' : 'var(--ink-2)',
        border: `1.5px solid ${active ? 'transparent' : 'var(--border)'}`,
      }}
    >
      {label}
    </button>
  )
}

function NearMeButton({
  geo, active, onClick,
}: { geo: ReturnType<typeof useGeolocation>['geo']; active: boolean; onClick: () => void }) {
  const loading = geo.status === 'loading'
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
      style={{
        background: active && geo.status === 'granted' ? 'rgba(16,97,166,0.12)' : 'var(--surface-strong)',
        color: active && geo.status === 'granted' ? '#1061a6' : 'var(--ink-2)',
        border: `1.5px solid ${active && geo.status === 'granted' ? 'rgba(16,97,166,0.30)' : 'var(--border)'}`,
      }}
    >
      <Navigation size={13} />
      {loading ? 'Locating…' : active && geo.status === 'granted' ? 'Near Me ✓' : 'Near Me'}
    </button>
  )
}

interface AdvancedFiltersProps {
  languages: string[]
  languageFilter: string
  onLanguage: (v: string) => void
  minRating: number
  onMinRating: (v: number) => void
  mobileOnly: boolean
  onMobileOnly: (v: boolean) => void
  openNowOnly: boolean
  onOpenNowOnly: (v: boolean) => void
  maxPrice: number
  onMaxPrice: (v: number) => void
  manualCity: string
  onManualCity: (v: string) => void
  isHotelView: boolean
  hotelMaxNight: number
  onHotelMaxNight: (v: number) => void
  onClear: () => void
}

function AdvancedFilters({
  languages, languageFilter, onLanguage,
  minRating, onMinRating,
  mobileOnly, onMobileOnly,
  openNowOnly, onOpenNowOnly,
  maxPrice, onMaxPrice,
  manualCity, onManualCity,
  isHotelView, hotelMaxNight, onHotelMaxNight,
  onClear,
}: AdvancedFiltersProps) {
  return (
    <div
      className="max-w-4xl mx-auto mt-4 rounded-2xl border p-5"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>Advanced Filters</p>
        <button
          onClick={onClear}
          className="text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--danger)' }}
        >
          Clear all
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Manual city / country search */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
            City or Country
          </label>
          <div className="relative">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
            <input
              type="text"
              value={manualCity}
              onChange={(e) => onManualCity(e.target.value)}
              placeholder="e.g. London, Nigeria…"
              className="w-full pl-8 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
                border: '1.5px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Language
          </label>
          <select
            value={languageFilter}
            onChange={(e) => onLanguage(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1.5px solid var(--border)',
            }}
          >
            <option value="">Any language</option>
            {languages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        {/* Min rating */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Min rating: <strong style={{ color: 'var(--ink)' }}>{minRating > 0 ? `${minRating}★+` : 'Any'}</strong>
          </label>
          <div className="flex gap-1">
            {[0, 3, 3.5, 4, 4.5].map((r) => (
              <button
                key={r}
                onClick={() => onMinRating(r)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: minRating === r ? 'var(--accent)' : 'var(--surface-muted)',
                  color: minRating === r ? '#fff' : 'var(--ink-2)',
                  border: `1.5px solid ${minRating === r ? 'transparent' : 'var(--border)'}`,
                }}
              >
                {r === 0 ? 'Any' : `${r}★`}
              </button>
            ))}
          </div>
        </div>

        {/* Max starting price */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Max starting price
          </label>
          <input
            type="number"
            value={maxPrice || ''}
            onChange={(e) => onMaxPrice(Number(e.target.value))}
            placeholder="No limit"
            min={0}
            step={10}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none tabular-nums"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1.5px solid var(--border)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>

        {/* Hotel max per night */}
        {isHotelView && (
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Hotel max per night
            </label>
            <input
              type="number"
              value={hotelMaxNight || ''}
              onChange={(e) => onHotelMaxNight(Number(e.target.value))}
              placeholder="No limit"
              min={0}
              step={1000}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none tabular-nums"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
                border: '1.5px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>
        )}

        {/* Toggle filters */}
        <div className="flex flex-col gap-2 justify-end">
          <ToggleRow
            label="Travels to customers (mobile service)"
            value={mobileOnly}
            onChange={onMobileOnly}
          />
          <ToggleRow
            label="Open now"
            value={openNowOnly}
            onChange={onOpenNowOnly}
          />
        </div>
      </div>
    </div>
  )
}

function ToggleRow({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{ background: value ? 'var(--accent)' : 'var(--border-strong)' }}
        onClick={() => onChange(!value)}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ left: value ? '18px' : '2px' }}
        />
      </div>
      <span className="text-xs" style={{ color: 'var(--ink-2)' }}>{label}</span>
    </label>
  )
}

function EmptyState({
  onCreateProfile, onClearFilters,
}: { onCreateProfile?: () => void; onClearFilters: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <Search size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />
      <div>
        <p className="font-semibold text-base" style={{ color: 'var(--ink-2)' }}>No providers found</p>
        <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--muted)' }}>
          Try a different search, category, location, or clear your filters.
        </p>
      </div>
      <button
        onClick={onClearFilters}
        className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
        style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
      >
        Clear all filters
      </button>
      {onCreateProfile && (
        <button
          onClick={onCreateProfile}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{ background: 'var(--accent)', color: '#ffffff' }}
        >
          Be the first to list here
        </button>
      )}
    </div>
  )
}


