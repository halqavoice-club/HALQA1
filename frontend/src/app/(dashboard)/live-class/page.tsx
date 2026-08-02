'use client'

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
import { Plus, Video, Users, Clock, Calendar, CheckCircle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { CreateLiveClassModal } from '@/components/live-class/CreateLiveClassModal'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveClass {
  id: string
  title: string
  description: string | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  scheduledAt: string | null
  startedAt: string | null
  endedAt: string | null
  duration: number
  chatEnabled: boolean
  handRaiseEnabled: boolean
  quranPanelEnabled: boolean
  class: { id: string; name: string }
  teacher: { user: { id: string; firstName: string; lastName: string; avatarUrl: string | null } }
  _count: { participants: number }
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

// ─── Live Class Card ──────────────────────────────────────────────────────────
function LiveClassCard({
  lc, canManage, onDelete,
}: {
  lc: LiveClass; canManage: boolean; onDelete: (id: string) => void
}) {
  const scheduled = lc.scheduledAt ? new Date(lc.scheduledAt) : null
  const canEdit = canManage && (lc.status === 'SCHEDULED')
  const canDelete = canManage && (lc.status === 'SCHEDULED' || lc.status === 'CANCELLED')

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
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={lc.status} />
                <span className="text-xs text-gray-400">{lc.class.name}</span>
              </div>
              <h3 className="font-semibold text-gray-900 truncate">{lc.title}</h3>
              {lc.description && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{lc.description}</p>
              )}
            </div>
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
              lc.status === 'LIVE' ? 'bg-red-100' : 'bg-indigo-100'
            )}>
              <Video className={cn('w-5 h-5', lc.status === 'LIVE' ? 'text-red-600' : 'text-indigo-600')} />
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
            <span className="text-xs text-gray-400">
              {lc.teacher.user.firstName} {lc.teacher.user.lastName}
            </span>
            {lc.status === 'LIVE' && (
              <span className="text-xs font-bold text-red-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                Join now
              </span>
            )}
            {lc.status === 'SCHEDULED' && (
              <span className="text-xs text-indigo-600 font-medium">View →</span>
            )}
            {lc.status === 'ENDED' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Completed
              </span>
            )}
          </div>
        </motion.div>
      </Link>

      {/* Edit / Delete actions — shown on hover for managers */}
      {canManage && (canEdit || canDelete) && (
        <div className="absolute top-3 right-3 hidden group-hover:flex items-center gap-1 z-10">
          {canDelete && (
            <button
              onClick={e => { e.preventDefault(); onDelete(lc.id) }}
              className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-red-50 hover:border-red-200 transition-colors"
              title="Delete"
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
export default function LiveClassPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreate, setShowCreate] = useState(false)
  const debouncedSearch = useDebounce(search, 300)

  const canManage = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(user?.role || '')

  const { data, isLoading } = useQuery({
    queryKey: ['live-classes', debouncedSearch, statusFilter],
    queryFn: () => api.get('/live-classes', {
      params: {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 50,
      }
    }).then(r => r.data.data?.items || []),
    refetchInterval: 15000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete('/live-classes/' + id),
    onSuccess: () => {
      toast({ title: 'Class deleted' })
      queryClient.invalidateQueries({ queryKey: ['live-classes'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed to delete', variant: 'destructive' }),
  })

  const handleDelete = (id: string) => {
    if (!confirm('Delete this class?')) return
    deleteMutation.mutate(id)
  }

  // Real-time updates
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    // Join school room so we receive liveclass:started / liveclass:scheduled events.
    // The backend emits these to `school:{schoolId}` when a class goes live.
    const schoolId = user?.schoolId
    if (schoolId) socket.emit('school:join', schoolId)

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['live-classes'] })
    const onStarted = (d: any) => {
      refresh()
      toast({ title: `🔴 ${d.title} is now live!` })
    }

    socket.on('liveclass:started',   onStarted)
    socket.on('liveclass:scheduled', refresh)
    socket.on('liveclass:ended',     refresh)

    return () => {
      if (schoolId) socket.emit('school:leave', schoolId)
      socket.off('liveclass:started',   onStarted)
      socket.off('liveclass:scheduled', refresh)
      socket.off('liveclass:ended',     refresh)
    }
  }, [queryClient, toast, user?.schoolId])

  const classes: LiveClass[] = data || []
  const filtered = classes.filter(lc =>
    !debouncedSearch ||
    lc.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    lc.class.name.toLowerCase().includes(debouncedSearch.toLowerCase())
  )

  const live      = filtered.filter(lc => lc.status === 'LIVE')
  const scheduled = filtered.filter(lc => lc.status === 'SCHEDULED')
  const past      = filtered.filter(lc => lc.status === 'ENDED' || lc.status === 'CANCELLED')

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Video className="w-6 h-6 text-indigo-600" /> Live Classes
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {live.length > 0 ? `${live.length} class${live.length > 1 ? 'es' : ''} live now` : 'Video + audio classes with LiveKit'}
          </p>
        </div>
        {canManage && (
          <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Class
          </Button>
        )}
      </div>

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search classes..."
            isLoading={isLoading && !!search}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {['all', 'LIVE', 'SCHEDULED', 'ENDED', 'CANCELLED'].map(s => (
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

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Video className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {search ? `No classes matching "${search}"` : 'No live classes yet'}
          </p>
          {canManage && !search && (
            <Button className="mt-4 bg-indigo-600 hover:bg-indigo-700" onClick={() => setShowCreate(true)}>
              Create First Class
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {live.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /> Live Now
              </h2>
              <div className="space-y-3">
                {live.map(lc => <LiveClassCard key={lc.id} lc={lc} canManage={canManage} onDelete={handleDelete} />)}
              </div>
            </section>
          )}
          {scheduled.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Upcoming</h2>
              <div className="space-y-3">
                {scheduled.map(lc => <LiveClassCard key={lc.id} lc={lc} canManage={canManage} onDelete={handleDelete} />)}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Past</h2>
              <div className="space-y-3">
                {past.map(lc => <LiveClassCard key={lc.id} lc={lc} canManage={canManage} onDelete={handleDelete} />)}
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
