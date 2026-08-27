'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useToast } from '@/components/ui/use-toast'
import { getSocket } from '@/lib/socket'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { useDebounce } from '@/hooks/useDebounce'
import { Plus, Video, Users, Clock, Calendar, CheckCircle, Trash2, Globe, GraduationCap } from 'lucide-react'
import Link from 'next/link'
import { CreateLiveClassModal } from '@/components/live-class/CreateLiveClassModal'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id:              string
  streamType:      'SCHOOL' | 'PUBLIC'
  title:           string
  description:     string | null
  status:          'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  scheduledAt:     string | null
  startedAt:       string | null
  endedAt:         string | null
  duration:        number | null
  chatEnabled:     boolean
  handRaiseEnabled: boolean
  quranPanelEnabled: boolean
  // SCHOOL streams have class + teacher; PUBLIC streams have hostUser
  class?:    { id: string; name: string } | null
  teacher?:  { user: { id: string; firstName: string; lastName: string; avatarUrl: string | null } } | null
  hostUser?: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
  _count:    { participants: number }
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: LiveClass['status'] }) {
  const cfg = {
    SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700' },
    LIVE:      { label: '🔴 Live',    cls: 'bg-red-100 text-red-700 animate-pulse' },
    ENDED:     { label: 'Ended',      cls: 'bg-gray-100 text-gray-500' },
    CANCELLED: { label: 'Cancelled',  cls: 'bg-orange-100 text-orange-600' },
  }[status]
  return <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', cfg.cls)}>{cfg.label}</span>
}

// ─── Stream type pill ─────────────────────────────────────────────────────────
function StreamTypePill({ streamType }: { streamType: 'SCHOOL' | 'PUBLIC' }) {
  if (streamType === 'PUBLIC') {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex items-center gap-1 w-fit">
        <Globe className="w-2.5 h-2.5" /> Public
      </span>
    )
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 flex items-center gap-1 w-fit">
      <GraduationCap className="w-2.5 h-2.5" /> Class
    </span>
  )
}

