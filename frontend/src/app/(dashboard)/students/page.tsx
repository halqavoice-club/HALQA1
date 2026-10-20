'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, GraduationCap, ChevronRight, Download, Search, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { getAvatarUrl } from '@/lib/avatar'

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const { user } = useAuthStore()
  const { isAdmin } = useEducationRole()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['students', search],
    queryFn: () => api.get('/students', { params: { search: search || undefined } }).then(r => r.data),
    staleTime: 30_000,
  })

  const students: any[] = data?.data || []
  const canCreate = isAdmin

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-gray-500 text-sm">
            {isLoading ? 'Loading…' : `${students.length} student${students.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link href="/import">
              <Button variant="outline" size="sm" className="gap-2 hidden md:flex">
                <Download className="w-4 h-4" /> Import
              </Button>
            </Link>
            <Link href="/students/new">
              <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
                <Plus className="w-4 h-4" /> Add Student
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, or student ID…"
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-halqa-400 focus:ring-2 focus:ring-halqa-100 transition-colors bg-white"
        />
        {isLoading && search && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Error state */}
      {isError && (
        <div className="text-center py-8">
          <p className="text-red-500 text-sm mb-3">Failed to load students</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && students.length === 0 && (
        <div className="text-center py-16">
          <GraduationCap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {search ? `No students matching "${search}"` : 'No students yet'}
          </p>
          {canCreate && !search && (
            <Link href="/students/new">
              <Button className="mt-4 bg-halqa-700 hover:bg-halqa-800">Add First Student</Button>
            </Link>
          )}
        </div>
      )}

      {/* Student grid */}
      {!isError && students.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {students.map((student: any) => (
            <Link key={student.id} href={`/students/${student.id}`}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-11 h-11 flex-shrink-0">
                      <AvatarImage src={getAvatarUrl(student.user?.avatarUrl)} />
                      <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold text-sm">
                        {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate group-hover:text-halqa-700 transition-colors">
                        {student.user?.firstName} {student.user?.lastName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {student.studentId}
                        {student.gradeLevel ? ` · ${student.gradeLevel}` : ''}
                      </p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {student.enrollments?.slice(0, 2).map((e: any) => (
                          <Badge key={e.class?.id} variant="secondary" className="text-xs py-0">
                            {e.class?.name}
                          </Badge>
                        ))}
                        {student.enrollments?.length > 2 && (
                          <Badge variant="secondary" className="text-xs py-0">
                            +{student.enrollments.length - 2}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-halqa-500 transition-colors flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
