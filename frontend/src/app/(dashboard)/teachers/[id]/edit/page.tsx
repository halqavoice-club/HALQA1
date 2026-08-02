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

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  department: z.string().optional(),
  specialization: z.string().optional(),
})
type Form = z.infer<typeof schema>

export default function EditTeacherPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: teacher, isLoading } = useQuery({
    queryKey: ['teacher', id],
    queryFn: () => api.get(`/teachers/${id}`).then(r => r.data.data)
  })

  const { register, reset, formState: { errors }, handleSubmit } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (teacher) {
      reset({
        firstName: teacher.user?.firstName || '',
        lastName: teacher.user?.lastName || '',
        phone: teacher.user?.phone || '',
        department: teacher.department || '',
        specialization: teacher.specialization || ''
      })
    }
  }, [teacher, reset])

  const mutation = useMutation({
    mutationFn: (data: Form) => api.put(`/teachers/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Teacher updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['teacher', id] })
      router.push(`/teachers/${id}`)
    },
    onError: (err: any) => toast({ title: err.response?.data?.message || 'Update failed', variant: 'destructive' })
  })

  if (isLoading) return (
    <div className="space-y-4 max-w-2xl">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/teachers/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Teacher</h1>
          <p className="text-gray-500 text-sm">{teacher?.user?.firstName} {teacher?.user?.lastName}</p>
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
              <Label>Department</Label>
              <Input className="mt-1" placeholder="e.g., Quran Studies" {...register('department')} />
            </div>
            <div className="md:col-span-2">
              <Label>Specialization</Label>
              <Input className="mt-1" placeholder="e.g., Tajweed & Memorization" {...register('specialization')} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
          <Link href={`/teachers/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
