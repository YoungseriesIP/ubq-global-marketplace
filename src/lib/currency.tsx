// Local-currency display. Prices are stored and settled in USDC (1 USDC = 1 USD).
// Buyers see their local currency; the USDC amount that moves onchain is always the
// exact listed price, so no rounding ever touches the money path.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'

export const COUNTRY_CURRENCY: Record<string, string> = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', ET: 'ETB', EG: 'EGP', TZ: 'TZS', SN: 'XOF', CI: 'XOF',
  CM: 'XAF', UG: 'UGX', RW: 'RWF', ZM: 'ZMW', ZW: 'USD', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', SE: 'SEK', NO: 'NOK', CH: 'CHF', BE: 'EUR',
  PT: 'EUR', PL: 'PLN', AT: 'EUR', IR: 'IRR', TR: 'TRY', SA: 'SAR', AE: 'AED', IN: 'INR', CN: 'CNY',
  JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', ID: 'IDR', PH: 'PHP', TH: 'THB', VN: 'VND', PK: 'PKR',
  BD: 'BDT', BR: 'BRL', MX: 'MXN', AR: 'ARS', CO: 'COP', CL: 'CLP', PE: 'PEN', VE: 'VES', RU: 'RUB',
  UA: 'UAH',
}

export const CURRENCY_OPTIONS = [
  'USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'EGP', 'CNY', 'JPY', 'KRW', 'INR', 'BRL', 'MXN',
  'CAD', 'AUD', 'AED', 'SAR', 'TRY', 'SGD', 'IRR', 'RUB',
]

interface CurrencyContextValue {
  /** Currency being displayed (ISO 4217). "USD" means no conversion. */
  currency: string
  /** True when the user picked a currency, false when it follows the country filter. */
  isManual: boolean
  setCurrency: (code: string | null) => void
  ratesReady: boolean
  /** Local-currency text for a USDC amount, e.g. "₦341,000". Null when rates aren't loaded. */
  localText: (usdc: number | string) => string | null
  /** Formats a plain USD/USDC amount. */
  usdText: (usdc: number | string) => string
  /** "1 USDC = ₦1,550" for the active currency, or null for USD / no rates. */
  rateText: () => string | null
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)
const STORE_KEY = 'tp_currency_v1'

function format(amount: number, currency: string): string {
  try {
    const big = Math.abs(amount) >= 1000
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: big ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function CurrencyProvider({ countryCode, children }: { countryCode: string | null; children: ReactNode }) {
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [manual, setManual] = useState<string | null>(() => localStorage.getItem(STORE_KEY))

  useEffect(() => {
    let cancelled = false
    api<{ rates: Record<string, number> }>('/fx', { auth: false })
      .then((r) => { if (!cancelled) setRates(r.rates) })
      .catch(() => { /* prices simply stay in USD */ })
    return () => { cancelled = true }
  }, [])

  const setCurrency = useCallback((code: string | null) => {
    if (code) localStorage.setItem(STORE_KEY, code)
    else localStorage.removeItem(STORE_KEY)
    setManual(code)
  }, [])

  const value = useMemo<CurrencyContextValue>(() => {
    const wanted = manual ?? (countryCode ? COUNTRY_CURRENCY[countryCode] : undefined) ?? 'USD'
    const rate = rates?.[wanted]
    const currency = rate ? wanted : 'USD'
    const usable = currency !== 'USD' && !!rate
    return {
      currency,
      isManual: manual !== null,
      setCurrency,
      ratesReady: rates !== null,
      localText: (usdc) => (usable ? format(Number(usdc) * (rate), currency) : null),
      usdText: (usdc) => format(Number(usdc), 'USD'),
      rateText: () => (usable ? `1 USDC ≈ ${format(rate, currency)}` : null),
    }
  }, [rates, manual, countryCode, setCurrency])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used inside CurrencyProvider')
  return ctx
}
