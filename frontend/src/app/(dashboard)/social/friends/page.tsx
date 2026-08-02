'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { socialApi } from '@/lib/social'
import { getAvatarUrl } from '@/lib/avatar'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { Users, Search, UserMinus, MessageSquare, Mic } from 'lucide-react'
import Link from 'next/link'
import type { SocialUser } from '@/store/social.store'
import { useDebounce } from '@/hooks/useDebounce'

function FriendCard({ user, onRemove }: { user: SocialUser; onRemove: () => void }) {
  const src = getAvatarUrl(user.avatarUrl)
  const [removing, setRemoving] = useState(false)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const handleRemove = async () => {
    if (!confirm(`Remove ${user.firstName} from friends?`)) return
    setRemoving(true)
    try {
      await socialApi.removeFriend(user.id)
      toast({ title: 'Friend removed' })
      queryClient.invalidateQueries({ queryKey: ['friends'] })
      queryClient.invalidateQueries({ queryKey: ['social-counts', user.id] })
      onRemove()
    } catch {
      toast({ title: 'Failed to remove friend', variant: 'destructive' })
    } finally { setRemoving(false) }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col items-center gap-3 text-center group hover:shadow-md transition-shadow"
    >
      <Link href={`/social/profile/${user.id}`} className="flex flex-col items-center gap-2">
        <div className="relative">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-lg">
            {src
              ? <img src={src} alt="" className="w-full h-full object-cover" />
              : `${user.firstName[0]}${user.lastName[0]}`
            }
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-400 rounded-full border-2 border-white" />
        </div>
        <div>
          <p className="font-semibold text-gray-900 text-sm leading-tight">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-xs text-gray-400 capitalize mt-0.5">{user?.role?.toLowerCase() ?? ""}</p>
        </div>
      </Link>

      <div className="flex items-center gap-1.5 w-full">
        <Link
          href={`/dm?userId=${user.id}`}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" /> Chat
        </Link>
        <button
          onClick={handleRemove}
          disabled={removing}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
          title="Remove friend"
        >
          <UserMinus className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  )
}

export default function FriendsPage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const { data: friends = [], isLoading } = useQuery<SocialUser[]>({
    queryKey: ['friends'],
    queryFn: () => socialApi.friends().then(r => r.data.data)
  })

  const filtered = friends
    .filter(f => !removed.has(f.id))
    .filter(f => {
      if (!debouncedSearch) return true
      const q = debouncedSearch.toLowerCase()
      return (
        f.firstName.toLowerCase().includes(q) ||
        f.lastName.toLowerCase().includes(q)
      )
    })

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Friends</h1>
          <p className="text-sm text-gray-400">{friends.length} friend{friends.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/social/requests"
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors"
        >
          Requests
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search friends…"
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">
            {debouncedSearch ? `No friends matching "${debouncedSearch}"` : 'No friends yet'}
          </p>
          {!debouncedSearch && (
            <Link href="/social/people" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
              Find people to add →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <AnimatePresence>
            {filtered.map(user => (
              <FriendCard
                key={user.id}
                user={user}
                onRemove={() => setRemoved(s => new Set([...s, user.id]))}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
