'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { assignmentApi, examApi, type SubmissionStatus } from '@/lib/submissions'
import { cn } from '@/lib/utils'
import { format, isPast } from 'date-fns'
import {
  FileText, ClipboardList, Plus, Send, CheckCircle2, Clock,
  AlertCircle, XCircle, Loader2, ChevronRight, Search,
  BookOpen, GraduationCap, Star, X, Eye, Pencil, Trash2,
  Filter, RotateCcw, FileCheck, Award
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type TabType = 'assignments' | 'exams'

interface Submission {
  id: string
  title: string
  description?: string | null
  textContent?: string | null
  attachments?: string[]
  answers?: Record<string, string> | null
  status: SubmissionStatus
  score?: number | null
  maxScore?: number | null
  percentage?: number | null
  feedback?: string | null
  isLate?: boolean
  submittedAt?: string | null
  gradedAt?: string | null
  createdAt: string
  studentId?: string
  teacherId?: string
  gradeId?: string | null
  classId?: string
  grade?: { id: string; title: string; type: string; dueDate?: string | null; class?: { name: string } } | null
  student?: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  teacher?: { id: string; firstName: string; lastName: string } | null
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<SubmissionStatus, { label: string; color: string; icon: React.ReactNode }> = {
  DRAFT:     { label: 'Draft',     color: 'bg-gray-100 text-gray-600',    icon: <Pencil className="w-3 h-3" /> },
  SUBMITTED: { label: 'Submitted', color: 'bg-blue-100 text-blue-700',    icon: <Send className="w-3 h-3" /> },
  REVIEWED:  { label: 'Reviewed',  color: 'bg-yellow-100 text-yellow-700',icon: <Eye className="w-3 h-3" /> },
  GRADED:    { label: 'Graded',    color: 'bg-green-100 text-green-700',  icon: <CheckCircle2 className="w-3 h-3" /> },
  REJECTED:  { label: 'Rejected',  color: 'bg-red-100 text-red-700',      icon: <XCircle className="w-3 h-3" /> },
  LATE:      { label: 'Late',      color: 'bg-orange-100 text-orange-700',icon: <AlertCircle className="w-3 h-3" /> },
}

function StatusBadge({ status }: { status: SubmissionStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold', cfg.color)}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

function ScoreBadge({ score, maxScore, percentage }: { score: number; maxScore: number; percentage: number }) {
  const pct = percentage ?? (score / maxScore) * 100
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-600'
  return (
    <div className="flex items-center gap-1">
      <Star className={cn('w-3.5 h-3.5', color)} />
      <span className={cn('text-sm font-bold', color)}>{score}/{maxScore}</span>
      <span className="text-xs text-gray-400">({pct.toFixed(0)}%)</span>
    </div>
  )
}

// ─── Submission card ──────────────────────────────────────────────────────────
function SubmissionCard({ sub, tab, isTeacher, onView, onGrade }: {
  sub: Submission; tab: TabType; isTeacher: boolean
  onView: () => void; onGrade: () => void
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-gray-100 rounded-2xl p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onView}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
            tab === 'assignments' ? 'bg-indigo-100' : 'bg-violet-100')}>
            {tab === 'assignments'
              ? <FileText className="w-4 h-4 text-indigo-600" />
              : <ClipboardList className="w-4 h-4 text-violet-600" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{sub.title}</p>
            {sub.grade && (
              <p className="text-xs text-gray-400 mt-0.5">
                {sub.grade.class?.name ?? ''} · {sub.grade.title}
                {sub.grade.dueDate && (
                  <span className={cn('ml-1', isPast(new Date(sub.grade.dueDate)) && sub.status === 'DRAFT' ? 'text-red-500 font-semibold' : '')}>
                    · Due {format(new Date(sub.grade.dueDate), 'MMM d')}
                  </span>
                )}
              </p>
            )}
            {isTeacher && sub.student && (
              <p className="text-xs text-indigo-600 mt-0.5 font-medium">
                {sub.student.firstName} {sub.student.lastName}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatusBadge status={sub.status} />
          {sub.status === 'GRADED' && sub.score != null && sub.maxScore != null && (
            <ScoreBadge score={sub.score} maxScore={sub.maxScore} percentage={sub.percentage ?? 0} />
          )}
        </div>
      </div>

      {/* Feedback preview */}
      {sub.feedback && (
        <div className="mt-3 px-3 py-2 bg-green-50 rounded-xl border border-green-100">
          <p className="text-xs text-green-700 line-clamp-2">
            <span className="font-semibold">Feedback: </span>{sub.feedback}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-[10px] text-gray-400">
          {sub.submittedAt ? `Submitted ${format(new Date(sub.submittedAt), 'MMM d, h:mm a')}` :
           `Created ${format(new Date(sub.createdAt), 'MMM d')}`}
          {sub.isLate && <span className="ml-1 text-orange-500 font-semibold">· Late</span>}
        </span>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {isTeacher && (sub.status === 'SUBMITTED' || sub.status === 'LATE' || sub.status === 'REVIEWED') && (
            <button onClick={onGrade}
              className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors">
              <Award className="w-3 h-3" /> Grade
            </button>
          )}
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </div>
      </div>
    </motion.div>
  )
}

// ─── View modal (student sees their work + feedback) ─────────────────────────
function ViewModal({ sub, tab, onClose }: { sub: Submission; tab: TabType; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            {tab === 'assignments' ? <FileText className="w-4 h-4 text-indigo-600" /> : <ClipboardList className="w-4 h-4 text-violet-600" />}
            <h2 className="font-bold text-gray-900">{sub.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={sub.status} />
            {sub.isLate && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Late</span>}
          </div>

          {sub.grade && (
            <div className="p-3 bg-gray-50 rounded-xl text-sm">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Assignment</p>
              <p className="font-semibold text-gray-900">{sub.grade.title}</p>
              {sub.grade.dueDate && <p className="text-xs text-gray-500 mt-0.5">Due: {format(new Date(sub.grade.dueDate), 'MMM d, yyyy')}</p>}
            </div>
          )}

          {sub.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed">{sub.description}</p>
            </div>
          )}

          {sub.textContent && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Answer</p>
              <div className="p-3 bg-gray-50 rounded-xl text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{sub.textContent}</div>
            </div>
          )}

          {sub.answers && Object.keys(sub.answers).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Answers</p>
              <div className="space-y-2">
                {Object.entries(sub.answers).map(([q, a]) => (
                  <div key={q} className="flex gap-2 text-sm">
                    <span className="text-gray-500 font-medium flex-shrink-0">Q{q}:</span>
                    <span className="text-gray-800">{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sub.status === 'GRADED' && sub.score != null && (
            <div className="p-4 bg-green-50 rounded-xl border border-green-100">
              <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">Grade</p>
              <ScoreBadge score={sub.score} maxScore={sub.maxScore ?? 100} percentage={sub.percentage ?? 0} />
              {sub.feedback && (
                <p className="text-sm text-gray-700 mt-2 leading-relaxed">
                  <span className="font-semibold text-green-700">Feedback: </span>{sub.feedback}
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Grade modal (teacher) ────────────────────────────────────────────────────
function GradeModal({ sub, tab, onClose, onDone }: {
  sub: Submission; tab: TabType; onClose: () => void; onDone: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [score, setScore] = useState(sub.score?.toString() ?? '')
  const [maxScore, setMaxScore] = useState(sub.maxScore?.toString() ?? '100')
  const [feedback, setFeedback] = useState(sub.feedback ?? '')

  const api = tab === 'assignments' ? assignmentApi : examApi
  const gradeMutation = useMutation({
    mutationFn: () => api.grade(sub.id, {
      score: parseFloat(score), maxScore: parseFloat(maxScore), feedback: feedback.trim() || undefined
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] })
      toast({ title: 'Graded successfully' })
      onDone()
    },
    onError: () => toast({ title: 'Failed to grade', variant: 'destructive' }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Grade Submission</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">{sub.title}</p>
            {sub.student && <p className="text-xs text-gray-400">{sub.student.firstName} {sub.student.lastName}</p>}
          </div>

          {(sub.textContent || sub.description) && (
            <div className="p-3 bg-gray-50 rounded-xl max-h-32 overflow-y-auto">
              <p className="text-xs text-gray-600 leading-relaxed">{sub.textContent ?? sub.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Score</label>
              <input type="number" value={score} onChange={e => setScore(e.target.value)} min={0}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400" placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Max Score</label>
              <input type="number" value={maxScore} onChange={e => setMaxScore(e.target.value)} min={1}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400" placeholder="100" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Feedback (optional)</label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 resize-none"
              placeholder="Write feedback for the student…" />
          </div>

          {score && maxScore && (
            <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 rounded-xl">
              <span className="text-xs text-indigo-600 font-semibold">Score preview</span>
              <ScoreBadge score={parseFloat(score)} maxScore={parseFloat(maxScore)} percentage={(parseFloat(score)/parseFloat(maxScore))*100} />
            </div>
          )}

          <button onClick={() => gradeMutation.mutate()}
            disabled={!score || !maxScore || gradeMutation.isPending}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            {gradeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
            Submit Grade
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Create/Submit modal (student) ───────────────────────────────────────────
function CreateModal({ tab, onClose, onDone, studentId }: {
  tab: TabType; onClose: () => void; onDone: () => void; studentId: string
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [desc, setDesc] = useState('')
  const [classId, setClassId] = useState('')
  const [step, setStep] = useState<'draft' | 'submitting'>('draft')

  const { data: classes } = useQuery({
    queryKey: ['my-classes-simple'],
    queryFn: () => import('@/lib/api').then(m => m.default.get('/classes').then(r => r.data.data ?? [])),
    staleTime: 60000,
  })

  const api = tab === 'assignments' ? assignmentApi : examApi

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await api.create({ classId, studentId, title: title.trim(), description: desc.trim() || undefined, textContent: tab === 'assignments' ? text.trim() || undefined : undefined })
      const id = created.data.data.id
      await api.submit(id, tab === 'assignments' ? { textContent: text.trim() || undefined } : {})
      return id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submissions'] })
      toast({ title: `${tab === 'assignments' ? 'Assignment' : 'Exam'} submitted!` })
      onDone()
    },
    onError: () => toast({ title: 'Failed to submit', variant: 'destructive' }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">
            New {tab === 'assignments' ? 'Assignment' : 'Exam'} Submission
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400"
              placeholder="e.g. Chapter 3 Homework" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 bg-white">
              <option value="">Select class…</option>
              {(classes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {tab === 'assignments' && (
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Description (optional)</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 resize-none"
                placeholder="Brief description…" />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">
              {tab === 'assignments' ? 'Your Answer' : 'Essay / Answer'} (optional)
            </label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-indigo-400 resize-none"
              placeholder="Write your answer here…" />
          </div>

          <button onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit {tab === 'assignments' ? 'Assignment' : 'Exam'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
function AssignmentsContent() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const qc = useQueryClient()

  const searchParams = useSearchParams()
  const isTeacher = user?.role === 'TEACHER' || user?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isStudent = user?.role === 'STUDENT'

  const [tab, setTab] = useState<TabType>(() =>
    searchParams.get('tab') === 'exams' ? 'exams' : 'assignments'
  )
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [viewSub, setViewSub]   = useState<Submission | null>(null)
  const [gradeSub, setGradeSub] = useState<Submission | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // ── Fetch submissions ────────────────────────────────────────────────────────
  const api = tab === 'assignments' ? assignmentApi : examApi

  // Student: my submissions
  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['submissions', tab, 'student', user?.id],
    queryFn: () => user?.id ? api.mySubmissions(user.id) : Promise.resolve({ data: { data: [] } } as any),
    enabled: !!user?.id && isStudent,
    staleTime: 30000,
  })

  // Teacher: all class submissions — using gradeId '' shows all (backend returns by teacher)
  // For teacher we fetch with their user ID via student route workaround — backend allows by role
  const { data: teacherData, isLoading: teacherLoading } = useQuery({
    queryKey: ['submissions', tab, 'teacher', user?.id],
    queryFn: () => user?.id ? api.mySubmissions(user.id) : Promise.resolve({ data: { data: [] } } as any),
    enabled: !!user?.id && isTeacher,
    staleTime: 30000,
  })

  const rawSubs: Submission[] = isStudent
    ? (myData?.data?.data ?? [])
    : (teacherData?.data?.data ?? [])

  const isLoading = isStudent ? myLoading : teacherLoading

  // ── Delete (student, draft only) ─────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['submissions'] }); toast({ title: 'Deleted' }) },
    onError: () => toast({ title: 'Cannot delete', variant: 'destructive' }),
  })

  // ── Filters ──────────────────────────────────────────────────────────────────
  const filtered = rawSubs.filter(s => {
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false
    if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = {
    total:     rawSubs.length,
    graded:    rawSubs.filter(s => s.status === 'GRADED').length,
    pending:   rawSubs.filter(s => s.status === 'SUBMITTED' || s.status === 'LATE').length,
    avgScore:  rawSubs.filter(s => s.percentage != null).length
      ? Math.round(rawSubs.reduce((a, s) => a + (s.percentage ?? 0), 0) / rawSubs.filter(s => s.percentage != null).length)
      : null,
  }

  const tabLabel = tab === 'assignments' ? 'Assignments' : 'Exams'
  const tabIcon  = tab === 'assignments' ? <FileText className="w-4 h-4" /> : <ClipboardList className="w-4 h-4" />

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-indigo-600" />
            {isTeacher ? 'Submissions Review' : 'My Submissions'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isTeacher ? 'Review and grade student submissions' : 'Track your assignment and exam submissions'}
          </p>
        </div>
        {isStudent && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Submission
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, icon: <FileCheck className="w-5 h-5 text-indigo-500" />, bg: 'bg-indigo-50' },
          { label: isTeacher ? 'Needs Grading' : 'Submitted', value: stats.pending, icon: <Clock className="w-5 h-5 text-orange-500" />, bg: 'bg-orange-50' },
          { label: 'Graded', value: stats.graded, icon: <CheckCircle2 className="w-5 h-5 text-green-500" />, bg: 'bg-green-50' },
          { label: 'Avg Score', value: stats.avgScore != null ? `${stats.avgScore}%` : '—', icon: <Star className="w-5 h-5 text-yellow-500" />, bg: 'bg-yellow-50' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', s.bg)}>{s.icon}</div>
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tab + filters */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {(['assignments', 'exams'] as TabType[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors capitalize',
                tab === t ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {t === 'assignments' ? <FileText className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
              {t}
            </button>
          ))}
        </div>

        {/* Search + status filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${tabLabel.toLowerCase()}…`}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-300 bg-gray-50" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-300 bg-white">
            <option value="ALL">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(search || statusFilter !== 'ALL') && (
            <button onClick={() => { setSearch(''); setStatusFilter('ALL') }}
              className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Submissions list */}
      <div className="space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white border border-gray-100 rounded-2xl animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            {tab === 'assignments' ? <FileText className="w-12 h-12 mb-3 opacity-20" /> : <ClipboardList className="w-12 h-12 mb-3 opacity-20" />}
            <p className="font-semibold text-gray-500">No {tabLabel.toLowerCase()} found</p>
            {isStudent && !search && (
              <button onClick={() => setShowCreate(true)}
                className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Submit your first {tab === 'assignments' ? 'assignment' : 'exam'}
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map(sub => (
              <SubmissionCard key={sub.id} sub={sub} tab={tab} isTeacher={isTeacher}
                onView={() => setViewSub(sub)}
                onGrade={() => setGradeSub(sub)} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Modals */}
      {viewSub  && <ViewModal  sub={viewSub}  tab={tab} onClose={() => setViewSub(null)} />}
      {gradeSub && <GradeModal sub={gradeSub} tab={tab} onClose={() => setGradeSub(null)} onDone={() => setGradeSub(null)} />}
      {showCreate && user && (
        <CreateModal tab={tab} studentId={user.id} onClose={() => setShowCreate(false)} onDone={() => setShowCreate(false)} />
      )}
    </div>
  )
}

// ─── Suspense boundary (required for useSearchParams in Next.js 14) ──────────
export default function AssignmentsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-4">
        <div className="h-10 w-64 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    }>
      <AssignmentsContent />
    </Suspense>
  )
}
