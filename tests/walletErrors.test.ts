import { describe, expect, test } from 'bun:test'
import { walletErrorText } from '../src/auth/walletErrors'

describe('wallet error messages', () => {
  test('a closed wallet request asks the user to tap again', () => {
    expect(walletErrorText({ code: 4001, message: 'User rejected the request.' })).toContain('closed the request')
    expect(walletErrorText({ name: 'UserRejectedRequestError', message: 'x' })).toContain('closed the request')
    expect(walletErrorText(new Error('MetaMask Tx Signature: User denied message signature.'))).toContain('closed the request')
  })
  test('a request already waiting in the wallet is explained', () => {
    expect(walletErrorText({ code: -32002, message: 'Request of type wallet_requestPermissions already pending' })).toContain('already has a request waiting')
  })
  test('a missing wallet and a silent wallet get plain advice', () => {
    expect(walletErrorText({ name: 'ProviderNotFoundError', message: 'Provider not found.' })).toContain('not available in this browser')
    expect(walletErrorText(new Error('wallet-timeout'))).toContain('did not respond')
  })
  test('unknown long technical errors are never shown raw', () => {
    expect(walletErrorText(new Error('x'.repeat(300)))).toBe('Could not connect to that wallet. Please try again.')
  })
})
