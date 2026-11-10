import { useEffect, useState } from 'react'
import {
  ArrowLeft, MapPin, Phone, Mail, Globe, Instagram,
  MessageCircle, Star, Clock, Briefcase, Languages,
  Shield, AlertTriangle, Share2, Check, Navigation, Flag,
} from 'lucide-react'
import { toast } from 'sonner'
import { PortfolioGallery } from './PortfolioGallery'
import { VerificationBadge } from './VerificationBadge'
import { SaveButton } from './SaveButton'
import { KycStatusBanner } from './KycStatusBanner'
import { KycConsentModal } from './KycConsentModal'
import { ScamReportModal } from './ScamReportModal'
import { ReviewsSection } from './ReviewsSection'
import { MessagingPanel } from './MessagingPanel'
import { BookingModal } from './BookingModal'
import { PaymentModal } from './PaymentModal'
import { getCategoryById } from '../../services/categories'
import { formatDistance } from '../../services/useDistance'
import { safeHttpUrl } from '../../lib/safe'
import type { ServiceProvider } from '../../services/types'
import type { FavoritesStore } from '../../services/useFavorites'
import type { KycStore } from '../../services/useKyc'
import type { ReviewsStore } from '../../services/useReviews'
import type { BookingsStore } from '../../services/useBookings'
import type { MessagesStore } from '../../services/useMessages'

interface ProviderProfilePageProps {
  provider:       ServiceProvider
  onBack:         () => void
  favStore?:      FavoritesStore
  kycStore?:      KycStore
  reviewStore?:   ReviewsStore
  bookingStore?:  BookingsStore
  messagesStore?: MessagesStore
  distanceKm?:    number
  isOwner?:       boolean
  viewerWallet?:  string
  isAdmin?:       boolean
}

function StarRow({ average, count }: { average: number; count: number }) {
  const full = Math.floor(average)
  const half = average - full >= 0.5
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={16}
            fill={i < full || (i === full && half) ? '#f59e0b' : 'none'}
            style={{ color: i < full || (i === full && half) ? '#f59e0b' : 'var(--border-strong)' }}
          />
        ))}
      </div>
      <span className="font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
        {average > 0 ? average.toFixed(1) : '—'}
      </span>
      {count > 0 && (
        <span className="text-sm" style={{ color: 'var(--muted)' }}>
          ({count} {count === 1 ? 'review' : 'reviews'})
        </span>
      )}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="display font-bold text-base mb-3" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
      {children}
    </h3>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }}>{icon}</span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--subtle)' }}>{label}</p>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{value}</p>
      </div>
    </div>
  )
}

