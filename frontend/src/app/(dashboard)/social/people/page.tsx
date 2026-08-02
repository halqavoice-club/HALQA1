'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { getAvatarUrl } from '@/lib/avatar'
import { SocialButton } from '@/components/social/SocialButton'
import { useDebounce } from '@/hooks/useDebounce'
import { Search, Users } from 'lucide-react'
import Link from 'next/link'
import type { SocialUser } from '@/store/social.store'

function PersonRow({ user, onUpdate }: { user: SocialUser; onUpdate: () => void }) {
  const src = getAvatarUrl(user.avatarUrl)
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 hover:shadow-sm transition-shadow">
      <Link href={`/social/profile/${user.id}`}>
        <div className="w-11 h-11 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center font-bold text-indigo-600">
          {src
            ? <img src={src} alt="" className="w-full h-full object-cover" />
            : `${user.firstName[0]}${user.lastName[0]}`
          }
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/social/profile/${user.id}`}>
          <p className="font-semibold text-gray-900 text-sm hover:text-indigo-600 transition-colors">
            {user.firstName} {user.lastName}
          </p>
        </Link>
        <p className="text-xs text-gray-400 capitalize">{user?.role?.toLowerCase() ?? ""}</p>
      </div>
      <SocialButton
        userId={user.id}
        isFollowing={user.isFollowing ?? false}
        friendStatus={user.friendStatus ?? 'none'}
        onUpdate={onUpdate}
        size="sm"
      />
    </div>
  )
}

export default function PeoplePage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [version, setVersion] = useState(0)

  const { data: results = [], isLoading } = useQuery<SocialUser[]>({
    queryKey: ['social-search', debouncedSearch, version],
    queryFn: () =>
      debouncedSearch.length >= 2
        ? socialApi.search(debouncedSearch).then(r => r.data.data)
        : Promise.resolve([]),
    enabled: debouncedSearch.length >= 2
  })

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Find People</h1>
        <p className="text-sm text-gray-400">Search by name or email</p>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search people…"
          autoFocus
          className="w-full pl-9 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Results */}
      {debouncedSearch.length < 2 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Type at least 2 characters to search</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No users found for "{debouncedSearch}"</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map(user => (
            <PersonRow
              key={user.id}
              user={user}
              onUpdate={() => setVersion(v => v + 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
