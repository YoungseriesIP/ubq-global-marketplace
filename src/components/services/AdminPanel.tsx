// ─── Admin Panel ──────────────────────────────────────────────────────────────
// Accessible only to the configured admin wallet address.
// Tabs: KYC Queue | Providers | Scam Reports | Categories | Analytics
//
// In production, every action here would POST to an authenticated server
// endpoint with admin JWT — never client-side like this.  The localStorage
// simulation here lets the full admin UX be demonstrated without a backend.

import { useState } from 'react'
import {
  ShieldCheck, Users, Flag, LayoutGrid, BarChart2,
  Check, X, Ban, RotateCcw, ChevronDown, ChevronUp,
  AlertTriangle, Edit2, Trash2, Plus, Star, EyeOff, Eye,
} from 'lucide-react'
import type { KycStore, KycRecord, ScamReport } from '../../services/useKyc'
import type { ProvidersStore } from '../../services/data'
import type { ServiceProvider } from '../../services/types'
import type { ReviewsStore, Review } from '../../services/useReviews'
import { SERVICE_CATEGORIES } from '../../services/categories'

// ─── Props / types ────────────────────────────────────────────────────────────

interface AdminPanelProps {
  kycStore:       KycStore
  providerStore:  ProvidersStore
  reviewStore:    ReviewsStore
  onClose:        () => void
}

type AdminTab = 'kyc' | 'providers' | 'reports' | 'reviews' | 'categories' | 'analytics'

const TAB_LABELS: Record<AdminTab, string> = {
  kyc:        'KYC Queue',
  providers:  'Providers',
  reports:    'Scam Reports',
  reviews:    'Reviews',
  categories: 'Categories',
  analytics:  'Analytics',
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminPanel({ kycStore, providerStore, reviewStore, onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('kyc')

  const pendingKyc        = kycStore.records.filter((r) => r.status === 'pending')
  const openReports       = kycStore.scamReports.filter((r) => r.status === 'open')
  const flaggedReviews    = reviewStore.reviews.filter(
    (r) => r.status === 'pending_moderation' || r.reportedBy.length >= 1,
  )

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--bg-gradient)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
          <p className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>Admin Panel</p>
          <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'var(--danger)', color: '#fff' }}>
            INTERNAL
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto shrink-0"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        {(Object.keys(TAB_LABELS) as AdminTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all relative"
            style={{
              background: tab === t ? 'var(--accent)' : 'transparent',
              color:      tab === t ? '#fff' : 'var(--ink-2)',
            }}
          >
            {t === 'kyc'        && <ShieldCheck size={13} />}
            {t === 'providers'  && <Users size={13} />}
            {t === 'reports'    && <Flag size={13} />}
            {t === 'reviews'    && <Star size={13} />}
            {t === 'categories' && <LayoutGrid size={13} />}
            {t === 'analytics'  && <BarChart2 size={13} />}
            {TAB_LABELS[t]}
            {t === 'kyc'     && pendingKyc.length > 0 && (
              <Badge count={pendingKyc.length} />
            )}
            {t === 'reports' && openReports.length > 0 && (
              <Badge count={openReports.length} />
            )}
            {t === 'reviews' && flaggedReviews.length > 0 && (
              <Badge count={flaggedReviews.length} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-5xl mx-auto w-full">
        {tab === 'kyc'        && <KycQueueTab       store={kycStore} providers={providerStore.providers} />}
        {tab === 'providers'  && <ProvidersTab       providerStore={providerStore} kycStore={kycStore} />}
        {tab === 'reports'    && <ScamReportsTab     store={kycStore} providers={providerStore.providers} />}
        {tab === 'reviews'    && <ReviewsModerationTab reviewStore={reviewStore} providers={providerStore.providers} />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'analytics'  && <AnalyticsTab       providerStore={providerStore} kycStore={kycStore} reviewStore={reviewStore} />}
      </div>
    </div>
  )
}

// ─── Tab: KYC Queue ───────────────────────────────────────────────────────────

