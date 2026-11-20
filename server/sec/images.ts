// Uploaded item photos. The browser shrinks every photo before sending it; the server
// still checks that the bytes really are a JPEG, PNG or WebP image and caps the size.

export const MAX_IMAGE_BYTES = 700_000

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export function detectImage(b: Uint8Array): ImageMime | null {
  if (b.length < 16) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  const tag = (o: number, s: string) => s.split('').every((ch, i) => b[o + i] === ch.charCodeAt(0))
  if (tag(0, 'RIFF') && tag(8, 'WEBP')) return 'image/webp'
  return null
}

const OWN_IMAGE = /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A listing photo is either one of our own uploads or an https link. */
export function isOwnImagePath(v: string): boolean {
  return OWN_IMAGE.test(v)
}
