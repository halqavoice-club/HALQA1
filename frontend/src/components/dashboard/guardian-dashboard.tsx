'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CheckCircle, BookMarked, Star, Bell, MessageSquare, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { PrayerTimesWidget } from '@/components/islamic/prayer-times'
import { HijriDate } from '@/components/islamic/hijri-date'
import { useTranslation } from '@/hooks/useTranslation'

export function GuardianDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'guardian'],
    queryFn: () => api.get('/dashboard/guardian').then(r => r.data.data)
  })
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  const students = data?.students || []
  const recentGrades = data?.recentGrades || []
  const notifications = data?.notifications || []
  const attendanceSummary = data?.attendanceSummary || []

  // Build per-student attendance stats
  const studentAttendance: Record<string, { present: number; total: number }> = {}
  attendanceSummary.forEach((a: any) => {
    if (!studentAttendance[a.studentId]) studentAttendance[a.studentId] = { present: 0, total: 0 }
    studentAttendance[a.studentId].total += a._count.status
    if (a.status === 'PRESENT') studentAttendance[a.studentId].present += a._count.status
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard}</h1>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <HijriDate compact />
        </div>
      </div>

      {/* Children cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">My Children</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {students.map((student: any) => {
            const att = studentAttendance[student.id] || { present: 0, total: 0 }
            const attRate = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0
            return (
              <Card key={student.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold text-lg">
                        {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {student.user?.firstName} {student.user?.lastName}
                      </p>
                      <p className="text-sm text-gray-500">
                        {student.enrollments?.[0]?.class?.name || 'No class'}
                      </p>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className={`text-center rounded-lg p-2 ${attRate >= 80 ? 'bg-green-50' : 'bg-orange-50'}`}>
                      <p className={`text-lg font-bold ${attRate >= 80 ? 'text-green-700' : 'text-orange-700'}`}>{attRate}%</p>
                      <p className="text-xs text-gray-500">Attendance</p>
                    </div>
                    <div className="text-center bg-blue-50 rounded-lg p-2">
                      <CheckCircle className="w-4 h-4 text-blue-500 mx-auto mb-0.5" />
                      <p className="text-xs text-gray-500">Grades</p>
                    </div>
                    <div className="text-center bg-yellow-50 rounded-lg p-2">
                      <Star className="w-4 h-4 text-yellow-500 mx-auto mb-0.5" />
                      <p className="text-xs text-gray-500">Behavior</p>
                    </div>
                  </div>

                  <Link href={`/students/${student.id}`}>
                    <button className="w-full text-center text-sm text-halqa-600 hover:text-halqa-700 font-medium bg-halqa-50 hover:bg-halqa-100 py-2 rounded-lg transition-colors">
                      View Full Profile →
                    </button>
                  </Link>
                </CardContent>
              </Card>
            )
          })}
          {students.length === 0 && (
            <div className="col-span-2 text-center py-8 text-gray-500">
              <p>No children linked to your account</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent grades */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-blue-500" /> Recent Grades
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {recentGrades.slice(0, 5).map((grade: any) => (
                <div key={grade.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    (grade.percentage || 0) >= 90 ? 'bg-green-100 text-green-700' :
                    (grade.percentage || 0) >= 70 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {grade.letterGrade}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {grade.student?.user?.firstName} — {grade.title}
                    </p>
                    <p className="text-xs text-gray-500">{grade.class?.name}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{grade.percentage?.toFixed(0)}%</span>
                </div>
              ))}
              {recentGrades.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No grades yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2"><Bell className="w-4 h-4 text-purple-500" /> Notifications</span>
              <Link href="/notifications" className="text-xs text-halqa-600 hover:text-halqa-700 font-medium">View all →</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {notifications.slice(0, 5).map((notif: any) => (
                <div key={notif.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    notif.type === 'ATTENDANCE' ? 'bg-red-500' :
                    notif.type === 'GRADE' ? 'bg-blue-500' :
                    notif.type === 'BEHAVIOR' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{notif.title}</p>
                    <p className="text-xs text-gray-500 truncate">{notif.body}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(notif.createdAt), 'MMM d, h:mm a')}</p>
                  </div>
                </div>
              ))}
              {notifications.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No new notifications</p>
              )}
            </div>
            <div className="p-3 border-t border-gray-100">
              <Link href="/dm">
                <button className="w-full text-center text-xs bg-halqa-50 text-halqa-700 hover:bg-halqa-100 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Message Teacher
                </button>
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
