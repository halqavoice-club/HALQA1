'use client'

/**
 * Admin — Security Dashboard
 * Route: /admin/security
 * Access: SUPER_ADMIN only
 * Data: GET /api/v1/admin/stats/security (real audit log data)
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Lock, AlertTriangle, Shield, XCircle, RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const ACTION_STYLE: Record<string, string> = {
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  CREATE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

const ENTITY_ICON: Record<string, React.ElementType> = {
  user_status:          XCircle,
  user_platform_role:   Shield,
  user_moderation:      AlertTriangle,
  school_status:        Shield,
}

export default function AdminSecurityPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const [selected, setSelected] = useState<any>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-security'],
    queryFn:  () => api.get('/admin/stats/security').then(r => r.data.data as {
      stats: { suspensions7d: number; bans7d: number; roleChanges7d: number; totalSuspended: number; totalBanned: number }
      recentEvents: any[]
    }),
    refetchInterval: 30_000,
    enabled: isAdmin,
  })

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  const events = data?.recentEvents ?? []

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lock className="w-6 h-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Security</h1>
            <p className="text-sm text-gray-500">Moderation events, role changes, suspensions — last 7 days</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Suspensions (7d)',  value: data?.stats?.suspensions7d ?? 0,  color: 'text-orange-600' },
          { label: 'Bans (7d)',         value: data?.stats?.bans7d        ?? 0,  color: 'text-red-600' },
          { label: 'Role Changes (7d)', value: data?.stats?.roleChanges7d ?? 0,  color: 'text-purple-600' },
          { label: 'Total Suspended',   value: data?.stats?.totalSuspended ?? 0, color: 'text-orange-600' },
          { label: 'Total Banned',      value: data?.stats?.totalBanned    ?? 0, color: 'text-red-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Note about privacy */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-700 dark:text-blue-300">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>Security events are sourced from the audit log. Only administrative actions (status changes, role changes, moderation) are shown. Passwords, tokens, and private messages are never exposed.</span>
      </div>

      {/* Events table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Security Events (last 7 days)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({length:6}).map((_,i) => <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"/>)}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-40"/>
              <p className="text-sm">No security events in the last 7 days</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">When</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Actor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Action</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3"/>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e: any) => {
                    const Icon = ENTITY_ICON[e.entity] ?? Shield
                    return (
                      <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-medium">{e.user?.firstName} {e.user?.lastName}</p>
                          <p className="text-xs text-gray-400 truncate max-w-32">{e.user?.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_STYLE[e.action] ?? ''}`}>
                            {e.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <span className="text-xs font-medium">{e.entity?.replace(/_/g, ' ')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setSelected(e)}
                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Event Detail</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              {[
                ['Date',      new Date(selected.createdAt).toLocaleString()],
                ['Actor',     `${selected.user?.firstName} ${selected.user?.lastName} (${selected.user?.email})`],
                ['Action',    selected.action],
                ['Entity',    selected.entity],
                ['Entity ID', selected.entityId],
                ['IP',        selected.ipAddress || '—'],
              ].map(([label, val]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-500 w-20 shrink-0 font-medium">{label}</span>
                  <span className="font-mono text-xs break-all">{val}</span>
                </div>
              ))}
              {selected.newValues && Object.keys(selected.newValues).length > 0 && (
                <div>
                  <p className="text-gray-500 font-medium mb-1">Change</p>
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
