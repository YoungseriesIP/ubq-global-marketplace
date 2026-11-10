import { useState } from 'react'
import { X, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { toast } from 'sonner'
import { SERVICE_CATEGORIES } from '../../services/categories'
import type { ServiceProvider, ProviderFormState, ServiceMode } from '../../services/types'

interface CreateProviderModalProps {
  onClose: () => void
  onCreated: (provider: ServiceProvider) => void
}

const STEP_LABELS = ['About', 'Location', 'Services', 'Contact & Hours', 'Portfolio']
const TOTAL_STEPS = STEP_LABELS.length

const DEFAULT_SERVICE = { name: '', description: '', startingPrice: '', currency: 'USD' }

const BLANK: ProviderFormState = {
  name: '',
  tagline: '',
  bio: '',
  profilePhotoUrl: '',
  categoryId: 'fashion-tailoring',
  subcategory: '',
  yearsExperience: '',
  languagesSpoken: '',
  communityTag: '',
  country: '',
  stateRegion: '',
  city: '',
  streetAddress: '',
  showFullAddress: false,
  serviceMode: 'shop',
  serviceRadiusKm: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  instagram: '',
  services: [{ ...DEFAULT_SERVICE }],
  workingHoursNote: '',
  portfolioUrls: '',
  hotelRooms: [{ name: 'Standard Room', price: '', currency: 'USD' }],
  hotelAmenities: '',
  hotelCheckIn: '14:00',
  hotelCheckOut: '12:00',
  visaCountries: '',
  visaTypes: '',
  visaRegNumber: '',
  visaLicense: '',
  visaFeeStructure: '',
}

// ─── Small shared field components ──────────────────────────────────────────

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
        {hint && <span className="ml-1 font-normal text-xs" style={{ color: 'var(--subtle)' }}>({hint})</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass = 'w-full px-4 py-3 rounded-xl text-sm outline-none transition-all'
const inputStyle = { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1.5px solid var(--border)' }

function Input({ value, onChange, placeholder, type = 'text', maxLength }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  maxLength?: number
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={inputClass}
      style={inputStyle}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    />
  )
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`${inputClass} resize-none`}
      style={inputStyle}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    />
  )
}

