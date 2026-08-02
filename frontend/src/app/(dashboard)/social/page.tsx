'use client'
import { useQuery } from '@tanstack/react-query'
import { socialApi } from '@/lib/social'
import { useSocialStore } from '@/store/social.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { Users, UserPlus, Search, Bell } from 'lucide-react'
import Link from 'next/link'
import type { SocialUser, FriendRequest } from '@/store/social.store'

function QuickCard({ href, icon, label, count, color }: {
  href: string; icon: React.ReactNode; label: string; count?: number; color: string
}) {
  return (
    <Link href={href} className={`flex flex-col items-center gap-2 p-4 rounded-2xl text-white ${color} hover:opacity-90 transition-opacity`}>
      <div className="text-2xl">{icon}</div>
      <span className="text-sm font-bold">{label}</span>
      {count !== undefined && (
        <span className="text-xl font-black">{count}</span>
      )}
    </Link>
  )
}

export default function SocialPage() {
  const { user } = useAuthStore()
  const { pendingCount } = useSocialStore()

  const { data: friends = [] } = useQuery<SocialUser[]>({
    queryKey: ['friends'],
    queryFn: () => socialApi.friends().then(r => r.data.data)
  })

  const { data: incoming = [] } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests-incoming'],
    queryFn: () => socialApi.incomingRequests().then(r => r.data.data)
  })

  const { data: counts } = useQuery({
    queryKey: ['social-counts', user?.id],
    queryFn: () => user ? socialApi.counts(user.id).then(r => r.data.data) : null,
    enabled: !!user
  })

  const recentFriends = friends.slice(0, 8)

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Social</h1>
        <p className="text-sm text-gray-400">Connect with people in your school</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <QuickCard href="/social/friends"  icon={<Users className="w-6 h-6" />}    label="Friends"   count={friends.length}          color="bg-indigo-500" />
        <QuickCard href="/social/requests" icon={<Bell className="w-6 h-6" />}     label="Requests"  count={incoming.length}         color={incoming.length > 0 ? 'bg-red-500' : 'bg-gray-400'} />
        <QuickCard href="/social/people"   icon={<Search className="w-6 h-6" />}   label="Find"      color="bg-purple-500" />
      </div>

      {/* My stats */}
      {counts && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Your Stats</h3>
          <div className="flex divide-x divide-gray-100">
            {[
              { label: 'Followers', value: counts.followers, href: `/social/profile/${user?.id}/followers` },
              { label: 'Following', value: counts.following, href: `/social/profile/${user?.id}/following` },
              { label: 'Friends',   value: counts.friends },
            ].map(s => (
              <div key={s.label} className="flex-1 text-center">
                {s.href
                  ? <Link href={s.href} className="block hover:bg-gray-50 rounded-xl py-1 transition-colors">
                      <p className="text-xl font-black text-gray-900">{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </Link>
                  : <div className="py-1">
                      <p className="text-xl font-black text-gray-900">{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending requests banner */}
      {incoming.length > 0 && (
        <Link href="/social/requests" className="flex items-center gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-2xl hover:bg-indigo-100 transition-colors">
          <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-indigo-900 text-sm">
              {incoming.length} pending friend request{incoming.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-indigo-600">Tap to review</p>
          </div>
          <span className="text-indigo-400">→</span>
        </Link>
      )}

      {/* Recent friends */}
      {recentFriends.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700">Friends</h3>
            <Link href="/social/friends" className="text-xs text-indigo-600 hover:underline">See all</Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {recentFriends.map(u => {
              const src = getAvatarUrl(u.avatarUrl)
              return (
                <Link key={u.id} href={`/social/profile/${u.id}`} className="flex flex-col items-center gap-1">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-sm border-2 border-white shadow-sm">
                    {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : `${u.firstName[0]}${u.lastName[0]}`}
                  </div>
                  <span className="text-[10px] text-gray-500 max-w-[48px] truncate text-center">{u.firstName}</span>
                </Link>
              )
            })}
            <Link href="/social/people" className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center border-2 border-dashed border-gray-300 hover:border-indigo-400 transition-colors">
                <UserPlus className="w-5 h-5 text-gray-400" />
              </div>
              <span className="text-[10px] text-gray-400">Add</span>
            </Link>
          </div>
        </div>
      )}

      {/* Empty state */}
      {friends.length === 0 && incoming.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">No connections yet</p>
          <Link href="/social/people" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
            Find people to connect with →
          </Link>
        </div>
      )}
    </div>
  )
}
