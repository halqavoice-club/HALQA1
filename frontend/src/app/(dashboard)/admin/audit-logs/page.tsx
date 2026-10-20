'use client'

/**
 * Admin — Platform-Wide Audit Logs
 * Route: /admin/audit-logs
 * Access: SUPER_ADMIN only
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Shield, Search, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'

const ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  VIEW:   'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function AdminAuditLogsPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const [entity, setEntity]   = useState('')
  const [action, setAction]   = useState('all')
  const [page, setPage]       = useState(1)
  const [selected, setSelected] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', page, entity, action],
    queryFn: () => api.get('/admin/stats/audit', {
      params: {
        page, limit: 50,
        ...(entity ? { entity } : {}),
        ...(action !== 'all' ? { action } : {}),
      }
    }).then(r => r.data.data as { logs: any[]; pagination: any }),
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  const logs       = data?.logs ?? []
  const pagination = data?.pagination

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Logs</h1>
          <p className="text-sm text-gray-500">
            Platform-wide action trail · {pagination?.total?.toLocaleString() ?? '—'} total records
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Filter by entity (e.g. user, class)…"
            value={entity}
            onChange={e => { setEntity(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={action} onValueChange={v => { setAction(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="CREATE">Create</SelectItem>
            <SelectItem value="UPDATE">Update</SelectItem>
            <SelectItem value="DELETE">Delete</SelectItem>
            <SelectItem value="VIEW">View</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-12 border-b border-gray-100 dark:border-gray-800 animate-pulse bg-gray-50 dark:bg-gray-800/50" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No audit records found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">When</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Actor</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Action</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Entity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">IP</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr
                  key={log.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-xs">
                        {log.user?.firstName} {log.user?.lastName}
                      </p>
                      <p className="text-xs text-gray-400 truncate max-w-40">{log.user?.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_STYLE[log.action] ?? ''}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium">{log.entity}</p>
                    <p className="text-xs text-gray-400 font-mono truncate max-w-32">{log.entityId?.slice(0, 12)}…</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono hidden lg:table-cell">
                    {log.ipAddress || '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelected(log)}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Info className="w-4 h-4" />
                    </button>
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
          <span>Page {page} of {pagination.pages} · {pagination.total?.toLocaleString()} records</span>
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

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Audit Log Detail</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              {[
                ['ID',       selected.id],
                ['Date',     new Date(selected.createdAt).toLocaleString()],
                ['Actor',    `${selected.user?.firstName} ${selected.user?.lastName} (${selected.user?.email})`],
                ['Action',   selected.action],
                ['Entity',   selected.entity],
                ['Entity ID', selected.entityId],
                ['School ID', selected.schoolId || '— (platform-level)'],
                ['IP',       selected.ipAddress || '—'],
              ].map(([label, val]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-500 w-24 shrink-0 font-medium">{label}</span>
                  <span className="text-gray-900 dark:text-white font-mono text-xs break-all">{val}</span>
                </div>
              ))}
              {selected.oldValues && Object.keys(selected.oldValues).length > 0 && (
                <div>
                  <p className="text-gray-500 font-medium mb-1">Old Values</p>
                  <pre className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-xs overflow-auto max-h-32">
                    {JSON.stringify(selected.oldValues, null, 2)}
                  </pre>
                </div>
              )}
              {selected.newValues && Object.keys(selected.newValues).length > 0 && (
                <div>
                  <p className="text-gray-500 font-medium mb-1">New Values</p>
                  <pre className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-xs overflow-auto max-h-32">
                    {JSON.stringify(selected.newValues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
