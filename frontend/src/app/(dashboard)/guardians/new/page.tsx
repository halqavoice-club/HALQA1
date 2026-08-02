'use client'

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
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Loader2, UserPlus, X } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  relationship: z.string().default('parent'),
})

type Form = z.infer<typeof schema>

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other']

export default function NewGuardianPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedStudents, setSelectedStudents] = useState<any[]>([])
  const [studentSearch, setStudentSearch] = useState('')

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { relationship: 'parent' }
  })

  const { data: studentsData, isLoading: loadingStudents } = useQuery({
    queryKey: ['students', studentSearch],
    queryFn: () => api.get('/students', { params: { search: studentSearch, limit: 10 } }).then(r => r.data.data),
    enabled: studentSearch.length >= 2
  })

  const mutation = useMutation({
    mutationFn: (data: Form) => api.post('/guardians', {
      ...data,
      studentIds: selectedStudents.map(s => s.id)
    }),
    onSuccess: (res) => {
      toast({ title: 'Guardian created successfully' })
      queryClient.invalidateQueries({ queryKey: ['guardians'] })
      router.push('/guardians')
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.message || 'Failed to create guardian', variant: 'destructive' })
    }
  })

  const addStudent = (student: any) => {
    if (!selectedStudents.find(s => s.id === student.id)) {
      setSelectedStudents(prev => [...prev, student])
    }
    setStudentSearch('')
  }

  const removeStudent = (id: string) => {
    setSelectedStudents(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/guardians" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Add New Guardian</h1>
          <p className="text-gray-500 text-sm">Create a parent or guardian account</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        {/* Personal info */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>First Name *</Label>
              <Input className="mt-1" placeholder="Hassan" {...register('firstName')} />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName.message}</p>}
            </div>
            <div>
              <Label>Last Name *</Label>
              <Input className="mt-1" placeholder="Abdullah" {...register('lastName')} />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName.message}</p>}
            </div>
            <div>
              <Label>Email Address *</Label>
              <Input type="email" className="mt-1" placeholder="parent@email.com" {...register('email')} />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1" placeholder="+1 555 0100" {...register('phone')} />
            </div>
            <div>
              <Label>Relationship</Label>
              <Select defaultValue="parent" onValueChange={v => setValue('relationship', v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map(r => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Link students */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Link Students (Optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Input
                placeholder="Search students by name or ID..."
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
              />
              {studentsData && studentsData.length > 0 && studentSearch.length >= 2 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg shadow-lg border z-10 max-h-48 overflow-y-auto">
                  {studentsData.map((s: any) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addStudent(s)}
                      className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm flex items-center gap-2"
                    >
                      <div className="w-7 h-7 bg-halqa-100 rounded-full flex items-center justify-center text-xs font-bold text-halqa-700 flex-shrink-0">
                        {s.user?.firstName?.[0]}{s.user?.lastName?.[0]}
                      </div>
                      <div>
                        <p className="font-medium">{s.user?.firstName} {s.user?.lastName}</p>
                        <p className="text-xs text-gray-400">{s.studentId}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedStudents.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedStudents.map((s, i) => (
                  <Badge key={s.id} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
                    {i === 0 && <span className="text-xs text-halqa-600 mr-1">Primary</span>}
                    {s.user?.firstName} {s.user?.lastName}
                    <button
                      type="button"
                      onClick={() => removeStudent(s.id)}
                      className="ml-1 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">
              The first student linked will be marked as primary.
            </p>
          </CardContent>
        </Card>

        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
          <strong>Default password:</strong> Halqa@2024 — guardian will be prompted to change on first login.
        </div>

        <div className="flex gap-3">
          <Button
            type="submit"
            className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              : <><UserPlus className="w-4 h-4" /> Create Guardian</>
            }
          </Button>
          <Link href="/guardians">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
