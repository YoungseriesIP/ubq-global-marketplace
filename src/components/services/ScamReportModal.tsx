// ─── Scam Report Modal ────────────────────────────────────────────────────────
// Visible on every provider profile page. Requires a logged-in wallet address.
// Does NOT require the reporter to be KYC verified to minimise the barrier to
// report — but rate-limiting (one report per wallet per provider) is enforced.

import { useState } from 'react'
import { X, Flag, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { KycStore } from '../../services/useKyc'

interface ScamReportModalProps {
  providerName: string
  providerId: string
  reporterWallet: string
  store: KycStore
  onClose: () => void
}

const REASONS = [
  'Requested full payment upfront',
  'Did not deliver the service',
  'Used fake credentials / documents',
  'Impersonation or false identity',
  'Requested payment outside the platform',
  'Scam / fraud',
  'Harassment or inappropriate behaviour',
  'Other',
]

export function ScamReportModal({
  providerName, providerId, reporterWallet, store, onClose,
}: ScamReportModalProps) {
  const [reason,   setReason]   = useState('')
  const [details,  setDetails]  = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error,    setError]    = useState('')

  // One report per wallet per provider
  const alreadyReported = store.scamReports.some(
    (r) =>
      r.reporterWallet.toLowerCase() === reporterWallet.toLowerCase() &&
      r.targetProviderId === providerId,
  )

  function handleSubmit() {
    if (!reason) { setError('Please select a reason.'); return }
    if (details.trim().length < 20) { setError('Please provide at least 20 characters of detail.'); return }
    setError('')
    store.fileScamReport({
      reporterWallet,
      targetProviderId: providerId,
      targetProviderName: providerName,
      reason,
      details: details.trim(),
    })
    setSubmitted(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border overflow-hidden flex flex-col"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          maxHeight: '90dvh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Flag size={16} style={{ color: 'var(--danger)' }} />
            <p className="font-bold text-base display" style={{ color: 'var(--ink)' }}>
              Report a Problem
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {submitted ? (
            <div className="flex flex-col items-center text-center gap-4 py-8">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(26,128,71,0.10)' }}
              >
                <CheckCircle2 size={32} style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <p className="font-bold text-lg display mb-1" style={{ color: 'var(--ink)' }}>Report Submitted</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Our moderation team will review your report and take appropriate action.
                  Thank you for helping keep the community safe.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Close
              </button>
            </div>
          ) : alreadyReported ? (
            <div className="flex flex-col items-center text-center gap-4 py-8">
              <AlertTriangle size={32} style={{ color: '#f59e0b' }} />
              <div>
                <p className="font-bold text-base display mb-1" style={{ color: 'var(--ink)' }}>Already Reported</p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  You have already submitted a report for this provider. Our team is reviewing it.
                </p>
              </div>
              <button onClick={onClose} className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>
                Reporting: <span className="font-semibold" style={{ color: 'var(--ink)' }}>{providerName}</span>
              </p>
              <p className="text-xs mb-5" style={{ color: 'var(--subtle)' }}>
                Reports are reviewed by our moderation team. False reports are a violation of Terms of Service.
              </p>

              {/* Reason */}
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>
                Reason *
              </label>
              <div className="flex flex-wrap gap-2 mb-5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: reason === r ? 'var(--danger)' : 'var(--surface-strong)',
                      color: reason === r ? '#fff' : 'var(--ink-2)',
                      border: `1.5px solid ${reason === r ? 'transparent' : 'var(--border)'}`,
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Details */}
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>
                Details * <span className="font-normal" style={{ color: 'var(--subtle)' }}>(min 20 characters)</span>
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what happened. Include dates, amounts, and any communication you had."
                rows={4}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none mb-1"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                onBlur={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <p className="text-xs mb-5 text-right" style={{ color: 'var(--subtle)' }}>
                {details.length} / 1000
              </p>

              {error && (
                <p className="text-xs mb-4 font-semibold" style={{ color: 'var(--danger)' }}>{error}</p>
              )}

              <button
                onClick={handleSubmit}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: 'var(--danger)', color: '#fff' }}
              >
                Submit Report
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
