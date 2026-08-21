'use client'

/**
 * Admin — Gifts & Coins Economy
 * Route: /admin/gifts
 * Access: SUPER_ADMIN only
 * Data: GET /api/v1/admin/stats/gifts
 */

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Gift, RefreshCw, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveMediaUrl } from '@/lib/media'

export default function AdminGiftsPage() {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'SUPER_ADMIN'

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-gifts'],
    queryFn:  () => api.get('/admin/stats/gifts').then(r => r.data.data as {
      stats: { total: number; last7d: number; last30d: number; catalogSize: number }
      recentTransactions: any[]
      catalog: any[]
    }),
    refetchInterval: 60_000,
    enabled: isAdmin,
  })

  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access restricted.</p></div>

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gift className="w-6 h-6 text-pink-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gifts & Coins</h1>
            <p className="text-sm text-gray-500">Platform gift economy overview</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Gifts Sent',  value: data?.stats?.total        ?? 0 },
          { label: 'Gifts (7 days)',    value: data?.stats?.last7d       ?? 0 },
          { label: 'Gifts (30 days)',   value: data?.stats?.last30d      ?? 0 },
          { label: 'Gift Catalog Size', value: data?.stats?.catalogSize  ?? 0 },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{s.label}</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{s.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gift Catalog */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-500" />
            Gift Catalog ({data?.catalog?.length ?? 0} items)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
              {Array.from({length:8}).map((_,i) => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse"/>)}
            </div>
          ) : (data?.catalog?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No gift catalog data</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
              {data?.catalog?.map((g: any) => (
                <div key={g.id} className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-center">
                  {g.imageUrl ? (
                    <img src={resolveMediaUrl(g.imageUrl)} alt={g.name} className="w-10 h-10 object-contain mb-1.5" />
                  ) : (
                    <div className="w-10 h-10 bg-pink-100 dark:bg-pink-900/30 rounded-lg flex items-center justify-center mb-1.5 text-xl">
                      {g.emoji ?? '🎁'}
                    </div>
                  )}
                  <p className="text-xs font-medium truncate w-full">{g.name}</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 font-mono">{g.coinCost}c</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Gift Transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Gift Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div>{Array.from({length:5}).map((_,i) => <div key={i} className="h-10 mb-1 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"/>)}</div>
          ) : (data?.recentTransactions?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No recent gift transactions</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {data?.recentTransactions?.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-6 h-6 bg-pink-100 dark:bg-pink-900/30 rounded flex items-center justify-center text-xs flex-shrink-0">
                      {t.gift?.emoji ?? '🎁'}
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium truncate">{t.sender?.firstName} {t.sender?.lastName}</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="truncate">{t.receiver?.firstName} {t.receiver?.lastName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-500">{t.gift?.name}</span>
                    <span className="text-xs font-mono text-yellow-600 dark:text-yellow-400">×{t.count ?? 1}</span>
                    <span className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
