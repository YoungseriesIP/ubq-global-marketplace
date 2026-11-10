import { useState } from 'react'
import { X, ChevronLeft, ChevronRight, Image } from 'lucide-react'
import type { PortfolioItem } from '../../services/types'

interface PortfolioGalleryProps {
  items: PortfolioItem[]
}

export function PortfolioGallery({ items }: PortfolioGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const visible = items.filter((i) => !i.flagged)
  if (visible.length === 0) return null

  const openLightbox = (index: number) => setLightboxIndex(index)
  const closeLightbox = () => setLightboxIndex(null)

  const prev = () =>
    setLightboxIndex((i) => (i !== null ? (i - 1 + visible.length) % visible.length : null))
  const next = () =>
    setLightboxIndex((i) => (i !== null ? (i + 1) % visible.length : null))

  const current = lightboxIndex !== null ? visible[lightboxIndex] : null

  return (
    <>
      {/* Thumbnail grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {visible.map((item, index) => (
          <button
            key={item.id}
            onClick={() => openLightbox(index)}
            className="relative aspect-square rounded-xl overflow-hidden group focus:outline-none focus:ring-2"
            style={{ background: 'var(--surface-muted)', focusRingColor: 'var(--focus)' } as React.CSSProperties}
          >
            {item.type === 'image' ? (
              <img referrerPolicy="no-referrer"
                src={item.url}
                alt={item.caption ?? 'Portfolio image'}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
                <Image size={24} style={{ color: 'var(--muted)' }} />
              </div>
            )}
            {/* Caption overlay on hover */}
            {item.caption && (
              <div
                className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(to top, rgba(18,45,69,0.75) 0%, transparent 60%)' }}
              >
                <p className="text-white text-xs font-medium leading-tight line-clamp-2">
                  {item.caption}
                </p>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(18,45,69,0.92)', backdropFilter: 'blur(6px)' }}
          onClick={closeLightbox}
        >
          {/* Close */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full z-10"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <X size={18} />
          </button>

          {/* Prev */}
          {visible.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); prev() }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full z-10"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            >
              <ChevronLeft size={20} />
            </button>
          )}

          {/* Image */}
          <div
            className="relative max-w-2xl w-full rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img referrerPolicy="no-referrer"
              src={current.url}
              alt={current.caption ?? 'Portfolio image'}
              className="w-full max-h-[70vh] object-contain"
              style={{ background: '#000' }}
            />
            {current.caption && (
              <div
                className="px-5 py-3"
                style={{ background: 'var(--surface-strong)' }}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {current.caption}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {lightboxIndex + 1} / {visible.length}
                </p>
              </div>
            )}
          </div>

          {/* Next */}
          {visible.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); next() }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full z-10"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
    </>
  )
}
