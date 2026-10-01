import { create } from 'zustand'

export interface GcUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export interface GcReaction {
  id: string
  messageId: string
  userId: string
  type: string
  user: GcUser
}

export interface GcReplyTo {
  id: string
  body: string | null
  sender: GcUser
}

export interface GcMessage {
  id: string
  conversationId: string
  senderId: string
  sender: GcUser
  type: string
  body: string | null
  mediaUrl: string | null
  mimeType: string | null
  fileSize: number | null
  fileName: string | null
  duration: number | null
  replyToId: string | null
  replyTo: GcReplyTo | null
  reactions: GcReaction[]
  deletedAt: string | null
  createdAt: string
  readBy: string[]
  isPinned?: boolean
  forwardedFrom?: string
  // Phase 5: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string | null
  refEntityId?: string | null
  voiceRoomData?: {
    id: string
    title: string
    coverEmoji?: string | null
    coverImageUrl?: string | null
    privacy?: string | null
    status?: string | null
    hostId?: string | null
    maxSpeakers?: number | null
  } | null
}

export interface GcMember {
  id: string
  userId: string
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER'
  joinedAt: string
  user: GcUser
}

export interface GcConversation {
  id: string
  name: string
  description: string | null
  avatarUrl: string | null
  privacy: string
  memberCount: number
  messageCount: number
  lastMessage: string | null
  lastMessageAt: string | null
  createdBy: string
  members: GcMember[]
  unread: number
  // Permissions
  onlyAdminsCanSendMessages?: boolean
  onlyAdminsCanSendMedia?: boolean
}

interface GcState {
  conversations: GcConversation[]
  setConversations: (c: GcConversation[]) => void
  upsertConversation: (c: GcConversation) => void
  updatePreview: (convId: string, msg: GcMessage) => void
  incrementUnread: (convId: string) => void
  clearUnread: (convId: string) => void

  activeConvId: string | null
  setActiveConvId: (id: string | null) => void

  messages: Record<string, GcMessage[]>
  setMessages: (convId: string, msgs: GcMessage[]) => void
  prependMessages: (convId: string, msgs: GcMessage[]) => void
  addMessage: (convId: string, msg: GcMessage) => void
  removeMessage: (convId: string, msgId: string) => void
  updateMessagePin: (convId: string, msgId: string, pin: boolean) => void
  updateReaction: (convId: string, msgId: string, reaction: GcReaction) => void

  typing: Record<string, string[]>
  setTyping: (convId: string, userId: string, isTyping: boolean) => void

  // Create group modal
  showCreate: boolean
  setShowCreate: (v: boolean) => void
}

export const useGroupChatStore = create<GcState>((set, get) => ({
  conversations: [],
  setConversations: (c) => set({ conversations: c }),

  upsertConversation: (c) => set(s => {
    const idx = s.conversations.findIndex(x => x.id === c.id)
    if (idx >= 0) {
      const updated = [...s.conversations]
      updated[idx] = { ...updated[idx], ...c }
      return { conversations: updated }
    }
    return { conversations: [c, ...s.conversations] }
  }),

  updatePreview: (convId, msg) => set(s => ({
    conversations: s.conversations
      .map(c => c.id === convId
        ? { ...c, lastMessage: msg.body, lastMessageAt: msg.createdAt }
        : c
      )
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
  })),

  incrementUnread: (convId) => set(s => ({
    conversations: s.conversations.map(c =>
      c.id === convId ? { ...c, unread: (c.unread ?? 0) + 1 } : c
    )
  })),

  clearUnread: (convId) => set(s => ({
    conversations: s.conversations.map(c =>
      c.id === convId ? { ...c, unread: 0 } : c
    )
  })),

  activeConvId: null,
  setActiveConvId: (id) => set({ activeConvId: id }),

  messages: {},
  setMessages: (convId, msgs) => set(s => ({
    messages: { ...s.messages, [convId]: msgs }
  })),
  prependMessages: (convId, msgs) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: [...msgs, ...(s.messages[convId] ?? [])]
    }
  })),
  addMessage: (convId, msg) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: [...(s.messages[convId] ?? []), msg]
    }
  })),
  removeMessage: (convId, msgId) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).filter(m => m.id !== msgId)
    }
  })),
  updateMessagePin: (convId, msgId, pin) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).map(m => {
        if (pin && m.id !== msgId) return { ...m, isPinned: false }  // unpin others
        if (m.id === msgId) return { ...m, isPinned: pin }
        return m
      })
    }
  })),
  updateReaction: (convId, msgId, reaction) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).map(m => {
        if (m.id !== msgId) return m
        // Handle both add/replace and remove (reaction may have action field)
        const incoming = reaction as any
        if (incoming?.action === 'removed' || incoming?.removed) {
          // Remove by userId + type
          return {
            ...m,
            reactions: m.reactions.filter(
              r => !(r.userId === incoming.userId && r.type === incoming.type)
            )
          }
        }
        // Add or replace
        const existing = m.reactions.findIndex(r => r.userId === reaction.userId)
        const reactions = existing >= 0
          ? m.reactions.map((r, i) => i === existing ? reaction : r)
          : [...m.reactions, reaction]
        return { ...m, reactions }
      })
    }
  })),

  typing: {},
  setTyping: (convId, userId, isTyping) => set(s => {
    const cur = s.typing[convId] ?? []
    const updated = isTyping
      ? cur.includes(userId) ? cur : [...cur, userId]
      : cur.filter(id => id !== userId)
    return { typing: { ...s.typing, [convId]: updated } }
  }),

  showCreate: false,
  setShowCreate: (v) => set({ showCreate: v }),
}))
