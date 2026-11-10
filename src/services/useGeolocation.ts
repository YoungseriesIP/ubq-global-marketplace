import { useState, useCallback } from 'react'

export type GeoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'granted'; lat: number; lng: number }
  | { status: 'denied'; reason: string }

export function useGeolocation() {
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ status: 'denied', reason: 'Geolocation is not supported by your browser.' })
      return
    }
    setGeo({ status: 'loading' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          status: 'granted',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      },
      (err) => {
        setGeo({
          status: 'denied',
          reason:
            err.code === 1
              ? 'Location permission denied. Use manual location search instead.'
              : 'Could not get your location. Try again or enter your city manually.',
        })
      },
      { timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  const clear = useCallback(() => setGeo({ status: 'idle' }), [])

  return { geo, request, clear }
}
