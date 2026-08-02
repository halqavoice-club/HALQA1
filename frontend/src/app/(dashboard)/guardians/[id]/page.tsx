'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import {
  ArrowLeft, Mail, Phone, Users, GraduationCap,
  BookOpen, CheckCircle, Star, BookMarked, Edit, Trash2, MessageSquare
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

export default function GuardianDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: guardian, isLoading } = useQuery({
    queryKey: ['guardian', id],
    queryFn: () => api.get(`/guardians/${id}`).then(r => r.data.data)
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/guardians/${id}`),
    onSuccess: () => {
      toast({ title: 'Guardian deleted' })
      queryClient.invalidateQueries({ queryKey: ['guardians'] })
      router.push('/guardians')
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' })
  })

  const canEdit = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role || '')

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!guardian) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Guardian not found</p>
        <Link href="/guardians"><Button variant="outline" className="mt-4">Back to Guardians</Button></Link>
      </div>
    )
  }

  const students = guardian.students || []

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Guardians', href: '/guardians' }, { label: `${guardian.user?.firstName} ${guardian.user?.lastName}` }]} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/guardians" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Guardians
        </Link>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/guardians/${id}/edit`}>
              <Button variant="outline" size="sm" className="gap-2">
                <Edit className="w-4 h-4" /> Edit
              </Button>
            </Link>
            <Button
              variant="outline" size="sm"
              className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          </div>
        )}
      </div>

      {/* Profile card */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <Avatar className="w-20 h-20 flex-shrink-0">
              <AvatarFallback className="bg-orange-100 text-orange-700 text-2xl font-bold">
                {guardian.user?.firstName?.[0]}{guardian.user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1">
              <div className="flex flex-wrap items-start gap-3 mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {guardian.user?.firstName} {guardian.user?.lastName}
                  </h1>
                  <p className="text-gray-500 text-sm capitalize">{guardian.relationship}</p>
                </div>
                <StatusBadge status={guardian.user?.status || 'INACTIVE'} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {guardian.user?.email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{guardian.user.email}</span>
                  </div>
                )}
                {guardian.user?.phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    {guardian.user.phone}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <Link href={`/messages?compose=${guardian.user?.id}`}>
                  <Button variant="outline" size="sm" className="gap-2">
                    <MessageSquare className="w-4 h-4" /> Send Message
                  </Button>
                </Link>
              </div>
            </div>

            <div className="text-center bg-orange-50 rounded-xl p-4 md:w-32">
              <p className="text-3xl font-bold text-orange-700">{students.length}</p>
              <p className="text-xs text-orange-600 mt-1">Children</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked students */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <GraduationCap className="w-4 h-4" /> Linked Students
          </CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No students linked</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {students.map((gs: any) => {
                const student = gs.student
                return (
                  <Link key={student?.id} href={`/students/${student?.id}`}>
                    <Card className="border border-gray-100 shadow-none hover:shadow-sm hover:border-halqa-200 transition-all cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold text-sm">
                              {student?.user?.firstName?.[0]}{student?.user?.lastName?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">
                              {student?.user?.firstName} {student?.user?.lastName}
                            </p>
                            <p className="text-xs text-gray-500">{student?.studentId}</p>
                            {student?.enrollments?.length > 0 && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {student.enrollments.map((e: any) => e.class?.name).join(', ')}
                              </p>
                            )}
                          </div>
                          {gs.isPrimary && (
                            <Badge className="text-xs bg-halqa-100 text-halqa-700 flex-shrink-0">Primary</Badge>
                          )}
                        </div>

                        {/* Quick stats */}
                        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100">
                          <Link href={`/attendance?studentId=${student?.id}`} onClick={e => e.stopPropagation()}
                            className="text-center hover:bg-green-50 rounded p-1 transition-colors">
                            <CheckCircle className="w-4 h-4 text-green-500 mx-auto mb-0.5" />
                            <p className="text-xs text-gray-500">Attendance</p>
                          </Link>
                          <Link href={`/grades?studentId=${student?.id}`} onClick={e => e.stopPropagation()}
                            className="text-center hover:bg-blue-50 rounded p-1 transition-colors">
                            <BookMarked className="w-4 h-4 text-blue-500 mx-auto mb-0.5" />
                            <p className="text-xs text-gray-500">Grades</p>
                          </Link>
                          <Link href={`/behavior?studentId=${student?.id}`} onClick={e => e.stopPropagation()}
                            className="text-center hover:bg-yellow-50 rounded p-1 transition-colors">
                            <Star className="w-4 h-4 text-yellow-500 mx-auto mb-0.5" />
                            <p className="text-xs text-gray-500">Behavior</p>
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Guardian"
        message="Are you sure you want to delete this guardian? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
