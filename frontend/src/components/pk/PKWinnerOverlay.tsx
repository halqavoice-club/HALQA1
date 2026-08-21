'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { PKMatch, PKSide } from '@/store/pk.store'
import { cn } from '@/lib/utils'

interface PKWinnerOverlayProps {
  match:      PKMatch
  myUserId:   string
  onRematch:  () => void
  onExit:     () => void
  loading?:   boolean
}

export function PKWinnerOverlay({ match, myUserId, onRematch, onExit, loading }: PKWinnerOverlayProps) {
  const isWinner = match.winnerId === myUserId
  const isDraw   = match.winnerSide === 'DRAW'
  const mySide   = match.participants.find(p => p.userId === myUserId)?.side
  const myScore  = mySide === 'A' ? match.scoreA : match.scoreB
  const oppScore = mySide === 'A' ? match.scoreB : match.scoreA

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        {/* Background gradient */}
        <div className={cn(
          'absolute inset-0',
          isWinner ? 'bg-gradient-to-br from-yellow-900/80 to-amber-800/80'
          : isDraw  ? 'bg-gradient-to-br from-slate-800/90 to-gray-700/90'
          :           'bg-gradient-to-br from-slate-900/90 to-slate-800/90'
        )} />

        <div className="relative z-10 p-8 flex flex-col items-center gap-4 text-center">
          {/* Trophy / emoji */}
          <div className="text-6xl animate-bounce">
            {isWinner ? '🏆' : isDraw ? '🤝' : '💪'}
          </div>

          <h2 className={cn(
            'text-2xl font-extrabold',
            isWinner ? 'text-yellow-300' : isDraw ? 'text-white' : 'text-slate-300'
          )}>
            {isWinner ? 'YOU WON!' : isDraw ? 'DRAW!' : 'MATCH OVER'}
          </h2>

          {/* Score */}
          <div className="flex items-center gap-4 text-3xl font-bold tabular-nums">
            <span className={cn('text-rose-400', mySide === 'A' && isWinner && 'text-yellow-300')}>
              {mySide === 'A' ? myScore.toLocaleString() : oppScore.toLocaleString()}
            </span>
            <span className="text-white/40 text-xl">vs</span>
            <span className={cn('text-blue-400', mySide === 'B' && isWinner && 'text-yellow-300')}>
              {mySide === 'B' ? myScore.toLocaleString() : oppScore.toLocaleString()}
            </span>
          </div>

          {!isDraw && (
            <p className="text-sm text-white/60">
              {isWinner
                ? `+${Math.abs(myScore - oppScore).toLocaleString()} point lead`
                : `Lost by ${Math.abs(oppScore - myScore).toLocaleString()} points`
              }
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 w-full mt-2">
            <Button
              onClick={onRematch}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
            >
              ⚔️ Rematch
            </Button>
            <Button
              onClick={onExit}
              variant="outline"
              className="w-full border-white/20 text-white/70 hover:text-white hover:bg-white/10"
            >
              Exit
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
