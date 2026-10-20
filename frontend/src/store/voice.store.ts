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
  mutedByModerator: boolean   // when true, user cannot unmute themselves
  handRaised: boolean
  handRaisedAt: string | null
  joinedAt: string
  isActive: boolean
  isPinned: boolean
  seatNumber: number | null   // 1–12 when on stage; null when in audience (authoritative)
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
  lockedSeats: number[]   // individual seat indices locked by host
  coverEmoji: string
  coverImageUrl?: string | null
  topic: string | null
  startedAt: string | null
  endedAt: string | null
  scheduledAt: string | null
  createdAt: string
  // Room-wide mute policy (DEF-001)
  allMuted: boolean
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
  removeMessage: (msgId: string) => void

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

  // LiveKit disconnect ref — set by VoiceRoomView so any page can trigger full teardown
  _liveKitDisconnect: (() => void) | null
  registerLiveKitDisconnect: (fn: () => void) => void
  clearLiveKitDisconnect: () => void

  // Pre-join sync buffer — holds voice:stage_state events that arrive during
  // the race window between POST /join and useVoiceRoom mounting its listener.
  // The early listener in page.tsx pushes here; useVoiceRoom drains on mount.
  pendingSyncEvents: Array<{
    roomId: string
    stageParticipants: Array<{
      userId: string; role: string; isMuted: boolean; seatNumber: number | null
      isPinned: boolean; handRaised: boolean; mutedByModerator: boolean
      joinedAt: string; firstName?: string | null; lastName?: string | null; avatarUrl?: string | null
    }>
    stageCount: number
  }>
  pushSyncEvent: (e: VoiceState['pendingSyncEvents'][number]) => void
  drainSyncEvents: () => VoiceState['pendingSyncEvents']

  // Early-buffer: voice:user_joined events that arrive before useVoiceRoom mounts
  // (max 20 entries — oldest discarded). Drained by useVoiceRoom after all listeners registered.
  pendingUserJoinedEvents: Array<{
    roomId: string; userId: string; firstName: string; lastName: string
    avatarUrl: string | null; role: string; isMuted?: boolean
    mutedByModerator?: boolean; handRaised?: boolean; handRaisedAt?: string
    isPinned?: boolean; seatNumber?: number | null; joinedAt?: string
  }>
  pushUserJoinedEvent: (e: VoiceState['pendingUserJoinedEvents'][number]) => void
  drainUserJoinedEvents: () => VoiceState['pendingUserJoinedEvents']

  // Early-buffer: voice:queue_updated events — only the last snapshot is kept
  // because queue snapshots supersede each other.
  pendingQueueUpdatedEvents: Array<{
    roomId: string
    queue: Array<{ userId: string; firstName: string; lastName: string; avatarUrl: string | null; raisedAt: string }>
    queueLength: number
  }>
  pushQueueUpdatedEvent: (e: VoiceState['pendingQueueUpdatedEvents'][number]) => void
  drainQueueUpdatedEvents: () => VoiceState['pendingQueueUpdatedEvents']

  // Flag: true while page.tsx early handlers are the active listeners.
  // useVoiceRoom sets this to false before draining the buffers so that
  // any events arriving in the sub-ms drain gap are handled by useVoiceRoom's
  // own registered listeners, not buffered again — preventing double-processing.
  earlyBufferActive: boolean
  deactivateEarlyBuffer: () => void
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
    // FIX (GAP-005): re-arm the early buffer when clearing the active room so
    // that re-joining (e.g. after kick/ban/room-end without navigating away)
    // correctly buffers voice:user_joined and voice:queue_updated events that
    // arrive during the race window before useVoiceRoom mounts its listeners.
    ...(room === null && {
      earlyBufferActive: true,
      pendingSyncEvents: [],
      pendingUserJoinedEvents: [],
      pendingQueueUpdatedEvents: [],
    }),
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
      // SEAT SYNC FIX: Insert in deterministic sorted position (role asc, joinedAt asc)
      // instead of appending to end, so all clients see the same seat layout
      // immediately without waiting for a full room state resync.
      const ROLE_ORDER: Record<string, number> = { HOST: 0, MODERATOR: 1, SPEAKER: 2, AUDIENCE: 3 }
      const newList = [...room.participants, participant].sort((a, b) => {
        const roleDiff = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
        if (roleDiff !== 0) return roleDiff
        return (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '')
      })
      set({ activeRoom: { ...room, participants: newList } })
    }
  },

  removeParticipant: (userId) => {
    const room = get().activeRoom
    if (!room) return
    // STEP-5 FIX: Remove participant entirely (aligned with mobile behavior).
    // Previously this marked isActive:false and kept the entry; mobile filtered
    // it out entirely. Using filter on both platforms ensures clean state and
    // avoids stale inactive entries accumulating on long sessions.
    set({
      activeRoom: {
        ...room,
        participants: room.participants.filter(p => p.userId !== userId)
      }
    })
  },

  messages: [],
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  removeMessage: (msgId) => set(s => ({ messages: s.messages.filter(m => m.id !== msgId) })),

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
    pendingSyncEvents: [],
    pendingUserJoinedEvents: [],
    pendingQueueUpdatedEvents: [],
    earlyBufferActive: true,  // re-arm for next room join
  }),

  // ─── Pre-join sync buffer ─────────────────────────────────────────────────
  // voice:stage_state events that arrive between POST /join and the full
  // useVoiceRoom listener mount are buffered here (max 5, oldest discarded).
  // useVoiceRoom drains this buffer after registering all listeners.
  pendingSyncEvents: [],
  pushSyncEvent: (e) => set(s => ({
    pendingSyncEvents: [...s.pendingSyncEvents.slice(-4), e],
  })),
  drainSyncEvents: () => {
    const events = get().pendingSyncEvents
    set({ pendingSyncEvents: [] })
    return events
  },

  // ─── Early-buffer: voice:user_joined ─────────────────────────────────────
  // Holds user_joined events that arrive before useVoiceRoom mounts its
  // listener. Max 50 entries (oldest discarded). Drained on mount.
  pendingUserJoinedEvents: [],
  pushUserJoinedEvent: (e) => set(s => {
    // Stop buffering once useVoiceRoom has taken over — events arriving
    // after deactivateEarlyBuffer() was called will be handled by
    // useVoiceRoom's own registered listeners directly.
    if (!s.earlyBufferActive) return s
    return { pendingUserJoinedEvents: [...s.pendingUserJoinedEvents.slice(-49), e] }
  }),
  drainUserJoinedEvents: () => {
    const events = get().pendingUserJoinedEvents
    set({ pendingUserJoinedEvents: [] })
    return events
  },

  // ─── Early-buffer: voice:queue_updated ───────────────────────────────────
  // Only the latest queue snapshot is kept because snapshots supersede each
  // other. Drained on mount.
  pendingQueueUpdatedEvents: [],
  pushQueueUpdatedEvent: (e) => set(s => {
    if (!s.earlyBufferActive) return s
    return { pendingQueueUpdatedEvents: [e] } // only keep the latest snapshot
  }),
  drainQueueUpdatedEvents: () => {
    const events = get().pendingQueueUpdatedEvents
    set({ pendingQueueUpdatedEvents: [] })
    return events
  },

  // ─── Early-buffer active flag ────────────────────────────────────────────
  // Starts true (page.tsx registers early handlers before user clicks Join).
  // useVoiceRoom calls deactivateEarlyBuffer() before draining, so any events
  // that arrive in the sub-ms drain gap go to useVoiceRoom's own listeners
  // instead of being buffered and processed twice.
  earlyBufferActive: true,
  deactivateEarlyBuffer: () => set({ earlyBufferActive: false }),

  // ─── LiveKit disconnect ref ───────────────────────────────────────────────
  // VoiceRoomView registers its disconnect() here so that any page (e.g. the
  // join page for a different room) can fully tear down the active LiveKit
  // session before switching rooms.
  _liveKitDisconnect: null,
  registerLiveKitDisconnect: (fn) => set({ _liveKitDisconnect: fn }),
  clearLiveKitDisconnect: () => set({ _liveKitDisconnect: null }),
}))