function KycQueueTab({ store, providers }: { store: KycStore; providers: ServiceProvider[] }) {
  const [rejectWallet, setRejectWallet] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const pending = store.records.filter((r) => r.status === 'pending')

  function getProviderName(wallet: string) {
    return providers.find((p) => p.walletAddress.toLowerCase() === wallet.toLowerCase())?.name ?? wallet.slice(0, 10) + '…'
  }

  if (pending.length === 0) {
    return (
      <EmptySection
        icon={<Check size={32} style={{ color: 'var(--success)' }} />}
        title="KYC Queue is Clear"
        body="All verification requests have been reviewed."
      />
    )
  }

  return (
    <div>
      <SectionTitle>Pending Verifications ({pending.length})</SectionTitle>
      <div className="space-y-4">
        {pending.map((record) => (
          <KycQueueRow
            key={record.walletAddress}
            record={record}
            providerName={getProviderName(record.walletAddress)}
            isRejectOpen={rejectWallet === record.walletAddress}
            rejectReason={rejectReason}
            onRejectReasonChange={setRejectReason}
            onApprove={() => {
              store.approveKyc(record.walletAddress)
            }}
            onRejectToggle={() => {
              if (rejectWallet === record.walletAddress) {
                setRejectWallet(null); setRejectReason('')
              } else {
                setRejectWallet(record.walletAddress); setRejectReason('')
              }
            }}
            onRejectSubmit={() => {
              if (!rejectReason.trim()) return
              store.rejectKyc(record.walletAddress, rejectReason.trim())
              setRejectWallet(null); setRejectReason('')
            }}
          />
        ))}
      </div>
    </div>
  )
}

