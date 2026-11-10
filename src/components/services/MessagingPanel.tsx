// ─── In-app Messaging Panel ────────────────────────────────────────────────
// Used both as a full-page inbox (view='messages') and as a single-conversation
// thread launched from a provider profile.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowLeft, Send, Flag, Ban, AlertTriangle, Check,
  MessageCircle, Shield, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import type { MessagesStore, Conversation } from '../../services/useMessages'

interface MessagingPanelProps {
  /** The wallet address of the currently connected user */
  viewerWallet: string
  store:        MessagesStore
  /** If set, open directly into this conversation on mount */
  initialConversationId?: string
  onBack?:      () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)     return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)     return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)     return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)      return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function avatarColor(wallet: string): string {
  const COLORS = ['#1061a6', '#1a8047', '#ba2b4c', '#f59e0b', '#7c3aed', '#0891b2']
  let hash = 0
  for (const c of wallet) hash = ((hash << 5) - hash) + c.charCodeAt(0)
  return COLORS[Math.abs(hash) % COLORS.length]
}

function Avatar({ wallet, size = 32 }: { wallet: string; size?: number }) {
  const label = wallet.slice(2, 4).toUpperCase()
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-bold text-white text-xs"
      style={{ width: size, height: size, background: avatarColor(wallet) }}
    >
      {label}
    </div>
  )
}

const MAX_MESSAGE_LENGTH = 1000
const SAFETY_TIPS = [
  'Meet in a public place for first-time in-person meetings.',
  'Never send money outside the platform to someone you have not verified.',
  'Do not share your home address until you trust the other party.',
  'Use escrow for high-value orders to protect both sides.',
  'Report suspicious behaviour using the flag button.',
]

// ── ConversationList ──────────────────────────────────────────────────────

