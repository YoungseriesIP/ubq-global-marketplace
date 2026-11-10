// Unit tests for the security core. Run with: bun test server/sec
import { describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { entryHash, verifyChain, type AuditRow } from './audit'
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totpAt, verifyTotp } from './crypto'
import { hasTransfer, matchesTransferInput } from './payments'
import { PERMISSIONS, can } from './rbac'
import { DEFAULT_CONFIG, decide, prohibitedHits, scoreSignals, type Signals } from './risk'

// RFC 6238 test secret: ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'))

describe('TOTP (RFC 6238)', () => {
  test('matches the published SHA-1 test vectors', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082')
    expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe('081804')
    expect(totpAt(RFC_SECRET, 1_234_567_890_000)).toBe('005924')
  })
  test('base32 round trips', () => {
    const raw = randomBytes(20)
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true)
  })
  test('accepts one step of drift, rejects older and malformed codes', () => {
    const now = 1_700_000_000_000
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now)).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 120_000), now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false)
  })
})

describe('secret encryption', () => {
  test('round trips and detects tampering or the wrong key', () => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('hex')
    const blob = encryptSecret('JBSWY3DPEHPK3PXP')
    expect(decryptSecret(blob)).toBe('JBSWY3DPEHPK3PXP')
    const [iv, tag, enc] = blob.split('.')
    const flipped = Buffer.from(enc!, 'base64')
    flipped[0] = flipped[0]! ^ 1
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.'))).toThrow()
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('hex')
    expect(() => decryptSecret(blob)).toThrow()
  })
})

function chain(n: number): AuditRow[] {
  const rows: AuditRow[] = []
  let prev = 'genesis'
  for (let i = 1; i <= n; i++) {
    const e = { at: 1_700_000_000_000 + i, actor: `0x${i}`, action: 'test.action', target: `t${i}`, details: `{"i":${i}}` }
    const hash = entryHash(prev, e)
    rows.push({ id: i, ...e, prev_hash: prev, hash })
    prev = hash
  }
  return rows
}

describe('audit log chain', () => {
  test('a clean chain verifies', () => expect(verifyChain(chain(5)).ok).toBe(true))
  test('editing an entry is detected', () => {
    const rows = chain(5)
    rows[2]!.details = '{"i":999}'
    expect(verifyChain(rows)).toEqual({ ok: false, brokenAtId: 3 })
  })
  test('deleting an entry is detected', () => {
    const rows = chain(5)
    rows.splice(2, 1)
    expect(verifyChain(rows).ok).toBe(false)
  })
  test('reordering entries is detected', () => {
    const rows = chain(5)
    ;[rows[1], rows[2]] = [rows[2]!, rows[1]!]
    expect(verifyChain(rows).ok).toBe(false)
  })
})

const calm: Signals = { accountAgeDays: 90, level: 1, newDevice: false }

describe('risk scoring', () => {
  test('a settled account scores zero and is allowed', () => {
    const r = scoreSignals(calm, DEFAULT_CONFIG)
    expect(r.score).toBe(0)
    expect(decide(r.score, DEFAULT_CONFIG)).toBe('allow')
  })
  test('a brand-new wallet user making a normal purchase only needs a fresh sign-in, never a block', () => {
    const r = scoreSignals({ accountAgeDays: 0, level: 0, newDevice: false, amountUsdc: 400, singleLimit: 500 }, DEFAULT_CONFIG)
    expect(decide(r.score, DEFAULT_CONFIG)).toBe('step_up')
  })
  test('new account on a new device with a large payment needs more checks', () => {
    const r = scoreSignals({ accountAgeDays: 1, level: 0, newDevice: true, amountUsdc: 400, singleLimit: 500 }, DEFAULT_CONFIG)
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_CONFIG.thresholds.stepUp)
    expect(r.reasons.length).toBeGreaterThan(2)
  })
  test('a single prohibited term from a clean, settled account is not an automatic block', () => {
    const r = scoreSignals({ ...calm, prohibitedHits: ['fake id'] }, DEFAULT_CONFIG)
    expect(decide(r.score, DEFAULT_CONFIG)).toBe('step_up')
  })
  test('signals stack but never exceed 100', () => {
    const r = scoreSignals({
      accountAgeDays: 0, level: 0, newDevice: true, amountUsdc: 9999, singleLimit: 1, ordersLastHour: 9, failedAuth24h: 20,
      recentRestrictions: 2, accountsOnDevice: 9, listingsLastHour: 50, prohibitedHits: ['stolen'], sellerAgeDays: 0,
    }, DEFAULT_CONFIG)
    expect(r.score).toBe(100)
    expect(decide(r.score, DEFAULT_CONFIG)).toBe('review')
  })
  test('thresholds map to decisions', () => {
    expect(decide(39, DEFAULT_CONFIG)).toBe('allow')
    expect(decide(40, DEFAULT_CONFIG)).toBe('step_up')
    expect(decide(70, DEFAULT_CONFIG)).toBe('blocked')
    expect(decide(90, DEFAULT_CONFIG)).toBe('review')
  })
  test('prohibited terms match case-insensitively and ignore tiny terms', () => {
    expect(prohibitedHits('Selling a FAKE Passport today', DEFAULT_CONFIG.prohibitedTerms)).toEqual(['fake passport'])
    expect(prohibitedHits('Handmade wooden chess set', DEFAULT_CONFIG.prohibitedTerms)).toEqual([])
    expect(prohibitedHits('anything', ['a'])).toEqual([])
  })
})

