// Small crypto helpers: AES-256-GCM for secrets at rest, RFC 6238 TOTP for staff accounts, salted hashes.

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function encryptionKey(): Buffer | null {
  const hex = process.env.APP_ENCRYPTION_KEY
  return hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null
}

export const encryptionConfigured = (): boolean => encryptionKey() !== null

export function encryptSecret(plain: string): string {
  const key = encryptionKey()
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(blob: string): string {
  const key = encryptionKey()
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not configured')
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !enc) throw new Error('Malformed secret')
  const d = createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

/** Salted, truncated hash for values we only need to compare (IP addresses, device ids). */
export function privacyHash(value: string): string {
  const salt = process.env.APP_ENCRYPTION_KEY ?? 'tradeport'
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 32)
}

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex')

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ──────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}

export function base32Decode(s: string): Buffer {
  let bits = ''
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error('Invalid base32')
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20))

export function totpAt(secret: string, timeMs: number): string {
  const counter = Math.floor(timeMs / 30_000)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const o = h[h.length - 1]! & 0x0f
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, '0')
}

/** Accepts the previous, current and next 30-second window to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  return [-1, 0, 1].some((w) => safeEqual(totpAt(secret, nowMs + w * 30_000), code))
}

export const totpUri = (label: string, secret: string): string =>
  `otpauth://totp/${encodeURIComponent(`TradePort:${label}`)}?secret=${secret}&issuer=TradePort`
