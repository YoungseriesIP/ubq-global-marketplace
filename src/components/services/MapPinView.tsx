import { useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { getCategoryById } from '../../services/categories'
import type { ServiceProvider } from '../../services/types'

interface MapPinViewProps {
  providers: ServiceProvider[]
  userLat?: number
  userLng?: number
  onView: (p: ServiceProvider) => void
}

/**
 * A lightweight SVG-based world-map pin view.
 * Uses a Robinson-like equirectangular projection to place pins.
 * No external map library needed — keeps bundle small and works offline.
 * Providers without lat/lng are not shown.
 */

// Equirectangular projection: lng [-180,180] -> x [0,W], lat [-85,85] -> y [0,H]
function project(lat: number, lng: number, W: number, H: number) {
  const x = ((lng + 180) / 360) * W
  const y = ((90 - lat) / 180) * H
  return { x, y }
}

export function MapPinView({ providers, userLat, userLng, onView }: MapPinViewProps) {
  const [tooltip, setTooltip] = useState<{ provider: ServiceProvider; x: number; y: number } | null>(null)

  const W = 900
  const H = 450

  const pinned = providers.filter((p) => p.location.lat !== undefined && p.location.lng !== undefined)

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border"
      style={{
        background: 'var(--surface-strong)',
        borderColor: 'var(--border)',
        aspectRatio: '2 / 1',
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        style={{ display: 'block' }}
        onClick={() => setTooltip(null)}
      >
        {/* Ocean background */}
        <rect width={W} height={H} fill="rgba(18,45,69,0.06)" />

        {/* Very simplified land masses — approximate polygons for visual context */}
        {/* North America */}
        <polygon
          points="95,60 175,55 220,90 230,145 200,195 170,215 135,215 105,185 80,155 75,110"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />
        {/* South America */}
        <polygon
          points="155,215 195,215 215,255 220,310 200,365 175,385 155,360 140,315 140,265"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />
        {/* Europe */}
        <polygon
          points="390,55 430,50 455,65 460,90 440,105 415,115 395,105 385,80"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />
        {/* Africa */}
        <polygon
          points="400,120 450,115 480,130 490,175 485,240 460,290 430,305 400,295 375,265 370,210 375,155"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />
        {/* Asia */}
        <polygon
          points="455,55 600,45 695,55 730,85 720,130 680,155 620,165 565,155 520,140 475,120 455,90"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />
        {/* Australia */}
        <polygon
          points="680,265 730,260 760,275 765,310 745,335 710,340 685,320 675,295"
          fill="rgba(18,45,69,0.10)" stroke="rgba(18,45,69,0.18)" strokeWidth="1"
        />

        {/* Grid lines */}
        {[-60, -30, 0, 30, 60].map((lat) => {
          const y = ((90 - lat) / 180) * H
          return (
            <line key={lat} x1={0} y1={y} x2={W} y2={y}
              stroke="rgba(18,45,69,0.07)" strokeWidth="1" strokeDasharray="4,6" />
          )
        })}
        {[-120, -60, 0, 60, 120].map((lng) => {
          const x = ((lng + 180) / 360) * W
          return (
            <line key={lng} x1={x} y1={0} x2={x} y2={H}
              stroke="rgba(18,45,69,0.07)" strokeWidth="1" strokeDasharray="4,6" />
          )
        })}

        {/* User location pin */}
        {userLat !== undefined && userLng !== undefined && (() => {
          const { x, y } = project(userLat, userLng, W, H)
          return (
            <g key="user">
              <circle cx={x} cy={y} r={8} fill="rgba(16,97,166,0.25)" />
              <circle cx={x} cy={y} r={4} fill="#1061a6" />
              <circle cx={x} cy={y} r={4} fill="none" stroke="#fff" strokeWidth="1.5" />
            </g>
          )
        })()}

        {/* Provider pins */}
        {pinned.map((p) => {
          const { x, y } = project(p.location.lat!, p.location.lng!, W, H)
          const cat = getCategoryById(p.categoryId)
          const color = cat?.color ?? '#374151'
          const isActive = tooltip?.provider.id === p.id

          return (
            <g
              key={p.id}
              transform={`translate(${x},${y})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                setTooltip(isActive ? null : { provider: p, x, y })
              }}
            >
              {/* Drop shadow */}
              <circle cx={1} cy={2} r={isActive ? 10 : 7} fill="rgba(0,0,0,0.18)" />
              {/* Pin circle */}
              <circle r={isActive ? 10 : 7} fill={color} />
              <circle r={isActive ? 10 : 7} fill="none" stroke="#fff" strokeWidth={isActive ? 2 : 1.5} />
              {/* Initial letter */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={isActive ? 9 : 7}
                fontWeight="700"
                fill="#fff"
                style={{ pointerEvents: 'none', fontFamily: 'DM Sans, sans-serif' }}
              >
                {p.name.charAt(0).toUpperCase()}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-auto"
          style={{
            left: `${(tooltip.x / W) * 100}%`,
            top: `${(tooltip.y / H) * 100}%`,
            transform: 'translate(-50%, -115%)',
          }}
        >
          <div
            className="rounded-xl shadow-xl px-3 py-2.5 min-w-[160px] max-w-[200px] border"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => setTooltip(null)}
              className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full"
              style={{ color: 'var(--muted)', background: 'var(--surface-muted)' }}
            >
              <X size={10} />
            </button>
            <p className="font-semibold text-xs pr-5 line-clamp-1" style={{ color: 'var(--ink)' }}>
              {tooltip.provider.name}
            </p>
            <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--muted)' }}>
              {tooltip.provider.location.city}, {tooltip.provider.location.country}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <MapPin size={9} style={{ color: 'var(--subtle)' }} />
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                {getCategoryById(tooltip.provider.categoryId)?.label}
              </span>
            </div>
            <button
              onClick={() => { onView(tooltip.provider); setTooltip(null) }}
              className="mt-2 w-full py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              View Profile
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        className="absolute bottom-2 left-2 text-xs px-2 py-1 rounded-lg"
        style={{ background: 'rgba(255,255,255,0.85)', color: 'var(--muted)' }}
      >
        {pinned.length} provider{pinned.length !== 1 ? 's' : ''} on map
      </div>
    </div>
  )
}
