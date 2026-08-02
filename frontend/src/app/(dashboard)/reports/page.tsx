'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { downloadFile, buildFilename } from '@/lib/download'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import { useToast } from '@/components/ui/use-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  LineChart, Line, AreaChart, Area
} from 'recharts'
import { Download, FileSpreadsheet, BarChart3, Loader2 } from 'lucide-react'
import { ErrorState } from '@/components/ui/error-state'

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6']

const STATUS_COLORS: Record<string, string> = {
  PRESENT: '#10b981',
  ABSENT: '#ef4444',
  LATE: '#f59e0b',
  EXCUSED: '#3b82f6',
  LEFT_EARLY: '#f97316'
}

export default function ReportsPage() {
  const { toast } = useToast()
  const [classId, setClassId] = useState('')
  const [termId, setTermId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data)
  })

  const { data: terms } = useQuery({
    queryKey: ['terms'],
    queryFn: () => api.get('/terms').then(r => r.data.data)
  })

  // Attendance analytics
  const { data: attendanceAnalytics, isLoading: loadingAttendance, isError: attendanceError, refetch: refetchAttendance } = useQuery({
    queryKey: ['analytics', 'attendance', classId, startDate, endDate],
    queryFn: () => api.get('/attendance/analytics', {
      params: { classId: classId || undefined, startDate: startDate || undefined, endDate: endDate || undefined }
    }).then(r => r.data.data)
  })

  // Grades data
  const { data: gradesData, isLoading: loadingGrades, isError: gradesError, refetch: refetchGrades } = useQuery({
    queryKey: ['reports', 'grades', classId, termId],
    queryFn: () => api.get('/reports/grades', {
      params: { classId: classId || undefined, termId: termId || undefined }
    }).then(r => r.data.data),
    enabled: true
  })

  // Behavior data
  const { data: behaviorData, isLoading: loadingBehavior, isError: behaviorError, refetch: refetchBehavior } = useQuery({
    queryKey: ['reports', 'behavior', classId, startDate, endDate],
    queryFn: () => api.get('/reports/behavior', {
      params: { classId: classId || undefined, startDate: startDate || undefined, endDate: endDate || undefined }
    }).then(r => r.data.data),
    enabled: true
  })

  const handleExport = async (type: string, format: string) => {
    const key = `${type}-${format}`
    setDownloading(key)
    try {
      const params: Record<string, string> = { format }
      if (classId) params.classId = classId
      if (termId) params.termId = termId
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate

      await downloadFile(`/reports/${type}`, params, buildFilename(type, format === 'xlsx' ? 'xlsx' : 'pdf'))
      toast({ title: `${type} report downloaded` })
    } catch {
      toast({ title: 'Export failed. Please try again.', variant: 'destructive' })
    } finally {
      setDownloading(null)
    }
  }

  // Build attendance pie data
  const attendanceTotals = attendanceAnalytics?.totals || []
  const attendancePie = attendanceTotals.map((item: any) => ({
    name: item.status,
    value: item._count?.status || 0,
    color: STATUS_COLORS[item.status] || '#94a3b8'
  })).filter((d: any) => d.value > 0)

  // Build grades distribution
  const gradeDistribution = (() => {
    if (!gradesData || !Array.isArray(gradesData)) return []
    const buckets: Record<string, number> = { 'A (90-100)': 0, 'B (80-89)': 0, 'C (70-79)': 0, 'D (60-69)': 0, 'F (<60)': 0 }
    gradesData.forEach((g: any) => {
      const pct = g.percentage || 0
      if (pct >= 90) buckets['A (90-100)']++
      else if (pct >= 80) buckets['B (80-89)']++
      else if (pct >= 70) buckets['C (70-79)']++
      else if (pct >= 60) buckets['D (60-69)']++
      else buckets['F (<60)']++
    })
    return Object.entries(buckets).map(([name, count]) => ({ name, count }))
  })()

  // Build behavior summary
  const behaviorSummary = (() => {
    if (!behaviorData || !Array.isArray(behaviorData)) return []
    const catMap: Record<string, { positive: number; negative: number }> = {}
    behaviorData.forEach((log: any) => {
      if (!catMap[log.category]) catMap[log.category] = { positive: 0, negative: 0 }
      if (log.type === 'POSITIVE') catMap[log.category].positive += log.points
      else catMap[log.category].negative += Math.abs(log.points)
    })
    return Object.entries(catMap)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => (b.positive + b.negative) - (a.positive + a.negative))
      .slice(0, 10)
  })()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
        <p className="text-gray-500 text-sm">Generate insights and export data</p>
      </div>

      {/* Global filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Class</Label>
              <Select value={classId || 'all'} onValueChange={v => setClassId(v === 'all' ? '' : v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {(classes || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Term</Label>
              <Select value={termId || 'all'} onValueChange={v => setTermId(v === 'all' ? '' : v)}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="All terms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Terms</SelectItem>
                  {(terms || []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
        </CardContent>
      </Card>

      {/* Report tabs */}
      <Tabs defaultValue="attendance">
        <TabsList className="grid grid-cols-3 w-full md:w-auto">
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
        </TabsList>

        {/* ── ATTENDANCE ── */}
        <TabsContent value="attendance" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="gap-2"
              disabled={downloading === 'attendance-xlsx'}
              onClick={() => handleExport('attendance', 'xlsx')}>
              {downloading === 'attendance-xlsx'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <FileSpreadsheet className="w-4 h-4 text-green-600" />}
              Export Excel
            </Button>
          </div>

          {loadingAttendance ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : attendanceError ? (
            <ErrorState onRetry={refetchAttendance} />
          ) : attendancePie.length === 0 ? (
            <EmptyChart message="No attendance data for the selected filters" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Attendance Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <NoSSRChart>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={attendancePie} cx="50%" cy="50%" outerRadius={80}
                          dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {attendancePie.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
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
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={attendancePie} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={70} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {attendancePie.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </NoSSRChart>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── GRADES ── */}
        <TabsContent value="grades" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="gap-2"
              disabled={downloading === 'grades-xlsx'}
              onClick={() => handleExport('grades', 'xlsx')}>
              {downloading === 'grades-xlsx'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <FileSpreadsheet className="w-4 h-4 text-green-600" />}
              Export Excel
            </Button>
          </div>

          {loadingGrades ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : gradesError ? (
            <ErrorState onRetry={refetchGrades} />
          ) : gradeDistribution.every(d => d.count === 0) ? (
            <EmptyChart message="No grade data for the selected filters" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Grade Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <NoSSRChart>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={gradeDistribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]}>
                          {gradeDistribution.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </NoSSRChart>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Grade Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {gradeDistribution.map((item, i) => {
                      const total = gradeDistribution.reduce((s, d) => s + d.count, 0)
                      const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
                      return (
                        <div key={item.name}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-700">{item.name}</span>
                            <span className="font-medium">{item.count} students ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── BEHAVIOR ── */}
        <TabsContent value="behavior" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="gap-2"
              disabled={downloading === 'behavior-xlsx'}
              onClick={() => handleExport('behavior', 'xlsx')}>
              {downloading === 'behavior-xlsx'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <FileSpreadsheet className="w-4 h-4 text-green-600" />}
              Export Excel
            </Button>
          </div>

          {loadingBehavior ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : behaviorError ? (
            <ErrorState onRetry={refetchBehavior} />
          ) : behaviorSummary.length === 0 ? (
            <EmptyChart message="No behavior data for the selected filters" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Top Behavior Categories</CardTitle>
                </CardHeader>
                <CardContent>
                  <NoSSRChart>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={behaviorSummary} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={100} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="positive" name="Positive" fill="#10b981" radius={[0, 2, 2, 0]} stackId="a" />
                        <Bar dataKey="negative" name="Negative" fill="#ef4444" radius={[0, 2, 2, 0]} stackId="b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </NoSSRChart>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Category Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-gray-100">
                    {behaviorSummary.slice(0, 8).map((item: any) => (
                      <div key={item.category} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-sm text-gray-700 flex-1 truncate">{item.category}</span>
                        <span className="text-xs font-medium text-green-600">+{item.positive}</span>
                        <span className="text-xs font-medium text-red-500">-{item.negative}</span>
                        <span className={`text-xs font-bold w-12 text-right ${
                          item.positive - item.negative >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {item.positive - item.negative >= 0 ? '+' : ''}{item.positive - item.negative}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
      <div className="text-center">
        <BarChart3 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">{message}</p>
      </div>
    </div>
  )
}
