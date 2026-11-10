import { Search } from 'lucide-react'
import type { Category } from '../types'

const CATEGORIES: Array<{ label: string; value: Category | 'All' }> = [
  { label: 'All', value: 'All' },
  { label: 'Electronics', value: 'Electronics' },
  { label: 'Fashion', value: 'Fashion' },
  { label: 'Art', value: 'Art' },
  { label: 'Books', value: 'Books' },
  { label: 'Collectibles', value: 'Collectibles' },
  { label: 'Home', value: 'Home' },
  { label: 'Sports', value: 'Sports' },
  { label: 'Other', value: 'Other' },
]

interface HeroSearchProps {
  query: string
  setQuery: (q: string) => void
  activeCategory: Category | 'All'
  setCategory: (c: Category | 'All') => void
  listingCount: number
}

export function HeroSearch({ query, setQuery, activeCategory, setCategory, listingCount }: HeroSearchProps) {
  return (
    <section className="py-10 px-4">
      <div className="max-w-2xl mx-auto text-center mb-8">
        <h1 className="display font-bold text-4xl sm:text-5xl mb-3" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>
          Buy &amp; Sell Globally
        </h1>
        <p className="text-base" style={{ color: 'var(--muted)' }}>
          Pay with USDC — no FX fees, no bank delays, instant settlement across borders.
        </p>
      </div>

      {/* Search bar */}
      <div className="max-w-xl mx-auto mb-6">
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items, categories, locations…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--ink)' }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: 'var(--muted)' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Category chips */}
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap gap-2 justify-center">
          {CATEGORIES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setCategory(value)}
              className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
              style={{
                background: activeCategory === value ? 'var(--accent)' : 'var(--surface-strong)',
                color: activeCategory === value ? '#ffffff' : 'var(--ink-2)',
                border: `1.5px solid ${activeCategory === value ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-center text-xs mt-5" style={{ color: 'var(--subtle)' }}>
        {listingCount} {listingCount === 1 ? 'listing' : 'listings'} available worldwide
      </p>
    </section>
  )
}
