'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Loader2, UserPlus, BookOpen } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  firstName:   z.string().min(1, 'Required'),
  lastName:    z.string().min(1, 'Required'),
  email:       z.string().email('Invalid email'),
  studentId:   z.string().min(1, 'Required'),
  phone:       z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender:      z.string().optional(),
  gradeLevel:  z.string().optional(),
  classId:     z.string().optional(),
  guardianId:  z.string().optional(),
})

type Form = z.infer<typeof schema>

// Inner component that reads search params
function NewStudentForm() {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  // If coming from the class wizard (/students/new?classId=xxx), pre-select that class
  const preselectedClassId = searchParams.get('classId') ?? undefined

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data),
  })

  const { data: guardians } = useQuery({
    queryKey: ['guardians'],
    queryFn: () => api.get('/guardians').then(r => r.data.data),
  })

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { classId: preselectedClassId },
  })

  // Set classId as soon as classes load (handles the case where classes load after form mounts)
  useEffect(() => {
    if (preselectedClassId) {
      setValue('classId', preselectedClassId)
    }
  }, [preselectedClassId, setValue])

  const selectedClassId = watch('classId')
  const selectedClass   = classes?.find((c: any) => c.id === selectedClassId)

  const mutation = useMutation({
    mutationFn: (data: Form) => api.post('/students', data),
    onSuccess: (res) => {
      toast({ title: 'Student created successfully' })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      // If came from class wizard/detail, go back to that class
      if (preselectedClassId) {
        queryClient.invalidateQueries({ queryKey: ['class', preselectedClassId] })
        router.push(`/classes/${preselectedClassId}`)
      } else {
        router.push(`/students/${res.data.data.id}`)
      }
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.message || 'Failed to create student', variant: 'destructive' })
    },
  })

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={preselectedClassId ? `/classes/${preselectedClassId}` : '/students'}
          className="text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Student</h1>
          <p className="text-gray-500 text-sm">
            {preselectedClassId && selectedClass
              ? `Creating student and enrolling in "${selectedClass.name}"`
              : 'Create a student account and optionally enroll in a class'}
          </p>
        </div>
      </div>

      {/* Context banner when coming from class wizard */}
      {preselectedClassId && selectedClass && (
        <div className="flex items-center gap-3 bg-halqa-50 border border-halqa-200 rounded-lg px-4 py-3">
          <BookOpen className="w-5 h-5 text-halqa-700 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-halqa-800">
              This student will be enrolled in <strong>{selectedClass.name}</strong>
            </p>
            <p className="text-xs text-halqa-600">
              After saving you'll be returned to the class page.
            </p>
          </div>
          <Badge className="ml-auto bg-halqa-100 text-halqa-700 border-0">
            {selectedClass.room || selectedClass.gradeLevel || 'Class'}
          </Badge>
        </div>
      )}

      <form onSubmit={handleSubmit(d => mutation.mutate(d))}>
        <div className="space-y-4">
          {/* Personal info */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input className="mt-1" placeholder="Ahmad" {...register('firstName')} />
                {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName.message}</p>}
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input className="mt-1" placeholder="Hassan" {...register('lastName')} />
                {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName.message}</p>}
              </div>
              <div>
                <Label>Email Address *</Label>
                <Input type="email" className="mt-1" placeholder="student@school.com" {...register('email')} />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label>Student ID *</Label>
                <Input className="mt-1" placeholder="STU-001" {...register('studentId')} />
                {errors.studentId && <p className="text-xs text-red-500 mt-1">{errors.studentId.message}</p>}
              </div>
              <div>
                <Label>Phone</Label>
                <Input className="mt-1" placeholder="+1 555 0100" {...register('phone')} />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input type="date" className="mt-1" {...register('dateOfBirth')} />
              </div>
              <div>
                <Label>Grade Level / Level</Label>
                <Input className="mt-1" placeholder="e.g., Grade 5, Beginner, Level 2" {...register('gradeLevel')} />
              </div>
              <div>
                <Label>Gender</Label>
                <Select onValueChange={v => setValue('gender', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Enrollment */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Enrollment & Guardian</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Enroll in Class</Label>
                <Select
                  value={selectedClassId || ''}
                  onValueChange={v => setValue('classId', v || undefined)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select class (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(classes || []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.room ? ` · ${c.room}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedClass && (
                  <p className="text-xs text-halqa-600 mt-1 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    {selectedClass._count?.enrollments || 0} students currently enrolled
                  </p>
                )}
              </div>
              <div>
                <Label>Link Guardian</Label>
                <Select onValueChange={v => setValue('guardianId', v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select guardian (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(guardians || []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.user?.firstName} {g.user?.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
            A temporary password will be generated. The student will be prompted to change it on first login.
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                : <><UserPlus className="w-4 h-4" /> Create Student</>
              }
            </Button>
            <Link href={preselectedClassId ? `/classes/${preselectedClassId}` : '/students'}>
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}

// Wrap in Suspense because useSearchParams() requires it in Next.js 14
export default function NewStudentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading...</div>}>
      <NewStudentForm />
    </Suspense>
  )
}
