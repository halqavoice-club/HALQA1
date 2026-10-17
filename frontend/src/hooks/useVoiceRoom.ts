'use client'

import { useEffect, useCallback } from 'react'
import { useVoiceStore, VoiceParticipant, VoiceMessage } from '@/store/voice.store'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import { voiceOfflineBuffer } from '@/lib/voiceOfflineBuffer'
import { useToast } from '@/components/ui/use-toast'

// ─── Role helpers (mirrors backend VOICE_ROLES) ───────────────────────────────
export const VOICE_ROLES = {
  HOST:      'HOST',
  MODERATOR: 'MODERATOR',
  SPEAKER:   'SPEAKER',
  AUDIENCE:  'AUDIENCE'
} as const

export type VoiceRole = typeof VOICE_ROLES[keyof typeof VOICE_ROLES]

// ─── Safe cast helpers — convert raw socket strings to typed union values ─────
const asRole     = (r: string): VoiceParticipant['role']  => r as VoiceParticipant['role']
const asStatus   = (s: string): import('@/store/voice.store').VoiceRoomStatus  => s as import('@/store/voice.store').VoiceRoomStatus
const asPrivacy  = (p: string): import('@/store/voice.store').VoiceRoomPrivacy => p as import('@/store/voice.store').VoiceRoomPrivacy

/** Roles that can moderate (approve queue, mute others, kick, promote) */
export const canModerate = (role?: string) =>
  role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR

/** Roles that can publish audio (HOST/MOD only when unmuted — on stage) */
export const canSpeak = (role?: string, isMuted?: boolean) => {
  if (role === VOICE_ROLES.SPEAKER) return true
  if (role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR) return !isMuted
  return false
}

/** Returns true if this participant is a HOST or MODERATOR (regardless of mute state) */
export const isHostOrMod = (role?: string) =>
  role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR

