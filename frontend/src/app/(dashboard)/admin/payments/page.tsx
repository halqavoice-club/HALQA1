'use client'

/**
 * Admin — Payments & Wallet Overview
 * Route: /admin/payments
 * Access: SUPER_ADMIN only
 * Data: GET /api/v1/admin/stats/payments
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CreditCard, Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TX_TYPE_STYLE: Record<string, string> = {
  PURCHASE:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SPEND:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  EARN:      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  REFUND:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  WITHDRAWAL:'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
}

export default function AdminPaymentsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)
  const PAGE = 20

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-payments'],
    queryFn:  () => api.get('/admin/stats/payments').then(r => r.data.data as {
      stats: { totalWallets: number; totalTransactions: number; transactionsLast30d: number }
      recentTransactions: any[]
    }),
    refetchInterval: 60_000,
    enabled: isAdmin,
  })

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  const txs = (data?.recentTransactions ?? []).filter((t: any) => {
    if (!search) return true
    const name = `${t.wallet?.user?.firstName} ${t.wallet?.user?.lastName} ${t.wallet?.user?.email}`.toLowerCase()
    return name.includes(search.toLowerCase())
  })
  const paginated = txs.slice((page - 1) * PAGE, page * PAGE)
  const pages     = Math.ceil(txs.length / PAGE)

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments & Wallets</h1>
            <p className="text-sm text-gray-500">Platform-wide transaction history</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {/* Stats */}
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search by user name or email…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} className="pl-9" />
      </div>

      {/* Table */}
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
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Amount</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Description</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Date</th>
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TX_TYPE_STYLE[t.type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {t.amount > 0 ? '+' : ''}{t.amount?.toLocaleString()}
                    {t.currency && <span className="text-xs text-gray-400 ml-1">{t.currency}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-48 hidden md:table-cell">{t.description || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page<=1}><ChevronLeft className="w-4 h-4"/></Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(pages,p+1))} disabled={page>=pages}><ChevronRight className="w-4 h-4"/></Button>
          </div>
        </div>
      )}
    </div>
  )
}
