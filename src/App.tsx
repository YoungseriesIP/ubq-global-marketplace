import { useState, useMemo, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { PackageOpen, TrendingUp, Globe, ShieldCheck, Lock } from 'lucide-react'
import { Navbar } from './components/Navbar'
import type { AppView } from './components/Navbar'
import { ListingCard } from './components/ListingCard'
import { CreateListingModal } from './components/CreateListingModal'
import { BuyModal } from './components/BuyModal'
import { HeroSearch } from './components/HeroSearch'
import { ServicesDirectory } from './components/services/ServicesDirectory'
import { AdminPanel } from './components/services/AdminPanel'
import { CountryFilterBanner } from './components/CountryFilterBanner'
import { useProviders } from './services/data'
import { useKyc } from './services/useKyc'
import { useReviews } from './services/useReviews'
import { useBookings } from './services/useBookings'
import { useMessages } from './services/useMessages'
import { useCountryFilter } from './services/useCountryFilter'
import { useAuth } from './auth/AuthContext'
import { SecurityPage } from './security/SecurityPage'
import { StaffConsole } from './security/StaffConsole'
import { CurrencyProvider } from './lib/currency'
import { api, toListing } from './lib/api'
import type { ApiListing } from './lib/api'
import { ShopPage } from './components/ShopPage'
import type { Listing, Category } from './types'

// ─── Admin wallet addresses (lowercase) ──────────────────────────────────────
// Comma-separated list in VITE_ADMIN_ADDRESSES. Empty by default, so nobody sees the admin button.
// Note: the admin panel only manages data kept in this browser. It is not a security boundary.
const ADMIN_WALLETS: string[] = ((import.meta.env.VITE_ADMIN_ADDRESSES as string | undefined) ?? '')
  .split(',')
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean)

