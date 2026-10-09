'use client'
import { useEffect, useState, useCallback } from 'react'
import { getSocket } from '@/lib/socket'
import { getResults, recordGrades } from '@/lib/quiz'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Download, Award, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { QuizResultRow } from '@/lib/quiz'
import type { Quiz } from '@/store/quiz.store'

// ─── CSV export helper ────────────────────────────────────────────────────────

function exportToCsv(quiz: Quiz, rows: QuizResultRow[]) {
  const headers = ['Student', 'Score (%)', 'Status', 'Submitted At', 'Time Taken (s)']
  const csvRows = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.firstName} ${r.lastName}"`,
      r.score != null ? Math.round(r.score) : '',
      r.status,
      r.submittedAt ?? '',
      r.timeTakenMs != null ? Math.round(r.timeTakenMs / 1000) : '',
    ].join(','))
  ]
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${quiz.title.replace(/\s+/g, '_')}_results.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Score pill ───────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">Pending</span>
  const pct = Math.round(score)
  const color = pct >= 80 ? 'text-green-700 bg-green-50' : pct >= 60 ? 'text-yellow-700 bg-yellow-50' : 'text-red-700 bg-red-50'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {pct}%
    </span>
  )
}

// ─── QuizResultsDashboard ─────────────────────────────────────────────────────

interface QuizResultsDashboardProps {
  quiz:    Quiz
  quizId:  string
}

export function QuizResultsDashboard({ quiz, quizId }: QuizResultsDashboardProps) {
  const { toast } = useToast()
  const [rows,    setRows]    = useState<QuizResultRow[]>([])
  const [total,   setTotal]   = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  // ── Fetch initial results ──────────────────────────────────────────────────
  const fetchResults = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getResults(quizId)
      setRows(data.attempts)
    } catch {
      toast({ title: 'Failed to load results', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [quizId])

  useEffect(() => { fetchResults() }, [fetchResults])

  // ── Socket.IO live updates ─────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.emit('quiz:watch', { quizId })

    const onSnapshot = (data: { quizId: string; submitted: QuizResultRow[]; total: number }) => {
      if (data.quizId !== quizId) return
      setTotal(data.total)
    }

    const onSubmission = (data: {
      quizId:      string
      studentId:   string
      firstName:   string
      lastName:    string
      submittedAt: string
      score:       number | null
    }) => {
      if (data.quizId !== quizId) return
      setRows(prev => {
        const exists = prev.findIndex(r => r.studentId === data.studentId)
        const newRow: QuizResultRow = {
          attemptId:   data.studentId,
          studentId:   data.studentId,
          firstName:   data.firstName,
          lastName:    data.lastName,
          avatarUrl:   null,
          status:      'SUBMITTED',
          score:       data.score,
          feedback:    null,
          startedAt:   data.submittedAt,
          submittedAt: data.submittedAt,
          timeTakenMs: null,
          answers:     [],
        }
        if (exists >= 0) {
          const updated = [...prev]
          updated[exists] = newRow
          return updated
        }
        return [newRow, ...prev]
      })
      toast({ title: `${data.firstName} ${data.lastName} submitted the quiz` })
    }

    socket.on('quiz:snapshot',   onSnapshot)
    socket.on('quiz:submission', onSubmission)

    return () => {
      socket.emit('quiz:unwatch', { quizId })
      socket.off('quiz:snapshot',   onSnapshot)
      socket.off('quiz:submission', onSubmission)
    }
  }, [quizId])

  // ── Record as grades ───────────────────────────────────────────────────────
  async function handleRecordGrades() {
    setSaving(true)
    try {
      const result = await recordGrades(quizId)
      toast({ title: `${result.recorded} grade(s) recorded successfully` })
    } catch {
      toast({ title: 'Failed to record grades', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const submitted = rows.filter(r => r.status === 'SUBMITTED').length
  const avg       = rows.filter(r => r.score != null).reduce((s, r) => s + (r.score ?? 0), 0) /
                    (rows.filter(r => r.score != null).length || 1)

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="font-semibold text-xl">{submitted}</span>
            <span className="text-muted-foreground"> / {total || rows.length} submitted</span>
          </div>
          {submitted > 0 && (
            <div className="text-sm text-muted-foreground">
              Avg: <span className="font-medium text-foreground">{Math.round(avg)}%</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchResults} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => exportToCsv(quiz, rows)}
            disabled={rows.length === 0}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
          <Button
            size="sm"
            onClick={handleRecordGrades}
            disabled={saving || rows.filter(r => r.status === 'SUBMITTED').length === 0}
          >
            <Award className="w-3.5 h-3.5 mr-1.5" />
            {saving ? 'Saving…' : 'Record as Grades'}
          </Button>
        </div>
      </div>

      {/* Results table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No submissions yet. Live updates will appear as students submit.
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.studentId}>
                  <TableCell className="font-medium">
                    {r.firstName} {r.lastName}
                  </TableCell>
                  <TableCell><ScorePill score={r.score} /></TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'SUBMITTED' ? 'default' : 'secondary'} className="text-xs">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.submittedAt ? new Date(r.submittedAt).toLocaleTimeString() : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.timeTakenMs != null
                      ? `${Math.round(r.timeTakenMs / 60000)}m ${Math.round((r.timeTakenMs % 60000) / 1000)}s`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
