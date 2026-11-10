// Server-side verification of USDC payments from the blockchain. The browser's claim is never trusted.

import { createPublicClient, http, parseUnits, type Hex } from 'viem'
import { getUsdc, requireChain } from '../../src/onchain-facts'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const TRANSFER_SELECTOR = '0xa9059cbb'

export interface LogLike {
  address: string
  topics: readonly string[]
  data: string
}

const topicToAddress = (t: string | undefined): string => (t ? `0x${t.slice(-40)}`.toLowerCase() : '')

/** True when a USDC Transfer(from, to, value >= min) is among the logs. */
export function hasTransfer(logs: readonly LogLike[], usdc: string, from: string, to: string, min: bigint): boolean {
  return logs.some(
    (l) =>
      l.address.toLowerCase() === usdc.toLowerCase() &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      topicToAddress(l.topics[1]) === from.toLowerCase() &&
      topicToAddress(l.topics[2]) === to.toLowerCase() &&
      BigInt(l.data || '0x0') >= min,
  )
}

/** Fallback for plain `transfer(to, amount)` calls when the token does not emit a standard log. */
export function matchesTransferInput(input: string, to: string, min: bigint): boolean {
  if (!input.toLowerCase().startsWith(TRANSFER_SELECTOR) || input.length < 10 + 128) return false
  const dest = `0x${input.slice(10 + 24, 10 + 64)}`.toLowerCase()
  return dest === to.toLowerCase() && BigInt(`0x${input.slice(10 + 64, 10 + 128)}`) >= min
}

export type Verification =
  | { status: 'verified'; note: string }
  | { status: 'pending'; note: string }
  | { status: 'failed'; note: string }

export async function verifyUsdcPayment(p: {
  chainId: number
  txHash: string
  from: string
  to: string
  amountUsdc: string
}): Promise<Verification> {
  const usdc = getUsdc(p.chainId)
  const chain = requireChain(p.chainId)
  const rpc = chain.rpcUrls[0]
  if (!usdc || !rpc) return { status: 'pending', note: 'Payment verification is not available on this network yet.' }
  const min = parseUnits(p.amountUsdc, usdc.decimals)
  const client = createPublicClient({ transport: http(rpc, { timeout: 8000 }) })
  const hash = p.txHash as Hex

  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash })
  } catch {
    return { status: 'pending', note: 'The network has not confirmed this transaction yet.' }
  }
  if (receipt.status !== 'success') return { status: 'failed', note: 'The transaction failed on the network.' }

  if (hasTransfer(receipt.logs, usdc.address, p.from, p.to, min)) {
    return { status: 'verified', note: 'USDC transfer confirmed on-chain.' }
  }
  try {
    const tx = await client.getTransaction({ hash })
    if (
      tx.to?.toLowerCase() === usdc.address.toLowerCase() &&
      tx.from.toLowerCase() === p.from.toLowerCase() &&
      matchesTransferInput(tx.input, p.to, min)
    ) {
      return { status: 'verified', note: 'USDC transfer confirmed on-chain.' }
    }
  } catch {
    /* fall through to a mismatch */
  }
  return { status: 'failed', note: 'The transaction does not pay the expected amount to the seller.' }
}
