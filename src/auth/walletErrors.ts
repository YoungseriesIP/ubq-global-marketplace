/** Friendly text for the things that go wrong when connecting a wallet. */
export function walletErrorText(e: unknown): string {
  const err = e as { name?: string; code?: number; message?: string; cause?: { code?: number } }
  const code = err.code ?? err.cause?.code
  const msg = (err.message ?? '').toLowerCase()
  if (code === 4001 || err.name === 'UserRejectedRequestError' || msg.includes('user rejected') || msg.includes('user denied')) {
    return 'You closed the request in your wallet. Tap the wallet again to retry.'
  }
  if (code === -32002 || msg.includes('already pending') || msg.includes('already processing')) {
    return 'Your wallet already has a request waiting. Open it, approve or reject it, then try again.'
  }
  if (err.name === 'ProviderNotFoundError' || msg.includes('provider not found')) {
    return 'That wallet is not available in this browser. Install it, or open this page inside the wallet app.'
  }
  if (msg === 'wallet-timeout') return 'Your wallet did not respond. Unlock it, then try again.'
  return err.message && err.message.length < 140 ? err.message : 'Could not connect to that wallet. Please try again.'
}
