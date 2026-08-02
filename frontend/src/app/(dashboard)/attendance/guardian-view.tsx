'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CheckCircle2, Users } from 'lucide-react'
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
  PRESENT: 'bg-green-500', ABSENT: 'bg-red-500',
  LATE: 'bg-yellow-500', EXCUSED: 'bg-blue-500', LEFT_EARLY: 'bg-orange-500',
}

function StudentAttendanceCard({ student }: { student: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ['guardian-student-attendance', student.id],
    queryFn: () =>
      api.get(`/attendance/student/${student.id}`, { params: { limit: 30 } }).then(r => r.data),
  })

  const records: any[] = data?.data?.records || []
  const stats = data?.data?.stats || {}
  const pct = stats.percentage || 0

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Student header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold text-sm">
            {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {student.user?.firstName} {student.user?.lastName}
          </p>
          <p className="text-xs text-gray-400">
            {student.enrollments?.[0]?.class?.name || 'No class'} · {student.studentId}
          </p>
        </div>
        {/* Rate pill */}
        <div className={`px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 ${
          pct >= 80 ? 'bg-green-100 text-green-700' :
          pct >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
        }`}>
          {pct}%
        </div>
      </div>

      {/* Summary row */}
      {!isLoading && (
        <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
          {[
            { label: 'Present', value: stats.present || 0, color: 'text-green-600' },
            { label: 'Absent',  value: stats.absent  || 0, color: 'text-red-600' },
            { label: 'Late',    value: stats.late    || 0, color: 'text-yellow-600' },
            { label: 'Total',   value: stats.total   || 0, color: 'text-gray-700' },
          ].map(item => (
            <div key={item.label} className="py-2 text-center">
              <p className={`text-base font-bold ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-400">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent records */}
      {isLoading ? (
        <div className="p-3 space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : records.length === 0 ? (
        <div className="py-6 text-center text-gray-400 text-sm">No records yet</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
          {records.map((rec: any) => (
            <div key={rec.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_COLORS[rec.status] || 'bg-gray-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900">
                  {format(new Date(rec.date), 'EEE, MMM d, yyyy')}
                </p>
                {rec.class?.name && <p className="text-xs text-gray-400">{rec.class.name}</p>}
              </div>
              {rec.checkInTime && (
                <span className="text-xs text-gray-400 font-mono flex-shrink-0">
                  {format(new Date(rec.checkInTime), 'h:mm a')}
                </span>
              )}
              <Badge variant="outline" className={`text-xs flex-shrink-0 ${STATUS_COLORS[rec.status] || ''}`}>
                {rec.status.replace('_', ' ')}
              </Badge>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-gray-100">
        <Link
          href={`/students/${student.id}/attendance`}
          className="text-xs text-halqa-600 hover:text-halqa-700 font-medium"
        >
          View full report →
        </Link>
      </div>
    </div>
  )
}

export function GuardianAttendanceView() {
  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['guardian-profile-attendance'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
  })

  const guardianId = profileData?.guardian?.id || ''

  const { data: guardianData, isLoading: guardianLoading } = useQuery({
    queryKey: ['guardian-detail', guardianId],
    queryFn: () => api.get(`/guardians/${guardianId}`).then(r => r.data.data),
    enabled: !!guardianId,
  })

  const isLoading = profileLoading || guardianLoading
  const students = guardianData?.students?.map((gs: any) => gs.student).filter(Boolean) || []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Children's Attendance</h1>
        <p className="text-gray-500 text-sm">Attendance records for your linked children</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : students.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No children linked to your account</p>
          <p className="text-sm mt-1 text-gray-400">Contact the school admin to link your children</p>
        </div>
      ) : (
        <div className="space-y-4">
          {students.map((student: any) => (
            <StudentAttendanceCard key={student.id} student={student} />
          ))}
        </div>
      )}
    </div>
  )
}
