'use client'

/**
 * Admin — User Management
 * Route: /admin/users
 * Access: SUPER_ADMIN only
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Users, Search, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, AlertTriangle, Ban, Shield, LogOut, Monitor,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SUSPENDED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  BANNED:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  INACTIVE:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  PENDING:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

const ROLE_STYLE: Record<string, string> = {
  SUPER_ADMIN:  'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  SCHOOL_ADMIN: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  TEACHER:      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  STUDENT:      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  GUARDIAN:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  MEMBER:       'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function AdminUsersPage() {
  const user = useAuthStore(s => s.user)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('all')
  const [role, setRole]         = useState('all')
  const [page, setPage]         = useState(1)
  const [selected, setSelected] = useState<any>(null)
  const [newStatus, setNewStatus] = useState('')
  const [reason, setReason]     = useState('')

  // Session management state (UIGAP-002)
  const [sessionTarget, setSessionTarget]   = useState<any>(null)
  const [sessionReason, setSessionReason]   = useState('')
  const [sessionData, setSessionData]       = useState<any>(null)
  const [sessionLoading, setSessionLoading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, search, status, role],
    queryFn: () => api.get('/admin/stats/users', {
      params: {
        page,
        limit: 20,
        ...(search ? { search } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(role   !== 'all' ? { role }   : {}),
      }
    }).then(r => r.data.data as { users: any[]; pagination: any }),
    enabled: isAdmin,
  })

  const mutation = useMutation({
    mutationFn: ({ id, status, reason }: any) =>
      api.patch(`/admin/stats/users/${id}/status`, { status, reason }),
    onSuccess: () => {
      toast({ title: 'User updated', description: `Status changed to ${newStatus.toLowerCase()}.` })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      setSelected(null)
      setNewStatus('')
      setReason('')
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

  const users = data?.users ?? []
  const pagination = data?.pagination

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
          <p className="text-sm text-gray-500">
            {pagination?.total?.toLocaleString() ?? '—'} total users
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="BANNED">Banned</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={v => { setRole(v); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
            <SelectItem value="SCHOOL_ADMIN">School Admin</SelectItem>
            <SelectItem value="TEACHER">Teacher</SelectItem>
            <SelectItem value="STUDENT">Student</SelectItem>
            <SelectItem value="GUARDIAN">Guardian</SelectItem>
            <SelectItem value="MEMBER">Member</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 border-b border-gray-100 dark:border-gray-800 animate-pulse bg-gray-50 dark:bg-gray-800/50" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No users found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">User</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Joined</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Last Login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr
                  key={u.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={getAvatarUrl(u.avatarUrl)} />
                        <AvatarFallback className="text-xs bg-indigo-100 text-indigo-700">
                          {u.firstName?.[0]}{u.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_STYLE[u.role] ?? ''}`}>
                      {u.role?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[u.status] ?? ''}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {u.role !== 'SUPER_ADMIN' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelected(u); setNewStatus(u.status) }}
                        >
                          Manage
                        </Button>
                      )}
                      {u.role !== 'SUPER_ADMIN' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-orange-600 border-orange-200 hover:bg-orange-50"
                          title="View & revoke sessions"
                          onClick={async () => {
                            setSessionTarget(u)
                            setSessionLoading(true)
                            setSessionData(null)
                            try {
                              const r = await api.get(`/admin/actions/users/${u.id}/sessions`)
                              setSessionData(r.data.data)
                            } catch { /* show empty state */ }
                            setSessionLoading(false)
                          }}
                        >
                          <Monitor className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
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
            <Button
              size="sm" variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
              disabled={page >= pagination.pages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edit status dialog */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage User</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Avatar className="w-10 h-10">
                  <AvatarImage src={getAvatarUrl(selected.avatarUrl)} />
                  <AvatarFallback>{selected.firstName?.[0]}{selected.lastName?.[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{selected.firstName} {selected.lastName}</p>
                  <p className="text-xs text-gray-400">{selected.email}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  New Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'].map(s => (
                    <button
                      key={s}
                      onClick={() => setNewStatus(s)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        newStatus === s
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {s === 'ACTIVE'    && <CheckCircle  className="w-3.5 h-3.5 inline mr-1" />}
                      {s === 'INACTIVE'  && <XCircle      className="w-3.5 h-3.5 inline mr-1" />}
                      {s === 'SUSPENDED' && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}
                      {s === 'BANNED'    && <Ban           className="w-3.5 h-3.5 inline mr-1" />}
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  Reason (optional, for audit trail)
                </label>
                <Textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Describe why this action is being taken…"
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate({ id: selected.id, status: newStatus, reason })}
              disabled={!newStatus || newStatus === selected?.status || mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : 'Update Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Management Dialog (UIGAP-002) */}
      <Dialog open={!!sessionTarget} onOpenChange={open => { if (!open) { setSessionTarget(null); setSessionData(null); setSessionReason('') } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-orange-500" />
              Sessions — {sessionTarget?.firstName} {sessionTarget?.lastName}
            </DialogTitle>
          </DialogHeader>
          {sessionLoading ? (
            <div className="space-y-2 py-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
            </div>
          ) : sessionData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{sessionData.activeSessionCount}</p>
                  <p className="text-xs text-gray-500">Active Sessions</p>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-red-700 dark:text-red-300">{sessionData.activeRefreshTokens}</p>
                  <p className="text-xs text-gray-500">Refresh Tokens</p>
                </div>
              </div>
              {sessionData.sessions?.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessionData.sessions.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                      <div>
                        <p className="font-medium">{s.deviceName || 'Unknown device'}</p>
                        <p className="text-gray-400">{s.ipAddress || '—'} · Last seen {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '—'}</p>
                      </div>
                      <span className="text-green-600 font-semibold">Active</span>
                    </div>
                  ))}
                </div>
              )}
              {sessionData.activeSessionCount === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No active sessions</p>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Reason for revocation (optional)</label>
                <Input value={sessionReason} onChange={e => setSessionReason(e.target.value)} placeholder="Security incident, account review, etc." />
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-300">
                Revoking sessions will log the user out immediately on their next API call. Their account remains active.
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">Failed to load session data</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionTarget(null)}>Close</Button>
            <Button
              variant="destructive"
              disabled={!sessionData || sessionData.activeSessionCount === 0}
              onClick={async () => {
                try {
                  await api.delete(`/admin/actions/users/${sessionTarget.id}/sessions`, { data: { reason: sessionReason } })
                  toast({ title: 'Sessions revoked', description: `All sessions for ${sessionTarget.firstName} have been terminated.` })
                  setSessionTarget(null)
                  setSessionData(null)
                  setSessionReason('')
                } catch (e: any) {
                  toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' })
                }
              }}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Revoke All Sessions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
