'use client'

/**
 * Admin — User Profile Drill-Down
 * Route: /admin/users/[id]
 * Access: SUPER_ADMIN only
 *
 * UIGAP-003 FIX: Provides a complete per-user inspection view for platform
 * admins without requiring direct database access.
 *
 * Data shown:
 *  - Full PII profile (name, email, phone, address, DOB, gender)
 *  - Role, status, school, join date, last login
 *  - Wallet balance (coins + diamonds)
 *  - Recent wallet transactions (last 10)
 *  - School memberships
 *  - Active sessions + refresh token count
 *  - Quick actions: change status, revoke sessions, grant coins
 */

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  ArrowLeft, User, Mail, Phone, MapPin, Calendar, Shield, Coins,
  CreditCard, Monitor, LogOut, AlertTriangle, Ban, CheckCircle,
  XCircle, Building2, Clock, RefreshCw, ChevronRight
} from 'lucide-react'
import { getAvatarUrl } from '@/lib/avatar'

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SUSPENDED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  BANNED:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  INACTIVE:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  PENDING:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

const TX_TYPE_STYLE: Record<string, string> = {
  STRIPE_PURCHASE: 'bg-green-100 text-green-800',
  GIFT_SEND:       'bg-blue-100 text-blue-800',
  TIP_SEND:        'bg-purple-100 text-purple-800',
  SUBSCRIPTION:    'bg-indigo-100 text-indigo-800',
  ADMIN_GRANT:     'bg-yellow-100 text-yellow-800',
  REFUND:          'bg-orange-100 text-orange-800',
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500 min-w-32">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-white text-right max-w-64 break-words">
        {value || <span className="text-gray-400 font-normal">—</span>}
      </span>
    </div>
  )
}

