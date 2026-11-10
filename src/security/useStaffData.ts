import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'

/** Loads a staff API path and lets the caller reload it after an action. */
export function useStaffData<T>(path: string | null, onLocked: () => void) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let live = true
    api<T>(path)
      .then((d) => { if (live) { setData(d); setError(null) } })
      .catch((e: unknown) => {
        if (!live) return
        if (e instanceof ApiError && e.status === 401) onLocked()
        else setError(e instanceof ApiError ? e.message : 'Could not load this section.')
      })
    return () => { live = false }
  }, [path, tick, onLocked])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, reload }
}

/** Runs a staff action with a toast, locking the console again if the unlock has expired. */
export function useStaffAction(onLocked: () => void, reload: () => void) {
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      setBusy(true)
      try {
        await fn()
        toast.success(ok)
        reload()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onLocked()
        else toast.error(e instanceof ApiError ? e.message : 'Something went wrong.')
      } finally {
        setBusy(false)
      }
    },
    [onLocked, reload],
  )
  return { run, busy }
}
