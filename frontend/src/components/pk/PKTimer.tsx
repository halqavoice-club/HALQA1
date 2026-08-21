'use client'

import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface PKTimerProps {
  remainingSeconds: number
  totalSeconds:     number
  isPaused?:        boolean
  isFinalRound?:    boolean
}

export function PKTimer({ remainingSeconds, totalSeconds, isPaused, isFinalRound }: PKTimerProps) {
  const mins = Math.floor(remainingSeconds / 60)
  const secs = remainingSeconds % 60
  const pct  = totalSeconds > 0 ? (remainingSeconds / totalSeconds) * 100 : 0

  const colorClass = isFinalRound || remainingSeconds <= 30
    ? 'text-red-400'
    : remainingSeconds <= 60
    ? 'text-yellow-400'
    : 'text-white'

  const progressColor = isFinalRound || remainingSeconds <= 30
    ? 'bg-red-500'
    : remainingSeconds <= 60
    ? 'bg-yellow-400'
    : 'bg-indigo-500'

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Digital timer */}
      <div className={cn(
        'text-3xl font-bold font-mono tabular-nums tracking-wider transition-colors',
        colorClass,
        isFinalRound && 'animate-pulse'
      )}>
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>

      {/* Progress bar */}
      <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-1000', progressColor)}
          style={{ width: `${pct}%` }}
        />
      </div>

      {isPaused && (
        <span className="text-xs text-yellow-400 font-semibold uppercase tracking-wide">⏸ Paused</span>
      )}
      {isFinalRound && remainingSeconds > 0 && (
        <span className="text-xs text-red-400 font-bold uppercase tracking-wide animate-bounce">
          ⚡ Final Round!
        </span>
      )}
    </div>
  )
}
