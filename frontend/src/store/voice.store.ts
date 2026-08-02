'use client'

import { create } from 'zustand'

export type VoiceRoomPrivacy = 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY'
export type VoiceRoomStatus = 'LIVE' | 'IDLE' | 'ENDED' | 'SCHEDULED'
export type VoiceParticipantRole = 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE'

export interface VoiceUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export interface VoiceParticipant {
  id: string
  userId: string
  role: VoiceParticipantRole
  isMuted: boolean
  handRaised: boolean
  handRaisedAt: string | null
  joinedAt: string
  isActive: boolean
  isPinned: boolean
  user: VoiceUser
}

export interface VoiceRoom {
  id: string
  schoolId: string | null
  hostId: string
  title: string
  description: string | null
  privacy: VoiceRoomPrivacy
  status: VoiceRoomStatus
  maxSpeakers: number
  isOpenMic: boolean
  micLocked: boolean
  coverEmoji: string
  coverImageUrl?: string | null
  topic: string | null
  startedAt: string | null
  endedAt: string | null
  scheduledAt: string | null
  createdAt: string
  // Comment settings
  commentsEnabled: boolean
  slowMode: boolean
  messageType: 'all' | 'followers' | 'none'
  reactionsEnabled: boolean
  roomLevel: number          // 1-10
  // Social — populated on join
  isFollowingHost?: boolean
  host: VoiceUser
  participants: VoiceParticipant[]
  _count?: { participants: number; messages?: number }
}

// ─── Room member level metadata ───────────────────────────────────────────────
export const ROOM_LEVEL_CAPACITY: Record<number, number> = {
  1: 500, 2: 1000, 3: 2000, 4: 3500, 5: 5000,
  6: 8000, 7: 12000, 8: 18000, 9: 25000, 10: 50000,
}

export const MEMBER_LEVEL_META: Record<number, { label: string; emoji: string; color: string }> = {
  1: { label: 'Fan',     emoji: '⭐', color: '#9ca3af' },
  2: { label: 'Regular', emoji: '🌟', color: '#6366f1' },
  3: { label: 'VIP',     emoji: '💎', color: '#06b6d4' },
  4: { label: 'Super',   emoji: '🔥', color: '#f59e0b' },
  5: { label: 'Legend',  emoji: '👑', color: '#ef4444' },
}

export interface VoiceRoomMember {
  id: string
  roomId: string
  userId: string
  memberLevel: number   // 1-5
  role: string          // OWNER|CO_OWNER|ADMIN|MODERATOR|VIP|OFFICIAL|MEMBER|BLOCKED
  status: string        // PENDING|ACTIVE|REMOVED
  isBanned: boolean
  joinedAt: string
  upgradedAt: string | null
  note: string | null
  nickname: string | null
  lastActiveAt: string | null
  isOnline: boolean
  contribution: number
  user: VoiceUser
}

export interface VoiceMessage {
  id: string
  roomId: string
  userId: string
  body: string
  createdAt: string
  user: VoiceUser
}

export interface VoiceReaction {
  id: number
  userId: string
  emoji: string
}

// ─── Gift types ───────────────────────────────────────────────────────────────
export interface GiftDef {
  id: string
  name: string
  emoji: string
  imageUrl: string | null
  videoUrl?: string | null   // optional video animation file (webm/mp4)
  animationType: 'overlay' | 'banner' | 'spotlight' | 'fullscreen' | 'cinematic' | 'bubble' | 'avatar_effect' | 'racing' | 'rocket_launch' | 'rocket_cinematic' | 'video'
  soundEffect: string | null
  priceCoins: number
  rarity: 'common' | 'standard' | 'rare' | 'epic' | 'legendary' | 'ultimate'
  comboEnabled: boolean
  priority: 'normal' | 'high' | 'ultra'
  isPremium: boolean
}

export interface GiftEvent {
  id: string           // transactionId (or generated id for all-stage)
  roomId: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  // Single receiver (normal gift)
  receiver?: { id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }
  // Multiple receivers (all-stage gift)
  receivers?: Array<{ id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }>
  isAllStage?: boolean   // true when sent to everyone on stage
  receiverCount?: number
  gift: GiftDef
  count: number
  combo: number
  coinsSpent: number
  diamondsEarned: number
  priority: 'normal' | 'high' | 'ultra'
  isPremium: boolean
  holdMs: number       // ms to hold the stage (0 for normal gifts)
  timestamp: number
}

