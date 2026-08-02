'use client'
/**
 * LiveSection v3 — all live sessions shown as cards.
 * Voice Club card has a large profile circle inside.
 * Live Class card has a cover emoji.
 * 1 session = full width. 2+ = horizontal scroll + +N more overflow.
 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { postsApi, type Post } from '@/lib/posts'
import { getSocket } from '@/lib/socket'
import { LiveCard } from './LiveCard'
import { Radio, ChevronDown, ChevronUp } from 'lucide-react'

const VISIBLE_LIMIT = 2

export function LiveSection() {
  const queryClient = useQueryClient()
  const [counts,   setCounts]   = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey:        ['live-sessions'],
    queryFn:         () => postsApi.getLiveSessions().then(r => r.data.data),
    staleTime:       30_000,
    refetchInterval: 60_000,
  })

  const liveSessions: Post[] = (data ?? []).filter(s => s.liveData?.isLive !== false)

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onLive = (card: Post) => {
      queryClient.setQueryData<Post[]>(['live-sessions'], old => {
        if (!old) return [card]
        if (old.some(p => p.refEntityId === card.refEntityId)) return old
        return [card, ...old]
      })
    }
    const onLiveEnded = ({ refEntityId }: { refEntityType: string; refEntityId: string }) => {
      queryClient.setQueryData<Post[]>(['live-sessions'], old =>
        old ? old.map(p =>
          p.refEntityId === refEntityId
            ? { ...p, liveData: p.liveData ? { ...p.liveData, isLive: false } : p.liveData }
            : p
        ) : old
      )
    }
    const onLiveUpdate = ({ refEntityId, participantCount }: { refEntityType: string; refEntityId: string; participantCount: number }) => {
      setCounts(prev => ({ ...prev, [refEntityId]: participantCount }))
    }
    socket.on('feed:live',        onLive)
    socket.on('feed:live_ended',  onLiveEnded)
    socket.on('feed:live_update', onLiveUpdate)
    return () => {
      socket.off('feed:live',        onLive)
      socket.off('feed:live_ended',  onLiveEnded)
      socket.off('feed:live_update', onLiveUpdate)
    }
  }, [queryClient])

  if (isLoading || liveSessions.length === 0) return null

  const total    = liveSessions.length
  const overflow = total - VISIBLE_LIMIT
  const visible  = expanded ? liveSessions : liveSessions.slice(0, VISIBLE_LIMIT)

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <Radio className="w-3.5 h-3.5" /> Live Now
          </span>
          <span className="text-xs text-gray-400">{total} session{total !== 1 ? 's' : ''}</span>
        </div>
        {overflow > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-500 hover:text-indigo-700 transition-colors"
          >
            {expanded
              ? <><ChevronUp className="w-3.5 h-3.5" /> See less</>
              : <><ChevronDown className="w-3.5 h-3.5" /> +{overflow} more</>
            }
          </button>
        )}
      </div>

      {/* Single card — full width */}
      {total === 1 && (
        <LiveCard post={liveSessions[0]} liveParticipants={counts[liveSessions[0].refEntityId ?? '']} />
      )}

      {/* Multiple cards — horizontal scroll */}
      {total > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {visible.map(session => (
            <div key={session.id} className="flex-shrink-0 w-[280px]">
              <LiveCard post={session} liveParticipants={counts[session.refEntityId ?? '']} />
            </div>
          ))}
          {!expanded && overflow > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="flex-shrink-0 w-24 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-gray-400 hover:text-indigo-600"
            >
              <span className="text-2xl font-black leading-none">+{overflow}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide">more</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
