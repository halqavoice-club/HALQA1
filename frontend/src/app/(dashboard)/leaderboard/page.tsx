'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { Trophy, Medal, Star, Coins, Gift, Users, BarChart3, Crown, RefreshCw, Loader2 } from 'lucide-react'
import { LeaderboardSkeleton } from '@/components/skeletons/LeaderboardSkeleton'

type PeriodType = 'ALL_TIME' | 'WEEKLY' | 'MONTHLY'

interface LeaderEntry {
  rank: number; previousRank?: number | null
  totalCoins: number; totalDiamonds: number; totalGifts: number
  totalPosts: number; totalFollowers: number; period: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

const PERIODS: { label: string; value: PeriodType }[] = [
  { label: 'All Time', value: 'ALL_TIME' },
  { label: 'Monthly',  value: 'MONTHLY' },
  { label: 'Weekly',   value: 'WEEKLY' },
]

// ─── Rank medal ──────────────────────────────────────────────────────────────
function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />
  return <span className="text-sm font-bold text-gray-400 w-5 text-center">{rank}</span>
}

// ─── Rank change indicator ────────────────────────────────────────────────────
function RankChange({ current, previous }: { current: number; previous?: number | null }) {
  if (previous == null) return null
  const diff = previous - current
  if (diff === 0) return <span className="text-[10px] text-gray-300">—</span>
  return (
    <span className={cn('text-[10px] font-bold', diff > 0 ? 'text-green-500' : 'text-red-400')}>
      {diff > 0 ? `↑${diff}` : `↓${Math.abs(diff)}`}
    </span>
  )
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────
function LeaderRow({ entry, highlight }: { entry: LeaderEntry; highlight: boolean }) {
  const src = entry.user.avatarUrl ? getAvatarUrl(entry.user.avatarUrl) : null
  const initials = `${entry.user.firstName[0] ?? ''}${entry.user.lastName[0] ?? ''}`.toUpperCase()
  const topThree = entry.rank <= 3
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors',
      highlight ? 'bg-indigo-50 border border-indigo-200' : topThree ? 'bg-amber-50/50' : 'hover:bg-gray-50'
    )}>
      {/* Rank */}
      <div className="w-7 flex items-center justify-center flex-shrink-0">
        <RankIcon rank={entry.rank} />
      </div>

      {/* Avatar */}
      <div className={cn('w-9 h-9 rounded-full overflow-hidden flex items-center justify-center font-bold text-sm flex-shrink-0',
        topThree ? 'ring-2 ring-offset-1' : '',
        entry.rank === 1 ? 'ring-yellow-400' : entry.rank === 2 ? 'ring-gray-400' : entry.rank === 3 ? 'ring-amber-600' : '',
        'bg-indigo-100 text-indigo-700'
      )}>
        {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold truncate', highlight ? 'text-indigo-700' : 'text-gray-900')}>
          {entry.user.firstName} {entry.user.lastName}
          {highlight && <span className="ml-1 text-[10px] text-indigo-400 font-normal">(you)</span>}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            <Coins className="w-2.5 h-2.5" />{entry.totalCoins.toLocaleString()}
          </span>
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            <Gift className="w-2.5 h-2.5" />{entry.totalGifts}
          </span>
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            <Users className="w-2.5 h-2.5" />{entry.totalFollowers}
          </span>
        </div>
      </div>

      {/* Rank change + score */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <RankChange current={entry.rank} previous={entry.previousRank} />
        <span className="text-xs font-bold text-gray-700">{entry.totalCoins.toLocaleString()}</span>
        <span className="text-[9px] text-gray-400">coins</span>
      </div>
    </div>
  )
}

