'use client'

/**
 * VoiceRoomPKPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Bottom-sheet that lets a Voice Club host challenge another room speaker to a
 * PK battle, or enter the global matchmaking queue — all from inside the room.
 *
 * Behaviour:
 * - HOST only can open this (hosts are the PK participants in a room battle).
 * - Challenger picks an opponent from the current speaker list OR uses
 *   matchmaking to find any global opponent.
 * - On accept the backend creates a PKMatch with roomIdA = this room's id,
 *   roomType = 'pk' so gifts sent during the battle feed into PK scoring.
 * - Once the match is created the panel closes and a navigation toast
 *   guides the host to the PK battle page.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { getAvatarUrl } from '@/lib/avatar'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/auth.store'
import { usePKStore } from '@/store/pk.store'
import { useToast } from '@/components/ui/use-toast'
import type { VoiceParticipant } from '@/store/voice.store'

const DURATIONS = [
  { label: '1 min',  value: 60  },
  { label: '3 min',  value: 180 },
  { label: '5 min',  value: 300 },
  { label: '10 min', value: 600 },
]

interface Props {
  open:       boolean
  onClose:    () => void
  roomId:     string
  speakers:   VoiceParticipant[]   // current on-stage speakers (excluding self)
  myUserId:   string
}

type Tab = 'challenge' | 'matchmaking'

export function VoiceRoomPKPanel({ open, onClose, roomId, speakers, myUserId }: Props) {
  const router       = useRouter()
  const { toast }    = useToast()
  const pkStore      = usePKStore()

  const [tab,        setTab]        = useState<Tab>('challenge')
  const [duration,   setDuration]   = useState(300)
  const [selected,   setSelected]   = useState<string | null>(null)  // userId
  const [loading,    setLoading]    = useState(false)
  const [queueTime,  setQueueTime]  = useState(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Eligible opponents = speakers on stage who aren't the current user
  const eligible = speakers.filter(p => p.userId !== myUserId && p.isActive && p.seatNumber != null)

  // Clear on close
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setLoading(false)
      clearQueueTimer()
    }
  }, [open])

  // Listen for matchmaking result while panel is open
  useEffect(() => {
    if (!open) return
    const socket = getSocket()
    if (!socket) return

    const handler = (data: { pkMatchId: string }) => {
      pkStore.setInQueue(false)
      clearQueueTimer()
      onClose()
      toast({ title: '⚔️ Opponent found! Battle starting…' })
      router.push(`/voice-club/pk/${data.pkMatchId}`)
    }
    socket.on('pk:matched', handler)
    return () => { socket.off('pk:matched', handler) }
  }, [open]) // eslint-disable-line

  function clearQueueTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setQueueTime(0)
  }

  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null)

  // Reset pending invitation hint when user picks a different opponent
  useEffect(() => { setPendingInvitationId(null) }, [selected])

  // ── Direct challenge ──────────────────────────────────────────────────────
  const handleChallenge = useCallback(async () => {
    if (!selected || loading) return
    setLoading(true)
    try {
      await api.post('/pk/invitations', {
        receiverId:      selected,
        type:            'ONE_V_ONE',
        durationSeconds: duration,
        roomId:          roomId,     // FIX: pass roomId so backend links match to this room
        message:         '⚔️ PK challenge from the voice room!',
      })
      toast({ title: '⚔️ Challenge sent!', description: 'Waiting for opponent to accept…' })
      setPendingInvitationId(null)
      onClose()
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 409) {
        // Fetch the existing pending invitation ID so we can offer Cancel & Resend
        try {
          const res = await api.get(`/pk/invitations?status=PENDING`)
          const items = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
          const match = items.find((i: any) => i.receiverId === selected)
          if (match) setPendingInvitationId(match.id)
        } catch {}
        toast({
          title:       '⏳ Challenge pending',
          description: 'You already have a pending challenge. Cancel it first then resend.',
          variant:     'destructive',
        })
      } else {
        toast({ title: 'Challenge failed', description: e?.response?.data?.message || 'Could not send challenge', variant: 'destructive' })
      }
    } finally {
      setLoading(false)
    }
  }, [selected, duration, loading, onClose, toast])

  // Cancel existing pending invitation and immediately resend
  const handleCancelAndResend = useCallback(async () => {
    if (!pendingInvitationId || !selected || loading) return
    setLoading(true)
    try {
      await api.post(`/pk/invitations/${pendingInvitationId}/cancel`)
      setPendingInvitationId(null)
      // Small delay so the cancel processes before resend
      await new Promise(r => setTimeout(r, 300))
      await api.post('/pk/invitations', {
        receiverId:      selected,
        type:            'ONE_V_ONE',
        durationSeconds: duration,
        message:         '⚔️ PK challenge from the voice room!',
      })
      toast({ title: '⚔️ Challenge resent!', description: 'Waiting for opponent to accept…' })
      onClose()
    } catch (e: any) {
      toast({ title: 'Resend failed', description: e?.response?.data?.message || 'Could not resend', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [pendingInvitationId, selected, duration, loading, onClose, toast])

  // ── Matchmaking ───────────────────────────────────────────────────────────
  const handleJoinQueue = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      await api.post('/pk/matchmaking/join', {
        type:            'ONE_V_ONE',
        durationSeconds: duration,
      })
      pkStore.setInQueue(true, 'ONE_V_ONE')
      timerRef.current = setInterval(() => setQueueTime(t => t + 1), 1000)
    } catch (e: any) {
      toast({
        title:       'Could not join queue',
        description: e?.response?.data?.message || 'Matchmaking unavailable',
        variant:     'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [duration, loading, pkStore, toast])

  const handleLeaveQueue = useCallback(async () => {
    try { await api.post('/pk/matchmaking/leave') } catch {}
    pkStore.setInQueue(false)
    clearQueueTimer()
  }, [pkStore])

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-[201] bg-slate-900 border-t border-white/10 rounded-t-2xl max-w-lg mx-auto"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">⚔️ PK Battle</h2>
              <button
                onClick={onClose}
                className="text-white/40 hover:text-white text-xl leading-none"
              >✕</button>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 mx-5 mt-4 bg-white/5 rounded-xl p-1">
              {(['challenge', 'matchmaking'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
                    tab === t
                      ? 'bg-indigo-600 text-white'
                      : 'text-white/50 hover:text-white',
                  )}
                >
                  {t === 'challenge' ? '🎯 Challenge Speaker' : '🔍 Matchmaking'}
                </button>
              ))}
            </div>

            {/* Duration selector (shared) */}
            <div className="px-5 mt-4">
              <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Duration</p>
              <div className="grid grid-cols-4 gap-2">
                {DURATIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={cn(
                      'py-2 rounded-lg text-sm font-semibold border transition-all',
                      duration === d.value
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Challenge tab ── */}
            {tab === 'challenge' && (
              <div className="px-5 mt-4 pb-6">
                {eligible.length === 0 ? (
                  <div className="text-center py-8 text-white/40 text-sm">
                    No speakers on stage to challenge.<br />
                    Use Matchmaking to find a global opponent.
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-white/40 uppercase tracking-wide mb-2">
                      Pick an opponent
                    </p>
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {eligible.map(p => (
                        <button
                          key={p.userId}
                          onClick={() => setSelected(s => s === p.userId ? null : p.userId)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
                            selected === p.userId
                              ? 'bg-indigo-600/20 border-indigo-500 text-white'
                              : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10',
                          )}
                        >
                          {p.user.avatarUrl
                            ? <img src={getAvatarUrl(p.user.avatarUrl)} className="w-8 h-8 rounded-full object-cover" alt="" />
                            : (
                              <div className="w-8 h-8 rounded-full bg-indigo-700 flex items-center justify-center text-white text-xs font-bold">
                                {p.user.firstName[0]}{p.user.lastName[0]}
                              </div>
                            )
                          }
                          <div className="flex-1 text-left">
                            <p className="text-sm font-semibold">
                              {p.user.firstName} {p.user.lastName}
                            </p>
                            <p className="text-xs text-white/40">Seat {p.seatNumber} · {p.role}</p>
                          </div>
                          {selected === p.userId && (
                            <span className="text-indigo-400 text-lg">✓</span>
                          )}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleChallenge}
                      disabled={!selected || loading}
                      className={cn(
                        'mt-4 w-full py-3 rounded-xl font-bold text-white transition-all',
                        selected && !loading
                          ? 'bg-indigo-600 hover:bg-indigo-500'
                          : 'bg-white/10 text-white/30 cursor-not-allowed',
                      )}
                    >
                      {loading ? '⏳ Sending…' : '⚔️ Send Challenge'}
                    </button>

                    {/* Cancel & Resend — shown after a 409 (active pending invitation) */}
                    {pendingInvitationId && selected && (
                      <button
                        onClick={handleCancelAndResend}
                        disabled={loading}
                        className={cn(
                          'mt-2 w-full py-2.5 rounded-xl text-sm font-semibold border border-amber-500/40',
                          'text-amber-400 hover:bg-amber-500/10 transition-all',
                          loading && 'opacity-40 cursor-not-allowed',
                        )}
                      >
                        {loading ? '⏳ Resending…' : '🔄 Cancel previous & resend'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Matchmaking tab ── */}
            {tab === 'matchmaking' && (
              <div className="px-5 mt-4 pb-6">
                {pkStore.inQueue ? (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="text-5xl" style={{ animation: 'spin 2s linear infinite' }}>⚔️</div>
                    <p className="text-white font-semibold">Searching for opponent…</p>
                    <p className="text-white/40 text-sm tabular-nums">{fmtTime(queueTime)}</p>
                    <p className="text-white/30 text-xs text-center">
                      You can close this panel — we'll notify you when a match is found.
                    </p>
                    <button
                      onClick={handleLeaveQueue}
                      className="px-6 py-2 border border-white/20 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all text-sm font-semibold"
                    >
                      Cancel Search
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-white/50 mb-4">
                      Find a random opponent near your skill level across the entire platform.
                    </p>
                    <button
                      onClick={handleJoinQueue}
                      disabled={loading}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white transition-all disabled:opacity-50"
                    >
                      {loading ? '⏳ Joining…' : '🔍 Find Opponent'}
                    </button>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
