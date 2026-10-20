'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { communitiesApi, COMMUNITY_CATEGORIES, type Community } from '@/lib/communities'
import { CommunityCard } from '@/components/communities/CommunityCard'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/ui/search-input'
import { Plus, Users, Compass, X, Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

// ─── Create modal ─────────────────────────────────────────────────────────────
const schema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  privacy:     z.enum(['PUBLIC','PRIVATE','INVITE_ONLY']).default('PUBLIC'),
  category:    z.string().optional(),
  rules:       z.string().max(5000).optional(),
})
type Form = z.infer<typeof schema>

function CreateModal({ onClose }: { onClose: () => void }) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { privacy: 'PUBLIC' }
  })

  const mutation = useMutation({
    mutationFn: (data: Form) => communitiesApi.create(data),
    onSuccess: () => {
      toast({ title: '✅ Community created!' })
      queryClient.invalidateQueries({ queryKey: ['communities'] })
      queryClient.invalidateQueries({ queryKey: ['my-communities'] })
      onClose()
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  const privacy  = watch('privacy')
  const category = watch('category')

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900">Create Community</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-gray-700">Name *</label>
            <input {...register('name')} placeholder="e.g. Islamic Finance Study Group"
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400" />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea {...register('description')} rows={3} placeholder="What is this community about?"
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-indigo-400" />
          </div>

          {/* Privacy */}
          <div>
            <label className="text-sm font-medium text-gray-700">Privacy</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[['PUBLIC','🌍 Public'],['PRIVATE','🔒 Private'],['INVITE_ONLY','✉️ Invite only']] .map(([v, l]) => (
                <button key={v} type="button" onClick={() => setValue('privacy', v as any)}
                  className={cn('py-2 rounded-xl text-xs font-semibold border transition-colors',
                    privacy === v ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300')}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-gray-700">Category</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {COMMUNITY_CATEGORIES.map(c => (
                <button key={c.value} type="button" onClick={() => setValue('category', category === c.value ? '' : c.value)}
                  className={cn('px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors',
                    category === c.value ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300')}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Rules */}
          <div>
            <label className="text-sm font-medium text-gray-700">Community Rules <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea {...register('rules')} rows={3} placeholder="1. Be respectful&#10;2. No spam&#10;..."
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-indigo-400" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CommunitiesPage() {
  const { user } = useAuthStore()
  const [tab,         setTab]         = useState<'discover' | 'mine'>('discover')
  const [search,      setSearch]      = useState('')
  const [category,    setCategory]    = useState('')
  const [showCreate,  setShowCreate]  = useState(false)
  const debouncedSearch = useDebounce(search, 300)

  const { data: discoverData, isLoading: loadingDiscover } = useQuery({
    queryKey: ['communities', debouncedSearch, category],
    queryFn:  () => communitiesApi.list(debouncedSearch || undefined, category || undefined).then(r => r.data.data),
    enabled:  tab === 'discover',
  })

  const { data: myCommunities = [], isLoading: loadingMine } = useQuery<Community[]>({
    queryKey: ['my-communities'],
    queryFn:  () => communitiesApi.mine().then(r => {
      // Handle both legacy flat array and new cursor-paginated { items, nextCursor, hasMore }
      const data = r.data.data
      return Array.isArray(data) ? data : (data?.items ?? [])
    }),
    enabled:  tab === 'mine',
  })

  const communities     = discoverData?.items ?? []
  const isLoading       = tab === 'discover' ? loadingDiscover : loadingMine
  const displayList     = tab === 'discover' ? communities : myCommunities

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Communities</h1>
            <p className="text-sm text-gray-400">Join groups, share interests</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1">
        {[['discover','🔭 Discover'],['mine','👤 My Communities']] .map(([t, l]) => (
          <button key={t} onClick={() => setTab(t as any)}
            className={cn('flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {l}
          </button>
        ))}
      </div>

      {/* Search + filter (discover only) */}
      {tab === 'discover' && (
        <div className="space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search communities…" isLoading={isLoading && !!search} />
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setCategory('')}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                !category ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50')}>
              All
            </button>
            {COMMUNITY_CATEGORIES.map(c => (
              <button key={c.value} onClick={() => setCategory(c.value === category ? '' : c.value)}
                className={cn('px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                  category === c.value ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50')}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : displayList.length === 0 ? (
        (tab === 'mine' || !search) ? (
          <EmptyState
            icon={Users}
            title={tab === 'mine' ? 'No communities yet' : 'No communities found'}
            description={tab === 'mine' ? 'Join or create your first community' : 'Be the first to create one'}
            action={{ label: 'Create a Community', onClick: () => setShowCreate(true) }}
          />
        ) : (
          <div className="text-center py-16 text-gray-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-gray-500">No results for &quot;{search}&quot;</p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {displayList.map(c => (
            <CommunityCard key={c.id} community={c} showJoin={tab === 'discover'} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      </AnimatePresence>
    </div>
  )
}
