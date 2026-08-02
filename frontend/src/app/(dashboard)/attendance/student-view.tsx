'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

const STATUS_COLORS: Record<string, string> = {
  PRESENT:    'border-green-200 text-green-700 bg-green-50',
  ABSENT:     'border-red-200 text-red-700 bg-red-50',
  LATE:       'border-yellow-200 text-yellow-700 bg-yellow-50',
  EXCUSED:    'border-blue-200 text-blue-700 bg-blue-50',
  LEFT_EARLY: 'border-orange-200 text-orange-700 bg-orange-50',
}

const DOT_COLORS: Record<string, string> = {
  PRESENT:    'bg-green-500',
  ABSENT:     'bg-red-500',
  LATE:       'bg-yellow-500',
  EXCUSED:    'bg-blue-500',
  LEFT_EARLY: 'bg-orange-500',
}

export function StudentAttendanceView() {
  const { user } = useAuthStore()

  // Fetch own profile to get real student ID (handles cases where store doesn't have it)
  const { data: myProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['my-profile-attendance'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
  })

  const myStudentId = myProfile?.student?.id || user?.student?.id || ''

  const { data: attData, isLoading: attLoading } = useQuery({
    queryKey: ['my-attendance', myStudentId],
    queryFn: () =>
      api.get(`/attendance/student/${myStudentId}`, { params: { limit: 100 } }).then(r => r.data),
    enabled: !!myStudentId,
  })

  const isLoading = profileLoading || attLoading
  const records: any[] = attData?.data?.records || []
  const stats = attData?.data?.stats || {}
  const pct = stats.percentage || 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Attendance</h1>
        <p className="text-gray-500 text-sm">Your personal attendance record</p>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total',   value: stats.total   || 0, cls: 'bg-gray-50 text-gray-700' },
            { label: 'Present', value: stats.present || 0, cls: 'bg-green-50 text-green-700' },
            { label: 'Absent',  value: stats.absent  || 0, cls: 'bg-red-50 text-red-700' },
            { label: 'Late',    value: stats.late    || 0, cls: 'bg-yellow-50 text-yellow-700' },
            {
              label: 'Rate',
              value: `${pct}%`,
              cls: pct >= 80 ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700',
            },
          ].map(item => (
            <div key={item.label} className={`rounded-xl p-4 text-center ${item.cls}`}>
              <p className="text-2xl font-bold">{item.value}</p>
              <p className="text-xs font-medium mt-0.5 opacity-70">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Rate bar */}
      {!isLoading && (stats.total || 0) > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Attendance Rate</span>
            <span className={`font-bold ${pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {pct}%
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1.5">
            <span>0%</span>
            <span className={pct < 80 ? 'text-orange-500 font-medium' : 'text-gray-400'}>
              {pct < 80 ? `${80 - pct}% below target` : '✓ Above 80% target'}
            </span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* Records */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No attendance records yet</p>
          <p className="text-sm mt-1 text-gray-400">Records will appear here once your teacher marks attendance</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {records.map((rec: any) => (
              <div key={rec.id} className="flex items-center gap-3 px-4 py-3">
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_COLORS[rec.status] || 'bg-gray-400'}`} />

                {/* Date + class */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {format(new Date(rec.date), 'EEE, MMM d, yyyy')}
                  </p>
                  {rec.class?.name && (
                    <p className="text-xs text-gray-400 mt-0.5">{rec.class.name}</p>
                  )}
                </div>

                {/* Check-in time */}
                {rec.checkInTime && (
                  <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                    {format(new Date(rec.checkInTime), 'h:mm a')}
                  </span>
                )}

                {/* Status badge */}
                <Badge
                  variant="outline"
                  className={`text-xs flex-shrink-0 ${STATUS_COLORS[rec.status] || ''}`}
                >
                  {rec.status.replace('_', ' ')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link to full report */}
      {records.length > 0 && (
        <div className="text-center pt-2">
          <Link
            href="/attendance/report"
            className="text-sm text-halqa-600 hover:text-halqa-700 font-medium"
          >
            View full attendance report →
          </Link>
        </div>
      )}
    </div>
  )
}