describe('payment matching', () => {
  const usdc = '0x3600000000000000000000000000000000000000'
  const buyer = `0x${'ab'.repeat(20)}`
  const seller = `0x${'cd'.repeat(20)}`
  const pad = (a: string) => `0x${a.slice(2).padStart(64, '0')}`
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const log = (value: bigint, to = seller, addr = usdc) => ({
    address: addr, topics: [topic, pad(buyer), pad(to)], data: `0x${value.toString(16).padStart(64, '0')}`,
  })

  test('accepts an exact or larger transfer to the seller', () => {
    expect(hasTransfer([log(5_000_000n)], usdc, buyer, seller, 5_000_000n)).toBe(true)
    expect(hasTransfer([log(6_000_000n)], usdc, buyer, seller, 5_000_000n)).toBe(true)
  })
  test('rejects short payments, wrong recipient, wrong token and wrong payer', () => {
    expect(hasTransfer([log(4_999_999n)], usdc, buyer, seller, 5_000_000n)).toBe(false)
    expect(hasTransfer([log(5_000_000n, `0x${'ee'.repeat(20)}`)], usdc, buyer, seller, 5_000_000n)).toBe(false)
    expect(hasTransfer([log(5_000_000n, seller, `0x${'11'.repeat(20)}`)], usdc, buyer, seller, 5_000_000n)).toBe(false)
    expect(hasTransfer([log(5_000_000n)], usdc, `0x${'99'.repeat(20)}`, seller, 5_000_000n)).toBe(false)
  })
  test('decodes a plain transfer(to, amount) call as a fallback', () => {
    const input = `0xa9059cbb${pad(seller).slice(2)}${(5_000_000n).toString(16).padStart(64, '0')}`
    expect(matchesTransferInput(input, seller, 5_000_000n)).toBe(true)
    expect(matchesTransferInput(input, seller, 5_000_001n)).toBe(false)
    expect(matchesTransferInput(input, `0x${'ee'.repeat(20)}`, 1n)).toBe(false)
    expect(matchesTransferInput('0x12345678', seller, 1n)).toBe(false)
  })
})

describe('staff permissions', () => {
  test('support cannot change cases, config or staff', () => {
    expect(can(['support'], 'cases.write')).toBe(false)
    expect(can(['support'], 'config.write')).toBe(false)
    expect(can(['support'], 'staff.manage')).toBe(false)
  })
  test('finance can read orders and the audit log but cannot restrict users', () => {
    expect(can(['finance'], 'orders.read')).toBe(true)
    expect(can(['finance'], 'audit.read')).toBe(true)
    expect(can(['finance'], 'restrictions.write')).toBe(false)
  })
  test('only admins change configuration, staff and run privacy actions', () => {
    for (const p of ['config.write', 'staff.manage', 'privacy.execute'] as const) {
      expect(PERMISSIONS[p]).toEqual(['admin'])
    }
  })
  test('no role can edit orders or the audit log', () => {
    expect(Object.keys(PERMISSIONS).some((k) => k.startsWith('audit.write') || k.startsWith('orders.write'))).toBe(false)
  })
})