function KycQueueRow({
  record, providerName, isRejectOpen, rejectReason,
  onRejectReasonChange, onApprove, onRejectToggle, onRejectSubmit,
}: {
  record: KycRecord
  providerName: string
  isRejectOpen: boolean
  rejectReason: string
  onRejectReasonChange: (v: string) => void
  onApprove: () => void
  onRejectToggle: () => void
  onRejectSubmit: () => void
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{providerName}</p>
          <p className="text-xs mono mt-0.5" style={{ color: 'var(--muted)' }}>{record.walletAddress}</p>
          {record.providerRef && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>
              Ref: <span className="mono">{record.providerRef}</span>
            </p>
          )}
        </div>
        <StatusPill status={record.status} />
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--subtle)' }}>
        Submitted: {new Date(record.updatedAt).toLocaleString()}
      </p>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
          style={{ background: 'var(--success)' }}
        >
          <Check size={14} /> Approve
        </button>
        <button
          onClick={onRejectToggle}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all border"
          style={{
            background: isRejectOpen ? 'var(--danger)' : 'transparent',
            color: isRejectOpen ? '#fff' : 'var(--danger)',
            borderColor: 'var(--danger)',
          }}
        >
          <X size={14} /> Reject
          {isRejectOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {isRejectOpen && (
        <div className="mt-3">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            placeholder="Reason for rejection (shown to user)…"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--ink)',
              border: '1.5px solid var(--border)',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--danger)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <button
            onClick={onRejectSubmit}
            disabled={!rejectReason.trim()}
            className="w-full py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'var(--danger)' }}
          >
            Confirm Rejection
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Providers ───────────────────────────────────────────────────────────

function ProvidersTab({ providerStore, kycStore }: { providerStore: ProvidersStore; kycStore: KycStore }) {
  const [search, setSearch] = useState('')
  const [actionWallet, setActionWallet] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState('')

  const filtered = providerStore.providers.filter((p) =>
    !search.trim() ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.location.city.toLowerCase().includes(search.toLowerCase()) ||
    p.categoryId.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <SectionTitle>All Providers ({providerStore.providers.length})</SectionTitle>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, city, category…"
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none mb-5"
        style={{
          background: 'var(--surface-strong)',
          color: 'var(--ink)',
          border: '1.5px solid var(--border)',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      />
      <div className="space-y-4">
        {filtered.map((provider) => {
          const kycRecord  = kycStore.getRecord(provider.walletAddress)
          const isExpanded = actionWallet === provider.walletAddress

          return (
            <div
              key={provider.id}
              className="rounded-2xl border p-5"
              style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{provider.name}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {provider.categoryId} · {provider.location.city}, {provider.location.country}
                  </p>
                  <p className="text-xs mono mt-0.5" style={{ color: 'var(--subtle)' }}>
                    {provider.walletAddress.slice(0, 14)}…
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusPill status={kycRecord?.status ?? 'none'} />
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{
                      background: provider.isActive ? 'rgba(26,128,71,0.10)' : 'rgba(186,43,76,0.10)',
                      color: provider.isActive ? 'var(--success)' : 'var(--danger)',
                    }}
                  >
                    {provider.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* Admin actions */}
              <div className="flex flex-wrap gap-2 mt-3">
                {(kycRecord?.status !== 'verified') && (
                  <ActionButton
                    icon={<Check size={13} />}
                    label="Approve KYC"
                    color="var(--success)"
                    onClick={() => kycStore.approveKyc(provider.walletAddress)}
                  />
                )}
                {kycRecord?.status !== 'suspended' && kycRecord?.status !== 'banned' && (
                  <ActionButton
                    icon={<Ban size={13} />}
                    label="Suspend"
                    color="var(--danger)"
                    onClick={() => {
                      setActionWallet(isExpanded ? null : provider.walletAddress)
                      setActionNote('')
                    }}
                    ghost
                  />
                )}
                {kycRecord?.status === 'suspended' && (
                  <ActionButton
                    icon={<RotateCcw size={13} />}
                    label="Reinstate"
                    color="var(--success)"
                    onClick={() => kycStore.reinstateProvider(provider.walletAddress)}
                  />
                )}
                <ActionButton
                  icon={provider.isActive ? <X size={13} /> : <Check size={13} />}
                  label={provider.isActive ? 'Deactivate' : 'Activate'}
                  color="var(--accent)"
                  onClick={() => providerStore.updateProvider(provider.id, { isActive: !provider.isActive })}
                  ghost
                />
                <ActionButton
                  icon={provider.isFeatured ? <X size={13} /> : <Check size={13} />}
                  label={provider.isFeatured ? 'Remove Sponsor' : 'Set Sponsored'}
                  color="rgba(16,97,166,0.85)"
                  onClick={() => providerStore.updateProvider(provider.id, { isFeatured: !provider.isFeatured })}
                  ghost
                />
              </div>

              {/* Suspend / ban note input */}
              {isExpanded && (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Reason (shown to admin log, not to user)…"
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{
                      background: 'var(--surface-muted)',
                      color: 'var(--ink)',
                      border: '1.5px solid var(--border)',
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        kycStore.suspendProvider(provider.walletAddress, actionNote)
                        setActionWallet(null)
                      }}
                      disabled={!actionNote.trim()}
                      className="flex-1 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                      style={{ background: '#f59e0b' }}
                    >
                      Suspend
                    </button>
                    <button
                      onClick={() => {
                        kycStore.banProvider(provider.walletAddress, actionNote)
                        setActionWallet(null)
                      }}
                      disabled={!actionNote.trim()}
                      className="flex-1 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                      style={{ background: 'var(--danger)' }}
                    >
                      Permanent Ban
                    </button>
                    <button
                      onClick={() => { setActionWallet(null); setActionNote('') }}
                      className="px-3 py-2 rounded-xl text-xs font-semibold"
                      style={{ color: 'var(--muted)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Admin note */}
              {kycRecord?.adminNote && (
                <div className="mt-3 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
                  <p className="text-xs" style={{ color: 'var(--subtle)' }}>Admin note:</p>
                  <p className="text-xs" style={{ color: 'var(--ink-2)' }}>{kycRecord.adminNote}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab: Scam Reports ────────────────────────────────────────────────────────

function ScamReportsTab({ store, providers }: { store: KycStore; providers: ServiceProvider[] }) {
  const [noteMap, setNoteMap] = useState<Record<string, string>>({})

  function getProviderName(id: string) {
    return providers.find((p) => p.id === id)?.name ?? id
  }

  function resolve(report: ScamReport, status: ScamReport['status']) {
    store.resolveScamReport(report.id, status, noteMap[report.id] ?? '')
  }

  const open     = store.scamReports.filter((r) => r.status === 'open')
  const reviewed = store.scamReports.filter((r) => r.status !== 'open')

  return (
    <div>
      <SectionTitle>Open Reports ({open.length})</SectionTitle>
      {open.length === 0 ? (
        <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>No open reports.</p>
      ) : (
        <div className="space-y-4 mb-8">
          {open.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              providerName={getProviderName(report.targetProviderId)}
              note={noteMap[report.id] ?? ''}
              onNoteChange={(v) => setNoteMap((m) => ({ ...m, [report.id]: v }))}
              onAction={resolve}
            />
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <>
          <SectionTitle>Reviewed ({reviewed.length})</SectionTitle>
          <div className="space-y-3">
            {reviewed.map((report) => (
              <div
                key={report.id}
                className="rounded-xl border p-4"
                style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                      {getProviderName(report.targetProviderId)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{report.reason}</p>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
                    style={{
                      background: report.status === 'actioned' ? 'rgba(186,43,76,0.10)' : 'rgba(26,128,71,0.08)',
                      color: report.status === 'actioned' ? 'var(--danger)' : 'var(--success)',
                    }}
                  >
                    {report.status}
                  </span>
                </div>
                {report.adminNote && (
                  <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Note: {report.adminNote}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ReportRow({
  report, providerName, note, onNoteChange, onAction,
}: {
  report: ScamReport
  providerName: string
  note: string
  onNoteChange: (v: string) => void
  onAction: (r: ScamReport, s: ScamReport['status']) => void
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--surface-strong)', borderColor: 'rgba(186,43,76,0.18)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
            Against: {providerName}
          </p>
          <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--danger)' }}>{report.reason}</p>
        </div>
        <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
      </div>
      <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--ink-2)' }}>{report.details}</p>
      <p className="text-xs mb-3" style={{ color: 'var(--subtle)' }}>
        Reporter: <span className="mono">{report.reporterWallet.slice(0, 12)}…</span> ·{' '}
        {new Date(report.createdAt).toLocaleString()}
      </p>
      <input
        type="text"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Admin note (required to resolve)…"
        className="w-full px-3 py-2 rounded-xl text-sm outline-none mb-3"
        style={{
          background: 'var(--surface-muted)',
          color: 'var(--ink)',
          border: '1.5px solid var(--border)',
        }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => onAction(report, 'dismissed')}
          className="flex-1 py-2 rounded-xl text-xs font-bold border transition-all"
          style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
        >
          Dismiss
        </button>
        <button
          onClick={() => onAction(report, 'reviewed')}
          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
          style={{ background: '#f59e0b', color: '#fff' }}
        >
          Reviewed
        </button>
        <button
          onClick={() => onAction(report, 'actioned')}
          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
          style={{ background: 'var(--danger)', color: '#fff' }}
        >
          Action Taken
        </button>
      </div>
    </div>
  )
}

// ─── Tab: Categories ──────────────────────────────────────────────────────────

function CategoriesTab() {
  const [editId, setEditId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Service Categories</SectionTitle>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all"
          style={{ background: 'var(--accent)' }}
          onClick={() => {/* In production: open add category form */}}
        >
          <Plus size={13} /> Add Category
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
        Categories are currently seeded from code. In production, these would be managed via a CMS or database table.
      </p>
      <div className="space-y-3">
        {SERVICE_CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className="rounded-2xl border p-4"
            style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} />
                <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{cat.label}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditId(editId === cat.id ? null : cat.id)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--muted)' }}
                >
                  {editId === cat.id ? <ChevronUp size={14} /> : <Edit2 size={13} />}
                </button>
                <button
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => {/* In production: confirm + delete */}}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {editId === cat.id && (
              <div className="mt-2">
                <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Subcategories:</p>
                <div className="flex flex-wrap gap-1.5">
                  {cat.subcategories.map((s) => (
                    <span
                      key={s}
                      className="px-2.5 py-1 rounded-full text-xs"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>
                  Edit categories by modifying <span className="mono">src/services/categories.ts</span>.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Analytics ───────────────────────────────────────────────────────────

function AnalyticsTab({
  providerStore, kycStore, reviewStore,
}: { providerStore: ProvidersStore; kycStore: KycStore; reviewStore: ReviewsStore }) {
  const providers   = providerStore.providers
  const records     = kycStore.records
  const reports     = kycStore.scamReports
  const reviews     = reviewStore.reviews

  const byCountry   = providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.location.country] = (acc[p.location.country] ?? 0) + 1
    return acc
  }, {})

  const byCategory  = providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.categoryId] = (acc[p.categoryId] ?? 0) + 1
    return acc
  }, {})

  const kycBreakdown = {
    verified:  records.filter((r) => r.status === 'verified').length,
    pending:   records.filter((r) => r.status === 'pending').length,
    rejected:  records.filter((r) => r.status === 'rejected').length,
    suspended: records.filter((r) => r.status === 'suspended').length,
    banned:    records.filter((r) => r.status === 'banned').length,
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Providers',    value: providers.length,                           color: 'var(--accent)'  },
          { label: 'Active Providers',   value: providers.filter((p) => p.isActive).length, color: 'var(--success)' },
          { label: 'Total Reviews',      value: reviews.length,                              color: '#8b5cf6'        },
          { label: 'KYC Records',        value: records.length,                              color: '#f59e0b'        },
          { label: 'Scam Reports',       value: reports.length,                              color: 'var(--danger)'  },
        ].map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} color={stat.color} />
        ))}
      </div>

      {/* KYC breakdown */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionTitle>KYC Status Breakdown</SectionTitle>
        <div className="space-y-2">
          {(Object.entries(kycBreakdown)).map(([status, count]) => (
            <div key={status} className="flex items-center gap-3">
              <span className="text-xs w-20 capitalize" style={{ color: 'var(--ink-2)' }}>{status}</span>
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ background: 'var(--surface-muted)', height: 8 }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${records.length ? (count / records.length) * 100 : 0}%`,
                    background:
                      status === 'verified'  ? 'var(--success)' :
                      status === 'pending'   ? '#f59e0b'         :
                      status === 'rejected'  ? 'var(--danger)'   :
                      status === 'suspended' ? '#f97316'         :
                      'var(--danger)',
                  }}
                />
              </div>
              <span className="text-xs font-bold w-4 text-right tabular-nums" style={{ color: 'var(--ink)' }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Providers by country */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionTitle>Providers by Country</SectionTitle>
        <div className="space-y-2">
          {Object.entries(byCountry)
            .sort(([, a], [, b]) => b - a)
            .map(([country, count]) => (
              <div key={country} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{country}</span>
                <span className="font-bold text-sm tabular-nums" style={{ color: 'var(--ink)' }}>{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* By category */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        <SectionTitle>Providers by Category</SectionTitle>
        <div className="space-y-2">
          {Object.entries(byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--ink-2)' }}>{cat}</span>
                <span className="font-bold text-sm tabular-nums" style={{ color: 'var(--ink)' }}>{count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function Badge({ count }: { count: number }) {
  return (
    <span
      className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
      style={{ background: 'var(--danger)', color: '#fff' }}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    none:      { bg: 'var(--surface-muted)',           color: 'var(--subtle)'  },
    pending:   { bg: 'rgba(245,158,11,0.12)',           color: '#f59e0b'        },
    verified:  { bg: 'rgba(26,128,71,0.10)',            color: 'var(--success)' },
    rejected:  { bg: 'rgba(186,43,76,0.10)',            color: 'var(--danger)'  },
    suspended: { bg: 'rgba(249,115,22,0.12)',           color: '#f97316'        },
    banned:    { bg: 'rgba(186,43,76,0.14)',            color: 'var(--danger)'  },
  }
  const c = colors[status] ?? colors.none
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
      style={{ background: c.bg, color: c.color }}
    >
      {status}
    </span>
  )
}

function ActionButton({
  icon, label, color, onClick, ghost = false,
}: { icon: React.ReactNode; label: string; color: string; onClick: () => void; ghost?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
      style={{
        background: ghost ? 'transparent' : color,
        color:      ghost ? color : '#fff',
        border:     ghost ? `1.5px solid ${color}` : 'none',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="display font-bold text-base mb-4" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
      {children}
    </h3>
  )
}

function EmptySection({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16">
      {icon}
      <div>
        <p className="font-semibold text-base" style={{ color: 'var(--ink-2)' }}>{title}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{body}</p>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-2xl border p-4 text-center"
      style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
    >
      <p className="display font-bold text-3xl tabular-nums mb-1" style={{ color }}>{value}</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
    </div>
  )
}

// ─── Tab: Reviews Moderation ──────────────────────────────────────────────────

function ReviewsModerationTab({
  reviewStore, providers,
}: { reviewStore: ReviewsStore; providers: ServiceProvider[] }) {
  const [hideReason, setHideReason] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'flagged' | 'all'>('flagged')

  function providerName(pid: string) {
    return providers.find((p) => p.id === pid)?.name ?? pid
  }

  const flagged = reviewStore.reviews.filter(
    (r) => r.status === 'pending_moderation' || r.reportedBy.length >= 1,
  )
  const all = [...reviewStore.reviews].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  const list = tab === 'flagged' ? flagged : all

  function handleHide(review: Review) {
    const reason = hideReason[review.id] ?? 'Removed by admin for policy violation'
    reviewStore.hideReview(review.id, reason)
  }

  if (list.length === 0) {
    return (
      <EmptySection
        icon={<Star size={32} style={{ color: 'var(--success)' }} />}
        title={tab === 'flagged' ? 'No Flagged Reviews' : 'No Reviews Yet'}
        body={tab === 'flagged'
          ? 'No reviews are flagged for moderation right now.'
          : 'Reviews will appear here once customers start leaving them.'}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <SectionTitle>Review Moderation</SectionTitle>
        <div className="flex gap-2 ml-auto">
          {(['flagged', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: tab === t ? 'var(--accent)' : 'var(--surface-strong)',
                color:      tab === t ? '#fff'          : 'var(--ink-2)',
                border:     `1.5px solid ${tab === t ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {t === 'flagged' ? `Flagged (${flagged.length})` : `All (${all.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {list.map((review) => (
          <div
            key={review.id}
            className="rounded-2xl border p-4"
            style={{
              background: review.status === 'hidden' ? 'var(--surface-muted)' : 'var(--surface-strong)',
              borderColor: review.reportedBy.length >= 3 ? 'rgba(186,43,76,0.40)' : 'var(--border)',
              opacity: review.status === 'hidden' ? 0.65 : 1,
            }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                  {review.reviewerName}
                  {review.verifiedInteraction && (
                    <span className="ml-2 text-xs font-normal" style={{ color: 'var(--success)' }}>✓ Verified</span>
                  )}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Provider: <strong>{providerName(review.providerId)}</strong>
                  {' · '}{new Date(review.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Star rating */}
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={12}
                      fill={i < review.rating ? '#f59e0b' : 'none'}
                      style={{ color: i < review.rating ? '#f59e0b' : 'var(--border-strong)' }}
                    />
                  ))}
                </span>
                {/* Status badge */}
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
                  style={{
                    background: review.status === 'hidden' ? 'rgba(186,43,76,0.10)'
                      : review.status === 'pending_moderation' ? 'rgba(245,158,11,0.12)'
                      : 'rgba(26,128,71,0.10)',
                    color: review.status === 'hidden' ? 'var(--danger)'
                      : review.status === 'pending_moderation' ? '#f59e0b'
                      : 'var(--success)',
                  }}
                >
                  {review.status === 'pending_moderation' ? 'Flagged' : review.status}
                </span>
              </div>
            </div>

            {/* Body */}
            <p className="text-sm leading-relaxed mb-3 line-clamp-3" style={{ color: 'var(--ink-2)' }}>
              {review.body}
            </p>

            {/* Reports count */}
            {review.reportedBy.length > 0 && (
              <p className="text-xs mb-3 font-semibold" style={{ color: 'var(--danger)' }}>
                ⚑ Reported by {review.reportedBy.length} user{review.reportedBy.length > 1 ? 's' : ''}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              {review.status !== 'hidden' ? (
                <>
                  <input
                    type="text"
                    value={hideReason[review.id] ?? ''}
                    onChange={(e) => setHideReason((p) => ({ ...p, [review.id]: e.target.value }))}
                    placeholder="Reason (optional)…"
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{
                      background: 'var(--surface-muted)',
                      color: 'var(--ink)',
                      border: '1.5px solid var(--border)',
                    }}
                  />
                  <button
                    onClick={() => handleHide(review)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}
                  >
                    <EyeOff size={12} /> Hide
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs flex-1" style={{ color: 'var(--muted)' }}>
                    Hidden: {review.hiddenReason ?? 'Policy violation'}
                  </p>
                  <button
                    onClick={() => reviewStore.unhideReview(review.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: 'rgba(26,128,71,0.10)', color: 'var(--success)' }}
                  >
                    <Eye size={12} /> Unhide
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