export default function App() {
  const { user } = useAuth()
  const address = user?.address
  const providersStore  = useProviders()
  const kycStore        = useKyc()
  const reviewStore     = useReviews()
  const bookingStore    = useBookings()
  const messagesStore   = useMessages()
  const countryFilter   = useCountryFilter()

  const isAdmin = !!address && ADMIN_WALLETS.includes(address.toLowerCase())

  const [view, setView]           = useState<AppView>('marketplace')

  // Record the consent given in the sign-in window once the session exists.
  useEffect(() => {
    if (!user || localStorage.getItem('tp_consent_pending') !== '1') return
    localStorage.removeItem('tp_consent_pending')
    void Promise.all([
      api('/security/consent', { body: { kind: 'terms', version: '1' } }),
      api('/security/consent', { body: { kind: 'privacy', version: '1' } }),
    ]).catch(() => { /* retried at the next sign-in */ })
  }, [user])
  const [showAdmin, setShowAdmin] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [buyTarget, setBuyTarget] = useState<Listing | null>(null)
  const [listings, setListings]   = useState<Listing[]>([])
  const [listingsLoading, setListingsLoading] = useState(true)
  const [listingsError, setListingsError] = useState('')
  const [query, setQuery]         = useState('')
  const [activeCategory, setActiveCategory] = useState<Category | 'All'>('All')

  // Filter for marketplace view (includes country filter)
  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      const matchesCategory = activeCategory === 'All' || l.category === activeCategory
      const q = query.toLowerCase()
      const matchesQuery =
        !q ||
        l.title.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.location.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      // Country filter: if a country is active, show only listings in that country
      // (listings without a countryCode pass through so legacy items stay visible)
      const matchesCountry =
        !countryFilter.country ||
        !l.countryCode ||
        l.countryCode === countryFilter.country
      return matchesCategory && matchesQuery && matchesCountry
    })
  }, [listings, query, activeCategory, countryFilter.country])

  // My listings
  const myListings = useMemo(
    () => (address ? listings.filter((l) => l.sellerAddress.toLowerCase() === address.toLowerCase()) : []),
    [listings, address],
  )

  // Shared listings from every seller, loaded from the API
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    api<{ listings: ApiListing[] }>('/listings', { auth: false })
      .then((r) => {
        if (cancelled) return
        setListings(r.listings.map(toListing))
        setListingsError('')
        setListingsLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setListingsError('Could not load listings right now.')
        setListingsLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadKey])

  const reloadListings = useCallback(() => {
    setListingsLoading(true)
    setListingsError('')
    setReloadKey((k) => k + 1)
  }, [])

  function handleCreated(listing: Listing) {
    setListings((prev) => [listing, ...prev])
    toast.success('Your item is live')
  }

  async function handleRemove(id: string) {
    try {
      await api(`/listings/${id}`, { method: 'DELETE' })
      setListings((prev) => prev.filter((l) => l.id !== id))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <CurrencyProvider countryCode={countryFilter.country}>
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      <Navbar
        onSell={() => setShowCreate(true)}
        view={view}
        setView={setView}
        isAdmin={isAdmin}
        onAdmin={() => setShowAdmin(true)}
      />

      {/* Country filter bar — shown on all views */}
      <CountryFilterBanner filter={countryFilter} />

      <main className="max-w-6xl mx-auto pb-20">
        {view === 'security' && <SecurityPage onBack={() => setView('marketplace')} />}
        {view === 'staff' && <StaffConsole onBack={() => setView('marketplace')} />}
        {view === 'services' && (
          <ServicesDirectory
            store={providersStore}
            kycStore={kycStore}
            reviewStore={reviewStore}
            bookingStore={bookingStore}
            messagesStore={messagesStore}
            countryFilter={countryFilter}
          />
        )}

        {view === 'marketplace' && (
          <>
            <HeroSearch
              query={query}
              setQuery={setQuery}
              activeCategory={activeCategory}
              setCategory={setActiveCategory}
              listingCount={filteredListings.length}
            />

            {listingsLoading ? (
              <p className="text-center text-sm py-24" style={{ color: 'var(--muted)' }}>Loading listings…</p>
            ) : listingsError ? (
              <EmptyState
                icon={<PackageOpen size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />}
                title="Listings are unavailable"
                body={listingsError}
                cta={{ label: 'Try again', onClick: reloadListings }}
              />
            ) : filteredListings.length === 0 ? (
              <EmptyState
                icon={<PackageOpen size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />}
                title="No listings found"
                body="Try adjusting your search, category or country filter."
              />
            ) : (
              <div className="px-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    onBuy={setBuyTarget}
                    isOwner={
                      !!address &&
                      listing.sellerAddress.toLowerCase() === address.toLowerCase()
                    }
                    onRemove={(id) => void handleRemove(id)}
                  />
                ))}
              </div>
            )}

            {/* Trust strip */}
            <TrustStrip />
          </>
        )}

        {view === 'my-listings' && (
          <ShopPage
            listings={myListings}
            onSell={() => setShowCreate(true)}
            onRemove={(id) => void handleRemove(id)}
          />
        )}
      </main>

      {/* Modals */}
      {showCreate && (
        <CreateListingModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
      {buyTarget && (
        <BuyModal
          listing={buyTarget}
          onClose={() => setBuyTarget(null)}
        />
      )}

      {/* Admin panel — full-screen overlay, only mounts when open */}
      {showAdmin && isAdmin && (
        <AdminPanel
          kycStore={kycStore}
          providerStore={providersStore}
          reviewStore={reviewStore}
          onClose={() => setShowAdmin(false)}
        />
      )}
    </div>
    </CurrencyProvider>
  )
}

// ---- Small shared components ----

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  body: string
  cta?: { label: string; onClick: () => void }
}

function EmptyState({ icon, title, body, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 px-4 text-center">
      {icon}
      <div>
        <p className="font-semibold text-base" style={{ color: 'var(--ink-2)' }}>{title}</p>
        <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--muted)' }}>{body}</p>
      </div>
      {cta && (
        <button
          onClick={cta.onClick}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{ background: 'var(--accent)', color: '#ffffff' }}
        >
          {cta.label}
        </button>
      )}
    </div>
  )
}

function TrustStrip() {
  const features = [
    {
      icon: <Globe size={20} style={{ color: 'var(--accent)' }} />,
      title: 'Cross-border payments',
      body: 'USDC works everywhere — no FX conversion, no bank fees.',
    },
    {
      icon: <TrendingUp size={20} style={{ color: 'var(--accent)' }} />,
      title: 'Instant settlement',
      body: 'Funds reach the seller within seconds, not days.',
    },
    {
      icon: <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />,
      title: 'Non-custodial',
      body: 'You hold your own wallet. No middleman holds your money.',
    },
    {
      icon: <Lock size={20} style={{ color: 'var(--accent)' }} />,
      title: 'Escrow protection',
      body: 'Funds held in a smart contract, released only when both parties confirm.',
    },
  ]

  return (
    <div className="px-4 mt-16">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl p-5 border"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
          >
            <div className="mb-3">{f.icon}</div>
            <p className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>{f.title}</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
