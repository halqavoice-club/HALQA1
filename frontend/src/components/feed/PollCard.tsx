'use client'
/**
 * PollCard — renders a poll embedded in a feed PostCard.
 *
 * Expected pollData shape (stored as JSON in Post.pollData):
 *   {
 *     question: string
 *     options:  Array<{ id: string; text: string; votes: number }>
 *     totalVotes: number
 *     votedOptionId?: string   // current user's vote (null if not voted)
 *     endsAt?: string          // ISO date, optional expiry
 *   }
 *
 * If the shape deviates (legacy data), we degrade gracefully.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi } from '@/lib/posts'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { BarChart2, CheckCircle2, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface PollOption {
  id:    string
  text:  string
  votes: number
}

interface PollData {
  question:      string
  options:       PollOption[]
  totalVotes:    number
  votedOptionId?: string | null
  endsAt?:       string | null
}

interface Props {
  postId:   string
  pollData: any
  isOwn:   boolean
}

export function PollCard({ postId, pollData, isOwn }: Props) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  // ── Normalise legacy / malformed shapes ──────────────────────────────────
  if (!pollData || typeof pollData !== 'object') return null

  // Support legacy shape where options is just string[]
  const rawOptions: PollOption[] = Array.isArray(pollData.options)
    ? pollData.options.map((o: any, i: number) =>
        typeof o === 'string'
          ? { id: String(i), text: o, votes: 0 }
          : { id: o.id ?? String(i), text: o.text ?? o, votes: o.votes ?? 0 }
      )
    : []

  const data: PollData = {
    question:      pollData.question ?? 'Poll',
    options:       rawOptions,
    totalVotes:    pollData.totalVotes ?? rawOptions.reduce((s: number, o: PollOption) => s + o.votes, 0),
    votedOptionId: pollData.votedOptionId ?? null,
    endsAt:        pollData.endsAt ?? null,
  }

  const hasVoted  = !!data.votedOptionId
  const isExpired = data.endsAt ? new Date(data.endsAt) < new Date() : false

  const voteMutation = useMutation({
    mutationFn: (optionId: string) =>
      postsApi.votePoll(postId, optionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['post', postId] })
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to vote', variant: 'destructive' })
    },
  })

  const canVote = !hasVoted && !isExpired && !isOwn

  return (
    <div className="bg-gray-50 rounded-2xl border border-gray-200 p-4 space-y-3">
      {/* Poll header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-gray-800 leading-snug">{data.question}</p>
        </div>
        {data.endsAt && !isExpired && (
          <span className="flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(data.endsAt), { addSuffix: true })}
          </span>
        )}
        {isExpired && (
          <span className="text-[11px] text-gray-400 flex-shrink-0">Closed</span>
        )}
      </div>

      {/* Options */}
      <div className="space-y-2">
        {data.options.map((opt) => {
          const pct        = data.totalVotes > 0 ? Math.round((opt.votes / data.totalVotes) * 100) : 0
          const isSelected = data.votedOptionId === opt.id

          return (
            <button
              key={opt.id}
              disabled={!canVote || voteMutation.isPending}
              onClick={() => canVote && voteMutation.mutate(opt.id)}
              className={cn(
                'relative w-full text-left rounded-xl border overflow-hidden transition-all',
                canVote
                  ? 'hover:border-indigo-300 hover:shadow-sm cursor-pointer'
                  : 'cursor-default',
                isSelected
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-gray-200 bg-white',
                (!canVote && !isSelected) && 'opacity-90'
              )}
            >
              {/* Fill bar (shown after voting) */}
              {(hasVoted || isExpired || isOwn) && (
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-xl transition-all duration-500',
                    isSelected ? 'bg-indigo-100' : 'bg-gray-100'
                  )}
                  style={{ width: `${pct}%` }}
                />
              )}

              <div className="relative flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  {isSelected && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                  )}
                  <span className={cn(
                    'text-sm truncate',
                    isSelected ? 'font-semibold text-indigo-700' : 'text-gray-700'
                  )}>
                    {opt.text}
                  </span>
                </div>
                {(hasVoted || isExpired || isOwn) && (
                  <span className={cn(
                    'text-xs font-semibold flex-shrink-0 ml-2',
                    isSelected ? 'text-indigo-600' : 'text-gray-400'
                  )}>
                    {pct}%
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span>{data.totalVotes} vote{data.totalVotes !== 1 ? 's' : ''}</span>
        {hasVoted && <span>· You voted</span>}
        {isOwn   && <span>· Your poll</span>}
        {isExpired && <span>· Poll closed</span>}
      </div>
    </div>
  )
}
