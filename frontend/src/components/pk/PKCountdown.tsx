'use client'

import React, { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface PKCountdownProps {
  seconds: number
  onDone?: () => void
}

export function PKCountdown({ seconds, onDone }: PKCountdownProps) {
  const [count, setCount] = useState(seconds)

  useEffect(() => {
    setCount(seconds)
    if (seconds <= 0) { onDone?.(); return }
    const t = setInterval(() => {
      setCount(c => {
        if (c <= 1) { clearInterval(t); onDone?.(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [seconds]) // eslint-disable-line

  if (count <= 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div className={cn(
        'text-9xl font-black text-white drop-shadow-2xl',
        'animate-ping-once',
      )}
        key={count}
        style={{ animation: 'pkCountdown 0.9s ease-out' }}
      >
        {count}
      </div>
      <style jsx global>{`
        @keyframes pkCountdown {
          0%   { transform: scale(2);   opacity: 0; }
          30%  { transform: scale(1.1); opacity: 1; }
          80%  { transform: scale(1);   opacity: 1; }
          100% { transform: scale(0.8); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
