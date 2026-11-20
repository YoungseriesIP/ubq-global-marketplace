import { ApiError, getSessionToken } from './api'

const MAX_SIDE = 1280
const TARGET_BYTES = 450_000

/** Shrink a photo in the browser so uploads are quick and cheap. */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.')
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error('That photo could not be read. Try a JPEG or PNG.')
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process photos.')
  ctx.fillStyle = '#ffffff' // flatten transparent PNGs onto white
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  let quality = 0.85
  for (;;) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('That photo could not be prepared.')
    if (blob.size <= TARGET_BYTES || quality <= 0.4) return blob
    quality -= 0.1
  }
}

/** Upload a photo and return the address to store on the listing. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await shrinkImage(file)
  const token = getSessionToken()
  const res = await fetch('/api/uploads/image', {
    method: 'POST',
    headers: { 'Content-Type': blob.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: blob,
  })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !json.url) throw new ApiError(json.error ?? 'Upload failed. Please try again.', res.status)
  return json.url
}
