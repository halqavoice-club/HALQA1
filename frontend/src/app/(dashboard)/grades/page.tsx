'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { downloadFile, buildFilename } from '@/lib/download'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Plus,
  BookMarked,
  TrendingUp,
  Download,
  Trash2,
  Save,
  Users,
  Award,
  Target,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

type GradeType =
  | 'ASSIGNMENT'
  | 'QUIZ'
  | 'EXAM'
  | 'ORAL_TEST'
  | 'MEMORIZATION'
  | 'PROJECT'
  | 'PARTICIPATION'

interface Grade {
  id: string
  studentId: string
  classId: string
  title: string
  type: GradeType
  score: number
  maxScore: number
  feedback?: string
  createdAt: string
  student?: {
    id: string
    user?: { firstName: string; lastName: string }
    studentId?: string
  }
}

interface ClassItem {
  id: string
  name: string
  gradeLevel?: string
  enrollments?: Array<{
    student: {
      id: string
      studentId?: string
      user?: { firstName: string; lastName: string }
    }
  }>
}

interface StudentSummary {
  studentId: string
  studentName: string
  count: number
  average: number
  letterGrade: string
  gpa: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLetterGrade(pct: number): string {
  if (pct >= 97) return 'A+'
  if (pct >= 93) return 'A'
  if (pct >= 90) return 'A-'
  if (pct >= 87) return 'B+'
  if (pct >= 83) return 'B'
  if (pct >= 80) return 'B-'
  if (pct >= 77) return 'C+'
  if (pct >= 73) return 'C'
  if (pct >= 70) return 'C-'
  if (pct >= 60) return 'D'
  return 'F'
}

function getGPA(pct: number): number {
  if (pct >= 97) return 4.0
  if (pct >= 93) return 4.0
  if (pct >= 90) return 3.7
  if (pct >= 87) return 3.3
  if (pct >= 83) return 3.0
  if (pct >= 80) return 2.7
  if (pct >= 77) return 2.3
  if (pct >= 73) return 2.0
  if (pct >= 70) return 1.7
  if (pct >= 60) return 1.0
  return 0.0
}

function getGradeColor(pct: number): string {
  if (pct >= 90) return 'text-green-600 bg-green-50'
  if (pct >= 80) return 'text-blue-600 bg-blue-50'
  if (pct >= 70) return 'text-yellow-600 bg-yellow-50'
  if (pct >= 60) return 'text-orange-600 bg-orange-50'
  return 'text-red-600 bg-red-50'
}

function getGradeBadgeVariant(pct: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (pct >= 70) return 'default'
  if (pct >= 60) return 'secondary'
  return 'destructive'
}

const GRADE_TYPES: GradeType[] = [
  'ASSIGNMENT',
  'QUIZ',
  'EXAM',
  'ORAL_TEST',
  'MEMORIZATION',
  'PROJECT',
  'PARTICIPATION',
]

const TYPE_LABELS: Record<GradeType, string> = {
  ASSIGNMENT: 'Assignment',
  QUIZ: 'Quiz',
  EXAM: 'Exam',
  ORAL_TEST: 'Oral Test',
  MEMORIZATION: 'Memorization',
  PROJECT: 'Project',
  PARTICIPATION: 'Participation',
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GradesPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const isStudent = user?.role === 'STUDENT'
  const isGuardian = user?.role === 'GUARDIAN'
  const canManage = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user?.role || '')