export function useVoiceRoom(roomId: string | null) {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const {
    activeRoom, setActiveRoom,
    addParticipant, removeParticipant, updateParticipant, updateRoom,
    addMessage, setMessages,
    setSpeaking, addReaction,
    setPendingMicOffer, clearPendingMicOffer,
    setSpeakerQueue,
    addGiftEvent, setGiftLeaderboard, setWallet
  } = useVoiceStore()

  // ── beforeunload: call leave API so the server marks participant inactive
  //    even if the user closes the tab / refreshes / navigates away hard.
  useEffect(() => {
    if (!roomId) return
    const handleBeforeUnload = () => {
      // sendBeacon is the only reliable way to fire a request on tab close.
      // It ignores CORS credentials, so we can't use the axios instance here.
      // Fall back to a synchronous XHR if sendBeacon is unavailable.
      const url = `${process.env.NEXT_PUBLIC_API_URL}/voice/${roomId}/leave`
      const token = useAuthStore.getState().getAccessToken()
      // sendBeacon does not support custom headers — use fetch with keepalive instead
      fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket event listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()
    if (!socket) return

    // ── Re-join the socket room after a reconnect ─────────────────────────
    // When the socket disconnects and reconnects (e.g. token refresh, network
    // blip), the socket no longer belongs to the voice:${roomId} Socket.IO room.
    // Re-emitting voice:join_room re-registers it so all room broadcasts
    // (gifts, reactions, role changes) continue to arrive.
    // STEP-4 FIX: Also re-fetch the full participant list so anyone who
    // joined or left while the socket was down is reflected immediately.
    const onReconnect = () => {
      socket.emit('voice:join_room', roomId)
      // Re-hydrate full participant list (audience + stage) after reconnect.
      // getStageState now returns ALL active participants — not just on-stage.
      api.get(`/voice/${roomId}/stage-state`)
        .then((r: { data: { data: Parameters<typeof onStageState>[0] } }) => {
          if (r.data?.data) onStageState(r.data.data)
        })
        .catch(() => { /* non-fatal — socket events will catch up */ })
    }
    socket.on('connect', onReconnect)

    // Phase 6: Flush offline buffer when connection is established
    // Any messages/hand raises buffered during disconnection are replayed now.
    if (voiceOfflineBuffer.size > 0) {
      voiceOfflineBuffer.flush(async (event) => {
        try {
          if (event.type === 'voice:message' && event.payload?.body) {
            await api.post(`/voice/${roomId}/messages`, { body: event.payload.body })
            return true
          }
          if (event.type === 'voice:queue:raise') {
            await api.post(`/voice/${roomId}/queue/raise`)
            return true
          }
          if (event.type === 'voice:queue:cancel') {
            await api.delete(`/voice/${roomId}/queue/cancel`)
            return true
          }
          return false
        } catch { return false }
      }).catch(() => {})
    }

    const onUserJoined = (data: {
      roomId: string; userId: string
      firstName: string; lastName: string
      avatarUrl: string | null; role: string
      handRaised?: boolean
      handRaisedAt?: string
      isMuted?: boolean
      mutedByModerator?: boolean
      isPinned?: boolean
      seatNumber?: number | null
      joinedAt?: string
    }) => {
      if (data.roomId !== roomId) return
      addParticipant({
        id: data.userId, userId: data.userId,
        role: asRole(data.role),
        isMuted: data.isMuted ?? true,
        mutedByModerator: data.mutedByModerator ?? false,
        handRaised: data.handRaised ?? false,
        handRaisedAt: data.handRaisedAt ?? (data.handRaised ? new Date().toISOString() : null),
        joinedAt: data.joinedAt ?? new Date().toISOString(),
        isActive: true,
        isPinned: data.isPinned ?? false,
        seatNumber: data.seatNumber ?? null,
        user: { id: data.userId, firstName: data.firstName, lastName: data.lastName, avatarUrl: data.avatarUrl }
      })
    }

    const onUserLeft = (data: { roomId: string; userId: string }) => {
      if (data.roomId !== roomId) return
      removeParticipant(data.userId)
    }

    const onMuteChanged = (data: { roomId: string; userId: string; isMuted: boolean; mutedByModerator?: boolean; seatNumber?: number | null }) => {
      if (data.roomId !== roomId) return
      const update: Partial<import('@/store/voice.store').VoiceParticipant> = { isMuted: data.isMuted }
      if (data.mutedByModerator !== undefined) update.mutedByModerator = data.mutedByModerator
      if (data.seatNumber !== undefined) update.seatNumber = data.seatNumber ?? null
      // isMuted=true + seatNumber=null = dropped to audience
      if (data.isMuted && data.seatNumber === null) update.seatNumber = null
      updateParticipant(data.userId, update)
    }

    const onHandRaised = (data: {
      roomId: string; userId: string; raised: boolean
      firstName: string; lastName: string
    }) => {
      if (data.roomId !== roomId) return
      updateParticipant(data.userId, {
        handRaised: data.raised,
        handRaisedAt: data.raised ? new Date().toISOString() : null
      })
      // Read myRole from store to avoid stale-closure on activeRoom
      const myRole = useVoiceStore.getState().activeRoom?.participants.find(p => p.userId === user?.id)?.role
      if (canModerate(myRole) && data.raised && data.userId !== user?.id) {
        toast({
          title: `✋ ${data.firstName} ${data.lastName} raised their hand`,
          description: 'Tap Hands to approve them as a speaker'
        })
      }
    }

    const onRoleChanged = (data: { roomId: string; userId: string; role: string; seatNumber?: number | null }) => {
      if (data.roomId !== roomId) return
      const update: Partial<import('@/store/voice.store').VoiceParticipant> = {
        role: asRole(data.role),
        handRaised: false,
        handRaisedAt: null,
        mutedByModerator: false,  // any role change clears mod-mute flag
      }
      if (data.seatNumber !== undefined) update.seatNumber = data.seatNumber ?? null
      // Role → AUDIENCE always clears seatNumber
      if (data.role === VOICE_ROLES.AUDIENCE) {
        update.isMuted = true
        update.seatNumber = null
      } else if (data.role === VOICE_ROLES.SPEAKER && data.seatNumber != null) {
        update.isMuted = false
      }
      updateParticipant(data.userId, update)
      if (data.userId === user?.id && data.role === VOICE_ROLES.SPEAKER) {
        toast({ title: `🎙️ You're on stage at Seat ${data.seatNumber}!` })
      }
      if (data.userId === user?.id && data.role === VOICE_ROLES.AUDIENCE) {
        toast({ title: 'Moved to audience', description: 'You can raise your hand to speak again' })
      }
    }

    // BUG FIX: voice:your_role_changed is emitted by promoteParticipant() to the
    // promoted user directly — it carries the same payload as voice:role_changed
    // but was never handled, so the promoted user's own UI never updated.
    const onYourRoleChanged = (data: { roomId: string; role: string; seatNumber?: number | null }) => {
      if (data.roomId !== roomId) return
      if (!user?.id) return
      const update: Partial<import('@/store/voice.store').VoiceParticipant> = {
        role: asRole(data.role),
        handRaised: false,
        handRaisedAt: null,
      }
      // Apply seatNumber so the promoted user's own grid slot appears correctly
      if (data.seatNumber !== undefined) update.seatNumber = data.seatNumber ?? null
      // Only set isMuted for role transitions that have a definitive mute state.
      // HOST/MODERATOR role changes must NOT override isMuted — their mute state
      // is controlled separately via voice:mute_changed.
      if (data.role === VOICE_ROLES.AUDIENCE) {
        update.isMuted = true
        update.seatNumber = null
      } else if (data.role === VOICE_ROLES.SPEAKER) {
        update.isMuted = false
        // If seatNumber wasn't in the event (old server), it stays as-is
      }
      updateParticipant(user.id, update)
    }
    const onModeratorAssigned = (data: {
      roomId: string; userId: string; firstName: string; lastName: string
    }) => {
      if (data.roomId !== roomId) return
      updateParticipant(data.userId, { role: VOICE_ROLES.MODERATOR, isMuted: false })
      // Read myRole from store directly to avoid the stale-closure problem
      // (activeRoom is captured at effect-mount time and does not reflect later participant changes).
      const myRole = useVoiceStore.getState().activeRoom?.participants.find(p => p.userId === user?.id)?.role
      if (myRole === VOICE_ROLES.HOST) {
        toast({ title: `🛡️ ${data.firstName} ${data.lastName} is now a moderator` })
      }
    }

    const onModeratorRemoved = (data: { roomId: string; userId: string }) => {
      if (data.roomId !== roomId) return
      // RT-FIX-8: clear seatNumber so the grid slot is freed immediately
      updateParticipant(data.userId, { role: VOICE_ROLES.AUDIENCE, isMuted: true, seatNumber: null })
    }

    const onAdminTransferred = (data: {
      roomId: string; newHostId: string; prevHostId: string; newHostName: string
    }) => {
      if (data.roomId !== roomId) return
      updateParticipant(data.newHostId,  { role: VOICE_ROLES.HOST })
      updateParticipant(data.prevHostId, { role: VOICE_ROLES.MODERATOR })
      toast({ title: `👑 ${data.newHostName} is now the host` })
      // Re-check follow status for the new host
      if (user?.id && data.newHostId !== user.id) {
        api.get(`/social/counts/${data.newHostId}`)
          .then(r => useVoiceStore.getState().updateRoom({ isFollowingHost: r.data.data?.isFollowing ?? false }))
          .catch(() => {})
      } else if (data.newHostId === user?.id) {
        // I am now the host — I always can chat
        useVoiceStore.getState().updateRoom({ isFollowingHost: true })
      }
    }

    const onYouAreModerator = (data: { roomId: string; message: string }) => {
      if (data.roomId !== roomId) return
      toast({ title: '🛡️ You are now a moderator!', description: data.message })
    }

    const onYouAreHost = (data: { roomId: string; message: string }) => {
      if (data.roomId !== roomId) return
      toast({ title: '👑 You are now the host!', description: data.message })
    }

    const onMessage = (data: { roomId: string; message: VoiceMessage }) => {
      if (data.roomId !== roomId) return
      addMessage(data.message)
    }

    const onMessageDeleted = (data: { roomId: string; msgId: string }) => {
      if (data.roomId !== roomId) return
      useVoiceStore.getState().removeMessage(data.msgId)
    }

    const onSpeaking = (data: { userId: string; speaking: boolean }) => {
      setSpeaking(data.userId, data.speaking)
    }

    const onReaction = (data: { userId: string; emoji: string }) => {
      addReaction({ userId: data.userId, emoji: data.emoji, id: Date.now() + Math.random() })
    }

    const onRoomEnded = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return
      // PERMANENT ROOMS: voice:room_ended means the room went IDLE (all left, 5-min grace elapsed)
      // OR an admin explicitly archived it. In both cases the room record persists in the DB.
      // We eject the user from the live session (their participant is now inactive)
      // but we do NOT tell them the room is gone — it can be rejoined via the lobby.
      toast({
        title: '🔔 Room is now offline',
        description: 'The room is idle — it will be live again when someone joins.',
      })
      setActiveRoom(null)
    }

    const onRoomDeleted = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return
      // voice:room_deleted is only emitted when the host explicitly deletes (soft-deletes)
      // the room record — a destructive action. The room cannot be rejoined after this.
      toast({ title: '🗑️ Room deleted', description: 'The host has permanently deleted this room.' })
      setActiveRoom(null)
    }

    const onKicked = (data: { roomId: string }) => {
      if (data.roomId !== roomId) return
      toast({ title: 'You were removed', description: 'You were removed from this room.', variant: 'destructive' })
      setActiveRoom(null)
    }

    // FIX: voice:banned is emitted by banParticipant() on two channels:
    //   1. Room-wide: voice:{roomId} → { roomId, userId } — tells others to remove the participant
    //   2. Personal:  user:{banned}  → { roomId, reason } — tells the banned user to leave
    // Previously this event had no listener at all — neither path was handled.
    const onBanned = (data: { roomId: string; userId?: string; reason?: string }) => {
      if (data.roomId !== roomId) return
      if (data.userId && data.userId !== user?.id) {
        // Room-wide broadcast: someone else was banned — remove them from the participant list
        removeParticipant(data.userId)
      } else {
        // Personal broadcast (no userId, or userId === me): I was banned — leave
        toast({
          title: '⛔ You were banned from this room',
          description: data.reason || 'You have been banned by the host.',
          variant: 'destructive'
        })
        setActiveRoom(null)
      }
    }

    const onHostChanged = (data: { roomId: string; newHostId: string }) => {
      if (data.roomId !== roomId) return
      updateParticipant(data.newHostId, { role: VOICE_ROLES.HOST })
      if (data.newHostId === user?.id) toast({ title: '👑 You are now the host!' })
    }

    const onSlotFreed = (data: { roomId: string; speakerCount: number; maxSpeakers: number }) => {
      if (data.roomId !== roomId) return
      // Read from store to avoid stale-closure on activeRoom
      const liveRoom = useVoiceStore.getState().activeRoom
      const myRole = liveRoom?.participants.find(p => p.userId === user?.id)?.role
      if (canModerate(myRole)) {
        const queue = liveRoom?.participants.filter(p => p.handRaised && p.role === VOICE_ROLES.AUDIENCE) || []
        if (queue.length > 0) {
          toast({ title: `🎙️ Speaker slot freed — ${queue.length} hand${queue.length > 1 ? 's' : ''} waiting` })
        }
      }
    }

    // ── Mic pass events ────────────────────────────────────────────────────
    const onMicOffer = (data: {
      offerId: string; roomId: string; passerId: string
      passerName: string; passerAvatar: string | null
      passerRole: string; expiresIn: number
    }) => {
      if (data.roomId !== roomId) return
      setPendingMicOffer({ ...data, receivedAt: Date.now() })
      toast({
        title: `🎙️ ${data.passerName} is passing the mic to you!`,
        description: `You have ${data.expiresIn} seconds to accept.`
      })
    }

    const onMicPassed = (data: {
      roomId: string; passerId: string; passerName: string
      targetId: string; targetName: string; passerRole: string
    }) => {
      if (data.roomId !== roomId) return
      // Update roles in store
      if (data.passerRole !== VOICE_ROLES.HOST) {
        updateParticipant(data.passerId, { role: VOICE_ROLES.AUDIENCE, isMuted: true })
      }
      updateParticipant(data.targetId, {
        role: VOICE_ROLES.SPEAKER, isMuted: false,
        handRaised: false, handRaisedAt: null
      })
      clearPendingMicOffer()
      toast({ title: `🎙️ ${data.passerName} passed the mic to ${data.targetName}` })
    }

    const onMicReceived = (data: { roomId: string; message: string }) => {
      if (data.roomId !== roomId) return
      clearPendingMicOffer()
      toast({ title: '🎙️ Mic received!', description: data.message })
    }

    const onMicDeclined = (data: { roomId: string; targetName: string }) => {
      if (data.roomId !== roomId) return
      toast({
        title: `${data.targetName} declined the mic`,
        description: 'Your mic offer was declined.',
        variant: 'destructive'
      })
    }

    const onMicOfferCancelled = (data: { roomId: string; offerId: string }) => {
      if (data.roomId !== roomId) return
      clearPendingMicOffer()
      toast({ title: 'Mic offer was cancelled' })
    }

    // ── Open Mic events ────────────────────────────────────────────────────
    const onOpenMicChanged = (data: { roomId: string; isOpenMic: boolean; changedBy: string }) => {
      if (data.roomId !== roomId) return
      updateRoom({ isOpenMic: data.isOpenMic })
      if (data.changedBy !== user?.id) {
        toast({
          title: data.isOpenMic ? '🎙️ Open Mic is ON!' : '🔒 Open Mic is OFF',
          description: data.isOpenMic
            ? 'Tap "Take Mic" to speak instantly'
            : 'Raise your hand to request speaking'
        })
      }
    }

    const onMicLockChanged = (data: { roomId: string; micLocked: boolean; changedBy: string }) => {
      if (data.roomId !== roomId) return
      updateRoom({ micLocked: data.micLocked })
      if (data.changedBy !== user?.id) {
        toast({
          title: data.micLocked ? '🔒 Mic Locked' : '🔓 Mic Unlocked',
          description: data.micLocked ? 'The host has locked the microphone' : 'The microphone has been unlocked'
        })
      }
    }

    const onSeatLockChanged = (data: { roomId: string; seatIndex: number; locked: boolean; lockedSeats: number[]; changedBy: string }) => {
      if (data.roomId !== roomId) return
      updateRoom({ lockedSeats: data.lockedSeats })
      if (data.changedBy !== user?.id) {
        toast({ title: data.locked ? `🔒 Seat ${data.seatIndex + 1} locked` : `🔓 Seat ${data.seatIndex + 1} unlocked` })
      }
    }

    // ── Membership events ──────────────────────────────────────────────────────
    const onJoinRequest = (d: { roomId: string; userId: string; firstName: string; lastName: string }) => {
      if (d.roomId !== roomId) return
      // Read from store to avoid stale-closure on activeRoom
      const myRole = useVoiceStore.getState().activeRoom?.participants.find(p => p.userId === user?.id)?.role
      if (canModerate(myRole)) {
        toast({ title: `✋ ${d.firstName} ${d.lastName} wants to join the room`, description: 'Check Member Requests to approve' })
      }
    }
    const onJoinApproved = (d: { roomId: string; title?: string }) => {
      if (d.roomId !== roomId) return
      toast({ title: '✅ Your join request was approved!', description: 'You are now a permanent member' })
    }
    const onJoinRejected = (d: { roomId: string }) => {
      if (d.roomId !== roomId) return
      toast({ title: '❌ Join request declined', description: 'Your request to join this room was not approved.', variant: 'destructive' })
    }
    const onMemberRoleChanged = (d: { roomId: string; userId: string; role: string; changedBy: string }) => {
      if (d.roomId !== roomId) return
      if (d.userId === user?.id) {
        toast({ title: `🏷️ Your member role changed to ${d.role}` })
      }
    }
    const onMemberUpgraded = (d: { roomId: string; userId: string; memberLevel: number; levelMeta?: any }) => {
      if (d.roomId !== roomId) return
      if (d.userId === user?.id) {
        const meta = d.levelMeta
        toast({ title: meta ? `${meta.emoji} Member level upgraded to ${meta.label}!` : '🎉 Member level upgraded!' })
      }
    }
    const onYourMemberLevel = (d: { roomId: string; memberLevel: number; levelMeta?: any; message?: string }) => {
      if (d.roomId !== roomId) return
      if (d.message) toast({ title: d.message })
    }
    const onYourMemberRole = (d: { roomId: string; role: string; levelMeta?: any }) => {
      if (d.roomId !== roomId) return
      const meta = d.levelMeta
      if (meta) toast({ title: `${meta.emoji} Your member role is now ${d.role}` })
    }
    const onRemovedFromRoom = (d: { roomId: string }) => {
      if (d.roomId !== roomId) return
      toast({ title: '🚫 You were removed from this room', variant: 'destructive' })
      setActiveRoom(null)
    }
    // voice:blocked_from_room is emitted by room-member.controller.js blockMember().
    // Handler registered inline below.

    const onMicGrabbed = (data: {
      roomId: string; userId: string; firstName: string; lastName: string
      avatarUrl: string | null; seatNumber?: number | null
    }) => {
      if (data.roomId !== roomId) return
      updateParticipant(data.userId, {
        role:        VOICE_ROLES.SPEAKER,
        isMuted:     false,
        handRaised:  false,
        handRaisedAt: null,
        seatNumber:  data.seatNumber ?? null,  // ← apply the assigned seat so avatar appears in grid
      })
      if (data.userId !== user?.id) {
        toast({ title: `🎙️ ${data.firstName} ${data.lastName} grabbed the mic` })
      }
    }

    // HOST PRIORITY EVICTION: fired on the evicted user's personal channel when
    // the room owner reclaims their stage from a full room.
    const onMovedToAudience = (data: { roomId: string; reason: string; message: string }) => {
      if (data.roomId !== roomId) return
      // The role_changed + mute_changed events already update the store state.
      // This event just shows a toast to the affected user.
      toast({
        title: '👑 Host reclaimed the stage',
        description: data.message || 'The host has returned and you were moved to the audience.',
      })
    }

    // ATOMIC STAGE STATE: After HOST priority eviction, the backend sends a
    // full authoritative stage snapshot. Apply it to reconcile any stale state
    // caused by out-of-order individual role_changed / mute_changed events.
    // This prevents the "13 seats" flicker.
    // P1 FIX: Extended type includes optional profile fields from the enriched
    // backend query (LEFT JOIN users). onStageState now upserts participants
    // absent from the store so a buffered snapshot can backfill missed joins.
    // BUG-005 FIX: Stale-seat sweep — clear seatNumber for any store participant
    // whose userId is absent from a verified full-room snapshot. This corrects
    // ghost stage slots left behind when a voice:role_changed or voice:mute_changed
    // event was dropped during a network blip. Only runs when the snapshot has
    // content (stageParticipants.length > 0) so an empty or malformed payload
    // cannot accidentally clear all seats. Does not remove participants from the
    // store or change their role — only seatNumber is cleared to null.
    const onStageState = (data: {
      roomId: string
      stageParticipants: Array<{
        userId: string; role: string; isMuted: boolean; joinedAt: string
        isPinned: boolean; handRaised: boolean; mutedByModerator: boolean
        seatNumber: number | null
        firstName?: string | null; lastName?: string | null; avatarUrl?: string | null
      }>
      stageCount: number
    }) => {
      if (data.roomId !== roomId) return
      // P1 FIX (ordering): Capture store state BEFORE the updateParticipant loop so the
      // upsert-pass below uses the original participant list, not the post-mutation version.
      // updateParticipant only maps over existing entries — if a userId is absent from the
      // store it silently no-ops. Reading currentParticipants before the loop ensures the
      // upsert-pass correctly identifies which participants are genuinely new.
      const currentParticipants = useVoiceStore.getState().activeRoom?.participants ?? []
      // Apply authoritative seat state for every stage participant
      data.stageParticipants.forEach(sp => {
        updateParticipant(sp.userId, {
          role: asRole(sp.role),
          isMuted: sp.isMuted,
          isPinned: sp.isPinned,
          handRaised: sp.handRaised,
          mutedByModerator: sp.mutedByModerator,
          seatNumber: sp.seatNumber,
        })
      })
      // Upsert pass — add any stage participant whose userId is not
      // already in the store. This covers participants missed due to the initial
      // join race (voice:user_joined arrived before listener was registered).
      data.stageParticipants.forEach(sp => {
        const alreadyInStore = currentParticipants.some(p => p.userId === sp.userId)
        if (!alreadyInStore) {
          addParticipant({
            id:               sp.userId,
            userId:           sp.userId,
            role:             asRole(sp.role),
            isMuted:          sp.isMuted,
            mutedByModerator: sp.mutedByModerator,
            handRaised:       sp.handRaised,
            handRaisedAt:     null,
            joinedAt:         typeof sp.joinedAt === 'string' ? sp.joinedAt : new Date().toISOString(),
            isActive:         true,
            isPinned:         sp.isPinned,
            seatNumber:       sp.seatNumber,
            user: {
              id:        sp.userId,
              firstName: sp.firstName ?? '',
              lastName:  sp.lastName  ?? '',
              avatarUrl: sp.avatarUrl ?? null,
            },
          })
        }
      })
      // BUG-005 FIX: Stale-seat sweep.
      // A full-room snapshot guarantees all active participants are included.
      // Any participant in the store with a non-null seatNumber who is NOT in
      // the snapshot has already dropped their seat on the server — clear it.
      // Guard: only sweep when snapshot has participants (prevents clearing all
      // seats if a malformed empty snapshot ever arrives).
      if (data.stageParticipants.length > 0) {
        const snapshotIds = new Set(data.stageParticipants.map(sp => sp.userId))
        const storeParticipants = useVoiceStore.getState().activeRoom?.participants ?? []
        storeParticipants.forEach(p => {
          if (p.seatNumber != null && !snapshotIds.has(p.userId)) {
            // Participant has a stale seat not reflected in the authoritative snapshot
            updateParticipant(p.userId, { seatNumber: null })
          }
        })
      }
    }

    // ── FIFO queue updates ─────────────────────────────────────────────────
    const onQueueUpdated = (data: {
      roomId: string
      queue: Array<{ userId: string; firstName: string; lastName: string; avatarUrl: string | null; raisedAt: string }>
      queueLength: number
    }) => {
      if (data.roomId !== roomId) return
      setSpeakerQueue(data.queue)
    }

    const onQueueRejected = (data: { roomId: string; message: string }) => {
      if (data.roomId !== roomId) return
      toast({ title: '❌ Request declined', description: data.message, variant: 'destructive' })
    }

    const onPromotedToSpeaker = (data: { roomId: string; message: string; seatNumber?: number | null }) => {
      if (data.roomId !== roomId) return
      // Apply seatNumber immediately so the seat grid renders without waiting
      // for the subsequent voice:role_changed event (which may arrive slightly later).
      if (user?.id && data.seatNumber != null) {
        updateParticipant(user.id, {
          role:        VOICE_ROLES.SPEAKER,
          isMuted:     false,
          seatNumber:  data.seatNumber,
          handRaised:  false,
          handRaisedAt: null,
        })
      }
      toast({ title: '🎙️ You\'re on stage!', description: data.message })
    }

    const onQueuePosition = (data: { roomId: string; position: number }) => {
      if (data.roomId !== roomId) return
      toast({ title: `✋ You're #${data.position} in the queue`, description: 'Wait for the host to approve you' })
    }

    const onStatusChanged = (data: { roomId: string; status: string }) => {
      if (data.roomId !== roomId) return
      updateRoom({ status: asStatus(data.status) })
    }

    const onRoomUpdated = (data: {
      roomId: string; title: string; description: string | null
      topic: string | null; privacy: string; coverEmoji: string
      coverImageUrl?: string | null
      commentsEnabled?: boolean; slowMode?: boolean; messageType?: string
      reactionsEnabled?: boolean
    }) => {
      if (data.roomId !== roomId) return
      updateRoom({
        title:           data.title,
        description:     data.description,
        topic:           data.topic,
        privacy:         asPrivacy(data.privacy),
        coverEmoji:      data.coverEmoji,
        coverImageUrl:   data.coverImageUrl,
        ...(data.commentsEnabled  !== undefined && { commentsEnabled:  data.commentsEnabled }),
        ...(data.slowMode         !== undefined && { slowMode:         data.slowMode }),
        ...(data.messageType      !== undefined && { messageType:      data.messageType as 'all' | 'followers' | 'none' }),
        ...(data.reactionsEnabled !== undefined && { reactionsEnabled: data.reactionsEnabled }),
      })
    }

    // ── Gift events ────────────────────────────────────────────────────────
    const onGiftSent = (data: any) => {
      if (data.roomId !== roomId) return
      const eventId = data.transactionId ?? `${Date.now()}-${Math.random()}`
      const isAllStage = data.type === 'VOICE_GIFT_ALL'
      addGiftEvent({
        ...data,
        id:           eventId,
        isAllStage,
        receiverCount: data.receiverCount ?? (isAllStage ? data.receivers?.length : 1),
        priority:     data.priority  ?? 'normal',
        isPremium:    data.isPremium ?? false,
        holdMs:       data.holdMs    ?? 0,
        coinsSpent:   data.coinsSpentTotal ?? data.coinsSpent ?? 0,
        diamondsEarned: data.diamondsPerPerson ?? data.diamondsEarned ?? 0,
        combo:        data.combo ?? 1,
      })

      // Refresh leaderboard silently
      api.get(`/voice/${roomId}/gifts/leaderboard?limit=10`)
        .then(r => setGiftLeaderboard(r.data.data || []))
        .catch(() => {})

      // Toast for big gifts
      const rarity = data.gift?.rarity
      if (isAllStage) {
        toast({
          title: `${data.gift?.emoji} ${data.sender?.firstName} gifted everyone on stage!`,
          description: `${data.gift?.name} × ${data.receiverCount ?? data.receivers?.length ?? '?'} people`
        })
      } else if (rarity === 'ultimate') {
        toast({
          title: `${data.gift.emoji} ${data.sender.firstName} sent ${data.gift.name}!`,
          description: '🌟 ULTIMATE GIFT — Room-wide moment!'
        })
      } else if (rarity === 'legendary' || rarity === 'epic') {
        toast({
          title: `${data.gift.emoji} ${data.sender.firstName} sent ${data.gift.name}!`,
          description: rarity === 'legendary' ? '🌟 Legendary gift!' : '✨ Epic gift!'
        })
      }
    }

    // voice:gift_all fires in addition to voice:gift_sent for all-stage gifts
    // We handle it via onGiftSent (already registered) — just dedup here
    const onGiftAll = (data: any) => {
      if (data.roomId !== roomId) return
      // Already handled by onGiftSent — only process if not already in store
      const existing = useVoiceStore.getState().activeGiftEvents
        .find(e => e.timestamp === data.timestamp && e.sender?.id === data.sender?.id)
      if (!existing) onGiftSent(data)
    }

    const onGiftReceived = (data: any) => {
      // Refresh wallet balance when we receive a gift
      if (data.receiver?.id === user?.id) {
        api.get('/wallet/me').then(r => setWallet(r.data.data)).catch(() => {})
      }
    }

    socket.on('voice:user_joined',        onUserJoined)
    socket.on('voice:user_left',          onUserLeft)
    socket.on('voice:mute_changed',       onMuteChanged)
    socket.on('voice:hand_raised',        onHandRaised)
    socket.on('voice:role_changed',       onRoleChanged)
    socket.on('voice:your_role_changed',  onYourRoleChanged)  // BUG FIX: was missing
    socket.on('voice:moderator_assigned', onModeratorAssigned)
    socket.on('voice:moderator_removed',  onModeratorRemoved)
    socket.on('voice:admin_transferred',  onAdminTransferred)
    socket.on('voice:you_are_moderator',  onYouAreModerator)
    socket.on('voice:you_are_host',       onYouAreHost)
    socket.on('voice:message',            onMessage)
    socket.on('voice:message_deleted',    onMessageDeleted)
    socket.on('voice:speaking',           onSpeaking)
    socket.on('voice:reaction',           onReaction)
    socket.on('voice:room_ended',         onRoomEnded)
    socket.on('voice:room_deleted',       onRoomDeleted)
    socket.on('voice:kicked',             onKicked)
    socket.on('voice:banned',             onBanned)  // FIX: was missing — banned user UI now clears
    // voice:host_changed is never emitted by the backend.
    // Ownership transfers come via voice:admin_transferred, already handled above.
    socket.on('voice:speaker_slot_freed', onSlotFreed)
    socket.on('voice:mic_offer',          onMicOffer)
    socket.on('voice:mic_passed',         onMicPassed)
    socket.on('voice:mic_received',       onMicReceived)
    socket.on('voice:mic_declined',       onMicDeclined)
    socket.on('voice:mic_offer_cancelled',onMicOfferCancelled)
    socket.on('voice:open_mic_changed',   onOpenMicChanged)
    socket.on('voice:mic_lock_changed',   onMicLockChanged)
    socket.on('voice:seat_lock_changed',  onSeatLockChanged)
    socket.on('voice:join_request',       onJoinRequest)
    socket.on('voice:join_approved',      onJoinApproved)
    socket.on('voice:join_rejected',      onJoinRejected)
    socket.on('voice:member_role_changed',onMemberRoleChanged)
    socket.on('voice:member_upgraded',    onMemberUpgraded)
    socket.on('voice:your_member_level',  onYourMemberLevel)
    socket.on('voice:your_member_role',   onYourMemberRole)
    socket.on('voice:removed_from_room',  onRemovedFromRoom)
    socket.on('voice:blocked_from_room', (d: { roomId: string }) => {
      // Emitted by room-member.controller.js blockMember() — user was blocked from room.
      if (d.roomId !== roomId) return
      toast({ title: '⛔ You were blocked from this room', variant: 'destructive' })
      setActiveRoom(null)
    })
    socket.on('voice:mic_grabbed',        onMicGrabbed)
    socket.on('voice:moved_to_audience',  onMovedToAudience)
    socket.on('voice:stage_state',        onStageState)
    socket.on('voice:queue_updated',      onQueueUpdated)
    socket.on('voice:queue_rejected',     onQueueRejected)
    socket.on('voice:promoted_to_speaker',onPromotedToSpeaker)
    socket.on('voice:queue_position',     onQueuePosition)
    socket.on('voice:status_changed',     onStatusChanged)
    socket.on('voice:room_updated',       onRoomUpdated)
    socket.on('voice:gift_sent',          onGiftSent)
    socket.on('voice:speaker_pinned',     (d: { roomId: string; userId: string; isPinned: boolean }) => {
      if (d.roomId !== roomId) return
      updateParticipant(d.userId, { isPinned: d.isPinned })
    })
    socket.on('voice:premium_gift',       onGiftSent)   // BUG FIX: premium gifts use a separate channel
    // BUG FIX: server emits 'gift:received' on the private user:{id} socket room,
    // NOT 'voice:gift_received' on the voice room. The socket already joins user:{userId}
    // on connect (app.js: socket.join(`user:${userId}`)). Listening on the correct event
    // name ensures the wallet-balance refresh fires when we receive a gift.
    socket.on('gift:received',            onGiftReceived)
    socket.on('voice:gift_all',           onGiftAll)

    // P0-A FIX: Drain any voice:stage_state events that arrived during the
    // race window between POST /join completing and this useEffect registering
    // all listeners. The early listener in page.tsx buffered them in the store.
    useVoiceStore.getState().drainSyncEvents().forEach(payload => onStageState(payload))

    // STEP-3 FIX: Emit voice:join_room AFTER all socket.on() listeners are registered.
    // Previously this was the first statement in the effect (before any socket.on calls),
    // so voice:stage_state / voice:user_joined events that arrived in the same microtask
    // burst were silently dropped. Now all handlers are in place before the server
    // starts delivering room events to this socket.
    socket.emit('voice:join_room', roomId)

    return () => {
      socket.off('connect', onReconnect)
      socket.off('voice:user_joined',        onUserJoined)
      socket.off('voice:user_left',          onUserLeft)
      socket.off('voice:mute_changed',       onMuteChanged)
      socket.off('voice:hand_raised',        onHandRaised)
      socket.off('voice:role_changed',       onRoleChanged)
      socket.off('voice:your_role_changed',  onYourRoleChanged)
      socket.off('voice:moderator_assigned', onModeratorAssigned)
      socket.off('voice:moderator_removed',  onModeratorRemoved)
      socket.off('voice:admin_transferred',  onAdminTransferred)
      socket.off('voice:you_are_moderator',  onYouAreModerator)
      socket.off('voice:you_are_host',       onYouAreHost)
      socket.off('voice:message',            onMessage)
      socket.off('voice:message_deleted',    onMessageDeleted)
      socket.off('voice:speaking',           onSpeaking)
      socket.off('voice:reaction',           onReaction)
      socket.off('voice:room_ended',         onRoomEnded)
      socket.off('voice:room_deleted',       onRoomDeleted)
      socket.off('voice:kicked',             onKicked)
      socket.off('voice:banned',             onBanned)  // FIX: cleanup added with handler above
      // voice:host_changed was never emitted — removed; ownership handled by voice:admin_transferred above
      socket.off('voice:speaker_slot_freed', onSlotFreed)
      socket.off('voice:mic_offer',          onMicOffer)
      socket.off('voice:mic_passed',         onMicPassed)
      socket.off('voice:mic_received',       onMicReceived)
      socket.off('voice:mic_declined',       onMicDeclined)
      socket.off('voice:mic_offer_cancelled',onMicOfferCancelled)
      socket.off('voice:open_mic_changed',   onOpenMicChanged)
      socket.off('voice:mic_lock_changed',   onMicLockChanged)
      socket.off('voice:seat_lock_changed',  onSeatLockChanged)
    // (membership cleanup)
      socket.off('voice:join_request',       onJoinRequest)
      socket.off('voice:join_approved',      onJoinApproved)
      socket.off('voice:join_rejected',      onJoinRejected)
      socket.off('voice:member_role_changed',onMemberRoleChanged)
      socket.off('voice:member_upgraded',    onMemberUpgraded)
      socket.off('voice:your_member_level',  onYourMemberLevel)
      socket.off('voice:your_member_role',   onYourMemberRole)
      socket.off('voice:removed_from_room',  onRemovedFromRoom)
      socket.off('voice:blocked_from_room')
      socket.off('voice:mic_grabbed',        onMicGrabbed)
      socket.off('voice:moved_to_audience',  onMovedToAudience)
      socket.off('voice:stage_state',        onStageState)
      socket.off('voice:queue_updated',      onQueueUpdated)
      socket.off('voice:queue_rejected',     onQueueRejected)
      socket.off('voice:promoted_to_speaker',onPromotedToSpeaker)
      socket.off('voice:queue_position',     onQueuePosition)
      socket.off('voice:status_changed',     onStatusChanged)
      socket.off('voice:room_updated',       onRoomUpdated)
      socket.off('voice:gift_sent',          onGiftSent)
      socket.off('voice:premium_gift',       onGiftSent)
      socket.off('gift:received',            onGiftReceived)
      socket.off('voice:gift_all',           onGiftAll)
    }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load chat history on enter
  useEffect(() => {
    if (!roomId) return
    api.get(`/voice/${roomId}/messages?limit=100`)
      .then(r => setMessages(r.data.data || []))
      .catch(() => {})
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load wallet balance, gift leaderboard, and follow status on enter
  useEffect(() => {
    if (!roomId) return
    api.get('/wallet/me').then(r => setWallet(r.data.data)).catch(() => {})
    api.get(`/voice/${roomId}/gifts/leaderboard?limit=10`)
      .then(r => setGiftLeaderboard(r.data.data || []))
      .catch(() => {})
    // Check if current user follows the host (needed for followers-only chat)
    // activeRoom is already set before this hook mounts — read directly from store
    const hostId = useVoiceStore.getState().activeRoom?.hostId
    if (hostId && user?.id && hostId !== user.id) {
      api.get(`/social/counts/${hostId}`)
        .then(cr => {
          useVoiceStore.getState().updateRoom({ isFollowingHost: cr.data.data?.isFollowing ?? false })
        })
        .catch(() => {
          // Social endpoint unavailable — default to allowing chat
          useVoiceStore.getState().updateRoom({ isFollowingHost: true })
        })
    } else {
      // I am the host, or no host info yet — allow chat
      useVoiceStore.getState().updateRoom({ isFollowingHost: true })
    }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  const myParticipant = activeRoom?.participants.find(p => p.userId === user?.id)

  // ── Actions ─────────────────────────────────────────────────────────────────

  const toggleMute = useCallback(async () => {
    if (!roomId || !myParticipant) return
    const newMuted = !myParticipant.isMuted
    // Optimistic update — flip isMuted immediately so UI responds without waiting for socket
    useVoiceStore.getState().updateParticipant(myParticipant.userId, { isMuted: newMuted })
    try {
      await api.patch(`/voice/${roomId}/mute`, { isMuted: newMuted })
    } catch {
      // Rollback on error
      useVoiceStore.getState().updateParticipant(myParticipant.userId, { isMuted: myParticipant.isMuted })
      toast({ title: 'Failed to toggle mute', variant: 'destructive' })
    }
  }, [roomId, myParticipant?.userId, myParticipant?.isMuted]) // eslint-disable-line

  const raiseHand = useCallback(async () => {
    if (!roomId || !myParticipant) return
    try {
      if (myParticipant.handRaised) {
        await api.delete(`/voice/${roomId}/queue/cancel`)
      } else {
        await api.post(`/voice/${roomId}/queue/raise`)
      }
    } catch {
      toast({ title: 'Failed to raise hand', variant: 'destructive' })
    }
  }, [roomId, myParticipant]) // eslint-disable-line

  const sendMessage = useCallback(async (body: string) => {
    if (!roomId || !body.trim()) return
    try {
      await api.post(`/voice/${roomId}/messages`, { body })
    } catch {
      // Phase 6: buffer for offline replay
      voiceOfflineBuffer.enqueue('voice:message', { roomId, body })
      toast({ title: 'Failed to send message', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const promoteUser = useCallback(async (targetUserId: string, role: 'SPEAKER' | 'AUDIENCE') => {
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/promote`, { targetUserId, role })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to update role', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  // Approve a queued participant (from the Hands queue) via the dedicated queue approve endpoint.
  // This handles BOTH normal users (AUDIENCE→SPEAKER) AND moderators (MODERATOR→unmuted with seat).
  // The PATCH /promote endpoint only handles AUDIENCE→SPEAKER and would reject MODERATOR targets.
  const approveQueueUser = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/queue/approve/${targetUserId}`)
      // Optimistic update: clear the hand-raised state immediately so the host's
      // UI shows the approval without waiting for the socket round-trip.
      // The subsequent voice:role_changed / voice:stage_state events will set the
      // correct seat and role; this just clears the ✋ badge immediately.
      useVoiceStore.getState().updateParticipant(targetUserId, {
        handRaised: false,
        handRaisedAt: null,
      })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to approve speaker', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const kickUser = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.delete(`/voice/${roomId}/kick/${targetUserId}`)
    } catch {
      toast({ title: 'Failed to remove user', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const banUser = useCallback(async (targetUserId: string, reason?: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/ban/${targetUserId}`, { reason: reason || '' })
      toast({ title: '⛔ Participant banned from room' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to ban user', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const unbanUser = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.delete(`/voice/${roomId}/ban/${targetUserId}`)
      toast({ title: '✅ Participant unbanned' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to unban user', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const muteUser = useCallback(async (targetUserId: string, isMuted: boolean) => {
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/mute`, { targetUserId, isMuted })
    } catch {
      toast({ title: 'Failed to mute user', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const muteAll = useCallback(async () => {
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/mute-all`)
      // Optimistic update: mute all SPEAKER and MODERATOR participants in the local store.
      // The socket voice:mute_changed events will arrive shortly and reconcile any discrepancy.
      const myId = useAuthStore.getState().user?.id
      const participants = useVoiceStore.getState().activeRoom?.participants ?? []
      participants.forEach(p => {
        if (p.userId !== myId && (p.role === VOICE_ROLES.SPEAKER || p.role === VOICE_ROLES.MODERATOR) && !p.isMuted) {
          useVoiceStore.getState().updateParticipant(p.userId, { isMuted: true, mutedByModerator: true })
        }
      })
      toast({ title: '🔇 All speakers muted' })
    } catch {
      toast({ title: 'Failed to mute all', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const unmuteAll = useCallback(async () => {
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/unmute-all`)
      // Optimistic update: unmute all SPEAKER and MODERATOR participants in the local store.
      const myId = useAuthStore.getState().user?.id
      const participants = useVoiceStore.getState().activeRoom?.participants ?? []
      participants.forEach(p => {
        if (p.userId !== myId && (p.role === VOICE_ROLES.SPEAKER || p.role === VOICE_ROLES.MODERATOR) && p.isMuted) {
          useVoiceStore.getState().updateParticipant(p.userId, { isMuted: false, mutedByModerator: false })
        }
      })
      toast({ title: '🎙️ All speakers unmuted' })
    } catch {
      toast({ title: 'Failed to unmute all', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const assignModerator = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/moderator/${targetUserId}`)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to assign moderator', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const removeModerator = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.delete(`/voice/${roomId}/moderator/${targetUserId}`)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to remove moderator', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const pinSpeaker = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/pin/${targetUserId}`)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to pin speaker', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const transferAdmin = useCallback(async (targetUserId: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/transfer/${targetUserId}`)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to transfer ownership', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const endRoom = useCallback(async () => {
    // PERMANENT ROOMS: This function is reserved for SUPER_ADMIN platform admins only.
    // Regular hosts cannot terminate rooms — the room stays alive when they leave.
    // This function is intentionally kept in the hook for admin tooling but should
    // NOT be called from any regular host UI.
    if (!roomId) return
    try {
      await api.patch(`/voice/${roomId}/end`)
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to archive room'
      toast({ title: msg, variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const broadcastReaction = useCallback((emoji: string) => {
    if (!roomId) return
    const socket = getSocket()
    if (socket) socket.emit('voice:reaction', { roomId, emoji })
  }, [roomId])

  const broadcastSpeaking = useCallback((speaking: boolean) => {
    if (!roomId) return
    const socket = getSocket()
    if (socket) socket.emit('voice:speaking', { roomId, speaking })
  }, [roomId])

  const passMic = useCallback(async (targetUserId: string) => {
    if (!roomId) return null
    try {
      const res = await api.post(`/voice/${roomId}/mic-pass/${targetUserId}`)
      toast({
        title: `🎙️ Mic offer sent`,
        description: res.data.data?.targetName
          ? `Waiting for ${res.data.data.targetName} to accept (30s)`
          : 'Waiting for acceptance'
      })
      return res.data.data as { offerId: string; targetName: string; expiresIn: number }
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to pass mic', variant: 'destructive' })
      return null
    }
  }, [roomId]) // eslint-disable-line

  const acceptMic = useCallback(async (offerId: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/mic-pass/${offerId}/accept`)
      clearPendingMicOffer()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to accept mic', variant: 'destructive' })
      clearPendingMicOffer()
    }
  }, [roomId]) // eslint-disable-line

  const declineMic = useCallback(async (offerId: string) => {
    if (!roomId) return
    try {
      await api.post(`/voice/${roomId}/mic-pass/${offerId}/decline`)
      clearPendingMicOffer()
    } catch {
      clearPendingMicOffer()
    }
  }, [roomId]) // eslint-disable-line

  const cancelMicOffer = useCallback(async (offerId: string) => {
    if (!roomId) return
    try {
      await api.delete(`/voice/${roomId}/mic-pass/${offerId}`)
    } catch {
      toast({ title: 'Failed to cancel mic offer', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const toggleOpenMic = useCallback(async (enabled?: boolean) => {
    if (!roomId) return
    try {
      const res = await api.patch(`/voice/${roomId}/open-mic`,
        enabled !== undefined ? { enabled } : {}
      )
      const state = res.data.data?.isOpenMic
      toast({ title: state ? '🎙️ Open Mic ON' : '🔒 Open Mic OFF' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to toggle Open Mic', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const toggleMicLock = useCallback(async (locked?: boolean) => {
    if (!roomId) return
    try {
      const res = await api.patch(`/voice/${roomId}/mic-lock`,
        locked !== undefined ? { locked } : {}
      )
      const state = res.data.data?.micLocked
      // Optimistic update: reflect the new micLocked state immediately in the store
      // so the host's own UI updates without waiting for the socket event.
      useVoiceStore.getState().updateRoom({ micLocked: state })
      toast({ title: state ? '🔒 Mic Locked' : '🔓 Mic Unlocked' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to toggle Mic Lock', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const toggleSeatLock = useCallback(async (seatIndex: number) => {
    if (!roomId) return
    try {
      const res = await api.patch(`/voice/${roomId}/seat-lock`, { seatIndex })
      const { locked, lockedSeats } = res.data.data ?? {}
      useVoiceStore.getState().updateRoom({ lockedSeats: lockedSeats ?? [] })
      toast({ title: locked ? `🔒 Seat ${seatIndex + 1} locked` : `🔓 Seat ${seatIndex + 1} unlocked` })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to toggle seat lock', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  const grabMic = useCallback(async () => {
    if (!roomId) return
    // If mic is locked by host, block attempt and notify user
    if (useVoiceStore.getState().activeRoom?.micLocked) {
      toast({ title: '🔒 Mic is locked', description: 'The host has locked the mic — wait for it to be unlocked', variant: 'destructive' })
      return
    }
    try {
      const res = await api.post(`/voice/${roomId}/grab-mic`)
      const { queued, position, role, seatNumber, isMuted } = res.data.data ?? {}
      if (queued) {
        // Queued because open-mic is off or stage is full
        const activeRoom = useVoiceStore.getState().activeRoom
        const reason = activeRoom?.isOpenMic === false
          ? 'Raise Hand is on — the host will approve you when ready.'
          : 'You\'ll be promoted automatically when a slot opens.'
        toast({
          title: `✋ You're #${position ?? '?'} in the queue`,
          description: reason,
        })
      } else {
        // Optimistic update — apply role + seatNumber immediately from the API
        // response so the seat grid renders without waiting for socket round-trip.
        // The subsequent voice:mic_grabbed / voice:role_changed / voice:stage_state
        // events will reconcile any discrepancy.
        const myUserId = require('@/store/auth.store').useAuthStore.getState().user?.id
        if (myUserId && seatNumber != null) {
          useVoiceStore.getState().updateParticipant(myUserId, {
            role:        asRole(role ?? 'SPEAKER'),
            isMuted:     false,
            seatNumber:  Number(seatNumber),
            handRaised:  false,
            handRaisedAt: null,
          })
        }
        toast({ title: '🎙️ You\'re on stage!', description: 'Your mic is now active.' })
      }
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to take mic', variant: 'destructive' })
    }
  }, [roomId]) // eslint-disable-line

  // Drop mic — HOST/MOD go to audience (keep role, just muted); SPEAKER → AUDIENCE
  const dropMic = useCallback(async () => {
    if (!roomId || !myParticipant) return
    try {
      // Optimistic update — immediately reflect the change in the UI
      // HOST/MOD: set isMuted=true (they stay HOST/MOD but move to audience section)
      // SPEAKER: set role=AUDIENCE, isMuted=true
      const isHostOrMod = myParticipant.role === VOICE_ROLES.HOST || myParticipant.role === VOICE_ROLES.MODERATOR
      if (isHostOrMod) {
        // BUG-011 FIX: Include seatNumber:null so the stage grid clears immediately.
        // HOST/MOD drop mic stays in their role but releases their seat.
        useVoiceStore.getState().updateParticipant(myParticipant.userId, { isMuted: true, seatNumber: null })
      } else {
        // BUG-011 FIX: Include seatNumber:null — SPEAKER demoted to AUDIENCE releases seat.
        useVoiceStore.getState().updateParticipant(myParticipant.userId, {
          role: VOICE_ROLES.AUDIENCE,
          isMuted: true,
          seatNumber: null,
        })
      }
      await api.post(`/voice/${roomId}/drop-mic`)
      toast({ title: '⬇️ Mic ended', description: 'You are now in the audience.' })
    } catch (e: any) {
      // Rollback optimistic update on error
      if (myParticipant) {
        useVoiceStore.getState().updateParticipant(myParticipant.userId, {
          role: myParticipant.role,
          isMuted: myParticipant.isMuted,
        })
      }
      toast({ title: e?.response?.data?.message || 'Failed to end mic', variant: 'destructive' })
    }
  }, [roomId, myParticipant]) // eslint-disable-line

  // ── Send gift ────────────────────────────────────────────────────────────────
  const sendGift = useCallback(async (
    giftId: string,
    receiverId: string,
    count = 1,
    idempotencyKey?: string
  ) => {
    if (!roomId) return null
    try {
      const res = await api.post(`/voice/${roomId}/gifts`, {
        giftId, receiverId, count,
        idempotencyKey: idempotencyKey || `${Date.now()}-${giftId}-${receiverId}`
      })
      const { senderCoinsRemaining } = res.data.data ?? {}
      if (senderCoinsRemaining !== undefined) {
        useVoiceStore.getState().setWallet({
          coins:    senderCoinsRemaining,
          diamonds: useVoiceStore.getState().wallet?.diamonds ?? 0
        })
      }
      return res.data.data
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to send gift'
      toast({ title: msg, variant: 'destructive' })
      return null
    }
  }, [roomId]) // eslint-disable-line

  // ── Send gift to ALL speakers on stage ───────────────────────────────────────
  const sendGiftToAll = useCallback(async (
    giftId: string,
    count = 1,
    idempotencyKey?: string
  ) => {
    if (!roomId) return null
    try {
      const res = await api.post(`/voice/${roomId}/gifts/all`, {
        giftId, count,
        idempotencyKey: idempotencyKey || `all-${Date.now()}-${giftId}`
      })
      const { senderCoinsRemaining, receiverCount } = res.data.data ?? {}
      if (senderCoinsRemaining !== undefined) {
        useVoiceStore.getState().setWallet({
          coins:    senderCoinsRemaining,
          diamonds: useVoiceStore.getState().wallet?.diamonds ?? 0
        })
      }
      return res.data.data
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to send gift to all'
      toast({ title: msg, variant: 'destructive' })
      return null
    }
  }, [roomId]) // eslint-disable-line

  return {
    myParticipant,
    // Self controls
    toggleMute, raiseHand, sendMessage,
    broadcastReaction, broadcastSpeaking,
    // Open Mic
    grabMic, dropMic, toggleOpenMic, toggleMicLock, toggleSeatLock,
    // Mic pass
    passMic, acceptMic, declineMic, cancelMicOffer,
    // Gift system
    sendGift, sendGiftToAll,
    // Moderator controls (HOST + MODERATOR)
    promoteUser, kickUser, banUser, unbanUser, muteUser, muteAll, unmuteAll,
    // Queue approve — use this for Hands queue approvals (handles MODERATOR targets correctly)
    approveQueueUser,
    // Host-only controls
    assignModerator, removeModerator, transferAdmin, endRoom,
    // Host + Mod controls
    pinSpeaker
  }
}
