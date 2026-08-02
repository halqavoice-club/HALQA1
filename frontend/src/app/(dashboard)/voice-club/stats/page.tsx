'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import api from '@/lib/api'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { ArrowLeft, Mic, Clock, Users, MessageSquare, Flame, Trophy } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LevelInfo {
  level: number; title: string; emoji: string; color: string
  totalXp: number; xpInLevel: number; xpNeeded: number; progress: number
  next: { title: string; emoji: string; minXp: number } | null
}

interface DayStats {
  date: string
  roomsHosted: number
  totalMinutes: number
  peakAudience: number
  totalListeners: number
  totalSpeakers: number
  totalMessages: number
}

interface StatsData {
  level: LevelInfo
  allTime: {
    roomsHosted: number; totalMinutes: number; totalListeners: number
    totalSpeakers: number; totalMessages: number; peakAudience: number
  }
  streak: number
  chart: DayStats[]
  recentRooms: {
    id: string; title: string; coverEmoji: string; coverImageUrl?: string | null
    topic: string | null
    startedAt: string | null; endedAt: string | null
    _count: { participants: number; messages: number }
  }[]
  levels: { level: number; title: string; emoji: string; minXp: number; color: string }[]
}

interface LeaderEntry {
  rank: number
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  totalXp: number
  totalMinutes: number
  roomsHosted: number
  level: LevelInfo
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + '20' }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Level badge ──────────────────────────────────────────────────────────────
function LevelBadge({ level, size = 'md' }: { level: LevelInfo; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'text-xs px-2 py-0.5', md: 'text-sm px-3 py-1', lg: 'text-base px-4 py-1.5' }
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full font-bold', sizes[size])}
      style={{ background: level.color + '20', color: level.color, border: `1.5px solid ${level.color}40` }}
    >
      {level.emoji} {level.title}
    </span>
  )
}

