// Payment intents: check before paying, verify on-chain after paying. The browser's word is never enough.

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { buildTxExplorerUrl } from '../../src/onchain-facts'
import { requireAuth, rateLimit, str, type AuthEnv } from '../auth'
import { exec, one, q, type ListingRow, type OrderRow, type UserRow } from '../db'
import { DEFAULT_CHAIN_ID } from '../wallet'
import { audit } from './audit'
import { verifyUsdcPayment } from './payments'
import { activeRestriction, evaluate, isFreshDevice, levelFor, openCase, recordEvent } from './risk'

export const payments = new Hono<AuthEnv>()
payments.use('*', requireAuth)

const TX = /^0x[0-9a-fA-F]{64}$/
const PENDING_TTL_MS = 30 * 60_000

payments.post('/precheck', rateLimit('precheck', 30, 60_000), async (c) => {
  const user = c.get('user')
  const session = c.get('session')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const listingId = str(body.listingId, 80)
  if (!listingId) return c.json({ error: 'listingId is required.' }, 400)

  const l = await one<ListingRow>("SELECT * FROM listings WHERE id = $1 AND status = 'active'", [listingId])
  if (!l) return c.json({ error: 'Listing not found.' }, 404)
  if (l.seller === user.address) return c.json({ error: 'You cannot buy your own listing.' }, 400)
  const seller = await one<UserRow>('SELECT * FROM users WHERE address = $1', [l.seller])
  if (!seller || seller.is_demo === 1) {
    return c.json({ error: 'This is a demo listing and cannot be bought. Sign in with a second account to test a real purchase.' }, 400)
  }

  const restricted = await activeRestriction(user.address, 'buy')
  if (restricted) {
    return c.json({ decision: 'blocked', error: 'Purchases on your account are temporarily paused. You can appeal from the Security page.', restrictionId: restricted.id }, 403)
  }
  if (await activeRestriction(seller.address, 'sell')) {
    return c.json({ error: 'This seller is temporarily unavailable.' }, 409)
  }

  // Idempotent: the same buyer paying for the same listing reuses one open order.
  const open = await one<OrderRow>(
    "SELECT * FROM orders WHERE buyer = $1 AND listing_id = $2 AND status = 'pending_payment' AND expires_at > $3 ORDER BY created_at DESC LIMIT 1",
    [user.address, l.id, Date.now()],
  )
  if (open) {
    return c.json({ orderId: open.id, payTo: l.seller, amountUsdc: l.price_usdc, chainId: DEFAULT_CHAIN_ID, decision: 'allow', reused: true })
  }

  const level = await levelFor(user.address, user.method)
  const ev = await evaluate({
    action: 'order',
    address: user.address,
    level,
    amountUsdc: Number(l.price_usdc),
    newDevice: await isFreshDevice(user.address, session.deviceHash),
    deviceHash: session.deviceHash,
    sellerAddress: l.seller,
  })

  if (ev.decision === 'review') {
    return c.json({ decision: 'review', error: 'This payment needs a quick manual review before it can go ahead. We opened a case and will be in touch. You can appeal from the Security page.', caseId: ev.caseId }, 403)
  }
  if (ev.overLimit) {
    return c.json({
      decision: 'limit',
      error: `This amount is above the ${ev.overLimit.kind === 'single' ? 'per-payment' : 'daily'} limit of ${ev.overLimit.limit} USDC for your verification level. Higher limits need identity verification, which is not switched on yet.`,
    }, 403)
  }
  if (ev.decision === 'blocked') {
    return c.json({ decision: 'blocked', error: 'We could not approve this payment automatically. Please try again later or contact support.' }, 403)
  }
  const fresh = session.createdAt > Date.now() - 10 * 60_000 || session.elevatedUntil > Date.now()
  if (ev.decision === 'step_up' && !fresh) {
    return c.json({ decision: 'step_up', error: 'For your safety, please sign in again to confirm this payment.' }, 409)
  }

  const orderId = randomUUID()
  await exec(
    `INSERT INTO orders (id, listing_id, buyer, seller, amount_usdc, status, risk_score, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6, $7, $8)`,
    [orderId, l.id, user.address, l.seller, l.price_usdc, ev.score, Date.now(), Date.now() + PENDING_TTL_MS],
  )
  return c.json({ orderId, payTo: l.seller, amountUsdc: l.price_usdc, chainId: DEFAULT_CHAIN_ID, decision: 'allow' })
})

