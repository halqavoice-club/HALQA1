'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { socialApi } from '@/lib/social'
import { getAvatarUrl } from '@/lib/avatar'
import { useToast } from '@/components/ui/use-toast'
import { useSocialStore } from '@/store/social.store'
import { cn } from '@/lib/utils'
import { UserCheck, UserX, Clock, Users, X } from 'lucide-react'
import Link from 'next/link'
import type { FriendRequest } from '@/store/social.store'

function RequestCard({ req, onAccept, onReject, loading }: {
  req: FriendRequest
  onAccept: () => void
  onReject: () => void
  loading: boolean
}) {
  const u = req.user
  const src = getAvatarUrl(u.avatarUrl)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm"
    >
      <Link href={`/social/profile/${u.id}`}>
        <div className="w-12 h-12 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center font-bold text-indigo-600">
          {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : `${u.firstName[0]}${u.lastName[0]}`}
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/social/profile/${u.id}`}>
          <p className="font-semibold text-gray-900 text-sm hover:text-indigo-600 transition-colors">
            {u.firstName} {u.lastName}
          </p>
        </Link>
        <p className="text-xs text-gray-400 capitalize">{u?.role?.toLowerCase() ?? ""}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onAccept}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <UserCheck className="w-3.5 h-3.5" /> Accept
        </button>
        <button
          onClick={onReject}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-xs font-semibold hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
        >
          <UserX className="w-3.5 h-3.5" /> Reject
        </button>
      </div>
    </motion.div>
  )
}

export default function FriendRequestsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { decrementPending } = useSocialStore()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [tab, setTab] = useState<'incoming' | 'sent'>('incoming')

  const { data: incoming = [], isLoading: loadingIn } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests-incoming'],
    queryFn: () => socialApi.incomingRequests().then(r => r.data.data)
  })

  const { data: sent = [], isLoading: loadingSent } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests-sent'],
    queryFn: () => socialApi.sentRequests().then(r => r.data.data)
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['friend-requests-incoming'] })
    queryClient.invalidateQueries({ queryKey: ['friends'] })
    queryClient.invalidateQueries({ queryKey: ['social-counts'] })
  }

  const handleAccept = async (userId: string) => {
    setLoadingId(userId)
    try {
      await socialApi.acceptRequest(userId)
      toast({ title: '✅ Now friends!' })
      decrementPending()
      invalidate()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally { setLoadingId(null) }
  }

  const handleReject = async (userId: string) => {
    setLoadingId(userId)
    try {
      await socialApi.rejectRequest(userId)
      toast({ title: 'Request rejected' })
      decrementPending()
      invalidate()
    } finally { setLoadingId(null) }
  }

  const handleCancel = async (userId: string) => {
    setLoadingId(userId)
    try {
      await socialApi.cancelRequest(userId)
      toast({ title: 'Request cancelled' })
      queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
    } finally { setLoadingId(null) }
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Friend Requests</h1>
        {incoming.length > 0 && (
          <span className="bg-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {incoming.length}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {(['incoming', 'sent'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-2 text-sm font-semibold rounded-lg transition-all capitalize',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {t === 'incoming' ? `Incoming${incoming.length > 0 ? ` (${incoming.length})` : ''}` : 'Sent'}
          </button>
        ))}
      </div>

      {tab === 'incoming' && (
        <div className="space-y-2">
          {loadingIn ? (
            [...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)
          ) : incoming.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <UserCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No pending requests</p>
            </div>
          ) : (
            <AnimatePresence>
              {incoming.map(req => (
                <RequestCard
                  key={req.requestId}
                  req={req}
                  loading={loadingId === req.user.id}
                  onAccept={() => handleAccept(req.user.id)}
                  onReject={() => handleReject(req.user.id)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      {tab === 'sent' && (
        <div className="space-y-2">
          {loadingSent ? (
            [...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)
          ) : sent.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No sent requests</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sent.map(req => {
                const u = req.user
                const src = getAvatarUrl(u.avatarUrl)
                return (
                  <div key={req.requestId} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center font-bold text-indigo-600 text-sm">
                      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : `${u.firstName[0]}${u.lastName[0]}`}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-gray-400">Pending…</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                        Requested
                      </span>
                      <button
                        onClick={() => handleCancel(u.id)}
                        disabled={loadingId === u.id}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Cancel request"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
