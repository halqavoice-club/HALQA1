'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { BookOpen, Users, ClipboardCheck, Star, TrendingUp, Calendar, Headphones, Plus } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { PrayerTimesWidget } from '@/components/islamic/prayer-times'
import { HijriDate } from '@/components/islamic/hijri-date'
import { useTranslation } from '@/hooks/useTranslation'

export function TeacherDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'teacher'],
    queryFn: () => api.get('/dashboard/teacher').then(r => r.data.data)
  })
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-64 bg-gray-200 rounded-xl animate-pulse" />
      </div>
    )
  }

  const classes = data?.classes || []
  const todayAttendance = data?.todayAttendance || []
  const recentBehavior = data?.recentBehavior || []
  const upcomingEvents = data?.upcomingEvents || []

  // Build attendance bar data
  const attendanceChartData = todayAttendance.map((item: any) => ({
    status: item.status,
    count: item._count?.status || 0,
    color: item.status === 'PRESENT' ? '#10b981' : item.status === 'ABSENT' ? '#ef4444' : item.status === 'LATE' ? '#f59e0b' : '#3b82f6'
  }))

  const totalToday = attendanceChartData.reduce((s: number, d: any) => s + d.count, 0)
  const presentToday = attendanceChartData.find((d: any) => d.status === 'PRESENT')?.count || 0
  const attendanceRate = totalToday > 0 ? Math.round((presentToday / totalToday) * 100) : 0

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
            <HijriDate compact />
          </div>
        </div>
        <Link href="/attendance">
          <button className="bg-halqa-700 hover:bg-halqa-800 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <ClipboardCheck className="w-4 h-4" /> Mark Attendance
          </button>
        </Link>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'My Classes', value: classes.length, icon: BookOpen, color: 'bg-halqa-500', href: '/classes' },
          { label: 'Total Students', value: classes.reduce((s: number, c: any) => s + (c.studentCount || 0), 0), icon: Users, color: 'bg-blue-500', href: '/students' },
          { label: "Today's Rate", value: `${attendanceRate}%`, icon: TrendingUp, color: attendanceRate >= 80 ? 'bg-green-500' : 'bg-orange-500', href: '/attendance' },
          { label: 'Behavior Logs', value: recentBehavior.length, icon: Star, color: 'bg-yellow-500', href: '/behavior' },
        ].map(stat => {
          const Icon = stat.icon
          return (
            <Link key={stat.label} href={stat.href}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    </div>
                    <div className={`${stat.color} p-2.5 rounded-xl`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* My Classes */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-halqa-600" /> My Classes</span>
              <Link href="/classes/new" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium flex items-center gap-1">
                <Plus className="w-3 h-3" /> New
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {classes.map((cls: any) => (
                <Link key={cls.id} href={`/classes/${cls.id}`}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 bg-halqa-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <BookOpen className="w-4 h-4 text-halqa-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{cls.name}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {cls.studentCount} students
                      </p>
                    </div>
                    {cls.isLead && <Badge className="text-xs bg-halqa-100 text-halqa-700 flex-shrink-0">Lead</Badge>}
                  </div>
                </Link>
              ))}
              {classes.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No classes assigned</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Today's attendance */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-green-600" /> Today's Attendance</span>
              <Link href="/attendance" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">Mark →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attendanceChartData.length === 0 ? (
              <div className="text-center py-6">
                <ClipboardCheck className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No attendance marked today</p>
                <Link href="/attendance">
                  <button className="mt-3 text-xs bg-halqa-700 text-white px-3 py-1.5 rounded-lg hover:bg-halqa-800 transition-colors">
                    Mark Now
                  </button>
                </Link>
              </div>
            ) : (
              <>
                <NoSSRChart>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={attendanceChartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {attendanceChartData.map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </NoSSRChart>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-500">Attendance rate today</span>
                  <span className={`text-sm font-bold ${attendanceRate >= 80 ? 'text-green-600' : 'text-orange-600'}`}>
                    {attendanceRate}%
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent behavior */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><Star className="w-4 h-4 text-yellow-500" /> Recent Behavior</span>
              <Link href="/behavior" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">View all →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {recentBehavior.slice(0, 4).map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    log.type === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {log.type === 'POSITIVE' ? '+' : ''}{log.points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {log.student?.user?.firstName} {log.student?.user?.lastName}
                    </p>
                    <p className="text-xs text-gray-400">{log.category}</p>
                  </div>
                </div>
              ))}
              {recentBehavior.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No behavior logs yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming events + quick links */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-halqa-600" /> Upcoming Events
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {upcomingEvents.slice(0, 4).map((event: any) => (
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
              {upcomingEvents.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No upcoming events</p>
              )}
            </div>
            <div className="p-3 border-t border-gray-100 flex gap-2">
              <Link href="/audio" className="flex-1 text-center text-xs bg-halqa-50 text-halqa-700 hover:bg-halqa-100 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1">
                <Headphones className="w-3 h-3" /> Audio Lessons
              </Link>
              <Link href="/grades" className="flex-1 text-center text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 py-2 rounded-lg font-medium transition-colors">
                Add Grades
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Islamic Widget */}
      <PrayerTimesWidget />
    </div>
  )
}
