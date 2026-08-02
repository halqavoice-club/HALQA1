'use client'

import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { ArrowLeft, Users, UserCheck, BookOpen, ClipboardCheck, Edit, Trash2 } from 'lucide-react'
import Link from 'next/link'

export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: cls, isLoading } = useQuery({
    queryKey: ['class', id],
    queryFn: () => api.get(`/classes/${id}`).then(r => r.data.data)
  })

  const { data: gradesData } = useQuery({
    queryKey: ['grades', 'class', id],
    queryFn: () => api.get(`/grades/class/${id}`).then(r => r.data.data),
    enabled: !!id
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/classes/${id}`),
    onSuccess: () => {
      toast({ title: 'Class deleted' })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      router.push('/classes')
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' })
  })

  const canEdit = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role || '')

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!cls) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Class not found</p>
        <Link href="/classes"><Button variant="outline" className="mt-4">Back to Classes</Button></Link>
      </div>
    )
  }

  const students = cls.enrollments?.map((e: any) => e.student) || []
  const teachers = cls.teacherClasses || []

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Classes', href: '/classes' }, { label: cls.name }]} />
      <div className="flex items-center justify-between">
        <Link href="/classes" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Classes
        </Link>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/classes/${id}/edit`}>
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

      {/* Class title */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
        {cls.description && <p className="text-gray-500 text-sm mt-1">{cls.description}</p>}
      </div>

      {/* Class info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm text-center">
          <CardContent className="p-4">
            <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{students.length}</p>
            <p className="text-xs text-gray-500">Students</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm text-center">
          <CardContent className="p-4">
            <UserCheck className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{teachers.length}</p>
            <p className="text-xs text-gray-500">Teachers</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm text-center">
          <CardContent className="p-4">
            <BookOpen className="w-5 h-5 text-purple-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{cls.capacity || '—'}</p>
            <p className="text-xs text-gray-500">Capacity</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm text-center">
          <CardContent className="p-4">
            <ClipboardCheck className="w-5 h-5 text-orange-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-gray-900">{cls.room || '—'}</p>
            <p className="text-xs text-gray-500">Room</p>
          </CardContent>
        </Card>
      </div>

      {/* Teachers */}
      {teachers.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Teachers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {teachers.map((tc: any) => (
                <div key={tc.teacher?.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <Avatar className="w-9 h-9">
                    <AvatarFallback className="bg-green-100 text-green-700 text-xs">
                      {tc.teacher?.user?.firstName?.[0]}{tc.teacher?.user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{tc.teacher?.user?.firstName} {tc.teacher?.user?.lastName}</p>
                    <p className="text-xs text-gray-500">{tc.subject || tc.teacher?.department}</p>
                  </div>
                  {tc.isLead && <Badge className="text-xs bg-halqa-100 text-halqa-700">Lead</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {students.map((student: any, idx: number) => (
                  <Link key={student.id} href={`/students/${student.id}`}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      <span className="text-sm text-gray-400 w-6">{idx + 1}</span>
                      <Avatar className="w-9 h-9">
                        <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs">
                          {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {student.user?.firstName} {student.user?.lastName}
                        </p>
                        <p className="text-xs text-gray-500">{student.studentId}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{student.user?.status}</Badge>
                    </div>
                  </Link>
                ))}
                {students.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No students enrolled</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grades" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Student</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(gradesData || []).map((g: any) => (
                      <tr key={g.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium">
                          {g.student?.user?.firstName} {g.student?.user?.lastName}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700">{g.title}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{g.type}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center">{g.score}/{g.maxScore}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            (g.percentage || 0) >= 90 ? 'bg-green-100 text-green-700' :
                            (g.percentage || 0) >= 70 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {g.letterGrade}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(!gradesData || gradesData.length === 0) && (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-500">No grades yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <div className="flex gap-3 mb-4">
            <Link href={`/attendance?classId=${id}`}>
              <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                <ClipboardCheck className="w-4 h-4" /> Mark Attendance
              </Button>
            </Link>
          </div>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 text-center text-gray-500">
              <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p>View attendance records in the Attendance module</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Class"
        message="Are you sure you want to delete this class? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
