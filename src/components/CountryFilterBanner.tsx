// ─── Country Filter Banner ─────────────────────────────────────────────────
// Shown at the top of every view (marketplace + services).
// Displays the auto-detected or manually chosen country, lets the user change
// it via a searchable dropdown, and shows a "Showing global" pill when no
// country is active.

import { useState, useRef, useEffect } from 'react'
import { Globe, MapPin, ChevronDown, Loader2, X } from 'lucide-react'
import type { CountryFilter, CountryOption } from '../services/useCountryFilter'
import { COUNTRY_LIST } from '../services/useCountryFilter'

interface CountryFilterBannerProps {
  filter: CountryFilter
}

export function CountryFilterBanner({ filter }: CountryFilterBannerProps) {
  const { country, countryName, status, setCountry } = filter
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60)
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = COUNTRY_LIST.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase()),
  )

  function pick(opt: CountryOption) {
    setCountry(opt)
    setOpen(false)
    setSearch('')
  }

  function goGlobal() {
    setCountry(null)
    setOpen(false)
    setSearch('')
  }

  const isDetecting = status === 'detecting' || status === 'idle'
  const isGlobal    = !country

  return (
    <div
      className="sticky top-0 z-30 border-b"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
        {/* Location pill / button */}
        <div ref={wrapRef} className="relative flex-1 min-w-0">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80 active:scale-[0.98] w-full sm:w-auto"
            style={{
              background: isGlobal ? 'var(--surface-muted)' : 'rgba(16,97,166,0.08)',
              color: isGlobal ? 'var(--muted)' : 'var(--accent)',
              border: `1.5px solid ${isGlobal ? 'var(--border)' : 'rgba(16,97,166,0.25)'}`,
            }}
          >
            {isDetecting ? (
              <Loader2 size={13} className="animate-spin shrink-0" />
            ) : isGlobal ? (
              <Globe size={13} className="shrink-0" />
            ) : (
              <MapPin size={13} className="shrink-0" />
            )}
            <span className="truncate">
              {isDetecting
                ? 'Detecting location…'
                : isGlobal
                  ? 'Showing: All Countries'
                  : `Showing: ${countryName ?? country}`}
            </span>
            <ChevronDown size={12} className="shrink-0 ml-auto" />
          </button>

          {/* Dropdown */}
          {open && (
            <div
              className="absolute left-0 top-full mt-2 w-72 rounded-2xl shadow-xl overflow-hidden z-50 border"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              {/* Search */}
              <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search country…"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                    border: '1.5px solid var(--border)',
                  }}
                />
              </div>

              {/* Global option */}
              <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={goGlobal}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:opacity-80"
                  style={{
                    background: isGlobal ? 'rgba(16,97,166,0.08)' : 'transparent',
                    color: isGlobal ? 'var(--accent)' : 'var(--ink-2)',
                  }}
                >
                  <Globe size={14} style={{ color: 'var(--muted)' }} />
                  <span>All Countries (Global)</span>
                  {isGlobal && (
                    <span className="ml-auto text-xs font-bold" style={{ color: 'var(--accent)' }}>
                      ✓
                    </span>
                  )}
                </button>
              </div>

              {/* Country list */}
              <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
                {filtered.length === 0 ? (
                  <p className="text-center text-xs py-4" style={{ color: 'var(--muted)' }}>
                    No country found
                  </p>
                ) : (
                  filtered.map((c) => {
                    const active = country === c.code
                    return (
                      <button
                        key={c.code}
                        onClick={() => pick(c)}
                        className="w-full flex items-center gap-2.5 px-5 py-2.5 text-sm transition-colors hover:opacity-80"
                        style={{
                          background: active ? 'rgba(16,97,166,0.07)' : 'transparent',
                          color: active ? 'var(--accent)' : 'var(--ink-2)',
                        }}
                      >
                        <span className="font-mono text-xs w-6 shrink-0" style={{ color: 'var(--muted)' }}>
                          {c.code}
                        </span>
                        <span className="flex-1 text-left">{c.name}</span>
                        {active && (
                          <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>✓</span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Clear button when manually overridden */}
        {!isGlobal && status === 'manual' && (
          <button
            onClick={goGlobal}
            className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70 shrink-0"
            style={{ color: 'var(--muted)' }}
          >
            <X size={12} /> Clear
          </button>
        )}

        {/* Subtle label */}
        {!isGlobal && (
          <p className="text-xs hidden sm:block shrink-0" style={{ color: 'var(--muted)' }}>
            Listings &amp; services in {countryName}
          </p>
        )}
      </div>
    </div>
  )
}
