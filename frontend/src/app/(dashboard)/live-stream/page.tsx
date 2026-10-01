'use client'

/**
 * /live-stream — Public Live Stream browse page
 *
 * Dedicated browse page for PUBLIC streams only (streamType = 'PUBLIC').
 * Shows all public streams with real-time viewer counts, sorted by live first.
 * Anyone (any authenticated user) can go live from this page.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getSocket } from '@/lib/socket'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { useDebounce } from '@/hooks/useDebounce'
import { Plus, Radio, Users, Clock, Calendar, Globe, Trash2, Pencil, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { getFileUrl } from '@/lib/avatar'
import { CreateLiveClassModal } from '@/components/live-class/CreateLiveClassModal'
import { EditLiveClassModal } from '@/components/live-class/EditLiveClassModal'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PublicStream {
  id:            string
  streamType:    'PUBLIC'
  title:         string
  description:   string | null
  status:        'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  scheduledAt:   string | null
  startedAt:     string | null
  endedAt:       string | null
  duration:      number | null
  coverImageUrl: string | null
  hostUser?: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
  hostUserId?: string | null  // direct creator id
  _count: { participants: number }
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PublicStream['status'] }) {
  const cfg = {
    SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700' },
    LIVE:      { label: '🔴 Live',    cls: 'bg-red-100 text-red-700 animate-pulse' },
    ENDED:     { label: 'Ended',      cls: 'bg-gray-100 text-gray-500' },
    CANCELLED: { label: 'Cancelled',  cls: 'bg-orange-100 text-orange-600' },
  }[status]
  return <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', cfg.cls)}>{cfg.label}</span>
}

// ─── Stream card ──────────────────────────────────────────────────────────────
function StreamCard({
  stream, canManage, onDelete, onEdit, liveViewerCount,
}: {
  stream: PublicStream
  canManage: boolean
  onDelete: (id: string) => void
  onEdit: (s: PublicStream) => void
  liveViewerCount?: number
}) {
  const scheduled = stream.scheduledAt ? new Date(stream.scheduledAt) : null
  const canDelete  = canManage && (stream.status === 'SCHEDULED' || stream.status === 'CANCELLED')
  const displayCount = liveViewerCount ?? stream._count.participants
  const hostName = stream.hostUser
    ? `${stream.hostUser.firstName} ${stream.hostUser.lastName}`
    : null

  return (
    <div className="relative group">
      <Link href={`/live-stream/${stream.id}`}>
        <motion.div
          whileHover={{ y: -2 }}
          className={cn(
            'bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden',
            stream.status === 'LIVE' && 'border-red-200 ring-1 ring-red-200'
          )}
        >
          {/* Cover image banner */}
          {stream.coverImageUrl && (
            <div className="h-32 overflow-hidden bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getFileUrl(stream.coverImageUrl)}
                alt={stream.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusBadge status={stream.status} />
                </div>
                <h3 className="font-semibold text-gray-900 truncate">{stream.title}</h3>
                {stream.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{stream.description}</p>
                )}
              </div>
              {!stream.coverImageUrl && (
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                  stream.status === 'LIVE' ? 'bg-red-100' : 'bg-purple-100'
                )}>
                  <Radio className={cn('w-5 h-5', stream.status === 'LIVE' ? 'text-red-600' : 'text-purple-600')} />
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs text-gray-500">
              {scheduled && stream.status === 'SCHEDULED' && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {scheduled.toLocaleDateString()} {scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {stream.duration ? `${stream.duration}m` : '∞'}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {displayCount}
                {liveViewerCount !== undefined && stream.status === 'LIVE' && (
                  <span className="text-red-500 font-semibold ml-0.5">•</span>
                )}
              </span>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
              {hostName && (() => {
                const avatarUrl = stream.hostUser?.avatarUrl
                const initials  = hostName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                return (
                  <Link
                    href={`/profile/${stream.hostUser!.id}`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 min-w-0 max-w-[55%] hover:text-purple-600 transition-colors"
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getFileUrl(avatarUrl)} alt={hostName} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] font-bold text-purple-600">{initials}</span>
                      </div>
                    )}
                    <span className="text-xs text-gray-400 truncate">{hostName}</span>
                  </Link>
                )
              })()}

              {stream.status === 'LIVE' && (
                <span className="text-xs font-bold text-red-600 flex items-center gap-1 ml-auto">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  Watch now
                </span>
              )}
              {stream.status === 'SCHEDULED' && (
                <span className="text-xs text-purple-600 font-medium ml-auto">View →</span>
              )}
              {stream.status === 'ENDED' && (
                <span className="text-xs text-gray-400 flex items-center gap-1 ml-auto">
                  <CheckCircle className="w-3 h-3" /> Ended
                </span>
              )}
            </div>
          </div>
        </motion.div>
      </Link>

      {/* Edit / Delete — shown on hover for owner */}
      {canManage && (
        <div className="absolute top-3 right-3 hidden group-hover:flex items-center gap-1 z-10">
          {stream.status !== 'ENDED' && stream.status !== 'CANCELLED' && (
            <button
              onClick={e => { e.preventDefault(); onEdit(stream) }}
              className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-purple-50 hover:border-purple-300 transition-colors"
              title="Edit"
              aria-label="Edit stream"
            >
              <Pencil className="w-3.5 h-3.5 text-purple-500" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={e => { e.preventDefault(); onDelete(stream.id) }}
              className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-red-50 hover:border-red-200 transition-colors"
              title="Delete"
              aria-label="Delete stream"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LiveStreamListPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreate, setShowCreate]   = useState(false)
  const [editingStream, setEditingStream] = useState<PublicStream | null>(null)
  // Real-time viewer counts keyed by liveClassId
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({})
  const debouncedSearch = useDebounce(search, 300)

  // SUPER_ADMIN cannot create streams; everyone else can
  const canCreate = user?.role !== 'SUPER_ADMIN'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['live-streams', statusFilter],
    queryFn: () => api.get('/live-classes', {
      params: {
        streamType: 'PUBLIC',
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
      queryClient.invalidateQueries({ queryKey: ['live-streams'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed to delete', variant: 'destructive' }),
  })

  const handleDelete = (id: string) => {
    if (!confirm('Delete this stream? This cannot be undone.')) return
    deleteMutation.mutate(id)
  }

  // Real-time socket updates
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.emit('feed:join:public')
    // Also subscribe to school room so viewer counts update for school streams
    const schoolId = user?.schoolId
    if (schoolId) socket.emit('school:join', schoolId)

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-streams'] })
    const onStarted = (d: any) => {
      refresh()
      toast({ title: `🔴 ${d.title || 'A stream'} is now live!` })
    }
    const onViewerCount = (d: { liveClassId: string; count: number }) =>
      setViewerCounts(prev => ({ ...prev, [d.liveClassId]: d.count }))

    socket.on('liveclass:started',      onStarted)
    socket.on('liveclass:scheduled',    refresh)
    socket.on('liveclass:ended',        refresh)
    socket.on('liveclass:viewer_count', onViewerCount)

    return () => {
      socket.emit('feed:leave:public')
      if (schoolId) socket.emit('school:leave', schoolId)
      socket.off('liveclass:started',      onStarted)
      socket.off('liveclass:scheduled',    refresh)
      socket.off('liveclass:ended',        refresh)
      socket.off('liveclass:viewer_count', onViewerCount)
    }
  }, [queryClient, toast, user?.schoolId])

  const streams: PublicStream[] = data || []

  // Client-side search filter
  const filtered = streams.filter(s =>
    !debouncedSearch ||
    s.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (s.hostUser
      ? `${s.hostUser.firstName} ${s.hostUser.lastName}`.toLowerCase().includes(debouncedSearch.toLowerCase())
      : false)
  )

  const live      = filtered.filter(s => s.status === 'LIVE')
    .sort((a, b) => (viewerCounts[b.id] ?? b._count.participants) - (viewerCounts[a.id] ?? a._count.participants))
  const scheduled = filtered.filter(s => s.status === 'SCHEDULED')
  const past      = filtered.filter(s => s.status === 'ENDED' || s.status === 'CANCELLED')

  const canManageCard = (s: PublicStream) => {
    const creatorId = s.hostUserId ?? s.hostUser?.id ?? null
    return !!user && !!creatorId && creatorId === user.id
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe className="w-6 h-6 text-purple-600" /> Live Streams
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {live.length > 0
              ? `${live.length} stream${live.length > 1 ? 's' : ''} live now`
              : 'Public streams — no school required'}
          </p>
        </div>
        {canCreate && (
          <Button
            className="bg-purple-600 hover:bg-purple-700 gap-2"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="w-4 h-4" /> Go Live
          </Button>
        )}
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
                  ? 'bg-purple-600 text-white'
                  : 'bg-white border text-gray-600 hover:bg-gray-50'
              )}
            >
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="text-center py-16">
          <Globe className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Failed to load streams</p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Globe className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {search ? `No streams matching "${search}"` : 'No public live streams yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Anyone can go live — no school required.
          </p>
          {canCreate && !search && (
            <Button
              className="mt-4 bg-purple-600 hover:bg-purple-700"
              onClick={() => setShowCreate(true)}
            >
              Start Your First Stream
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {live.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                Live Now
              </h2>
              <div className="space-y-3">
                {live.map(s => (
                  <StreamCard
                    key={s.id} stream={s} canManage={canManageCard(s)}
                    onDelete={handleDelete} onEdit={setEditingStream}
                    liveViewerCount={viewerCounts[s.id]}
                  />
                ))}
              </div>
            </section>
          )}

          {scheduled.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Upcoming</h2>
              <div className="space-y-3">
                {scheduled.map(s => (
                  <StreamCard key={s.id} stream={s} canManage={canManageCard(s)} onDelete={handleDelete} onEdit={setEditingStream} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Past</h2>
              <div className="space-y-3">
                {past.map(s => (
                  <StreamCard key={s.id} stream={s} canManage={canManageCard(s)} onDelete={handleDelete} onEdit={setEditingStream} />
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
              queryClient.invalidateQueries({ queryKey: ['live-streams'] })
            }}
          />
        )}
        {editingStream && (
          <EditLiveClassModal
            lc={{
              id: editingStream.id,
              title: editingStream.title,
              description: editingStream.description,
              coverImageUrl: editingStream.coverImageUrl,
              status: editingStream.status,
            }}
            onClose={() => setEditingStream(null)}
            onUpdated={() => queryClient.invalidateQueries({ queryKey: ['live-streams'] })}
            onDeleted={() => queryClient.invalidateQueries({ queryKey: ['live-streams'] })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
