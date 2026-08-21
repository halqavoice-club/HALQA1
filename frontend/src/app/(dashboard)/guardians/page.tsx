'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { useDebounce } from '@/hooks/useDebounce'
import { Users, Plus, Mail, Phone, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth.store'
import { useEducationRole } from '@/hooks/useEducationRole'
import { ErrorState } from '@/components/ui/error-state'

export default function GuardiansPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { user } = useAuthStore()
  const { isAdmin, isTeacher, isStudent, isGuardian, effectiveRole } = useEducationRole()
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guardians', debouncedSearch, page],
    queryFn: () => api.get('/guardians', { params: { search: debouncedSearch, page, limit: 20 } }).then(r => r.data)
  })

  const guardians = data?.data || []
  const pagination = data?.pagination
  const canCreate = isAdmin

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Guardians</h1>
          <p className="text-gray-500 text-sm">{pagination?.total || 0} total guardians</p>
        </div>
        {canCreate && (
          <Link href="/guardians/new">
            <Button className="bg-halqa-700 hover:bg-halqa-800 gap-2">
              <Plus className="w-4 h-4" /> Add Guardian
            </Button>
          </Link>
        )}
      </div>

      <SearchInput
        value={search}
        onChange={v => { setSearch(v); setPage(1) }}
        placeholder="Search guardians by name or email..."
        isLoading={isLoading && !!search}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : guardians.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-medium">{search ? `No guardians matching "${search}"` : 'No guardians yet'}</p>
          {canCreate && !search && (
            <Link href="/guardians/new">
              <Button className="mt-4 bg-halqa-700 hover:bg-halqa-800">Add First Guardian</Button>
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guardians.map((guardian: any) => (
              <Card key={guardian.id} className="border-0 shadow-sm hover:shadow-md transition-all group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-11 h-11 flex-shrink-0">
                      <AvatarFallback className="bg-orange-100 text-orange-700 font-semibold text-sm">
                        {guardian.user?.firstName?.[0]}{guardian.user?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900 truncate">
                          {guardian.user?.firstName} {guardian.user?.lastName}
                        </p>
                        <Badge variant="outline" className="text-xs capitalize ml-2 flex-shrink-0">
                          {guardian.relationship}
                        </Badge>
                      </div>
                      <div className="space-y-0.5 mt-1">
                        {guardian.user?.email && (
                          <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                            <Mail className="w-3 h-3 flex-shrink-0" /> {guardian.user.email}
                          </p>
                        )}
                        {guardian.user?.phone && (
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Phone className="w-3 h-3 flex-shrink-0" /> {guardian.user.phone}
                          </p>
                        )}
                      </div>
                      {guardian.students?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {guardian.students.slice(0, 3).map((gs: any) => (
                            <Link
                              key={gs.student?.id}
                              href={`/students/${gs.student?.id}`}
                              onClick={e => e.stopPropagation()}
                            >
                              <Badge variant="secondary" className="text-xs hover:bg-halqa-100 transition-colors">
                                {gs.student?.user?.firstName} {gs.student?.user?.lastName}
                              </Badge>
                            </Link>
                          ))}
                          {guardian.students.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{guardian.students.length - 3} more
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {pagination && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
