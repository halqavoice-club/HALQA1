'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PKMatchmakingModalProps {
  isSearching: boolean
  onJoin:      (opts: { type: string; durationSeconds: number }) => void
  onLeave:     () => void
  onClose:     () => void
}

const DURATIONS = [
  { label: '1 min',  value: 60  },
  { label: '3 min',  value: 180 },
  { label: '5 min',  value: 300 },
  { label: '10 min', value: 600 },
]

export function PKMatchmakingModal({ isSearching, onJoin, onLeave, onClose }: PKMatchmakingModalProps) {
  const [duration, setDuration] = useState(300)
  const [elapsed,  setElapsed]  = useState(0)

  useEffect(() => {
    if (!isSearching) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [isSearching])

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 mb-4 sm:mb-0 bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">⚔️ PK Battle</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        {!isSearching ? (
          <>
            <p className="text-sm text-white/60">Choose battle duration and find a random opponent near your skill level.</p>

            <div className="space-y-2">
              <p className="text-xs text-white/40 uppercase tracking-wide">Duration</p>
              <div className="grid grid-cols-4 gap-2">
                {DURATIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={cn(
                      'py-2 rounded-lg text-sm font-semibold border transition-all',
                      duration === d.value
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={() => onJoin({ type: 'ONE_V_ONE', durationSeconds: duration })}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3"
            >
              🔍 Find Opponent
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-5xl animate-spin" style={{ animationDuration: '2s' }}>⚔️</div>
            <p className="text-white font-semibold">Searching for opponent...</p>
            <p className="text-white/40 text-sm tabular-nums">
              {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
            </p>
            <Button
              onClick={onLeave}
              variant="outline"
              className="border-white/20 text-white/60 hover:bg-white/10"
            >
              Cancel Search
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
