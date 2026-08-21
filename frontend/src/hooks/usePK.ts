'use client'

import { useEffect, useCallback, useRef } from 'react'
import { getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/auth.store'
import { usePKStore, PKSide, PKTimerState } from '@/store/pk.store'
import api from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

/**
 * usePK — Socket.IO + server sync hook for a PK match.
 *
 * Subscribes to all pk:{pkMatchId} events and keeps the PKStore in sync.
 * The server is always authoritative — the client never calculates scores.
 *
 * Usage:
 *   const { match, remainingSeconds, castVote, rematch } = usePK(pkMatchId)
 */
export function usePK(pkMatchId: string | null) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const store       = usePKStore()
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load initial match state ──────────────────────────────────────────────
  useEffect(() => {
    if (!pkMatchId) return
    api.get(`/pk/${pkMatchId}`).then(r => {
      store.setActiveMatch(r.data.data)
    }).catch(() => {})

    return () => {
      store.reset()
    }
  }, [pkMatchId]) // eslint-disable-line

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pkMatchId) return
    const socket = getSocket()
    if (!socket) return

    socket.emit('pk:join', pkMatchId)

    // Reconnect handler — re-join PK room
    const onConnect = () => {
      socket.emit('pk:join', pkMatchId)
      socket.emit('pk:timer:sync', pkMatchId)
    }
    socket.on('connect', onConnect)

    // ── pk:state — full state sync on reconnect ──────────────────────────
    socket.on('pk:state', (data: any) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setActiveMatch({ ...data, participants: data.participants || [] })
      if (data.remainingSeconds !== undefined) {
        store.setRemaining(data.remainingSeconds)
        startLocalTimer(data.remainingSeconds)
      }
      if (data.voteScoreA !== undefined) store.setVotes(data.voteScoreA, data.voteScoreB)
    })

    // ── pk:countdown ──────────────────────────────────────────────────────
    socket.on('pk:countdown', (data: { pkMatchId: string; seconds: number }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setMatchState('COUNTDOWN')
      store.setCountdown(data.seconds)
    })

    // ── pk:started ────────────────────────────────────────────────────────
    socket.on('pk:started', (data: {
      pkMatchId: string; state: string; startedAt: string;
      durationSeconds: number; remainingSeconds: number
    }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setMatchState('LIVE')
      store.setCountdown(null)
      store.setRemaining(data.remainingSeconds)
      startLocalTimer(data.remainingSeconds)
    })

    // ── pk:score ──────────────────────────────────────────────────────────
    socket.on('pk:score', (data: {
      pkMatchId: string; scoreA: number; scoreB: number
      giftScoreA: number; giftScoreB: number
    }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.updateMatchScore(data.scoreA, data.scoreB, data.giftScoreA, data.giftScoreB)
    })

    // ── pk:gift ───────────────────────────────────────────────────────────
    socket.on('pk:gift', (data: any) => {
      if (data.pkMatchId !== pkMatchId) return
      store.addGiftFeed({
        id:              data.giftTransactionId || `${Date.now()}`,
        side:            data.side as PKSide,
        beneficiaryId:   data.beneficiaryId,
        giftScore:       data.giftScore,
        bonusScore:      data.bonusScore,
        finalScore:      data.finalScore,
        comboLevel:      data.comboLevel || 0,
        isComebackBonus: data.isComebackBonus || false,
        timestamp:       Date.now(),
      })
    })

    // ── pk:combo ──────────────────────────────────────────────────────────
    socket.on('pk:combo', (data: { pkMatchId: string; side: PKSide; comboLevel: number; comboMult: number }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setCombo(data.side, data.comboLevel, data.comboMult)
      toast({ title: `🔥 ${data.side === 'A' ? 'Side A' : 'Side B'} COMBO x${data.comboLevel}!` })
    })

    // ── pk:comeback ───────────────────────────────────────────────────────
    socket.on('pk:comeback', (data: { pkMatchId: string; side: PKSide }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setComebackSide(data.side)
      toast({ title: `⚡ COMEBACK! Side ${data.side} is fighting back!` })
    })

    // ── pk:vote ───────────────────────────────────────────────────────────
    socket.on('pk:vote', (data: { pkMatchId: string; voteScoreA: number; voteScoreB: number }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setVotes(data.voteScoreA, data.voteScoreB)
    })

    // ── pk:timer ─────────────────────────────────────────────────────────
    socket.on('pk:timer', (data: { pkMatchId: string; remainingSeconds: number; finalRound?: boolean }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setRemaining(data.remainingSeconds)
      if (data.finalRound) {
        toast({ title: '⏰ FINAL 30 SECONDS!' })
      }
    })

    // ── pk:leader-change ─────────────────────────────────────────────────
    socket.on('pk:leader-change', (data: { pkMatchId: string; newLeader: PKSide }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setLeadingSide(data.newLeader)
    })

    // ── pk:paused ─────────────────────────────────────────────────────────
    socket.on('pk:paused', (data: { pkMatchId: string }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setMatchState('PAUSED')
      stopLocalTimer()
      toast({ title: '⏸️ PK Paused' })
    })

    // ── pk:resumed ────────────────────────────────────────────────────────
    socket.on('pk:resumed', (data: { pkMatchId: string; remainingSeconds: number }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setMatchState('LIVE')
      store.setRemaining(data.remainingSeconds)
      startLocalTimer(data.remainingSeconds)
      toast({ title: '▶️ PK Resumed' })
    })

    // ── pk:ended ──────────────────────────────────────────────────────────
    socket.on('pk:ended', (data: { pkMatchId: string; state: string }) => {
      if (data.pkMatchId !== pkMatchId) return
      stopLocalTimer()
      store.setMatchState(data.state as any)
    })

    // ── pk:winner ─────────────────────────────────────────────────────────
    socket.on('pk:winner', (data: {
      pkMatchId: string; winnerId: string | null; winnerSide: PKSide | 'DRAW'
      scoreA: number; scoreB: number
    }) => {
      if (data.pkMatchId !== pkMatchId) return
      store.setWinner(data.winnerId, data.winnerSide)
      store.updateMatchScore(data.scoreA, data.scoreB)
      stopLocalTimer()
      store.setShowWinnerOverlay(true)
      setTimeout(() => store.setShowRematchPrompt(true), 3000)

      const isWinner = data.winnerId === user?.id
      const isDraw   = data.winnerSide === 'DRAW'
      toast({
        title: isWinner ? '🏆 You won!' : isDraw ? '🤝 Draw!' : '💪 Match ended',
        description: `Final: ${data.scoreA} vs ${data.scoreB}`
      })
    })

    // ── pk:matched (from matchmaking) ────────────────────────────────────
    socket.on('pk:matched', (data: { pkMatchId: string; opponentId: string }) => {
      store.setInQueue(false)
      toast({ title: '⚔️ Opponent found!', description: 'PK battle starting...' })
      // Navigate handled by the page component listening to this event
    })

    // ── pk:invitation (personal) ─────────────────────────────────────────
    socket.on('pk:invitation', (data: { invitation: any; sender: any }) => {
      store.setPendingInvitation({ ...data.invitation, sender: data.sender })
      toast({
        title: `⚔️ PK Challenge from ${data.sender?.firstName}!`,
        description: 'Check your notifications to accept or decline.'
      })
    })

    // ── pk:accepted ───────────────────────────────────────────────────────
    socket.on('pk:accepted', (data: { pkMatchId: string; acceptedBy: string }) => {
      toast({ title: '✅ Challenge accepted! PK starting...' })
    })

    // ── pk:rejected ───────────────────────────────────────────────────────
    socket.on('pk:rejected', (data: { invitationId: string }) => {
      toast({ title: '❌ Challenge declined', variant: 'destructive' })
    })

    // ── pk:error ─────────────────────────────────────────────────────────
    socket.on('pk:error', (data: { message: string }) => {
      toast({ title: 'PK Error', description: data.message, variant: 'destructive' })
    })

    return () => {
      socket.off('connect', onConnect)
      socket.emit('pk:leave', pkMatchId)
      socket.off('pk:state')
      socket.off('pk:countdown')
      socket.off('pk:started')
      socket.off('pk:score')
      socket.off('pk:gift')
      socket.off('pk:combo')
      socket.off('pk:comeback')
      socket.off('pk:vote')
      socket.off('pk:timer')
      socket.off('pk:leader-change')
      socket.off('pk:paused')
      socket.off('pk:resumed')
      socket.off('pk:ended')
      socket.off('pk:winner')
      socket.off('pk:matched')
      socket.off('pk:invitation')
      socket.off('pk:accepted')
      socket.off('pk:rejected')
      socket.off('pk:error')
      stopLocalTimer()
    }
  }, [pkMatchId]) // eslint-disable-line

  // ── Local countdown tick (server-seeded, client runs between syncs) ───────
  function startLocalTimer(seconds: number) {
    stopLocalTimer()
    if (seconds <= 0) return
    timerRef.current = setInterval(() => {
      usePKStore.setState(s => {
        const next = Math.max(0, s.remainingSeconds - 1)
        if (next === 0 && timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        return { remainingSeconds: next }
      })
    }, 1000)
  }

  function stopLocalTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const startPK = useCallback(async () => {
    if (!pkMatchId) return
    await api.post(`/pk/${pkMatchId}/start`)
  }, [pkMatchId])

  const castVote = useCallback(async (side: PKSide) => {
    if (!pkMatchId) return
    try {
      await api.post(`/pk/${pkMatchId}/vote`, { side })
      toast({ title: `✅ Voted for Side ${side}!` })
    } catch (e: any) {
      toast({ title: 'Vote failed', description: e?.response?.data?.message, variant: 'destructive' })
    }
  }, [pkMatchId]) // eslint-disable-line

  const requestRematch = useCallback(async () => {
    if (!pkMatchId) return null
    try {
      const r = await api.post(`/pk/${pkMatchId}/rematch`)
      return r.data.data
    } catch {
      return null
    }
  }, [pkMatchId])

  const joinMatchmaking = useCallback(async (opts?: { type?: string; durationSeconds?: number }) => {
    try {
      await api.post('/pk/matchmaking/join', opts)
      store.setInQueue(true, (opts?.type as any) || 'ONE_V_ONE')
      toast({ title: '🔍 Searching for opponent...' })
    } catch (e: any) {
      toast({ title: 'Could not join queue', description: e?.response?.data?.message, variant: 'destructive' })
    }
  }, []) // eslint-disable-line

  const leaveMatchmaking = useCallback(async () => {
    try {
      await api.post('/pk/matchmaking/leave')
      store.setInQueue(false)
    } catch {}
  }, []) // eslint-disable-line

  return {
    match:           store.activeMatch,
    remainingSeconds: store.remainingSeconds,
    voteScoreA:      store.voteScoreA,
    voteScoreB:      store.voteScoreB,
    comboA:          store.comboA,
    comboB:          store.comboB,
    comebackSide:    store.comebackSide,
    leadingSide:     store.leadingSide,
    giftFeed:        store.giftFeed,
    countdownSeconds: store.countdownSeconds,
    showWinnerOverlay: store.showWinnerOverlay,
    showRematchPrompt: store.showRematchPrompt,
    pendingInvitation: store.pendingInvitation,
    inQueue:         store.inQueue,
    myStats:         store.myStats,
    // Actions
    startPK,
    castVote,
    requestRematch,
    joinMatchmaking,
    leaveMatchmaking,
  }
}
