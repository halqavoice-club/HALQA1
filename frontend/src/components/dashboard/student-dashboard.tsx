'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, BookMarked, Star, QrCode, Bell, Headphones, Calendar, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { PrayerTimesWidget } from '@/components/islamic/prayer-times'
import { HijriDate } from '@/components/islamic/hijri-date'
import { useTranslation } from '@/hooks/useTranslation'

export function StudentDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'student'],
    queryFn: () => api.get('/dashboard/student').then(r => r.data.data)
  })
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-48 bg-gray-200 rounded-xl animate-pulse" />
      </div>
    )
  }

  const attendance = data?.attendance || {}
  const behaviorPoints = data?.behaviorPoints || 0
  const recentGrades = data?.recentGrades || []
  const upcomingEvents = data?.upcomingEvents || []
  const notifications = data?.notifications || []

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <HijriDate compact />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t.attendance,    value: `${attendance.percentage || 0}%`, icon: CheckCircle, color: (attendance.percentage || 0) >= 80 ? 'bg-green-500' : 'bg-orange-500', href: '/attendance' },
          { label: t.grades,       value: recentGrades.length,              icon: BookMarked,  color: 'bg-blue-500',   href: '/grades' },
          { label: 'Points',       value: `${behaviorPoints >= 0 ? '+' : ''}${behaviorPoints}`, icon: Star, color: behaviorPoints >= 0 ? 'bg-yellow-500' : 'bg-red-500', href: '/notifications' },
          { label: t.notifications,value: notifications.length,             icon: Bell,        color: 'bg-purple-500', href: '/notifications' },
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

      {/* QR Check-in banner */}
      {data?.student?.qrCode && (
        <Card className="border-0 shadow-sm bg-gradient-to-r from-halqa-700 to-halqa-600 text-white">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="bg-white/10 p-3 rounded-xl">
              <QrCode className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">QR Self Check-in</p>
              <p className="text-sm text-halqa-200">ID: {data.student.studentId} · Tap to check in</p>
            </div>
            <Link href="/attendance/qr-checkin">
              <button className="bg-white text-halqa-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-halqa-50 transition-colors">
                Check In
              </button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent grades */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><BookMarked className="w-4 h-4 text-blue-500" /> Recent Grades</span>
              <Link href="/grades" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">View all →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {recentGrades.map((grade: any) => (
                <div key={grade.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    (grade.percentage || 0) >= 90 ? 'bg-green-100 text-green-700' :
                    (grade.percentage || 0) >= 70 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {grade.letterGrade}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{grade.title}</p>
                    <p className="text-xs text-gray-500">{grade.class?.name}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                    {grade.score}/{grade.maxScore}
                  </span>
                </div>
              ))}
              {recentGrades.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No grades yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming events + audio */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-halqa-600" /> Upcoming Events
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {upcomingEvents.slice(0, 3).map((event: any) => (
                  <div key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-9 h-9 bg-halqa-50 rounded-lg flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-bold text-halqa-600 uppercase">{format(new Date(event.startDate), 'MMM')}</span>
                      <span className="text-sm font-bold text-halqa-900 leading-none">{format(new Date(event.startDate), 'd')}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                      <Badge variant="outline" className="text-xs mt-0.5">{event.type}</Badge>
                    </div>
                  </div>
                ))}
                {upcomingEvents.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">No upcoming events</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Audio lessons shortcut */}
          <Link href="/audio">
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-r from-teal-600 to-teal-500 text-white">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="bg-white/20 p-2.5 rounded-xl">
                  <Headphones className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Audio Lessons</p>
                  <p className="text-xs text-teal-100">Tafsiira, Tajwiid, Tawhiid & more</p>
                </div>
                <TrendingUp className="w-4 h-4 ml-auto text-teal-200" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Islamic Widget */}
      <PrayerTimesWidget />
    </div>
  )
}