export interface WalletState {
  coins: number
  diamonds: number
}

interface VoiceState {
  // Room list
  rooms: VoiceRoom[]
  setRooms: (rooms: VoiceRoom[]) => void

  // Active room
  activeRoom: VoiceRoom | null
  setActiveRoom: (room: VoiceRoom | null) => void
  updateRoom: (updates: Partial<VoiceRoom>) => void
  updateParticipant: (userId: string, updates: Partial<VoiceParticipant>) => void
  addParticipant: (participant: VoiceParticipant) => void
  removeParticipant: (userId: string) => void

  // Chat
  messages: VoiceMessage[]
  addMessage: (msg: VoiceMessage) => void
  setMessages: (msgs: VoiceMessage[]) => void

  // Speaking indicators — plain object for Zustand compatibility
  speakingUsers: Record<string, boolean>
  setSpeaking: (userId: string, speaking: boolean) => void

  // Reactions
  reactions: VoiceReaction[]
  addReaction: (r: VoiceReaction) => void

  // UI state
  isChatOpen: boolean
  toggleChat: () => void
  isHandQueueOpen: boolean
  toggleHandQueue: () => void

  // Pending mic offer (received by this user)
  pendingMicOffer: {
    offerId: string
    roomId: string
    passerId: string
    passerName: string
    passerAvatar: string | null
    passerRole: string
    expiresIn: number
    receivedAt: number  // Date.now()
  } | null
  setPendingMicOffer: (offer: VoiceState['pendingMicOffer']) => void
  clearPendingMicOffer: () => void

  // FIFO speaker queue (real-time from backend Redis)
  speakerQueue: Array<{
    userId: string
    firstName: string
    lastName: string
    avatarUrl: string | null
    raisedAt: string
  }>
  setSpeakerQueue: (queue: VoiceState['speakerQueue']) => void

  // Waiting list modal
  isWaitingListOpen: boolean
  toggleWaitingList: () => void

  // ─── Gift system ──────────────────────────────────────────────────────────
  // Live gift events (for animation overlay)
  activeGiftEvents: GiftEvent[]
  addGiftEvent: (event: GiftEvent) => void
  removeGiftEvent: (id: string) => void

  // Wallet balance (cached locally)
  wallet: WalletState | null
  setWallet: (w: WalletState) => void
  deductCoins: (amount: number) => void

  // Gift panel UI
  isGiftPanelOpen: boolean
  toggleGiftPanel: () => void

  // Room leaderboard
  giftLeaderboard: Array<{
    userId: string
    user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
    totalCoins: number
    giftCount: number
  }>
  setGiftLeaderboard: (lb: VoiceState['giftLeaderboard']) => void

  // Reset all room-scoped state (call on unmount of voice room page)
  resetRoom: () => void
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  rooms: [],
  setRooms: (rooms) => set({ rooms }),

  activeRoom: null,
  setActiveRoom: (room) => set({
    activeRoom: room,
    messages: [],
    speakingUsers: {},
    reactions: [],
    speakerQueue: [],
    isChatOpen: false,
    isHandQueueOpen: false,
    isWaitingListOpen: false,
    pendingMicOffer: null,
    activeGiftEvents: [],
    isGiftPanelOpen: false,
    giftLeaderboard: [],
    // NOTE: wallet is intentionally NOT reset here — coins persist across room changes
    // and are refreshed by useVoiceRoom on mount
  }),

  updateRoom: (updates) => {
    const room = get().activeRoom
    if (!room) return
    set({ activeRoom: { ...room, ...updates } })
  },

  updateParticipant: (userId, updates) => {
    const room = get().activeRoom
    if (!room) return
    set({
      activeRoom: {
        ...room,
        participants: room.participants.map(p =>
          p.userId === userId ? { ...p, ...updates } : p
        )
      }
    })
  },

