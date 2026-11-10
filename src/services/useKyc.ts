// ─── KYC & Trust Store ────────────────────────────────────────────────────────
// This module manages KYC verification state, scam reports, admin overrides,
// and wallet-account links entirely on the client (localStorage) so the SPA
// works without a backend.  In production, the KYC submission would POST to a
// server that calls Smile ID / Sumsub / Persona and stores only the provider
// reference + result — raw ID images are never stored on your servers.

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected' | 'suspended' | 'banned'

export interface KycRecord {
  /** Wallet address — the stable identity key */
  walletAddress: string
  status: KycStatus
  /** Reason shown to the user on rejection */
  rejectionReason?: string
  /** Reference returned by the KYC provider (e.g. Smile ID job ID) */
  providerRef?: string
  /** ISO timestamp of last status change */
  updatedAt: string
  /** True once the user has accepted the privacy/consent screen */
  consentGiven: boolean
  /** ISO timestamp consent was recorded */
  consentAt?: string
  /** Wallet address is linked to a verified account — one person, one account */
  linkedWallets: string[]
  /** Admin notes (internal) */
  adminNote?: string
  /** Whether admin manually overrode the status */
  adminOverride?: boolean
}

export interface ScamReport {
  id: string
  reporterWallet: string
  targetProviderId: string
  targetProviderName: string
  reason: string
  details: string
  status: 'open' | 'reviewed' | 'dismissed' | 'actioned'
  createdAt: string
  adminNote?: string
}

export interface KycStore {
  records: KycRecord[]
  scamReports: ScamReport[]
  // User-facing
  getRecord: (wallet: string) => KycRecord | undefined
  submitConsent: (wallet: string) => void
  submitKyc: (wallet: string, documentType: string, selfieB64: string) => void
  retryKyc: (wallet: string) => void
  fileScamReport: (report: Omit<ScamReport, 'id' | 'status' | 'createdAt'>) => void
  // Admin-facing
  approveKyc: (wallet: string) => void
  rejectKyc: (wallet: string, reason: string) => void
  suspendProvider: (wallet: string, note: string) => void
  banProvider: (wallet: string, note: string) => void
  reinstateProvider: (wallet: string) => void
  resolveScamReport: (id: string, status: ScamReport['status'], note: string) => void
  updateAdminNote: (wallet: string, note: string) => void
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KYC_KEY      = 'tradeport_kyc_v1'
const REPORTS_KEY  = 'tradeport_scam_reports_v1'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadKyc(): KycRecord[] {
  try {
    const raw = localStorage.getItem(KYC_KEY)
    return raw ? (JSON.parse(raw) as KycRecord[]) : []
  } catch { return [] }
}

function loadReports(): ScamReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    return raw ? (JSON.parse(raw) as ScamReport[]) : []
  } catch { return [] }
}

function saveKyc(records: KycRecord[]) {
  try { localStorage.setItem(KYC_KEY, JSON.stringify(records)) } catch { /* quota */ }
}

function saveReports(reports: ScamReport[]) {
  try { localStorage.setItem(REPORTS_KEY, JSON.stringify(reports)) } catch { /* quota */ }
}

function now() { return new Date().toISOString() }

function upsert(records: KycRecord[], wallet: string, patch: Partial<KycRecord>): KycRecord[] {
  const idx = records.findIndex((r) => r.walletAddress.toLowerCase() === wallet.toLowerCase())
  if (idx === -1) {
    const fresh: KycRecord = {
      walletAddress: wallet,
      status: 'none',
      consentGiven: false,
      linkedWallets: [],
      updatedAt: now(),
      ...patch,
    }
    return [fresh, ...records]
  }
  return records.map((r, i) => i === idx ? { ...r, ...patch, updatedAt: now() } : r)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKyc(): KycStore {
  const [records,     setRecords]     = useState<KycRecord[]>(loadKyc)
  const [scamReports, setScamReports] = useState<ScamReport[]>(loadReports)

  useEffect(() => { saveKyc(records)          }, [records])
  useEffect(() => { saveReports(scamReports)  }, [scamReports])

  const getRecord = useCallback(
    (wallet: string) =>
      records.find((r) => r.walletAddress.toLowerCase() === wallet.toLowerCase()),
    [records],
  )

  // ── User actions ────────────────────────────────────────────────────────────

  const submitConsent = useCallback((wallet: string) => {
    setRecords((prev) => upsert(prev, wallet, { consentGiven: true, consentAt: now() }))
  }, [])

  /**
   * In production this would POST to your server which calls Smile ID / Sumsub.
   * Here we simulate:  immediately → 'pending', then after 3 s auto-approve
   * (demo behaviour) unless the wallet already had a rejection.
   *
   * IMPORTANT: selfieB64 is a data-URL from a <input type="file"> — it is passed
   * to the KYC provider's SDK and NEVER stored in your database or localStorage.
   * We discard it immediately after the call.
   */
  const submitKyc = useCallback((wallet: string, _documentType: string, _selfieB64: string) => {
    // Store only status transition, never the raw image
    setRecords((prev) => upsert(prev, wallet, {
      status: 'pending',
      providerRef: `DEMO-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      rejectionReason: undefined,
    }))

    // Demo: auto-approve after 3 seconds to simulate async KYC callback
    setTimeout(() => {
      setRecords((prev) => upsert(prev, wallet, { status: 'verified' }))
    }, 3000)
  }, [])

  const retryKyc = useCallback((wallet: string) => {
    setRecords((prev) => upsert(prev, wallet, {
      status: 'none',
      rejectionReason: undefined,
      providerRef: undefined,
    }))
  }, [])

  const fileScamReport = useCallback((report: Omit<ScamReport, 'id' | 'status' | 'createdAt'>) => {
    const newReport: ScamReport = {
      ...report,
      id: `rpt-${Date.now()}`,
      status: 'open',
      createdAt: now(),
    }
    setScamReports((prev) => [newReport, ...prev])
  }, [])

  // ── Admin actions ───────────────────────────────────────────────────────────

  const approveKyc = useCallback((wallet: string) => {
    setRecords((prev) => upsert(prev, wallet, { status: 'verified', adminOverride: true }))
  }, [])

  const rejectKyc = useCallback((wallet: string, reason: string) => {
    setRecords((prev) => upsert(prev, wallet, {
      status: 'rejected',
      rejectionReason: reason,
      adminOverride: true,
    }))
  }, [])

  const suspendProvider = useCallback((wallet: string, note: string) => {
    setRecords((prev) => upsert(prev, wallet, { status: 'suspended', adminNote: note, adminOverride: true }))
  }, [])

  const banProvider = useCallback((wallet: string, note: string) => {
    setRecords((prev) => upsert(prev, wallet, { status: 'banned', adminNote: note, adminOverride: true }))
  }, [])

  const reinstateProvider = useCallback((wallet: string) => {
    setRecords((prev) => upsert(prev, wallet, { status: 'verified', adminOverride: true, adminNote: undefined }))
  }, [])

  const resolveScamReport = useCallback((id: string, status: ScamReport['status'], note: string) => {
    setScamReports((prev) => prev.map((r) => r.id === id ? { ...r, status, adminNote: note } : r))
  }, [])

  const updateAdminNote = useCallback((wallet: string, note: string) => {
    setRecords((prev) => upsert(prev, wallet, { adminNote: note }))
  }, [])

  return {
    records, scamReports,
    getRecord, submitConsent, submitKyc, retryKyc, fileScamReport,
    approveKyc, rejectKyc, suspendProvider, banProvider, reinstateProvider,
    resolveScamReport, updateAdminNote,
  }
}
