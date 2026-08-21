'use client'

/**
 * Admin — Platform-Wide Announcements Viewer
 * Route: /admin/announcements
 * Access: SUPER_ADMIN only
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Button } from '@/components/ui/button'
import {
  Megaphone, ChevronLeft, ChevronRight, Pin, Clock
} from 'lucide-react'

export default function AdminAnnouncementsPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-announcements', page],
    queryFn: () => api.get('/admin/stats/announcements', { params: { page, limit: 20 } })
      .then(r => r.data.data as { announcements: any[]; pagination: any }),
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  const announcements = data?.announcements ?? []
  const pagination    = data?.pagination

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Megaphone className="w-6 h-6 text-green-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Announcements</h1>
          <p className="text-sm text-gray-500">
            All school announcements across the platform ·{' '}
            {pagination?.total?.toLocaleString() ?? '—'} total
          </p>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>No announcements found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a: any) => (
            <div
              key={a.id}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.isPinned && (
                      <Pin className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                    )}
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{a.title}</h3>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <span className="font-medium text-gray-500">{a.school?.name ?? 'Unknown school'}</span>
                    <span>·</span>
                    <Clock className="w-3 h-3" />
                    <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                    {a.expiresAt && (
                      <>
                        <span>· Expires</span>
                        <span>{new Date(a.expiresAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </p>
                </div>
                {a.targetRoles?.length > 0 && (
                  <div className="flex gap-1 flex-wrap justify-end">
                    {a.targetRoles.map((r: string) => (
                      <span
                        key={r}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-500 capitalize"
                      >
                        {r.toLowerCase()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{a.content}</p>
            </div>
          ))}
        </div>
      )}

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
    </div>
  )
}
