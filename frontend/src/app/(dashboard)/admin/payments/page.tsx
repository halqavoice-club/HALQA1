'use client'

/**
 * Admin — Payments & Wallet Overview
 * Route: /admin/payments
 * Access: SUPER_ADMIN only
 *
 * Sprint 3 — UIGAP-004: Added Payout Management section
 * Sprint 3 — PAY-GAP-003: Fixed TX_TYPE_STYLE keys to match actual DB values
 * Sprint 8 — PAY-GAP-001/002: Added transaction refund (coin reversal + Stripe)
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  CreditCard, Search, ChevronLeft, ChevronRight, RefreshCw,
  Banknote, CheckCircle, XCircle, Clock, AlertTriangle, RotateCcw, Download
} from 'lucide-react'

// PAY-GAP-003 FIX: Keys now match actual WalletTransaction.type DB values
const TX_TYPE_STYLE: Record<string, string> = {
  STRIPE_PURCHASE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  GIFT_SEND:       'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  TIP_SEND:        'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  SUBSCRIPTION:    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  ADMIN_GRANT:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  REFUND:          'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
}

const PAYOUT_STATUS_STYLE: Record<string, string> = {
  PENDING:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  APPROVED:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  PROCESSING: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  COMPLETED:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  REJECTED:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  CANCELLED:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function AdminPaymentsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const { toast } = useToast()
  const qc = useQueryClient()

  // Wallet transactions section state
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)
  const PAGE = 20

  // Payout management section state
  const [payoutStatus, setPayoutStatus]       = useState('PENDING')
  const [selectedPayout, setSelectedPayout]   = useState<any>(null)
  const [payoutAction, setPayoutAction]       = useState<'approve' | 'reject' | 'complete' | ''>('')
  const [adminNote, setAdminNote]             = useState('')
  const [transactionRef, setTransactionRef]   = useState('')

  // Coin grant section state (UIGAP-005)
  const [grantOpen, setGrantOpen]           = useState(false)
  const [grantUserId, setGrantUserId]       = useState('')
  const [grantUserEmail, setGrantUserEmail] = useState('')
  const [grantCoins, setGrantCoins]         = useState('')
  const [grantReason, setGrantReason]       = useState('')
  const [lookupResult, setLookupResult]     = useState<any>(null)
  const [lookupLoading, setLookupLoading]   = useState(false)

  // Refund section state (PAY-GAP-001/002)
  const [refundTx, setRefundTx]         = useState<any>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundStripe, setRefundStripe] = useState(true)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-payments'],
    queryFn:  () => api.get('/admin/stats/payments').then(r => r.data.data as {
      stats: { totalWallets: number; totalTransactions: number; transactionsLast30d: number }
      recentTransactions: any[]
    }),
    refetchInterval: 60_000,
    enabled: isAdmin,
  })

  // ── Payout requests query ─────────────────────────────────────────────────
  const { data: payoutsData, isLoading: payoutsLoading, refetch: refetchPayouts } = useQuery({
    queryKey: ['admin-payouts', payoutStatus],
    queryFn:  () => api.get('/wallet/payout/admin/list', {
      params: { status: payoutStatus === '__all__' ? undefined : payoutStatus || undefined }
    }).then(r => r.data.data as { payouts: any[]; total: number }),
    enabled: isAdmin,
    refetchInterval: 30_000,
  })

  // ── Process payout mutation ───────────────────────────────────────────────
  const processMutation = useMutation({
    mutationFn: ({ id, action, adminNote, transactionRef }: any) =>
      api.patch(`/wallet/payout/admin/${id}`, { action, adminNote, transactionRef }),
    onSuccess: (_, vars) => {
      toast({ title: `Payout ${vars.action}d`, description: `Payout has been ${vars.action}d.` })
      qc.invalidateQueries({ queryKey: ['admin-payouts'] })
      setSelectedPayout(null)
      setPayoutAction('')
      setAdminNote('')
      setTransactionRef('')
    },
    onError: (e: any) => {
      toast({ title: 'Action failed', description: e.response?.data?.message, variant: 'destructive' })
    }
  })

  // ── Coin grant lookup helper ─────────────────────────────────────────────
  async function lookupUserForGrant() {
    if (!grantUserEmail.trim()) return
    setLookupLoading(true)
    setLookupResult(null)
    try {
      const res = await api.get('/admin/stats/users', { params: { search: grantUserEmail, limit: 5 } })
      const users = res.data.data?.users ?? []
      const match = users.find((u: any) => u.email.toLowerCase() === grantUserEmail.toLowerCase())
      setLookupResult(match || null)
      if (!match) toast({ title: 'User not found', description: `No user with email: ${grantUserEmail}`, variant: 'destructive' })
      else setGrantUserId(match.id)
    } catch {
      toast({ title: 'Lookup failed', variant: 'destructive' })
    } finally {
      setLookupLoading(false)
    }
  }

  // ── Grant coins mutation ────────────────────────────────────────────────
  const grantMutation = { mutate: async (payload: any) => {
    try {
      await api.post(`/admin/actions/users/${payload.userId}/grant-coins`, {
        coins:  payload.coins,
        reason: payload.reason,
      })
      toast({ title: `✅ ${payload.coins} coins granted`, description: `To ${lookupResult?.firstName} ${lookupResult?.lastName}` })
      qc.invalidateQueries({ queryKey: ['admin-payments'] })
      setGrantOpen(false)
      setGrantUserEmail('')
      setGrantUserId('')
      setGrantCoins('')
      setGrantReason('')
      setLookupResult(null)
    } catch (e: any) {
      toast({ title: 'Grant failed', description: e.response?.data?.message, variant: 'destructive' })
    }
  }, isPending: false }

  // ── Refund transaction mutation (PAY-GAP-001/002) ────────────────────────
  const refundMutation = useMutation({
    mutationFn: ({ txId, reason, stripeRefund }: { txId: string; reason: string; stripeRefund: boolean }) =>
      api.post(`/admin/actions/transactions/${txId}/refund`, { reason, stripeRefund }),
    onSuccess: (res, vars) => {
      const d = res.data.data
      const stripeMsg = d.stripeRefund?.refundId
        ? ` · Stripe refund ${d.stripeRefund.refundId}`
        : d.stripeRefund?.error
          ? ` · Stripe failed: ${d.stripeRefund.error}`
          : ''
      toast({
        title: `✅ ${d.coinsRefunded} coins refunded`,
        description: `Transaction ${vars.txId}${stripeMsg}`,
      })
      qc.invalidateQueries({ queryKey: ['admin-payments'] })
      setRefundTx(null)
      setRefundReason('')
      setRefundStripe(true)
    },
    onError: (e: any) => {
      toast({ title: 'Refund failed', description: e.response?.data?.message ?? e.message, variant: 'destructive' })
    },
  })

  const txs = (data?.recentTransactions ?? []).filter((t: any) => {
    if (!search) return true
    const name = `${t.wallet?.user?.firstName} ${t.wallet?.user?.lastName} ${t.wallet?.user?.email}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })
  const paginated = txs.slice((page - 1) * PAGE, page * PAGE)
  const pages     = Math.ceil(txs.length / PAGE)
  const payouts   = payoutsData?.payouts ?? []
  const pendingCount = payouts.filter((p: any) => p.status === 'PENDING').length

  // Access guard — placed after ALL hooks to comply with React rules-of-hooks
  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments & Wallets</h1>
            <p className="text-sm text-gray-500">Platform-wide transaction history and payout management</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => { refetch(); refetchPayouts() }} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {/* ── Wallet Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Wallets',        value: data?.stats?.totalWallets       ?? 0 },
          { label: 'Total Transactions',   value: data?.stats?.totalTransactions  ?? 0 },
          { label: 'Transactions (30d)',   value: data?.stats?.transactionsLast30d ?? 0 },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{s.label}</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{s.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── PAYOUT MANAGEMENT (Sprint 3 — UIGAP-004 fix) ───────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Banknote className="w-5 h-5 text-orange-500" />
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Payout Requests</h2>
              <p className="text-xs text-gray-500">Diamond withdrawal requests from hosts</p>
            </div>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
              <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-300">
                {pendingCount} pending
              </span>
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">Status:</span>
          <Select value={payoutStatus} onValueChange={v => setPayoutStatus(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="__all__">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Payout table */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {payoutsLoading ? (
            <div>{Array.from({length:5}).map((_,i) => <div key={i} className="h-14 border-b border-gray-100 dark:border-gray-800 animate-pulse bg-gray-50 dark:bg-gray-800/50"/>)}</div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Banknote className="w-8 h-8 mx-auto mb-2 opacity-40"/>
              <p className="text-sm">No {payoutStatus === '__all__' ? '' : payoutStatus.toLowerCase() + ' '}payout requests</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Host</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Diamonds</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">USD</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Method</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Requested</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {payouts.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-xs">{p.user?.firstName} {p.user?.lastName}</p>
                      <p className="text-xs text-gray-400 truncate max-w-32">{p.user?.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{p.diamonds?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-700 dark:text-green-400">${p.usdAmount?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-500 capitalize text-xs">{p.method?.replace(/_/g,' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAYOUT_STATUS_STYLE[p.status] ?? ''}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(p.status === 'PENDING' || p.status === 'APPROVED' || p.status === 'PROCESSING') && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setSelectedPayout(p); setPayoutAction('') }}
                        >
                          Manage
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Recent Transactions ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Recent Wallet Transactions</h2>
          <div className="flex items-center gap-2">
            {/* UIGAP-011 FIX: CSV export for transactions */}
            <a
              href="/api/v1/admin/stats/export/transactions"
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              title="Export transactions as CSV"
            >
              <Download className="w-3.5 h-3.5" />Export CSV
            </a>
            <Button
              size="sm" variant="outline"
              className="text-yellow-700 border-yellow-300 hover:bg-yellow-50 dark:text-yellow-300 dark:border-yellow-700"
              onClick={() => setGrantOpen(true)}
            >
              + Grant Coins
            </Button>
          </div>
        </div>

        <div className="relative max-w-sm mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Search by user name or email…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading ? (
            <div>{Array.from({length:8}).map((_,i) => <div key={i} className="h-12 border-b border-gray-100 dark:border-gray-800 animate-pulse bg-gray-50 dark:bg-gray-800/50"/>)}</div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-40"/>
              <p>No transactions found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">User</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Type</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Coins</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Description</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((t: any) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <p className="font-medium text-xs">{t.wallet?.user?.firstName} {t.wallet?.user?.lastName}</p>
                      <p className="text-xs text-gray-400 truncate max-w-32">{t.wallet?.user?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TX_TYPE_STYLE[t.type] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                        {t.type?.replace(/_/g,' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      <span className={t.coins > 0 ? 'text-green-600' : 'text-red-500'}>
                        {t.coins > 0 ? '+' : ''}{t.coins?.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-48 hidden md:table-cell">{t.description || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* PAY-GAP-001/002 FIX: Only show refund for refundable types */}
                      {(t.type === 'STRIPE_PURCHASE' || t.type === 'ADMIN_GRANT') && t.coins > 0 && (
                        <Button
                          size="sm" variant="outline"
                          className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 text-xs px-2 py-1 h-7"
                          onClick={() => { setRefundTx(t); setRefundReason(''); setRefundStripe(true) }}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500 mt-4">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page<=1}><ChevronLeft className="w-4 h-4"/></Button>
              <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pages,p+1))} disabled={page>=pages}><ChevronRight className="w-4 h-4"/></Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Payout action dialog ─────────────────────────────────────────── */}
      {/* ── Grant Coins dialog (UIGAP-005) ──────────────────────────────── */}
      <Dialog open={grantOpen} onOpenChange={open => { if (!open) { setGrantOpen(false); setLookupResult(null); setGrantUserEmail(''); setGrantUserId(''); setGrantCoins(''); setGrantReason('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Grant Coins to User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-xs text-yellow-800 dark:text-yellow-200">
              ⚠️ This action credits coins directly to a user's wallet. It is permanently audited. Use for compensation or corrections only.
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">User Email</label>
              <div className="flex gap-2">
                <Input value={grantUserEmail} onChange={e => { setGrantUserEmail(e.target.value); setLookupResult(null) }} placeholder="user@example.com" type="email" />
                <Button variant="outline" onClick={lookupUserForGrant} disabled={lookupLoading || !grantUserEmail}>
                  {lookupLoading ? '…' : 'Find'}
                </Button>
              </div>
            </div>
            {lookupResult && (
              <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center text-sm font-bold text-green-700">
                  {lookupResult.firstName?.[0]}{lookupResult.lastName?.[0]}
                </div>
                <div>
                  <p className="font-semibold text-sm">{lookupResult.firstName} {lookupResult.lastName}</p>
                  <p className="text-xs text-gray-500">{lookupResult.email} · {lookupResult.role}</p>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Coins to Grant (1–100,000)</label>
              <Input type="number" min={1} max={100000} value={grantCoins} onChange={e => setGrantCoins(e.target.value)} placeholder="e.g. 1000" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Reason (required, min 10 chars)</label>
              <Textarea value={grantReason} onChange={e => setGrantReason(e.target.value)} placeholder="Why are these coins being granted?" rows={2} maxLength={500} />
              <p className="text-xs text-gray-400 mt-1">{grantReason.length}/500</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
              onClick={() => grantMutation.mutate({ userId: grantUserId, coins: parseInt(grantCoins, 10), reason: grantReason })}
              disabled={!lookupResult || !grantCoins || parseInt(grantCoins,10) < 1 || grantReason.length < 10 || grantMutation.isPending}
            >
              {grantMutation.isPending ? 'Granting…' : `Grant ${grantCoins || '?'} Coins`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>      <Dialog open={!!selectedPayout} onOpenChange={open => !open && setSelectedPayout(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Payout Request</DialogTitle>
          </DialogHeader>
          {selectedPayout && (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Host</span>
                  <span className="font-medium">{selectedPayout.user?.firstName} {selectedPayout.user?.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Diamonds</span>
                  <span className="font-mono font-medium">{selectedPayout.diamonds?.toLocaleString()} 💎</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">USD Amount</span>
                  <span className="font-mono text-green-700 dark:text-green-400 font-medium">${selectedPayout.usdAmount?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Method</span>
                  <span className="capitalize">{selectedPayout.method?.replace(/_/g,' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAYOUT_STATUS_STYLE[selectedPayout.status] ?? ''}`}>
                    {selectedPayout.status}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Action</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: 'approve',  label: 'Approve',  icon: CheckCircle,  color: 'blue' },
                    { val: 'complete', label: 'Complete', icon: CheckCircle,  color: 'green' },
                    { val: 'reject',   label: 'Reject',   icon: XCircle,      color: 'red' },
                  ].filter(a => {
                    if (selectedPayout.status === 'PENDING') return a.val !== 'complete'
                    if (selectedPayout.status === 'APPROVED' || selectedPayout.status === 'PROCESSING') return a.val !== 'approve'
                    return true
                  }).map(opt => {
                    const Icon = opt.icon
                    const isSelected = payoutAction === opt.val
                    const colorMap: Record<string, string> = {
                      blue:  'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                      green: 'border-green-400 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                      red:   'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                    }
                    return (
                      <button
                        key={opt.val}
                        onClick={() => setPayoutAction(opt.val as any)}
                        className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                          isSelected ? colorMap[opt.color] : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-500'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {payoutAction === 'complete' && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                    Transaction Reference (required for complete)
                  </label>
                  <Input
                    value={transactionRef}
                    onChange={e => setTransactionRef(e.target.value)}
                    placeholder="Bank ref / PayPal ID / Stripe transfer ID"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                  Admin Note (optional)
                </label>
                <Textarea
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  placeholder="Internal note about this decision…"
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedPayout(null)}>Cancel</Button>
            <Button
              variant={payoutAction === 'reject' ? 'destructive' : 'default'}
              onClick={() => processMutation.mutate({
                id:             selectedPayout?.id,
                action:         payoutAction,
                adminNote:      adminNote || undefined,
                transactionRef: payoutAction === 'complete' ? transactionRef : undefined,
              })}
              disabled={!payoutAction || (payoutAction === 'complete' && !transactionRef) || processMutation.isPending}
            >
              {processMutation.isPending ? 'Processing…' : payoutAction ? `${payoutAction.charAt(0).toUpperCase() + payoutAction.slice(1)} Payout` : 'Select action'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Refund Transaction Dialog (PAY-GAP-001/002) ──────────────── */}
      <Dialog open={!!refundTx} onOpenChange={open => { if (!open) { setRefundTx(null); setRefundReason(''); setRefundStripe(true) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-orange-500" />
              Refund Transaction
            </DialogTitle>
          </DialogHeader>
          {refundTx && (
            <div className="space-y-4">
              {/* Warning banner */}
              <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-xs text-orange-800 dark:text-orange-200 space-y-1">
                <p className="font-semibold">⚠️ This action is irreversible once submitted.</p>
                <p>The user's wallet will be debited {Math.abs(refundTx.coins)} coins. A REFUND ledger entry will be created and this action will be audit logged.</p>
              </div>

              {/* Transaction summary */}
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Transaction ID</span>
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{refundTx.id?.slice(0, 16)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TX_TYPE_STYLE[refundTx.type] ?? ''}`}>
                    {refundTx.type?.replace(/_/g,' ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">User</span>
                  <span className="font-medium text-xs">{refundTx.wallet?.user?.firstName} {refundTx.wallet?.user?.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Coins</span>
                  <span className="font-mono font-bold text-green-700 dark:text-green-400">+{refundTx.coins?.toLocaleString()}</span>
                </div>
                {refundTx.stripeSessionId && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Stripe Session</span>
                    <span className="font-mono text-xs text-gray-500">{refundTx.stripeSessionId?.slice(0, 20)}…</span>
                  </div>
                )}
              </div>

              {/* Stripe refund toggle — only for STRIPE_PURCHASE */}
              {refundTx.type === 'STRIPE_PURCHASE' && refundTx.stripeSessionId && (
                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Issue Stripe refund</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">Refund the real-money payment via Stripe</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRefundStripe(r => !r)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${refundStripe ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    aria-pressed={refundStripe}
                    aria-label="Toggle Stripe refund"
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${refundStripe ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  Reason <span className="text-red-500">*</span> (min 10 chars)
                </label>
                <Textarea
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  placeholder="Why is this transaction being refunded?"
                  rows={2}
                  maxLength={500}
                />
                <p className="text-xs text-gray-400 mt-1">{refundReason.length}/500</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTx(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => refundTx && refundMutation.mutate({
                txId:         refundTx.id,
                reason:       refundReason,
                stripeRefund: refundStripe,
              })}
              disabled={refundReason.trim().length < 10 || refundMutation.isPending}
            >
              {refundMutation.isPending ? 'Refunding…' : `Refund ${refundTx?.coins ?? '?'} Coins`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
