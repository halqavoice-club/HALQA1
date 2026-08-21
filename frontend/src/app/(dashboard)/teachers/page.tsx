'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AdvancedSearch } from '@/components/ui/advanced-search'
import { BulkActions, commonBulkActions } from '@/components/ui/bulk-actions'
import { LoadingState } from '@/components/ui/loading-state'
import { CardSkeleton } from '@/components/ui/skeleton-card'
import { UserCheck, Plus, ChevronRight, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { useAnalytics } from '@/lib/analytics'

export default function TeachersPage() {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, any>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const { user } = useAuthStore()
  const { isAdmin } = useEducationRole()
  const { trackEvent } = useAnalytics()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['teachers', search, filters],
    queryFn: () => api.get('/teachers', { params: { search, ...filters } }).then(r => r.data)
  })

  const teachers = data?.data || []
  const canCreate = isAdmin

  const handleSearch = (query: string, activeFilters: Record<string, any>) => {
    setSearch(query)
    setFilters(activeFilters)
    trackEvent('search_teachers', { query, filters: activeFilters })
  }

  const handleBulkAction = async (actionId: string, selectedTeacherIds: string[]) => {
    trackEvent('bulk_action_teachers', { action: actionId, count: selectedTeacherIds.length })
    if (actionId === 'message') {
      window.open(`/messages?recipientIds=${selectedTeacherIds.join(',')}`, '_blank')
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
          <h1 className="text-2xl font-bold text-gray-900">Teachers</h1>
          <p className="text-gray-500 text-sm">{teachers.length} total teachers</p>
        </div>
        {canCreate && (
          <Link href="/teachers/new">
            <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
              <Plus className="w-4 h-4" /> Add Teacher
            </Button>
          </Link>
        )}
      </div>

      <AdvancedSearch
        onSearch={handleSearch}
        placeholder="Search teachers..."
        filters={[
          {
            id: 'department',
            label: 'Department',
            type: 'select',
            options: [
              { value: 'quran', label: 'Quran Studies' },
              { value: 'arabic', label: 'Arabic' },
              { value: 'islamic', label: 'Islamic Studies' },
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

      <LoadingState loading={isLoading} error={isError ? new Error('Failed to load teachers') : null} onRetry={refetch}>
        {teachers.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <UserCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p>{search ? `No teachers matching "${search}"` : 'No teachers yet'}</p>
            {canCreate && !search && (
              <Link href="/teachers/new">
                <Button className="mt-4 bg-halqa-700 hover:bg-halqa-800">Add First Teacher</Button>
              </Link>
            )}
          </div>
        ) : (
          <>
            <BulkActions
              items={teachers}
              actions={bulkActions}
              onSelectionChange={setSelectedIds}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {teachers.map((teacher: any) => (
                <Link key={teacher.id} href={`/teachers/${teacher.id}`}>
                  <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-11 h-11 flex-shrink-0">
                          <AvatarFallback className="bg-green-100 text-green-700 font-semibold text-sm">
                            {teacher.user?.firstName?.[0]}{teacher.user?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate group-hover:text-halqa-700 transition-colors">
                            {teacher.user?.firstName} {teacher.user?.lastName}
                          </p>
                          {teacher.department && (
                            <p className="text-xs text-gray-500">{teacher.department}</p>
                          )}
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {teacher.teacherClasses?.slice(0, 2).map((tc: any) => (
                              <Badge key={tc.class?.id} variant="secondary" className="text-xs py-0">
                                {tc.class?.name}
                              </Badge>
                            ))}
                            {teacher.teacherClasses?.length > 2 && (
                              <Badge variant="secondary" className="text-xs py-0">
                                +{teacher.teacherClasses.length - 2}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-halqa-500 flex-shrink-0" />
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
