'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { downloadFile } from '@/lib/download'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import { ArrowLeft, Download, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, Clock, Circle, Timer,
  Calendar, List, TrendingUp, Loader2, ChevronLeft, ChevronRight, Printer
} from 'lucide-react'
import Link from 'next/link'
import { format, addMonths, subMonths } from 'date-fns'
import { cn } from '@/lib/utils'
import { Breadcrumb } from '@/components/ui/breadcrumb'

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

interface AttendanceStats {
  present: number
  absent: number
  late: number
  excused: number
  left_early: number
  percentage: number
}

const STATUS_CONFIG: Record<string, {
  label: string; color: string; icon: React.ElementType
}> = {
  PRESENT:    { label: 'Present',    color: '#16a34a', icon: CheckCircle2 },
  ABSENT:     { label: 'Absent',     color: '#dc2626', icon: XCircle },
  LATE:       { label: 'Late',       color: '#d97706', icon: Clock },
  EXCUSED:    { label: 'Excused',    color: '#2563eb', icon: Circle },
  LEFT_EARLY: { label: 'Left Early', color: '#ea580c', icon: Timer },
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon: Icon }: {
  label: string; value: number | string; color: string; icon: React.ElementType
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
      <div className="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center"
        style={{ backgroundColor: color + '20' }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

// ─── CALENDAR DAY ─────────────────────────────────────────────────────────────

function CalendarDay({ day }: { day: any }) {
  const [tip, setTip] = useState(false)
  if (!day) return <div className="h-10 rounded-lg bg-gray-50" />

  const { attendance, isWeekend, isToday, isFuture } = day
  const cfg = attendance ? STATUS_CONFIG[attendance.status] : null

  return (
    <div
      className={cn(
        'relative h-10 rounded-lg flex items-center justify-center text-sm font-medium cursor-pointer transition-all select-none',
        isToday && 'ring-2 ring-halqa-500 ring-offset-1',
        isFuture && 'opacity-40 cursor-default',
        isWeekend && !attendance && 'bg-gray-100 text-gray-400',
        !attendance && !isWeekend && !isFuture && 'bg-gray-50 text-gray-600 hover:bg-gray-100',
        cfg && 'text-white hover:opacity-90'
      )}
      style={cfg ? { backgroundColor: cfg.color } : {}}
      onMouseEnter={() => !isFuture && setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      {day.day}

      {/* Tooltip */}
      {tip && attendance && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-xl pointer-events-none">
          <p className="font-semibold">{format(new Date(day.date), 'MMM d, yyyy')}</p>
          <p className="mt-0.5">{attendance.statusLabel}</p>
          {attendance.checkIn && <p>In: {attendance.checkIn}</p>}
          {attendance.checkOut && <p>Out: {attendance.checkOut}</p>}
          {attendance.class && <p className="text-gray-300">{attendance.class}</p>}
          {attendance.notes && <p className="text-gray-300 max-w-[160px] truncate">{attendance.notes}</p>}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function StudentAttendanceReportPage() {
  const { id } = useParams<{ id: string }>()
  const { toast } = useToast()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [historyPage, setHistoryPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const monthStr = format(currentMonth, 'yyyy-MM')

  // ── Queries ──
  const { data: summaryData, isLoading: loadingSummary } = useQuery({
    queryKey: ['student-report-summary', id, dateRange],
    queryFn: () => api.get(`/student-reports/student/${id}`, {
      params: {
        startDate: dateRange.start || undefined,
        endDate: dateRange.end || undefined
      }
    }).then(r => r.data.data)
  })

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ['student-report-history', id, historyPage, statusFilter, dateRange],
    queryFn: () => api.get(`/student-reports/student/${id}/history`, {
      params: {
        page: historyPage, limit: 20,
        status: statusFilter || undefined,
        startDate: dateRange.start || undefined,
        endDate: dateRange.end || undefined
      }
    }).then(r => r.data.data)
  })

  const { data: calendarData, isLoading: loadingCalendar } = useQuery({
    queryKey: ['student-report-calendar', id, monthStr],
    queryFn: () => api.get(`/student-reports/student/${id}/calendar`, {
      params: { month: monthStr }
    }).then(r => r.data.data)
  })

  // Trend data (weekly + monthly using raw MySQL queries)
  const { data: trendData } = useQuery({
    queryKey: ['student-report-trend', id],
    queryFn: () => api.get(`/student-reports/student/${id}/trend`).then(r => r.data.data)
  })

  // ── Export ──
  const handleExport = async (type: 'csv' | 'excel' | 'pdf') => {
    setDownloading(type)
    try {
      const params: Record<string, string> = {}
      if (dateRange.start) params.startDate = dateRange.start
      if (dateRange.end) params.endDate = dateRange.end
      const ext = type === 'excel' ? 'xlsx' : type
      const sid = summaryData?.student?.studentId || id
      await downloadFile(`/student-reports/student/${id}/export/${type}`, params, `attendance-${sid}-${Date.now()}.${ext}`)
      toast({ title: `${type.toUpperCase()} exported successfully` })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setDownloading(null)
    }
  }

  const summary = summaryData?.summary
  const student = summaryData?.student

  const pieData = summary ? [
    { name: 'Present',    value: summary.present,   color: '#16a34a' },
    { name: 'Absent',     value: summary.absent,    color: '#dc2626' },
    { name: 'Late',       value: summary.late,      color: '#d97706' },
    { name: 'Excused',    value: summary.excused,   color: '#2563eb' },
    { name: 'Left Early', value: summary.leftEarly, color: '#ea580c' },
  ].filter(d => d.value > 0) : []

  const pctColor = !summary ? '#94a3b8'
    : summary.percentage >= 90 ? '#16a34a'
    : summary.percentage >= 75 ? '#2563eb'
    : summary.percentage >= 60 ? '#d97706'
    : '#dc2626'

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Students', href: '/students' },
        { label: student?.name || 'Student', href: `/students/${id}` },
        { label: 'Attendance Report' }
      ]} />

      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href={`/students/${id}`} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Attendance Report</h1>
            {student && (
              <p className="text-gray-500 text-sm">
                {student.name} · {student.studentId}
                {student.classes?.length > 0 && ` · ${student.classes.join(', ')}`}
              </p>
            )}
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 flex-wrap no-print">
          <Button variant="outline" size="sm" className="gap-2"
            disabled={!!downloading} onClick={() => handleExport('csv')}>
            {downloading === 'csv'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileText className="w-4 h-4 text-gray-600" />}
            CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-2"
            disabled={!!downloading} onClick={() => handleExport('excel')}>
            {downloading === 'excel'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileSpreadsheet className="w-4 h-4 text-green-600" />}
            Excel
          </Button>
          <Button size="sm" className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            disabled={!!downloading} onClick={() => handleExport('pdf')}>
            {downloading === 'pdf'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            PDF Report
          </Button>
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      {/* ── DATE RANGE FILTER ── */}
      <Card className="border-0 shadow-sm no-print">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm font-medium text-gray-700">Filter by date range:</p>
            <div className="flex items-center gap-2">
              <input
                type="date" value={dateRange.start}
                onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date" value={dateRange.end}
                onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              />
            </div>
            {(dateRange.start || dateRange.end) && (
              <Button variant="ghost" size="sm"
                onClick={() => setDateRange({ start: '', end: '' })}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── SUMMARY ── */}
      {loadingSummary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : summary && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Circular progress */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-6 text-center">
                <div className="relative w-28 h-28 mx-auto mb-3">
                  <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                    <circle cx="50" cy="50" r="40" fill="none"
                      stroke={pctColor} strokeWidth="10"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - summary.percentage / 100)}`}
                      strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold" style={{ color: pctColor }}>
                      {summary.percentage}%
                    </span>
                    <span className="text-xs text-gray-500">Rate</span>
                  </div>
                </div>
                <Badge className="text-xs px-2 py-0.5"
                  style={{ backgroundColor: pctColor + '20', color: pctColor }}>
                  {summary.letterGrade} — {summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}
                </Badge>
                {summary.currentStreak > 0 && (
                  <p className="text-xs text-green-600 mt-2 font-medium">
                    🔥 {summary.currentStreak}-day present streak
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Stat cards */}
            <div className="md:col-span-3 grid grid-cols-3 md:grid-cols-5 gap-3">
              <StatCard label="Total Days" value={summary.total}    color="#1e40af" icon={Calendar} />
              <StatCard label="Present"    value={summary.present}  color="#16a34a" icon={CheckCircle2} />
              <StatCard label="Absent"     value={summary.absent}   color="#dc2626" icon={XCircle} />
              <StatCard label="Late"       value={summary.late}     color="#d97706" icon={Clock} />
              <StatCard label="Excused"    value={summary.excused}  color="#2563eb" icon={Circle} />
            </div>
          </div>

          {/* Charts */}
          {pieData.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Attendance Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <NoSSRChart>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" outerRadius={75}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: any, n: string) => [v + ' days', n]} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </NoSSRChart>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <NoSSRChart>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={pieData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={65} />
                        <Tooltip formatter={(v: any) => [v + ' days']} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </NoSSRChart>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── TABS ── */}
      <Tabs defaultValue="calendar">
        <TabsList className="grid grid-cols-3 w-full md:w-96">
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="w-4 h-4" /> Calendar
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <List className="w-4 h-4" /> History
          </TabsTrigger>
          <TabsTrigger value="trend" className="gap-2">
            <TrendingUp className="w-4 h-4" /> Trend
          </TabsTrigger>
        </TabsList>

        {/* ── CALENDAR TAB ── */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  {calendarData?.month?.monthName || format(currentMonth, 'MMMM yyyy')}
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm"
                    onClick={() => setCurrentMonth(new Date())}>
                    Today
                  </Button>
                  <Button variant="ghost" size="sm"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Monthly stats */}
              {calendarData?.stats && (
                <div className="flex flex-wrap gap-3 mt-2">
                  {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
                    const count = (calendarData.stats as AttendanceStats)[status.toLowerCase() as keyof AttendanceStats] || 0
                    if (!count) return null
                    return (
                      <div key={status} className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cfg.color }} />
                        <span className="text-gray-600">{cfg.label}: <strong>{count}</strong></span>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-1.5 text-xs ml-auto">
                    <TrendingUp className="w-3 h-3 text-halqa-600" />
                    <span className="font-semibold text-halqa-700">
                      {calendarData.stats.percentage}% this month
                    </span>
                  </div>
                </div>
              )}
            </CardHeader>

            <CardContent>
              {loadingCalendar ? (
                <div className="grid grid-cols-7 gap-1">
                  {[...Array(35)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                </div>
              ) : (
                <>
                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {DAYS_OF_WEEK.map(d => (
                      <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
                    ))}
                  </div>

                  {/* Weeks */}
                  <div className="space-y-1">
                    {(calendarData?.weeks || []).map((week: any[], wi: number) => (
                      <div key={wi} className="grid grid-cols-7 gap-1">
                        {week.map((day, di) => <CalendarDay key={di} day={day} />)}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100">
                    {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
                      <div key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
                        {cfg.label}
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <div className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" />
                      No record
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── HISTORY TAB ── */}
        <TabsContent value="history" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base font-semibold">Daily Attendance History</CardTitle>
                <Select value={statusFilter || 'all'} onValueChange={v => { setStatusFilter(v === 'all' ? '' : v); setHistoryPage(1) }}>
                  <SelectTrigger className="w-40 h-9">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
                      <SelectItem key={s} value={s}>{cfg.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loadingHistory ? (
                <div className="p-4 space-y-2">
                  {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
                </div>
              ) : (historyData?.history || []).length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Calendar className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                  <p className="text-sm">No attendance records found</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Day</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Check In</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Check Out</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Class</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(historyData?.history || []).map((rec: any) => {
                          const cfg = STATUS_CONFIG[rec.status]
                          return (
                            <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                                {rec.dateFormatted}
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{rec.dayOfWeek}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: cfg?.color || '#94a3b8' }} />
                                  <span className="font-medium text-xs"
                                    style={{ color: cfg?.color || '#94a3b8' }}>
                                    {rec.statusLabel}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                                {rec.checkIn || '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                                {rec.checkOut || '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{rec.class || '—'}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate">
                                {rec.notes || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {historyData?.pagination && historyData.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                      <p className="text-xs text-gray-500">
                        Showing {((historyData.pagination.page - 1) * historyData.pagination.limit) + 1}–
                        {Math.min(historyData.pagination.page * historyData.pagination.limit, historyData.pagination.total)} of {historyData.pagination.total}
                      </p>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                          disabled={!historyData.pagination.hasPrev}
                          onClick={() => setHistoryPage(p => p - 1)}>
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-xs text-gray-600 px-2 py-1">
                          {historyData.pagination.page} / {historyData.pagination.totalPages}
                        </span>
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                          disabled={!historyData.pagination.hasNext}
                          onClick={() => setHistoryPage(p => p + 1)}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TREND TAB ── */}
        <TabsContent value="trend" className="mt-4 space-y-4">
          {/* Monthly trend chart */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Monthly Attendance Rate (Last 6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              {!trendData ? (
                <Skeleton className="h-48 rounded-lg" />
              ) : (trendData.monthly || []).length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No trend data available</div>
              ) : (
                <NoSSRChart>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: any) => [`${v}%`, 'Attendance Rate']} />
                      <Bar dataKey="rate" name="Rate" radius={[4, 4, 0, 0]}>
                        {(trendData.monthly || []).map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.rate >= 90 ? '#16a34a' : entry.rate >= 75 ? '#2563eb' : entry.rate >= 60 ? '#d97706' : '#dc2626'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </NoSSRChart>
              )}
            </CardContent>
          </Card>

          {/* Weekly trend */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Weekly Breakdown (Last 8 Weeks)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!trendData ? (
                <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
              ) : (trendData.weekly || []).length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No weekly data available</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {(trendData.weekly || []).map((w: any) => {
                    const color = w.rate >= 90 ? '#16a34a' : w.rate >= 75 ? '#2563eb' : w.rate >= 60 ? '#d97706' : '#dc2626'
                    return (
                      <div key={w.week} className="flex items-center gap-4 px-4 py-3">
                        <div className="w-24 text-xs text-gray-500 flex-shrink-0">
                          {w.weekStart ? format(new Date(w.weekStart), 'MMM d') : `Week ${w.week}`}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${w.rate}%`, backgroundColor: color }} />
                            </div>
                            <span className="text-xs font-bold w-10 text-right" style={{ color }}>{w.rate}%</span>
                          </div>
                          <div className="flex gap-3 text-xs text-gray-400">
                            <span className="text-green-600">✓ {w.present}</span>
                            <span className="text-red-500">✗ {w.absent}</span>
                            <span className="text-yellow-500">⏰ {w.late}</span>
                            <span className="text-gray-400">/ {w.total} days</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
