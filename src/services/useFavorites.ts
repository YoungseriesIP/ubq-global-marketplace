import { useState, useCallback } from 'react'

const STORAGE_KEY = 'tradeport_favorites_v1'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function save(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // quota exceeded — ignore
  }
}

export interface FavoritesStore {
  favorites: Set<string>
  toggle: (id: string) => void
  isFavorite: (id: string) => boolean
}

export function useFavorites(): FavoritesStore {
  const [favorites, setFavorites] = useState<Set<string>>(load)

  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      save(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites])

  return { favorites, toggle, isFavorite }
}
