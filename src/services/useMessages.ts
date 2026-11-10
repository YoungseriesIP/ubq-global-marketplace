// ─── In-app messaging store ────────────────────────────────────────────────
// Persisted to localStorage. In production, replace with a real-time backend
// (WebSocket or polling endpoint). No message content is sent to any server here.

import { useState, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface Message {
  id:           string
  conversationId: string
  senderWallet: string
  text:         string
  sentAt:       string // ISO-8601
  read:         boolean
  /** true if this message was auto-sent when the customer first contacted */
  isSystem?:    boolean
}

export interface Conversation {
  id:            string
  /** The service provider's wallet address */
  providerWallet: string
  /** The customer's wallet address */
  customerWallet: string
  providerId:    string
  providerName:  string
  /** ISO-8601 */
  createdAt:     string
  lastMessageAt: string
  /** true if either party has blocked the other */
  blocked:       boolean
  blockedBy?:    string
  /** true if reported */
  reported:      boolean
}

export interface MessagesStore {
  conversations:    Conversation[]
  messages:         Message[]
  getOrCreateConversation: (providerWallet: string, customerWallet: string, providerId: string, providerName: string) => Conversation
  sendMessage:      (conversationId: string, senderWallet: string, text: string) => Message
  markRead:         (conversationId: string, readerWallet: string) => void
  blockConversation:(conversationId: string, byWallet: string) => void
  reportConversation:(conversationId: string, reporterWallet: string) => void
  getConversations: (walletAddress: string) => Conversation[]
  getMessages:      (conversationId: string) => Message[]
  unreadCount:      (walletAddress: string) => number
}

// ── Storage keys ──────────────────────────────────────────────────────────

const CONV_KEY = 'tp_conversations_v1'
const MSG_KEY  = 'tp_messages_v1'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJson<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ }
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

// ── Seed conversations for demo ────────────────────────────────────────────

const DEMO_CONV_ID = 'demo-conv-1'

const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: DEMO_CONV_ID,
    providerWallet: '0x0000000000000000000000000000000000000011',
    customerWallet: '0x0000000000000000000000000000000000000099',
    providerId: 'seed-1',
    providerName: 'Amara Osei',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    blocked: false,
    reported: false,
  },
]

const SEED_MESSAGES: Message[] = [
  {
    id: 'dm1', conversationId: DEMO_CONV_ID,
    senderWallet: '0x0000000000000000000000000000000000000099',
    text: 'Hello! I need a traditional Yoruba agbada for my wedding next month. Do you handle custom orders?',
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), read: true,
  },
  {
    id: 'dm2', conversationId: DEMO_CONV_ID,
    senderWallet: '0x0000000000000000000000000000000000000011',
    text: 'Welcome! Yes, I specialise in custom agbada sets. I\'ll need your measurements and colour preferences. When is the wedding?',
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString(), read: true,
  },
  {
    id: 'dm3', conversationId: DEMO_CONV_ID,
    senderWallet: '0x0000000000000000000000000000000000000099',
    text: 'Great! The wedding is on 28 November. I\'d like royal blue with gold trim. Can we discuss pricing?',
    sentAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(), read: false,
  },
]

// ── Hook ──────────────────────────────────────────────────────────────────

export function useMessages(): MessagesStore {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadJson<Conversation[]>(CONV_KEY, [])
    return stored.length > 0 ? stored : SEED_CONVERSATIONS
  })

  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = loadJson<Message[]>(MSG_KEY, [])
    return stored.length > 0 ? stored : SEED_MESSAGES
  })

  // Persist on change
  useEffect(() => { saveJson(CONV_KEY, conversations) }, [conversations])
  useEffect(() => { saveJson(MSG_KEY, messages) },       [messages])

  const getOrCreateConversation = useCallback((
    providerWallet: string,
    customerWallet: string,
    providerId:     string,
    providerName:   string,
  ): Conversation => {
    const existing = conversations.find(
      (c) =>
        c.providerWallet.toLowerCase() === providerWallet.toLowerCase() &&
        c.customerWallet.toLowerCase() === customerWallet.toLowerCase() &&
        c.providerId === providerId,
    )
    if (existing) return existing
    const conv: Conversation = {
      id: uid(),
      providerWallet,
      customerWallet,
      providerId,
      providerName,
      createdAt:     new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      blocked:  false,
      reported: false,
    }
    setConversations((prev) => [conv, ...prev])
    return conv
  }, [conversations])

  const sendMessage = useCallback((
    conversationId: string,
    senderWallet:   string,
    text:           string,
  ): Message => {
    const msg: Message = {
      id: uid(),
      conversationId,
      senderWallet,
      text: text.trim(),
      sentAt: new Date().toISOString(),
      read: false,
    }
    setMessages((prev) => [...prev, msg])
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, lastMessageAt: msg.sentAt } : c,
      ),
    )
    return msg
  }, [])

  const markRead = useCallback((conversationId: string, readerWallet: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.conversationId === conversationId &&
        m.senderWallet.toLowerCase() !== readerWallet.toLowerCase() &&
        !m.read
          ? { ...m, read: true }
          : m,
      ),
    )
  }, [])

  const blockConversation = useCallback((conversationId: string, byWallet: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, blocked: true, blockedBy: byWallet }
          : c,
      ),
    )
  }, [])

  const reportConversation = useCallback((conversationId: string, _reporterWallet: string) => {
    setConversations((prev) =>
      prev.map((c) => c.id === conversationId ? { ...c, reported: true } : c),
    )
  }, [])

  const getConversations = useCallback((walletAddress: string): Conversation[] => {
    const w = walletAddress.toLowerCase()
    return conversations
      .filter(
        (c) =>
          c.providerWallet.toLowerCase() === w ||
          c.customerWallet.toLowerCase() === w,
      )
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      )
  }, [conversations])

  const getMessages = useCallback((conversationId: string): Message[] => {
    return messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
  }, [messages])

  const unreadCount = useCallback((walletAddress: string): number => {
    const w = walletAddress.toLowerCase()
    const myConvIds = conversations
      .filter(
        (c) =>
          (c.providerWallet.toLowerCase() === w ||
           c.customerWallet.toLowerCase() === w) &&
          !c.blocked,
      )
      .map((c) => c.id)
    return messages.filter(
      (m) =>
        myConvIds.includes(m.conversationId) &&
        m.senderWallet.toLowerCase() !== w &&
        !m.read,
    ).length
  }, [conversations, messages])

  return {
    conversations,
    messages,
    getOrCreateConversation,
    sendMessage,
    markRead,
    blockConversation,
    reportConversation,
    getConversations,
    getMessages,
    unreadCount,
  }
}
