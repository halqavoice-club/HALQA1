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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  gradeLevel: z.string().optional(),
  medicalNotes: z.string().optional(),
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

  const { register, handleSubmit, setValue, reset, formState: { errors, isDirty } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (student) {
      reset({
        firstName: student.user?.firstName || '',
        lastName: student.user?.lastName || '',
        phone: student.user?.phone || '',
        dateOfBirth: student.user?.dateOfBirth ? student.user.dateOfBirth.split('T')[0] : '',
        gender: student.user?.gender || '',
        gradeLevel: student.gradeLevel || '',
        medicalNotes: student.medicalNotes || ''
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
    <div className="space-y-4 max-w-2xl">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
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
            <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>First Name *</Label>
              <Input className="mt-1" {...register('firstName')} />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName.message}</p>}
            </div>
            <div>
              <Label>Last Name *</Label>
              <Input className="mt-1" {...register('lastName')} />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName.message}</p>}
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1" {...register('phone')} />
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
              <Select onValueChange={v => setValue('gender', v)} defaultValue={student?.user?.gender || ''}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Medical & Emergency</CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Medical Notes</Label>
            <Textarea className="mt-1" placeholder="Any medical conditions, allergies, or special needs..." {...register('medicalNotes')} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
          <Link href={`/students/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