export function ProviderProfilePage({
  provider, onBack, favStore, kycStore, reviewStore,
  bookingStore, messagesStore,
  distanceKm, isOwner, viewerWallet, isAdmin,
}: ProviderProfilePageProps) {
  const category = getCategoryById(provider.categoryId)
  const [shareCopied,    setShareCopied]    = useState(false)
  const [showKyc,        setShowKyc]        = useState(false)
  const [showReport,     setShowReport]     = useState(false)
  const [showMessaging,  setShowMessaging]  = useState(false)
  const [showBooking,    setShowBooking]    = useState(false)
  const [showPayment,    setShowPayment]    = useState(false)
  const [activeBooking,  setActiveBooking]  = useState<import('../../services/useBookings').Booking | null>(null)

  const myKycRecord = isOwner && kycStore && viewerWallet
    ? kycStore.getRecord(viewerWallet)
    : undefined

  // Inject SEO meta tags for shareability (best effort in SPA context)
  useEffect(() => {
    const prev = document.title
    document.title = `${provider.name} — ${provider.tagline} | TradePort`
    return () => { document.title = prev }
  }, [provider.name, provider.tagline])

  const locationLabel = provider.location.showFullAddress && provider.location.streetAddress
    ? `${provider.location.streetAddress}, ${provider.location.city}, ${provider.location.country}`
    : `${provider.location.city}${provider.location.stateRegion ? `, ${provider.location.stateRegion}` : ''}, ${provider.location.country}`

  function handleShare() {
    const url = window.location.href + '?provider=' + provider.id
    if (navigator.share) {
      void navigator.share({ title: provider.name, text: provider.tagline, url }).catch(() => {
        // user cancelled — no-op
      })
    } else {
      void navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
        toast.success('Profile link copied!')
      }).catch(() => {
        toast.error('Could not copy link.')
      })
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-5 text-sm font-semibold transition-opacity hover:opacity-70"
        style={{ color: 'var(--accent-hover)' }}
      >
        <ArrowLeft size={16} /> Back to Services
      </button>

      {/* Hero card */}
      <div
        className="rounded-2xl overflow-hidden border mb-5"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        {/* Cover / photo */}
        <div className="relative">
          {provider.profilePhotoUrl ? (
            <img referrerPolicy="no-referrer"
              src={provider.profilePhotoUrl}
              alt={provider.name}
              className="w-full h-56 object-cover"
            />
          ) : (
            <div
              className="w-full h-40 flex items-center justify-center"
              style={{ background: `${category?.color ?? '#374151'}22` }}
            >
              <span
                className="display font-bold text-7xl opacity-30"
                style={{ color: category?.color ?? 'var(--muted)' }}
              >
                {provider.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          {/* Sponsored ribbon */}
          {provider.isFeatured && (
            <div
              className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-xs font-bold"
              style={{ background: 'rgba(16,97,166,0.85)', color: '#fff' }}
            >
              Sponsored
            </div>
          )}

          {/* Distance badge */}
          {distanceKm !== undefined && (
            <div
              className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
              style={{ background: 'rgba(16,97,166,0.85)', color: '#fff' }}
            >
              <Navigation size={11} />
              {formatDistance(distanceKm)} away
            </div>
          )}

          {/* Share + Save buttons */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {favStore && (
              <SaveButton
                providerId={provider.id}
                providerName={provider.name}
                store={favStore}
                size="md"
              />
            )}
            <button
              onClick={handleShare}
              className="w-9 h-9 flex items-center justify-center rounded-full transition-all"
              style={{ background: 'rgba(255,255,255,0.90)', color: 'var(--ink)' }}
            >
              {shareCopied ? <Check size={16} style={{ color: 'var(--success)' }} /> : <Share2 size={15} />}
            </button>
          </div>
        </div>

        {/* Identity block */}
        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="display font-bold text-2xl" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              {provider.name}
            </h1>
            <VerificationBadge level={provider.verificationLevel} size="md" />
          </div>

          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{provider.tagline}</p>

          {/* Rating */}
          <div className="mb-3">
            <StarRow average={provider.ratingAverage} count={provider.reviewCount} />
          </div>

          {/* Category + community tag */}
          <div className="flex flex-wrap gap-2">
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
              style={{ background: category?.color ?? '#374151' }}
            >
              {provider.subcategory ?? category?.label}
            </span>
            {provider.communityTag && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
              >
                {provider.communityTag} community
              </span>
            )}
            {provider.location.serviceMode === 'mobile' && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}
              >
                Travels to customers
              </span>
            )}
            {provider.location.serviceMode === 'both' && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}
              >
                Shop + Mobile
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KYC banner — only shown to the profile owner if not yet verified */}
      {isOwner && kycStore && viewerWallet && myKycRecord?.status !== 'verified' && (
        <KycStatusBanner
          record={myKycRecord}
          onStartKyc={() => setShowKyc(true)}
          variant="full"
        />
      )}

      {/* Report scam button — shown to non-owner visitors */}
      {!isOwner && kycStore && viewerWallet && (
        <button
          onClick={() => setShowReport(true)}
          className="w-full mb-5 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border transition-all hover:opacity-80"
          style={{
            background: 'rgba(186,43,76,0.06)',
            color: 'var(--danger)',
            borderColor: 'rgba(186,43,76,0.22)',
          }}
        >
          <Flag size={15} />
          Report a problem with this provider
        </button>
      )}

      {/* Visa agent disclaimer */}
      {provider.categoryId === 'visa-immigration' && (
        <div
          className="rounded-2xl px-5 py-4 mb-5 flex items-start gap-3"
          style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.20)' }}
        >
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} className="mt-0.5" />
          <div>
            <p className="font-bold text-sm mb-0.5" style={{ color: 'var(--danger)' }}>
              Always verify consultants
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              Never pay the full fee upfront to any visa consultant. Request written agreements and receipts. Fake documents and forged visas are illegal and will result in a permanent ban from this platform.
            </p>
          </div>
        </div>
      )}

      {/* Bio */}
      <div
        className="rounded-2xl p-5 mb-5 border"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionHeading>About</SectionHeading>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          {provider.bio}
        </p>
      </div>

      {/* Quick facts */}
      <div
        className="rounded-2xl p-5 mb-5 border"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionHeading>Details</SectionHeading>

        <InfoRow icon={<MapPin size={15} />} label="Location" value={locationLabel} />

        {provider.location.serviceMode === 'mobile' && provider.location.serviceRadiusKm && (
          <InfoRow icon={<MapPin size={15} />} label="Service Radius" value={`${provider.location.serviceRadiusKm} km from ${provider.location.city}`} />
        )}

        {provider.yearsExperience !== undefined && (
          <InfoRow icon={<Briefcase size={15} />} label="Experience" value={`${provider.yearsExperience} years`} />
        )}

        {provider.languagesSpoken.length > 0 && (
          <InfoRow icon={<Languages size={15} />} label="Languages" value={provider.languagesSpoken.join(', ')} />
        )}

        {provider.workingHours?.note && (
          <InfoRow icon={<Clock size={15} />} label="Hours" value={provider.workingHours.note} />
        )}

        <InfoRow
          icon={<Shield size={15} />}
          label="Verification"
          value={
            provider.verificationLevel === 'none' ? 'Unverified profile'
            : provider.verificationLevel === 'basic' ? 'Basic — email / phone verified'
            : provider.verificationLevel === 'kyc' ? 'KYC Verified — ID document checked'
            : provider.verificationLevel === 'business' ? 'Business Verified — registration documents reviewed'
            : 'Credentials Reviewed — admin verified license / accreditation'
          }
        />
      </div>

      {/* Services list */}
      {provider.services.length > 0 && (
        <div
          className="rounded-2xl p-5 mb-5 border"
          style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
        >
          <SectionHeading>Services & Pricing</SectionHeading>
          <div className="space-y-3">
            {provider.services.map((svc) => (
              <div
                key={svc.id}
                className="flex items-start justify-between gap-3 py-3 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex-1">
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{svc.name}</p>
                  {svc.description && (
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{svc.description}</p>
                  )}
                </div>
                {svc.startingPrice !== undefined && (
                  <div className="text-right shrink-0">
                    <p className="text-xs" style={{ color: 'var(--subtle)' }}>from</p>
                    <p className="font-bold tabular-nums text-sm" style={{ color: 'var(--ink)' }}>
                      {svc.currency} {svc.startingPrice.toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hotel room types */}
      {provider.hotelExtras && (
        <div
          className="rounded-2xl p-5 mb-5 border"
          style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
        >
          <SectionHeading>Rooms & Rates</SectionHeading>
          <div className="space-y-2 mb-4">
            {provider.hotelExtras.roomTypes.map((room, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <p className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{room.name}</p>
                <p className="font-bold tabular-nums text-sm" style={{ color: 'var(--ink)' }}>
                  {room.currency} {room.pricePerNight.toLocaleString()} <span className="font-normal text-xs" style={{ color: 'var(--muted)' }}>/night</span>
                </p>
              </div>
            ))}
          </div>

          {provider.hotelExtras.amenities.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Amenities</p>
              <div className="flex flex-wrap gap-2">
                {provider.hotelExtras.amenities.map((a) => (
                  <span key={a} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
                    {a}
                  </span>
                ))}
              </div>
            </>
          )}

          {(provider.hotelExtras.checkInTime || provider.hotelExtras.checkOutTime) && (
            <div className="flex gap-6 mt-3">
              {provider.hotelExtras.checkInTime && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>Check-in</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{provider.hotelExtras.checkInTime}</p>
                </div>
              )}
              {provider.hotelExtras.checkOutTime && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>Check-out</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{provider.hotelExtras.checkOutTime}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Visa agent extras */}
      {provider.visaAgentExtras && (
        <div
          className="rounded-2xl p-5 mb-5 border"
          style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
        >
          <SectionHeading>Visa & Immigration Details</SectionHeading>

          {provider.visaAgentExtras.countriesServed.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Countries Served</p>
              <div className="flex flex-wrap gap-2">
                {provider.visaAgentExtras.countriesServed.map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          {provider.visaAgentExtras.visaTypes.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--subtle)' }}>Visa Types</p>
              <div className="flex flex-wrap gap-2">
                {provider.visaAgentExtras.visaTypes.map((v) => (
                  <span key={v} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(29,78,216,0.08)', color: '#1d4ed8' }}>{v}</span>
                ))}
              </div>
            </div>
          )}

          {provider.visaAgentExtras.feeStructure && (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--subtle)' }}>Fee Structure</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>{provider.visaAgentExtras.feeStructure}</p>
            </div>
          )}

          {(provider.visaAgentExtras.businessRegNumber || provider.visaAgentExtras.licenseDetails) && (
            <div
              className="rounded-xl px-4 py-3 flex items-start gap-2"
              style={{ background: 'rgba(26,128,71,0.08)' }}
            >
              <Shield size={14} style={{ color: 'var(--success)', flexShrink: 0 }} className="mt-0.5" />
              <div>
                {provider.visaAgentExtras.businessRegNumber && (
                  <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                    Reg No: <span className="font-semibold mono">{provider.visaAgentExtras.businessRegNumber}</span>
                  </p>
                )}
                {provider.visaAgentExtras.licenseDetails && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>{provider.visaAgentExtras.licenseDetails}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Portfolio */}
      {provider.portfolio.filter((p) => !p.flagged).length > 0 && (
        <div
          className="rounded-2xl p-5 mb-5 border"
          style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
        >
          <SectionHeading>Portfolio</SectionHeading>
          <PortfolioGallery items={provider.portfolio} />
        </div>
      )}

      {/* Reviews */}
      {reviewStore && kycStore && (
        <ReviewsSection
          provider={provider}
          reviewStore={reviewStore}
          kycStore={kycStore}
          viewerWallet={viewerWallet}
          isAdmin={isAdmin}
        />
      )}

      {/* ── Action buttons (non-owner only) ─── */}
      {!isOwner && !!(viewerWallet) && (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => {
              if (!messagesStore) return
              setShowMessaging(true)
            }}
            className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] border"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}
          >
            <MessageCircle size={18} style={{ color: 'var(--accent)' }} />
            <span className="text-xs">Message</span>
          </button>

          <button
            onClick={() => {
              if (!bookingStore) return
              if (!viewerWallet) { toast.error('Connect your wallet first'); return }
              setShowBooking(true)
            }}
            className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] border"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', borderColor: 'var(--border)' }}
          >
            <Clock size={18} style={{ color: 'var(--accent)' }} />
            <span className="text-xs">Book</span>
          </button>

          <button
            onClick={() => {
              if (!bookingStore) return
              setShowPayment(true)
            }}
            className="flex flex-col items-center gap-1.5 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Shield size={18} />
            <span className="text-xs">Pay</span>
          </button>
        </div>
      )}

      {/* Contact */}
      <div
        className="rounded-2xl p-5 border"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionHeading>Get in Touch</SectionHeading>
        <div className="space-y-3">
          {provider.contact.whatsapp && (
            <a
              href={`https://wa.me/${provider.contact.whatsapp.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
              style={{ background: '#25d366', color: '#fff' }}
            >
              <MessageCircle size={16} />
              Message on WhatsApp
            </a>
          )}

          {provider.contact.phone && (
            <a
              href={`tel:${provider.contact.phone.replace(/[^+\d]/g, '')}`}
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all border"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <Phone size={15} />
              {provider.contact.phone}
            </a>
          )}

          {provider.contact.email && (
            <a
              href={`mailto:${encodeURIComponent(provider.contact.email)}`}
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all border"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <Mail size={15} />
              {provider.contact.email}
            </a>
          )}

          {safeHttpUrl(provider.contact.website) && (
            <a
              href={safeHttpUrl(provider.contact.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all border"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <Globe size={15} />
              Website
            </a>
          )}

          {provider.contact.instagram && (
            <a
              href={`https://instagram.com/${encodeURIComponent(provider.contact.instagram.replace(/^@/, ''))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all border"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <Instagram size={15} />
              @{provider.contact.instagram}
            </a>
          )}
        </div>
      </div>

      {/* KYC modal (owner flow) */}
      {showKyc && kycStore && viewerWallet && (
        <KycConsentModal
          walletAddress={viewerWallet}
          record={myKycRecord}
          store={kycStore}
          onClose={() => setShowKyc(false)}
        />
      )}

      {/* Scam report modal (visitor flow) */}
      {showReport && kycStore && viewerWallet && (
        <ScamReportModal
          providerName={provider.name}
          providerId={provider.id}
          reporterWallet={viewerWallet}
          store={kycStore}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Messaging panel — open into the conversation with this provider */}
      {showMessaging && messagesStore && viewerWallet && (
        <MessagingPanel
          viewerWallet={viewerWallet}
          store={messagesStore}
          initialConversationId={
            messagesStore.getOrCreateConversation(
              provider.walletAddress,
              viewerWallet,
              provider.id,
              provider.name,
            ).id
          }
          onBack={() => setShowMessaging(false)}
        />
      )}

      {/* Booking / inquiry modal */}
      {showBooking && bookingStore && viewerWallet && (
        <BookingModal
          provider={provider}
          customerWallet={viewerWallet}
          bookingStore={bookingStore}
          onClose={() => setShowBooking(false)}
          onGoToPayment={(bookingId) => {
            const booking = bookingStore.bookings.find((b) => b.id === bookingId) ?? null
            setActiveBooking(booking)
            setShowBooking(false)
            if (booking) setShowPayment(true)
          }}
        />
      )}

      {/* Payment modal — needs an active booking */}
      {showPayment && bookingStore && activeBooking && (
        <PaymentModal
          booking={activeBooking}
          bookingStore={bookingStore}
          onClose={() => {
            setShowPayment(false)
            setActiveBooking(null)
          }}
        />
      )}
    </div>
  )
}
