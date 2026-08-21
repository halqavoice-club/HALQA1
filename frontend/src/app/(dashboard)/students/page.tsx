'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AdvancedSearch } from '@/components/ui/advanced-search'
import { BulkActions, commonBulkActions } from '@/components/ui/bulk-actions'
import { LoadingState } from '@/components/ui/loading-state'
import { CardSkeleton } from '@/components/ui/skeleton-card'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { Plus, GraduationCap, ChevronRight, Download } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useAnalytics } from '@/lib/analytics'

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, any>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const { user } = useAuthStore()
  const { isAdmin } = useEducationRole()
  const { trackEvent } = useAnalytics()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['students', search, filters],
    queryFn: () => api.get('/students', { params: { search, ...filters } }).then(r => r.data)
  })

  const students = data?.data || []
  const canCreate = isAdmin

  const handleSearch = (query: string, activeFilters: Record<string, any>) => {
    setSearch(query)
    setFilters(activeFilters)
    trackEvent('search_students', { query, filters: activeFilters })
  }

  const handleBulkAction = async (actionId: string, selectedStudentIds: string[]) => {
    trackEvent('bulk_action_students', { action: actionId, count: selectedStudentIds.length })
    if (actionId === 'export') {
      // Export is handled by the table component
      return
    }
    if (actionId === 'message') {
      // Navigate to compose with pre-selected recipients
      window.open(`/messages?recipientIds=${selectedStudentIds.join(',')}`, '_blank')
    }
  }

  const bulkActions = [
    {
      ...commonBulkActions.delete,
      handler: (ids: string[]) => handleBulkAction('delete', ids),
    },
    {
      ...commonBulkActions.archive,
      handler: (ids: string[]) => handleBulkAction('archive', ids),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-gray-500 text-sm">{students.length} total students</p>
        </div>
        <div className="flex gap-2">
          {canCreate && (
            <>
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
            </>
          )}
        </div>
      </div>

      <AdvancedSearch
        onSearch={handleSearch}
        placeholder="Search by name, email, or student ID..."
        filters={[
          {
            id: 'class',
            label: 'Class',
            type: 'select',
            options: [
              { value: 'class1', label: 'Class 1' },
              { value: 'class2', label: 'Class 2' },
            ],
          },
          {
            id: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
        ]}
      />

      <LoadingState loading={isLoading} error={isError ? new Error('Failed to load students') : null} onRetry={refetch}>
        {students.length === 0 ? (
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
        ) : (
          <>
            <BulkActions
              items={students}
              actions={bulkActions}
              onSelectionChange={setSelectedIds}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {students.map((student: any) => (
                <Link key={student.id} href={`/students/${student.id}`}>
                  <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-11 h-11 flex-shrink-0">
                          <AvatarImage src={student.user?.avatarUrl} />
                          <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold text-sm">
                            {student.user?.firstName?.[0]}{student.user?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate group-hover:text-halqa-700 transition-colors">
                            {student.user?.firstName} {student.user?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">{student.studentId}</p>
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
          </>
        )}
      </LoadingState>
    </div>
  )
}
