// Circle user-controlled wallet routes. The API key never leaves this process.
// Every transaction is only a *challenge*: the user must approve it with their
// PIN in Circle's hosted UI, so this server can never move a user's funds.

import { Hono } from 'hono'
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets'
import { requireChain, getUsdc } from '../src/onchain-facts'
import { addr, str, usdcAmount, rateLimit, createSession, upsertUser, clientMeta } from './auth'

export const DEFAULT_CHAIN_ID = Number(process.env.VITE_DEFAULT_CHAIN_ID ?? 5042002)
const chain = requireChain(DEFAULT_CHAIN_ID)
const usdc = getUsdc(DEFAULT_CHAIN_ID)
const BLOCKCHAIN = chain.scpBlockchain as 'ARC-TESTNET'
const ESCROW = addr(process.env.VITE_ESCROW_ADDRESS)

const apiKey = process.env.CIRCLE_API_KEY
const client = apiKey ? initiateUserControlledWalletsClient({ apiKey }) : null

export const circleConfigured = client !== null

interface CircleErr {
  response?: { data?: { code?: number; message?: string } }
  message?: string
}

function circleError(e: unknown): { code?: number; message: string } {
  const err = e as CircleErr
  return {
    code: err.response?.data?.code,
    message: err.response?.data?.message ?? err.message ?? 'Circle request failed',
  }
}

// Only these contract calls may be requested through the API.
const ESCROW_SIGNATURES = new Set([
  'deposit(bytes32,address,uint256)',
  'release(bytes32,address)',
  'dispute(bytes32,address)',
  'refund(bytes32,address)',
  'claim()',
])

export const wallet = new Hono()

wallet.use('*', async (c, next) => {
  if (!client) return c.json({ error: 'Wallet service is not configured on this server.' }, 503)
  await next()
})
wallet.use('*', rateLimit('wallet', 60, 60_000))

// Step 1a: email OTP
wallet.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const deviceId = str(body.deviceId, 200)
  const email = str(body.email, 200)
  if (!deviceId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'A valid email and device id are required.' }, 400)
  }
  try {
    const r = await client!.createDeviceTokenForEmailLogin({ deviceId, email })
    return c.json(r.data)
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, 502)
  }
})

// Step 1b: social login device token
wallet.post('/device-token', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const deviceId = str(body.deviceId, 200)
  if (!deviceId) return c.json({ error: 'Device id required.' }, 400)
  try {
    const r = await client!.createDeviceTokenForSocialLogin({ deviceId })
    return c.json(r.data)
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, 502)
  }
})

// Step 2: create the wallet challenge (user sets a PIN in Circle's UI)
wallet.post('/initialize', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  if (!userToken) return c.json({ error: 'userToken required.' }, 400)
  try {
    const r = await client!.createUserPinWithWallets({
      userToken,
      blockchains: [BLOCKCHAIN],
      accountType: 'EOA',
    })
    return c.json({ challengeId: r.data?.challengeId })
  } catch (e) {
    const { code, message } = circleError(e)
    if (code === 155106) return c.json({ alreadyInitialized: true, code })
    return c.json({ error: message, code }, 502)
  }
})

// Step 3: verify the Circle login and open an app session for that wallet.
wallet.post('/session', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  if (!userToken) return c.json({ error: 'userToken required.' }, 400)
  try {
    const r = await client!.listWallets({ userToken })
    const w = (r.data?.wallets ?? []).find((x) => x.blockchain === BLOCKCHAIN)
    if (!w?.address) return c.json({ needsWallet: true })
    const address = w.address.toLowerCase()
    const user = await upsertUser({ address, method: 'circle', walletId: w.id })
    const { token } = await createSession(address, clientMeta(c, body.deviceId))
    return c.json({
      token,
      user: { address, walletId: w.id, email: null, displayName: user.display_name },
    })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})

// USDC balance (ERC-20 view; on Arc this is the same pool as gas)
wallet.post('/balance', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  const walletId = str(body.walletId, 100)
  if (!userToken || !walletId) return c.json({ error: 'userToken and walletId required.' }, 400)
  try {
    const r = await client!.getWalletTokenBalance({ walletId, userToken })
    const usdcBal = (r.data?.tokenBalances ?? []).find(
      (t) => t.token?.symbol === 'USDC' || t.token?.tokenAddress?.toLowerCase() === usdc?.address.toLowerCase(),
    )
    return c.json({ usdc: usdcBal?.amount ?? '0' })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})

// Direct USDC payment: returns a challenge the user approves with their PIN.
wallet.post('/transfer', async (c) => {
  if (!usdc) return c.json({ error: 'USDC not available on this chain.' }, 500)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  const walletId = str(body.walletId, 100)
  const to = addr(body.to)
  const amount = usdcAmount(body.amount)
  if (!userToken || !walletId || !to || !amount) {
    return c.json({ error: 'userToken, walletId, a valid recipient and amount are required.' }, 400)
  }
  try {
    const r = await client!.createTransaction({
      userToken,
      walletId,
      destinationAddress: to,
      amounts: [amount],
      blockchain: BLOCKCHAIN,
      tokenAddress: usdc.address,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return c.json({ challengeId: r.data?.challengeId })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})

// Allowlisted contract calls: USDC approve (to the escrow only) and escrow methods.
wallet.post('/contract', async (c) => {
  if (!usdc || !ESCROW) return c.json({ error: 'Escrow is not deployed yet.' }, 503)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  const walletId = str(body.walletId, 100)
  const target = body.target === 'usdc' || body.target === 'escrow' ? body.target : null
  const signature = str(body.signature, 120)
  const params = Array.isArray(body.params) ? body.params.map((p) => String(p).slice(0, 200)) : null
  if (!userToken || !walletId || !target || !signature || !params) {
    return c.json({ error: 'Invalid request.' }, 400)
  }
  let contractAddress: string
  if (target === 'usdc') {
    if (signature !== 'approve(address,uint256)' || addr(params[0]) !== ESCROW) {
      return c.json({ error: 'USDC approvals are only allowed for the escrow contract.' }, 403)
    }
    contractAddress = usdc.address
  } else {
    if (!ESCROW_SIGNATURES.has(signature)) return c.json({ error: 'Method not allowed.' }, 403)
    contractAddress = ESCROW
  }
  try {
    const r = await client!.createUserTransactionContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress,
      abiFunctionSignature: signature,
      abiParameters: params,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return c.json({ challengeId: r.data?.challengeId })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})

// Poll a transaction until the client sees a terminal state.
wallet.post('/tx', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  const id = str(body.id, 100)
  if (!userToken || !id) return c.json({ error: 'userToken and id required.' }, 400)
  try {
    const r = await client!.getTransaction({ userToken, id })
    const t = r.data?.transaction
    return c.json({ state: t?.state, txHash: t?.txHash, errorReason: t?.errorReason })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})

// Find the newest transaction for a wallet (used right after a challenge executes).
wallet.post('/latest-tx', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userToken = str(body.userToken, 4000)
  const walletId = str(body.walletId, 100)
  if (!userToken || !walletId) return c.json({ error: 'userToken and walletId required.' }, 400)
  try {
    const r = await client!.listTransactions({ userToken, walletIds: [walletId], pageSize: 1 })
    const t = r.data?.transactions?.[0]
    return c.json({ id: t?.id, state: t?.state, txHash: t?.txHash })
  } catch (e) {
    const { code, message } = circleError(e)
    return c.json({ error: message, code }, code === 155104 ? 401 : 502)
  }
})
