'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useToast } from '@/components/ui/use-toast'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts'
import {
  BarChart3, Users, GraduationCap, CheckCircle2, TrendingUp,
  MessageSquare, Gift, Coins, RefreshCw, Loader2, School,
  Activity, Calendar, ChevronDown
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DailySchoolStat {
  date: string; studentCount: number; teacherCount: number; classCount: number
  attendanceRate: number; averageGrade: number; behaviorScore: number
  totalPosts: number; totalMessages: number; totalGifts: number; totalCoins: number
}
interface SchoolAnalytics {
  period: string; startDate: string; endDate: string
  stats: DailySchoolStat[]
  aggregates: {
    totalStudents: number; totalTeachers: number; totalClasses: number
    avgAttendanceRate: number; avgGrade: number
    totalPosts: number; totalMessages: number; totalGifts: number; totalCoins: number
  }
}

const PERIODS = [
  { label: '7 days',  value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
  { label: '1 year',  value: '1y' },
]

const COLORS = ['#4f46e5','#7c3aed','#0ea5e9','#10b981','#f59e0b','#ef4444']

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, color, trend }: {
  label: string; value: string | number; sub?: string
  icon: React.ReactNode; color: string; trend?: number
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-4">
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
        {trend != null && (
          <p className={cn('text-[10px] font-semibold mt-0.5', trend >= 0 ? 'text-green-600' : 'text-red-500')}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Chart card ──────────────────────────────────────────────────────────────
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <h3 className="font-bold text-gray-800 text-sm mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <span className="font-bold">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span></p>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [period, setPeriod] = useState('30d')
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)

  const schoolId = user?.schoolId ?? ''
  // SA-ANALYTICS-01: SUPER_ADMIN platform role does NOT grant school analytics access.
  // School analytics is a school-scoped action (SCHOOL_ADMIN or TEACHER membership role).
  const canView = user?.role === 'SCHOOL_ADMIN' || (effectiveRole === 'TEACHER' || isAdmin)

  // ── School analytics ──────────────────────────────────────────────────────
  const { data: schoolData, isLoading } = useQuery<SchoolAnalytics>({
    queryKey: ['school-analytics', schoolId, period],
    queryFn: () => api.get(`/analytics/schools/${schoolId}/analytics`, { params: { period } }).then(r => r.data.data),
    enabled: !!schoolId && canView,
    staleTime: 60000,
  })

  // ── User personal analytics ───────────────────────────────────────────────
  const { data: userData } = useQuery({
    queryKey: ['user-analytics', user?.id, period],
    queryFn: () => api.get(`/analytics/users/${user!.id}/analytics`, { params: { period } }).then(r => r.data.data),
    enabled: !!user?.id,
    staleTime: 60000,
  })

  // ── Refresh / recalculate ─────────────────────────────────────────────────
  const refreshMutation = useMutation({
    mutationFn: () => api.get(`/analytics/schools/${schoolId}/daily-stats/${format(new Date(), 'yyyy-MM-dd')}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['school-analytics'] }); toast({ title: 'Stats refreshed' }) },
    onError: () => toast({ title: 'Refresh failed', variant: 'destructive' }),
  })

  const agg = schoolData?.aggregates
  const stats = schoolData?.stats ?? []
  const userAgg = userData?.aggregates

  // Format chart data
  const chartData = stats.map(s => ({
    date: format(new Date(s.date), 'MMM d'),
    Attendance: parseFloat(s.attendanceRate?.toFixed(1) ?? '0'),
    'Avg Grade': parseFloat(s.averageGrade?.toFixed(1) ?? '0'),
    Posts: s.totalPosts,
    Messages: s.totalMessages,
    Gifts: s.totalGifts,
  }))

  const pieData = agg ? [
    { name: 'Students',  value: agg.totalStudents },
    { name: 'Teachers',  value: agg.totalTeachers },
    { name: 'Classes',   value: agg.totalClasses },
  ] : []

  if (!canView && user) {
    // Personal stats view for students/guardians
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-6 h-6 text-indigo-600" /> My Activity
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Your personal stats for the last {period}</p>
          </div>
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </div>

        {userAgg && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard label="Posts Created"    value={userAgg.totalPosts}        icon={<BarChart3 className="w-5 h-5 text-indigo-500" />} color="bg-indigo-50" />
            <StatCard label="Messages Sent"    value={userAgg.totalMessages}      icon={<MessageSquare className="w-5 h-5 text-blue-500" />} color="bg-blue-50" />
            <StatCard label="Gifts Sent"       value={userAgg.totalGiftsSent}     icon={<Gift className="w-5 h-5 text-pink-500" />} color="bg-pink-50" />
            <StatCard label="Voice Minutes"    value={`${userAgg.totalVoiceMinutes}m`} icon={<Activity className="w-5 h-5 text-violet-500" />} color="bg-violet-50" />
            <StatCard label="Likes Received"   value={userAgg.totalLikesReceived} icon={<TrendingUp className="w-5 h-5 text-green-500" />} color="bg-green-50" />
            <StatCard label="Coins Earned"     value={userAgg.totalCoinsEarned}   icon={<Coins className="w-5 h-5 text-yellow-500" />} color="bg-yellow-50" />
            <StatCard label="Coins Spent"      value={userAgg.totalCoinsSpent}    icon={<Coins className="w-5 h-5 text-orange-500" />} color="bg-orange-50" />
            <StatCard label="Total Logins"     value={userAgg.totalLogins}        icon={<CheckCircle2 className="w-5 h-5 text-teal-500" />} color="bg-teal-50" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600" /> Analytics Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">School performance overview</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector period={period} setPeriod={setPeriod} />
          {canView && (
            <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              {refreshMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-white border border-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Students"    value={agg?.totalStudents ?? 0}             icon={<GraduationCap className="w-5 h-5 text-indigo-500" />} color="bg-indigo-50" />
            <StatCard label="Total Teachers"    value={agg?.totalTeachers ?? 0}             icon={<Users className="w-5 h-5 text-blue-500" />} color="bg-blue-50" />
            <StatCard label="Avg Attendance"    value={`${(agg?.avgAttendanceRate ?? 0).toFixed(1)}%`} icon={<CheckCircle2 className="w-5 h-5 text-green-500" />} color="bg-green-50" />
            <StatCard label="Avg Grade"         value={`${(agg?.avgGrade ?? 0).toFixed(1)}`}icon={<TrendingUp className="w-5 h-5 text-yellow-500" />} color="bg-yellow-50" />
            <StatCard label="Total Posts"       value={agg?.totalPosts ?? 0}                icon={<BarChart3 className="w-5 h-5 text-violet-500" />} color="bg-violet-50" />
            <StatCard label="Total Messages"    value={agg?.totalMessages ?? 0}             icon={<MessageSquare className="w-5 h-5 text-sky-500" />} color="bg-sky-50" />
            <StatCard label="Total Gifts Sent"  value={agg?.totalGifts ?? 0}               icon={<Gift className="w-5 h-5 text-pink-500" />} color="bg-pink-50" />
            <StatCard label="Coins in Circulation" value={(agg?.totalCoins ?? 0).toLocaleString()} icon={<Coins className="w-5 h-5 text-orange-500" />} color="bg-orange-50" />
          </div>

          {/* Charts */}
          {chartData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Attendance trend */}
              <ChartCard title="📋 Attendance Rate (%)">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="Attendance" stroke="#4f46e5" fill="url(#attGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Average grade trend */}
              <ChartCard title="📊 Average Grade">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="Avg Grade" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Social activity */}
              <ChartCard title="🌐 Social Activity (Posts + Messages)">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} barSize={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Posts"    fill="#4f46e5" radius={[4,4,0,0]} />
                    <Bar dataKey="Messages" fill="#7c3aed" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* School composition pie */}
              <ChartCard title="🏫 School Composition">
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => [v, '']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {pieData.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i] }} />
                        <div>
                          <p className="text-xs font-semibold text-gray-700">{d.name}</p>
                          <p className="text-lg font-bold text-gray-900">{d.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-100 rounded-2xl text-gray-400">
              <BarChart3 className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-semibold text-gray-500">No data yet for this period</p>
              <p className="text-sm mt-1">Stats are collected daily as the school operates</p>
              <button onClick={() => refreshMutation.mutate()} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Generate Today's Stats
              </button>
            </div>
          )}

          {/* My personal stats */}
          {userAgg && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" /> My Activity ({PERIODS.find(p => p.value === period)?.label})
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Posts"        value={userAgg.totalPosts}         icon={<BarChart3 className="w-4 h-4 text-indigo-500" />}  color="bg-indigo-50" />
                <StatCard label="Voice min"    value={`${userAgg.totalVoiceMinutes}m`} icon={<Activity className="w-4 h-4 text-violet-500" />} color="bg-violet-50" />
                <StatCard label="Gifts sent"   value={userAgg.totalGiftsSent}     icon={<Gift className="w-4 h-4 text-pink-500" />}         color="bg-pink-50" />
                <StatCard label="Coins earned" value={userAgg.totalCoinsEarned}   icon={<Coins className="w-4 h-4 text-yellow-500" />}      color="bg-yellow-50" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Period selector dropdown ─────────────────────────────────────────────────
function PeriodSelector({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const label = PERIODS.find(p => p.value === period)?.label ?? period
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
        <Calendar className="w-3.5 h-3.5 text-gray-400" /> {label}
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-20 min-w-[120px]">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => { setPeriod(p.value); setOpen(false) }}
              className={cn('w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors',
                period === p.value ? 'text-indigo-600 font-semibold' : 'text-gray-700')}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
