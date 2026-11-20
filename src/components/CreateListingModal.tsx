import { useRef, useState } from 'react'
import { X, Camera, Loader2, ChevronDown } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { COUNTRY_LIST } from '@/services/useCountryFilter'
import { toast } from 'sonner'
import { api, toListing } from '@/lib/api'
import { uploadImage } from '@/lib/imageUpload'
import type { ApiListing } from '@/lib/api'
import type { Listing, Category } from '../types'

const CATEGORIES: Category[] = [
  'Electronics', 'Fashion', 'Art', 'Books', 'Collectibles', 'Home', 'Sports', 'Other',
]

interface CreateListingModalProps {
  /** Pass an existing listing to edit it instead of creating a new one. */
  listing?: Listing
  onClose: () => void
  onCreated: (listing: Listing) => void
  onChanged?: () => void
}

export function CreateListingModal({ listing, onClose, onCreated, onChanged }: CreateListingModalProps) {
  const { user, openSignIn } = useAuth()
  const address = user?.address

  const editing = listing !== undefined
  const [title, setTitle] = useState(listing?.title ?? '')
  const [description, setDescription] = useState(listing?.description ?? '')
  const [price, setPrice] = useState(listing?.priceUsdc ?? '')
  const [category, setCategory] = useState<Category>((listing?.category as Category | undefined) ?? 'Electronics')
  const [location, setLocation] = useState(listing?.location ?? '')
  const [countryCode, setCountryCode] = useState(listing?.countryCode ?? user?.countryCode ?? '')
  const [imageUrl, setImageUrl] = useState(listing?.imageUrl ?? '')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handlePhoto(file: File | undefined) {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      setImageUrl(await uploadImage(file))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!address) {
      setError('Sign in first.')
      return
    }
    if (!title.trim() || !description.trim() || !price || !location.trim()) {
      setError('Please fill in all required fields.')
      return
    }
    const parsedPrice = parseFloat(price)
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setError('Enter a valid price greater than 0.')
      return
    }

    setSaving(true)
    try {
      const res = await api<{ listing: ApiListing; held?: boolean }>(editing ? `/listings/${listing.id}` : '/listings', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          priceUsdc: parsedPrice.toFixed(2),
          category,
          location: location.trim(),
          countryCode: countryCode || undefined,
          imageUrl: editing ? (imageUrl.trim() || null) : (imageUrl.trim() || undefined),
        },
      })
      onChanged?.()
      if (editing) {
        toast.success(res.held ? 'Saved. The new wording needs a quick review.' : 'Your changes are saved')
        onClose()
        return
      }
      if (res.held) {
        toast.message('Your listing is waiting for a quick review', {
          description: 'Some wording needs a human check before it goes public. We will publish it if it is fine.',
        })
      } else {
        onCreated(toListing(res.listing))
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

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
        className="relative w-full sm:max-w-lg rounded-2xl sm:rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>
            {editing ? 'Edit your listing' : 'List an Item'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Title <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sony WH-1000XM5 Headphones"
              maxLength={80}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
                border: '1.5px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Description <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your item — condition, features, any details a buyer needs"
              rows={3}
              maxLength={2000}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none transition-all"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
                border: '1.5px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {/* Price + Category row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Price (USDC) <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold tabular-nums"
                  style={{ color: 'var(--muted)' }}
                >
                  $
                </span>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="w-full pl-7 pr-4 py-3 rounded-xl text-sm outline-none transition-all tabular-nums"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                    border: '1.5px solid var(--border)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Category
              </label>
              <div className="relative">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none appearance-none transition-all"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                    border: '1.5px solid var(--border)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--muted)' }}
                />
              </div>
            </div>
          </div>

          {/* Location + Chain row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Location <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Country"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Country
              </label>
              <div className="relative">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none appearance-none transition-all"
                  style={{
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                    border: '1.5px solid var(--border)',
                  }}
                >
                  <option value="">Select country</option>
                  {COUNTRY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--muted)' }}
                />
              </div>
            </div>
          </div>

          {/* Photo */}
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Photo <span className="font-normal" style={{ color: 'var(--subtle)' }}>(optional)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handlePhoto(e.target.files?.[0])}
            />
            {imageUrl ? (
              <div className="flex items-center gap-3">
                <img
                  referrerPolicy="no-referrer"
                  src={imageUrl}
                  alt="Your item"
                  className="w-24 h-24 rounded-xl object-cover"
                  style={{ border: '1.5px solid var(--border)' }}
                />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: 'var(--surface-muted)', color: 'var(--accent)' }}
                  >
                    {uploading ? 'Uploading…' : 'Change photo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="px-3 py-2 rounded-lg text-xs font-semibold"
                    style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }}
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full min-h-[88px] rounded-xl flex flex-col items-center justify-center gap-1.5 text-sm font-semibold disabled:opacity-60"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1.5px dashed var(--border)' }}
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                {uploading ? 'Uploading your photo…' : 'Take or choose a photo'}
                <span className="text-xs font-normal" style={{ color: 'var(--subtle)' }}>It is shrunk automatically</span>
              </button>
            )}
            <input
              type="url"
              value={imageUrl.startsWith('/api/') ? '' : imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="or paste a photo link: https://…"
              className="mt-2 w-full px-4 py-2.5 rounded-xl text-xs outline-none"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1.5px solid var(--border)' }}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          {/* Sign-in prompt */}
          {!address && (
            <div
              className="rounded-xl px-4 py-3 text-sm font-medium"
              style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
            >
              Sign in to list an item. Buyers pay you in USDC, straight to your account wallet.
            </div>
          )}

          {/* Submit */}
          {address ? (
            <button
              type="submit"
              disabled={saving || uploading}
              className="w-full min-h-[44px] py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'List for Sale'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { onClose(); openSignIn() }}
              className="w-full min-h-[44px] py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
              style={{ background: 'var(--accent)', color: '#ffffff' }}
            >
              Sign in to sell
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
