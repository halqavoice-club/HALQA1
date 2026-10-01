'use client'

/**
 * VoiceRoomPKBanner — TikTok-style PK header
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a full-width PK battle header at the top of the Voice Room.
 * Matches the TikTok LIVE PK design:
 *   - "PK" gradient label + countdown timer + clock icon — centred top
 *   - Power/end button — top-right
 *   - Left avatar + diamond badge + name + flame score
 *   - Score progress bar splitting left (blue) ↔ right (red) dynamically
 *   - Right: opponent avatar + name + flame score (mirror layout)
 *   - Gift count badges bottom-left / bottom-right (🔑 × count)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { getSocket } from '@/lib/socket'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

interface PKBannerParticipant {
  userId:    string
  firstName: string
  lastName:  string
  avatarUrl: string | null
  side:      'A' | 'B'
}

interface Props {
  pkMatchId:       string
  participants:    PKBannerParticipant[]
  durationSeconds: number
  onDismiss:       () => void
}

export function VoiceRoomPKBanner({ pkMatchId, participants, durationSeconds, onDismiss }: Props) {
  const [scoreA,     setScoreA]     = useState(0)
  const [scoreB,     setScoreB]     = useState(0)
  const [giftCountA, setGiftCountA] = useState(0)
  const [giftCountB, setGiftCountB] = useState(0)
  const [remaining,  setRemaining]  = useState(durationSeconds)
  const [state,      setState]      = useState<'LIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED'>('LIVE')
  const [winnerSide, setWinnerSide] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sideA = participants.find(p => p.side === 'A')
  const sideB = participants.find(p => p.side === 'B')

  // Score bar percentages — 50/50 when tied
  const total = scoreA + scoreB
  const pctA  = total > 0 ? Math.max(4, Math.min(96, Math.round((scoreA / total) * 100))) : 50
  const pctB  = 100 - pctA

  // Formatted timer
  const mins     = Math.floor(remaining / 60)
  const secs     = remaining % 60
  const timeStr  = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  const isFinal  = remaining <= 30 && remaining > 0 && state === 'LIVE'
  const isPaused = state === 'PAUSED'

  // ── Local countdown ─────────────────────────────────────────────────────
  const startTimer = useCallback((s: number) => {
    stopTimer()
    if (s <= 0) return
    timerRef.current = setInterval(() => {
      setRemaining(r => { if (r <= 1) { stopTimer(); return 0 } return r - 1 })
    }, 1000)
  }, []) // eslint-disable-line

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  useEffect(() => { startTimer(durationSeconds); return stopTimer }, [durationSeconds]) // eslint-disable-line

  // ── Socket subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.emit('pk:join', pkMatchId)

    socket.on('pk:score', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setScoreA(d.scoreA); setScoreB(d.scoreB)
    })
    socket.on('pk:gift', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      if (d.side === 'A') setGiftCountA(c => c + 1)
      else                setGiftCountB(c => c + 1)
    })
    socket.on('pk:timer', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setRemaining(d.remainingSeconds)
    })
    socket.on('pk:started', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      const r = d.remainingSeconds ?? durationSeconds
      setRemaining(r); startTimer(r); setState('LIVE')
    })
    socket.on('pk:paused', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setState('PAUSED'); stopTimer()
    })
    socket.on('pk:resumed', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setState('LIVE'); setRemaining(d.remainingSeconds); startTimer(d.remainingSeconds)
    })
    socket.on('pk:winner', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setScoreA(d.scoreA); setScoreB(d.scoreB)
      setWinnerSide(d.winnerSide); setState('COMPLETED'); stopTimer()
      setTimeout(onDismiss, 5000)
    })
    socket.on('pk:ended', (d: any) => {
      if (d.pkMatchId !== pkMatchId) return
      setState('ABORTED'); stopTimer(); setTimeout(onDismiss, 3000)
    })

    return () => {
      socket.emit('pk:leave', pkMatchId)
      ;['pk:score','pk:gift','pk:timer','pk:started','pk:paused','pk:resumed','pk:winner','pk:ended']
        .forEach(e => socket.off(e))
    }
  }, [pkMatchId]) // eslint-disable-line

  // Winner overlay text
  const isDone = state === 'COMPLETED' || state === 'ABORTED'
  const winnerLabel =
    winnerSide === 'DRAW' ? '🤝 Draw!'
    : winnerSide === 'A'  ? `🏆 ${sideA?.firstName ?? 'Side A'} wins!`
    : winnerSide === 'B'  ? `🏆 ${sideB?.firstName ?? 'Side B'} wins!`
    : state === 'ABORTED' ? 'Battle ended' : null

  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0.8, originY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{    opacity: 0, scaleY: 0.8 }}
      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
      className="w-full overflow-hidden select-none"
      style={{
        background:   'linear-gradient(135deg, #1a237e 0%, #6a1b9a 50%, #b71c1c 100%)',
        borderRadius: '0 0 16px 16px',
        boxShadow:    '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* ── Top bar: PK label + timer + end button ── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1 relative">
        {/* Left spacer */}
        <div className="w-8" />

        {/* Center: PK + timer */}
        <div className="flex items-center gap-1.5 absolute left-1/2 -translate-x-1/2">
          {/* "PK" gradient text */}
          <span
            className="font-black text-base tracking-tight leading-none"
            style={{
              background:         'linear-gradient(90deg, #60a5fa 0%, #f472b6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            PK
          </span>

          {/* Timer */}
          <span className={cn(
            'font-mono font-bold text-sm tabular-nums',
            isFinal  ? 'text-red-300 animate-pulse'
            : isPaused ? 'text-yellow-300'
            : 'text-white',
          )}>
            {timeStr}
          </span>

          {/* Clock icon */}
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>

          {isPaused && (
            <span className="text-[10px] font-bold text-yellow-300 uppercase tracking-wide">⏸</span>
          )}
        </div>

        {/* End/dismiss button */}
        <button
          onClick={onDismiss}
          className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-all"
          title="Hide PK banner"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M18.364 5.636L5.636 18.364M5.636 5.636l12.728 12.728"/>
          </svg>
        </button>
      </div>

      {/* ── Main battle row ── */}
      <div className="flex items-center gap-2 px-3 pb-1">

        {/* Side A: avatar + name + score */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Avatar */}
          <div className="relative shrink-0">
            {sideA?.avatarUrl
              ? <img src={getAvatarUrl(sideA.avatarUrl)} className="w-11 h-11 rounded-full object-cover border-2 border-blue-400" alt={sideA.firstName} />
              : <div className="w-11 h-11 rounded-full bg-blue-600 border-2 border-blue-400 flex items-center justify-center text-white font-black text-base">{sideA?.firstName?.[0] ?? 'A'}</div>
            }
            {/* Diamond rank badge */}
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-[8px]">💎</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {/* Name */}
            <p className="text-white text-xs font-bold truncate leading-tight">
              {sideA?.firstName ? `${sideA.firstName}${sideA.lastName ? ' ' + sideA.lastName.slice(0, 4) + '…' : ''}` : 'Side A'}
            </p>
            {/* Flame score */}
            <div className="flex items-center gap-0.5 mt-0.5">
              <span className="text-[10px]">🔥</span>
              <span className={cn(
                'text-xs font-black tabular-nums',
                scoreA > scoreB ? 'text-white' : 'text-white/70',
                winnerSide === 'A' && 'text-yellow-300',
              )}>
                {scoreA.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Score progress bar — center column */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0" style={{ width: 120 }}>
          <div className="flex w-full h-3 rounded-full overflow-hidden bg-white/10">
            {/* Left (blue = side A) */}
            <div
              className="h-full rounded-l-full transition-all duration-500"
              style={{
                width:      `${pctA}%`,
                background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
              }}
            />
            {/* Right (red = side B) */}
            <div
              className="h-full rounded-r-full transition-all duration-500"
              style={{
                width:      `${pctB}%`,
                background: 'linear-gradient(90deg, #f87171, #b91c1c)',
              }}
            />
          </div>
          {/* Score dot indicator */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-white/50 tabular-nums">{pctA}%</span>
            <span className="text-[9px] text-white/30">·</span>
            <span className="text-[9px] text-white/50 tabular-nums">{pctB}%</span>
          </div>
        </div>

        {/* Side B: score + name + avatar (mirrored) */}
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <div className="flex-1 min-w-0 text-right">
            <p className="text-white text-xs font-bold truncate leading-tight">
              {sideB?.firstName ? `${sideB.firstName}${sideB.lastName ? ' ' + sideB.lastName.slice(0, 4) + '…' : ''}` : 'Side B'}
            </p>
            <div className="flex items-center gap-0.5 mt-0.5 justify-end">
              <span className={cn(
                'text-xs font-black tabular-nums',
                scoreB > scoreA ? 'text-white' : 'text-white/70',
                winnerSide === 'B' && 'text-yellow-300',
              )}>
                {scoreB.toLocaleString()}
              </span>
              <span className="text-[10px]">🔥</span>
            </div>
          </div>

          <div className="relative shrink-0">
            {sideB?.avatarUrl
              ? <img src={getAvatarUrl(sideB.avatarUrl)} className="w-11 h-11 rounded-full object-cover border-2 border-red-400" alt={sideB.firstName} />
              : <div className="w-11 h-11 rounded-full bg-red-600 border-2 border-red-400 flex items-center justify-center text-white font-black text-base">{sideB?.firstName?.[0] ?? 'B'}</div>
            }
            <div className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-[8px]">💎</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Gift count badges row ── */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
        {/* Side A gift badge */}
        <div className="flex items-center gap-1 bg-blue-500/30 border border-blue-400/40 rounded-lg px-2 py-0.5">
          <span className="text-xs">🔑</span>
          <span className="text-white text-xs font-bold">×{giftCountA}</span>
        </div>

        {/* Winner label (center, shown when done) */}
        {isDone && winnerLabel ? (
          <span className="text-xs font-extrabold text-yellow-300 text-center flex-1 mx-2 truncate">
            {winnerLabel}
          </span>
        ) : (
          <button
            onClick={() => window.open(`/voice-club/pk/${pkMatchId}`, '_blank')}
            className="text-[10px] font-semibold text-white/50 hover:text-white/80 transition-colors flex-1 text-center"
          >
            tap to watch full battle →
          </button>
        )}

        {/* Side B gift badge */}
        <div className="flex items-center gap-1 bg-red-500/30 border border-red-400/40 rounded-lg px-2 py-0.5">
          <span className="text-white text-xs font-bold">×{giftCountB}</span>
          <span className="text-xs">🔑</span>
        </div>
      </div>
    </motion.div>
  )
}
