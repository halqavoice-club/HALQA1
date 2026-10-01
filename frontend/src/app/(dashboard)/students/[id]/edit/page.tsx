'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'

/**
 * Student Edit Page
 *
 * A School Admin may only edit school-specific student fields:
 *   - Student ID (school-assigned identifier)
 *   - Grade Level / Level
 *
 * All personal information (name, email, phone, date of birth, gender)
 * belongs to the student and can only be changed by the student
 * via their own profile settings.
 */

const schema = z.object({
  studentId:  z.string().min(1, 'Required'),
  gradeLevel: z.string().optional(),
})
type Form = z.infer<typeof schema>

export default function EditStudentPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: student, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get(`/students/${id}`).then(r => r.data.data)
  })

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (student) {
      reset({
        studentId:  student.studentId || '',
        gradeLevel: student.gradeLevel || '',
      })
    }
  }, [student, reset])

  const mutation = useMutation({
    mutationFn: (data: Form) => api.put(`/students/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Student updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      router.push(`/students/${id}`)
    },
    onError: (err: any) => toast({ title: err.response?.data?.message || 'Update failed', variant: 'destructive' })
  })

  useUnsavedChanges(isDirty && !mutation.isSuccess)

  if (isLoading) return (
    <div className="space-y-4 max-w-md">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/students/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Student</h1>
          <p className="text-gray-500 text-sm">
            {student?.user?.firstName} {student?.user?.lastName} · {student?.studentId}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">School Details</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">
              Only school-specific fields can be edited here. Personal information is managed by the student.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Student ID *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. STU-001"
                {...register('studentId')}
              />
              {errors.studentId && (
                <p className="text-xs text-red-500 mt-1">{errors.studentId.message}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                School-assigned ID used for attendance and records
              </p>
            </div>

            <div>
              <Label>Grade Level / Level</Label>
              <Input
                className="mt-1"
                placeholder="e.g., Grade 5, Beginner, Level 2"
                {...register('gradeLevel')}
              />
              <p className="text-xs text-gray-400 mt-1">
                Academic level or grade in your school system
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="submit"
            className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> Save Changes</>
            }
          </Button>
          <Link href={`/students/${id}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