export default function AdminUserProfilePage() {
  const params   = useParams()
  const router   = useRouter()
  const userId   = params.id as string
  const authUser = useAuthStore(s => s.user)
  const { toast } = useToast()
  const qc = useQueryClient()
  const isAdmin = authUser?.role === 'SUPER_ADMIN'

  // Status change dialog
  const [statusOpen, setStatusOpen]     = useState(false)
  const [newStatus, setNewStatus]       = useState('')
  const [statusReason, setStatusReason] = useState('')

  // Grant coins dialog
  const [grantOpen, setGrantOpen]       = useState(false)
  const [grantCoins, setGrantCoins]     = useState('')
  const [grantReason, setGrantReason]   = useState('')

  // Session revoke dialog
  const [sessionOpen, setSessionOpen]   = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  // ── Profile query (GET /users/:id — SA gets full PII) ──────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['admin-user-profile', userId],
    queryFn:  () => api.get(`/users/${userId}`).then(r => r.data.data),
    enabled:  isAdmin && !!userId,
  })

  // ── Wallet query ──────────────────────────────────────────────────────────
  const { data: walletData, isLoading: walletLoading } = useQuery({
    queryKey: ['admin-user-wallet', userId],
    queryFn:  () => api.get(`/admin/stats/users/${userId}/wallet`).then(r => r.data.data),
    enabled:  isAdmin && !!userId,
  })

  // ── Sessions query ────────────────────────────────────────────────────────
  const { data: sessionData, isLoading: sessionLoading, refetch: refetchSessions } = useQuery({
    queryKey: ['admin-user-sessions', userId],
    queryFn:  () => api.get(`/admin/actions/users/${userId}/sessions`).then(r => r.data.data),
    enabled:  isAdmin && !!userId,
  })

  // ── Status change mutation ────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: () => api.patch(`/admin/stats/users/${userId}/status`, { status: newStatus, reason: statusReason }),
    onSuccess: () => {
      toast({ title: 'Status updated', description: `User status changed to ${newStatus}` })
      qc.invalidateQueries({ queryKey: ['admin-user-profile', userId] })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setStatusOpen(false)
      setNewStatus('')
      setStatusReason('')
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Grant coins mutation ──────────────────────────────────────────────────
  const grantMutation = useMutation({
    mutationFn: () => api.post(`/admin/actions/users/${userId}/grant-coins`, {
      coins: parseInt(grantCoins, 10), reason: grantReason,
    }),
    onSuccess: (r) => {
      toast({ title: `✅ ${grantCoins} coins granted`, description: r.data.message })
      qc.invalidateQueries({ queryKey: ['admin-user-wallet', userId] })
      setGrantOpen(false)
      setGrantCoins('')
      setGrantReason('')
    },
    onError: (e: any) => toast({ title: 'Grant failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  // ── Session revoke mutation ───────────────────────────────────────────────
  const revokeMutation = useMutation({
    mutationFn: () => api.delete(`/admin/actions/users/${userId}/sessions`, { data: { reason: revokeReason } }),
    onSuccess: (r) => {
      toast({ title: 'Sessions revoked', description: r.data.message })
      refetchSessions()
      setSessionOpen(false)
      setRevokeReason('')
    },
    onError: (e: any) => toast({ title: 'Failed', description: e.response?.data?.message, variant: 'destructive' }),
  })

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access restricted to platform administrators.</p>
      </div>
    )
  }

  if (profileLoading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500">User not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />Go back
        </Button>
      </div>
    )
  }

  const wallet     = walletData?.wallet
  const txs        = walletData?.recentTransactions ?? []
  const memberships = walletData?.schoolMemberships ?? []

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">

      {/* ── Back + Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-gray-500">
          <ArrowLeft className="w-4 h-4 mr-1" />Users
        </Button>
        <ChevronRight className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600 dark:text-gray-400">{profile.firstName} {profile.lastName}</span>
      </div>

      {/* ── Profile Hero ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-5">
            <Avatar className="w-16 h-16 flex-shrink-0">
              <AvatarImage src={getAvatarUrl(profile.avatarUrl)} />
              <AvatarFallback className="text-lg bg-indigo-100 text-indigo-700">
                {profile.firstName?.[0]}{profile.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  {profile.firstName} {profile.lastName}
                </h1>
                {profile.username && (
                  <span className="text-sm text-gray-400">@{profile.username}</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{profile.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[profile.status] ?? ''}`}>
                  {profile.status}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                  {profile.role?.replace(/_/g, ' ')}
                </span>
                {profile.emailVerified && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Verified
                  </span>
                )}
              </div>
            </div>

            {/* Quick actions */}
            {profile.role !== 'SUPER_ADMIN' && (
              <div className="flex flex-col gap-2 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => { setNewStatus(profile.status); setStatusOpen(true) }}>
                  <Shield className="w-3.5 h-3.5 mr-1.5" />Status
                </Button>
                <Button size="sm" variant="outline" className="text-yellow-700 border-yellow-300" onClick={() => setGrantOpen(true)}>
                  <Coins className="w-3.5 h-3.5 mr-1.5" />Grant Coins
                </Button>
                <Button size="sm" variant="outline" className="text-orange-600 border-orange-300" onClick={() => setSessionOpen(true)}>
                  <Monitor className="w-3.5 h-3.5 mr-1.5" />Sessions
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── PII Details ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <User className="w-3.5 h-3.5" />Personal Info
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <InfoRow label="Email"       value={profile.email} />
            <InfoRow label="Phone"       value={profile.phone} />
            <InfoRow label="Date of Birth" value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : null} />
            <InfoRow label="Gender"      value={profile.gender} />
            <InfoRow label="Address"     value={profile.address} />
            <InfoRow label="Bio"         value={profile.bio} />
          </CardContent>
        </Card>

        {/* ── Account Details ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" />Account
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <InfoRow label="User ID"     value={profile.id} />
            <InfoRow label="Role"        value={profile.role?.replace(/_/g, ' ')} />
            <InfoRow label="Status"      value={profile.status} />
            <InfoRow label="School"      value={profile.schoolId ?? undefined} />
            <InfoRow label="Joined"      value={profile.createdAt ? new Date(profile.createdAt).toLocaleString() : null} />
            <InfoRow label="Last Login"  value={profile.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : null} />
          </CardContent>
        </Card>

        {/* ── Wallet ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5" />Wallet
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {walletLoading ? (
              <div className="space-y-2">{Array.from({length:3}).map((_,i) => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}</div>
            ) : wallet ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{wallet.coins?.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Coins</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{wallet.diamonds?.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Diamonds</p>
                  </div>
                </div>

                {/* Recent transactions */}
                {txs.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent Transactions</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {txs.slice(0, 10).map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${TX_TYPE_STYLE[t.type] ?? 'bg-gray-100 text-gray-600'}`}>
                              {t.type?.replace(/_/g, ' ')}
                            </span>
                            <span className="text-gray-400 truncate max-w-28">{t.description || '—'}</span>
                          </div>
                          <span className={`font-mono font-bold flex-shrink-0 ml-2 ${t.coins > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {t.coins > 0 ? '+' : ''}{t.coins}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 py-4 text-center">No wallet data</p>
            )}
          </CardContent>
        </Card>

        {/* ── Sessions ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5" />Active Sessions
              <button onClick={() => refetchSessions()} className="ml-auto text-gray-400 hover:text-gray-600" title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {sessionLoading ? (
              <div className="space-y-2">{Array.from({length:2}).map((_,i) => <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}</div>
            ) : sessionData ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{sessionData.activeSessionCount}</p>
                    <p className="text-xs text-gray-500">Sessions</p>
                  </div>
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                    <p className="text-2xl font-bold text-red-700 dark:text-red-300">{sessionData.activeRefreshTokens}</p>
                    <p className="text-xs text-gray-500">Tokens</p>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {sessionData.sessions?.map((s: any) => (
                    <div key={s.id} className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.deviceName || 'Unknown device'}</span>
                        <span className="text-green-600 font-semibold">Active</span>
                      </div>
                      <p className="text-gray-400 mt-0.5">{s.ipAddress || '—'} · {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '—'}</p>
                    </div>
                  ))}
                  {sessionData.activeSessionCount === 0 && (
                    <p className="text-sm text-gray-400 text-center py-3">No active sessions</p>
                  )}
                </div>
                {profile.role !== 'SUPER_ADMIN' && sessionData.activeSessionCount > 0 && (
                  <Button
                    size="sm" variant="outline"
                    className="w-full mt-3 text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => setSessionOpen(true)}
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1.5" />Revoke All Sessions
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 py-4 text-center">Failed to load sessions</p>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── School Memberships ────────────────────────────────────────── */}
      {memberships.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />School Memberships
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {memberships.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                  <div className="flex items-center gap-3">
                    {m.school?.logoUrl && (
                      <img src={m.school.logoUrl} alt={m.school.name} className="w-6 h-6 rounded object-cover" />
                    )}
                    <div>
                      <p className="font-medium">{m.school?.name ?? m.schoolId}</p>
                      <p className="text-xs text-gray-400">{m.role} · Joined {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[m.status] ?? ''}`}>
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Change Status Dialog ──────────────────────────────────────── */}
      <Dialog open={statusOpen} onOpenChange={open => { if (!open) setStatusOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change User Status</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'].map(s => (
                <button
                  key={s}
                  onClick={() => setNewStatus(s)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    newStatus === s
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  {s === 'ACTIVE' && <CheckCircle className="w-3.5 h-3.5 inline mr-1 text-green-500" />}
                  {s === 'INACTIVE' && <XCircle className="w-3.5 h-3.5 inline mr-1 text-gray-400" />}
                  {s === 'SUSPENDED' && <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-yellow-500" />}
                  {s === 'BANNED' && <Ban className="w-3.5 h-3.5 inline mr-1 text-red-500" />}
                  {s}
                </button>
              ))}
            </div>
            <Textarea
              value={statusReason}
              onChange={e => setStatusReason(e.target.value)}
              placeholder="Reason (optional, for audit trail)"
              rows={2}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button
              onClick={() => statusMutation.mutate()}
              disabled={!newStatus || newStatus === profile.status || statusMutation.isPending}
            >
              {statusMutation.isPending ? 'Saving…' : 'Update Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Grant Coins Dialog ────────────────────────────────────────── */}
      <Dialog open={grantOpen} onOpenChange={open => { if (!open) setGrantOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Grant Coins</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-800 dark:text-yellow-200">
              ⚠️ This is permanently audit logged.
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Coins (1–100,000)</label>
              <Input type="number" min={1} max={100000} value={grantCoins} onChange={e => setGrantCoins(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Reason (min 10 chars)</label>
              <Textarea value={grantReason} onChange={e => setGrantReason(e.target.value)} rows={2} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
              onClick={() => grantMutation.mutate()}
              disabled={!grantCoins || parseInt(grantCoins,10) < 1 || grantReason.length < 10 || grantMutation.isPending}
            >
              {grantMutation.isPending ? 'Granting…' : `Grant ${grantCoins || '?'} Coins`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke Sessions Dialog ────────────────────────────────────── */}
      <Dialog open={sessionOpen} onOpenChange={open => { if (!open) setSessionOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Revoke All Sessions</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-300">
              This logs the user out of all devices immediately. Their account remains active.
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Reason (optional)</label>
              <Input value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="Security incident, account review…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => revokeMutation.mutate()} disabled={revokeMutation.isPending}>
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke All Sessions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
