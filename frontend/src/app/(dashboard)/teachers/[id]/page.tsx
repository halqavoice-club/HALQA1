'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import {
  ArrowLeft, Mail, Phone, BookOpen, Users,
  GraduationCap, Star, ClipboardCheck, Edit, Trash2
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

export default function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: teacher, isLoading } = useQuery({
    queryKey: ['teacher', id],
    queryFn: () => api.get(`/teachers/${id}`).then(r => r.data.data)
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/teachers/${id}`),
    onSuccess: () => {
      toast({ title: 'Teacher deleted' })
      queryClient.invalidateQueries({ queryKey: ['teachers'] })
      router.push('/teachers')
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' })
  })

  const canEdit = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role || '')

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!teacher) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Teacher not found</p>
        <Link href="/teachers"><Button variant="outline" className="mt-4">Back to Teachers</Button></Link>
      </div>
    )
  }

  const classes = teacher.teacherClasses || []
  const totalStudents = classes.reduce((sum: number, tc: any) => sum + (tc.class?._count?.enrollments || 0), 0)

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Teachers', href: '/teachers' }, { label: `${teacher.user?.firstName} ${teacher.user?.lastName}` }]} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/teachers" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Teachers
        </Link>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/teachers/${id}/edit`}>
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
              <AvatarFallback className="bg-green-100 text-green-700 text-2xl font-bold">
                {teacher.user?.firstName?.[0]}{teacher.user?.lastName?.[0]}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1">
              <div className="flex flex-wrap items-start gap-3 mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {teacher.user?.firstName} {teacher.user?.lastName}
                  </h1>
                  <p className="text-gray-500 text-sm">
                    {teacher.department || 'Teacher'}{teacher.specialization ? ` · ${teacher.specialization}` : ''}
                  </p>
                </div>
                <StatusBadge status={teacher.user?.status || 'INACTIVE'} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {teacher.user?.email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{teacher.user.email}</span>
                  </div>
                )}
                {teacher.user?.phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    {teacher.user.phone}
                  </div>
                )}
                {teacher.employeeId && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <GraduationCap className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    ID: {teacher.employeeId}
                  </div>
                )}
                {teacher.hireDate && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <ClipboardCheck className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    Hired: {format(new Date(teacher.hireDate), 'MMM d, yyyy')}
                  </div>
                )}
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 md:grid-cols-1 gap-3 md:w-36">
              <div className="text-center bg-halqa-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-halqa-700">{classes.length}</p>
                <p className="text-xs text-halqa-600">Classes</p>
              </div>
              <div className="text-center bg-blue-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-blue-700">{totalStudents}</p>
                <p className="text-xs text-blue-600">Students</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="classes">
        <TabsList>
          <TabsTrigger value="classes">Classes ({classes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="classes" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((tc: any) => (
              <Link key={tc.class?.id} href={`/classes/${tc.class?.id}`}>
                <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="bg-halqa-100 p-2 rounded-lg">
                        <BookOpen className="w-4 h-4 text-halqa-700" />
                      </div>
                      {tc.isLead && (
                        <Badge className="text-xs bg-halqa-100 text-halqa-700">Lead</Badge>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900">{tc.class?.name}</p>
                    {tc.subject && <p className="text-xs text-gray-500 mt-0.5">{tc.subject}</p>}
                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {tc.class?._count?.enrollments || 0} students
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {classes.length === 0 && (
              <p className="text-sm text-gray-500 col-span-3 text-center py-8">No classes assigned</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Teacher"
        message="Are you sure you want to delete this teacher? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
