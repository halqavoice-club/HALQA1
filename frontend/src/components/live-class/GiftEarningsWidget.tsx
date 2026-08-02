'use client'

/**
 * GiftEarningsWidget.tsx
 *
 * Teacher-facing earnings summary for the current live class session.
 * Shows top supporters, total coins received, and diamonds earned.
 * Only visible to HOST role. Collapsible.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp, Gift } from 'lucide-react'

interface Supporter {
  userId?:    string
  totalCoins: number
  giftCount:  number
  user: {
    id:        string
    firstName: string
    lastName:  string
    avatarUrl: string | null
  }
}

interface Props {
  liveClassId: string
  className?:  string
}

export function GiftEarningsWidget({ liveClassId, className }: Props) {
  const [expanded, setExpanded] = useState(false)

  const { data: supporters = [] } = useQuery<Supporter[]>({
    queryKey: ['lc-gift-supporters', liveClassId],
    queryFn: () =>
      api.get(`/live-classes/${liveClassId}/gifts/top-supporters`)
        .then(r => r.data.data ?? []),
    refetchInterval: 30_000,
    enabled: !!liveClassId,
  })

  const { data: leaderboard = [] } = useQuery<Supporter[]>({
    queryKey: ['lc-gift-leaderboard', liveClassId],
    queryFn: () =>
      api.get(`/live-classes/${liveClassId}/gifts/leaderboard?limit=10`)
        .then(r => r.data.data ?? []),
    refetchInterval: 30_000,
    enabled: !!liveClassId && expanded,
  })

  const totalCoins    = supporters.reduce((s, x) => s + (x.totalCoins ?? 0), 0)
  const totalDiamonds = Math.floor(totalCoins * 0.5)

  return (
    <div className={cn('rounded-xl border border-gray-700 overflow-hidden', className)}>
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-yellow-400" />
          <span className="text-sm font-semibold text-white">🎁 Gifts This Session</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-yellow-400 font-bold">
            🪙 {totalCoins.toLocaleString()} → 💎 {totalDiamonds.toLocaleString()}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Top 3 supporters — visible when collapsed */}
      {supporters.length > 0 && (
        <div className="flex gap-2 px-4 py-2 bg-gray-850 border-t border-gray-700">
          {supporters.slice(0, 3).map((s, i) => {
            const src = getAvatarUrl(s.user.avatarUrl)
            const medal = ['🥇', '🥈', '🥉'][i] ?? ''
            return (
              <div key={s.user.id} className="flex flex-col items-center gap-0.5 min-w-0">
                <div className="relative w-8 h-8 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-300">
                  {src
                    ? <img src={src} alt="" className="w-full h-full object-cover" />
                    : `${s.user.firstName[0] ?? '?'}${s.user.lastName[0] ?? ''}`
                  }
                  <span className="absolute -top-0.5 -right-0.5 text-[10px]">{medal}</span>
                </div>
                <span className="text-[9px] text-gray-400 truncate max-w-[48px] text-center">
                  {s.user.firstName}
                </span>
                <span className="text-[9px] text-yellow-400 font-bold">🪙{s.totalCoins.toLocaleString()}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Expanded leaderboard */}
      {expanded && (
        <div className="bg-gray-900 border-t border-gray-700">
          {leaderboard.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No gifts sent yet</p>
          ) : (
            leaderboard.map((entry, idx) => {
              const src = getAvatarUrl(entry.user.avatarUrl)
              return (
                <div key={entry.user.id} className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 last:border-0">
                  <span className="text-xs text-gray-500 w-4 text-right flex-shrink-0">{idx + 1}</span>
                  <div className="w-7 h-7 rounded-full overflow-hidden bg-indigo-900 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                    {src
                      ? <img src={src} alt="" className="w-full h-full object-cover" />
                      : `${entry.user.firstName[0] ?? '?'}`
                    }
                  </div>
                  <span className="text-xs text-white flex-1 truncate">
                    {entry.user.firstName} {entry.user.lastName}
                  </span>
                  <span className="text-xs text-yellow-400 font-bold flex-shrink-0">
                    🪙 {entry.totalCoins.toLocaleString()}
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
