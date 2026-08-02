'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { creatorApi, type CreatorTier } from '@/lib/creator'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sparkles, TrendingUp, Users, Coins, Diamond,
  Plus, Edit2, Check, X, Loader2, BadgeCheck,
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

function fmt(n: number) { return n.toLocaleString() }

// ─── Tier card ────────────────────────────────────────────────────────────────
function TierCard({ tier, onEdit }: { tier: CreatorTier; onEdit: (t: CreatorTier) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-bold text-gray-900 text-sm">{tier.name}</h3>
          {tier.description && <p className="text-xs text-gray-500 mt-0.5">{tier.description}</p>}
        </div>
        <button onClick={() => onEdit(tier)}
          className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors flex-shrink-0">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1 text-indigo-600 font-bold text-sm mb-2">
        <span className="text-base">🪙</span> {fmt(tier.priceCoins)} coins / month
      </div>
      {tier.perks && tier.perks.length > 0 && (
        <ul className="space-y-0.5">
          {tier.perks.map((p, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
              <Check className="w-3 h-3 text-green-500 flex-shrink-0" /> {p}
            </li>
          ))}
        </ul>
      )}
      {!tier.isActive && (
        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full mt-2 inline-block">Inactive</span>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CreatorPage() {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [editingTier, setEditingTier]   = useState<CreatorTier | null>(null)
  const [showNewTier, setShowNewTier]   = useState(false)
  const [tierForm, setTierForm]         = useState({ name: '', description: '', priceCoins: 100, perks: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['creator-dashboard'],
    queryFn:  () => creatorApi.getDashboard().then(r => r.data.data),
  })

  const becomeMutation = useMutation({
    mutationFn: () => creatorApi.become({ displayName: `${user?.firstName} ${user?.lastName}` }),
    onSuccess: () => { toast({ title: '🎉 Creator profile created!' }); queryClient.invalidateQueries({ queryKey: ['creator-dashboard'] }) },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const createTierMutation = useMutation({
    mutationFn: () => creatorApi.createTier({
      name: tierForm.name,
      description: tierForm.description || undefined,
      priceCoins: tierForm.priceCoins,
      perks: tierForm.perks ? tierForm.perks.split('\n').filter(Boolean) : undefined
    }),
    onSuccess: () => { toast({ title: '✅ Tier created!' }); setShowNewTier(false); setTierForm({ name: '', description: '', priceCoins: 100, perks: '' }); queryClient.invalidateQueries({ queryKey: ['creator-dashboard'] }) },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const updateTierMutation = useMutation({
    mutationFn: () => creatorApi.updateTier(editingTier!.id, {
      name: tierForm.name, description: tierForm.description || undefined,
      priceCoins: tierForm.priceCoins,
      perks: tierForm.perks ? tierForm.perks.split('\n').filter(Boolean) : []
    }),
    onSuccess: () => { toast({ title: '✅ Tier updated!' }); setEditingTier(null); queryClient.invalidateQueries({ queryKey: ['creator-dashboard'] }) },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  // Not yet a creator
  if (!isLoading && (!data || !data.profile)) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
          <Sparkles className="w-10 h-10 text-indigo-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Become a Creator</h1>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">
          Create subscription tiers, post exclusive content, and receive tips from your supporters.
        </p>
        <button onClick={() => becomeMutation.mutate()} disabled={becomeMutation.isPending}
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold rounded-2xl transition-colors">
          {becomeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Activate Creator Mode
        </button>
      </div>
    )
  }

  if (isLoading) return (
    <div className="max-w-2xl space-y-4">
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
    </div>
  )

  const { profile, wallet, stats, recentTips, recentSubs } = data!

  const openEditTier = (t: CreatorTier) => {
    setEditingTier(t)
    setTierForm({ name: t.name, description: t.description || '', priceCoins: t.priceCoins, perks: (t.perks || []).join('\n') })
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Creator Studio</h1>
            <p className="text-sm text-gray-400">{profile.displayName || `${user?.firstName} ${user?.lastName}`}</p>
          </div>
          {profile.isVerified && <BadgeCheck className="w-5 h-5 text-indigo-500" />}
        </div>
        <Link href={`/social/profile/${user?.id}`}
          className="text-xs text-indigo-600 hover:underline">View profile →</Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Diamonds', value: fmt(wallet.diamonds), icon: '💎', color: 'bg-blue-50 text-blue-700' },
          { label: 'Subscribers', value: fmt(stats.activeSubs), icon: '👥', color: 'bg-indigo-50 text-indigo-700' },
          { label: 'Tips (30d)', value: fmt(stats.tipsLast30d), icon: '💰', color: 'bg-green-50 text-green-700' },
          { label: 'Total earned', value: fmt(stats.totalEarned), icon: '✨', color: 'bg-purple-50 text-purple-700' },
        ].map(s => (
          <div key={s.label} className={cn('rounded-2xl p-4 text-center', s.color, 'border border-current/10')}>
            <p className="text-2xl font-black">{s.icon} {s.value}</p>
            <p className="text-xs font-medium opacity-70 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tiers */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-sm">Subscription Tiers</h2>
          <button onClick={() => { setShowNewTier(true); setTierForm({ name: '', description: '', priceCoins: 100, perks: '' }) }}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold">
            <Plus className="w-3.5 h-3.5" /> Add tier
          </button>
        </div>

        {/* Tier list */}
        {(profile.tiers || []).length === 0 && !showNewTier && (
          <p className="text-sm text-gray-400 text-center py-4">No tiers yet — create your first subscription tier</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(profile.tiers || []).map(t => (
            <TierCard key={t.id} tier={t} onEdit={openEditTier} />
          ))}
        </div>

        {/* New / Edit tier form */}
        {(showNewTier || editingTier) && (
          <div className="border border-indigo-200 rounded-2xl p-4 bg-indigo-50/30 space-y-3">
            <h3 className="text-sm font-bold text-gray-800">{editingTier ? 'Edit Tier' : 'New Tier'}</h3>
            <input value={tierForm.name} onChange={e => setTierForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Tier name (e.g. Supporter)" maxLength={80}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400" />
            <input value={tierForm.description} onChange={e => setTierForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)" maxLength={500}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400" />
            <div className="flex items-center gap-2">
              <span className="text-base">🪙</span>
              <input type="number" min={1} value={tierForm.priceCoins} onChange={e => setTierForm(f => ({ ...f, priceCoins: parseInt(e.target.value) || 1 }))}
                className="w-28 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400" />
              <span className="text-xs text-gray-400">coins / month</span>
            </div>
            <textarea value={tierForm.perks} onChange={e => setTierForm(f => ({ ...f, perks: e.target.value }))}
              placeholder="Perks (one per line)&#10;Exclusive posts&#10;Early access" rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-indigo-400" />
            <div className="flex gap-2">
              <button onClick={() => { setShowNewTier(false); setEditingTier(null) }}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={() => editingTier ? updateTierMutation.mutate() : createTierMutation.mutate()}
                disabled={!tierForm.name.trim() || (editingTier ? updateTierMutation.isPending : createTierMutation.isPending)}
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1">
                {(editingTier ? updateTierMutation : createTierMutation).isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" />}
                {editingTier ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recent activity */}
      {(recentTips.length > 0 || recentSubs.length > 0) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <h2 className="font-bold text-gray-900 text-sm">Recent Activity</h2>
          {recentTips.map(t => (
            <div key={t.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-green-100 flex items-center justify-center text-sm font-bold text-green-700 flex-shrink-0">
                {getAvatarUrl(t.sender?.avatarUrl)
                  ? <img src={getAvatarUrl(t.sender?.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                  : `${t.sender?.firstName?.[0]}${t.sender?.lastName?.[0]}`}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">{t.sender?.firstName} tipped you</p>
                {t.message && <p className="text-[11px] text-gray-500 truncate">"{t.message}"</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold text-green-600">+{fmt(t.amount)} 🪙</p>
                <p className="text-[10px] text-gray-400">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</p>
              </div>
            </div>
          ))}
          {recentSubs.map(s => (
            <div key={s.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-700 flex-shrink-0">
                {getAvatarUrl((s as any).subscriber?.avatarUrl)
                  ? <img src={getAvatarUrl((s as any).subscriber?.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                  : `${(s as any).subscriber?.firstName?.[0]}`}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">{(s as any).subscriber?.firstName} subscribed</p>
                <p className="text-[11px] text-gray-500">{s.tier?.name}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold text-indigo-600">+{fmt(s.coinsCharged)} 🪙</p>
                <p className="text-[10px] text-gray-400">{formatDistanceToNow(new Date(s.startedAt), { addSuffix: true })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
