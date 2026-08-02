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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Loader2, BookOpen } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  name: z.string().min(1, 'Class name is required'),
  description: z.string().optional(),
  gradeLevel: z.string().optional(),
  room: z.string().optional(),
  capacity: z.coerce.number().min(1).max(200).default(30),
  termId: z.string().optional(),
})

type Form = z.infer<typeof schema>

export default function NewClassPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: terms, isLoading: loadingTerms } = useQuery({
    queryKey: ['terms'],
    queryFn: () => api.get('/terms').then(r => r.data.data)
  })

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { capacity: 30 }
  })

  const mutation = useMutation({
    mutationFn: (data: Form) => api.post('/classes', data),
    onSuccess: (res) => {
      toast({ title: 'Class created successfully' })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      router.push(`/classes/${res.data.data.id}`)
    },
    onError: (err: any) => {
      toast({ title: err.response?.data?.message || 'Failed to create class', variant: 'destructive' })
    }
  })

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/classes" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Class</h1>
          <p className="text-gray-500 text-sm">Set up a new class or course</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Class Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Class Name *</Label>
              <Input className="mt-1" placeholder="e.g., Quran Level 1, Grade 5A" {...register('name')} />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea className="mt-1" placeholder="Brief description of this class..." {...register('description')} />
            </div>
            <div>
              <Label>Grade Level</Label>
              <Input className="mt-1" placeholder="e.g., Grade 5, Level 2" {...register('gradeLevel')} />
            </div>
            <div>
              <Label>Room</Label>
              <Input className="mt-1" placeholder="e.g., Room A, Hall 3" {...register('room')} />
            </div>
            <div>
              <Label>Capacity</Label>
              <Input type="number" className="mt-1" min={1} max={200} {...register('capacity')} />
            </div>
            <div>
              <Label>Term / Semester</Label>
              <Select onValueChange={v => setValue('termId', v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select term (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {(terms || []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} {t.isCurrent ? '(Current)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              : <><BookOpen className="w-4 h-4" /> Create Class</>
            }
          </Button>
          <Link href="/classes"><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
