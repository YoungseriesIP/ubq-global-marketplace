/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

// Optional: phone wallets without a browser extension connect through WalletConnect.
// Free project id from cloud.reown.com, set as VITE_WALLETCONNECT_PROJECT_ID.
const walletConnectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim()

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  // Browser wallets (MetaMask, Tabby, Rabby, Coinbase, ...) announce themselves through
  // EIP-6963, so each one shows up by name. `injected()` is the fallback for older ones.
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), ...(walletConnectId ? [walletConnect({ projectId: walletConnectId, showQrModal: true })] : [])],
  transports: {
    [arcTestnet.id]: http(undefined, { timeout: 15_000, retryCount: 2 }),
    [mainnet.id]: http(undefined, { timeout: 15_000, retryCount: 2 }), // ENS resolution uses mainnet
  },
})
