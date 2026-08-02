'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { useDebounce } from '@/hooks/useDebounce'
import { BookOpen, Users, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { ErrorState } from '@/components/ui/error-state'

export default function ClassesPage() {
  const [search, setSearch] = useState('')
  const { user } = useAuthStore()
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['classes', debouncedSearch],
    queryFn: () => api.get('/classes', { params: { search: debouncedSearch } }).then(r => r.data)
  })

  const classes = data?.data || []
  const canCreate = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role || '')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Classes</h1>
          <p className="text-gray-500 text-sm">{data?.pagination?.total || 0} total classes</p>
        </div>
        {canCreate && (
          <Link href="/classes/new">
            <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
              <Plus className="w-4 h-4" /> New Class
            </Button>
          </Link>
        )}
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search classes..."
        isLoading={isLoading && !!search}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : classes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-medium">{search ? `No classes matching "${search}"` : 'No classes yet'}</p>
          {canCreate && !search && (
            <Link href="/classes/new">
              <Button className="mt-4 bg-halqa-700 hover:bg-halqa-800">Create First Class</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls: any) => (
            <Link key={cls.id} href={`/classes/${cls.id}`}>
              <Card className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="bg-halqa-100 p-2 rounded-lg group-hover:bg-halqa-200 transition-colors">
                      <BookOpen className="w-5 h-5 text-halqa-700" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-halqa-500 transition-colors" />
                  </div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-halqa-700 transition-colors">
                    {cls.name}
                  </h3>
                  {cls.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{cls.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {cls._count?.enrollments || 0} students
                    </span>
                    {cls.room && (
                      <Badge variant="outline" className="text-xs">{cls.room}</Badge>
                    )}
                  </div>
                  {cls.teacherClasses?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2 truncate">
                      {cls.teacherClasses[0]?.teacher?.user?.firstName} {cls.teacherClasses[0]?.teacher?.user?.lastName}
                      {cls.teacherClasses.length > 1 && ` +${cls.teacherClasses.length - 1}`}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
