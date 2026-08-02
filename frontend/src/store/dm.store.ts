import { create } from 'zustand'

export interface DmUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  bio?: string | null
}

export interface DmMessage {
  id: string
  conversationId: string
  senderId: string
  receiverId: string
  body: string
  status: 'SENT' | 'DELIVERED' | 'READ'
  deliveredAt: string | null
  readAt: string | null
  createdAt: string
  sender: DmUser
}

export interface DmConversation {
  id: string
  other: DmUser
  lastMessage: string | null
  lastMessageAt: string | null
  lastSenderId: string | null
  unread: number
}

interface DmState {
  // Conversation list
  conversations: DmConversation[]
  setConversations: (c: DmConversation[] | ((prev: DmConversation[]) => DmConversation[])) => void
  updateConversationPreview: (convId: string, msg: DmMessage) => void
  incrementUnread: (convId: string) => void
  clearUnread: (convId: string) => void

  // Active conversation
  activeConvId: string | null
  setActiveConvId: (id: string | null) => void

  // Messages per conversation (keyed by convId)
  messages: Record<string, DmMessage[]>
  setMessages: (convId: string, msgs: DmMessage[]) => void
  addMessage: (convId: string, msg: DmMessage) => void
  updateMessageStatus: (convId: string, msgIds: string[], status: 'DELIVERED' | 'READ', at: string) => void
  removeMessage: (convId: string, msgId: string) => void

  // Typing state: convId → array of userIds currently typing
  typing: Record<string, string[]>
  setTyping: (convId: string, userId: string, isTyping: boolean) => void

  // Total unread badge
  totalUnread: number
  setTotalUnread: (n: number) => void
}

export const useDmStore = create<DmState>((set, get) => ({
  conversations: [],
  setConversations: (c) => set(s => ({
    conversations: typeof c === 'function' ? c(s.conversations) : c
  })),

  updateConversationPreview: (convId, msg) => set(s => ({
    conversations: s.conversations.map(c =>
      c.id === convId
        ? { ...c, lastMessage: msg.body, lastMessageAt: msg.createdAt, lastSenderId: msg.senderId }
        : c
    ).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
  })),

  incrementUnread: (convId) => set(s => ({
    conversations: s.conversations.map(c =>
      c.id === convId ? { ...c, unread: c.unread + 1 } : c
    ),
    totalUnread: s.totalUnread + 1
  })),

  clearUnread: (convId) => set(s => {
    const conv = s.conversations.find(c => c.id === convId)
    const delta = conv?.unread ?? 0
    return {
      conversations: s.conversations.map(c =>
        c.id === convId ? { ...c, unread: 0 } : c
      ),
      totalUnread: Math.max(0, s.totalUnread - delta)
    }
  }),

  activeConvId: null,
  setActiveConvId: (id) => set({ activeConvId: id }),

  messages: {},
  setMessages: (convId, msgs) => set(s => ({ messages: { ...s.messages, [convId]: msgs } })),

  addMessage: (convId, msg) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: [...(s.messages[convId] ?? []), msg]
    }
  })),

  updateMessageStatus: (convId, msgIds, status, at) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).map(m =>
        msgIds.includes(m.id)
          ? { ...m, status, ...(status === 'DELIVERED' ? { deliveredAt: at } : { readAt: at }) }
          : m
      )
    }
  })),

  removeMessage: (convId, msgId) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).filter(m => m.id !== msgId)
    }
  })),

  typing: {},
  setTyping: (convId, userId, isTyping) => set(s => {
    const current = s.typing[convId] ?? []
    const updated = isTyping
      ? current.includes(userId) ? current : [...current, userId]
      : current.filter(id => id !== userId)
    return { typing: { ...s.typing, [convId]: updated } }
  }),

  totalUnread: 0,
  setTotalUnread: (n) => set({ totalUnread: n }),
}))
