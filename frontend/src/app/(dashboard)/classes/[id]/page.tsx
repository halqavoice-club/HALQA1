'use client'

/**
 * Class Detail Page
 *
 * Tabs:
 *   • Students      — enrolled roster + inline add/remove
 *   • Teachers      — assigned teachers + inline add/remove + create new inline
 *   • Grades        — grade table (existing)
 *   • Attendance    — link to attendance module (existing)
 *
 * Admin-only mutations: assign/remove teacher, enroll/unenroll student.
 * Teachers & Students can view but not modify.
 */

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import {
  ArrowLeft, Users, UserCheck, BookOpen, ClipboardCheck,
  Edit, Trash2, Plus, X, Search, UserPlus, Loader2, GraduationCap,
} from 'lucide-react'
import Link from 'next/link'

// ─── Teacher creation schema ──────────────────────────────────────────────────
const newTeacherSchema = z.object({
  firstName:      z.string().min(1, 'Required'),
  lastName:       z.string().min(1, 'Required'),
  email:          z.string().email('Invalid email'),
  phone:          z.string().optional(),
  department:     z.string().optional(),
  employeeId:     z.string().optional(),
})
type NewTeacherForm = z.infer<typeof newTeacherSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { isAdmin } = useEducationRole()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // ─── Class data ───────────────────────────────────────────────────────────
  const { data: cls, isLoading } = useQuery({
    queryKey: ['class', id],
    queryFn: () => api.get(`/classes/${id}`).then(r => r.data.data),
  })

  const { data: gradesData } = useQuery({
    queryKey: ['grades', 'class', id],
    queryFn: () => api.get(`/grades/class/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  // ─── Delete class ─────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/classes/${id}`),
    onSuccess: () => {
      toast({ title: 'Class deleted' })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      router.push('/classes')
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' }),
  })

  // ─── Teacher management state ─────────────────────────────────────────────
  const [teacherSearch, setTeacherSearch] = useState('')
  const [showTeacherPicker, setShowTeacherPicker] = useState(false)
  const [showNewTeacherForm, setShowNewTeacherForm] = useState(false)

  const { data: allTeachersData } = useQuery({
    queryKey: ['teachers-picker', teacherSearch],
    queryFn: () => api.get('/teachers', { params: { search: teacherSearch || undefined, limit: 200 } }).then(r => r.data),
    enabled: showTeacherPicker,
    staleTime: 0,
  })
  const allTeachers: any[] = allTeachersData?.data || []
  // Build from latest cls data so newly-assigned teachers disappear immediately
  const assignedTeacherIds = new Set((cls?.teacherClasses || []).map((tc: any) => tc.teacher?.id).filter(Boolean))
  const availableTeachers = allTeachers.filter(t => !assignedTeacherIds.has(t.id))

  const assignTeacherMutation = useMutation({
    mutationFn: (teacherId: string) =>
      api.post(`/teachers/${teacherId}/classes`, {
        classId: id,
        isLead: (cls?.teacherClasses?.length || 0) === 0,
      }),
    onSuccess: () => {
      toast({ title: 'Teacher assigned' })
      queryClient.invalidateQueries({ queryKey: ['class', id] })
      queryClient.invalidateQueries({ queryKey: ['teachers-picker'] })
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to assign teacher', variant: 'destructive' }),
  })

  const removeTeacherMutation = useMutation({
    mutationFn: (teacherId: string) =>
      api.delete(`/teachers/${teacherId}/classes/${id}`),
    onSuccess: () => {
      toast({ title: 'Teacher removed' })
      queryClient.invalidateQueries({ queryKey: ['class', id] })
      queryClient.invalidateQueries({ queryKey: ['teachers-picker'] })
    },
    onError: () => toast({ title: 'Failed to remove teacher', variant: 'destructive' }),
  })

  const newTeacherForm = useForm<NewTeacherForm>({ resolver: zodResolver(newTeacherSchema) })
  const createTeacherMutation = useMutation({
    mutationFn: (data: NewTeacherForm) => api.post('/teachers', data),
    onSuccess: (res) => {
      const t = res.data.data
      toast({ title: `Teacher ${t.user?.firstName} ${t.user?.lastName} created` })
      queryClient.invalidateQueries({ queryKey: ['teachers'] })
      // Assign the new teacher immediately
      assignTeacherMutation.mutate(t.id)
      setShowNewTeacherForm(false)
      setShowTeacherPicker(false)
      newTeacherForm.reset()
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to create teacher', variant: 'destructive' }),
  })

  // ─── Student management state ─────────────────────────────────────────────
  const [studentSearch, setStudentSearch] = useState('')
  const [showStudentPicker, setShowStudentPicker] = useState(false)

  const { data: allStudentsData } = useQuery({
    queryKey: ['students-picker', studentSearch],
    queryFn: () => api.get('/students', { params: { search: studentSearch || undefined, limit: 200 } }).then(r => r.data),
    enabled: showStudentPicker,
    staleTime: 0, // always fresh when picker opens
  })
  const allStudents: any[] = allStudentsData?.data || []
  // Build the enrolled set from the LATEST class data (re-derives on every cls refetch)
  const enrolledStudentIds = new Set(
    (cls?.enrollments || []).map((e: any) => e.student?.id).filter(Boolean)
  )
  const availableStudents = allStudents.filter(s => !enrolledStudentIds.has(s.id))

  const enrollMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.post(`/students/${studentId}/enroll`, { classId: id }),
    onSuccess: () => {
      toast({ title: 'Student enrolled' })
      // Invalidate BOTH the class detail and the picker query so the enrolled
      // student disappears from the picker immediately after being added.
      queryClient.invalidateQueries({ queryKey: ['class', id] })
      queryClient.invalidateQueries({ queryKey: ['students-picker'] })
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to enroll', variant: 'destructive' }),
  })

  const unenrollMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.delete(`/students/${studentId}/enroll/${id}`),
    onSuccess: () => {
      toast({ title: 'Student removed from class' })
      queryClient.invalidateQueries({ queryKey: ['class', id] })
      queryClient.invalidateQueries({ queryKey: ['students-picker'] })
    },
    onError: () => toast({ title: 'Failed to remove student', variant: 'destructive' }),
  })

  // ─── Loading / not found ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!cls) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Class not found</p>
        <Link href="/classes">
          <Button variant="outline" className="mt-4">Back to Classes</Button>
        </Link>
      </div>
    )
  }

  const students = cls.enrollments?.map((e: any) => e.student).filter(Boolean) || []
  const teachers = cls.teacherClasses || []
  // canEdit: SCHOOL_ADMIN or SUPER_ADMIN via EITHER the legacy User.role OR the new SchoolMembership role.
  // isAdmin already covers both via useEducationRole → useSchoolAccess → activeMembership.role.
  const canEdit = isAdmin

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Classes', href: '/classes' }, { label: cls.name }]} />

      {/* Page header */}
      <div className="flex items-center justify-between">
        <Link href="/classes" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Classes
        </Link>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/classes/${id}/edit`}>
              <Button variant="outline" size="sm" className="gap-2">
                <Edit className="w-4 h-4" /> Edit
              </Button>
            </Link>
            <Button
              variant="outline" size="sm"
              className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          </div>
        )}
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
        {cls.description && <p className="text-gray-500 text-sm mt-1">{cls.description}</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: <Users className="w-5 h-5 text-blue-500" />,   value: students.length,   label: 'Students'  },
          { icon: <UserCheck className="w-5 h-5 text-green-500" />, value: teachers.length, label: 'Teachers'  },
          { icon: <BookOpen className="w-5 h-5 text-purple-500" />, value: cls.capacity || '—', label: 'Capacity' },
          { icon: <ClipboardCheck className="w-5 h-5 text-orange-500" />, value: cls.room || '—', label: 'Room' },
        ].map((stat, i) => (
          <Card key={i} className="border-0 shadow-sm text-center">
            <CardContent className="p-4">
              <div className="flex justify-center mb-1">{stat.icon}</div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-500">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="students">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
          <TabsTrigger value="teachers">Teachers ({teachers.length})</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        {/* ── STUDENTS TAB ───────────────────────────────────────────────── */}
        <TabsContent value="students" className="mt-4 space-y-3">
          {canEdit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-halqa-700 hover:bg-halqa-800 gap-2"
                onClick={() => { setShowStudentPicker(p => !p); setStudentSearch('') }}
              >
                <Plus className="w-4 h-4" />
                {showStudentPicker ? 'Close' : 'Add Students'}
              </Button>
              <Link href={`/students/new?classId=${id}`}>
                <Button size="sm" variant="outline" className="gap-2">
                  <UserPlus className="w-4 h-4" /> Create New Student
                </Button>
              </Link>
            </div>
          )}

          {/* Student picker dropdown */}
          {showStudentPicker && canEdit && (
            <Card className="border-0 shadow-sm border-t-4 border-t-halqa-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-halqa-700">
                  Enroll Students from School Roster
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="Search by name or student ID..."
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {availableStudents.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">
                      {!allStudentsData ? 'Loading...' :
                       studentSearch ? `No students matching "${studentSearch}"` :
                       'All school students are already enrolled in this class'}
                    </p>
                  ) : (
                    availableStudents.map((s) => (
                      <button
                        key={s.id}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-halqa-50 transition-colors text-left"
                        onClick={() => enrollMutation.mutate(s.id)}
                        disabled={enrollMutation.isPending}
                      >
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-bold">
                            {initials(s.user?.firstName, s.user?.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-sm font-medium text-gray-900">
                            {s.user?.firstName} {s.user?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {s.studentId}{s.gradeLevel ? ` · ${s.gradeLevel}` : ''}
                          </p>
                        </div>
                        {s.enrollments?.length > 0 && (
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {s.enrollments.length} class{s.enrollments.length > 1 ? 'es' : ''}
                          </Badge>
                        )}
                        <Plus className="w-4 h-4 text-halqa-500 flex-shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Enrolled roster */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {students.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <GraduationCap className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm font-medium">No students enrolled</p>
                    {canEdit && (
                      <p className="text-xs mt-1">
                        Use "Add Students" above to enroll students from the school roster.
                      </p>
                    )}
                  </div>
                ) : (
                  students.map((student: any, idx: number) => (
                    <div key={student.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      <span className="text-sm text-gray-400 w-6 flex-shrink-0">{idx + 1}</span>
                      <Link href={`/students/${student.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-bold">
                            {initials(student.user?.firstName, student.user?.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {student.user?.firstName} {student.user?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">{student.studentId}</p>
                        </div>
                        <Badge variant="outline" className="text-xs flex-shrink-0">{student.user?.status}</Badge>
                      </Link>
                      {canEdit && (
                        <button
                          onClick={() => unenrollMutation.mutate(student.id)}
                          disabled={unenrollMutation.isPending}
                          className="ml-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                          title="Remove from class"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TEACHERS TAB ───────────────────────────────────────────────── */}
        <TabsContent value="teachers" className="mt-4 space-y-3">
          {canEdit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-halqa-700 hover:bg-halqa-800 gap-2"
                onClick={() => {
                  setShowTeacherPicker(p => !p)
                  setShowNewTeacherForm(false)
                  setTeacherSearch('')
                }}
              >
                <Plus className="w-4 h-4" />
                {showTeacherPicker ? 'Close' : 'Assign Teacher'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setShowNewTeacherForm(p => !p)
                  setShowTeacherPicker(false)
                  newTeacherForm.reset()
                }}
              >
                <UserPlus className="w-4 h-4" />
                {showNewTeacherForm ? 'Cancel' : 'Create New Teacher'}
              </Button>
            </div>
          )}

          {/* Existing teacher picker */}
          {showTeacherPicker && canEdit && (
            <Card className="border-0 shadow-sm border-t-4 border-t-green-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-green-700">
                  Assign Existing Teacher
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="Search by name or department..."
                    value={teacherSearch}
                    onChange={e => setTeacherSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {availableTeachers.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">
                      {!allTeachersData ? 'Loading...' :
                       teacherSearch ? `No teachers matching "${teacherSearch}"` :
                       'All school teachers are already assigned to this class'}
                    </p>
                  ) : (
                    availableTeachers.map((t) => (
                      <button
                        key={t.id}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-green-50 transition-colors text-left"
                        onClick={() => {
                          assignTeacherMutation.mutate(t.id)
                          setShowTeacherPicker(false)
                        }}
                        disabled={assignTeacherMutation.isPending}
                      >
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className="bg-green-100 text-green-700 text-xs font-bold">
                            {initials(t.user?.firstName, t.user?.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {t.user?.firstName} {t.user?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">{t.department || t.user?.email}</p>
                        </div>
                        {t.teacherClasses?.length > 0 && (
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            {t.teacherClasses.length} class{t.teacherClasses.length > 1 ? 'es' : ''}
                          </Badge>
                        )}
                        <Plus className="w-4 h-4 text-green-600 flex-shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inline new teacher creation */}
          {showNewTeacherForm && canEdit && (
            <Card className="border-0 shadow-sm border-l-4 border-l-halqa-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-halqa-700" /> Create New Teacher
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={newTeacherForm.handleSubmit(d => createTeacherMutation.mutate(d))}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">First Name *</Label>
                      <Input className="mt-1 h-9" placeholder="Ustaaz" {...newTeacherForm.register('firstName')} />
                      {newTeacherForm.formState.errors.firstName && (
                        <p className="text-xs text-red-500 mt-0.5">{newTeacherForm.formState.errors.firstName.message}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Last Name *</Label>
                      <Input className="mt-1 h-9" placeholder="Ibrahim" {...newTeacherForm.register('lastName')} />
                      {newTeacherForm.formState.errors.lastName && (
                        <p className="text-xs text-red-500 mt-0.5">{newTeacherForm.formState.errors.lastName.message}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Email Address *</Label>
                      <Input type="email" className="mt-1 h-9" placeholder="teacher@school.com" {...newTeacherForm.register('email')} />
                      {newTeacherForm.formState.errors.email && (
                        <p className="text-xs text-red-500 mt-0.5">{newTeacherForm.formState.errors.email.message}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input className="mt-1 h-9" placeholder="+1 555 0100" {...newTeacherForm.register('phone')} />
                    </div>
                    <div>
                      <Label className="text-xs">Department</Label>
                      <Input className="mt-1 h-9" placeholder="Quran Studies" {...newTeacherForm.register('department')} />
                    </div>
                    <div>
                      <Label className="text-xs">Employee ID</Label>
                      <Input className="mt-1 h-9" placeholder="TCH-001" {...newTeacherForm.register('employeeId')} />
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
                    Default password: <strong>Halqa@2024</strong> — teacher prompted to change on first login.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      className="bg-halqa-700 hover:bg-halqa-800 gap-2"
                      disabled={createTeacherMutation.isPending}
                    >
                      {createTeacherMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                        : <><UserPlus className="w-4 h-4" /> Create & Assign</>
                      }
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setShowNewTeacherForm(false); newTeacherForm.reset() }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Assigned teachers roster */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {teachers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <UserCheck className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm font-medium">No teachers assigned</p>
                  {canEdit && (
                    <p className="text-xs mt-1">
                      Use "Assign Teacher" or "Create New Teacher" above.
                    </p>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {teachers.map((tc: any) => (
                    <div key={tc.teacher?.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      <Link href={`/teachers/${tc.teacher?.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                        <Avatar className="w-10 h-10 flex-shrink-0">
                          <AvatarFallback className="bg-green-100 text-green-700 text-sm font-bold">
                            {initials(tc.teacher?.user?.firstName, tc.teacher?.user?.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900">
                              {tc.teacher?.user?.firstName} {tc.teacher?.user?.lastName}
                            </p>
                            {tc.isLead && (
                              <Badge className="text-xs bg-halqa-100 text-halqa-700 border-0">Lead</Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {tc.subject || tc.teacher?.department || tc.teacher?.user?.email}
                          </p>
                        </div>
                      </Link>
                      {canEdit && (
                        <button
                          onClick={() => removeTeacherMutation.mutate(tc.teacher?.id)}
                          disabled={removeTeacherMutation.isPending}
                          className="ml-2 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                          title="Remove teacher from class"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── GRADES TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="grades" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(gradesData || []).map((g: any) => (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium">
                          {g.student?.user?.firstName} {g.student?.user?.lastName}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700">{g.title}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{g.type}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center">{g.score}/{g.maxScore}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            (g.percentage || 0) >= 90 ? 'bg-green-100 text-green-700' :
                            (g.percentage || 0) >= 70 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {g.letterGrade}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(!gradesData || gradesData.length === 0) && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">No grades yet</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ATTENDANCE TAB ─────────────────────────────────────────────── */}
        <TabsContent value="attendance" className="mt-4">
          <div className="flex gap-3 mb-4">
            <Link href={`/attendance?classId=${id}`}>
              <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                <ClipboardCheck className="w-4 h-4" /> Mark Attendance
              </Button>
            </Link>
          </div>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 text-center text-gray-500">
              <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>View and record attendance in the Attendance module</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Class"
        message="Are you sure you want to delete this class? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
