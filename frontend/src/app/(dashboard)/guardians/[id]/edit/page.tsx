'use client'

/**
 * Guardian Edit Page
 *
 * A School Admin may ONLY edit school-specific guardian fields:
 *   - Relationship (parent / guardian / grandparent / uncle / aunt / sibling / other)
 *
 * Personal information (name, email, phone) is NOT shown here.
 * It belongs to the guardian and can only be changed by the guardian
 * via their own profile/settings page.
 */

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'

const RELATIONSHIPS = ['parent', 'guardian', 'grandparent', 'uncle', 'aunt', 'sibling', 'other']

const schema = z.object({
  relationship: z.string().min(1, 'Required'),
})
type Form = z.infer<typeof schema>

export default function EditGuardianPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: guardian, isLoading } = useQuery({
    queryKey: ['guardian', id],
    queryFn: () => api.get(`/guardians/${id}`).then(r => r.data.data),
  })

  const { handleSubmit, setValue, reset, formState: { isDirty } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { relationship: 'parent' },
  })

  useEffect(() => {
    if (guardian) {
      reset({ relationship: guardian.relationship || 'parent' })
    }
  }, [guardian, reset])

  const mutation = useMutation({
    mutationFn: (data: Form) => api.put(`/guardians/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Guardian updated successfully' })
      queryClient.invalidateQueries({ queryKey: ['guardian', id] })
      router.push(`/guardians/${id}`)
    },
    onError: (err: any) =>
      toast({ title: err.response?.data?.message || 'Update failed', variant: 'destructive' }),
  })

  useUnsavedChanges(isDirty && !mutation.isSuccess)

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-md">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-md space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Link href={`/guardians/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Guardian</h1>
          <p className="text-gray-500 text-sm">
            {guardian?.user?.firstName} {guardian?.user?.lastName}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">School Details</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">
              Only school-specific fields can be edited here. Personal information is managed by the guardian.
            </p>
          </CardHeader>
          <CardContent>
            <div>
              <Label>Relationship to Student</Label>
              <Select
                defaultValue={guardian?.relationship || 'parent'}
                onValueChange={v => setValue('relationship', v, { shouldDirty: true })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select relationship" />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map(r => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">
                The guardian&apos;s relationship to the linked student(s)
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
          <Link href={`/guardians/${id}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