// ─── Custom bar tooltip ───────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      <p className="text-purple-600">🎙️ {payload[0]?.value} room{payload[0]?.value !== 1 ? 's' : ''}</p>
      <p className="text-blue-500">⏱ {payload[1]?.value} min</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VoiceStatsPage() {
  const { user } = useAuthStore()

  const { data: stats, isLoading } = useQuery<StatsData>({
    queryKey: ['voice-stats-me'],
    queryFn: () => api.get('/voice/stats/me').then(r => r.data.data),
    staleTime: 60000
  })

  const { data: leaderboard } = useQuery<LeaderEntry[]>({
    queryKey: ['voice-leaderboard'],
    queryFn: () => api.get('/voice/stats/leaderboard').then(r => r.data.data),
    staleTime: 120000
  })

  if (isLoading || !stats) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
        <div className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  const { level, allTime, streak, chart, recentRooms, levels } = stats

  // Format chart data
  const chartData = chart.map(d => ({
    day: format(typeof d.date === 'string' ? parseISO(d.date) : new Date(d.date), 'MMM d'),
    rooms: d.roomsHosted,
    minutes: d.totalMinutes
  }))

  const totalHours = Math.floor(allTime.totalMinutes / 60)
  const remainMins = allTime.totalMinutes % 60

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-8">

      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link href="/voice-club" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Voice Club
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">My Stats</span>
      </div>

      {/* ── Level card ──────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 text-white relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${level.color}, ${level.color}cc)` }}
      >
        {/* Background decoration */}
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-20 bg-white" />
        <div className="absolute -right-4 -bottom-6 w-20 h-20 rounded-full opacity-10 bg-white" />

        <div className="relative">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-white/70 text-xs font-medium uppercase tracking-wide">Your Level</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-3xl">{level.emoji}</span>
                <div>
                  <h2 className="text-2xl font-black leading-none">{level.title}</h2>
                  <p className="text-white/70 text-xs mt-0.5">Level {level.level}</p>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs">Total XP</p>
              <p className="text-2xl font-black">{level.totalXp.toLocaleString()}</p>
            </div>
          </div>

          {/* XP progress bar */}
          {level.next && (
            <div>
              <div className="flex justify-between text-xs text-white/70 mb-1">
                <span>{level.xpInLevel} XP</span>
                <span>{level.next.emoji} {level.next.title} at {level.next.minXp} XP</span>
              </div>
              <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${level.progress}%` }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
                />
              </div>
              <p className="text-xs text-white/60 mt-1 text-right">{level.progress}% to next level</p>
            </div>
          )}
          {!level.next && (
            <div className="mt-2 text-center">
              <span className="text-white/80 text-sm font-semibold">🏆 Maximum level reached!</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Streak + quick stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="col-span-2 sm:col-span-1 bg-gradient-to-br from-orange-400 to-red-500 rounded-2xl p-4 text-white flex items-center gap-3"
        >
          <Flame className="w-8 h-8 flex-shrink-0" />
          <div>
            <p className="text-white/80 text-xs font-medium">Day Streak</p>
            <p className="text-3xl font-black leading-none">{streak}</p>
            <p className="text-white/70 text-xs">{streak === 1 ? 'day' : 'days'} in a row</p>
          </div>
        </motion.div>

        <StatCard icon={<Mic className="w-5 h-5" />} label="Rooms Hosted" value={allTime.roomsHosted} color="#8b5cf6" />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Time on Air"
          value={totalHours > 0 ? `${totalHours}h ${remainMins}m` : `${allTime.totalMinutes}m`}
          color="#3b82f6"
        />
        <StatCard icon={<Users className="w-5 h-5" />} label="Total Listeners" value={allTime.totalListeners} sub={`Peak: ${allTime.peakAudience}`} color="#10b981" />
        <StatCard icon={<Users className="w-5 h-5" />} label="Speakers Promoted" value={allTime.totalSpeakers} color="#f59e0b" />
        <StatCard icon={<MessageSquare className="w-5 h-5" />} label="Chat Messages" value={allTime.totalMessages} color="#ec4899" />
      </div>

      {/* ── Level roadmap ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-3">Level Roadmap</h3>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {levels.map((l, i) => {
            const isReached = level.totalXp >= l.minXp
            const isCurrent = level.level === l.level
            return (
              <div key={l.level} className="flex items-center gap-1 flex-shrink-0">
                <div className={cn(
                  'flex flex-col items-center gap-1 px-2 py-1.5 rounded-xl transition-all',
                  isCurrent ? 'ring-2 ring-offset-1' : '',
                  isReached ? 'opacity-100' : 'opacity-40'
                )} style={isCurrent ? { outline: `2px solid ${l.color}`, outlineOffset: '2px' } : {}}>
                  <span className="text-lg">{l.emoji}</span>
                  <span className="text-[10px] font-semibold text-gray-600">{l.title}</span>
                  <span className="text-[9px] text-gray-400">{l.minXp} XP</span>
                </div>
                {i < levels.length - 1 && (
                  <div className={cn('w-4 h-0.5 flex-shrink-0', isReached && level.level > l.level ? 'bg-gray-400' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 30-day activity chart ────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">30-Day Activity</h3>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" /> Rooms</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" /> Minutes</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} barGap={2} barCategoryGap="20%">
            <XAxis
              dataKey="day"
              tick={{ fontSize: 9, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              interval={4}
            />
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f3f4f6' }} />
            <Bar dataKey="rooms" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={12} />
            <Bar dataKey="minutes" fill="#60a5fa" radius={[3, 3, 0, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Recent rooms ─────────────────────────────────────────────── */}
      {recentRooms.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Recent Rooms</h3>
          <div className="space-y-2">
            {recentRooms.map(room => {
              const start = room.startedAt ? new Date(room.startedAt) : null
              const end   = room.endedAt   ? new Date(room.endedAt)   : null
              const mins  = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null
              return (
                <div key={room.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  {room.coverImageUrl ? (
                    <img
                      src={getFileUrl(room.coverImageUrl)}
                      alt=""
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <span className="text-xl flex-shrink-0">{room.coverEmoji || '🎙️'}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{room.title}</p>
                    <p className="text-xs text-gray-400">
                      {end ? format(end, 'MMM d, yyyy') : '—'}
                      {mins !== null && ` · ${mins}m`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                    <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{room._count.participants}</span>
                    <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{room._count.messages}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Leaderboard ──────────────────────────────────────────────── */}
      {leaderboard && leaderboard.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-gray-700">Top Hosts</h3>
          </div>
          <div className="space-y-2">
            {leaderboard.map(entry => {
              const isMe = entry.user?.id === user?.id
              return (
                <div key={entry.rank} className={cn(
                  'flex items-center gap-3 py-2 px-2 rounded-xl transition-colors',
                  isMe ? 'bg-purple-50' : 'hover:bg-gray-50'
                )}>
                  <span className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0',
                    entry.rank === 1 ? 'bg-amber-400 text-white' :
                    entry.rank === 2 ? 'bg-gray-300 text-gray-700' :
                    entry.rank === 3 ? 'bg-orange-300 text-white' :
                    'bg-gray-100 text-gray-500'
                  )}>
                    {entry.rank}
                  </span>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-purple-100 flex-shrink-0">
                    {entry.user?.avatarUrl
                      ? <img src={getAvatarUrl(entry.user.avatarUrl)} alt="" className="w-full h-full object-cover" />
                      : <span className="w-full h-full flex items-center justify-center text-xs font-bold text-purple-600">
                          {entry.user?.firstName?.[0]}{entry.user?.lastName?.[0]}
                        </span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold truncate', isMe ? 'text-purple-700' : 'text-gray-800')}>
                      {isMe ? 'You' : `${entry.user?.firstName} ${entry.user?.lastName}`}
                    </p>
                    <p className="text-xs text-gray-400">{entry.roomsHosted} rooms · {entry.totalMinutes}m</p>
                  </div>
                  <div className="flex-shrink-0">
                    <LevelBadge level={entry.level} size="sm" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* XP formula hint */}
      <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-400 text-center">
        XP = Rooms×10 + Minutes×1 + Listeners×2 + Speakers×5 + Messages×1
      </div>
    </div>
  )
}
