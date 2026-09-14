'use client'

/**
 * PK Invitations page — /voice-club/pk/invitations
 * Lists all pending PK challenges received by the current user.
 * Each card shows Accept / Decline buttons with a live expiry countdown.
 * Also navigates to this page from the "⚔️ PK Challenge!" push notification.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'

interface Invitation {
  id:              string
  senderId:        string
  type:            string
  durationSeconds: number
  expiresAt:       string
  status:          string
  message:         string | null
  createdAt:       string
  sender?: {
    id:        string
    firstName: string
    lastName:  string
    avatarUrl: string | null
    username:  string | null
  }
}

function CountdownBadge({ expiresAt }: { expiresAt: string }) {
  const [secs, setSecs] = useState(() => {
    const ms = new Date(expiresAt).getTime() - Date.now()
    return Math.max(0, Math.floor(ms / 1000))
  })

  useEffect(() => {
    if (secs <= 0) return
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [secs > 0]) // eslint-disable-line

  if (secs <= 0) return <span className="text-xs text-red-400 font-semibold">Expired</span>
  return (
    <span className={cn('text-xs font-semibold tabular-nums', secs < 60 ? 'text-red-400 animate-pulse' : 'text-amber-400')}>
      Expires in {secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}
    </span>
  )
}

export default function PKInvitationsPage() {
  const router       = useRouter()
  const queryClient  = useQueryClient()
  const [actionLoading, setActionLoading] = useState<Record<string, 'accepting' | 'declining'>>({})

  // Fetch pending invitations from backend
  const { data, isLoading, refetch } = useQuery<Invitation[]>({
    queryKey: ['pk-invitations-pending'],
    queryFn: () =>
      api.get('/pk/invitations?status=PENDING').then(r =>
        // Handle both { data: [...] } and { data: { data: [...] } } shapes
        Array.isArray(r.data) ? r.data
          : Array.isArray(r.data?.data) ? r.data.data
          : []
      ),
    refetchInterval: 10_000,
  })

  const invitations: Invitation[] = data ?? []

  // Listen for new invitations via socket and auto-refresh
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onNew      = () => { refetch() }
    const onCancelled = (d: { invitationId: string }) => {
      setInvitations(prev => prev.filter(i => i.id !== d.invitationId))
    }
    socket.on('pk:invitation', onNew)
    socket.on('pk:cancelled',  onCancelled)
    return () => {
      socket.off('pk:invitation', onNew)
      socket.off('pk:cancelled',  onCancelled)
    }
  }, [refetch])

  const handleAccept = useCallback(async (inv: Invitation) => {
    setActionLoading(prev => ({ ...prev, [inv.id]: 'accepting' }))
    try {
      const res = await api.post(`/pk/invitations/${inv.id}/accept`)
      const pkMatchId = res.data.data?.match?.id
      queryClient.invalidateQueries({ queryKey: ['pk-invitations-pending'] })
      // Navigate to the PK page since the user is on the invitations page (not in a room)
      if (pkMatchId) router.push(`/voice-club/pk/${pkMatchId}`)
    } catch {
      setActionLoading(prev => { const n = { ...prev }; delete n[inv.id]; return n })
    }
  }, [router, queryClient])

  const handleDecline = useCallback(async (inv: Invitation) => {
    setActionLoading(prev => ({ ...prev, [inv.id]: 'declining' }))
    try {
      await api.post(`/pk/invitations/${inv.id}/reject`)
      queryClient.invalidateQueries({ queryKey: ['pk-invitations-pending'] })
    } catch {
      setActionLoading(prev => { const n = { ...prev }; delete n[inv.id]; return n })
    }
  }, [queryClient])

  const durationLabel = (secs: number) => `${Math.floor(secs / 60)} min battle`

  return (
    <div className="min-h-screen bg-slate-950 text-white max-w-lg mx-auto px-4 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 py-5 sticky top-0 bg-slate-950 z-10 border-b border-white/5">
        <Button
          variant="ghost" size="icon"
          onClick={() => router.back()}
          className="text-white/60 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-extrabold">⚔️ PK Challenges</h1>
        {invitations.length > 0 && (
          <span className="ml-auto text-xs font-bold bg-indigo-600 px-2.5 py-0.5 rounded-full">
            {invitations.length}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      ) : invitations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <span className="text-6xl">⚔️</span>
          <p className="text-white/60 text-base font-semibold">No pending challenges</p>
          <p className="text-white/30 text-sm">
            Challenges will appear here when someone sends you a PK invite.
          </p>
          <Button
            onClick={() => router.push('/voice-club/pk')}
            className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
          >
            Find Opponent
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pt-4">
          {invitations.map(inv => {
            const action   = actionLoading[inv.id]
            const expired  = new Date(inv.expiresAt) < new Date()
            const sender   = inv.sender
            const name     = sender ? `${sender.firstName} ${sender.lastName}` : 'Unknown'

            return (
              <div
                key={inv.id}
                className="rounded-2xl border border-white/10 overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)' }}
              >
                {/* Expiry bar */}
                {!expired && (
                  <div className="h-0.5 w-full bg-white/10">
                    <div
                      className="h-full bg-indigo-500"
                      style={{
                        width: `${Math.max(0, (new Date(inv.expiresAt).getTime() - Date.now()) / (5 * 60 * 1000) * 100)}%`,
                        transition: 'width 1s linear',
                      }}
                    />
                  </div>
                )}

                <div className="p-4">
                  {/* Sender row */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative shrink-0">
                      {sender?.avatarUrl
                        ? <img src={getAvatarUrl(sender.avatarUrl)} className="w-12 h-12 rounded-full object-cover ring-2 ring-indigo-500" alt={name} />
                        : <div className="w-12 h-12 rounded-full bg-indigo-700 flex items-center justify-center text-white font-bold text-lg">
                            {sender?.firstName?.[0] ?? '?'}
                          </div>
                      }
                      <span className="absolute -bottom-1 -right-1 text-lg leading-none">⚔️</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold truncate">{name}</p>
                      <p className="text-indigo-300 text-sm">
                        {durationLabel(inv.durationSeconds)} · {inv.type.replace('_', ' ')}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {expired
                        ? <span className="text-xs text-red-400 font-semibold">Expired</span>
                        : <CountdownBadge expiresAt={inv.expiresAt} />
                      }
                      <p className="text-white/30 text-xs mt-0.5">
                        {formatDistanceToNow(new Date(inv.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {inv.message && (
                    <p className="text-white/50 text-sm italic mb-3 line-clamp-2">
                      "{inv.message}"
                    </p>
                  )}

                  {/* Buttons — disabled if expired */}
                  {!expired ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDecline(inv)}
                        disabled={!!action}
                        className={cn(
                          'flex-1 py-2.5 rounded-xl text-sm font-semibold border border-white/10 bg-white/5 text-white/60',
                          'hover:bg-white/10 hover:text-white transition-all',
                          !!action && 'opacity-40 cursor-not-allowed'
                        )}
                      >
                        {action === 'declining' ? '…' : '✕ Decline'}
                      </button>
                      <button
                        onClick={() => handleAccept(inv)}
                        disabled={!!action}
                        className={cn(
                          'flex-1 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all',
                          !!action && 'opacity-40 cursor-not-allowed'
                        )}
                      >
                        {action === 'accepting' ? '⏳ Joining…' : '⚔️ Accept'}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <span className="text-sm text-white/30">This challenge has expired</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
