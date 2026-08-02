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
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import Link from 'next/link'

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other']

const schema = z.object({
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  relationship: z.string().default('parent'),
})
type Form = z.infer<typeof schema>

export default function EditGuardianPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: guardian, isLoading } = useQuery({
    queryKey: ['guardian', id],
    queryFn: () => api.get(`/guardians/${id}`).then(r => r.data.data)
  })

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (guardian) {
      reset({
        firstName: guardian.user?.firstName || '',
        lastName: guardian.user?.lastName || '',
        phone: guardian.user?.phone || '',
        relationship: guardian.relationship || 'parent'
      })
    }
  }, [guardian, reset])

  const mutation = useMutation({
    mutationFn: (data: Form) => api.put(`/guardians/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Guardian updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['guardian', id] })
      router.push(`/guardians/${id}`)
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
        <Link href={`/guardians/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Guardian</h1>
          <p className="text-gray-500 text-sm">{guardian?.user?.firstName} {guardian?.user?.lastName}</p>
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
              <Input className="mt-1" placeholder="+1 555 0100" {...register('phone')} />
            </div>
            <div>
              <Label>Relationship</Label>
              <Select defaultValue={guardian?.relationship || 'parent'} onValueChange={v => setValue('relationship', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
          <p className="font-medium mb-1">Note:</p>
          <p>Email address cannot be changed. Contact a Super Admin if needed.</p>
          <p className="mt-1">Current email: <strong>{guardian?.user?.email}</strong></p>
        </div>

        <div className="flex gap-3">
          <Button type="submit" className="bg-halqa-700 hover:bg-halqa-800 gap-2" disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
          <Link href={`/guardians/${id}`}><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
