'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useVoiceStore, VoiceRoom } from '@/store/voice.store'
import { useToast } from '@/components/ui/use-toast'
import { getSocket } from '@/lib/socket'
// FE-002: Use the error-boundary-wrapped version so LiveKit/SDK crashes
// show a recovery UI instead of crashing the entire page.
import { VoiceRoomWithBoundary } from '@/components/voice/VoiceRoomWithBoundary'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import { Mic, Users, Lock, Globe, UserCheck, ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const PRIVACY_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  PUBLIC:      { label: 'Public',      icon: Globe,      color: 'text-green-600 bg-green-50' },
  PRIVATE:     { label: 'Private',     icon: Lock,       color: 'text-orange-600 bg-orange-50' },
  INVITE_ONLY: { label: 'Invite Only', icon: UserCheck,  color: 'text-blue-600 bg-blue-50' },
}

export default function VoiceRoomPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const {
    activeRoom, setActiveRoom, resetRoom,
    _liveKitDisconnect,
  } = useVoiceStore()

  // Clean up all room-scoped store state when navigating away from this page
  useEffect(() => () => resetRoom(), [resetRoom])

  const [room, setRoom]       = useState<VoiceRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // P0-A FIX: Register an early voice:stage_state listener on mount (before
  // the user clicks Join and before useVoiceRoom mounts). Any snapshot events
  // that arrive during the race window between POST /join returning and
  // useVoiceRoom registering its own listener are buffered in the store.
  // useVoiceRoom drains this buffer after all listeners are registered.
  useEffect(() => {
    if (!id) return
    const socket = getSocket()
    if (!socket) return
    const earlyStageHandler = (payload: {
      roomId: string
      stageParticipants: Array<{
        userId: string; role: string; isMuted: boolean; seatNumber: number | null
        isPinned: boolean; handRaised: boolean; mutedByModerator: boolean
        joinedAt: string; firstName?: string | null; lastName?: string | null; avatarUrl?: string | null
      }>
      stageCount: number
    }) => {
      if (payload.roomId !== id) return
      useVoiceStore.getState().pushSyncEvent(payload)
    }

    // Buffer voice:user_joined events that arrive before useVoiceRoom mounts.
    // Without this buffer, new joiners are invisible to existing room members
    // until they refresh — the event fires during the race window between
    // POST /join completing and useVoiceRoom registering its listener.
    const earlyUserJoinedHandler = (payload: {
      roomId: string; userId: string; firstName: string; lastName: string
      avatarUrl: string | null; role: string; isMuted?: boolean
      mutedByModerator?: boolean; handRaised?: boolean; handRaisedAt?: string
      isPinned?: boolean; seatNumber?: number | null; joinedAt?: string
    }) => {
      if (payload.roomId !== id) return
      useVoiceStore.getState().pushUserJoinedEvent(payload)
    }

    // Buffer voice:queue_updated events that arrive before useVoiceRoom mounts.
    // Without this buffer, host/mod do not see new raised-hand queue entries
    // until they refresh.
    const earlyQueueUpdatedHandler = (payload: {
      roomId: string
      queue: Array<{ userId: string; firstName: string; lastName: string; avatarUrl: string | null; raisedAt: string }>
      queueLength: number
    }) => {
      if (payload.roomId !== id) return
      useVoiceStore.getState().pushQueueUpdatedEvent(payload)
    }

    socket.on('voice:stage_state',   earlyStageHandler)
    socket.on('voice:user_joined',   earlyUserJoinedHandler)
    socket.on('voice:queue_updated', earlyQueueUpdatedHandler)
    return () => {
      socket.off('voice:stage_state',   earlyStageHandler)
      socket.off('voice:user_joined',   earlyUserJoinedHandler)
      socket.off('voice:queue_updated', earlyQueueUpdatedHandler)
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Active-session conflict state — shown when user tries to join while in another room.
  // conflictRoom holds the full metadata of room B returned by the 409 response.
  const [conflictRoom, setConflictRoom] = useState<{
    id: string; title: string; emoji: string; topic: string | null
  } | null>(null)
  const [leavingConflict, setLeavingConflict] = useState(false)

  // Load room info
  useEffect(() => {
    if (!id) return
    api.get(`/voice/${id}`)
      .then(r => setRoom(r.data.data))
      .catch(e => setError(e?.response?.data?.message || 'Room not found'))
      .finally(() => setLoading(false))
  }, [id])

  // If already in this room, show the room view directly
  const autoJoinedRef = useRef(false)
  useEffect(() => {
    if (activeRoom?.id === id) return
    if (autoJoinedRef.current) return
    // SA-VOICE-AUTOJOIN-01: SUPER_ADMIN cannot join voice rooms as participants
    if (user?.role === 'SUPER_ADMIN') return
    // If user is already an active participant, auto-join
    if (room && user) {
      const existing = room.participants?.find(p => p.userId === user.id && p.isActive)
      if (existing) {
        autoJoinedRef.current = true
        handleJoin()
      }
    }
  }, [room, user]) // eslint-disable-line

  const handleJoin = async () => {
    if (!id) return
    setJoining(true)
    try {
      const res = await api.post(`/voice/${id}/join`)
      setActiveRoom(res.data.data)
    } catch (e: any) {
      const code = e?.response?.data?.errors?.code
      if (code === 'VOICE_ROOM_ALREADY_ACTIVE') {
        // Backend now returns full room B metadata — use it to show the user
        // exactly which room they're currently in, not the destination room.
        // The conflict data lives under response.data.errors (not response.data directly).
        setConflictRoom({
          id:    e?.response?.data?.errors?.activeRoomId    ?? '',
          title: e?.response?.data?.errors?.activeRoomTitle ?? 'another room',
          emoji: e?.response?.data?.errors?.activeRoomEmoji ?? '🎙️',
          topic: e?.response?.data?.errors?.activeRoomTopic ?? null,
        })
        setJoining(false)
        return
      }
      toast({ title: e?.response?.data?.message || 'Failed to join room', variant: 'destructive' })
      // Discard any buffered stage_state events so they don't replay on next attempt
      useVoiceStore.getState().drainSyncEvents()
      setJoining(false)
    }
  }

  // Full teardown of room B, then join room A
  const handleLeaveAndJoin = async () => {
    if (!conflictRoom || !id) return
    setLeavingConflict(true)

    // 1. Disconnect LiveKit audio from room B (stops mic, detaches audio elements)
    _liveKitDisconnect?.()

    // 2. Leave room B via API (marks voiceParticipant.isActive = false in DB)
    try {
      await api.post(`/voice/${conflictRoom.id}/leave`)
    } catch {
      // Proceed even if already gone
    }

    // 3. Leave Socket.IO voice room B so no further events arrive from B
    const socket = getSocket()
    if (socket) {
      socket.emit('voice:leave_room', conflictRoom.id)
    }

    // 4. Reset all room-scoped Zustand state (clears activeRoom, messages,
    //    participants, queue, gifts, etc.)
    resetRoom()

    setConflictRoom(null)
    setLeavingConflict(false)

    // 5. Join room A — setActiveRoom triggers VoiceRoomView to mount and
    //    connect LiveKit to A automatically
    setJoining(true)
    try {
      const res = await api.post(`/voice/${id}/join`)
      setActiveRoom(res.data.data)
      setJoining(false)
    } catch (e: any) {
      const code = e?.response?.data?.errors?.code
      if (code === 'VOICE_ROOM_ALREADY_ACTIVE') {
        // Rare race: user somehow got active in another room between leave and join.
        // Show the conflict dialog again with the new active room info.
        setConflictRoom({
          id:    e?.response?.data?.errors?.activeRoomId    ?? '',
          title: e?.response?.data?.errors?.activeRoomTitle ?? 'another room',
          emoji: e?.response?.data?.errors?.activeRoomEmoji ?? '🎙️',
          topic: e?.response?.data?.errors?.activeRoomTopic ?? null,
        })
      } else {
        toast({ title: e?.response?.data?.message || 'Failed to join room', variant: 'destructive' })
      }
      setJoining(false)
    }
  }

  // Show room view when active
  if (activeRoom?.id === id) {
    return (
      // -m-4/-m-6 removes dashboard page padding so the voice room fills the viewport.
      // MobileNav hides itself when activeRoom is set (via useVoiceStore check in mobile-nav.tsx).
      // Layout removes mobile-content-bottom padding when voice room is active.
      <div className="-m-4 md:-m-6 min-h-screen bg-[#f0f4ff]">
        <VoiceRoomWithBoundary onLeave={() => {
          setActiveRoom(null)
          router.push('/voice-club')
        }} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    )
  }

  if (error || !room) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <div className="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">🚫</span>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Room not found</h2>
        <p className="text-sm text-gray-500 mb-6">{error || 'This room may have been deleted or ended.'}</p>
        <Link href="/voice-club">
          <button className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white rounded-xl font-medium text-sm hover:bg-purple-700 transition-colors mx-auto">
            <ArrowLeft className="w-4 h-4" />
            Back to Voice Club
          </button>
        </Link>
      </div>
    )
  }

  const isEnded = room.status === 'ENDED'
  const speakers = room.participants?.filter(p =>
    p.role === 'HOST' || p.role === 'MODERATOR' || p.role === 'SPEAKER'
  ) || []
  const totalActive = room._count?.participants ?? 0
  const privacyInfo = PRIVACY_LABELS[room.privacy] ?? PRIVACY_LABELS.PUBLIC
  const PrivacyIcon = privacyInfo.icon

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      {/* ── Active-session conflict dialog ─────────────────────────────────── */}
      {conflictRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="bg-gradient-to-br from-orange-400 to-pink-500 p-6 text-white text-center">
              <span className="text-4xl">{conflictRoom.emoji}</span>
              <h2 className="text-lg font-black mt-2">You&apos;re already in a room</h2>
              <p className="text-white/90 text-sm mt-1 font-semibold">
                &ldquo;{conflictRoom.title}&rdquo;
              </p>
              {conflictRoom.topic && (
                <p className="text-white/70 text-xs mt-0.5">{conflictRoom.topic}</p>
              )}
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600 text-center">
                Leave <strong className="text-gray-900">&ldquo;{conflictRoom.title}&rdquo;</strong> and
                join <strong className="text-gray-900">&ldquo;{room?.title ?? 'this room'}&rdquo;</strong>?
              </p>
              <button
                onClick={handleLeaveAndJoin}
                disabled={leavingConflict}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-2xl font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-all"
              >
                {leavingConflict ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                {leavingConflict ? 'Leaving…' : 'Leave & Join This Room'}
              </button>
              <button
                onClick={() => setConflictRoom(null)}
                disabled={leavingConflict}
                className="w-full py-3 border border-gray-200 rounded-2xl font-semibold text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Back link */}
      <Link href="/voice-club" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Voice Club
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
      >
        {/* Room header */}
        <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-6 text-white">
          <div className="flex items-start gap-4">
            {/* Cover image or emoji */}
            {room.coverImageUrl ? (
              <img
                src={getFileUrl(room.coverImageUrl)}
                alt=""
                className="w-14 h-14 rounded-2xl object-cover flex-shrink-0 border-2 border-white/30"
              />
            ) : (
              <span className="text-4xl">{room.coverEmoji || '🎙️'}</span>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black leading-tight">{room.title}</h1>
              {room.topic && (
                <p className="text-white/80 text-sm mt-1">{room.topic}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {/* Status */}
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                  room.status === 'LIVE'
                    ? 'bg-white/20 text-white flex items-center gap-1'
                    : 'bg-white/10 text-white/70'
                )}>
                  {room.status === 'LIVE' && <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />}
                  {room.status}
                </span>
                {/* Privacy */}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/80 flex items-center gap-1">
                  <PrivacyIcon className="w-2.5 h-2.5" />
                  {privacyInfo.label}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Description */}
          {room.description && (
            <p className="text-sm text-gray-600 leading-relaxed">{room.description}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-purple-500" />
              <span><strong className="text-gray-900">{speakers.length}</strong> on stage</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-purple-500" />
              <span><strong className="text-gray-900">{totalActive}</strong> in room</span>
            </span>
          </div>

          {/* Speakers preview */}
          {speakers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">On Stage</p>
              <div className="flex flex-wrap gap-3">
                {speakers.slice(0, 8).map(p => (
                  <div key={p.userId} className="flex flex-col items-center gap-1">
                    <div className="relative w-10 h-10 rounded-full overflow-hidden bg-purple-100 flex items-center justify-center">
                      {p.user.avatarUrl
                        ? <img src={getAvatarUrl(p.user.avatarUrl)} alt="" className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-purple-600">
                            {p.user.firstName[0]}{p.user.lastName[0]}
                          </span>
                      }
                      {p.role === 'HOST' && (
                        <span className="absolute -top-0.5 -right-0.5 text-[10px]">👑</span>
                      )}
                    </div>
                    <span className="text-[9px] text-gray-500 max-w-[40px] truncate text-center">
                      {p.user.firstName}
                    </span>
                  </div>
                ))}
                {speakers.length > 8 && (
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 font-medium">
                    +{speakers.length - 8}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Host info */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
            <div className="w-7 h-7 rounded-full overflow-hidden bg-purple-100 flex items-center justify-center flex-shrink-0">
              {room.host?.avatarUrl
                ? <img src={getAvatarUrl(room.host.avatarUrl)} alt="" className="w-full h-full object-cover" />
                : <span className="text-[10px] font-bold text-purple-600">
                    {room.host?.firstName?.[0]}{room.host?.lastName?.[0]}
                  </span>
              }
            </div>
            <span className="text-xs text-gray-500">
              Hosted by <strong className="text-gray-700">{room.host?.firstName} {room.host?.lastName}</strong>
            </span>
          </div>

          {/* Join button — hidden for SUPER_ADMIN (platform admins cannot join voice rooms as participants) */}
          {isEnded ? (
            <div className="text-center py-3">
              <p className="text-sm text-gray-400 font-medium">This room has ended</p>
              <Link href="/voice-club">
                <button className="mt-3 text-sm text-purple-600 hover:text-purple-700 font-medium">
                  Browse other rooms →
                </button>
              </Link>
            </div>
          ) : user?.role === 'SUPER_ADMIN' ? (
            <div className="text-center py-3 bg-amber-50 rounded-2xl border border-amber-200">
              <p className="text-sm text-amber-700 font-semibold">Platform admins cannot join voice rooms</p>
              <p className="text-xs text-amber-600 mt-1">Use the admin panel to manage rooms</p>
              <Link href="/admin/live-voice">
                <button className="mt-3 text-sm text-amber-700 hover:text-amber-800 font-semibold underline">
                  Go to Admin Panel →
                </button>
              </Link>
            </div>
          ) : (
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-2xl font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-all shadow-md"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
              {joining ? 'Joining…' : room.status === 'LIVE' ? 'Join Room' : 'Enter Room'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
