'use client'

/**
 * Admin — School Management
 * Route: /admin/schools
 * Access: SUPER_ADMIN only
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  School, Search, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Users, BookOpen,
} from 'lucide-react'
import { resolveMediaUrl } from '@/lib/media'

export default function AdminSchoolsPage() {
  const user = useAuthStore(s => s.user)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const [search, setSearch]     = useState('')
  const [isActive, setIsActive] = useState('all')
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState<any>(null)
  const [confirmToggle, setConfirmToggle] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-schools', page, search, isActive],
    queryFn: () => api.get('/admin/stats/schools', {
      params: {
        page, limit: 20,
        ...(search    ? { search }   : {}),
        ...(isActive !== 'all' ? { isActive: isActive === 'true' } : {}),
      }
    }).then(r => r.data.data as { schools: any[]; pagination: any }),
    enabled: isAdmin,
  })

  const mutation = useMutation({
    mutationFn: ({ id, isActive }: any) =>
      api.patch(`/admin/stats/schools/${id}/status`, { isActive }),
    onSuccess: (_, vars) => {
      toast({ title: 'School updated', description: `School ${vars.isActive ? 'activated' : 'deactivated'}.` })
      queryClient.invalidateQueries({ queryKey: ['admin-schools'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setSelected(null)
      setConfirmToggle(false)
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  const schools    = data?.schools ?? []
  const pagination = data?.pagination

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <School className="w-6 h-6 text-purple-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">School Management</h1>
          <p className="text-sm text-gray-500">
            {pagination?.total?.toLocaleString() ?? '—'} schools on the platform
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search name, city, country…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={isActive} onValueChange={v => { setIsActive(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 border-b border-gray-100 dark:border-gray-800 animate-pulse bg-gray-50 dark:bg-gray-800/50" />
            ))}
          </div>
        ) : schools.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <School className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No schools found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">School</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Location</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Members</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Classes</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {schools.map((s: any) => (
                <tr
                  key={s.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {s.logoUrl ? (
                        <img
                          src={resolveMediaUrl(s.logoUrl)}
                          alt=""
                          className="w-8 h-8 rounded-lg object-contain bg-gray-100 p-0.5"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                          <School className="w-4 h-4 text-purple-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 truncate">{s.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 capitalize hidden md:table-cell">{s.type}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex items-center justify-center gap-1 text-gray-600 dark:text-gray-400">
                      <Users className="w-3.5 h-3.5" />
                      {s._count?.memberships ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex items-center justify-center gap-1 text-gray-600 dark:text-gray-400">
                      <BookOpen className="w-3.5 h-3.5" />
                      {s._count?.classes ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setSelected(s); setConfirmToggle(true) }}
                    >
                      {s.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pagination.pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmToggle} onOpenChange={setConfirmToggle}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.isActive ? 'Deactivate School' : 'Activate School'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Are you sure you want to {selected?.isActive ? 'deactivate' : 'activate'}{' '}
            <strong>{selected?.name}</strong>?
            {selected?.isActive && (
              <span className="block mt-2 text-yellow-600 dark:text-yellow-400">
                Deactivating will prevent school members from using school features.
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggle(false)}>Cancel</Button>
            <Button
              variant={selected?.isActive ? 'destructive' : 'default'}
              onClick={() => mutation.mutate({ id: selected.id, isActive: !selected.isActive })}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : (selected?.isActive ? 'Deactivate' : 'Activate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
