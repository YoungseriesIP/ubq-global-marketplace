import { useEffect, useState } from 'react'
import { PackageOpen, Store, Pencil, ExternalLink, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthContext'
import { useCurrency } from '@/lib/currency'
import { api } from '@/lib/api'
import type { ApiOrder } from '@/lib/api'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ListingCard } from './ListingCard'
import type { Listing } from '../types'

interface ShopPageProps {
  listings: Listing[]
  onSell: () => void
  onRemove: (id: string) => void
}

const inputStyle = { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1.5px solid var(--border)' }

const STATUS_LABEL: Record<ApiOrder['status'], { text: string; bg: string; fg: string }> = {
  verified: { text: 'Confirmed on the network', bg: 'rgba(26,128,71,0.12)', fg: 'var(--success)' },
  unverified: { text: 'Awaiting confirmation', bg: 'rgba(245,158,11,0.14)', fg: '#92400e' },
  pending_payment: { text: 'Not paid yet', bg: 'var(--surface-muted)', fg: 'var(--muted)' },
  failed: { text: 'Payment did not match', bg: 'rgba(186,43,76,0.1)', fg: 'var(--danger)' },
}

function StatusPill({ status }: { status: ApiOrder['status'] }) {
  const m = STATUS_LABEL[status]
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: m.bg, color: m.fg }}>
      {m.text}
    </span>
  )
}

export function ShopPage({ listings, onSell, onRemove }: ShopPageProps) {
  const { user, loading, openSignIn, updateProfile, config } = useAuth()
  const { localText } = useCurrency()
  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [editing, setEditing] = useState(false)
  const [shopName, setShopName] = useState('')
  const [shopBio, setShopBio] = useState('')
  const [saving, setSaving] = useState(false)

  async function recheck(orderId: string) {
    try {
      await api(`/payments/${orderId}/recheck`, { method: 'POST', body: {} })
      const r = await api<{ orders: ApiOrder[] }>('/orders/mine')
      setOrders(r.orders)
    } catch {
      /* the status stays as it was */
    }
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api<{ orders: ApiOrder[] }>('/orders/mine')
      .then((r) => { if (!cancelled) setOrders(r.orders) })
      .catch(() => { /* orders are optional */ })
    return () => { cancelled = true }
  }, [user])

  if (loading) {
    return <p className="text-center text-sm py-24" style={{ color: 'var(--muted)' }}>Loading your shop…</p>
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 px-4 text-center">
        <Store size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />
        <div>
          <p className="font-semibold text-base" style={{ color: 'var(--ink-2)' }}>Open your shop</p>
          <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--muted)' }}>
            Sign in with your email to list products or services and get paid in USDC from anywhere in the world.
          </p>
        </div>
        <button
          onClick={openSignIn}
          className="min-h-[44px] px-5 rounded-xl text-sm font-bold active:scale-95"
          style={{ background: 'var(--accent)', color: '#ffffff' }}
        >
          Sign in
        </button>
      </div>
    )
  }

  function startEdit() {
    setShopName(user?.shopName ?? '')
    setShopBio(user?.shopBio ?? '')
    setEditing(true)
  }

  async function saveShop(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateProfile({ shopName: shopName.trim(), shopBio: shopBio.trim() })
      setEditing(false)
      toast.success('Shop updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const title = user.shopName || user.displayName || 'My shop'
  const chainId = config?.chainId ?? 5042002

  return (
    <div className="px-4 pt-8 max-w-4xl mx-auto space-y-8">
      <section
        className="rounded-2xl border p-5"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        {editing ? (
          <form onSubmit={(e) => void saveShop(e)} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }} htmlFor="shop-name">Shop name</label>
              <input
                id="shop-name"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                maxLength={80}
                placeholder="e.g. Ada's Fabrics"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }} htmlFor="shop-bio">About your shop</label>
              <textarea
                id="shop-bio"
                value={shopBio}
                onChange={(e) => setShopBio(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={inputStyle}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-[44px] px-5 rounded-xl text-sm font-semibold border"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="display font-bold text-2xl text-balance" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
                {title}
              </h2>
              <p className="text-sm mt-1 text-pretty" style={{ color: 'var(--muted)' }}>
                {user.shopBio || 'Add a short description so buyers know who you are.'}
              </p>
              <p className="text-xs mt-3 font-mono truncate" style={{ color: 'var(--subtle)' }}>{user.address}</p>
            </div>
            <button
              onClick={startEdit}
              className="shrink-0 min-h-[44px] px-4 rounded-xl text-sm font-semibold border flex items-center gap-2"
              style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            >
              <Pencil size={14} /> Edit
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>Your listings</h3>
          <button
            onClick={onSell}
            className="min-h-[44px] px-4 rounded-xl text-sm font-bold active:scale-95"
            style={{ background: 'var(--accent)', color: '#ffffff' }}
          >
            + New listing
          </button>
        </div>
        {listings.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <PackageOpen size={36} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />
            <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
              No listings yet. Add your first item. Buyers pay you in USDC, anywhere in the world.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} onBuy={() => {}} isOwner onRemove={onRemove} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="display font-bold text-lg mb-4" style={{ color: 'var(--ink)' }}>Orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Sales and purchases will show up here after your first payment.
          </p>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => {
              const sold = o.role === 'seller'
              return (
                <li
                  key={o.id}
                  className="rounded-xl border px-4 py-3 flex items-center gap-3"
                  style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: sold ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)' }}
                  >
                    {sold
                      ? <ArrowDownLeft size={15} style={{ color: 'var(--success)' }} />
                      : <ArrowUpRight size={15} style={{ color: 'var(--muted)' }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>{o.title}</p>
                    <p className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: 'var(--subtle)' }}>
                      <span>{sold ? 'Sold' : 'Bought'} · {new Date(o.createdAt).toLocaleDateString()}</span>
                      <StatusPill status={o.status} />
                      {(o.status === 'unverified' && o.txHash) && (
                        <button onClick={() => void recheck(o.id)} className="font-semibold underline" style={{ color: 'var(--accent-hover)' }}>
                          Check again
                        </button>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                      {sold ? '+' : '-'}{o.amountUsdc} USDC
                    </p>
                    {localText(o.amountUsdc) && (
                      <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>{localText(o.amountUsdc)}</p>
                    )}
                  </div>
                  {o.txHash && (
                    <a
                      href={buildTxExplorerUrl(chainId, o.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View receipt"
                      className="shrink-0 hover:opacity-70"
                      style={{ color: 'var(--accent-hover)' }}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