function Select({ value, onChange, children }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} appearance-none`}
        style={inputStyle}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--muted)' }} />
    </div>
  )
}

// ─── Step components ─────────────────────────────────────────────────────────

function StepAbout({ f, set }: { f: ProviderFormState; set: (k: keyof ProviderFormState, v: unknown) => void }) {
  const category = SERVICE_CATEGORIES.find((c) => c.id === f.categoryId)

  return (
    <div className="space-y-4">
      <Field label="Business or Provider Name" required>
        <Input value={f.name} onChange={(v) => set('name', v)} placeholder="e.g. Amara Tailoring Studio" maxLength={80} />
      </Field>

      <Field label="Short Tagline" required hint="shown on your card">
        <Input value={f.tagline} onChange={(v) => set('tagline', v)} placeholder="e.g. Bespoke Ankara wear, Houston TX" maxLength={100} />
      </Field>

      <Field label="Bio" required>
        <Textarea value={f.bio} onChange={(v) => set('bio', v)} placeholder="Describe your experience, what makes you stand out, and what customers can expect…" rows={4} />
      </Field>

      <Field label="Profile Photo URL" hint="optional, paste an image link">
        <Input value={f.profilePhotoUrl} onChange={(v) => set('profilePhotoUrl', v)} placeholder="https://…" type="url" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" required>
          <Select value={f.categoryId} onChange={(v) => { set('categoryId', v); set('subcategory', '') }}>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Subcategory">
          <Select value={f.subcategory} onChange={(v) => set('subcategory', v)}>
            <option value="">— Select —</option>
            {(category?.subcategories ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Years of Experience">
          <Input value={f.yearsExperience} onChange={(v) => set('yearsExperience', v)} placeholder="e.g. 8" type="number" />
        </Field>
        <Field label="Languages Spoken" hint="comma-separated">
          <Input value={f.languagesSpoken} onChange={(v) => set('languagesSpoken', v)} placeholder="English, Yoruba, French" />
        </Field>
      </div>

      <Field label="Community / Origin Tag" hint="voluntary — never required or verified">
        <Input value={f.communityTag} onChange={(v) => set('communityTag', v)} placeholder="e.g. Nigerian, Ghanaian, Kenyan…" maxLength={40} />
        <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
          This helps people from your community find you. Leave blank to not display it. Everyone can book regardless of community.
        </p>
      </Field>
    </div>
  )
}

function StepLocation({ f, set }: { f: ProviderFormState; set: (k: keyof ProviderFormState, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" required>
          <Input value={f.country} onChange={(v) => set('country', v)} placeholder="Nigeria" />
        </Field>
        <Field label="State / Region">
          <Input value={f.stateRegion} onChange={(v) => set('stateRegion', v)} placeholder="Lagos State" />
        </Field>
      </div>

      <Field label="City" required>
        <Input value={f.city} onChange={(v) => set('city', v)} placeholder="Lagos" />
      </Field>

      <Field label="Street Address" hint="shown publicly only if you choose below">
        <Input value={f.streetAddress} onChange={(v) => set('streetAddress', v)} placeholder="123 Victoria Island" />
      </Field>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={f.showFullAddress}
          onChange={(e) => set('showFullAddress', e.target.checked)}
          className="w-4 h-4 rounded"
          style={{ accentColor: 'var(--accent)' }}
        />
        <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          Show full street address publicly
        </span>
      </label>

      <Field label="How you serve customers" required>
        <div className="grid grid-cols-3 gap-2">
          {(['shop', 'mobile', 'both'] as ServiceMode[]).map((mode) => {
            const labels: Record<ServiceMode, string> = { shop: 'At my shop', mobile: 'I travel to customers', both: 'Both' }
            const active = f.serviceMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => set('serviceMode', mode)}
                className="py-2.5 rounded-xl text-sm font-medium border transition-all"
                style={{
                  background: active ? 'var(--accent)' : 'var(--surface-muted)',
                  color: active ? '#fff' : 'var(--ink-2)',
                  borderColor: active ? 'transparent' : 'var(--border)',
                }}
              >
                {labels[mode]}
              </button>
            )
          })}
        </div>
      </Field>

      {(f.serviceMode === 'mobile' || f.serviceMode === 'both') && (
        <Field label="Service Radius (km)" hint="how far you travel">
          <Input value={f.serviceRadiusKm} onChange={(v) => set('serviceRadiusKm', v)} placeholder="25" type="number" />
        </Field>
      )}
    </div>
  )
}

function StepServices({ f, set }: { f: ProviderFormState; set: (k: keyof ProviderFormState, v: unknown) => void }) {
  const isHotel = f.categoryId === 'hotels-stays'
  const isVisa = f.categoryId === 'visa-immigration'

  const updateService = (i: number, key: string, val: string) => {
    const updated = f.services.map((s, idx) => idx === i ? { ...s, [key]: val } : s)
    set('services', updated)
  }

  const addService = () => {
    if (f.services.length >= 8) return
    set('services', [...f.services, { ...DEFAULT_SERVICE }])
  }

  const removeService = (i: number) => {
    set('services', f.services.filter((_, idx) => idx !== i))
  }

  const updateRoom = (i: number, key: string, val: string) => {
    const updated = f.hotelRooms.map((r, idx) => idx === i ? { ...r, [key]: val } : r)
    set('hotelRooms', updated)
  }

  return (
    <div className="space-y-5">
      {/* Generic services */}
      {!isHotel && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Services you offer</p>
            {f.services.length < 8 && (
              <button type="button" onClick={addService} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
                <Plus size={13} /> Add service
              </button>
            )}
          </div>

          {f.services.map((svc, i) => (
            <div
              key={i}
              className="rounded-xl p-3 mb-3 space-y-2"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={svc.name}
                  onChange={(e) => updateService(i, 'name', e.target.value)}
                  placeholder="Service name (e.g. Haircut & Fade)"
                  className="flex-1 bg-transparent text-sm outline-none font-semibold"
                  style={{ color: 'var(--ink)' }}
                />
                {f.services.length > 1 && (
                  <button type="button" onClick={() => removeService(i)}>
                    <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                  </button>
                )}
              </div>
              <input
                type="text"
                value={svc.description}
                onChange={(e) => updateService(i, 'description', e.target.value)}
                placeholder="Short description (optional)"
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: 'var(--muted)' }}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={svc.startingPrice}
                  onChange={(e) => updateService(i, 'startingPrice', e.target.value)}
                  placeholder="Starting price"
                  className="w-32 bg-transparent text-sm outline-none tabular-nums"
                  style={{ color: 'var(--ink)' }}
                />
                <input
                  type="text"
                  value={svc.currency}
                  onChange={(e) => updateService(i, 'currency', e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={5}
                  className="w-16 bg-transparent text-sm outline-none uppercase"
                  style={{ color: 'var(--muted)' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hotel room types */}
      {isHotel && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Room Types</p>
          {f.hotelRooms.map((room, i) => (
            <div
              key={i}
              className="rounded-xl p-3 space-y-2"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <input
                type="text"
                value={room.name}
                onChange={(e) => updateRoom(i, 'name', e.target.value)}
                placeholder="Room name (e.g. Deluxe Room)"
                className="w-full bg-transparent text-sm font-semibold outline-none"
                style={{ color: 'var(--ink)' }}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={room.price}
                  onChange={(e) => updateRoom(i, 'price', e.target.value)}
                  placeholder="Price per night"
                  className="flex-1 bg-transparent text-sm outline-none tabular-nums"
                  style={{ color: 'var(--ink)' }}
                />
                <input
                  type="text"
                  value={room.currency}
                  onChange={(e) => updateRoom(i, 'currency', e.target.value.toUpperCase())}
                  placeholder="NGN"
                  maxLength={5}
                  className="w-16 bg-transparent text-sm outline-none uppercase"
                  style={{ color: 'var(--muted)' }}
                />
              </div>
            </div>
          ))}

          <Field label="Amenities" hint="comma-separated">
            <Input value={f.hotelAmenities} onChange={(v) => set('hotelAmenities', v)} placeholder="Free WiFi, Pool, 24/7 Power, Restaurant" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in time">
              <Input value={f.hotelCheckIn} onChange={(v) => set('hotelCheckIn', v)} placeholder="14:00" />
            </Field>
            <Field label="Check-out time">
              <Input value={f.hotelCheckOut} onChange={(v) => set('hotelCheckOut', v)} placeholder="12:00" />
            </Field>
          </div>
        </div>
      )}

      {/* Visa agent extras */}
      {isVisa && (
        <div className="space-y-3">
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
          >
            <strong>Important notice:</strong> Always verify consultants. Never pay the full fee upfront. Fake documents and forged visas are strictly prohibited and will result in an immediate ban.
          </div>

          <Field label="Countries Served" hint="comma-separated">
            <Input value={f.visaCountries} onChange={(v) => set('visaCountries', v)} placeholder="United Kingdom, Canada, Schengen Area" />
          </Field>

          <Field label="Visa Types Handled" hint="comma-separated">
            <Input value={f.visaTypes} onChange={(v) => set('visaTypes', v)} placeholder="Spouse Visa, Student Visa, Tourist Visa" />
          </Field>

          <Field label="Business Registration Number" hint="if applicable">
            <Input value={f.visaRegNumber} onChange={(v) => set('visaRegNumber', v)} placeholder="RC-000000" />
          </Field>

          <Field label="License / Accreditation" hint="if applicable">
            <Input value={f.visaLicense} onChange={(v) => set('visaLicense', v)} placeholder="ICCRC Member, Bar Association No." />
          </Field>

          <Field label="Fee Structure">
            <Textarea value={f.visaFeeStructure} onChange={(v) => set('visaFeeStructure', v)} placeholder="Consultation: $50. Full application service: from $300. Fees are quoted upfront…" rows={3} />
          </Field>
        </div>
      )}
    </div>
  )
}

function StepContact({ f, set }: { f: ProviderFormState; set: (k: keyof ProviderFormState, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Phone Number">
        <Input value={f.phone} onChange={(v) => set('phone', v)} placeholder="+1-555-000-0000" type="tel" />
      </Field>

      <Field label="WhatsApp Number" hint="with country code">
        <Input value={f.whatsapp} onChange={(v) => set('whatsapp', v)} placeholder="+1-555-000-0000" type="tel" />
      </Field>

      <Field label="Email Address">
        <Input value={f.email} onChange={(v) => set('email', v)} placeholder="you@example.com" type="email" />
      </Field>

      <Field label="Website URL" hint="optional">
        <Input value={f.website} onChange={(v) => set('website', v)} placeholder="https://yoursite.com" type="url" />
      </Field>

      <Field label="Instagram Handle" hint="without @">
        <Input value={f.instagram} onChange={(v) => set('instagram', v)} placeholder="yourbusiness" />
      </Field>

      <Field label="Working Hours">
        <Textarea
          value={f.workingHoursNote}
          onChange={(v) => set('workingHoursNote', v)}
          placeholder="e.g. Mon–Sat 9am–7pm. Closed Sundays. WhatsApp for after-hours enquiries."
          rows={2}
        />
      </Field>
    </div>
  )
}

function StepPortfolio({ f, set }: { f: ProviderFormState; set: (k: keyof ProviderFormState, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'rgba(107,101,128,0.10)', color: 'var(--muted)' }}
      >
        Paste image URLs for your portfolio (one per line). Direct file upload requires a backend — this will be enabled in a future update. Use Unsplash, Cloudinary, or your own hosted images.
      </div>

      <Field label="Portfolio Image URLs" hint="one URL per line, up to 12 images">
        <Textarea
          value={f.portfolioUrls}
          onChange={(v) => set('portfolioUrls', v)}
          placeholder={`https://example.com/image1.jpg\nhttps://example.com/image2.jpg`}
          rows={6}
        />
      </Field>

      {/* Preview thumbnails */}
      {f.portfolioUrls.trim() && (
        <div className="grid grid-cols-4 gap-2">
          {f.portfolioUrls
            .split('\n')
            .map((u) => u.trim())
            .filter(Boolean)
            .slice(0, 12)
            .map((url, i) => (
              <div key={i} className="aspect-square rounded-lg overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
                <img referrerPolicy="no-referrer" src={url} alt={`Portfolio ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function CreateProviderModal({ onClose, onCreated }: CreateProviderModalProps) {
  const address = useAuth().user?.address
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ProviderFormState>(BLANK)
  const [error, setError] = useState('')

  function set(key: keyof ProviderFormState, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function validateStep(): string {
    if (step === 0) {
      if (!form.name.trim()) return 'Business name is required.'
      if (!form.tagline.trim()) return 'Tagline is required.'
      if (!form.bio.trim()) return 'Bio is required.'
    }
    if (step === 1) {
      if (!form.country.trim()) return 'Country is required.'
      if (!form.city.trim()) return 'City is required.'
    }
    if (step === 2) {
      if (form.categoryId !== 'hotels-stays' && form.services[0]?.name.trim() === '') {
        return 'Add at least one service name.'
      }
    }
    return ''
  }

  function handleNext() {
    const err = validateStep()
    if (err) { setError(err); return }
    setError('')
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1))
  }

  function handleBack() {
    setError('')
    setStep((s) => Math.max(s - 1, 0))
  }

  function handleSubmit() {
    if (!address) { setError('Connect your wallet first.'); return }
    const err = validateStep()
    if (err) { setError(err); return }

    // Build portfolio items from URLs
    const portfolioItems = form.portfolioUrls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((url, i) => ({
        id: `p-new-${i}-${Date.now()}`,
        url,
        type: 'image' as const,
        flagged: false,
      }))

    const isHotel = form.categoryId === 'hotels-stays'
    const isVisa = form.categoryId === 'visa-immigration'

    const provider: ServiceProvider = {
      id: `sp-${crypto.randomUUID()}`,
      walletAddress: address,
      name: form.name.trim(),
      tagline: form.tagline.trim(),
      bio: form.bio.trim(),
      profilePhotoUrl: form.profilePhotoUrl.trim() || undefined,
      categoryId: form.categoryId,
      subcategory: form.subcategory || undefined,
      yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience) : undefined,
      languagesSpoken: form.languagesSpoken.split(',').map((l) => l.trim()).filter(Boolean),
      communityTag: form.communityTag.trim() || undefined,
      services: isHotel
        ? []
        : form.services
            .filter((s) => s.name.trim())
            .map((s, i) => ({
              id: `svc-new-${i}`,
              name: s.name.trim(),
              description: s.description.trim() || undefined,
              startingPrice: s.startingPrice ? parseFloat(s.startingPrice) : undefined,
              currency: s.currency.toUpperCase() || 'USD',
            })),
      workingHours: form.workingHoursNote.trim() ? { note: form.workingHoursNote.trim() } : undefined,
      contact: {
        phone: form.phone.trim() || undefined,
        whatsapp: form.whatsapp.trim() || undefined,
        email: form.email.trim() || undefined,
        website: form.website.trim() || undefined,
        instagram: form.instagram.trim() || undefined,
      },
      location: {
        country: form.country.trim(),
        stateRegion: form.stateRegion.trim() || undefined,
        city: form.city.trim(),
        streetAddress: form.streetAddress.trim() || undefined,
        showFullAddress: form.showFullAddress,
        serviceMode: form.serviceMode,
        serviceRadiusKm: form.serviceRadiusKm ? parseInt(form.serviceRadiusKm) : undefined,
      },
      portfolio: portfolioItems,
      verificationLevel: 'none',
      ratingAverage: 0,
      reviewCount: 0,
      isActive: true,
      isFeatured: false,
      createdAt: new Date(),
      hotelExtras: isHotel
        ? {
            roomTypes: form.hotelRooms
              .filter((r) => r.name.trim() && r.price)
              .map((r) => ({ name: r.name.trim(), pricePerNight: parseFloat(r.price), currency: r.currency })),
            amenities: form.hotelAmenities.split(',').map((a) => a.trim()).filter(Boolean),
            checkInTime: form.hotelCheckIn || undefined,
            checkOutTime: form.hotelCheckOut || undefined,
          }
        : undefined,
      visaAgentExtras: isVisa
        ? {
            countriesServed: form.visaCountries.split(',').map((c) => c.trim()).filter(Boolean),
            visaTypes: form.visaTypes.split(',').map((v) => v.trim()).filter(Boolean),
            businessRegNumber: form.visaRegNumber.trim() || undefined,
            licenseDetails: form.visaLicense.trim() || undefined,
            feeStructure: form.visaFeeStructure.trim() || undefined,
          }
        : undefined,
    }

    onCreated(provider)
    toast.success('Profile created! You can now be found in the Services directory.')
    onClose()
  }

  const stepProps = { f: form, set }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(18,45,69,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full sm:max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <h2 className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>
              Create Provider Profile
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Step {step + 1} of {TOTAL_STEPS} — {STEP_LABELS[step]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1" style={{ background: 'var(--surface-muted)' }}>
          <div
            className="h-1 transition-all duration-300"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%`, background: 'var(--accent)' }}
          />
        </div>

        {/* Step content */}
        <div className="p-6 max-h-[65vh] overflow-y-auto">
          {!address && (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium mb-4"
              style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
            >
              Connect your wallet first — your wallet address is your identity on this platform.
            </div>
          )}

          {step === 0 && <StepAbout {...stepProps} />}
          {step === 1 && <StepLocation {...stepProps} />}
          {step === 2 && <StepServices {...stepProps} />}
          {step === 3 && <StepContact {...stepProps} />}
          {step === 4 && <StepPortfolio {...stepProps} />}

          {error && (
            <p className="mt-3 text-sm font-medium" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </div>

        {/* Navigation footer */}
        <div
          className="flex items-center justify-between px-6 py-4 border-t gap-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            <ChevronLeft size={15} /> Back
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!address}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--success)', color: '#ffffff' }}
            >
              Publish Profile
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
