'use client'

/**
 * New Class Wizard — 3 steps
 *
 * Step 1: Create the class (name, room, capacity, term)
 * Step 2: Assign teacher(s) — pick from existing OR create new inline
 * Step 3: Arrange students — enroll students from the school roster
 *
 * Each step calls the respective API so partial progress is never lost.
 * Admin can skip steps 2 & 3 and come back later via the class detail page.
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, ArrowRight, Loader2, BookOpen, UserCheck,
  UserPlus, Users, Check, X, Plus, Search, GraduationCap,
} from 'lucide-react'
import Link from 'next/link'

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const classSchema = z.object({
  name:        z.string().min(1, 'Class name is required'),
  description: z.string().optional(),
  gradeLevel:  z.string().optional(),
  room:        z.string().optional(),
  capacity:    z.coerce.number().min(1).max(200).default(30),
  termId:      z.string().optional(),
})

const newTeacherSchema = z.object({
  firstName:      z.string().min(1, 'Required'),
  lastName:       z.string().min(1, 'Required'),
  email:          z.string().email('Invalid email'),
  phone:          z.string().optional(),
  department:     z.string().optional(),
  specialization: z.string().optional(),
  employeeId:     z.string().optional(),
})

type ClassForm    = z.input<typeof classSchema>
type NewTeacherForm = z.infer<typeof newTeacherSchema>

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { n: 1, label: 'Class Details' },
    { n: 2, label: 'Assign Teacher' },
    { n: 3, label: 'Add Students' },
  ]
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1 last:flex-none">
          <div className={`flex items-center gap-2 ${current >= s.n ? 'text-halqa-700' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
              current > s.n
                ? 'bg-halqa-700 border-halqa-700 text-white'
                : current === s.n
                ? 'border-halqa-700 text-halqa-700 bg-halqa-50'
                : 'border-gray-300 text-gray-400 bg-white'
            }`}>
              {current > s.n ? <Check className="w-4 h-4" /> : s.n}
            </div>
            <span className="text-sm font-medium hidden sm:block">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 transition-colors ${current > s.n ? 'bg-halqa-700' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewClassPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [step, setStep] = useState(1)
  const [createdClassId, setCreatedClassId] = useState<string | null>(null)
  const [createdClassName, setCreatedClassName] = useState('')

  // ─── Step 1: class form ───────────────────────────────────────────────────
  const { data: terms } = useQuery({
    queryKey: ['terms'],
    queryFn: () => api.get('/terms').then(r => r.data.data),
  })

  const classForm = useForm<ClassForm>({
    resolver: zodResolver(classSchema),
    defaultValues: { capacity: 30 },
  })

  const createClassMutation = useMutation({
    mutationFn: (data: ClassForm) => api.post('/classes', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      const cls = res.data.data
      setCreatedClassId(cls.id)
      setCreatedClassName(cls.name)
      toast({ title: `Class "${cls.name}" created` })
      setStep(2)
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to create class', variant: 'destructive' }),
  })

  // ─── Step 2: teacher assignment ────────────────────────────────────────────
  const [teacherSearch, setTeacherSearch] = useState('')
  const [assignedTeachers, setAssignedTeachers] = useState<any[]>([])
  const [showNewTeacherForm, setShowNewTeacherForm] = useState(false)

  const { data: teachersData } = useQuery({
    queryKey: ['teachers-wizard', teacherSearch],
    queryFn: () => api.get('/teachers', { params: { search: teacherSearch || undefined, limit: 200 } }).then(r => r.data),
    enabled: step === 2,
    staleTime: 0,
  })
  const allTeachers: any[] = teachersData?.data || []
  // Exclude already-assigned teachers from the picker
  const availableTeachers = allTeachers.filter(
    t => !assignedTeachers.some(a => a.id === t.id)
  )

  const newTeacherForm = useForm<NewTeacherForm>({
    resolver: zodResolver(newTeacherSchema),
  })

  const createTeacherMutation = useMutation({
    mutationFn: (data: NewTeacherForm) => api.post('/teachers', data),
    onSuccess: (res) => {
      const t = res.data.data
      toast({ title: `Teacher ${t.user?.firstName} ${t.user?.lastName} created` })
      queryClient.invalidateQueries({ queryKey: ['teachers'] })
      // Immediately assign the newly created teacher
      handleAssignTeacher(t)
      setShowNewTeacherForm(false)
      newTeacherForm.reset()
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to create teacher', variant: 'destructive' }),
  })

  const assignTeacherMutation = useMutation({
    mutationFn: ({ teacherId, isLead }: { teacherId: string; isLead: boolean }) =>
      api.post(`/teachers/${teacherId}/classes`, { classId: createdClassId, isLead }),
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to assign teacher', variant: 'destructive' }),
  })

  const removeTeacherMutation = useMutation({
    mutationFn: (teacherId: string) =>
      api.delete(`/teachers/${teacherId}/classes/${createdClassId}`),
    onError: () =>
      toast({ title: 'Failed to remove teacher', variant: 'destructive' }),
  })

  const handleAssignTeacher = (teacher: any) => {
    const isLead = assignedTeachers.length === 0 // first teacher = lead
    setAssignedTeachers(prev => [...prev, { ...teacher, isLead }])
    assignTeacherMutation.mutate({ teacherId: teacher.id, isLead })
  }

  const handleRemoveTeacher = (teacher: any) => {
    setAssignedTeachers(prev => prev.filter(t => t.id !== teacher.id))
    removeTeacherMutation.mutate(teacher.id)
  }

  // ─── Step 3: student enrollment ────────────────────────────────────────────
  const [studentSearch, setStudentSearch] = useState('')
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([])

  const { data: studentsData } = useQuery({
    queryKey: ['students-wizard', studentSearch, createdClassId],
    queryFn: () => api.get('/students', {
      params: {
        search: studentSearch || undefined,
        limit: 200,
        // Exclude students already enrolled in this class.
        // Backend filters: enrollments.some({ classId, isActive: true }) is NOT in the filter,
        // so we do client-side exclusion using the enrolled list we've built.
      }
    }).then(r => r.data),
    enabled: step === 3,
    staleTime: 0,
  })
  const allStudents: any[] = studentsData?.data || []
  // Exclude students the user has already enrolled in this wizard session
  const enrolledInWizard = new Set(enrolledStudents.map(s => s.id))
  const availableStudents = allStudents.filter(s => !enrolledInWizard.has(s.id))

  const enrollMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.post(`/students/${studentId}/enroll`, { classId: createdClassId }),
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Failed to enroll student', variant: 'destructive' }),
  })

  const unenrollMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.delete(`/students/${studentId}/enroll/${createdClassId}`),
    onError: () =>
      toast({ title: 'Failed to remove student', variant: 'destructive' }),
  })

  const handleEnrollStudent = (student: any) => {
    setEnrolledStudents(prev => [...prev, student])
    enrollMutation.mutate(student.id)
  }

  const handleUnenrollStudent = (student: any) => {
    setEnrolledStudents(prev => prev.filter(s => s.id !== student.id))
    unenrollMutation.mutate(student.id)
  }

  const handleFinish = () => {
    queryClient.invalidateQueries({ queryKey: ['class', createdClassId] })
    toast({ title: `Class "${createdClassName}" is ready!`, description: `${assignedTeachers.length} teacher(s) · ${enrolledStudents.length} student(s) enrolled` })
    router.push(`/classes/${createdClassId}`)
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/classes" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Class</h1>
          <p className="text-gray-500 text-sm">Set up the class, assign a teacher, then add students</p>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* ─── STEP 1: Class Details ─────────────────────────────────────────── */}
      {step === 1 && (
        <form onSubmit={classForm.handleSubmit(d => createClassMutation.mutate(d))} className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-halqa-700" /> Class Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Class Name *</Label>
                <Input className="mt-1" placeholder="e.g., Quran Level 1, Grade 5A" {...classForm.register('name')} />
                {classForm.formState.errors.name && (
                  <p className="text-xs text-red-500 mt-1">{classForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Textarea className="mt-1" placeholder="Brief description of this class..." {...classForm.register('description')} />
              </div>
              <div>
                <Label>Grade Level</Label>
                <Input className="mt-1" placeholder="e.g., Grade 5, Level 2" {...classForm.register('gradeLevel')} />
              </div>
              <div>
                <Label>Room</Label>
                <Input className="mt-1" placeholder="e.g., Room A, Hall 3" {...classForm.register('room')} />
              </div>
              <div>
                <Label>Capacity</Label>
                <Input type="number" className="mt-1" min={1} max={200} {...classForm.register('capacity')} />
              </div>
              <div>
                <Label>Term / Semester</Label>
                <Select onValueChange={v => classForm.setValue('termId', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select term (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(terms || []).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}{t.isCurrent ? ' (Current)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={createClassMutation.isPending}>
              {createClassMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                : <>Next: Assign Teacher <ArrowRight className="w-4 h-4" /></>
              }
            </Button>
            <Link href="/classes"><Button type="button" variant="outline">Cancel</Button></Link>
          </div>
        </form>
      )}

      {/* ─── STEP 2: Assign Teacher ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Assigned teachers */}
          {assignedTeachers.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-green-600" />
                  Assigned Teachers ({assignedTeachers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {assignedTeachers.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-green-100 text-green-700 text-xs font-bold">
                        {t.user?.firstName?.[0]}{t.user?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {t.user?.firstName} {t.user?.lastName}
                      </p>
                      {t.user?.email && <p className="text-xs text-gray-500">{t.user.email}</p>}
                    </div>
                    {t.isLead && (
                      <Badge className="text-xs bg-halqa-100 text-halqa-700 border-0">Lead</Badge>
                    )}
                    <button
                      onClick={() => handleRemoveTeacher(t)}
                      className="ml-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="Remove teacher"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Existing teacher picker */}
          {!showNewTeacherForm && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Search className="w-4 h-4 text-halqa-700" /> Pick Existing Teacher
                  </CardTitle>
                  <Button
                    variant="outline" size="sm"
                    className="gap-2 text-halqa-700 border-halqa-300 hover:bg-halqa-50"
                    onClick={() => setShowNewTeacherForm(true)}
                  >
                    <Plus className="w-4 h-4" /> Create New Teacher
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search by name or department..."
                    value={teacherSearch}
                    onChange={e => setTeacherSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {availableTeachers.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">
                      {teacherSearch ? `No teachers matching "${teacherSearch}"` : 'No unassigned teachers found'}
                    </p>
                  ) : (
                    availableTeachers.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-halqa-50 cursor-pointer transition-colors"
                        onClick={() => handleAssignTeacher(t)}
                      >
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className="bg-green-100 text-green-700 text-xs font-bold">
                            {t.user?.firstName?.[0]}{t.user?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {t.user?.firstName} {t.user?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">{t.department || t.user?.email}</p>
                        </div>
                        {t.teacherClasses?.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {t.teacherClasses.length} class{t.teacherClasses.length > 1 ? 'es' : ''}
                          </Badge>
                        )}
                        <Plus className="w-4 h-4 text-halqa-500 flex-shrink-0" />
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inline new teacher form */}
          {showNewTeacherForm && (
            <Card className="border-0 shadow-sm border-l-4 border-l-halqa-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-halqa-700" /> Create New Teacher
                  </CardTitle>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { setShowNewTeacherForm(false); newTeacherForm.reset() }}
                  >
                    <X className="w-4 h-4" /> Cancel
                  </Button>
                </div>
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
                        <p className="text-xs text-red-500 mt-1">{newTeacherForm.formState.errors.firstName.message}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Last Name *</Label>
                      <Input className="mt-1 h-9" placeholder="Ibrahim" {...newTeacherForm.register('lastName')} />
                      {newTeacherForm.formState.errors.lastName && (
                        <p className="text-xs text-red-500 mt-1">{newTeacherForm.formState.errors.lastName.message}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Email Address *</Label>
                      <Input type="email" className="mt-1 h-9" placeholder="teacher@school.com" {...newTeacherForm.register('email')} />
                      {newTeacherForm.formState.errors.email && (
                        <p className="text-xs text-red-500 mt-1">{newTeacherForm.formState.errors.email.message}</p>
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
                    Default password: <strong>Halqa@2024</strong> — teacher will be prompted to change on first login.
                  </div>
                  <Button
                    type="submit"
                    className="bg-halqa-700 hover:bg-halqa-800 gap-2 w-full"
                    disabled={createTeacherMutation.isPending}
                  >
                    {createTeacherMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating & Assigning...</>
                      : <><UserPlus className="w-4 h-4" /> Create & Assign to Class</>
                    }
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            <Button
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
              onClick={() => setStep(3)}
            >
              Next: Add Students <ArrowRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={() => setStep(3)}>
              Skip
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Arrange Students ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Enrolled list */}
          {enrolledStudents.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Enrolled Students ({enrolledStudents.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
                  {enrolledStudents.map((s, idx) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-xs text-gray-400 w-5">{idx + 1}</span>
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-bold">
                          {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {s.user?.firstName} {s.user?.lastName}
                        </p>
                        <p className="text-xs text-gray-500">{s.studentId}</p>
                      </div>
                      <button
                        onClick={() => handleUnenrollStudent(s)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove from class"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Student picker */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-halqa-700" /> Add Students from Roster
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by name or student ID..."
                  value={studentSearch}
                  onChange={e => setStudentSearch(e.target.value)}
                />
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">
                {availableStudents.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">
                    {studentSearch
                      ? `No students matching "${studentSearch}"`
                      : enrolledStudents.length > 0
                      ? 'All available students have been enrolled'
                      : 'No students in the school yet'
                    }
                  </p>
                ) : (
                  availableStudents.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-halqa-50 cursor-pointer transition-colors"
                      onClick={() => handleEnrollStudent(s)}
                    >
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-bold">
                          {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {s.user?.firstName} {s.user?.lastName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {s.studentId}
                          {s.gradeLevel ? ` · ${s.gradeLevel}` : ''}
                        </p>
                      </div>
                      {s.enrollments?.length > 0 && (
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {s.enrollments.length} class{s.enrollments.length > 1 ? 'es' : ''}
                        </Badge>
                      )}
                      <Plus className="w-4 h-4 text-halqa-500 flex-shrink-0" />
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* New student shortcut */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Student not in the list?</span>
            <Link
              href={`/students/new?classId=${createdClassId}`}
              className="text-halqa-700 font-medium hover:underline"
            >
              Create new student →
            </Link>
          </div>

          <div className="flex gap-3">
            <Button
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
              onClick={handleFinish}
            >
              <Check className="w-4 h-4" /> Finish — View Class
            </Button>
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
