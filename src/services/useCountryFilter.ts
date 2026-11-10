// ─── Country / Region Filter ───────────────────────────────────────────────
// Detects the user's country on first load (via ip-api.com — free, no key),
// stores the result in localStorage, and exposes a setCountry override so the
// user can change their filter at any time.
//
// Returns:
//   country       — ISO-3166-1 alpha-2 code ("NG", "CN", "US" …) or null (global)
//   countryName   — human-readable name ("Nigeria", "China" …) or null
//   status        — 'idle' | 'detecting' | 'detected' | 'manual' | 'global'
//   setCountry    — override: pass a code+name to pin, or null to go global
//   redetect      — re-run IP detection

import { useState, useEffect, useCallback } from 'react'

export type CountryFilterStatus = 'idle' | 'detecting' | 'detected' | 'manual' | 'global'

export interface CountryOption {
  code: string   // ISO-3166-1 alpha-2
  name: string
}

export interface CountryFilter {
  country:     string | null  // ISO code
  countryName: string | null
  status:      CountryFilterStatus
  setCountry:  (opt: CountryOption | null) => void
  redetect:    () => void
}

// ── Well-known countries (extend as needed) ────────────────────────────────
export const COUNTRY_LIST: CountryOption[] = [
  { code: 'NG', name: 'Nigeria'       },
  { code: 'GH', name: 'Ghana'         },
  { code: 'KE', name: 'Kenya'         },
  { code: 'ZA', name: 'South Africa'  },
  { code: 'ET', name: 'Ethiopia'      },
  { code: 'EG', name: 'Egypt'         },
  { code: 'TZ', name: 'Tanzania'      },
  { code: 'SN', name: 'Senegal'       },
  { code: 'CI', name: 'Côte d\'Ivoire' },
  { code: 'CM', name: 'Cameroon'      },
  { code: 'UG', name: 'Uganda'        },
  { code: 'RW', name: 'Rwanda'        },
  { code: 'ZM', name: 'Zambia'        },
  { code: 'ZW', name: 'Zimbabwe'      },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom'},
  { code: 'CA', name: 'Canada'        },
  { code: 'AU', name: 'Australia'     },
  { code: 'DE', name: 'Germany'       },
  { code: 'FR', name: 'France'        },
  { code: 'IT', name: 'Italy'         },
  { code: 'ES', name: 'Spain'         },
  { code: 'NL', name: 'Netherlands'   },
  { code: 'SE', name: 'Sweden'        },
  { code: 'NO', name: 'Norway'        },
  { code: 'CH', name: 'Switzerland'   },
  { code: 'BE', name: 'Belgium'       },
  { code: 'PT', name: 'Portugal'      },
  { code: 'PL', name: 'Poland'        },
  { code: 'AT', name: 'Austria'       },
  { code: 'IR', name: 'Iran'          },
  { code: 'TR', name: 'Turkey'        },
  { code: 'SA', name: 'Saudi Arabia'  },
  { code: 'AE', name: 'UAE'           },
  { code: 'IN', name: 'India'         },
  { code: 'CN', name: 'China'         },
  { code: 'JP', name: 'Japan'         },
  { code: 'KR', name: 'South Korea'   },
  { code: 'SG', name: 'Singapore'     },
  { code: 'MY', name: 'Malaysia'      },
  { code: 'ID', name: 'Indonesia'     },
  { code: 'PH', name: 'Philippines'   },
  { code: 'TH', name: 'Thailand'      },
  { code: 'VN', name: 'Vietnam'       },
  { code: 'PK', name: 'Pakistan'      },
  { code: 'BD', name: 'Bangladesh'    },
  { code: 'BR', name: 'Brazil'        },
  { code: 'MX', name: 'Mexico'        },
  { code: 'AR', name: 'Argentina'     },
  { code: 'CO', name: 'Colombia'      },
  { code: 'CL', name: 'Chile'         },
  { code: 'PE', name: 'Peru'          },
  { code: 'VE', name: 'Venezuela'     },
  { code: 'RU', name: 'Russia'        },
  { code: 'UA', name: 'Ukraine'       },
]

// ── Country name lookup ────────────────────────────────────────────────────
export function countryNameFor(code: string): string {
  return COUNTRY_LIST.find((c) => c.code === code)?.name ?? code
}

// ── Storage keys ──────────────────────────────────────────────────────────
const STORE_CODE  = 'tp_country_code_v1'
const STORE_NAME  = 'tp_country_name_v1'
const STORE_MODE  = 'tp_country_mode_v1'  // 'detected' | 'manual' | 'global'

function loadStored(): { code: string | null; name: string | null; mode: CountryFilterStatus } {
  const code = localStorage.getItem(STORE_CODE)
  const name = localStorage.getItem(STORE_NAME)
  const mode = (localStorage.getItem(STORE_MODE) ?? 'idle') as CountryFilterStatus
  return { code, name, mode }
}

function saveStored(code: string | null, name: string | null, mode: CountryFilterStatus) {
  if (code) localStorage.setItem(STORE_CODE, code)
  else       localStorage.removeItem(STORE_CODE)
  if (name) localStorage.setItem(STORE_NAME, name)
  else       localStorage.removeItem(STORE_NAME)
  localStorage.setItem(STORE_MODE, mode)
}

// ── Locale-based detection ─────────────────────────────────────────────────
// Reads the region from the browser's language settings (for example "en-NG" gives Nigeria).
// Nothing is sent to any third party, so no visitor IP address leaves the app.
// If no region is set, the app stays on All Countries.
function detectCountry(): { code: string; name: string } | null {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const lang of langs) {
    const region = lang.split('-').find((part, i) => i > 0 && /^[A-Za-z]{2}$/.test(part))?.toUpperCase()
    const hit = region ? COUNTRY_LIST.find((c) => c.code === region) : undefined
    if (hit) return { code: hit.code, name: hit.name }
  }
  return null
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useCountryFilter(): CountryFilter {
  const stored = loadStored()

  const [country,     setCountryState] = useState<string | null>(stored.code)
  const [countryName, setCountryName]  = useState<string | null>(stored.name)
  const [status,      setStatus]       = useState<CountryFilterStatus>(
    stored.mode === 'idle' ? 'idle' : stored.mode,
  )

  const doDetect = useCallback(() => {
    setStatus('detecting')
    const result = detectCountry()
    if (result) {
      setCountryState(result.code)
      setCountryName(result.name)
      setStatus('detected')
      saveStored(result.code, result.name, 'detected')
    } else {
      // Detection failed — go global so user isn't stuck on a spinner
      setCountryState(null)
      setCountryName(null)
      setStatus('global')
      saveStored(null, null, 'global')
    }
  }, [])

  // Auto-detect on first load only (status === 'idle' means no stored value)
  useEffect(() => {
    if (status === 'idle') {
      doDetect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — run once on mount

  const setCountry = useCallback((opt: CountryOption | null) => {
    if (opt) {
      setCountryState(opt.code)
      setCountryName(opt.name)
      setStatus('manual')
      saveStored(opt.code, opt.name, 'manual')
    } else {
      setCountryState(null)
      setCountryName(null)
      setStatus('global')
      saveStored(null, null, 'global')
    }
  }, [])

  const redetect = useCallback(() => {
    saveStored(null, null, 'idle')
    doDetect()
  }, [doDetect])

  return { country, countryName, status, setCountry, redetect }
}
