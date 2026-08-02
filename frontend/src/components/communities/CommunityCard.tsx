'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { communitiesApi, type Community, COMMUNITY_CATEGORIES } from '@/lib/communities'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import { Users, Lock, Globe, UserCheck, BadgeCheck } from 'lucide-react'
import Link from 'next/link'

const PRIVACY_ICON = { PUBLIC: Globe, PRIVATE: Lock, INVITE_ONLY: Lock }
const ROLE_COLOR   = { OWNER: 'text-yellow-600 bg-yellow-50', ADMIN: 'text-blue-600 bg-blue-50', MODERATOR: 'text-purple-600 bg-purple-50', MEMBER: 'text-green-600 bg-green-50' }

interface Props {
  community: Community
  showJoin?: boolean
}

export function CommunityCard({ community, showJoin = true }: Props) {
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const PrivIcon    = PRIVACY_ICON[(community.privacy ?? 'PUBLIC') as keyof typeof PRIVACY_ICON] ?? Globe
  const avatarSrc   = getAvatarUrl(community.avatarUrl)
  const initials    = (community.name ?? '').slice(0, 2).toUpperCase() || '??'
  const catLabel    = COMMUNITY_CATEGORIES.find(c => c.value === community.category)?.label

  const joinMutation = useMutation({
    mutationFn: () => community.myRole
      ? communitiesApi.leave(community.id)
      : communitiesApi.join(community.id),
    onSuccess: () => {
      toast({ title: community.myRole ? 'Left community' : '✅ Joined!' })
      queryClient.invalidateQueries({ queryKey: ['communities'] })
      queryClient.invalidateQueries({ queryKey: ['community', community.slug] })
      queryClient.invalidateQueries({ queryKey: ['my-communities'] })
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Cover */}
      <div className="h-16 relative" style={{ background: community.coverUrl ? undefined : 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
        {community.coverUrl && <img src={community.coverUrl.startsWith('/') ? resolveMediaUrl(community.coverUrl) : community.coverUrl} alt="" className="w-full h-full object-cover" />}
      </div>

      <div className="px-4 pb-4">
        {/* Avatar */}
        <div className="-mt-6 mb-2">
          <div className="w-12 h-12 rounded-xl overflow-hidden border-3 border-white shadow-sm bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
            {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
        </div>

        {/* Name + verified */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/communities/${community.slug}`}
              className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
              <h3 className="font-bold text-gray-900 text-sm truncate">{community.name}</h3>
              {community.isVerified && <BadgeCheck className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
            </Link>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <PrivIcon className="w-3 h-3 text-gray-400" />
              <span className="text-[11px] text-gray-400 capitalize">{(community.privacy ?? '').toLowerCase().replace('_', ' ')}</span>
              {catLabel && <span className="text-[11px] text-gray-400">{catLabel}</span>}
            </div>
          </div>
          {community.myRole && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0', ROLE_COLOR[community.myRole as keyof typeof ROLE_COLOR])}>
              {community.myRole}
            </span>
          )}
        </div>

        {/* Description */}
        {community.description && (
          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{community.description}</p>
        )}

        {/* Stats + join */}
        <div className="flex items-center justify-between mt-3">
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Users className="w-3.5 h-3.5" />
            {community.memberCount.toLocaleString()} member{community.memberCount !== 1 ? 's' : ''}
          </span>

          {showJoin && community.myRole !== 'OWNER' && community.privacy !== 'INVITE_ONLY' && (
            <button onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                community.myRole
                  ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              )}>
              {community.myRole ? <><UserCheck className="w-3 h-3" /> Joined</> : '+ Join'}
            </button>
          )}
          {!showJoin && (
            <Link href={`/communities/${community.slug}`}
              className="text-xs text-indigo-600 hover:underline font-medium">
              View →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
