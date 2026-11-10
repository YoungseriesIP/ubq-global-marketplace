// One payment interface for both kinds of account:
//   - email / Google users pay from their Circle wallet (PIN approval in Circle's window)
//   - wallet users pay with their own wallet through wagmi
// Amounts are exact USDC strings; local-currency numbers are display only.

import { useCallback, useEffect, useState } from 'react'
import { erc20Abi } from 'viem'
import type { Address } from 'viem'
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { getUsdc } from '@/onchain-facts'
import { parseUsdc, formatUsdc } from '@/onchain-money'
import { waitForSuccessfulTransaction } from '@/onchain-wait'
import { api } from '@/lib/api'
import { useAuth } from './AuthContext'

export const ESCROW_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bookingId', type: 'bytes32' }, { name: 'provider', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'release', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bookingId', type: 'bytes32' }, { name: 'provider', type: 'address' }], outputs: [] },
  { name: 'dispute', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bookingId', type: 'bytes32' }, { name: 'counterparty', type: 'address' }], outputs: [] },
  { name: 'refund', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'bookingId', type: 'bytes32' }, { name: 'provider', type: 'address' }], outputs: [] },
  { name: 'claim', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

export type EscrowCall =
  | { fn: 'approve'; amountUsdc: string }
  | { fn: 'deposit'; bookingId: `0x${string}`; provider: Address; amountUsdc: string }
  | { fn: 'release'; bookingId: `0x${string}`; provider: Address }
  | { fn: 'dispute'; bookingId: `0x${string}`; counterparty: Address }
  | { fn: 'refund'; bookingId: `0x${string}`; provider: Address }
  | { fn: 'claim' }

interface TxInfo { id?: string; state?: string; txHash?: string }

export class NeedsSignInError extends Error {
  constructor() {
    super('Please verify your account again to continue.')
  }
}

export function useWalletActions(chainId: number) {
  const { user, circleCreds, needsReauth, openSignIn, executeChallenge, config } = useAuth()
  const { address: wagmiAddress, chainId: wagmiChainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId })
  const usdc = getUsdc(chainId)
  const escrowAddress = config?.escrowAddress as Address | null | undefined

  const isCircle = user?.method === 'circle'

  /** Run a Circle challenge and wait for the resulting transaction to complete. */
  const runCircle = useCallback(async (path: string, body: Record<string, unknown>, label: string): Promise<`0x${string}`> => {
    if (!user?.walletId) throw new Error('Your wallet is not ready yet.')
    if (!circleCreds) { openSignIn(); throw new NeedsSignInError() }
    const base = { userToken: circleCreds.userToken, walletId: user.walletId }
    const before = await api<TxInfo>('/wallet/latest-tx', { body: base, auth: false })
    const { challengeId } = await api<{ challengeId: string }>(path, { body: { ...base, ...body }, auth: false })
    await executeChallenge(challengeId)
    const tx = await waitForSuccessfulTransaction<TxInfo>(
      async () => {
        const r = await api<TxInfo>('/wallet/latest-tx', { body: base, auth: false })
        return r.id && r.id !== before.id ? r : {}
      },
      (v) => v.state,
      { label, intervalMs: 2000 },
    )
    if (!tx.txHash) throw new Error('The payment finished but no receipt was returned.')
    return tx.txHash as `0x${string}`
  }, [user, circleCreds, openSignIn, executeChallenge])

  const ensureWagmi = useCallback(async () => {
    if (!wagmiAddress || wagmiAddress.toLowerCase() !== user?.address.toLowerCase()) {
      throw new Error('Connect the wallet you signed in with to continue.')
    }
    if (wagmiChainId !== chainId) await switchChainAsync({ chainId })
  }, [wagmiAddress, wagmiChainId, user, chainId, switchChainAsync])

  const waitReceipt = useCallback(async (hash: `0x${string}`) => {
    const receipt = await publicClient?.waitForTransactionReceipt({ hash })
    if (receipt && receipt.status !== 'success') throw new Error('Transaction failed onchain.')
    return hash
  }, [publicClient])

  /** Send USDC. Returns the transaction hash once it is confirmed. */
  const payUsdc = useCallback(async (to: Address, amountUsdc: string): Promise<`0x${string}`> => {
    if (!usdc) throw new Error('USDC is not available on this network.')
    if (isCircle) return runCircle('/wallet/transfer', { to, amount: amountUsdc }, 'USDC payment')
    await ensureWagmi()
    const hash = await writeContractAsync({
      address: usdc.address as Address, abi: erc20Abi, functionName: 'transfer',
      args: [to, parseUsdc(amountUsdc)], chainId,
    })
    return waitReceipt(hash)
  }, [usdc, isCircle, runCircle, ensureWagmi, writeContractAsync, chainId, waitReceipt])

  /** Approve / deposit / release / dispute / refund / claim on the escrow contract. */
  const callEscrow = useCallback(async (call: EscrowCall): Promise<`0x${string}`> => {
    if (!usdc || !escrowAddress) throw new Error('Escrow is not available yet.')
    if (isCircle) {
      const m = {
        approve: () => ({ target: 'usdc', signature: 'approve(address,uint256)', params: [escrowAddress, parseUsdc((call as Extract<EscrowCall, { fn: 'approve' }>).amountUsdc).toString()] }),
        deposit: () => { const c = call as Extract<EscrowCall, { fn: 'deposit' }>; return { target: 'escrow', signature: 'deposit(bytes32,address,uint256)', params: [c.bookingId, c.provider, parseUsdc(c.amountUsdc).toString()] } },
        release: () => { const c = call as Extract<EscrowCall, { fn: 'release' }>; return { target: 'escrow', signature: 'release(bytes32,address)', params: [c.bookingId, c.provider] } },
        dispute: () => { const c = call as Extract<EscrowCall, { fn: 'dispute' }>; return { target: 'escrow', signature: 'dispute(bytes32,address)', params: [c.bookingId, c.counterparty] } },
        refund: () => { const c = call as Extract<EscrowCall, { fn: 'refund' }>; return { target: 'escrow', signature: 'refund(bytes32,address)', params: [c.bookingId, c.provider] } },
        claim: () => ({ target: 'escrow', signature: 'claim()', params: [] as string[] }),
      }[call.fn]()
      return runCircle('/wallet/contract', m, `escrow ${call.fn}`)
    }
    await ensureWagmi()
    let hash: `0x${string}`
    if (call.fn === 'approve') {
      hash = await writeContractAsync({ address: usdc.address as Address, abi: erc20Abi, functionName: 'approve', args: [escrowAddress, parseUsdc(call.amountUsdc)], chainId })
    } else if (call.fn === 'deposit') {
      hash = await writeContractAsync({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'deposit', args: [call.bookingId, call.provider, parseUsdc(call.amountUsdc)], chainId })
    } else if (call.fn === 'release') {
      hash = await writeContractAsync({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'release', args: [call.bookingId, call.provider], chainId })
    } else if (call.fn === 'dispute') {
      hash = await writeContractAsync({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'dispute', args: [call.bookingId, call.counterparty], chainId })
    } else if (call.fn === 'refund') {
      hash = await writeContractAsync({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'refund', args: [call.bookingId, call.provider], chainId })
    } else {
      hash = await writeContractAsync({ address: escrowAddress, abi: ESCROW_ABI, functionName: 'claim', chainId })
    }
    return waitReceipt(hash)
  }, [usdc, escrowAddress, isCircle, runCircle, ensureWagmi, writeContractAsync, chainId, waitReceipt])

  return { payUsdc, callEscrow, isCircle, needsReauth, escrowAddress: escrowAddress ?? null }
}

