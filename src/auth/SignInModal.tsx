import { useState } from 'react'
import { X, Mail, Loader2, ShieldCheck, Wallet, AlertCircle } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { useAuth } from './AuthContext'

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

export function SignInModal() {
  const {
    signInOpen, closeSignIn, flow, config, user, needsReauth,
    sendEmailCode, signInWithGoogle, signInWithWallet,
  } = useAuth()
  const { isConnected } = useAccount()
  const [email, setEmail] = useState(user?.email ?? '')

  if (!signInOpen) return null

  const busy = flow.step === 'sending-code' || flow.step === 'verifying' || flow.step === 'creating-wallet'
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const walletReady = !!config?.circleConfigured && !!config.circleAppId

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(18,45,69,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={!busy ? closeSignIn : undefined}
      />
      <div
        className="relative w-full sm:max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>
            {needsReauth ? 'Verify to continue' : 'Sign in or create an account'}
          </h2>
          {!busy && (
            <button
              onClick={closeSignIn}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Buy and sell with just your email. We set up a secure wallet for you, so there is nothing to install.
          </p>

          {busy ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 size={26} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                {flow.message ?? 'Working…'}
              </p>
              {flow.step === 'verifying' && (
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  A secure Circle window handles your code and PIN. Keep this tab open.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }} htmlFor="signin-email">
                  Email address
                </label>
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-3 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
                />
              </div>

              <button
                onClick={() => void sendEmailCode(email.trim())}
                disabled={!validEmail || !walletReady}
                className="w-full min-h-[44px] py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                <Mail size={15} /> Email me a sign-in code
              </button>

              <button
                onClick={() => void signInWithGoogle()}
                disabled={!walletReady || !config?.googleClientId}
                className="w-full min-h-[44px] py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              >
                <GoogleMark /> Continue with Google
              </button>
              {walletReady && !config?.googleClientId && (
                <p className="text-xs" style={{ color: 'var(--subtle)' }}>
                  Google sign-in turns on once a Google client ID is added to this app.
                </p>
              )}
              {!walletReady && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  Account service is offline right now. You can still sign in with an existing wallet below.
                </p>
              )}

              {flow.step === 'error' && flow.message && (
                <div className="rounded-xl px-4 py-3 flex items-start gap-2" style={{ background: 'rgba(186,43,76,0.08)' }}>
                  <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
                  <p className="text-sm" style={{ color: 'var(--danger)' }}>{flow.message}</p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              {isConnected ? (
                <button
                  onClick={() => void signInWithWallet()}
                  className="w-full min-h-[44px] py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-all active:scale-[0.98]"
                  style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
                >
                  <Wallet size={15} /> Sign a message to continue (free)
                </button>
              ) : (
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button
                      onClick={show}
                      className="w-full min-h-[44px] py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 border transition-all active:scale-[0.98]"
                      style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
                    >
                      <Wallet size={15} /> I already have a crypto wallet
                    </button>
                  )}
                </ConnectKitButton.Custom>
              )}

              <div className="rounded-xl px-4 py-3 flex items-start gap-2" style={{ background: 'var(--surface-muted)' }}>
                <ShieldCheck size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Your wallet is non-custodial. You set a PIN once in Circle&apos;s secure window and only you can approve payments.
                  If you lose access to your email or PIN, nobody can recover the wallet for you.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