  // ── State ──
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [studentFilter, setStudentFilter] = useState<string>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showBulkEntry, setShowBulkEntry] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Add grade form state
  const [form, setForm] = useState({
    studentId: '',
    title: '',
    type: 'ASSIGNMENT' as GradeType,
    score: '',
    maxScore: '100',
    feedback: '',
  })

  // Bulk entry state
  const [bulkTitle, setBulkTitle] = useState('')
  const [bulkType, setBulkType] = useState<GradeType>('ASSIGNMENT')
  const [bulkMaxScore, setBulkMaxScore] = useState('100')
  const [bulkScores, setBulkScores] = useState<Record<string, string>>({})

  // ── Queries ──
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data),
  })
  const classes: ClassItem[] = classesData?.data || []

  const { data: classDetailData } = useQuery({
    queryKey: ['class', selectedClassId],
    queryFn: () => api.get(`/classes/${selectedClassId}`).then(r => r.data),
    enabled: !!selectedClassId,
  })
  const classDetail: ClassItem | null = classDetailData?.data || null
  const enrollments = classDetail?.enrollments || []

  // For student role — fetch their own student profile to get the real student ID
  const { data: myStudentProfile } = useQuery({
    queryKey: ['my-student-profile'],
    queryFn: () => api.get('/auth/me').then(r => r.data.data),
    enabled: isStudent || isGuardian,
  })
  const studentId = myStudentProfile?.student?.id || user?.student?.id || ''

  // For guardian — get linked students
  const guardianId = myStudentProfile?.guardian?.id || user?.guardian?.id || ''
  const { data: guardianData } = useQuery({
    queryKey: ['guardian-grades', guardianId],
    queryFn: () => api.get(`/guardians/${guardianId}`).then(r => r.data.data),
    enabled: isGuardian && !!guardianId,
  })
  const guardianStudents = guardianData?.students?.map((gs: any) => gs.student).filter(Boolean) || []
  const [selectedGuardianStudentId, setSelectedGuardianStudentId] = useState('')
  const activeGuardianStudentId = selectedGuardianStudentId || guardianStudents[0]?.id || ''

  const { data: guardianStudentGrades, isLoading: loadingGuardianGrades } = useQuery({
    queryKey: ['grades-guardian-student', activeGuardianStudentId],
    queryFn: () => api.get(`/grades/student/${activeGuardianStudentId}`).then(r => r.data.data),
    enabled: isGuardian && !!activeGuardianStudentId,
  })

  const { data: classGradesData, isLoading: loadingClassGrades } = useQuery({
    queryKey: ['grades-class', selectedClassId],
    queryFn: () => api.get(`/grades/class/${selectedClassId}`).then(r => r.data),
    enabled: !!selectedClassId && !isStudent,
  })
  const classGrades: Grade[] = classGradesData?.data || []

  const { data: studentGradesData, isLoading: loadingStudentGrades } = useQuery({
    queryKey: ['grades-student', studentId],
    queryFn: () => api.get(`/grades/student/${studentId}`).then(r => r.data),
    enabled: isStudent && !!studentId,
  })
  const studentGrades: Grade[] = studentGradesData?.data?.grades || []
  const studentSummaryApi = studentGradesData?.data?.summary || null

  // ── Mutations ──
  const addGrade = useMutation({
    mutationFn: (payload: object) => api.post('/grades', payload).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades-class', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['grades-student'] })
      toast({ title: 'Grade added successfully' })
      setForm({ studentId: '', title: '', type: 'ASSIGNMENT', score: '', maxScore: '100', feedback: '' })
      setShowAddForm(false)
    },
    onError: (e: any) => toast({ title: 'Failed to add grade', description: e.response?.data?.message, variant: 'destructive' }),
  })

  const deleteGrade = useMutation({
    mutationFn: (id: string) => api.delete(`/grades/${id}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades-class', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['grades-student'] })
      toast({ title: 'Grade deleted' })
    },
    onError: (e: any) => toast({ title: 'Failed to delete grade', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Derived data ──
  const filteredGrades = useMemo(() => {
    if (studentFilter === 'all') return classGrades
    return classGrades.filter(g => g.studentId === studentFilter)
  }, [classGrades, studentFilter])

  const perStudentSummaries: StudentSummary[] = useMemo(() => {
    if (!enrollments.length) return []
    return enrollments.map(({ student }) => {
      const grades = classGrades.filter(g => g.studentId === student.id)
      const total = grades.reduce((s, g) => s + (g.score / g.maxScore) * 100, 0)
      const avg = grades.length ? total / grades.length : 0
      return {
        studentId: student.id,
        studentName: `${student.user?.firstName || ''} ${student.user?.lastName || ''}`.trim(),
        count: grades.length,
        average: avg,
        letterGrade: getLetterGrade(avg),
        gpa: getGPA(avg),
      }
    })
  }, [enrollments, classGrades])

  const classSummary = useMemo(() => {
    if (!classGrades.length) return null
    const pcts = classGrades.map(g => (g.score / g.maxScore) * 100)
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length
    const highest = Math.max(...pcts)
    const lowest = Math.min(...pcts)
    const passRate = (pcts.filter(p => p >= 60).length / pcts.length) * 100
    return { avg, highest, lowest, passRate }
  }, [classGrades])

  // ── Handlers ──
  function handleAddGrade(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClassId) return toast({ title: 'Select a class first', variant: 'destructive' })
    addGrade.mutate({
      studentId: form.studentId,
      classId: selectedClassId,
      title: form.title,
      type: form.type,
      score: parseFloat(form.score),
      maxScore: parseFloat(form.maxScore),
      feedback: form.feedback || undefined,
    })
  }

  async function handleBulkSave() {
    if (!bulkTitle.trim()) return toast({ title: 'Enter an assessment title', variant: 'destructive' })
    const entries = Object.entries(bulkScores).filter(([, v]) => v !== '')
    if (!entries.length) return toast({ title: 'Enter at least one score', variant: 'destructive' })
    try {
      await Promise.all(
        entries.map(([sid, score]) =>
          api.post('/grades', {
            studentId: sid,
            classId: selectedClassId,
            title: bulkTitle,
            type: bulkType,
            score: parseFloat(score),
            maxScore: parseFloat(bulkMaxScore),
          })
        )
      )
      queryClient.invalidateQueries({ queryKey: ['grades-class', selectedClassId] })
      toast({ title: `Saved ${entries.length} grades` })
      setBulkScores({})
      setBulkTitle('')
      setShowBulkEntry(false)
    } catch (e: any) {
      toast({ title: 'Bulk save failed', description: e.response?.data?.message, variant: 'destructive' })
    }
  }

  async function handleExport() {
    if (!selectedClassId && !isStudent) return toast({ title: 'Select a class first', variant: 'destructive' })
    setExporting(true)
    try {
      // Use the existing report export endpoint
      const endpoint = isStudent
        ? `/reports/student/${studentId}/export/excel`
        : `/reports/grades`
      const params = isStudent ? {} : { classId: selectedClassId, format: 'xlsx' }
      const filename = buildFilename('grades', 'xlsx', isStudent ? 'my-grades' : selectedClassId)
      await downloadFile(endpoint, params, filename)
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const isLoading = isStudent ? loadingStudentGrades : loadingClassGrades

  // ── Guardian view ──
  if (isGuardian) {
    const gGrades: Grade[] = guardianStudentGrades?.grades || []
    const gSummary = guardianStudentGrades?.summary || {}
    const gAvg = gGrades.length
      ? gGrades.reduce((s, g) => s + (g.score / g.maxScore) * 100, 0) / gGrades.length
      : 0
    const activeStudent = guardianStudents.find((s: any) => s.id === activeGuardianStudentId)

    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Children's Grades</h1>
          <p className="text-gray-500 text-sm">Grade records for your linked children</p>
        </div>

        {/* Student selector */}
        {guardianStudents.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {guardianStudents.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setSelectedGuardianStudentId(s.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  activeGuardianStudentId === s.id
                    ? 'bg-halqa-700 text-white border-halqa-700'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-halqa-300'
                }`}
              >
                {s.user?.firstName} {s.user?.lastName}
              </button>
            ))}
          </div>
        )}

        {/* Summary */}
        {activeStudent && (
          <div className="flex items-center gap-3 p-4 bg-halqa-50 rounded-xl">
            <div className="w-10 h-10 bg-halqa-100 rounded-full flex items-center justify-center font-bold text-halqa-700">
              {activeStudent.user?.firstName?.[0]}{activeStudent.user?.lastName?.[0]}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{activeStudent.user?.firstName} {activeStudent.user?.lastName}</p>
              <p className="text-xs text-gray-500">{activeStudent.studentId}</p>
            </div>
            {gGrades.length > 0 && (
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-halqa-700">{gAvg.toFixed(1)}%</p>
                <p className="text-xs text-gray-500">Average · {getLetterGrade(gAvg)}</p>
              </div>
            )}
          </div>
        )}

        {/* Grades table */}
        {loadingGuardianGrades ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
        ) : gGrades.length === 0 ? (
          <div className="text-center py-12">
            <BookMarked className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No grades recorded yet</p>
          </div>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Grade</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gGrades.map((g: any) => {
                      const pct = (g.score / g.maxScore) * 100
                      return (
                        <tr key={g.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{g.title}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">{TYPE_LABELS[g.type as GradeType] || g.type}</Badge>
                          </td>
                          <td className="px-4 py-3 text-center">{g.score}/{g.maxScore}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${getGradeColor(pct)}`}>
                              {getLetterGrade(pct)} · {pct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{format(new Date(g.createdAt || g.gradedAt), 'MMM d, yyyy')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ── Student view ──
  if (isStudent) {
    const myAvg = studentGrades.length
      ? studentGrades.reduce((s, g) => s + (g.score / g.maxScore) * 100, 0) / studentGrades.length
      : 0

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Grades</h1>
            <p className="text-gray-500 text-sm">{studentGrades.length} total grades</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </Button>
        </div>

        {/* Totals card */}
        {studentGrades.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{studentGrades.length}</p>
                <p className="text-xs text-gray-500 mt-1">Total Grades</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${myAvg >= 60 ? 'text-green-600' : 'text-red-600'}`}>
                  {myAvg.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500 mt-1">Average</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{getLetterGrade(myAvg)}</p>
                <p className="text-xs text-gray-500 mt-1">Letter Grade</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{getGPA(myAvg).toFixed(1)}</p>
                <p className="text-xs text-gray-500 mt-1">GPA</p>
              </CardContent>
            </Card>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : studentGrades.length === 0 ? (
          <div className="text-center py-16">
            <BookMarked className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No grades recorded yet</p>
          </div>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Grade</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentGrades.map(g => {
                      const pct = (g.score / g.maxScore) * 100
                      return (
                        <tr key={g.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900">{g.title}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">{TYPE_LABELS[g.type]}</Badge>
                          </td>
                          <td className="px-4 py-3 text-center">{g.score}/{g.maxScore}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${getGradeColor(pct)}`}>
                              {getLetterGrade(pct)} · {pct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{format(new Date(g.createdAt), 'MMM d, yyyy')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ── Teacher / Admin view ──
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Grades</h1>
          <p className="text-gray-500 text-sm">Manage and track student grades</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canManage && selectedClassId && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => { setShowBulkEntry(v => !v); setShowAddForm(false) }}
              >
                <Users className="w-4 h-4" />
                Bulk Entry
                {showBulkEntry ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-halqa-700 hover:bg-halqa-800"
                onClick={() => { setShowAddForm(v => !v); setShowBulkEntry(false) }}
              >
                <Plus className="w-4 h-4" />
                Add Grade
                {showAddForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={exporting || !selectedClassId}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="w-56">
          <Select value={selectedClassId} onValueChange={v => { setSelectedClassId(v); setStudentFilter('all') }}>
            <SelectTrigger>
              <SelectValue placeholder="Select a class..." />
            </SelectTrigger>
            <SelectContent>
              {classes.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedClassId && enrollments.length > 0 && (
          <div className="w-56">
            <Select value={studentFilter} onValueChange={setStudentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All students" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Students</SelectItem>
                {enrollments.map(({ student }) => (
                  <SelectItem key={student.id} value={student.id}>
                    {student.user?.firstName} {student.user?.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Add Grade Form */}
      {showAddForm && selectedClassId && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Grade
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddGrade} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Student</Label>
                <Select value={form.studentId} onValueChange={v => setForm(f => ({ ...f, studentId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select student..." />
                  </SelectTrigger>
                  <SelectContent>
                    {enrollments.map(({ student }) => (
                      <SelectItem key={student.id} value={student.id}>
                        {student.user?.firstName} {student.user?.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  placeholder="e.g. Chapter 3 Quiz"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as GradeType }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Score</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={form.score}
                  onChange={e => setForm(f => ({ ...f, score: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Max Score</Label>
                <Input
                  type="number"
                  min="1"
                  step="0.5"
                  value={form.maxScore}
                  onChange={e => setForm(f => ({ ...f, maxScore: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Feedback (optional)</Label>
                <Input
                  placeholder="Comments..."
                  value={form.feedback}
                  onChange={e => setForm(f => ({ ...f, feedback: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2 lg:col-span-3 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
                <Button type="submit" disabled={addGrade.isPending} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                  {addGrade.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Grade
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Bulk Entry */}
      {showBulkEntry && selectedClassId && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> Bulk Grade Entry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Assessment Title</Label>
                <Input
                  placeholder="e.g. Midterm Exam"
                  value={bulkTitle}
                  onChange={e => setBulkTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={bulkType} onValueChange={v => setBulkType(v as GradeType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GRADE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Max Score</Label>
                <Input
                  type="number"
                  min="1"
                  value={bulkMaxScore}
                  onChange={e => setBulkMaxScore(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Student</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">Score / {bulkMaxScore}</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map(({ student }) => (
                    <tr key={student.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-gray-900">
                        {student.user?.firstName} {student.user?.lastName}
                        {student.studentId && <span className="text-gray-400 text-xs ml-2">#{student.studentId}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          max={bulkMaxScore}
                          step="0.5"
                          className="h-8 w-28"
                          placeholder="—"
                          value={bulkScores[student.id] || ''}
                          onChange={e => setBulkScores(s => ({ ...s, [student.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowBulkEntry(false)}>Cancel</Button>
              <Button className="gap-2 bg-halqa-700 hover:bg-halqa-800" onClick={handleBulkSave}>
                <Save className="w-4 h-4" /> Save All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedClassId ? (
        <div className="text-center py-20">
          <BookMarked className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Select a class to view grades</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <>
          {/* Class Summary Stats */}
          {classSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{classSummary.avg.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500">Class Average</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                    <Award className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{classSummary.highest.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500">Highest Score</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                    <Target className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{classSummary.lowest.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500">Lowest Score</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{classSummary.passRate.toFixed(0)}%</p>
                    <p className="text-xs text-gray-500">Pass Rate (≥60%)</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Per-Student Totals */}
          {perStudentSummaries.length > 0 && studentFilter === 'all' && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" /> Student Totals
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Grades</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Average</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Letter</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">GPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perStudentSummaries.map(s => (
                        <tr key={s.studentId} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900">{s.studentName}</td>
                          <td className="px-4 py-3 text-center text-gray-600">{s.count}</td>
                          <td className="px-4 py-3 text-center">
                            {s.count > 0 ? (
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${getGradeColor(s.average)}`}>
                                {s.average.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-gray-900">
                            {s.count > 0 ? s.letterGrade : '—'}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">
                            {s.count > 0 ? s.gpa.toFixed(1) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grades Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookMarked className="w-4 h-4" />
                Grade Records
                <Badge variant="secondary" className="ml-auto">{filteredGrades.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filteredGrades.length === 0 ? (
                <div className="text-center py-12">
                  <BookMarked className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No grades recorded yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Grade</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                        {canManage && <th className="px-4 py-3" />}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGrades.map(g => {
                        const pct = (g.score / g.maxScore) * 100
                        return (
                          <tr key={g.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {g.student?.user?.firstName} {g.student?.user?.lastName}
                            </td>
                            <td className="px-4 py-3 text-gray-700">{g.title}</td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className="text-xs">{TYPE_LABELS[g.type]}</Badge>
                            </td>
                            <td className="px-4 py-3 text-center text-gray-700">{g.score}/{g.maxScore}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${getGradeColor(pct)}`}>
                                {getLetterGrade(pct)} · {pct.toFixed(0)}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500">{format(new Date(g.createdAt), 'MMM d, yyyy')}</td>
                            {canManage && (
                              <td className="px-4 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                                  onClick={() => deleteGrade.mutate(g.id)}
                                  disabled={deleteGrade.isPending}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
