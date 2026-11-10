// ─── KYC Status Banner ────────────────────────────────────────────────────────
// Shows inline on ProviderProfilePage and on the ServicesDirectory "my profile"
// section. Prompts the user to start KYC if needed, shows pending/rejected/
// suspended states with appropriate CTAs.

import { ShieldCheck, Clock, XCircle, AlertTriangle, ChevronRight } from 'lucide-react'
import type { KycRecord } from '../../services/useKyc'

interface KycStatusBannerProps {
  record: KycRecord | undefined
  onStartKyc: () => void
  /** Compact = one line for the directory. Full = expanded card for profile page. */
  variant?: 'compact' | 'full'
}

export function KycStatusBanner({ record, onStartKyc, variant = 'full' }: KycStatusBannerProps) {
  const status = record?.status ?? 'none'

  if (status === 'verified') return null // verified users see no banner — just their badge

  const configs = {
    none: {
      bg:   'rgba(16,97,166,0.08)',
      border: 'rgba(16,97,166,0.20)',
      icon: <ShieldCheck size={variant === 'compact' ? 14 : 18} style={{ color: 'var(--accent)' }} />,
      title: 'Verify your identity to go live',
      body:  'Provider profiles are only visible in search once KYC is complete. It takes about 2 minutes.',
      cta:   'Start Verification',
      ctaBg: 'var(--accent)',
    },
    pending: {
      bg:   'rgba(245,158,11,0.08)',
      border: 'rgba(245,158,11,0.25)',
      icon: <Clock size={variant === 'compact' ? 14 : 18} style={{ color: '#f59e0b' }} />,
      title: 'Verification in progress',
      body:  'We are reviewing your documents. Your profile will go live automatically once verified.',
      cta:   'View Status',
      ctaBg: '#f59e0b',
    },
    rejected: {
      bg:   'rgba(186,43,76,0.08)',
      border: 'rgba(186,43,76,0.22)',
      icon: <XCircle size={variant === 'compact' ? 14 : 18} style={{ color: 'var(--danger)' }} />,
      title: 'Verification failed — action needed',
      body:  record?.rejectionReason ?? 'Your identity could not be verified. Please try again.',
      cta:   'Retry Verification',
      ctaBg: 'var(--danger)',
    },
    suspended: {
      bg:   'rgba(186,43,76,0.08)',
      border: 'rgba(186,43,76,0.22)',
      icon: <AlertTriangle size={variant === 'compact' ? 14 : 18} style={{ color: 'var(--danger)' }} />,
      title: 'Account suspended',
      body:  'Your account has been suspended. Contact support to resolve this.',
      cta:   'View Details',
      ctaBg: 'var(--danger)',
    },
    banned: {
      bg:   'rgba(186,43,76,0.10)',
      border: 'rgba(186,43,76,0.30)',
      icon: <AlertTriangle size={variant === 'compact' ? 14 : 18} style={{ color: 'var(--danger)' }} />,
      title: 'Account permanently banned',
      body:  'Your account has been permanently banned for violations of platform terms.',
      cta:   null,
      ctaBg: null,
    },
  } as const

  const cfg = configs[status] ?? configs.none

  if (variant === 'compact') {
    return (
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border"
        style={{ background: cfg.bg, borderColor: cfg.border }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {cfg.icon}
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>
            {cfg.title}
          </p>
        </div>
        {cfg.cta && (
          <button
            onClick={onStartKyc}
            className="flex items-center gap-1 text-xs font-bold shrink-0 transition-opacity hover:opacity-80"
            style={{ color: cfg.ctaBg ?? 'var(--accent)' }}
          >
            {cfg.cta}
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl px-5 py-4 border mb-5"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      <div className="flex items-start gap-3 mb-3">
        <span className="mt-0.5 shrink-0">{cfg.icon}</span>
        <div className="flex-1">
          <p className="font-bold text-sm mb-0.5" style={{ color: 'var(--ink)' }}>{cfg.title}</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>{cfg.body}</p>
        </div>
      </div>
      {cfg.cta && (
        <button
          onClick={onStartKyc}
          className="w-full py-2.5 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98]"
          style={{ background: cfg.ctaBg ?? 'var(--accent)' }}
        >
          {cfg.cta}
          <ChevronRight size={14} className="inline ml-1" />
        </button>
      )}
    </div>
  )
}
