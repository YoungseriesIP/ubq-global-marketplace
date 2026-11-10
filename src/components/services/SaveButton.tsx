import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import type { FavoritesStore } from '../../services/useFavorites'

interface SaveButtonProps {
  providerId: string
  providerName: string
  store: FavoritesStore
  size?: 'sm' | 'md'
}

export function SaveButton({ providerId, providerName, store, size = 'sm' }: SaveButtonProps) {
  const saved = store.isFavorite(providerId)
  const iconSize = size === 'sm' ? 14 : 16

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    store.toggle(providerId)
    if (!saved) {
      toast.success(`Saved ${providerName}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      aria-label={saved ? `Remove ${providerName} from saved` : `Save ${providerName}`}
      className="flex items-center justify-center rounded-full transition-all active:scale-90"
      style={{
        width: size === 'sm' ? 30 : 36,
        height: size === 'sm' ? 30 : 36,
        background: saved ? 'rgba(186,43,76,0.10)' : 'var(--surface-muted)',
        color: saved ? 'var(--danger)' : 'var(--muted)',
        border: `1.5px solid ${saved ? 'rgba(186,43,76,0.25)' : 'var(--border)'}`,
        flexShrink: 0,
      }}
    >
      <Heart size={iconSize} fill={saved ? 'currentColor' : 'none'} />
    </button>
  )
}
