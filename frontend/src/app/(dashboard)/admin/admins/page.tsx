'use client'

/**
 * Admin — Super Admin Provisioning
 * Route: /admin/admins
 * Access: SUPER_ADMIN only
 *
 * Uses the existing /api/v1/internal/admin/provision endpoint.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Shield, UserPlus, Trash2, Clock } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/avatar'

export default function AdminAdminsPage() {
  const user = useAuthStore(s => s.user)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const [grantOpen, setGrantOpen] = useState(false)
  const [targetEmail, setTargetEmail] = useState('')
  const [reason, setReason] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<any>(null)
  const [revokeReason, setRevokeReason] = useState('')

  // List current admins
  const { data: adminsData, isLoading } = useQuery({
    queryKey: ['admin-list'],
    queryFn: () => api.get('/internal/admin/list').then(r => r.data.data),
    enabled: isAdmin,
  })

  // Find user by email to grant
  const [lookupResult, setLookupResult] = useState<any>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  async function lookupUser() {
    if (!targetEmail.trim()) return
    setLookupLoading(true)
    setLookupResult(null)
    try {
      // Search via admin-stats users endpoint
      const res = await api.get('/admin/stats/users', { params: { search: targetEmail, limit: 5 } })
      const users = res.data.data?.users ?? []
      const match = users.find((u: any) => u.email.toLowerCase() === targetEmail.toLowerCase())
      setLookupResult(match || null)
      if (!match) toast({ title: 'User not found', description: `No user with email: ${targetEmail}`, variant: 'destructive' })
    } catch {
      toast({ title: 'Lookup failed', variant: 'destructive' })
    } finally {
      setLookupLoading(false)
    }
  }

  const grantMutation = useMutation({
    mutationFn: ({ targetUserId, reason }: any) =>
      api.post('/internal/admin/provision', { targetUserId, action: 'grant', reason }),
    onSuccess: () => {
      toast({ title: 'Admin granted', description: `${lookupResult?.email} is now a SUPER_ADMIN.` })
      queryClient.invalidateQueries({ queryKey: ['admin-list'] })
      setGrantOpen(false)
      setTargetEmail('')
      setReason('')
      setLookupResult(null)
    },
    onError: (err: any) => {
      toast({ title: 'Grant failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  const revokeMutation = useMutation({
    mutationFn: ({ targetUserId, reason }: any) =>
      api.post('/internal/admin/provision', { targetUserId, action: 'revoke', reason }),
    onSuccess: () => {
      toast({ title: 'Admin revoked', description: `${revokeTarget?.email} no longer has SUPER_ADMIN.` })
      queryClient.invalidateQueries({ queryKey: ['admin-list'] })
      setRevokeTarget(null)
      setRevokeReason('')
    },
    onError: (err: any) => {
      toast({ title: 'Revoke failed', description: err.response?.data?.message, variant: 'destructive' })
    }
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  const admins: any[] = adminsData?.admins ?? []

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-yellow-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Provisioning</h1>
            <p className="text-sm text-gray-500">{admins.length} platform administrators</p>
          </div>
        </div>
        <Button onClick={() => setGrantOpen(true)} className="flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          Grant Admin
        </Button>
      </div>

      {/* Warning */}
      <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
        <strong>Caution:</strong> SUPER_ADMIN has full platform access — manage users, schools, and all data.
        Only grant to trusted operators. All changes are permanently audited.
      </div>

      {/* Admin list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : admins.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No admins found</p>
      ) : (
        <div className="space-y-3">
          {admins.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700"
            >
              <Avatar className="w-10 h-10">
                <AvatarImage src={getAvatarUrl(a.avatarUrl)} />
                <AvatarFallback className="bg-yellow-100 text-yellow-700">
                  {a.firstName?.[0]}{a.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{a.firstName} {a.lastName}</p>
                <p className="text-xs text-gray-400">{a.email}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  Admin since {new Date(a.createdAt).toLocaleDateString()}
                  {a.lastLoginAt && ` · Last login ${new Date(a.lastLoginAt).toLocaleDateString()}`}
                </p>
              </div>
              {a.id !== user?.id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setRevokeTarget(a)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Revoke
                </Button>
              )}
              {a.id === user?.id && (
                <span className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                  You
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grant dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant SUPER_ADMIN Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                User Email
              </label>
              <div className="flex gap-2">
                <Input
                  value={targetEmail}
                  onChange={e => { setTargetEmail(e.target.value); setLookupResult(null) }}
                  placeholder="user@example.com"
                  type="email"
                />
                <Button variant="outline" onClick={lookupUser} disabled={lookupLoading || !targetEmail}>
                  {lookupLoading ? '…' : 'Find'}
                </Button>
              </div>
            </div>

            {lookupResult && (
              <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={getAvatarUrl(lookupResult.avatarUrl)} />
                  <AvatarFallback>{lookupResult.firstName?.[0]}{lookupResult.lastName?.[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-sm">{lookupResult.firstName} {lookupResult.lastName}</p>
                  <p className="text-xs text-gray-500">{lookupResult.email} · {lookupResult.role}</p>
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                Reason (required, min 10 chars)
              </label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Why is this person being granted platform admin access?"
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-gray-400 mt-1">{reason.length}/500</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGrantOpen(false); setLookupResult(null); setReason('') }}>
              Cancel
            </Button>
            <Button
              onClick={() => grantMutation.mutate({ targetUserId: lookupResult?.id, reason })}
              disabled={!lookupResult || reason.length < 10 || grantMutation.isPending}
            >
              {grantMutation.isPending ? 'Granting…' : 'Grant SUPER_ADMIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke SUPER_ADMIN Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Revoking admin access from{' '}
              <strong>{revokeTarget?.firstName} {revokeTarget?.lastName}</strong> ({revokeTarget?.email}).
              They will become a regular MEMBER.
            </p>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                Reason (required)
              </label>
              <Textarea
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                placeholder="Why is admin access being revoked?"
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => revokeMutation.mutate({ targetUserId: revokeTarget?.id, reason: revokeReason })}
              disabled={revokeReason.length < 10 || revokeMutation.isPending}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
