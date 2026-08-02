'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import {
  Users, GraduationCap, BookOpen, UserCheck,
  TrendingUp, CheckCircle, XCircle, Clock, AlertCircle,
  MessageSquare, Calendar, Star, Headphones
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import { PrayerTimesWidget } from '@/components/islamic/prayer-times'
import { HijriDate } from '@/components/islamic/hijri-date'
import { useTranslation } from '@/hooks/useTranslation'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts'
import { format } from 'date-fns'
import Link from 'next/link'

export function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => api.get('/dashboard/admin').then(r => r.data.data)
  })
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-gray-200 rounded-xl animate-pulse" />
          <div className="h-64 bg-gray-200 rounded-xl animate-pulse" />
        </div>
      </div>
    )
  }

  const stats = [
    { label: t.students, value: data?.overview?.totalStudents || 0, icon: GraduationCap, color: 'bg-blue-500', href: '/students' },
    { label: t.teachers, value: data?.overview?.totalTeachers || 0, icon: UserCheck, color: 'bg-green-500', href: '/teachers' },
    { label: t.classes,  value: data?.overview?.totalClasses || 0,  icon: BookOpen,    color: 'bg-purple-500', href: '/classes' },
    { label: t.guardians,value: data?.overview?.totalGuardians || 0,icon: Users,       color: 'bg-orange-500', href: '/guardians' },
  ]

  const attendance = data?.todayAttendance || {}
  const trend = data?.attendanceTrend || []

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <HijriDate compact />
        </div>
      </div>

      {/* Today's summary banner */}
      {attendance.percentage !== undefined && (
        <div className={`rounded-xl p-4 flex items-center gap-4 ${
          attendance.percentage >= 80
            ? 'bg-gradient-to-r from-green-600 to-green-500'
            : attendance.percentage >= 60
            ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
            : 'bg-gradient-to-r from-red-600 to-red-500'
        } text-white`}>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-lg">{attendance.percentage}% Attendance Today</p>
            <p className="text-sm opacity-80">
              {attendance.present || 0} present Â· {attendance.absent || 0} absent Â· {attendance.late || 0} late
            </p>
          </div>
          <Link href="/attendance">
            <button className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              View â†’
            </button>
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(stat => {
          const Icon = stat.icon
          return (
            <Link key={stat.label} href={stat.href}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    </div>
                    <div className={`${stat.color} p-3 rounded-xl`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Attendance trend chart */}
        <Card className="md:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span>7-Day Attendance Trend</span>
              <div className="flex items-center gap-3 text-xs font-normal text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Present</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Absent</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />Late</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No attendance data yet</div>
            ) : (
              <NoSSRChart>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="present" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => format(new Date(d), 'MMM d')} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={d => format(new Date(d), 'MMM d, yyyy')} />
                    <Area type="monotone" dataKey="present" stroke="#10b981" fill="url(#present)" strokeWidth={2} />
                    <Area type="monotone" dataKey="absent" stroke="#ef4444" fill="none" strokeWidth={2} strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="late" stroke="#f59e0b" fill="none" strokeWidth={2} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </NoSSRChart>
            )}

            {/* Today's summary */}
            <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-gray-100">
              {[
                { label: 'Present', value: attendance.present || 0, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
                { label: 'Absent', value: attendance.absent || 0, icon: XCircle, color: 'text-red-600 bg-red-50' },
                { label: 'Late', value: attendance.late || 0, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
                { label: 'Rate', value: `${attendance.percentage || 0}%`, icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
              ].map(item => {
                const Icon = item.icon
                return (
                  <div key={item.label} className={`${item.color} rounded-lg p-2 text-center`}>
                    <Icon className="w-4 h-4 mx-auto mb-0.5" />
                    <p className="text-lg font-bold">{item.value}</p>
                    <p className="text-xs font-medium">{item.label}</p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming events */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-halqa-600" /> Upcoming
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {(data?.upcomingEvents || []).slice(0, 5).map((event: any) => (
                <div key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-9 h-9 bg-halqa-50 rounded-lg flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-halqa-600 uppercase">{format(new Date(event.startDate), 'MMM')}</span>
                    <span className="text-sm font-bold text-halqa-900 leading-none">{format(new Date(event.startDate), 'd')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                    <p className="text-xs text-gray-400">{event.type}</p>
                  </div>
                </div>
              ))}
              {(!data?.upcomingEvents || data.upcomingEvents.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-6">No upcoming events</p>
              )}
            </div>
            <div className="p-3 border-t border-gray-100">
              <Link href="/calendar" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">View calendar â†’</Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent behavior */}        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><Star className="w-4 h-4 text-yellow-500" /> Recent Behavior</span>
              <Link href="/behavior" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">View all â†’</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {(data?.recentBehavior || []).map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    log.type === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {log.type === 'POSITIVE' ? '+' : ''}{log.points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {log.student?.user?.firstName} {log.student?.user?.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{log.category}</p>
                  </div>
                  <Badge variant={log.type === 'POSITIVE' ? 'default' : 'destructive'} className="text-xs flex-shrink-0">
                    {log.type === 'POSITIVE' ? 'ðŸ‘' : 'ðŸ‘Ž'}
                  </Badge>
                </div>
              ))}
              {(!data?.recentBehavior || data.recentBehavior.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-6">No behavior logs yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick links */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: t.markAttendance,  href: '/attendance',   icon: CheckCircle,  color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                { label: t.addStudent,      href: '/students/new', icon: GraduationCap,color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
                { label: t.announcements,   href: '/announcements',icon: MessageSquare,color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
                { label: t.audio,           href: '/audio',        icon: Headphones,   color: 'bg-halqa-50 text-halqa-700 hover:bg-halqa-100' },
                { label: t.reports,         href: '/reports',      icon: TrendingUp,   color: 'bg-orange-50 text-orange-700 hover:bg-orange-100' },
                { label: t.import,          href: '/import',       icon: Users,        color: 'bg-gray-50 text-gray-700 hover:bg-gray-100' },
              ].map(item => {
                const Icon = item.icon
                return (
                  <Link key={item.label} href={item.href}>
                    <div className={`${item.color} rounded-xl p-3 flex items-center gap-2.5 transition-colors cursor-pointer`}>
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Islamic Widget */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-3">
          <PrayerTimesWidget />
        </div>
      </div>
    </div>
  )
}
