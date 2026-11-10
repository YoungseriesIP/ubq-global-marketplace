// Sign-in with email (one-time code), Google, or an existing wallet.
// Email and Google users get a Circle user-controlled wallet created for them
// (they set a PIN once in Circle's secure window). Wallet users sign a message.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import type { W3SSdk } from '@circle-fin/w3s-pw-web-sdk'
import type { SocialLoginProvider } from '@circle-fin/w3s-pw-web-sdk/dist/src/types'
import { api, ApiError, getSessionToken, setSessionToken } from '@/lib/api'
import type { AppUser, ServerConfig } from '@/lib/api'

export type FlowStep = 'idle' | 'sending-code' | 'enter-code' | 'verifying' | 'creating-wallet' | 'error'

export interface SignInFlow {
  step: FlowStep
  message?: string
}

interface CircleCreds { userToken: string; encryptionKey: string }
interface SocialDevice { deviceToken: string; deviceEncryptionKey: string }

interface AuthContextValue {
  user: AppUser | null
  address: `0x${string}` | undefined
  loading: boolean
  config: ServerConfig | null
  flow: SignInFlow
  /** Circle users need a fresh Circle login (every ~60 min) before they can pay. */
  needsReauth: boolean
  circleCreds: CircleCreds | null
  signInOpen: boolean
  openSignIn: () => void
  closeSignIn: () => void
  sendEmailCode: (email: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signInWithWallet: () => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  updateProfile: (patch: Partial<Pick<AppUser, 'displayName' | 'shopName' | 'shopBio' | 'countryCode'>>) => Promise<void>
  executeChallenge: (challengeId: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const CREDS_KEY = 'tp_circle_creds_v1'      // sessionStorage: cleared when the tab closes
const SOCIAL_KEY = 'tp_social_device_v1'    // survives the Google redirect

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function readCreds(): CircleCreds | null {
  try {
    const raw = sessionStorage.getItem(CREDS_KEY)
    return raw ? (JSON.parse(raw) as CircleCreds) : null
  } catch {
    return null
  }
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  const m = (e as { message?: string })?.message
  return m ?? 'Something went wrong. Please try again.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address: wagmiAddress } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState<boolean>(() => getSessionToken() !== null)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [flow, setFlow] = useState<SignInFlow>({ step: 'idle' })
  const [signInOpen, setSignInOpen] = useState(false)
  const [creds, setCreds] = useState<CircleCreds | null>(() => readCreds())

  const sdkRef = useRef<W3SSdk | null>(null)
  const credsRef = useRef<CircleCreds | null>(creds)
  const configRef = useRef<ServerConfig | null>(null)
  const loginHandlerRef = useRef<(err: unknown, res: unknown) => void>(() => {})

  // ── Restore session + load server config ────────────────────────────────
  useEffect(() => {
    let cancelled = false
    api<ServerConfig>('/config', { auth: false })
      .then((c) => { if (!cancelled) { configRef.current = c; setConfig(c) } })
      .catch(() => { /* server offline: browsing still works from cached state */ })

    if (getSessionToken()) {
      api<{ user: AppUser }>('/me')
        .then((r) => { if (!cancelled) setUser(r.user) })
        .catch(() => setSessionToken(null))
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, [])

  // ── Circle SDK (created once the app id is known) ───────────────────────
  useEffect(() => {
    if (!config?.circleAppId || sdkRef.current) return
    let cancelled = false
    void (async () => {
      try {
        const { W3SSdk: Sdk } = await import('@circle-fin/w3s-pw-web-sdk')
        let social: SocialDevice | null = null
        try {
          const raw = localStorage.getItem(SOCIAL_KEY)
          social = raw ? (JSON.parse(raw) as SocialDevice) : null
        } catch { social = null }

        const loginConfigs = social && config.googleClientId
          ? {
              deviceToken: social.deviceToken,
              deviceEncryptionKey: social.deviceEncryptionKey,
              google: { clientId: config.googleClientId, redirectUri: window.location.origin, selectAccountPrompt: true },
            }
          : undefined

        const sdk = new Sdk(
          { appSettings: { appId: config.circleAppId as string }, ...(loginConfigs ? { loginConfigs } : {}) },
          (err, res) => loginHandlerRef.current(err, res),
        )
        if (cancelled) return
        sdkRef.current = sdk
        await sdk.getDeviceId() // opens the secure session; required before execute()
      } catch {
        if (!cancelled) setFlow({ step: 'error', message: 'Could not start the secure wallet window.' })
      }
    })()
    return () => { cancelled = true }
  }, [config])

  const executeChallenge = useCallback((challengeId: string): Promise<void> => {
    const sdk = sdkRef.current
    const c = credsRef.current
    if (!sdk || !c) return Promise.reject(new Error('Please sign in again to continue.'))
    sdk.setAuthentication({ userToken: c.userToken, encryptionKey: c.encryptionKey })
    return new Promise<void>((resolve, reject) => {
      sdk.execute(challengeId, (error) => {
        if (error) reject(new Error((error as { message?: string }).message ?? 'The action was cancelled.'))
        else resolve()
      })
    })
  }, [])

  // ── Finish a Circle login: open an app session, create the wallet if needed ─
  const finishCircleLogin = useCallback(async (c: CircleCreds) => {
    try {
      sessionStorage.setItem(CREDS_KEY, JSON.stringify(c))
      credsRef.current = c
      setCreds(c)
      setFlow({ step: 'creating-wallet', message: 'Setting up your wallet…' })

      type SessionRes = { token?: string; needsWallet?: boolean }
      let s = await api<SessionRes>('/wallet/session', { body: { userToken: c.userToken }, auth: false })

      if (s.needsWallet) {
        const init = await api<{ challengeId?: string; alreadyInitialized?: boolean }>('/wallet/initialize', {
          body: { userToken: c.userToken }, auth: false,
        })
        if (init.challengeId) await executeChallenge(init.challengeId)
        for (let i = 0; i < 20 && !s.token; i += 1) {
          await sleep(2000)
          s = await api<SessionRes>('/wallet/session', { body: { userToken: c.userToken }, auth: false })
        }
      }
      if (!s.token) throw new Error('Your wallet is still being created. Please try again in a moment.')

      setSessionToken(s.token)
      const me = await api<{ user: AppUser }>('/me')
      setUser(me.user)
      localStorage.removeItem(SOCIAL_KEY)
      setFlow({ step: 'idle' })
      setSignInOpen(false)
    } catch (e) {
      setFlow({ step: 'error', message: errText(e) })
    }
  }, [executeChallenge])

  useEffect(() => {
    loginHandlerRef.current = (err, res) => {
      if (err) {
        setFlow({ step: 'error', message: (err as { message?: string }).message ?? 'Sign-in was cancelled.' })
        return
      }
      const r = res as { userToken?: string; encryptionKey?: string }
      if (r.userToken && r.encryptionKey) void finishCircleLogin({ userToken: r.userToken, encryptionKey: r.encryptionKey })
    }
  }, [finishCircleLogin])

  // ── Email one-time code ─────────────────────────────────────────────────
  const sendEmailCode = useCallback(async (email: string) => {
    const sdk = sdkRef.current
    const appId = configRef.current?.circleAppId
    if (!sdk || !appId) { setFlow({ step: 'error', message: 'Wallet service is still loading. Try again in a moment.' }); return }
    try {
      setFlow({ step: 'sending-code' })
      const deviceId = await sdk.getDeviceId()
      const r = await api<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string }>('/wallet/request-otp', {
        body: { deviceId, email }, auth: false,
      })
      sdk.updateConfigs({
        appSettings: { appId },
        loginConfigs: { deviceToken: r.deviceToken, deviceEncryptionKey: r.deviceEncryptionKey, otpToken: r.otpToken },
      })
      setFlow({ step: 'verifying', message: 'Enter the code we emailed you in the secure window.' })
      sdk.verifyOtp() // Circle's hosted window collects the code
    } catch (e) {
      setFlow({ step: 'error', message: errText(e) })
    }
  }, [])

  // ── Google ──────────────────────────────────────────────────────────────
  const signInWithGoogle = useCallback(async () => {
    const sdk = sdkRef.current
    const cfg = configRef.current
    if (!sdk || !cfg?.circleAppId || !cfg.googleClientId) {
      setFlow({ step: 'error', message: 'Google sign-in is not set up yet.' })
      return
    }
    try {
      setFlow({ step: 'sending-code', message: 'Opening Google…' })
      const deviceId = await sdk.getDeviceId()
      const r = await api<{ deviceToken: string; deviceEncryptionKey: string }>('/wallet/device-token', {
        body: { deviceId }, auth: false,
      })
      localStorage.setItem(SOCIAL_KEY, JSON.stringify(r)) // the page reloads after Google redirects back
      sdk.updateConfigs({
        appSettings: { appId: cfg.circleAppId },
        loginConfigs: {
          deviceToken: r.deviceToken,
          deviceEncryptionKey: r.deviceEncryptionKey,
          google: { clientId: cfg.googleClientId, redirectUri: window.location.origin, selectAccountPrompt: true },
        },
      })
      await sdk.performLogin('Google' as unknown as SocialLoginProvider)
    } catch (e) {
      setFlow({ step: 'error', message: errText(e) })
    }
  }, [])

  // ── Existing wallet (signature, no gas) ─────────────────────────────────
  const signInWithWallet = useCallback(async () => {
    if (!wagmiAddress) { setFlow({ step: 'error', message: 'Connect a wallet first.' }); return }
    try {
      setFlow({ step: 'verifying', message: 'Approve the signature request in your wallet.' })
      const { message } = await api<{ message: string }>('/auth/nonce', { body: { address: wagmiAddress }, auth: false })
      const signature = await signMessageAsync({ message })
      const r = await api<{ token: string }>('/auth/verify', { body: { address: wagmiAddress, signature }, auth: false })
      setSessionToken(r.token)
      const me = await api<{ user: AppUser }>('/me')
      setUser(me.user)
      setFlow({ step: 'idle' })
      setSignInOpen(false)
    } catch (e) {
      setFlow({ step: 'error', message: errText(e) })
    }
  }, [wagmiAddress, signMessageAsync])

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }) } catch { /* already gone */ }
    setSessionToken(null)
    sessionStorage.removeItem(CREDS_KEY)
    credsRef.current = null
    setCreds(null)
    setUser(null)
    setFlow({ step: 'idle' })
  }, [])

  const refreshUser = useCallback(async () => {
    const me = await api<{ user: AppUser }>('/me')
    setUser(me.user)
  }, [])

  const updateProfile = useCallback<AuthContextValue['updateProfile']>(async (patch) => {
    const r = await api<{ user: AppUser }>('/me', { method: 'PATCH', body: patch })
    setUser(r.user)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    address: user?.address,
    loading,
    config,
    flow,
    needsReauth: user?.method === 'circle' && creds === null,
    circleCreds: creds,
    signInOpen,
    openSignIn: () => { setFlow({ step: 'idle' }); setSignInOpen(true) },
    closeSignIn: () => setSignInOpen(false),
    sendEmailCode,
    signInWithGoogle,
    signInWithWallet,
    signOut,
    refreshUser,
    updateProfile,
    executeChallenge,
  }), [user, loading, config, flow, creds, signInOpen, sendEmailCode, signInWithGoogle, signInWithWallet, signOut, refreshUser, updateProfile, executeChallenge])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
