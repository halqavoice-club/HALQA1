'use client'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { getAvatarUrl } from '@/lib/avatar'
import { SocialButton } from '@/components/social/SocialButton'
import { useAuthStore } from '@/store/auth.store'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { SocialUser } from '@/store/social.store'

export default function FollowersPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuthStore()
  const queryClient = useQueryClient()

  const { data: followers = [], isLoading } = useQuery<SocialUser[]>({
    queryKey: ['followers-full', id],
    queryFn: () => socialApi.followers(id, 100).then(r => r.data.data),
    enabled: !!id
  })

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <Link href={`/social/profile/${id}`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> Profile
      </Link>
      <h1 className="text-xl font-bold text-gray-900">Followers <span className="text-gray-400 font-normal text-base">({followers.length})</span></h1>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : followers.length === 0 ? (
        <p className="text-center py-12 text-gray-400 text-sm">No followers yet</p>
      ) : (
        <div className="space-y-2">
          {followers.map(user => {
            const src = getAvatarUrl(user.avatarUrl)
            const isMe = me?.id === user.id
            return (
              <div key={user.id} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100">
                <Link href={`/social/profile/${user.id}`}>
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0 flex items-center justify-center font-bold text-indigo-600">
                    {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : `${user.firstName[0]}${user.lastName[0]}`}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/social/profile/${user.id}`}>
                    <p className="font-semibold text-gray-900 text-sm hover:text-indigo-600 transition-colors">{user.firstName} {user.lastName}</p>
                  </Link>
                  <p className="text-xs text-gray-400 capitalize">{(user.role ?? '').toLowerCase()}</p>
                </div>
                {!isMe && (
                  <SocialButton
                    userId={user.id}
                    isFollowing={user.iFollowThem ?? false}
                    friendStatus={user.friendStatus ?? 'none'}
                    onUpdate={() => queryClient.invalidateQueries({ queryKey: ['followers-full', id] })}
                    size="sm"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
