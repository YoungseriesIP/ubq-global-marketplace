import { ShieldCheck, ShieldAlert, BadgeCheck, Star } from 'lucide-react'
import type { VerificationLevel } from '../../services/types'

interface VerificationBadgeProps {
  level: VerificationLevel
  size?: 'sm' | 'md'
}

const BADGE_CONFIG: Record<
  VerificationLevel,
  { label: string; bg: string; color: string; Icon: React.ElementType } | null
> = {
  none: null,
  basic: {
    label: 'Basic Verified',
    bg: 'rgba(107, 101, 128, 0.12)',
    color: '#6b6580',
    Icon: ShieldAlert,
  },
  kyc: {
    label: 'KYC Verified',
    bg: 'rgba(26, 128, 71, 0.10)',
    color: '#1a8047',
    Icon: ShieldCheck,
  },
  business: {
    label: 'Business Verified',
    bg: 'rgba(16, 97, 166, 0.10)',
    color: '#1061a6',
    Icon: BadgeCheck,
  },
  credentials: {
    label: 'Credentials Reviewed',
    bg: 'rgba(29, 78, 216, 0.10)',
    color: '#1d4ed8',
    Icon: Star,
  },
}

export function VerificationBadge({ level, size = 'sm' }: VerificationBadgeProps) {
  const config = BADGE_CONFIG[level]
  if (!config) return null

  const { label, bg, color, Icon } = config
  const iconSize = size === 'sm' ? 11 : 13
  const textClass = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${textClass}`}
      style={{ background: bg, color }}
    >
      <Icon size={iconSize} />
      {label}
    </span>
  )
}
