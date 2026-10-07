'use client'

import { useState, useEffect, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { useSearchParams } from 'next/navigation'
import { getSocket } from '@/lib/socket'
import { cn } from '@/lib/utils'
import {
  Coins, Gift,
  Sparkles, CheckCircle, Loader2, History, Wallet, ExternalLink,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface WalletData {
  coins:       number
  diamonds:    number
  totalSpent:  number
  totalEarned: number
}

// Matches the actual DB schema: id, name, coins, priceUsd, bonusCoins, isActive, sortOrder
interface CoinPackage {
  id:         string
  name:       string
  coins:      number
  bonusCoins: number
  priceUsd:   number   // Decimal from DB comes as string/number — normalise below
  isActive:   boolean
  sortOrder:  number
}

// Unified WalletTransaction shape returned by GET /wallet/history
interface WalletTx {
  id:          string
  type:        string
  coins:       number
  diamonds:    number
  description: string | null
  createdAt:   string
  // GIFT_SEND enrichment (optional)
  giftDetails?: {
    gift:     { name: string; emoji: string; priceCoins: number }
    receiver: { id: string; firstName: string; lastName: string; avatarUrl?: string | null }
  }
  packageId?: string | null
}

interface HistoryResponse {
  data:       WalletTx[]
  pagination: { page: number; limit: number; total: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString() }

function fmtPrice(raw: number | string | undefined): string {
  if (raw == null) return '0.00'
  return Number(raw).toFixed(2)
}

// Heuristic badge based on package position / bonus ratio
function getBadge(pkg: CoinPackage, allPkgs: CoinPackage[]): string | null {
  if (allPkgs.length === 0) return null
  const sorted = [...allPkgs].sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd))
  const idx = sorted.findIndex(p => p.id === pkg.id)
  if (idx === sorted.length - 1) return 'Best Value'
  if (pkg.bonusCoins > 0 && pkg.bonusCoins >= pkg.coins * 0.3) return 'Popular'
  return null
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Package card ─────────────────────────────────────────────────────────────
function PackageCard({
  pkg, badge, onBuy, loading,
}: {
  pkg: CoinPackage; badge: string | null
  onBuy: (id: string) => void; loading: boolean
}) {
  const total    = pkg.coins + pkg.bonusCoins
  const hasBadge = !!badge

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={cn(
        'relative bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all overflow-hidden',
        hasBadge ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'
      )}
    >
      {hasBadge && (
        <div className="absolute top-0 right-0 bg-amber-400 text-white text-[10px] font-black px-2 py-0.5 rounded-bl-xl">
          {badge}
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Coin + amount */}
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center text-2xl',
            hasBadge ? 'bg-amber-50' : 'bg-indigo-50'
          )}>
            🪙
          </div>
          <div>
            <p className="font-black text-xl text-gray-900">{fmt(pkg.coins)}</p>
            <p className="text-xs text-gray-400">coins</p>
          </div>
        </div>

        {/* Bonus */}
        {pkg.bonusCoins > 0 && (
          <div className="flex items-center gap-1.5 bg-green-50 border border-green-100 rounded-xl px-3 py-1.5">
            <Sparkles className="w-3 h-3 text-green-500" />
            <span className="text-xs font-bold text-green-600">+{fmt(pkg.bonusCoins)} bonus!</span>
            <span className="text-xs text-gray-400 ml-auto">{fmt(total)} total</span>
          </div>
        )}

        {/* Package name */}
        <p className="text-sm font-semibold text-gray-700">{pkg.name}</p>

        {/* Buy button */}
        <button
          onClick={() => onBuy(pkg.id)}
          disabled={loading}
          className={cn(
            'w-full py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1',
            hasBadge
              ? 'bg-amber-400 hover:bg-amber-500 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white',
            loading && 'opacity-60 cursor-not-allowed'
          )}
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <><span>${fmtPrice(pkg.priceUsd)}</span><ExternalLink className="w-3 h-3 opacity-60" /></>
          }
        </button>
      </div>
    </motion.div>
  )
}

// ─── Tx row — handles ALL WalletTransaction types ────────────────────────────
const TX_META: Record<string, { icon: string; label: string; bgClass: string }> = {
  STRIPE_PURCHASE:    { icon: '💳', label: 'Coin Purchase',      bgClass: 'bg-blue-50'   },
  GIFT_SEND:          { icon: '🎁', label: 'Gift Sent',          bgClass: 'bg-red-50'    },
  GIFT_RECEIVE:       { icon: '🎁', label: 'Gift Received',      bgClass: 'bg-green-50'  },
  TIP_SEND:           { icon: '💸', label: 'Tip Sent',           bgClass: 'bg-red-50'    },
  TIP_RECEIVE:        { icon: '💰', label: 'Tip Received',       bgClass: 'bg-green-50'  },
  SUBSCRIPTION:       { icon: '⭐', label: 'Subscription',       bgClass: 'bg-purple-50' },
  SUBSCRIPTION_RECEIVE:{ icon: '⭐', label: 'Subscription Income', bgClass: 'bg-green-50'},
  ADMIN_GRANT:        { icon: '🛡️', label: 'Admin Grant',        bgClass: 'bg-indigo-50' },
  REFUND:             { icon: '↩️', label: 'Refund',             bgClass: 'bg-yellow-50' },
  PAYOUT:             { icon: '💎', label: 'Payout Request',     bgClass: 'bg-orange-50' },
  PAYOUT_REVERSAL:    { icon: '💎', label: 'Payout Reversed',    bgClass: 'bg-green-50'  },
  DISPUTED:           { icon: '⚠️', label: 'Disputed',           bgClass: 'bg-red-50'    },
}

