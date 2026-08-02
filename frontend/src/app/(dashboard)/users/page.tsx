'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { Pagination } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { useDebounce } from '@/hooks/useDebounce'
import { StatusBadge } from '@/components/ui/status-badge'
import { ErrorState } from '@/components/ui/error-state'
import { Users, MoreVertical, Shield, CheckCircle, XCircle, AlertCircle, Flag } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'

const ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE']
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  TEACHER: 'bg-green-100 text-green-700',
  STUDENT: 'bg-blue-100 text-blue-700',
  GUARDIAN: 'bg-orange-100 text-orange-700',
  REPRESENTATIVE: 'bg-gray-100 text-gray-700'
}


export default function UsersPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['users', debouncedSearch, page, roleFilter, statusFilter],
    queryFn: () => api.get('/users', {
      params: {
        search: debouncedSearch || undefined,
        page,
        limit: 25,
        role: roleFilter || undefined,
        status: statusFilter || undefined
      }
    }).then(r => r.data)
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.put(`/users/${id}/status`, { status }),
    onSuccess: (_, vars) => {
      toast({ title: `User ${vars.status.toLowerCase()}` })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: () => toast({ title: 'Action failed', variant: 'destructive' })
  })

  const users = data?.data || []
  const pagination = data?.pagination

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-halqa-700" /> User Management
          </h1>
          <p className="text-gray-500 text-sm">{pagination?.total || 0} total users</p>
        </div>
        <Link
          href="/users/reports"
          className="flex items-center gap-2 px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 hover:text-orange-700 border border-orange-200 rounded-xl text-sm font-semibold transition-colors"
        >
          <Flag className="w-4 h-4" />
          User Reports
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={v => { setSearch(v); setPage(1) }}
          placeholder="Search by name or email..."
          isLoading={isLoading && !!search}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Select value={roleFilter || 'all'} onValueChange={v => { setRoleFilter(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-40 h-10">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {ROLES.map(r => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter || 'all'} onValueChange={v => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-36 h-10">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Users table */}
      <Card className="border-0 shadow-sm">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : isError ? (
          <div className="p-4"><ErrorState onRetry={refetch} /></div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p>No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Last Login</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Joined</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className="text-xs font-semibold bg-gray-100">
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-gray-900">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[180px]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                        {u.role?.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">
                      {u.lastLoginAt ? format(new Date(u.lastLoginAt), 'MMM d, h:mm a') : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">
                      {format(new Date(u.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {u.status !== 'ACTIVE' && (
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: u.id, status: 'ACTIVE' })}
                              className="text-green-600 focus:text-green-600"
                            >
                              <CheckCircle className="mr-2 h-4 w-4" /> Activate
                            </DropdownMenuItem>
                          )}
                          {u.status !== 'SUSPENDED' && (
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: u.id, status: 'SUSPENDED' })}
                              className="text-red-600 focus:text-red-600"
                            >
                              <AlertCircle className="mr-2 h-4 w-4" /> Suspend
                            </DropdownMenuItem>
                          )}
                          {u.status !== 'INACTIVE' && (
                            <DropdownMenuItem
                              onClick={() => statusMutation.mutate({ id: u.id, status: 'INACTIVE' })}
                            >
                              <XCircle className="mr-2 h-4 w-4" /> Deactivate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