function ConversationList({
  viewerWallet,
  store,
  onOpen,
}: {
  viewerWallet: string
  store: MessagesStore
  onOpen: (conv: Conversation) => void
}) {
  const conversations = store.getConversations(viewerWallet)
  const w = viewerWallet.toLowerCase()

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center px-4">
        <MessageCircle size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)' }} />
        <div>
          <p className="font-semibold text-base" style={{ color: 'var(--ink-2)' }}>No messages yet</p>
          <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--muted)' }}>
            Contact a service provider from their profile to start a conversation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {conversations.map((conv) => {
        const msgs = store.getMessages(conv.id)
        const last = msgs[msgs.length - 1]
        const isProvider = conv.providerWallet.toLowerCase() === w
        const otherWallet = isProvider ? conv.customerWallet : conv.providerWallet
        const unread = msgs.filter(
          (m) => m.senderWallet.toLowerCase() !== w && !m.read,
        ).length

        return (
          <button
            key={conv.id}
            onClick={() => onOpen(conv)}
            className="w-full flex items-start gap-3 px-4 py-4 transition-colors hover:opacity-80 text-left"
            style={{ background: unread > 0 ? 'rgba(16,97,166,0.04)' : 'transparent' }}
          >
            <Avatar wallet={otherWallet} size={40} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>
                  {conv.providerName}
                  {isProvider && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--muted)' }}>(you)</span>}
                </p>
                <p className="text-xs shrink-0" style={{ color: 'var(--subtle)' }}>
                  {last ? relativeTime(last.sentAt) : relativeTime(conv.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs truncate flex-1" style={{ color: 'var(--muted)' }}>
                  {last ? (last.senderWallet.toLowerCase() === w ? `You: ${last.text}` : last.text) : 'No messages yet'}
                </p>
                {unread > 0 && (
                  <span
                    className="shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {unread}
                  </span>
                )}
              </div>
              {conv.blocked && (
                <p className="text-xs mt-0.5 font-semibold" style={{ color: 'var(--danger)' }}>Conversation blocked</p>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── MessageThread ─────────────────────────────────────────────────────────

function MessageThread({
  conv,
  viewerWallet,
  store,
  onBack,
}: {
  conv: Conversation
  viewerWallet: string
  store: MessagesStore
  onBack: () => void
}) {
  const [text, setText] = useState('')
  const [showSafety, setShowSafety] = useState(false)
  const [showBlock, setShowBlock] = useState(false)
  const [blockConfirm, setBlockConfirm] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const w = viewerWallet.toLowerCase()

  const msgs = store.getMessages(conv.id)
  const isProvider = conv.providerWallet.toLowerCase() === w
  const otherWallet = isProvider ? conv.customerWallet : conv.providerWallet

  // Mark messages as read when thread is opened
  useEffect(() => {
    store.markRead(conv.id, viewerWallet)
  }, [conv.id, viewerWallet, store])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || conv.blocked) return
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`)
      return
    }
    store.sendMessage(conv.id, viewerWallet, trimmed)
    setText('')
  }, [text, conv.blocked, conv.id, store, viewerWallet])

  function handleBlock() {
    store.blockConversation(conv.id, viewerWallet)
    setShowBlock(false)
    setBlockConfirm(false)
    toast.success('Conversation blocked.')
  }

  function handleReport() {
    store.reportConversation(conv.id, viewerWallet)
    toast.success('Reported to moderation. Thank you.')
  }

  return (
    <div className="flex flex-col h-full max-h-[80dvh]">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-strong)' }}
      >
        <button
          onClick={onBack}
          className="transition-opacity hover:opacity-70 mr-1"
          style={{ color: 'var(--accent-hover)' }}
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar wallet={otherWallet} size={34} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: 'var(--ink)' }}>
            {conv.providerName}
          </p>
          <p className="text-xs truncate font-mono" style={{ color: 'var(--subtle)' }}>
            {otherWallet.slice(0, 6)}…{otherWallet.slice(-4)}
          </p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowSafety(!showSafety)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ background: showSafety ? 'rgba(16,97,166,0.12)' : 'transparent', color: showSafety ? 'var(--accent)' : 'var(--muted)' }}
            title="Safety tips"
          >
            <Shield size={15} />
          </button>
          <button
            onClick={handleReport}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--danger)' }}
            title="Report conversation"
          >
            <Flag size={15} />
          </button>
          <button
            onClick={() => setShowBlock(!showBlock)}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--muted)' }}
            title="Block"
          >
            <Ban size={15} />
          </button>
        </div>
      </div>

      {/* Safety banner */}
      {showSafety && (
        <div
          className="px-4 py-3 shrink-0 border-b"
          style={{ background: 'rgba(16,97,166,0.06)', borderColor: 'var(--border)' }}
        >
          <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
            <Info size={12} /> Safety tips
          </p>
          <ul className="space-y-1">
            {SAFETY_TIPS.map((tip) => (
              <li key={tip} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--ink-2)' }}>
                <Check size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Block confirm */}
      {showBlock && (
        <div
          className="px-4 py-3 shrink-0 border-b flex items-center justify-between gap-4"
          style={{ background: 'rgba(186,43,76,0.07)', borderColor: 'rgba(186,43,76,0.20)' }}
        >
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
              Block this conversation?
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Neither party will be able to send messages. This cannot be undone here.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowBlock(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (blockConfirm) { handleBlock() } else { setBlockConfirm(true) }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--danger)', color: '#fff' }}
            >
              {blockConfirm ? 'Confirm Block' : 'Block'}
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {msgs.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No messages yet. Say hello!</p>
          </div>
        )}

        {msgs.map((msg) => {
          const isMine = msg.senderWallet.toLowerCase() === w
          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}
            >
              {!isMine && <Avatar wallet={msg.senderWallet} size={28} />}
              <div className={`max-w-[75%] flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                <div
                  className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                  style={{
                    background: isMine ? 'var(--accent)' : 'var(--surface-muted)',
                    color: isMine ? '#fff' : 'var(--ink)',
                    borderBottomRightRadius: isMine ? 4 : undefined,
                    borderBottomLeftRadius: !isMine ? 4 : undefined,
                  }}
                >
                  {msg.text}
                </div>
                <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--subtle)' }}>
                  {relativeTime(msg.sentAt)}
                  {isMine && msg.read && (
                    <span className="ml-1" style={{ color: 'var(--success)' }}>✓ Read</span>
                  )}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="px-4 py-3 border-t shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-strong)' }}
      >
        {conv.blocked ? (
          <div className="flex items-center gap-2 py-2">
            <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
            <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>
              This conversation has been blocked.
            </p>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
                placeholder="Type a message… (Enter to send)"
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                className="w-full px-3 py-2.5 rounded-xl text-sm resize-none outline-none"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--focus)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              {text.length > MAX_MESSAGE_LENGTH * 0.85 && (
                <p className="text-[10px] mt-0.5 text-right" style={{ color: 'var(--subtle)' }}>
                  {text.length}/{MAX_MESSAGE_LENGTH}
                </p>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export function MessagingPanel({
  viewerWallet,
  store,
  initialConversationId,
  onBack,
}: MessagingPanelProps) {
  // Derive the open conversation from state + prop.
  // We track a selected ID separately from the object so we never need to
  // setState inside a useEffect (which the linter correctly flags as cascading).
  const [selectedConvId, setSelectedConvId] = useState<string | null>(
    initialConversationId ?? null,
  )
  const openConv: Conversation | null =
    store.conversations.find((c) => c.id === selectedConvId) ?? null
  // Convenience alias so the rest of the component keeps the same shape
  const setOpenConv = (c: Conversation | null) => setSelectedConvId(c?.id ?? null)

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent-hover)' }}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 className="display font-bold text-2xl" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
          {openConv ? openConv.providerName : 'Messages'}
        </h2>
        {!openConv && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {store.unreadCount(viewerWallet) > 0 ? store.unreadCount(viewerWallet) : ''}
          </span>
        )}
      </div>

      {/* Content card */}
      <div
        className="rounded-2xl overflow-hidden border"
        style={{ background: 'var(--surface-strong)', borderColor: 'var(--border)' }}
      >
        {openConv ? (
          <MessageThread
            conv={openConv}
            viewerWallet={viewerWallet}
            store={store}
            onBack={() => setOpenConv(null)}
          />
        ) : (
          <ConversationList
            viewerWallet={viewerWallet}
            store={store}
            onOpen={setOpenConv}
          />
        )}
      </div>
    </div>
  )
}

// ── ContactButton: quick CTA on a provider profile ────────────────────────
// Creates or opens a conversation and navigates to the messaging panel.

interface ContactButtonProps {
  providerWallet: string
  customerWallet: string
  providerId:     string
  providerName:   string
  store:          MessagesStore
  onOpen:         (conversationId: string) => void
  kycVerified?:   boolean
}

export function ContactButton({
  providerWallet,
  customerWallet,
  providerId,
  providerName,
  store,
  onOpen,
  kycVerified,
}: ContactButtonProps) {
  const isOwn = providerWallet.toLowerCase() === customerWallet.toLowerCase()
  if (isOwn) return null

  function handleContact() {
    if (!kycVerified) {
      toast.error('Complete identity verification to message providers.')
      return
    }
    const conv = store.getOrCreateConversation(
      providerWallet, customerWallet, providerId, providerName,
    )
    onOpen(conv.id)
  }

  return (
    <button
      onClick={handleContact}
      className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
      style={{ background: 'var(--accent)', color: '#fff' }}
    >
      <MessageCircle size={16} />
      Send a Message
    </button>
  )
}
