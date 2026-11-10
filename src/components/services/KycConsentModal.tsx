// ─── KYC Consent + Verification Flow Modal ───────────────────────────────────
// Step 1: Privacy consent (NDPA / GDPR / US state laws)
// Step 2: Document type selection + file upload simulation
// Step 3: Selfie / liveness check (simulated)
// Step 4: Status screen (pending → verified / rejected)
//
// IMPORTANT: No raw ID image data is stored anywhere in this app.
// In production, the base64 data-URL is forwarded to your server which
// hands it directly to Smile ID / Sumsub / Persona — your DB stores only
// the provider reference + result + timestamp.

import { useState, useRef } from 'react'
import {
  X, ShieldCheck, AlertTriangle, Upload, Camera,
  CheckCircle2, Clock, XCircle, ChevronRight, FileText,
  Eye, EyeOff,
} from 'lucide-react'
import type { KycStore, KycRecord } from '../../services/useKyc'

// ─── Types ───────────────────────────────────────────────────────────────────

interface KycConsentModalProps {
  walletAddress: string
  record: KycRecord | undefined
  store: KycStore
  onClose: () => void
}

type Step = 'consent' | 'document' | 'selfie' | 'status'

const DOC_TYPES = [
  { id: 'passport',         label: 'International Passport' },
  { id: 'national-id',      label: 'National Identity Card' },
  { id: 'drivers-license',  label: "Driver's Licence" },
  { id: 'residence-permit', label: 'Residence Permit' },
] as const

// ─── Component ───────────────────────────────────────────────────────────────