/** USDC balance (ERC-20 view, human-readable) for the signed-in account. */
export function useUsdcBalance(chainId: number): { balance: string | null; refresh: () => void } {
  const { user, circleCreds } = useAuth()
  const usdc = getUsdc(chainId)
  const isCircle = user?.method === 'circle'
  const [circleBalance, setCircleBalance] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const { data: raw, refetch } = useReadContract({
    address: usdc?.address as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: user ? [user.address] : undefined,
    chainId,
    query: { enabled: !!user && !isCircle && !!usdc },
  })

  useEffect(() => {
    if (!isCircle || !user?.walletId || !circleCreds) return
    let cancelled = false
    api<{ usdc: string }>('/wallet/balance', {
      body: { userToken: circleCreds.userToken, walletId: user.walletId }, auth: false,
    })
      .then((r) => { if (!cancelled) setCircleBalance(r.usdc) })
      .catch(() => { if (!cancelled) setCircleBalance(null) })
    return () => { cancelled = true }
  }, [isCircle, user, circleCreds, tick])

  const refresh = useCallback(() => {
    setTick((t) => t + 1)
    void refetch()
  }, [refetch])

  if (isCircle) return { balance: circleBalance, refresh }
  return { balance: raw !== undefined ? formatUsdc(raw) : null, refresh }
}
