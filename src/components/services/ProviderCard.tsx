import { MapPin, Star, Clock, Navigation } from 'lucide-react'
import { VerificationBadge } from './VerificationBadge'
import { SaveButton } from './SaveButton'
import { getCategoryById } from '../../services/categories'
import { formatDistance } from '../../services/useDistance'
import type { ServiceProvider } from '../../services/types'
import type { FavoritesStore } from '../../services/useFavorites'

interface ProviderCardProps {
  provider: ServiceProvider
  onView: (provider: ServiceProvider) => void
  distanceKm?: number
  favStore?: FavoritesStore
}

function StarRow({ average, count }: { average: number; count: number }) {
  const full = Math.floor(average)
  const half = average - full >= 0.5
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={11}
            fill={i < full || (i === full && half) ? '#f59e0b' : 'none'}
            style={{ color: i < full || (i === full && half) ? '#f59e0b' : 'var(--border-strong)' }}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
        {average.toFixed(1)}
      </span>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>
        ({count})
      </span>
    </div>
  )
}

export function ProviderCard({ provider, onView, distanceKm, favStore }: ProviderCardProps) {
  const category = getCategoryById(provider.categoryId)

  const locationLabel = provider.location.showFullAddress && provider.location.streetAddress
    ? `${provider.location.streetAddress}, ${provider.location.city}`
    : `${provider.location.city}, ${provider.location.country}`

  const mobileLabel = provider.location.serviceMode === 'mobile'
    ? 'Travels to you'
    : provider.location.serviceMode === 'both'
      ? 'Shop + Mobile'
      : null

  return (
    <div
      className="rounded-2xl overflow-hidden border transition-all hover:shadow-lg group cursor-pointer"
      style={{
        background: 'var(--surface-strong)',
        borderColor: provider.isFeatured ? 'rgba(16,97,166,0.35)' : 'var(--border)',
        backdropFilter: 'blur(12px)',
      }}
      onClick={() => onView(provider)}
    >
      {/* Featured ribbon */}
      {provider.isFeatured && (
        <div
          className="px-3 py-0.5 text-center text-xs font-bold uppercase tracking-widest"
          style={{ background: 'rgba(16,97,166,0.10)', color: '#1061a6' }}
        >
          Sponsored
        </div>
      )}

      {/* Photo area */}
      <div
        className="w-full h-40 relative overflow-hidden"
        style={{ background: 'var(--surface-muted)' }}
      >
        {provider.profilePhotoUrl ? (
          <img referrerPolicy="no-referrer"
            src={provider.profilePhotoUrl}
            alt={provider.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span
              className="display font-bold text-4xl"
              style={{ color: category?.color ?? 'var(--muted)', opacity: 0.3 }}
            >
              {provider.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Category badge */}
        <span
          className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-xs font-semibold text-white"
          style={{ background: category?.color ?? '#374151' }}
        >
          {provider.subcategory ?? category?.label}
        </span>

        {/* Distance badge */}
        {distanceKm !== undefined && (
          <span
            className="absolute bottom-3 left-3 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1"
            style={{ background: 'rgba(16,97,166,0.85)', color: '#fff' }}
          >
            <Navigation size={9} />
            {formatDistance(distanceKm)}
          </span>
        )}

        {/* Portfolio count */}
        {provider.portfolio.filter((p) => !p.flagged).length > 0 && (
          <span
            className="absolute bottom-3 right-3 px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1"
            style={{ background: 'rgba(18,45,69,0.70)', color: '#fff' }}
          >
            {provider.portfolio.filter((p) => !p.flagged).length} photos
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Name + badge + save */}
        <div className="flex items-start gap-2 mb-1">
          <h3
            className="font-semibold text-base leading-snug line-clamp-1 flex-1"
            style={{ color: 'var(--ink)' }}
          >
            {provider.name}
          </h3>
          <VerificationBadge level={provider.verificationLevel} size="sm" />
          {favStore && (
            <SaveButton
              providerId={provider.id}
              providerName={provider.name}
              store={favStore}
              size="sm"
            />
          )}
        </div>

        {/* Tagline */}
        <p className="text-sm line-clamp-1 mb-2" style={{ color: 'var(--muted)' }}>
          {provider.tagline}
        </p>

        {/* Rating */}
        {provider.reviewCount > 0 && (
          <div className="mb-2">
            <StarRow average={provider.ratingAverage} count={provider.reviewCount} />
          </div>
        )}

        {/* Location + mobile */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <MapPin size={11} />
            {locationLabel}
          </span>
          {mobileLabel && (
            <span
              className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}
            >
              <Clock size={10} />
              {mobileLabel}
            </span>
          )}
        </div>

        {/* Community tag */}
        {provider.communityTag && (
          <div className="mb-3">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
            >
              {provider.communityTag} community
            </span>
          </div>
        )}

        {/* Services preview */}
        {provider.services.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--subtle)' }}>
              FROM
            </p>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {provider.services[0].startingPrice !== undefined
                ? `${provider.services[0].currency ?? ''} ${provider.services[0].startingPrice.toLocaleString()}`
                : 'Price on request'}
            </p>
          </div>
        )}

        {/* Hotel room preview */}
        {provider.hotelExtras && provider.hotelExtras.roomTypes.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--subtle)' }}>
              FROM / NIGHT
            </p>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {provider.hotelExtras.roomTypes[0].currency}{' '}
              {provider.hotelExtras.roomTypes[0].pricePerNight.toLocaleString()}
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={(e) => { e.stopPropagation(); onView(provider) }}
          className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
          style={{ background: 'var(--accent)', color: '#ffffff' }}
        >
          View Profile
        </button>
      </div>
    </div>
  )
}