// ─── Top 3 podium ─────────────────────────────────────────────────────────────
function Podium({ entries }: { entries: LeaderEntry[] }) {
  const top3 = [entries[1], entries[0], entries[2]].filter(Boolean) // 2nd, 1st, 3rd
  const heights = ['h-20', 'h-28', 'h-16']
  const colors  = ['bg-gray-200', 'bg-yellow-400', 'bg-amber-500']
  const ranks   = [2, 1, 3]
  return (
    <div className="flex items-end justify-center gap-3 mb-6">
      {top3.map((entry, i) => {
        if (!entry) return <div key={i} className="w-20" />
        const src = entry.user.avatarUrl ? getAvatarUrl(entry.user.avatarUrl) : null
        const init = `${entry.user.firstName[0] ?? ''}${entry.user.lastName[0] ?? ''}`.toUpperCase()
        return (
          <div key={entry.user.id} className="flex flex-col items-center gap-1.5 w-20">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-700 ring-2 ring-offset-1 ring-indigo-200 text-sm">
              {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : init}
            </div>
            <p className="text-xs font-semibold text-gray-800 text-center truncate w-full px-1">{entry.user.firstName}</p>
            <p className="text-[10px] text-gray-500">{entry.totalCoins.toLocaleString()} 🪙</p>
            <div className={cn('w-full rounded-t-lg flex items-end justify-center pb-2', heights[i], colors[i])}>
              <span className="text-lg font-black text-white/90">#{ranks[i]}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab]     = useState<'global' | 'school'>('global')
  const [period, setPeriod] = useState<PeriodType>('ALL_TIME')

  const schoolId = user?.schoolId ?? ''

  const { data: globalData, isLoading: globalLoading } = useQuery<LeaderEntry[]>({
    queryKey: ['leaderboard-global', period],
    queryFn: () => api.get('/leaderboard/global', { params: { period, limit: 100 } }).then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  const { data: schoolData, isLoading: schoolLoading } = useQuery<LeaderEntry[]>({
    queryKey: ['leaderboard-school', schoolId, period],
    queryFn: () => api.get(`/leaderboard/schools/${schoolId}`, { params: { period, limit: 100 } }).then(r => r.data.data ?? []),
    enabled: !!schoolId && tab === 'school',
    staleTime: 60000,
  })

  const recalcMutation = useMutation({
    mutationFn: () => tab === 'global'
      ? api.post('/leaderboard/global/recalculate', { period })
      : api.post(`/leaderboard/schools/${schoolId}/recalculate`, { period }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
      toast({ title: 'Leaderboard recalculated' })
    },
    onError: () => toast({ title: 'Recalculation failed', variant: 'destructive' }),
  })

  const entries = tab === 'global' ? (globalData ?? []) : (schoolData ?? [])
  const isLoading = tab === 'global' ? globalLoading : schoolLoading
  const myEntry   = entries.find(e => e.user.id === user?.id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-500" /> Leaderboards
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Top users ranked by coins earned</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period pills */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  period === p.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {p.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button onClick={() => recalcMutation.mutate()} disabled={recalcMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              {recalcMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Recalculate
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {([['global','🌐 Global'],['school','🏫 My School']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {label}
          </button>
        ))}
      </div>

      {/* My rank banner */}
      {myEntry && (
        <div className="flex items-center gap-4 p-4 bg-indigo-600 rounded-2xl text-white">
          <Trophy className="w-8 h-8 text-yellow-300 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold opacity-80">Your Rank</p>
            <p className="text-2xl font-black">#{myEntry.rank}</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-70">Coins</p>
            <p className="text-xl font-bold">{myEntry.totalCoins.toLocaleString()}</p>
          </div>
          <RankChange current={myEntry.rank} previous={myEntry.previousRank} />
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {isLoading ? (
          <LeaderboardSkeleton count={10} showPodium={true} />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Trophy className="w-12 h-12 mb-3 opacity-20" />
            <p className="font-semibold text-gray-500">No entries yet</p>
            {isAdmin && (
              <button onClick={() => recalcMutation.mutate()}
                className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Generate Leaderboard
              </button>
            )}
          </div>
        ) : (
          <div className="p-4">
            {entries.length >= 3 && <Podium entries={entries.slice(0, 3)} />}
            <div className="space-y-1">
              {entries.map(entry => (
                <LeaderRow key={entry.user.id} entry={entry} highlight={entry.user.id === user?.id} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