// ─── Live Class Card ──────────────────────────────────────────────────────────
function LiveClassCard({
  lc, canManage, onDelete,
}: {
  lc: LiveClass; canManage: boolean; onDelete: (id: string) => void
}) {
  const scheduled = lc.scheduledAt ? new Date(lc.scheduledAt) : null
  const canDelete  = canManage && (lc.status === 'SCHEDULED' || lc.status === 'CANCELLED')

  // Resolve host display name from whichever field is present
  const hostName = lc.teacher?.user
    ? `${lc.teacher.user.firstName} ${lc.teacher.user.lastName}`
    : lc.hostUser
    ? `${lc.hostUser.firstName} ${lc.hostUser.lastName}`
    : null

  // Context line: class name for school streams, nothing for public streams
  const contextLine = lc.streamType === 'SCHOOL' && lc.class?.name ? lc.class.name : null

  return (
    <div className="relative group">
      <Link href={`/live-class/${lc.id}`}>
        <motion.div
          whileHover={{ y: -2 }}
          className={cn(
            'bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer p-4',
            lc.status === 'LIVE' && 'border-red-200 ring-1 ring-red-200'
          )}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <StatusBadge status={lc.status} />
                <StreamTypePill streamType={lc.streamType} />
                {contextLine && (
                  <span className="text-xs text-gray-400">{contextLine}</span>
                )}
              </div>
              <h3 className="font-semibold text-gray-900 truncate">{lc.title}</h3>
              {lc.description && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{lc.description}</p>
              )}
            </div>
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
              lc.status === 'LIVE'
                ? 'bg-red-100'
                : lc.streamType === 'PUBLIC'
                ? 'bg-purple-100'
                : 'bg-indigo-100'
            )}>
              <Video className={cn(
                'w-5 h-5',
                lc.status === 'LIVE'
                  ? 'text-red-600'
                  : lc.streamType === 'PUBLIC'
                  ? 'text-purple-600'
                  : 'text-indigo-600'
              )} />
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500">
            {scheduled && lc.status === 'SCHEDULED' && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {scheduled.toLocaleDateString()} {scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {lc.duration ? `${lc.duration}m` : '∞'}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {lc._count.participants}
            </span>
            {lc.quranPanelEnabled && <span title="Quran panel">📖</span>}
          </div>

          <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
            {hostName && (
              <span className="text-xs text-gray-400 truncate">{hostName}</span>
            )}
            {lc.status === 'LIVE' && (
              <span className="text-xs font-bold text-red-600 flex items-center gap-1 ml-auto">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                {lc.streamType === 'PUBLIC' ? 'Watch now' : 'Join now'}
              </span>
            )}
            {lc.status === 'SCHEDULED' && (
              <span className="text-xs text-indigo-600 font-medium ml-auto">View →</span>
            )}
            {lc.status === 'ENDED' && (
              <span className="text-xs text-gray-400 flex items-center gap-1 ml-auto">
                <CheckCircle className="w-3 h-3" /> Completed
              </span>
            )}
          </div>
        </motion.div>
      </Link>

      {/* Delete — shown on hover for host/managers */}
      {canManage && canDelete && (
        <div className="absolute top-3 right-3 hidden group-hover:flex items-center gap-1 z-10">
          <button
            onClick={e => { e.preventDefault(); onDelete(lc.id) }}
            className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-red-50 hover:border-red-200 transition-colors"
            title="Delete"
            aria-label="Delete live class"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LiveClassPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreate, setShowCreate]   = useState(false)
  const debouncedSearch = useDebounce(search, 300)

  // Any authenticated user can go live (public stream).
  // School teachers/admins can also create school class streams.
  const canCreate = true
  // canManage: controls delete button visibility.
  // A user manages a stream if they're school staff OR the owner of a PUBLIC stream.
  // The actual enforcement is on the backend — this only affects UI visibility.
  // We check per-card in LiveClassCard using lc.hostUser?.id === user?.id for PUBLIC streams.
  const canManageByRole = isTeacher || isAdmin ||
    ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(user?.role || '')

  const { data, isLoading } = useQuery({
    queryKey: ['live-classes', statusFilter],
    queryFn: () => api.get('/live-classes', {
      params: {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 50,
      }
    }).then(r => r.data.data?.items || []),
    refetchInterval: 15_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/live-classes/${id}`),
    onSuccess: () => {
      toast({ title: 'Stream deleted' })
      queryClient.invalidateQueries({ queryKey: ['live-classes'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed to delete', variant: 'destructive' }),
  })

  const handleDelete = (id: string) => {
    if (!confirm('Delete this stream? This cannot be undone.')) return
    deleteMutation.mutate(id)
  }

  // Real-time updates — join school room AND global public stream room
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const schoolId = user?.schoolId
    if (schoolId) socket.emit('school:join', schoolId)
    socket.emit('feed:join:public')  // listen for public stream notifications

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-classes'] })
    const onStarted = (d: any) => { refresh(); toast({ title: `🔴 ${d.title} is now live!` }) }

    socket.on('liveclass:started',   onStarted)
    socket.on('liveclass:scheduled', refresh)
    socket.on('liveclass:ended',     refresh)

    return () => {
      if (schoolId) socket.emit('school:leave', schoolId)
      socket.emit('feed:leave:public')
      socket.off('liveclass:started',   onStarted)
      socket.off('liveclass:scheduled', refresh)
      socket.off('liveclass:ended',     refresh)
    }
  }, [queryClient, toast, user?.schoolId])

  const classes: LiveClass[] = data || []

  // Per-card manage right: staff roles OR the user owns this PUBLIC stream
  const canManageCard = (lc: LiveClass) =>
    canManageByRole ||
    (lc.streamType === 'PUBLIC' && lc.hostUser?.id === user?.id)

  // Client-side search filter
  const filtered = classes.filter(lc =>
    !debouncedSearch ||
    lc.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (lc.class?.name || '').toLowerCase().includes(debouncedSearch.toLowerCase())
  )

  const live      = filtered.filter(lc => lc.status === 'LIVE')
  const scheduled = filtered.filter(lc => lc.status === 'SCHEDULED')
  const past      = filtered.filter(lc => lc.status === 'ENDED' || lc.status === 'CANCELLED')

  // Split live/scheduled by stream type for section display
  const livePublic  = live.filter(lc => lc.streamType === 'PUBLIC')
  const liveSchool  = live.filter(lc => lc.streamType === 'SCHOOL')

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Video className="w-6 h-6 text-indigo-600" /> Live
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {live.length > 0
              ? `${live.length} stream${live.length > 1 ? 's' : ''} live now`
              : 'Public streams & school classes'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/live-class/camera-test">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs text-gray-500 hidden sm:flex">
              📷 Camera Test
            </Button>
          </Link>
          {canCreate && (
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 gap-2"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="w-4 h-4" /> Go Live
            </Button>
          )}
        </div>
      </div>

      {/* Search + status filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search streams..."
            isLoading={isLoading && !!search}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {['all', 'LIVE', 'SCHEDULED', 'ENDED'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-2 rounded-xl text-xs font-semibold transition-colors',
                statusFilter === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border text-gray-600 hover:bg-gray-50'
              )}
            >
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Video className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {search ? `No streams matching "${search}"` : 'No live streams yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Anyone can go live — no school required.
          </p>
          {canCreate && !search && (
            <Button
              className="mt-4 bg-indigo-600 hover:bg-indigo-700"
              onClick={() => setShowCreate(true)}
            >
              Start Your First Stream
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Live now — public streams first */}
          {livePublic.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                Public Streams Live
              </h2>
              <div className="space-y-3">
                {livePublic.map(lc => (
                  <LiveClassCard key={lc.id} lc={lc} canManage={canManageCard(lc)} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          )}

          {/* Live now — school classes */}
          {liveSchool.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                School Classes Live
              </h2>
              <div className="space-y-3">
                {liveSchool.map(lc => (
                  <LiveClassCard key={lc.id} lc={lc} canManage={canManageCard(lc)} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          )}

          {/* Upcoming */}
          {scheduled.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Upcoming</h2>
              <div className="space-y-3">
                {scheduled.map(lc => (
                  <LiveClassCard key={lc.id} lc={lc} canManage={canManageCard(lc)} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          )}

          {/* Past */}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Past</h2>
              <div className="space-y-3">
                {past.map(lc => (
                  <LiveClassCard key={lc.id} lc={lc} canManage={canManageCard(lc)} onDelete={handleDelete} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <CreateLiveClassModal
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false)
              queryClient.invalidateQueries({ queryKey: ['live-classes'] })
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
