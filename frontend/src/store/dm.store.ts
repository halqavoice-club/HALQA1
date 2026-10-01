import { create } from 'zustand'

export interface DmUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  bio?: string | null
}

export interface DmReaction {
  id: string
  messageId: string
  userId: string
  emoji: string
  user: DmUser
}

export interface DmReplyTo {
  id: string
  body: string
  sender: DmUser
}

export type DmMsgType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'GIF' | 'VOICE' | 'AUDIO' | 'FILE' | 'VOICE_ROOM_SHARE'

// ─── VoiceRoom data enriched by the server for VOICE_ROOM_SHARE messages ─────
export interface VoiceRoomShareData {
  id: string
  title: string
  coverEmoji?: string | null
  coverImageUrl?: string | null
  privacy?: string | null
  status?: string | null
  hostId?: string | null
  maxSpeakers?: number | null
}

export interface DmMessage {
  id: string
  conversationId: string
  senderId: string
  receiverId: string
  body: string | null
  // Phase 4 media fields
  msgType: DmMsgType
  mediaUrl: string | null
  mimeType: string | null
  fileSize: number | null
  fileName: string | null
  duration: number | null
  width: number | null
  height: number | null
  thumbnail: string | null
  // Phase 5: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string | null
  refEntityId?: string | null
  voiceRoomData?: VoiceRoomShareData | null
  // ───────────────────────────────────
  status: 'SENT' | 'DELIVERED' | 'READ'
  deliveredAt: string | null
  readAt: string | null
  isEdited?: boolean
  editedAt?: string | null
  replyToId: string | null
  replyTo: DmReplyTo | null
  reactions: DmReaction[]
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
  updateMessageBody: (convId: string, msgId: string, body: string) => void
  updateReaction: (convId: string, messageId: string, emoji: string, userId: string, action: 'added' | 'removed', reaction: DmReaction | null) => void

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

  updateConversationPreview: (convId, msg) => set(s => {
    const mediaPreview: Record<string, string> = {
      IMAGE: '📷 Photo', VIDEO: '🎥 Video', GIF: '🎞️ GIF',
      VOICE: '🎤 Voice message', AUDIO: '🎵 Audio', FILE: '📎 File',
      // Phase 5: stable generic preview for Voice Club shares
      VOICE_ROOM_SHARE: '🎙️ Voice Club',
    }
    const preview = msg.body || mediaPreview[msg.msgType ?? 'TEXT'] || '📎 Media'
    return {
      conversations: s.conversations.map(c =>
        c.id === convId
          ? { ...c, lastMessage: preview, lastMessageAt: msg.createdAt, lastSenderId: msg.senderId }
          : c
      ).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    }
  }),

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
      [convId]: [...(s.messages[convId] ?? []), {
        ...msg,
        // Normalize createdAt to ISO string — socket may send Date objects
        createdAt: typeof msg.createdAt === 'string'
          ? msg.createdAt
          : msg.createdAt ? new Date(msg.createdAt as any).toISOString() : new Date().toISOString(),
        // Ensure Phase 4 media fields always exist (safe defaults)
        msgType:   msg.msgType   ?? 'TEXT',
        mediaUrl:  msg.mediaUrl  ?? null,
        mimeType:  msg.mimeType  ?? null,
        fileSize:  msg.fileSize  ?? null,
        fileName:  msg.fileName  ?? null,
        duration:  msg.duration  ?? null,
        width:     msg.width     ?? null,
        height:    msg.height    ?? null,
        thumbnail: msg.thumbnail ?? null,
        // Phase 5: preserve structured entity reference fields (never strip)
        refEntityType: (msg as any).refEntityType ?? null,
        refEntityId:   (msg as any).refEntityId   ?? null,
        voiceRoomData: (msg as any).voiceRoomData  ?? null,
        reactions: msg.reactions ?? [],
        replyTo:   msg.replyTo   ?? null,
        replyToId: msg.replyToId ?? null,
      }]
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

  updateMessageBody: (convId, msgId, body) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).map(m =>
        m.id === msgId ? { ...m, body, isEdited: true, editedAt: new Date().toISOString() } : m
      )
    }
  })),

  updateReaction: (convId, messageId, emoji, userId, action, reaction) => set(s => ({
    messages: {
      ...s.messages,
      [convId]: (s.messages[convId] ?? []).map(m => {
        if (m.id !== messageId) return m
        let reactions = m.reactions ?? []
        if (action === 'removed') {
          reactions = reactions.filter(r => !(r.userId === userId && r.emoji === emoji))
        } else if (reaction) {
          const exists = reactions.some(r => r.id === reaction.id)
          if (!exists) reactions = [...reactions, reaction]
        }
        return { ...m, reactions }
      })
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
