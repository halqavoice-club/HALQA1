'use client'

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
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  department: z.string().optional(),
  specialization: z.string().optional(),
  employeeId: z.string().optional(),
  hireDate: z.string().optional(),
})

type Form = z.infer<typeof schema>

export default function NewTeacherPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  const mutation = useMutation({
    mutationFn: (data: Form) => api.post('/teachers', data),
    onSuccess: (res) => {
      toast({ title: 'Teacher created successfully' })
      queryClient.invalidateQueries({ queryKey: ['teachers'] })
      router.push(`/teachers/${res.data.data.id}`)
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.message || 'Failed to create teacher', variant: 'destructive' })
    }
  })

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/teachers" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Teacher</h1>
          <p className="text-gray-500 text-sm">Create a teacher account</p>
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
              <Input className="mt-1" placeholder="Ustaaz" {...register('firstName')} />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName.message}</p>}
            </div>
            <div>
              <Label>Last Name *</Label>
              <Input className="mt-1" placeholder="Ibrahim" {...register('lastName')} />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName.message}</p>}
            </div>
            <div>
              <Label>Email Address *</Label>
              <Input type="email" className="mt-1" placeholder="teacher@school.com" {...register('email')} />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1" placeholder="+1 555 0100" {...register('phone')} />
            </div>
            <div>
              <Label>Employee ID</Label>
              <Input className="mt-1" placeholder="TCH-001" {...register('employeeId')} />
            </div>
            <div>
              <Label>Hire Date</Label>
              <Input type="date" className="mt-1" {...register('hireDate')} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Academic Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Department</Label>
              <Input className="mt-1" placeholder="Quran Studies" {...register('department')} />
            </div>
            <div>
              <Label>Specialization</Label>
              <Input className="mt-1" placeholder="Tajweed & Memorization" {...register('specialization')} />
            </div>
          </CardContent>
        </Card>

        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
          <strong>Default password:</strong> Halqa@2024 — teacher will be prompted to change on first login.
        </div>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              : <><UserPlus className="w-4 h-4" /> Create Teacher</>
            }
          </Button>
          <Link href="/teachers"><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
