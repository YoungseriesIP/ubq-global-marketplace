import { MapPin, Tag, Clock, Store } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useCurrency } from '@/lib/currency'
import type { Listing } from '../types'

interface ListingCardProps {
  listing: Listing
  onBuy: (listing: Listing) => void
  isOwner?: boolean
  onRemove?: (id: string) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  Electronics: '#1061a6',
  Fashion: '#7c3aed',
  Art: '#b45309',
  Books: '#065f46',
  Collectibles: '#9f1239',
  Home: '#0f766e',
  Sports: '#1d4ed8',
  Other: '#374151',
}

export function ListingCard({ listing, onBuy, isOwner, onRemove }: ListingCardProps) {
  const categoryColor = CATEGORY_COLORS[listing.category] ?? CATEGORY_COLORS['Other']
  const timeAgo = getTimeAgo(listing.createdAt)
  const { localText } = useCurrency()
  const local = localText(listing.price)

  return (
    <div
      className="rounded-2xl overflow-hidden border transition-all hover:shadow-lg group"
      style={{
        background: 'var(--surface-strong)',
        borderColor: 'var(--border)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Image area */}
      <div
        className="w-full h-44 flex items-center justify-center relative overflow-hidden"
        style={{ background: 'var(--surface-muted)' }}
      >
        {listing.imageUrl ? (
          <img referrerPolicy="no-referrer"
            src={listing.imageUrl}
            alt={listing.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-30">
            <Tag size={32} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>No image</span>
          </div>
        )}
        {/* Category badge */}
        <span
          className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-xs font-semibold text-white"
          style={{ background: categoryColor }}
        >
          {listing.category}
        </span>
        {/* Chain badge */}
        <span
          className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs font-semibold"
          style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--ink-2)' }}
        >
          {listing.chain}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3
          className="font-semibold text-base leading-snug mb-1 line-clamp-1"
          style={{ color: 'var(--ink)' }}
        >
          {listing.title}
        </h3>
        <p
          className="text-sm leading-relaxed mb-3 line-clamp-2"
          style={{ color: 'var(--muted)' }}
        >
          {listing.description}
        </p>

        {listing.sellerName && (
          <p className="flex items-center gap-1 text-xs mb-2" style={{ color: 'var(--muted)' }}>
            <Store size={11} /> {listing.sellerName}
          </p>
        )}

        {/* Location + time */}
        <div className="flex items-center gap-3 mb-3">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <MapPin size={11} />
            {listing.location}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <Clock size={11} />
            {timeAgo}
          </span>
        </div>

        {/* Price + CTA row */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              {local ? null : <TokenUSDC variant="branded" size={18} />}
              <span
                className="display font-bold text-xl tabular-nums"
                style={{ color: 'var(--ink)' }}
              >
                {local ?? listing.price.toFixed(2)}
              </span>
              {local ? null : <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>USDC</span>}
            </div>
            {local && (
              <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                {listing.price.toFixed(2)} USDC
              </p>
            )}
          </div>

          {isOwner ? (
            <button
              onClick={() => onRemove?.(listing.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}
            >
              Remove
            </button>
          ) : (
            <button
              onClick={() => onBuy(listing)}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 hover:opacity-90"
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              Buy Now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