/** Verify an order's payment on-chain and record the result. Safe to call repeatedly. */
export async function settleOrder(order: OrderRow, txHash: string): Promise<{ status: string; note: string }> {
  if (order.status === 'verified') return { status: 'verified', note: order.verify_note ?? 'Payment verified.' }

  const dup = await one<{ id: string }>(
    "SELECT id FROM orders WHERE tx_hash = $1 AND status = 'verified' AND id <> $2",
    [txHash, order.id],
  )
  if (dup) {
    await recordEvent({ address: order.buyer, kind: 'duplicate_payment', severity: 'high', details: { orderId: order.id, otherOrder: dup.id } })
    return { status: 'failed', note: 'This transaction was already used for another order.' }
  }

  const result = await verifyUsdcPayment({
    chainId: DEFAULT_CHAIN_ID, txHash, from: order.buyer, to: order.seller, amountUsdc: order.amount_usdc,
  })
  const status = result.status === 'verified' ? 'verified' : result.status === 'failed' ? 'failed' : 'unverified'
  try {
    await exec(
      `UPDATE orders SET tx_hash = $2, status = $3, verify_note = $4, verified_at = $5 WHERE id = $1 AND status <> 'verified'`,
      [order.id, txHash, status, result.note, status === 'verified' ? Date.now() : null],
    )
  } catch {
    return { status: 'failed', note: 'This transaction was already used for another order.' }
  }
  if (status === 'verified') {
    await audit({ actor: 'system', action: 'payment.verified', target: order.id, details: { txHash, amount: order.amount_usdc } })
  } else if (status === 'failed') {
    await recordEvent({ address: order.buyer, kind: 'payment_mismatch', severity: 'high', details: { orderId: order.id, txHash, note: result.note } })
    await openCase({ kind: 'payment_anomaly', severity: 'high', subject: order.buyer, title: `Payment did not match order ${order.id.slice(0, 8)}`, summary: result.note, by: 'system' })
  }
  return { status, note: result.note }
}

payments.post('/:id/confirm', rateLimit('confirm', 30, 60_000), async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const txHash = typeof body.txHash === 'string' && TX.test(body.txHash) ? body.txHash.toLowerCase() : null
  if (!txHash) return c.json({ error: 'A valid transaction hash is required.' }, 400)
  const order = await one<OrderRow>('SELECT * FROM orders WHERE id = $1 AND buyer = $2', [c.req.param('id'), user.address])
  if (!order) return c.json({ error: 'Order not found.' }, 404)
  if (order.tx_hash && order.tx_hash.toLowerCase() !== txHash && order.status !== 'pending_payment') {
    return c.json({ error: 'This order already has a different payment attached.' }, 409)
  }
  return c.json(await settleOrder(order, txHash))
})

payments.post('/:id/recheck', rateLimit('recheck', 20, 60_000), async (c) => {
  const user = c.get('user')
  const order = await one<OrderRow>('SELECT * FROM orders WHERE id = $1 AND (buyer = $2 OR seller = $2)', [c.req.param('id'), user.address])
  if (!order) return c.json({ error: 'Order not found.' }, 404)
  if (!order.tx_hash) return c.json({ status: order.status, note: 'No payment has been attached yet.' })
  return c.json(await settleOrder(order, order.tx_hash))
})

payments.get('/:id/receipt', async (c) => {
  const user = c.get('user')
  const rows = await q<OrderRow & { title: string }>(
    `SELECT o.*, l.title FROM orders o JOIN listings l ON l.id = o.listing_id
     WHERE o.id = $1 AND (o.buyer = $2 OR o.seller = $2)`,
    [c.req.param('id'), user.address],
  )
  const o = rows[0]
  if (!o) return c.json({ error: 'Order not found.' }, 404)
  return c.json({
    receipt: {
      orderId: o.id,
      item: o.title,
      amountUsdc: o.amount_usdc,
      displayCurrency: o.display_currency,
      status: o.status,
      verified: o.status === 'verified',
      note: o.verify_note,
      buyer: o.buyer,
      seller: o.seller,
      txHash: o.tx_hash,
      explorerUrl: o.tx_hash ? buildTxExplorerUrl(DEFAULT_CHAIN_ID, o.tx_hash) : null,
      createdAt: new Date(Number(o.created_at)).toISOString(),
      verifiedAt: o.verified_at ? new Date(Number(o.verified_at)).toISOString() : null,
    },
  })
})
