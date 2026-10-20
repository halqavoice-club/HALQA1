'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { PKComboState } from '@/store/pk.store'

interface PKScoreBarProps {
  scoreA:      number
  scoreB:      number
  comboA?:     PKComboState | null
  comboB?:     PKComboState | null
  comebackSide?: 'A' | 'B' | null
  leadingSide?:  'A' | 'B' | 'DRAW'
  voteScoreA?: number
  voteScoreB?: number
  nameA?:      string
  nameB?:      string
  avatarA?:    string | null
  avatarB?:    string | null
}

/** Converts a score ratio to a bar width percentage */
function scorePct(a: number, b: number): { pctA: number; pctB: number } {
  const total = a + b
  if (total === 0) return { pctA: 50, pctB: 50 }
  return {
    pctA: Math.round((a / total) * 100),
    pctB: Math.round((b / total) * 100),
  }
}

export function PKScoreBar({
  scoreA, scoreB, comboA, comboB, comebackSide, leadingSide = 'DRAW',
  voteScoreA = 0, voteScoreB = 0, nameA = 'Side A', nameB = 'Side B',
  avatarA, avatarB,
}: PKScoreBarProps) {
  const { pctA, pctB } = scorePct(scoreA, scoreB)
  const isEven = scoreA === scoreB

  return (
    <div className="w-full space-y-2 select-none">
      {/* Avatars + names */}
      <div className="flex items-center justify-between text-sm font-semibold">
        <div className="flex items-center gap-2">
          {avatarA
            ? <img src={avatarA} className="w-8 h-8 rounded-full object-cover ring-2 ring-rose-500" alt={nameA} />
            : <div className="w-8 h-8 rounded-full bg-rose-600 flex items-center justify-center text-white text-xs font-bold">A</div>
          }
          <span className="text-white max-w-[90px] truncate">{nameA}</span>
          {leadingSide === 'A' && !isEven && <span className="text-rose-400 text-xs">👑</span>}
        </div>
        <div className="flex items-center gap-2">
          {leadingSide === 'B' && !isEven && <span className="text-blue-400 text-xs">👑</span>}
          <span className="text-white max-w-[90px] truncate text-right">{nameB}</span>
          {avatarB
            ? <img src={avatarB} className="w-8 h-8 rounded-full object-cover ring-2 ring-blue-500" alt={nameB} />
            : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">B</div>
          }
        </div>
      </div>

      {/* Score numbers */}
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-2xl font-bold tabular-nums',
          leadingSide === 'A' ? 'text-rose-400' : 'text-white/80',
          comebackSide === 'A' && 'animate-pulse text-yellow-400',
        )}>
          {scoreA.toLocaleString()}
        </span>

        <div className="flex flex-col items-center">
          {isEven
            ? <span className="text-xs text-white/60">TIE</span>
            : <span className="text-xs text-white/60">{pctA}% – {pctB}%</span>
          }
          {(comboA || comboB) && (
            <span className="text-xs text-yellow-400 font-bold">
              {comboA ? `🔥 x${comboA.level} A` : `🔥 x${(comboB as PKComboState).level} B`}
            </span>
          )}
          {(comebackSide === 'A' || comebackSide === 'B') && (
            <span className="text-xs text-orange-400 font-bold animate-bounce">⚡ COMEBACK</span>
          )}
        </div>

        <span className={cn(
          'text-2xl font-bold tabular-nums',
          leadingSide === 'B' ? 'text-blue-400' : 'text-white/80',
          comebackSide === 'B' && 'animate-pulse text-yellow-400',
        )}>
          {scoreB.toLocaleString()}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden flex">
        <div
          className={cn(
            'h-full transition-all duration-500 ease-out rounded-l-full',
            leadingSide === 'A' ? 'bg-rose-500' : 'bg-rose-400/70',
            comebackSide === 'B' && 'bg-orange-400',
          )}
          style={{ width: `${pctA}%` }}
        />
        <div
          className={cn(
            'h-full transition-all duration-500 ease-out rounded-r-full',
            leadingSide === 'B' ? 'bg-blue-500' : 'bg-blue-400/70',
            comebackSide === 'A' && 'bg-orange-400',
          )}
          style={{ width: `${pctB}%` }}
        />
      </div>

      {/* Vote scores */}
      {(voteScoreA > 0 || voteScoreB > 0) && (
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>🗳️ {voteScoreA} votes</span>
          <span className="text-white/30">audience</span>
          <span>🗳️ {voteScoreB} votes</span>
        </div>
      )}
    </div>
  )
}
