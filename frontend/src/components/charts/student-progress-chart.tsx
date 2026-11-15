'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { NoSSRChart } from './no-ssr-chart'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'
import { format } from 'date-fns'

interface StudentProgressChartProps {
  studentId: string
  studentName?: string
  compact?: boolean
}

function getLetterGrade(pct: number) {
  if (pct >= 97) return 'A+'
  if (pct >= 93) return 'A'
  if (pct >= 90) return 'A-'
  if (pct >= 80) return 'B'
  if (pct >= 70) return 'C'
  if (pct >= 60) return 'D'
  return 'F'
}

const TYPE_COLORS: Record<string, string> = {
  EXAM: '#ef4444', QUIZ: '#f59e0b', ASSIGNMENT: '#3b82f6',
  MEMORIZATION: '#8b5cf6', ORAL_TEST: '#10b981', PROJECT: '#f97316', PARTICIPATION: '#6b7280'
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs">
      <p className="font-semibold text-gray-900">{d.title}</p>
      <p className="text-gray-500">{d.fullDate} · {d.class}</p>
      <p className="text-gray-500">{d.type}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="font-bold text-base" style={{ color: d.pct >= 90 ? '#16a34a' : d.pct >= 70 ? '#2563eb' : d.pct >= 60 ? '#d97706' : '#dc2626' }}>
          {d.letter} · {d.pct}%
        </span>
        <span className="text-gray-400">{d.score}/{d.maxScore}</span>
      </div>
    </div>
  )
}

export function StudentProgressChart({ studentId, studentName, compact = false }: StudentProgressChartProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['grades-progress', studentId],
    queryFn: () => api.get(`/grades/student/${studentId}`).then(r => r.data.data),
    enabled: !!studentId
  })

  const grades = data?.grades || []
  const summary = data?.summary || {}

  // Build timeline data — sort by date
  const timelineData = [...grades]
    .sort((a: any, b: any) => new Date(a.gradedAt).getTime() - new Date(b.gradedAt).getTime())
    .map((g: any, i: number) => ({
      index: i + 1,
      date: format(new Date(g.gradedAt), 'MMM d'),
      fullDate: format(new Date(g.gradedAt), 'MMM d, yyyy'),
      pct: Math.round(g.percentage || 0),
      title: g.title,
      type: g.type,
      score: g.score,
      maxScore: g.maxScore,
      letter: g.letterGrade,
      class: g.class?.name
    }))

  // Running average line
  let runningSum = 0
  const withRunningAvg = timelineData.map((d, i) => {
    runningSum += d.pct
    return { ...d, avg: Math.round(runningSum / (i + 1)) }
  })

  // Trend: compare first half vs second half
  const mid = Math.floor(timelineData.length / 2)
  const firstHalfAvg = mid > 0
    ? timelineData.slice(0, mid).reduce((s, d) => s + d.pct, 0) / mid
    : 0
  const secondHalfAvg = mid > 0
    ? timelineData.slice(mid).reduce((s, d) => s + d.pct, 0) / (timelineData.length - mid)
    : 0
  const trend = secondHalfAvg - firstHalfAvg

  // By type breakdown
  const byType = grades.reduce((acc: any, g: any) => {
    if (!acc[g.type]) acc[g.type] = { total: 0, count: 0 }
    acc[g.type].total += g.percentage || 0
    acc[g.type].count++
    return acc
  }, {})

  if (isLoading) {
    return <Skeleton className={compact ? 'h-40 rounded-xl' : 'h-64 rounded-xl'} />
  }

  if (grades.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 text-gray-200" />
        <p className="text-sm">No grades yet to show progress</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      {!compact && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{grades.length}</p>
            <p className="text-xs text-gray-500">Total Grades</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{summary.average?.toFixed(1) || 0}%</p>
            <p className="text-xs text-blue-600">Average</p>
          </div>
          <div className="bg-halqa-50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-halqa-700">{summary.letterGrade || '—'}</p>
            <p className="text-xs text-halqa-600">Letter Grade</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${trend > 0 ? 'bg-green-50' : trend < 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-center gap-1">
              {trend > 0 ? <TrendingUp className="w-5 h-5 text-green-600" /> :
               trend < 0 ? <TrendingDown className="w-5 h-5 text-red-600" /> :
               <Minus className="w-5 h-5 text-gray-400" />}
              <p className={`text-2xl font-bold ${trend > 0 ? 'text-green-700' : trend < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                {trend > 0 ? '+' : ''}{trend.toFixed(0)}%
              </p>
            </div>
            <p className="text-xs text-gray-500">Trend</p>
          </div>
        </div>
      )}

      {/* Line chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Grade Progress Over Time</span>
            {trend !== 0 && (
              <Badge className={`text-xs gap-1 ${trend > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {trend > 0 ? 'Improving' : 'Declining'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoSSRChart>
            <ResponsiveContainer width="100%" height={compact ? 160 : 220}>
              <LineChart data={withRunningAvg} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'Pass', position: 'right', fontSize: 9, fill: '#ef4444' }} />
                <ReferenceLine y={80} stroke="#3b82f6" strokeDasharray="4 2" strokeWidth={1} label={{ value: 'B', position: 'right', fontSize: 9, fill: '#3b82f6' }} />
                <Line
                  type="monotone"
                  dataKey="pct"
                  name="Score"
                  stroke="#1d4ed8"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#1d4ed8', strokeWidth: 2, stroke: 'white' }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  name="Running Avg"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            </ResponsiveContainer>
          </NoSSRChart>
        </CardContent>
      </Card>

      {/* By type breakdown */}
      {!compact && Object.keys(byType).length > 1 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Average by Assessment Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(byType)
                .map(([type, data]: [string, any]) => ({
                  type,
                  avg: Math.round(data.total / data.count),
                  count: data.count
                }))
                .sort((a, b) => b.avg - a.avg)
                .map(({ type, avg, count }) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600 w-28 flex-shrink-0">{type.replace('_', ' ')}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${avg}%`, backgroundColor: TYPE_COLORS[type] || '#6b7280' }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-12 text-right">{avg}%</span>
                    <span className="text-xs text-gray-400 w-12">({count})</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