function TxRow({ tx }: { tx: WalletTx }) {
  const meta  = TX_META[tx.type] ?? { icon: '🪙', label: tx.type, bgClass: 'bg-gray-50' }

  // Determine display icon — for gifts use gift emoji when available
  const displayEmoji = (tx.type === 'GIFT_SEND' || tx.type === 'GIFT_RECEIVE')
    ? (tx.giftDetails?.gift?.emoji ?? meta.icon)
    : meta.icon

  // Determine the primary display label
  const displayLabel = tx.type === 'GIFT_SEND' && tx.giftDetails
    ? `${tx.giftDetails.gift.name} → ${tx.giftDetails.receiver.firstName} ${tx.giftDetails.receiver.lastName}`
    : (tx.description ?? meta.label)

  // Determine the amount to show and its sign/currency
  const isDebit     = tx.coins < 0 || tx.diamonds < 0
  const isCredit    = tx.coins > 0 || tx.diamonds > 0
  const coinAmt     = Math.abs(tx.coins)
  const diamondAmt  = Math.abs(tx.diamonds)
  const showCoins   = coinAmt > 0
  const showDiamonds = diamondAmt > 0

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0',
        meta.bgClass
      )}>
        {displayEmoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate">{meta.label}</p>
        <p className="text-[11px] text-gray-400 truncate">{displayLabel}</p>
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        {showCoins && (
          <p className={cn('text-xs font-bold', isDebit && tx.coins < 0 ? 'text-red-500' : 'text-green-500')}>
            {tx.coins < 0 ? '-' : '+'}{fmt(coinAmt)}
            <span className="text-gray-400 font-normal"> 🪙</span>
          </p>
        )}
        {showDiamonds && (
          <p className={cn('text-xs font-bold', tx.diamonds < 0 ? 'text-red-500' : 'text-green-500')}>
            {tx.diamonds < 0 ? '-' : '+'}{fmt(diamondAmt)}
            <span className="text-gray-400 font-normal"> 💎</span>
          </p>
        )}
        {!showCoins && !showDiamonds && (
          <p className="text-xs text-gray-400">—</p>
        )}
        <p className="text-[10px] text-gray-400">{timeAgo(tx.createdAt)}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function WalletContent() {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [activeTab,   setActiveTab]   = useState<'buy' | 'history'>('buy')
  const [purchasedId, setPurchasedId] = useState<string | null>(null)

  // ── Handle Stripe return URLs ────────────────────────────────────────────────
  useEffect(() => {
    const payment = searchParams.get('payment')
    if (payment === 'success') {
      toast({ title: '🎉 Payment successful! Coins will appear shortly.' })
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] })
    } else if (payment === 'cancelled') {
      toast({ title: 'Payment cancelled', variant: 'destructive' })
    }
  }, [searchParams, toast, queryClient])

  // ── Real-time coin credit from Stripe webhook ────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.emit('wallet:join')

    const onCredited = (d: { coins: number }) => {
      toast({ title: `✅ ${d.coins.toLocaleString()} coins added to your wallet!` })
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] })
      // F-09: also invalidate history so the new transaction shows without a tab switch
      queryClient.invalidateQueries({ queryKey: ['wallet-history'] })
    }
    socket.on('wallet:coins_credited', onCredited)

    return () => {
      socket.emit('wallet:leave')
      socket.off('wallet:coins_credited', onCredited)
    }
  }, [toast, queryClient])

  const { data: wallet, isLoading: loadingWallet } = useQuery<WalletData>({
    queryKey: ['wallet-me'],
    queryFn:  () => api.get('/wallet/me').then(r => r.data.data),
  })

  const { data: packages = [], isLoading: loadingPkgs } = useQuery<CoinPackage[]>({
    queryKey: ['coin-packages'],
    queryFn:  () => api.get('/wallet/packages').then(r => r.data.data ?? []),
    staleTime: 5 * 60 * 1000,
  })

  const { data: history, isLoading: loadingHistory } = useQuery<HistoryResponse>({
    queryKey: ['wallet-history'],
    // Backend: GET /wallet/history → successResponse(res, { data: [...], pagination: {...} })
    // successResponse wraps in { success, message, data: <payload>, timestamp }
    // So r.data.data = { data: WalletTx[], pagination: {...} }
    queryFn:  () => api.get('/wallet/history').then(r => r.data.data as HistoryResponse),
    enabled:  activeTab === 'history',
  })

  const purchaseMutation = useMutation({
    mutationFn: async (packageId: string) => {
      // Try Stripe Checkout first — backend returns 503 if not configured
      try {
        const r = await api.post('/stripe/checkout', { packageId })
        const { checkoutUrl } = r.data.data
        if (checkoutUrl) {
          // Redirect to Stripe Checkout
          window.location.href = checkoutUrl
          return { mode: 'stripe' }
        }
      } catch (err: any) {
        if (err?.response?.status !== 503) throw err
        // 503 = Stripe not configured — fall through to dev mode
      }
      // Dev mode fallback: credit coins instantly
      return api.post('/wallet/purchase', { packageId }).then(r => ({ mode: 'dev', ...r.data.data }))
    },
    onSuccess: (data: any, packageId) => {
      if (data?.mode === 'stripe') return  // redirect already happening
      const { purchased } = data
      setPurchasedId(packageId)
      setTimeout(() => setPurchasedId(null), 2000)
      toast({ title: `🎉 ${fmt(purchased.total)} coins added to your wallet!` })
      queryClient.invalidateQueries({ queryKey: ['wallet-me'] })
    },
    onError: (e: any) => toast({
      title: e?.response?.data?.message || 'Purchase failed',
      variant: 'destructive',
    }),
  })

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
          <Wallet className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
          <p className="text-gray-500 text-sm">Buy coins · send gifts in Voice Club &amp; Live Class</p>
        </div>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 text-white shadow-lg">
        <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wide mb-3">
          {user?.firstName} {user?.lastName}
        </p>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🪙</span>
            <div>
              <p className="text-3xl font-black">
                {loadingWallet ? '…' : fmt(wallet?.coins ?? 0)}
              </p>
              <p className="text-indigo-200 text-xs">Coins</p>
            </div>
          </div>
          <div className="h-12 w-px bg-white/20" />
          <div className="flex items-center gap-2">
            <span className="text-3xl">💎</span>
            <div>
              <p className="text-3xl font-black">
                {loadingWallet ? '…' : fmt(wallet?.diamonds ?? 0)}
              </p>
              <p className="text-indigo-200 text-xs">Diamonds</p>
            </div>
          </div>
        </div>

        {wallet && (
          <div className="flex gap-4 mt-4 pt-4 border-t border-white/20 text-xs text-indigo-200">
            <span className="flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-red-300" />
              {fmt(wallet.totalSpent)} spent
            </span>
            <span className="flex items-center gap-1">
              <ArrowDownLeft className="w-3 h-3 text-green-300" />
              {fmt(wallet.totalEarned)} earned
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        {[
          { id: 'buy',     label: '🛒 Buy Coins' },
          { id: 'history', label: '📋 History'   },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'buy' | 'history')}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Buy coins ── */}
      {activeTab === 'buy' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            <Coins className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>
                {process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
                 !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.includes('REPLACE')
                  ? '💳 Secure payment via Stripe.'
                  : '🧪 Dev mode:'}
              </strong>
              {' '}
              {process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
               !process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.includes('REPLACE')
                ? 'You will be redirected to Stripe Checkout to complete your purchase.'
                : 'Coins are credited instantly. Add Stripe keys to enable real payments.'}
            </span>
          </div>

          {loadingPkgs ? (
            <div className="grid grid-cols-2 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : packages.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Coins className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No packages available</p>
              <p className="text-xs mt-1 text-gray-300">
                Run <code className="bg-gray-100 px-1 rounded text-gray-500">node src/prisma/seed-coins.js</code> in the backend to add packages.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {packages.map(pkg => {
                const badge = getBadge(pkg, packages)
                return (
                  <div key={pkg.id} className="relative">
                    <PackageCard
                      pkg={pkg}
                      badge={badge}
                      loading={purchaseMutation.isPending && purchaseMutation.variables === pkg.id}
                      onBuy={id => purchaseMutation.mutate(id)}
                    />
                    <AnimatePresence>
                      {purchasedId === pkg.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="absolute inset-0 bg-green-500/90 rounded-2xl flex flex-col items-center justify-center gap-2"
                        >
                          <CheckCircle className="w-10 h-10 text-white" />
                          <p className="text-white text-xs font-bold">Added!</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-50 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">Transaction History</span>
          </div>

          {loadingHistory ? (
            <div className="p-6 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : !history || !history.data || history.data.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Gift className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No transactions yet</p>
              <p className="text-xs mt-1">Send a gift in a Voice Club room to get started</p>
            </div>
          ) : (
            <div className="px-4 py-2">
              {history.data.map(tx => <TxRow key={tx.id} tx={tx} />)}
              {history.pagination.total > history.data.length && (
                <p className="text-center text-xs text-gray-400 py-3">
                  Showing {history.data.length} of {history.pagination.total} transactions
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
// ─── Suspense boundary (required for useSearchParams in Next.js 14) ──────────
export default function WalletPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl space-y-5">
        <div className="h-10 w-48 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-36 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    }>
      <WalletContent />
    </Suspense>
  )
}
