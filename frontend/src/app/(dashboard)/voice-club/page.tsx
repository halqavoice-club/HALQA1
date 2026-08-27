'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useVoiceStore, VoiceRoom, VoiceRoomPrivacy } from '@/store/voice.store'
import { useToast } from '@/components/ui/use-toast'
import { useDebounce } from '@/hooks/useDebounce'
import { getSocket } from '@/lib/socket'
import { VoiceRoomCard } from '@/components/voice/VoiceRoomCard'
import { RoomListSkeleton } from '@/components/skeletons/RoomListSkeleton'
// FE-002: Use the error-boundary-wrapped version
import { VoiceRoomWithBoundary } from '@/components/voice/VoiceRoomWithBoundary'
import { CreateRoomModal } from '@/components/voice/CreateRoomModal'
import { EditRoomModal } from '@/components/voice/EditRoomModal'
import {
  Mic, Plus, Radio, Globe, Lock, UserCheck, Search, X,
  BarChart2, Settings, Trash2, LogIn, Clock, CheckCircle2
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Scheduled Room Countdown ─────────────────────────────────────────────────
function ScheduledCountdown({ scheduledAt }: { scheduledAt: string }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const compute = () => {
      const diff = new Date(scheduledAt).getTime() - Date.now()
      if (diff <= 0) { setTimeLeft('Starting now…'); return }
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      if (h > 0) setTimeLeft(`${h}h ${m}m`)
      else if (m > 0) setTimeLeft(`${m}m ${s}s`)
      else setTimeLeft(`${s}s`)
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [scheduledAt])

  return (
    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1">
      <Clock className="w-3 h-3" />
      {timeLeft}
    </span>
  )
}

const PRIVACY_FILTERS = [
  { value: 'all',         label: 'All',         icon: Globe },
  { value: 'PUBLIC',      label: 'Public',      icon: Globe },
  { value: 'PRIVATE',     label: 'Private',     icon: Lock },
  { value: 'INVITE_ONLY', label: 'Invite Only', icon: UserCheck },
]

const STATUS_COLORS: Record<string, string> = {
  LIVE:      'bg-red-100 text-red-600',
  IDLE:      'bg-amber-50 text-amber-600',    // Offline/sleeping — can be rejoined
  SCHEDULED: 'bg-blue-100 text-blue-600',
  ENDED:     'bg-gray-100 text-gray-400',     // Archived — cannot be rejoined
}

const STATUS_ICONS: Record<string, React.ElementType> = {
  LIVE:      Radio,
  IDLE:      Clock,
  SCHEDULED: Clock,
  ENDED:     CheckCircle2,
}

// Human-readable label — IDLE = "Offline", ENDED = "Archived"
const STATUS_LABELS: Record<string, string> = {
  LIVE:      'LIVE',
  IDLE:      'Offline',
  SCHEDULED: 'Scheduled',
  ENDED:     'Archived',
}

export default function VoiceClubPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { activeRoom, setActiveRoom } = useVoiceStore()
  const resetRoom = useVoiceStore(s => s.resetRoom)

  // Clean up all room-scoped store state when navigating away from this page
  useEffect(() => () => resetRoom(), [resetRoom])

  const [tab, setTab]                   = useState<'discover' | 'my-rooms'>('discover')
  const [privacyFilter, setPrivacyFilter] = useState('all')
  const [showCreate, setShowCreate]     = useState(false)
  const [editRoom, setEditRoom]         = useState<VoiceRoom | null>(null)
  const [joiningId, setJoiningId]       = useState<string | null>(null)
  const [deletingId, setDeletingId]     = useState<string | null>(null)
  const [searchQuery, setSearchQuery]   = useState('')
  const debouncedSearch = useDebounce(searchQuery, 350)

  // ── Discover query ──────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['voice-rooms', privacyFilter],
    queryFn: () => api.get('/voice', {
      params: { ...(privacyFilter !== 'all' && { privacy: privacyFilter }), limit: 50 }
    }).then(r => r.data.data as VoiceRoom[]),
    refetchInterval: 60000,
    enabled: !debouncedSearch && tab === 'discover'
  })

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ['voice-search', debouncedSearch],
    queryFn: () => api.get('/voice/search', { params: { q: debouncedSearch } })
      .then(r => r.data.data as VoiceRoom[]),
    enabled: !!debouncedSearch
  })

  // ── My Rooms query ──────────────────────────────────────────────────────────
  const { data: myRooms, isLoading: myRoomsLoading, refetch: refetchMy } = useQuery({
    queryKey: ['voice-my-rooms'],
    queryFn: () => api.get('/voice/my').then(r => r.data.data as VoiceRoom[]),
    enabled: tab === 'my-rooms'
  })

  const rooms = debouncedSearch ? (searchData || []) : (data || [])
  const loading = debouncedSearch ? searchLoading : isLoading

  // ── Real-time lobby updates via socket ──────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    // New room created by anyone in the school
    const onRoomCreated = (room: VoiceRoom) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms', privacyFilter], old => {
        if (!old) return [room]
        if (old.some(r => r.id === room.id)) return old
        return [room, ...old]
      })
    }

    // Room status changed (SCHEDULED → LIVE is the only transition now)
    const onStatusChanged = (data: { roomId: string; status: string }) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms', privacyFilter], old =>
        old ? old.map(r => r.id === data.roomId ? { ...r, status: data.status as VoiceRoom['status'] } : r) : old
      )
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms'], old =>
        old ? old.map(r => r.id === data.roomId ? { ...r, status: data.status as VoiceRoom['status'] } : r) : old
      )
    }

    // Room deleted (from My Rooms) — remove from lobby
    const onRoomDeleted = (data: { roomId: string }) => {
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms', privacyFilter], old =>
        old ? old.filter(r => r.id !== data.roomId) : old
      )
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms'], old =>
        old ? old.filter(r => r.id !== data.roomId) : old
      )
    }

    // Room details updated (title, topic, cover image, etc.)
    const onRoomUpdated = (data: {
      roomId: string; title: string; description: string | null
      topic: string | null; privacy: string; coverEmoji: string
      coverImageUrl?: string | null
      commentsEnabled?: boolean; slowMode?: boolean; messageType?: string
      reactionsEnabled?: boolean; micLocked?: boolean; isOpenMic?: boolean
    }) => {
      const patch = (old: VoiceRoom[] | undefined) =>
        old ? old.map(r => r.id === data.roomId
          ? {
              ...r,
              title:            data.title,
              description:      data.description,
              topic:            data.topic,
              privacy:          data.privacy as VoiceRoomPrivacy,
              coverEmoji:       data.coverEmoji,
              coverImageUrl:    data.coverImageUrl,
              ...(data.commentsEnabled  !== undefined && { commentsEnabled:  data.commentsEnabled }),
              ...(data.reactionsEnabled !== undefined && { reactionsEnabled: data.reactionsEnabled }),
              ...(data.slowMode         !== undefined && { slowMode:         data.slowMode }),
              ...(data.messageType      !== undefined && { messageType:      data.messageType as VoiceRoom['messageType'] }),
              ...(data.micLocked        !== undefined && { micLocked:        data.micLocked }),
              ...(data.isOpenMic        !== undefined && { isOpenMic:        data.isOpenMic }),
            }
          : r
        ) : old
      queryClient.setQueryData<VoiceRoom[]>(['voice-rooms', privacyFilter], patch)
      queryClient.setQueryData<VoiceRoom[]>(['voice-my-rooms'], patch)
    }

    socket.on('voice:room_created',   onRoomCreated)
    socket.on('voice:status_changed', onStatusChanged)
    socket.on('voice:room_deleted',   onRoomDeleted)
    socket.on('voice:room_updated',   onRoomUpdated)

    return () => {
      socket.off('voice:room_created',   onRoomCreated)
      socket.off('voice:status_changed', onStatusChanged)
      socket.off('voice:room_deleted',   onRoomDeleted)
      socket.off('voice:room_updated',   onRoomUpdated)
    }
  }, [queryClient, privacyFilter]) // eslint-disable-line

  const sortedRooms = [...rooms].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  )

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleJoin = async (room: VoiceRoom) => {
    setJoiningId(room.id)
    try {
      const res = await api.post(`/voice/${room.id}/join`)
      setActiveRoom(res.data.data)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to join room', variant: 'destructive' })
    } finally {
      setJoiningId(null)
    }
  }

  const handleCreate = async (data: {
    title: string; description?: string; privacy: string; topic?: string; coverEmoji?: string
  }) => {
    try {
      const res = await api.post('/voice', data)
      setActiveRoom(res.data.data)
      setShowCreate(false)
      queryClient.invalidateQueries({ queryKey: ['voice-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['voice-my-rooms'] })
      toast({ title: "🎙️ Room created! You're live." })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to create room', variant: 'destructive' })
    }
  }

  const handleSaveEdit = async (id: string, data: {
    title?: string; description?: string; topic?: string; privacy?: string; coverEmoji?: string
  }) => {
    try {
      await api.patch(`/voice/${id}`, data)
      queryClient.invalidateQueries({ queryKey: ['voice-my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['voice-rooms'] })
      toast({ title: '✅ Room updated' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to update room', variant: 'destructive' })
      throw e
    }
  }

  const handleDelete = async (room: VoiceRoom) => {
    // Rooms are permanent — "delete" here is an explicit archive action by the owner.
    // The room is soft-deleted (deletedAt set) and can no longer be joined.
    if (!confirm(`Archive "${room.title}"?\n\nThis will permanently archive the room. Members can no longer join it. This cannot be undone.`)) return
    setDeletingId(room.id)
    try {
      await api.delete(`/voice/${room.id}`)
      queryClient.invalidateQueries({ queryKey: ['voice-my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['voice-rooms'] })
      toast({ title: '🗄️ Room archived' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to archive room', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  // ── Active room view ────────────────────────────────────────────────────────
  if (activeRoom) {
    return (
      <div className="-m-4 md:-m-6 min-h-screen bg-[#f0f4ff]">
        <VoiceRoomWithBoundary onLeave={() => {
          setActiveRoom(null)
          refetch()
          refetchMy()
        }} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-md">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Voice Club</h1>
            <p className="text-xs text-gray-400">Live audio rooms</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/voice-club/stats">
            <button className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-sm font-medium transition-colors">
              <BarChart2 className="w-4 h-4" />
              <span className="hidden sm:inline">Stats</span>
            </button>
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-md"
          >
            <Plus className="w-4 h-4" />
            Start Room
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        <button
          onClick={() => setTab('discover')}
          className={cn(
            'flex-1 py-2 text-sm font-semibold rounded-lg transition-all',
            tab === 'discover' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          🔍 Discover
        </button>
        <button
          onClick={() => setTab('my-rooms')}
          className={cn(
            'flex-1 py-2 text-sm font-semibold rounded-lg transition-all',
            tab === 'my-rooms' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          🎙️ My Rooms
          {myRooms && myRooms.filter(r => r.status !== 'ENDED').length > 0 && (
            <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold">
              {myRooms.filter(r => r.status !== 'ENDED').length}
            </span>
          )}        </button>
      </div>

      {/* ── DISCOVER TAB ─────────────────────────────────────────────────────── */}
      {tab === 'discover' && (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search rooms…"
              className="w-full pl-9 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Privacy filters */}
          {!debouncedSearch && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {PRIVACY_FILTERS.map(f => {
                const Icon = f.icon
                return (
                  <button
                    key={f.value}
                    onClick={() => setPrivacyFilter(f.value)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0',
                      privacyFilter === f.value ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {f.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Joinable room count */}
          {!debouncedSearch && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="font-semibold text-red-600">
                {sortedRooms.filter(r => r.status === 'LIVE').length} live
              </span>
              {sortedRooms.filter(r => r.status === 'IDLE').length > 0 && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-amber-600">
                    {sortedRooms.filter(r => r.status === 'IDLE').length} offline
                  </span>
                </>
              )}
              <span>rooms</span>
            </div>
          )}

          {/* Room grid */}
          {loading ? (
            <RoomListSkeleton count={4} />
          ) : sortedRooms.length === 0 ? (
            debouncedSearch ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <p className="font-semibold text-gray-500">No rooms matching &quot;{debouncedSearch}&quot;</p>
              </div>
            ) : (
              <EmptyState
                icon={Radio}
                title="No rooms yet"
                description="Be the first to start a conversation"
                action={{ label: 'Start a Room', onClick: () => setShowCreate(true) }}
              />
            )
          ) : (
            <AnimatePresence>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sortedRooms.map((room, i) => (
                  <motion.div key={room.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    {room.status === 'SCHEDULED' && room.scheduledAt && (
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <ScheduledCountdown scheduledAt={room.scheduledAt} />
                        <span className="text-[11px] text-gray-400">
                          {new Date(room.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                    <VoiceRoomCard
                      room={room}
                      onJoin={() => handleJoin(room)}
                      isJoining={joiningId === room.id}
                      currentUserId={user?.id || ''}
                    />
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </>
      )}

      {/* ── MY ROOMS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'my-rooms' && (
        <>
          {myRoomsLoading ? (
            <RoomListSkeleton count={3} />
          ) : !myRooms || myRooms.length === 0 ? (
            <EmptyState
              icon={Mic}
              title="No rooms yet"
              description="Create your first voice room"
              action={{ label: 'Start a Room', onClick: () => setShowCreate(true) }}
            />
          ) : (
            <div className="space-y-3">
              {myRooms.map((room, i) => {
                const StatusIcon = STATUS_ICONS[room.status] ?? Radio
                const activeCount = room._count?.participants ?? 0
                // Rooms are PERMANENT — ENDED only when explicitly archived (soft-deleted).
                // IDLE rooms can always be rejoined — they are NOT "ended".
                const isArchived = room.status === 'ENDED'
                const isDeleting = deletingId === room.id

                return (
                  <motion.div
                    key={room.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={cn(
                      'bg-white rounded-2xl border p-4 transition-all',
                      isArchived ? 'border-gray-100 opacity-60' : 'border-gray-100 hover:border-purple-200 hover:shadow-sm'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Emoji */}
                      <span className="text-2xl flex-shrink-0 mt-0.5">{room.coverEmoji || '🎙️'}</span>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 text-sm truncate">{room.title}</h3>
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1', STATUS_COLORS[room.status])}>
                            <StatusIcon className="w-2.5 h-2.5" />
                            {STATUS_LABELS[room.status] ?? room.status}
                          </span>
                          {room.status === 'SCHEDULED' && room.scheduledAt && (
                            <ScheduledCountdown scheduledAt={room.scheduledAt} />
                          )}
                        </div>
                        {room.topic && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{room.topic}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Mic className="w-3 h-3" />
                            {activeCount} active
                          </span>
                          <span className="capitalize">{room.privacy.replace('_', ' ').toLowerCase()}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Enter / Rejoin — IDLE rooms can always be entered (permanent) */}
                        {!isArchived && (
                          <button
                            onClick={() => handleJoin(room)}
                            disabled={joiningId === room.id}
                            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white rounded-xl text-xs font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50"
                          >
                            <LogIn className="w-3 h-3" />
                            {room.status === 'LIVE' ? 'Join' : 'Enter'}
                          </button>
                        )}

                        {/* Edit */}
                        {!isArchived && (
                          <button
                            onClick={() => setEditRoom(room)}
                            className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Edit room"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        )}

                        {/* Archive (soft-delete) — shown for all rooms including IDLE */}
                        <button
                          onClick={() => handleDelete(room)}
                          disabled={isDeleting}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Archive room (permanent)"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <CreateRoomModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      <EditRoomModal
        open={!!editRoom}
        room={editRoom}
        onClose={() => setEditRoom(null)}
        onSave={handleSaveEdit}
      />
    </div>
  )
}