export function KycConsentModal({ walletAddress, record, store, onClose }: KycConsentModalProps) {
  const alreadyConsented = record?.consentGiven === true
  const initialStep: Step =
    !alreadyConsented ? 'consent'
    : record?.status === 'pending' || record?.status === 'verified' ? 'status'
    : 'document'

  const [step,          setStep]          = useState<Step>(initialStep)
  const [docType,       setDocType]       = useState('')
  const [docPreview,    setDocPreview]    = useState<string | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [submitting,    setSubmitting]    = useState(false)
  const [showAddress,   setShowAddress]   = useState(false)
  // Consent checkboxes
  const [ck1, setCk1] = useState(false)
  const [ck2, setCk2] = useState(false)
  const [ck3, setCk3] = useState(false)
  const [ck4, setCk4] = useState(false)
  const consentReady = ck1 && ck2 && ck3 && ck4

  const docInputRef    = useRef<HTMLInputElement>(null)
  const selfieInputRef = useRef<HTMLInputElement>(null)

  // Live status when on status step
  const liveRecord = store.getRecord(walletAddress)

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleConsentSubmit() {
    store.submitConsent(walletAddress)
    setStep('document')
  }

  function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setDocPreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  function handleSelfieFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setSelfiePreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  function handleSubmitKyc() {
    if (!docType || !docPreview || !selfiePreview) return
    setSubmitting(true)
    // Pass base64 data to the store — store discards image, only keeps ref
    store.submitKyc(walletAddress, docType, selfiePreview)
    setTimeout(() => {
      setSubmitting(false)
      setStep('status')
    }, 800)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const short = showAddress
    ? walletAddress
    : walletAddress.slice(0, 8) + '…' + walletAddress.slice(-6)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border overflow-hidden flex flex-col"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          maxHeight: '92dvh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
            <p className="font-bold text-base display" style={{ color: 'var(--ink)' }}>
              Identity Verification
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-gray-100"
            style={{ color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Wallet row */}
        <div
          className="px-6 py-3 flex items-center gap-2 border-b shrink-0"
          style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Wallet:</span>
          <span className="text-xs font-semibold mono flex-1 truncate" style={{ color: 'var(--ink-2)' }}>{short}</span>
          <button
            onClick={() => setShowAddress(!showAddress)}
            className="shrink-0"
            style={{ color: 'var(--subtle)' }}
            aria-label={showAddress ? 'Hide address' : 'Show full address'}
          >
            {showAddress ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 py-3 shrink-0">
          {(['consent', 'document', 'selfie', 'status'] as Step[]).map((s, i) => (
            <div
              key={s}
              className="rounded-full transition-all"
              style={{
                width: step === s ? 20 : 8,
                height: 8,
                background: step === s ? 'var(--accent)' : (
                  ['consent', 'document', 'selfie', 'status'].indexOf(step) > i
                    ? 'var(--success)'
                    : 'var(--border-strong)'
                ),
              }}
            />
          ))}
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 pb-6">

          {/* ── Step 1: Consent ───────────────────────────────────────────── */}
          {step === 'consent' && (
            <div className="pt-2">
              <h2 className="display font-bold text-xl mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
                Privacy & Consent
              </h2>
              <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--muted)' }}>
                To make your provider profile visible in search results, we verify your identity using a
                third-party KYC provider. This protects customers and builds trust across the marketplace.
                Please read and accept the following before proceeding.
              </p>

              <div className="space-y-4 mb-6">
                <ConsentCheck checked={ck1} onChange={setCk1}>
                  I understand that my identity documents and selfie will be processed by a third-party
                  KYC provider (Smile ID / Sumsub or Persona) and that <strong>TradePort does not store raw
                  ID images</strong> on its servers — only the verification reference, result, and timestamp.
                </ConsentCheck>

                <ConsentCheck checked={ck2} onChange={setCk2}>
                  I have read the{' '}
                  <a href="#" className="underline" style={{ color: 'var(--accent)' }}>Privacy Notice</a>
                  {' '}and consent to my personal data being processed for identity verification purposes
                  under the <strong>Nigeria Data Protection Act (NDPA)</strong>, the EU/UK
                  <strong> General Data Protection Regulation (GDPR)</strong>, and applicable US state laws
                  including the CCPA.
                </ConsentCheck>

                <ConsentCheck checked={ck3} onChange={setCk3}>
                  I understand I can request deletion of my personal data at any time by contacting support,
                  and that my verification status may be retained for legal/compliance purposes for up to
                  5 years.
                </ConsentCheck>

                <ConsentCheck checked={ck4} onChange={setCk4}>
                  I confirm that the identity documents I will upload belong to me and are genuine. I
                  understand that submitting false documents is a violation of platform Terms of Service
                  and may be referred to law enforcement.
                </ConsentCheck>
              </div>

              <div
                className="rounded-xl px-4 py-3 mb-6 flex items-start gap-2"
                style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.18)' }}
              >
                <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} className="mt-0.5" />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                  Your data is processed securely. We never share your identity documents with providers or
                  customers — only your verification badge is visible publicly.
                </p>
              </div>

              <button
                onClick={handleConsentSubmit}
                disabled={!consentReady}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                I Agree — Continue to ID Upload
                <ChevronRight size={14} className="inline ml-1" />
              </button>
            </div>
          )}

          {/* ── Step 2: Document upload ────────────────────────────────────── */}
          {step === 'document' && (
            <div className="pt-2">
              <h2 className="display font-bold text-xl mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
                Upload ID Document
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
                Choose your document type and upload a clear, well-lit photo of the front page.
                Accepted formats: JPG, PNG, PDF. Max 10 MB.
              </p>

              {/* Doc type selection */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                {DOC_TYPES.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDocType(d.id)}
                    className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all text-left"
                    style={{
                      background: docType === d.id ? 'var(--accent)' : 'var(--surface-strong)',
                      color: docType === d.id ? '#fff' : 'var(--ink-2)',
                      border: `1.5px solid ${docType === d.id ? 'transparent' : 'var(--border)'}`,
                    }}
                  >
                    <FileText size={14} />
                    {d.label}
                  </button>
                ))}
              </div>

              {/* File upload area */}
              <input
                ref={docInputRef}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={handleDocFile}
              />
              <button
                onClick={() => docInputRef.current?.click()}
                className="w-full py-10 rounded-2xl border-2 border-dashed flex flex-col items-center gap-3 transition-all hover:opacity-80 mb-5"
                style={{
                  borderColor: docPreview ? 'var(--success)' : 'var(--border-strong)',
                  background: docPreview ? 'rgba(26,128,71,0.05)' : 'var(--surface-muted)',
                }}
              >
                {docPreview ? (
                  <>
                    <CheckCircle2 size={28} style={{ color: 'var(--success)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Document uploaded</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Click to replace</p>
                  </>
                ) : (
                  <>
                    <Upload size={28} style={{ color: 'var(--muted)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Click to upload document</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>JPG · PNG · PDF · Max 10 MB</p>
                  </>
                )}
              </button>

              <div
                className="rounded-xl px-4 py-3 mb-6 flex items-start gap-2"
                style={{ background: 'rgba(16,97,166,0.07)', border: '1px solid rgba(16,97,166,0.18)' }}
              >
                <ShieldCheck size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} className="mt-0.5" />
                <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                  Your document is encrypted in transit and sent directly to our KYC provider.
                  TradePort never receives or stores the image.
                </p>
              </div>

              <button
                onClick={() => setStep('selfie')}
                disabled={!docType || !docPreview}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Continue to Selfie Check
                <ChevronRight size={14} className="inline ml-1" />
              </button>
            </div>
          )}

          {/* ── Step 3: Selfie / liveness ─────────────────────────────────── */}
          {step === 'selfie' && (
            <div className="pt-2">
              <h2 className="display font-bold text-xl mb-2" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
                Selfie Check
              </h2>
              <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                Take or upload a clear selfie to confirm you are the person on the document.
                Ensure your face is fully visible, well lit, and not obscured.
              </p>

              <ul className="list-disc list-inside mb-5 space-y-1">
                {[
                  'Look directly at the camera',
                  'Remove glasses if possible',
                  'No filters or editing',
                  'Plain background preferred',
                ].map((tip) => (
                  <li key={tip} className="text-xs" style={{ color: 'var(--muted)' }}>{tip}</li>
                ))}
              </ul>

              <input
                ref={selfieInputRef}
                type="file"
                accept="image/jpeg,image/png"
                capture="user"
                className="hidden"
                onChange={handleSelfieFile}
              />
              <button
                onClick={() => selfieInputRef.current?.click()}
                className="w-full py-10 rounded-2xl border-2 border-dashed flex flex-col items-center gap-3 transition-all hover:opacity-80 mb-5"
                style={{
                  borderColor: selfiePreview ? 'var(--success)' : 'var(--border-strong)',
                  background: selfiePreview ? 'rgba(26,128,71,0.05)' : 'var(--surface-muted)',
                }}
              >
                {selfiePreview ? (
                  <>
                    <img referrerPolicy="no-referrer"
                      src={selfiePreview}
                      alt="Selfie preview"
                      className="w-20 h-20 rounded-full object-cover border-2"
                      style={{ borderColor: 'var(--success)' }}
                    />
                    <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Selfie captured</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Click to retake</p>
                  </>
                ) : (
                  <>
                    <Camera size={28} style={{ color: 'var(--muted)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Take or upload selfie</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>JPG · PNG · Max 10 MB</p>
                  </>
                )}
              </button>

              <button
                onClick={handleSubmitKyc}
                disabled={!selfiePreview || submitting}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {submitting ? 'Submitting…' : 'Submit for Verification'}
              </button>
            </div>
          )}

          {/* ── Step 4: Status ────────────────────────────────────────────── */}
          {step === 'status' && (
            <StatusStep
              record={liveRecord}
              walletAddress={walletAddress}
              onRetry={() => {
                store.retryKyc(walletAddress)
                setDocPreview(null)
                setSelfiePreview(null)
                setDocType('')
                setStep('document')
              }}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConsentCheck({
  checked, onChange, children,
}: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div
        className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
        style={{
          background: checked ? 'var(--accent)' : 'transparent',
          borderColor: checked ? 'var(--accent)' : 'var(--border-strong)',
        }}
        onClick={() => onChange(!checked)}
      >
        {checked && <CheckCircle2 size={12} color="#fff" />}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        {children}
      </p>
    </label>
  )
}

function StatusStep({
  record, walletAddress, onRetry, onClose,
}: {
  record: KycRecord | undefined
  walletAddress: string
  onRetry: () => void
  onClose: () => void
}) {
  const status = record?.status ?? 'pending'
  const short  = walletAddress.slice(0, 8) + '…' + walletAddress.slice(-6)

  if (status === 'pending') {
    return (
      <div className="pt-4 flex flex-col items-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse"
          style={{ background: 'rgba(245,158,11,0.15)' }}
        >
          <Clock size={28} style={{ color: '#f59e0b' }} />
        </div>
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)' }}>Verification in Progress</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Your documents are being reviewed. This usually takes a few minutes.
            We will update your badge automatically once complete.
          </p>
        </div>
        {record?.providerRef && (
          <div
            className="px-4 py-2 rounded-lg border w-full"
            style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>Reference:</p>
            <p className="text-sm font-semibold mono" style={{ color: 'var(--ink-2)' }}>{record.providerRef}</p>
          </div>
        )}
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          Wallet: <span className="mono">{short}</span>
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all"
          style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
        >
          Close — I will check back later
        </button>
      </div>
    )
  }

  if (status === 'verified') {
    return (
      <div className="pt-4 flex flex-col items-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(26,128,71,0.12)' }}
        >
          <CheckCircle2 size={32} style={{ color: 'var(--success)' }} />
        </div>
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)' }}>Identity Verified!</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Your profile now carries a <strong>KYC Verified</strong> badge.
            Your profile is visible to all users in the directory.
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
          style={{ background: 'var(--success)', color: '#fff' }}
        >
          Done
        </button>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="pt-4 flex flex-col items-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(186,43,76,0.10)' }}
        >
          <XCircle size={32} style={{ color: 'var(--danger)' }} />
        </div>
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)' }}>Verification Failed</h3>
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            We were unable to verify your identity. Reason:
          </p>
          {record?.rejectionReason && (
            <div
              className="px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
            >
              {record.rejectionReason}
            </div>
          )}
        </div>
        <button
          onClick={onRetry}
          className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Try Again
        </button>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm transition-all"
          style={{ background: 'transparent', color: 'var(--muted)' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  if (status === 'suspended' || status === 'banned') {
    return (
      <div className="pt-4 flex flex-col items-center text-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(186,43,76,0.10)' }}
        >
          <AlertTriangle size={32} style={{ color: 'var(--danger)' }} />
        </div>
        <div>
          <h3 className="display font-bold text-lg mb-1" style={{ color: 'var(--ink)' }}>
            Account {status === 'banned' ? 'Banned' : 'Suspended'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Your account has been {status === 'banned' ? 'permanently banned' : 'temporarily suspended'}
            {' '}by an administrator. Contact support if you believe this is an error.
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all"
          style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
        >
          Close
        </button>
      </div>
    )
  }

  return null
}
