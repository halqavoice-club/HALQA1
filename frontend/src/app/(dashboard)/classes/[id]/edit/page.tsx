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
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import Link from 'next/link'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  gradeLevel: z.string().optional(),
  room: z.string().optional(),
  capacity: z.coerce.number().min(1).max(200).default(30),
})
type Form = z.infer<typeof schema>

export default function EditClassPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: cls, isLoading } = useQuery({
    queryKey: ['class', id],
    queryFn: () => api.get(`/classes/${id}`).then(r => r.data.data)
  })

  const { register, reset, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (cls) {
      reset({
        name: cls.name || '',
        description: cls.description || '',
        gradeLevel: cls.gradeLevel || '',
        room: cls.room || '',
        capacity: cls.capacity || 30
      })
    }
  }, [cls, reset])

  const mutation = useMutation({
    mutationFn: (data: Form) => api.put(`/classes/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Class updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['class', id] })
      router.push(`/classes/${id}`)
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
        <Link href={`/classes/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Class</h1>
          <p className="text-gray-500 text-sm">{cls?.name}</p>
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
              <Input className="mt-1" {...register('name')} />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea className="mt-1" {...register('description')} />
            </div>
            <div>
              <Label>Grade Level</Label>
              <Input className="mt-1" placeholder="e.g., Grade 5" {...register('gradeLevel')} />
            </div>
            <div>
              <Label>Room</Label>
              <Input className="mt-1" placeholder="e.g., Room A" {...register('room')} />
            </div>
            <div>
              <Label>Capacity</Label>
              <Input type="number" className="mt-1" min={1} max={200} {...register('capacity')} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
          <Link href={`/classes/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