  addParticipant: (participant) => {
    const room = get().activeRoom
    if (!room) return
    const exists = room.participants.some(p => p.userId === participant.userId)
    if (exists) {
      set({
        activeRoom: {
          ...room,
          participants: room.participants.map(p =>
            p.userId === participant.userId ? { ...p, ...participant, isActive: true } : p
          )
        }
      })
    } else {
      set({ activeRoom: { ...room, participants: [...room.participants, participant] } })
    }
  },

  removeParticipant: (userId) => {
    const room = get().activeRoom
    if (!room) return
    set({
      activeRoom: {
        ...room,
        participants: room.participants.map(p =>
          p.userId === userId ? { ...p, isActive: false } : p
        )
      }
    })
  },

  messages: [],
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),

  speakingUsers: {},
  setSpeaking: (userId, speaking) => {
    set(s => ({
      speakingUsers: speaking
        ? { ...s.speakingUsers, [userId]: true }
        : Object.fromEntries(Object.entries(s.speakingUsers).filter(([k]) => k !== userId))
    }))
  },

  reactions: [],
  addReaction: (r) => {
    set(s => ({ reactions: [...s.reactions.slice(-19), r] }))
    // Auto-remove after 2.5s
    setTimeout(() => {
      set(s => ({ reactions: s.reactions.filter(x => x.id !== r.id) }))
    }, 2500)
  },

  isChatOpen: false,
  toggleChat: () => set(s => ({ isChatOpen: !s.isChatOpen })),

  isHandQueueOpen: false,
  toggleHandQueue: () => set(s => ({ isHandQueueOpen: !s.isHandQueueOpen })),

  pendingMicOffer: null,
  setPendingMicOffer: (offer) => set({ pendingMicOffer: offer }),
  clearPendingMicOffer: () => set({ pendingMicOffer: null }),

  speakerQueue: [],
  setSpeakerQueue: (queue) => set({ speakerQueue: queue }),

  isWaitingListOpen: false,
  toggleWaitingList: () => set(s => ({ isWaitingListOpen: !s.isWaitingListOpen })),

  // ─── Gift system ──────────────────────────────────────────────────────────
  activeGiftEvents: [],
  addGiftEvent: (event) => {
    set(s => ({ activeGiftEvents: [...s.activeGiftEvents.slice(-9), event] }))
    // Auto-remove: use holdMs if set, otherwise rarity-based duration
    const duration = event.holdMs > 0 ? event.holdMs + 800  // +800ms buffer after animation
      : event.gift.rarity === 'ultimate'  ? 8800
      : event.gift.rarity === 'legendary' ? 10800  // Lion = 10s + buffer
      : event.gift.rarity === 'epic'      ? 4500
      : event.gift.rarity === 'rare'      ? 3000
      : event.gift.rarity === 'standard'  ? 2800
      : event.gift.animationType === 'rocket_cinematic' ? 8500
      : event.gift.animationType === 'rocket_launch'    ? 4500
      : event.gift.animationType === 'bubble'           ? 2000
      : event.gift.animationType === 'avatar_effect'    ? 2500
      : event.gift.animationType === 'racing'           ? 3000
      : 2500
    setTimeout(() => {
      set(s => ({ activeGiftEvents: s.activeGiftEvents.filter(e => e.id !== event.id) }))
    }, duration)
  },
  removeGiftEvent: (id) => set(s => ({
    activeGiftEvents: s.activeGiftEvents.filter(e => e.id !== id)
  })),

  wallet: null,
  setWallet: (w) => set({ wallet: w }),
  deductCoins: (amount) => set(s => ({
    wallet: s.wallet ? { ...s.wallet, coins: Math.max(0, s.wallet.coins - amount) } : null
  })),

  isGiftPanelOpen: false,
  toggleGiftPanel: () => set(s => ({ isGiftPanelOpen: !s.isGiftPanelOpen })),

  giftLeaderboard: [],
  setGiftLeaderboard: (lb) => set({ giftLeaderboard: lb }),

  resetRoom: () => set({
    activeRoom: null,
    messages: [],
    speakingUsers: {},
    reactions: [],
    speakerQueue: [],
    pendingMicOffer: null,
    activeGiftEvents: [],
    isGiftPanelOpen: false,
    giftLeaderboard: [],
    isChatOpen: false,
    isHandQueueOpen: false,
    isWaitingListOpen: false,
  }),
}))
