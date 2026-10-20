'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useSchoolAccess } from '@/hooks/useSchoolAccess'
import { StatusBadge } from '@/components/ui/status-badge'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ArrowLeft, QrCode, Mail, Phone, Calendar, BookOpen,
  CheckCircle, XCircle, Clock, Star, BookMarked, Users,
  TrendingUp, Download, Edit, Trash2, MessageSquare,
  Send, Loader2, Bell, UserCheck, ArrowRightLeft, X
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import { NoSSRChart } from '@/components/charts/no-ssr-chart'
import { getAvatarUrl } from '@/lib/avatar'
import { StudentIdCard } from '@/components/student-id-card'
import { StudentProgressChart } from '@/components/charts/student-progress-chart'

const ATTENDANCE_COLORS: Record<string, string> = {
  PRESENT: '#10b981', ABSENT: '#ef4444', LATE: '#f59e0b',
  EXCUSED: '#3b82f6', LEFT_EARLY: '#f97316'
}

function getGradeBg(pct: number) {
  if (pct >= 90) return 'bg-green-100 text-green-700'
  if (pct >= 80) return 'bg-blue-100 text-blue-700'
  if (pct >= 70) return 'bg-yellow-100 text-yellow-700'
  if (pct >= 60) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { activeRole } = useSchoolAccess()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showIdCard, setShowIdCard] = useState(false)

  // ── Class reassignment state ──
  const [showClassPanel, setShowClassPanel] = useState(false)

  // ── Communication state ──
  const [showMsgModal, setShowMsgModal] = useState(false)
  const [msgTarget, setMsgTarget] = useState<'student' | 'guardians' | 'all'>('student')
  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [msgSending, setMsgSending] = useState(false)

  const { data: student, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get(`/students/${id}`).then(r => r.data.data)
  })

  const { data: attendanceData } = useQuery({
    queryKey: ['attendance', 'student', id],
    queryFn: () => api.get(`/attendance/student/${id}`, { params: { limit: 60 } }).then(r => r.data),
    enabled: !!id
  })

  const { data: gradesData } = useQuery({
    queryKey: ['grades', 'student', id],
    queryFn: () => api.get(`/grades/student/${id}`).then(r => r.data.data),
    enabled: !!id
  })

  const { data: behaviorData } = useQuery({
    queryKey: ['behavior', 'student', id],
    queryFn: () => api.get(`/behavior/student/${id}`).then(r => r.data),
    enabled: !!id
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: () => {
      toast({ title: 'Student deleted' })
      router.push('/students')
    }
  })

  // ── Class list for reassignment ──
  const { data: classesData } = useQuery({
    queryKey: ['classes-picker'],
    queryFn: () => api.get('/classes', { params: { limit: 100 } }).then(r => r.data),
    enabled: showClassPanel,
    staleTime: 0,
  })
  const allClasses: any[] = classesData?.data || []

  const enrollMutation = useMutation({
    mutationFn: (classId: string) => api.post(`/students/${id}/enroll`, { classId }),
    onSuccess: () => {
      toast({ title: 'Student added to class' })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['classes-picker'] })
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to enroll', variant: 'destructive' }),
  })

  const unenrollMutation = useMutation({
    mutationFn: (classId: string) => api.delete(`/students/${id}/enroll/${classId}`),
    onSuccess: () => {
      toast({ title: 'Student removed from class' })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['classes-picker'] })
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to remove from class', variant: 'destructive' }),
  })

  // ── Send message to student / guardians ──
  const handleSendMessage = async () => {
    // Single student → use DM (WhatsApp-style), not email
    if (msgTarget === 'student' && student?.user?.id) {
      setShowMsgModal(false)
      router.push(`/dm?userId=${student.user.id}`)
      return
    }

    if (!msgBody.trim()) {
      toast({ title: 'Message body is required', variant: 'destructive' })
      return
    }
    setMsgSending(true)
    try {
      const recipientIds: string[] = []

      if (msgTarget === 'guardians' || msgTarget === 'all') {
        student?.guardianLinks?.forEach((link: any) => {
          if (link.guardian?.user?.id) recipientIds.push(link.guardian.user.id)
        })
      }
      // 'all' also includes the student
      if (msgTarget === 'all' && student?.user?.id) {
        recipientIds.push(student.user.id)
      }

      if (recipientIds.length === 0) {
        toast({ title: 'No recipients found', variant: 'destructive' })
        return
      }

      await api.post('/messages', {
        recipientIds,
        subject: msgSubject || `Message about ${student?.user?.firstName} ${student?.user?.lastName}`,
        body: msgBody
      })

      toast({ title: `Message sent to ${recipientIds.length} recipient${recipientIds.length > 1 ? 's' : ''}` })
      setShowMsgModal(false)
      setMsgBody('')
      setMsgSubject('')
      queryClient.invalidateQueries({ queryKey: ['messages'] })
    } catch (err: any) {
      toast({ title: err.response?.data?.message || 'Failed to send message', variant: 'destructive' })
    } finally {
      setMsgSending(false)
    }
  }

  // SA-STUDENT-01: SUPER_ADMIN is a platform role — not a school-scoped admin.
  // Editing student profiles is a school-scoped action (SCHOOL_ADMIN membership role).
  const canEdit = activeRole === 'SCHOOL_ADMIN' || activeRole === 'TEACHER'

  // ID card is viewable by admins/teachers AND by the student themselves (own card) AND guardians
  const canViewIdCard = canEdit
    || activeRole === 'GUARDIAN'
    || (activeRole === 'STUDENT' && student?.userId === user?.id)
    || (student?.user?.id === user?.id) // fallback: viewing own record

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!student) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Student not found</p>
        <Link href="/students"><Button className="mt-4" variant="outline">Back to Students</Button></Link>
      </div>
    )
  }

  const attendance = attendanceData?.data?.records || []
  const attendanceStats = attendanceData?.data?.stats || {}
  const grades = gradesData?.grades || []
  const gradeSummary = gradesData?.summary || {}
  const behaviorLogs = behaviorData?.data?.logs || []
  const behaviorStats = behaviorData?.data?.stats || {}

  // Build attendance pie data
  const attendancePie = Object.entries(attendanceStats)
    .filter(([k]) => ['present', 'absent', 'late', 'excused'].includes(k))
    .map(([k, v]) => ({
      name: k.charAt(0).toUpperCase() + k.slice(1),
      value: v as number,
      color: ATTENDANCE_COLORS[k.toUpperCase()] || '#94a3b8'
    }))
    .filter(d => d.value > 0)

  // Build grade bar data by type
  const gradesByType = grades.reduce((acc: any, g: any) => {
    if (!acc[g.type]) acc[g.type] = { type: g.type, total: 0, count: 0 }
    acc[g.type].total += g.percentage || 0
    acc[g.type].count++
    return acc
  }, {})
  const gradeChartData = Object.values(gradesByType).map((g: any) => ({
    type: g.type.replace('_', ' '),
    avg: Math.round(g.total / g.count)
  }))

  return (
    <div className="space-y-6">
      {/* ID Card modal */}
      {showIdCard && student && (
        <StudentIdCard
          student={student}
          onClose={() => setShowIdCard(false)}
        />
      )}

      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Students', href: '/students' },
        { label: `${student.user?.firstName} ${student.user?.lastName}` }
      ]} />

      {/* Back + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link href="/students" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Students
        </Link>

        <div className="flex gap-2 flex-wrap">
          {/* ID Card — visible to admin, teacher, guardian, and the student themselves */}
          {canViewIdCard && (
            <Button
              variant="outline" size="sm"
              className="gap-2 text-purple-700 border-purple-200 hover:bg-purple-50"
              onClick={() => setShowIdCard(true)}
            >
              <QrCode className="w-4 h-4" /> ID Card
            </Button>
          )}

          {/* Edit-gated actions — SCHOOL_ADMIN and TEACHER only */}
          {canEdit && (
            <>
              <Link href={`/students/${id}/attendance`}>
                <Button variant="outline" size="sm" className="gap-2 text-green-700 border-green-200 hover:bg-green-50">
                  <CheckCircle className="w-4 h-4" /> Attendance
                </Button>
              </Link>
              <Link href={`/students/${id}/report`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" /> Report Card
                </Button>
              </Link>
              <Button
                variant="outline" size="sm"
                className="gap-2 text-blue-700 border-blue-200 hover:bg-blue-50"
                onClick={() => setShowMsgModal(true)}
              >
                <MessageSquare className="w-4 h-4" /> Message
              </Button>
              <Link href={`/students/${id}/edit`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Edit className="w-4 h-4" /> Edit
                </Button>
              </Link>
              <Button
                variant="outline" size="sm"
                className="gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                onClick={() => setShowClassPanel(p => !p)}
              >
                <ArrowRightLeft className="w-4 h-4" /> Classes
              </Button>
              <Button
                variant="outline" size="sm"
                className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Student"
        message={`Are you sure you want to delete ${student.user?.firstName} ${student.user?.lastName}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Profile header */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <Avatar className="w-20 h-20 flex-shrink-0">
              <AvatarImage src={getAvatarUrl(student.user?.avatarUrl)} />
              <AvatarFallback className="bg-halqa-100 text-halqa-700 text-2xl font-bold">
                {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1">
              <div className="flex flex-wrap items-start gap-3 mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {student.user?.firstName} {student.user?.lastName}
                  </h1>
                  <p className="text-gray-500 text-sm">Student ID: {student.studentId}</p>
                </div>
                <Badge className={student.user?.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                  {student.user?.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {student.user?.email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{student.user.email}</span>
                  </div>
                )}
                {student.user?.phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400" />
                    {student.user.phone}
                  </div>
                )}
                {student.user?.dateOfBirth && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {format(new Date(student.user.dateOfBirth), 'MMM d, yyyy')}
                  </div>
                )}
                {student.qrCode && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <QrCode className="w-4 h-4 text-gray-400" />
                    {student.qrCode}
                  </div>
                )}
              </div>

              {/* Enrolled classes */}
              <div className="flex flex-wrap gap-2 mt-3">
                {student.enrollments?.map((e: any) => (
                  <Link key={e.class?.id} href={`/classes/${e.class?.id}`}>
                    <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-halqa-100">
                      <BookOpen className="w-3 h-3" />
                      {e.class?.name}
                      {e.class?.isDefault && <span className="text-amber-600 ml-0.5">★</span>}
                    </Badge>
                  </Link>
                ))}
                {(!student.enrollments || student.enrollments.length === 0) && (
                  <span className="text-xs text-gray-400 italic">Not enrolled in any class</span>
                )}
              </div>

              {/* ── Class reassignment panel ──────────────────────────────── */}
              {showClassPanel && canEdit && (
                <div className="mt-4 border border-indigo-100 rounded-xl bg-indigo-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-indigo-700 flex items-center gap-1.5">
                      <ArrowRightLeft className="w-4 h-4" /> Manage Class Enrollment
                    </p>
                    <button onClick={() => setShowClassPanel(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Currently enrolled */}
                  {student.enrollments?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Currently enrolled in</p>
                      <div className="flex flex-wrap gap-2">
                        {student.enrollments.map((e: any) => (
                          <div key={e.class?.id} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
                            <BookOpen className="w-3 h-3 text-indigo-500" />
                            <span className="text-sm font-medium text-gray-800">{e.class?.name}</span>
                            {e.class?.isDefault && (
                              <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0 px-1.5 py-0">Default</Badge>
                            )}
                            <button
                              onClick={() => unenrollMutation.mutate(e.class?.id)}
                              disabled={unenrollMutation.isPending}
                              className="text-gray-300 hover:text-red-500 transition-colors ml-0.5"
                              title="Remove from this class"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add to another class */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Add to a class</p>
                    {!classesData ? (
                      <p className="text-xs text-gray-400">Loading classes…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allClasses
                          .filter((c: any) => !student.enrollments?.find((e: any) => e.class?.id === c.id))
                          .map((c: any) => (
                            <button
                              key={c.id}
                              onClick={() => enrollMutation.mutate(c.id)}
                              disabled={enrollMutation.isPending}
                              className="flex items-center gap-1.5 bg-white border border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-lg px-2.5 py-1.5 transition-colors text-sm text-indigo-600"
                            >
                              <BookOpen className="w-3 h-3" />
                              {c.name}
                              {c.isDefault && <span className="text-amber-500 text-[10px]">★</span>}
                            </button>
                          ))
                        }
                        {allClasses.filter((c: any) => !student.enrollments?.find((e: any) => e.class?.id === c.id)).length === 0 && (
                          <p className="text-xs text-gray-400 italic">Enrolled in all available classes</p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Students are auto-enrolled in the default class when they join. Assign to specific classes as needed.
                  </p>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 md:grid-cols-1 gap-3 md:w-40">
              <div className="text-center bg-green-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-green-700">{attendanceStats.percentage || 0}%</p>
                <p className="text-xs text-green-600">Attendance</p>
              </div>
              <div className="text-center bg-blue-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-blue-700">{gradeSummary.gpa || '—'}</p>
                <p className="text-xs text-blue-600">GPA</p>
              </div>
              <div className={`text-center rounded-xl p-3 ${(behaviorStats.totalPoints || 0) >= 0 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                <p className={`text-2xl font-bold ${(behaviorStats.totalPoints || 0) >= 0 ? 'text-yellow-700' : 'text-red-700'}`}>
                  {(behaviorStats.totalPoints || 0) >= 0 ? '+' : ''}{behaviorStats.totalPoints || 0}
                </p>
                <p className={`text-xs ${(behaviorStats.totalPoints || 0) >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>Points</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guardians */}
      {student.guardianLinks?.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" /> Guardians
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {student.guardianLinks.map((link: any) => (
                <div key={link.guardian?.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <Avatar className="w-9 h-9">
                    <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs">
                      {link.guardian?.user?.firstName?.[0]}{link.guardian?.user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{link.guardian?.user?.firstName} {link.guardian?.user?.lastName}</p>
                    <p className="text-xs text-gray-500">{link.guardian?.user?.email}</p>
                    <p className="text-xs text-gray-400 capitalize">{link.guardian?.relationship}</p>
                  </div>
                  {link.isPrimary && <Badge className="text-xs bg-halqa-100 text-halqa-700">Primary</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="attendance">
        <TabsList className="grid grid-cols-4 w-full md:w-auto">
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="behavior">Behavior</TabsTrigger>
          <TabsTrigger value="communicate" className="gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Communicate
          </TabsTrigger>
        </TabsList>

        {/* ── ATTENDANCE TAB ── */}
        <TabsContent value="attendance" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Present', value: attendanceStats.present || 0, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
              { label: 'Absent', value: attendanceStats.absent || 0, icon: XCircle, color: 'text-red-600 bg-red-50' },
              { label: 'Late', value: attendanceStats.late || 0, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
              { label: 'Rate', value: `${attendanceStats.percentage || 0}%`, icon: TrendingUp, color: 'text-blue-600 bg-blue-50' }
            ].map(item => {
              const Icon = item.icon
              return (
                <div key={item.label} className={`${item.color} rounded-xl p-4 text-center`}>
                  <Icon className="w-5 h-5 mx-auto mb-1" />
                  <p className="text-2xl font-bold">{item.value}</p>
                  <p className="text-xs font-medium">{item.label}</p>
                </div>
              )
            })}
          </div>

          {attendancePie.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Attendance Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <NoSSRChart>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={attendancePie} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {attendancePie.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </NoSSRChart>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Recent Records</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {attendance.slice(0, 15).map((rec: any) => (
                  <div key={rec.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      rec.status === 'PRESENT' ? 'bg-green-500' :
                      rec.status === 'ABSENT' ? 'bg-red-500' :
                      rec.status === 'LATE' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`} />
                    <span className="text-sm text-gray-700 flex-1">
                      {format(new Date(rec.date), 'EEE, MMM d yyyy')}
                    </span>
                    <span className="text-xs text-gray-500">{rec.class?.name}</span>
                    <Badge variant="outline" className={`text-xs ${
                      rec.status === 'PRESENT' ? 'border-green-200 text-green-700' :
                      rec.status === 'ABSENT' ? 'border-red-200 text-red-700' :
                      rec.status === 'LATE' ? 'border-yellow-200 text-yellow-700' :
                      'border-blue-200 text-blue-700'
                    }`}>
                      {rec.status}
                    </Badge>
                  </div>
                ))}
                {attendance.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">No attendance records</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── GRADES TAB ── */}
        <TabsContent value="grades" className="space-y-4 mt-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className="text-3xl font-bold text-gray-900">{gradeSummary.average?.toFixed(1) || '—'}%</p>
                <p className="text-xs text-gray-500 mt-1">Average</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className={`text-3xl font-bold ${getGradeBg(gradeSummary.average || 0).split(' ')[1]}`}>
                  {gradeSummary.letterGrade || '—'}
                </p>
                <p className="text-xs text-gray-500 mt-1">Letter Grade</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className="text-3xl font-bold text-halqa-700">{gradeSummary.gpa || '—'}</p>
                <p className="text-xs text-gray-500 mt-1">GPA</p>
              </CardContent>
            </Card>
          </div>

          {/* Progress chart */}
          {grades.length > 1 && (
            <StudentProgressChart studentId={id} compact />
          )}

          {gradeChartData.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Average by Type</CardTitle>
              </CardHeader>
              <CardContent>
                <NoSSRChart>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={gradeChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`${v}%`, 'Average']} />
                      <Bar dataKey="avg" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </NoSSRChart>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">All Grades</CardTitle>
                <Button variant="outline" size="sm" className="gap-1 text-xs">
                  <Download className="w-3 h-3" /> Export
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Title</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Type</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">Class</th>
                      <th className="text-center px-4 py-2.5 font-medium text-gray-600">Score</th>
                      <th className="text-center px-4 py-2.5 font-medium text-gray-600">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {grades.map((g: any) => (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{g.title}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{g.type}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{g.class?.name}</td>
                        <td className="px-4 py-2.5 text-center text-gray-700">{g.score}/{g.maxScore}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getGradeBg(g.percentage || 0)}`}>
                            {g.letterGrade} ({g.percentage?.toFixed(0)}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                    {grades.length === 0 && (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-500">No grades recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BEHAVIOR TAB ── */}
        <TabsContent value="behavior" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className={`text-3xl font-bold ${(behaviorStats.totalPoints || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(behaviorStats.totalPoints || 0) >= 0 ? '+' : ''}{behaviorStats.totalPoints || 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">Total Points</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className="text-3xl font-bold text-green-600">{behaviorStats.positive || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Positive</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm text-center">
              <CardContent className="p-4">
                <p className="text-3xl font-bold text-red-600">{behaviorStats.negative || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Negative</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Behavior History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {behaviorLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      log.type === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {log.type === 'POSITIVE' ? '+' : ''}{log.points}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{log.category}</span>
                        <Badge variant={log.type === 'POSITIVE' ? 'default' : 'destructive'} className="text-xs">
                          {log.type}
                        </Badge>
                      </div>
                      {log.description && <p className="text-xs text-gray-500 mt-0.5">{log.description}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {log.teacher?.user?.firstName} {log.teacher?.user?.lastName} · {format(new Date(log.date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                ))}
                {behaviorLogs.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">No behavior logs</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── COMMUNICATE TAB ── */}
        <TabsContent value="communicate" className="space-y-4 mt-4">
          {/* Quick action cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Message student — goes directly to DM (WhatsApp-style) */}
            <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => router.push(`/dm?userId=${student.user?.id}`)}>
              <CardContent className="p-5 text-center">
                <div className="w-12 h-12 bg-green-50 group-hover:bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3 transition-colors">
                  <MessageSquare className="w-6 h-6 text-green-600" />
                </div>
                <p className="font-semibold text-gray-900">Message Student</p>
                <p className="text-xs text-gray-500 mt-1">Open chat with {student.user?.firstName}</p>
              </CardContent>
            </Card>

            {/* Message guardians */}
            <Card className={`border-0 shadow-sm transition-all ${
              student.guardianLinks?.length > 0
                ? 'hover:shadow-md cursor-pointer group'
                : 'opacity-50 cursor-not-allowed'
            }`}
              onClick={() => {
                if (student.guardianLinks?.length > 0) {
                  setMsgTarget('guardians')
                  setShowMsgModal(true)
                }
              }}>
              <CardContent className="p-5 text-center">
                <div className="w-12 h-12 bg-orange-50 group-hover:bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-3 transition-colors">
                  <Users className="w-6 h-6 text-orange-600" />
                </div>
                <p className="font-semibold text-gray-900">Message Guardians</p>
                <p className="text-xs text-gray-500 mt-1">
                  {student.guardianLinks?.length > 0
                    ? `${student.guardianLinks.length} guardian${student.guardianLinks.length > 1 ? 's' : ''} linked`
                    : 'No guardians linked'}
                </p>
              </CardContent>
            </Card>

            {/* Message all */}
            <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => { setMsgTarget('all'); setShowMsgModal(true) }}>
              <CardContent className="p-5 text-center">
                <div className="w-12 h-12 bg-halqa-50 group-hover:bg-halqa-100 rounded-xl flex items-center justify-center mx-auto mb-3 transition-colors">
                  <Bell className="w-6 h-6 text-halqa-700" />
                </div>
                <p className="font-semibold text-gray-900">Notify Everyone</p>
                <p className="text-xs text-gray-500 mt-1">Message student + all guardians</p>
              </CardContent>
            </Card>
          </div>

          {/* Contact info */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <UserCheck className="w-4 h-4" /> Contact Directory
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Student */}
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
                <Avatar className="w-10 h-10 flex-shrink-0">
                  <AvatarImage src={getAvatarUrl(student.user?.avatarUrl)} />
                  <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold text-sm">
                    {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {student.user?.firstName} {student.user?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{student.user?.email}</p>
                  {student.user?.phone && (
                    <p className="text-xs text-gray-400">{student.user.phone}</p>
                  )}
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Badge className="text-xs bg-blue-100 text-blue-700">Student</Badge>
                  <button
                    onClick={() => { setMsgTarget('student'); setShowMsgModal(true) }}
                    className="p-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
                    title="Send message"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Guardians */}
              {student.guardianLinks?.length > 0 ? (
                student.guardianLinks.map((link: any) => (
                  <div key={link.guardian?.id} className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl">
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      <AvatarFallback className="bg-orange-100 text-orange-700 font-semibold text-sm">
                        {link.guardian?.user?.firstName?.[0]}{link.guardian?.user?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {link.guardian?.user?.firstName} {link.guardian?.user?.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{link.guardian?.user?.email}</p>
                      {link.guardian?.user?.phone && (
                        <p className="text-xs text-gray-400">{link.guardian.user.phone}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Badge className="text-xs bg-orange-100 text-orange-700 capitalize">
                        {link.guardian?.relationship || 'Guardian'}
                        {link.isPrimary && ' · Primary'}
                      </Badge>
                      <button
                        onClick={() => {
                          setMsgTarget('guardians')
                          setShowMsgModal(true)
                        }}
                        className="p-1.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-700 transition-colors"
                        title="Send message"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-400 text-sm">
                  <Users className="w-8 h-8 mx-auto mb-1 text-gray-200" />
                  No guardians linked to this student
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick links */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Quick Links</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Link href={`/dm?userId=${student.user?.id}`}>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-halqa-50 hover:text-halqa-700 transition-colors text-gray-600 cursor-pointer">
                    <MessageSquare className="w-5 h-5" />
                    <span className="text-xs font-medium">All Messages</span>
                  </div>
                </Link>
                <Link href="/announcements">
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-halqa-50 hover:text-halqa-700 transition-colors text-gray-600 cursor-pointer">
                    <Bell className="w-5 h-5" />
                    <span className="text-xs font-medium">Announcements</span>
                  </div>
                </Link>
                <Link href={`/students/${id}/report`}>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-halqa-50 hover:text-halqa-700 transition-colors text-gray-600 cursor-pointer">
                    <Download className="w-5 h-5" />
                    <span className="text-xs font-medium">Report Card</span>
                  </div>
                </Link>
                <Link href={`/students/${id}/attendance`}>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-halqa-50 hover:text-halqa-700 transition-colors text-gray-600 cursor-pointer">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-xs font-medium">Attendance</span>
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── SEND MESSAGE MODAL ── */}
      <Modal
        open={showMsgModal}
        onClose={() => setShowMsgModal(false)}
        title={
          msgTarget === 'guardians' ? 'Message Guardians'
          : `Notify Everyone`
        }
        description={
          msgTarget === 'guardians'
            ? `Send a broadcast message to ${student.guardianLinks?.length || 0} guardian(s)`
            : `Send to student + ${student.guardianLinks?.length || 0} guardian(s)`
        }
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowMsgModal(false)}>Cancel</Button>
            <Button
              onClick={handleSendMessage}
              disabled={!msgBody.trim() || msgSending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {msgSending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                : <><Send className="w-4 h-4" /> Send Message</>
              }
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Recipients preview */}
          <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg">
            {(msgTarget === 'student' || msgTarget === 'all') && (
              <Badge className="gap-1.5 bg-blue-100 text-blue-700 px-2 py-1">
                <Avatar className="w-4 h-4">
                  <AvatarFallback className="text-[8px] bg-blue-200 text-blue-700">
                    {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                {student.user?.firstName} {student.user?.lastName}
              </Badge>
            )}
            {(msgTarget === 'guardians' || msgTarget === 'all') && student.guardianLinks?.map((link: any) => (
              <Badge key={link.guardian?.id} className="gap-1.5 bg-orange-100 text-orange-700 px-2 py-1">
                <Avatar className="w-4 h-4">
                  <AvatarFallback className="text-[8px] bg-orange-200 text-orange-700">
                    {link.guardian?.user?.firstName?.[0]}{link.guardian?.user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                {link.guardian?.user?.firstName} {link.guardian?.user?.lastName}
              </Badge>
            ))}
          </div>

          {/* Subject — optional for broadcast messages to guardians */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject <span className="font-normal lowercase normal-case text-gray-400">(optional)</span></label>
            <input
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 transition-colors"
              placeholder={`Regarding ${student.user?.firstName} ${student.user?.lastName}…`}
              value={msgSubject}
              onChange={e => setMsgSubject(e.target.value)}
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Message *</label>
            <textarea
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 transition-colors resize-none min-h-[120px]"
              placeholder="Write your message here..."
              value={msgBody}
              onChange={e => setMsgBody(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{msgBody.length} chars</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
