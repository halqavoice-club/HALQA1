'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { ShieldCheck, ArrowLeft, Loader2, UserX } from 'lucide-react'
import Link from 'next/link'

interface BlockedUser {
  id:        string
  firstName: string
  lastName:  string
  avatarUrl: string | null
  role:      string
  blockedAt: string
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}

export default function BlockedUsersPage() {
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const { data: blocked = [], isLoading } = useQuery<BlockedUser[]>({
    queryKey: ['blocked-users'],
    queryFn:  () => api.get('/social/blocked').then(r => r.data.data),
  })

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/social/block/${userId}`),
    onSuccess: (_, userId) => {
      toast({ title: 'User unblocked' })
      queryClient.setQueryData<BlockedUser[]>(['blocked-users'], prev =>
        (prev ?? []).filter(u => u.id !== userId)
      )
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  return (
    <div className="max-w-xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-gray-500" />
            Blocked Users
          </h1>
          <p className="text-sm text-gray-400">
            Blocked users can't follow you, send friend requests, or message you.
          </p>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : blocked.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No blocked users</p>
            <p className="text-xs text-gray-400 mt-1">
              You can block users from their profile page.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {blocked.map(u => {
              const src      = getAvatarUrl(u.avatarUrl)
              const initials = `${u.firstName[0]}${u.lastName[0]}`.toUpperCase()
              return (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
                    {src
                      ? <img src={src} alt="" className="w-full h-full object-cover" />
                      : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-xs text-gray-400 capitalize">
                      {u.role.replace(/_/g, ' ').toLowerCase()} · blocked {timeAgo(u.blockedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => unblockMutation.mutate(u.id)}
                    disabled={unblockMutation.isPending && unblockMutation.variables === u.id}
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {unblockMutation.isPending && unblockMutation.variables === u.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <ShieldCheck className="w-3 h-3" />
                    }
                    Unblock
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
