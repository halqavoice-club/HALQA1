'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { downloadFile, buildFilename } from '@/lib/download'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { Progress } from '@/components/ui/progress'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import {
  CheckCircle, XCircle, Clock, AlertCircle, Download,
  FileSpreadsheet, Users, TrendingUp, Calendar, ArrowLeft
} from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'

const STATUS_COLORS = {
  PRESENT: '#10b981', ABSENT: '#ef4444', LATE: '#f59e0b',
  EXCUSED: '#3b82f6', LEFT_EARLY: '#f97316'
}

export default function AttendanceReportPage() {
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const { toast } = useToast()
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [downloading, setDownloading] = useState(false)

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data),
    enabled: isAdmin || isTeacher
  })

  const { data: students } = useQuery({
    queryKey: ['students', classId],
    queryFn: () => api.get('/students', { params: { classId: classId || undefined, limit: 200 } }).then(r => r.data.data),
    enabled: (isAdmin || isTeacher) && !!classId
  })

  const { data: reportData, isLoading, isError, refetch } = useQuery({
    queryKey: ['attendance-report', classId, studentId, startDate, endDate, statusFilter],
    queryFn: () => api.get('/attendance/report', {
      params: {
        classId: classId || undefined,
        studentId: studentId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: statusFilter || undefined
      }
    }).then(r => r.data.data),
    // Only staff (teacher/admin) can access this endpoint — students/guardians get 403
    enabled: isAdmin || isTeacher,
  })

  const records = reportData?.records || []
  const summary = reportData?.summary || {}

  // Students and guardians cannot access the staff report endpoint.
  // Redirect them to the attendance page which uses the correct endpoints.
  if (isStudent || isGuardian) {
    return (
      <div className="space-y-4 max-w-md mx-auto text-center py-16">
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto">
          <Calendar className="w-7 h-7 text-blue-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Your Attendance</h1>
        <p className="text-gray-500 text-sm">
          Use the Attendance section to view your personal attendance history.
        </p>
        <Link href="/attendance">
          <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
            <ArrowLeft className="w-4 h-4" /> View My Attendance
          </Button>
        </Link>
      </div>
    )
  }

  // Build pie chart data
  const pieData = [
    { name: 'Present', value: summary.present || 0, color: STATUS_COLORS.PRESENT },
    { name: 'Absent', value: summary.absent || 0, color: STATUS_COLORS.ABSENT },
    { name: 'Late', value: summary.late || 0, color: STATUS_COLORS.LATE },
    { name: 'Excused', value: summary.excused || 0, color: STATUS_COLORS.EXCUSED },
  ].filter(d => d.value > 0)

  // Build daily bar chart
  const dailyMap: Record<string, Record<string, number>> = {}
  records.forEach((r: any) => {
    const d = r.date?.split('T')[0] || ''
    if (!dailyMap[d]) dailyMap[d] = { present: 0, absent: 0, late: 0 }
    const s = r.status?.toLowerCase()
    if (dailyMap[d][s] !== undefined) dailyMap[d][s]++
  })
  const dailyData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, counts]) => ({ date: format(new Date(date), 'MMM d'), ...counts }))

  const handleExport = async (fmt: 'xlsx' | 'pdf') => {
    setDownloading(true)
    try {
      await downloadFile('/reports/attendance', {
        classId: classId || undefined,
        studentId: studentId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        format: fmt
      }, buildFilename('attendance', fmt))
      toast({ title: `Attendance report exported as ${fmt.toUpperCase()}` })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Attendance', href: '/attendance' }, { label: 'Report' }]} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-halqa-700" /> Attendance Report
          </h1>
          <p className="text-gray-500 text-sm">View and export attendance analytics</p>
        </div>
        {(isAdmin || isTeacher) && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport('xlsx')} disabled={downloading} className="gap-2">
              <FileSpreadsheet className="w-4 h-4 text-green-600" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('pdf')} disabled={downloading} className="gap-2">
              <Download className="w-4 h-4 text-red-600" /> PDF
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      {(isAdmin || isTeacher) && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs">Class</Label>
                <Select value={classId || 'all'} onValueChange={v => { setClassId(v === 'all' ? '' : v); setStudentId('') }}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="All classes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                    {(classes || []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {classId && (
                <div>
                  <Label className="text-xs">Student</Label>
                  <Select value={studentId || 'all'} onValueChange={v => setStudentId(v === 'all' ? '' : v)}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="All students" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Students</SelectItem>
                      {(students || []).map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.user?.firstName} {s.user?.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Start Date</Label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="mt-1 h-9 w-full px-3 rounded-md border border-input bg-background text-sm" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="mt-1 h-9 w-full px-3 rounded-md border border-input bg-background text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Status Filter</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {['', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${statusFilter === s ? 'bg-halqa-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {s || 'All'}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total', value: summary.total || 0, icon: Users, color: 'bg-gray-50 text-gray-700' },
              { label: 'Present', value: summary.present || 0, icon: CheckCircle, color: 'bg-green-50 text-green-700' },
              { label: 'Absent', value: summary.absent || 0, icon: XCircle, color: 'bg-red-50 text-red-700' },
              { label: 'Late', value: summary.late || 0, icon: Clock, color: 'bg-yellow-50 text-yellow-700' },
              { label: 'Rate', value: `${summary.percentage || 0}%`, icon: TrendingUp, color: (summary.percentage || 0) >= 80 ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700' },
            ].map(item => {
              const Icon = item.icon
              return (
                <Card key={item.label} className="border-0 shadow-sm">
                  <CardContent className={`p-4 ${item.color} rounded-xl`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium opacity-70">{item.label}</p>
                        <p className="text-2xl font-bold mt-0.5">{item.value}</p>
                      </div>
                      <Icon className="w-6 h-6 opacity-50" />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Attendance rate progress */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <Progress
                value={summary.percentage || 0}
                label="Overall Attendance Rate"
                showValue
                size="lg"
                color={(summary.percentage || 0) >= 80 ? 'green' : (summary.percentage || 0) >= 60 ? 'yellow' : 'red'}
              />
            </CardContent>
          </Card>

          {/* Charts */}
          {records.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Pie chart */}
              {pieData.length > 0 && (
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Status Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <NoSSRChart>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                            {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </NoSSRChart>
                  </CardContent>
                </Card>
              )}

              {/* Daily trend */}
              {dailyData.length > 0 && (
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Daily Trend (Last 14 Days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <NoSSRChart>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={dailyData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Bar dataKey="present" name="Present" fill="#10b981" stackId="a" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="absent" name="Absent" fill="#ef4444" stackId="a" />
                          <Bar dataKey="late" name="Late" fill="#f59e0b" stackId="a" />
                        </BarChart>
                      </ResponsiveContainer>
                    </NoSSRChart>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Records table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Attendance Records ({records.length})</span>
                {records.length > 0 && (
                  <span className="text-xs text-gray-400 font-normal">
                    {startDate && endDate ? `${format(new Date(startDate), 'MMM d')} – ${format(new Date(endDate), 'MMM d, yyyy')}` : 'All time'}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {records.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p>No records found for the selected filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Class</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Check In</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {records.slice(0, 100).map((r: any) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                            {r.date ? format(new Date(r.date), 'MMM d, yyyy') : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-medium">
                            {r.student?.user?.firstName} {r.student?.user?.lastName}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{r.class?.name || '—'}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={r.status} size="sm" />
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">
                            {r.checkInTime ? format(new Date(r.checkInTime), 'h:mm a') : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[150px] truncate">
                            {r.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {records.length > 100 && (
                    <p className="text-xs text-gray-400 text-center py-3">
                      Showing 100 of {records.length} records. Export to see all.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
