'use client'
/**
 * CommunityDetailPage v2 — Facebook Groups-style
 * Design requirements:
 * - Cover photo full-bleed with overlay gradient at bottom
 * - Avatar badge overlapping cover bottom-left corner
 * - Header row: community name, member count, privacy badge, Join/Leave button
 * - Hide join/leave button when community.privacy === 'INVITE_ONLY' and user is not owner
 * - Toast + re-enable button on join/leave failure
 * - 4 TABS: Feed | Members | About | Media
 * - Admin panel drawer for pending requests (OWNER/ADMIN only)
 */
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { communitiesApi, type Community, type CommunityMember } from '@/lib/communities'
import { postsApi, type Post } from '@/lib/posts'
import { resolveMediaUrl } from '@/lib/media'
import { PostCard } from '@/components/feed/PostCard'
import { PostComposer } from '@/components/feed/PostComposer'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Users, FileText, Info, ArrowLeft, BadgeCheck, Lock, Globe, Shield,
  Search, X, Settings, UserPlus, UserMinus, Image, Video, Check, XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

type TabType = 'feed' | 'members' | 'about' | 'media'

export default function CommunityDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const router = useRouter()
  
  const [tab, setTab] = useState<TabType>('feed')
  const [memberSearch, setMemberSearch] = useState('')
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const [joinDisabled, setJoinDisabled] = useState(false)

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', slug],
    queryFn: () => communitiesApi.get(slug).then(r => r.data.data),
    enabled: !!slug,
  })

  const { data: membersData } = useQuery({
    queryKey: ['community-members', slug],
    queryFn: () => communitiesApi.getMembers(slug).then(r => r.data.data),
    enabled: !!slug && tab === 'members',
  })

  const { data: feedData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['community-feed', slug],
    queryFn: ({ pageParam }) => communitiesApi.getFeed(slug, pageParam as string | undefined).then((r: any) => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: any) => page.nextCursor ?? undefined,
    enabled: !!slug && tab === 'feed',
  })

  const { data: pendingRequestsData, refetch: refetchPending } = useQuery({
    queryKey: ['community-pending-requests', slug],
    queryFn: () => communitiesApi.getPendingRequests(slug).then(r => r.data.data),
    enabled: adminPanelOpen && !!slug,
  })

  const joinMutation = useMutation({
    mutationFn: () => community?.myRole
      ? communitiesApi.leave(slug)
      : communitiesApi.join(slug),
    onMutate: () => setJoinDisabled(true),
    onSuccess: () => {
      toast({ title: community?.myRole ? 'Left community' : 'Joined community!' })
      queryClient.invalidateQueries({ queryKey: ['community', slug] })
      queryClient.invalidateQueries({ queryKey: ['my-communities'] })
      setJoinDisabled(false)
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' })
      setJoinDisabled(false)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: () => communitiesApi.remove(slug),
    onSuccess: () => {
      toast({ title: 'Community deleted' })
      router.push('/communities')
    }
  })

  const acceptRequestMutation = useMutation({
    mutationFn: (requestId: string) => communitiesApi.acceptRequest(slug, requestId),
    onSuccess: () => {
      toast({ title: 'Request accepted' })
      refetchPending()
    },
    onError: () => toast({ title: 'Failed to accept request', variant: 'destructive' })
  })

  const declineRequestMutation = useMutation({
    mutationFn: (requestId: string) => communitiesApi.declineRequest(slug, requestId),
    onSuccess: () => {
      toast({ title: 'Request declined' })
      refetchPending()
    },
    onError: () => toast({ title: 'Failed to decline request', variant: 'destructive' })
  })

  const posts = feedData?.pages.flatMap((p: any) => p.items) ?? []
  const members = membersData?.items ?? []
  const pendingRequests = pendingRequestsData?.items ?? []

  const filteredMembers = members.filter((m: CommunityMember) => {
    const search = memberSearch.toLowerCase()
    const name = `${m.user.firstName} ${m.user.lastName}`.toLowerCase()
    return name.includes(search)
  })

  const mediaPosts = posts.filter((p: Post) => 
    p.media && p.media.some((m: any) => m.type === 'IMAGE' || m.type === 'VIDEO')
  )

  const isOwnerOrAdmin = ['OWNER', 'ADMIN'].includes(community?.myRole || '')
  const isMember = !!community?.myRole
  const isOwner = community?.myRole === 'OWNER'
  const showJoinButton = community?.privacy !== 'INVITE_ONLY' || isOwner

  if (isLoading) return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  )

  if (!community) return (
    <div className="text-center py-16 text-gray-400">
      <p>Community not found</p>
      <Link href="/communities" className="text-indigo-600 hover:underline text-sm mt-2 block">← Back to Communities</Link>
    </div>
  )

  const PrivIcon = community.privacy === 'PUBLIC' ? Globe : Lock

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'OWNER': return 'bg-yellow-100 text-yellow-700 border-yellow-300'
      case 'ADMIN': return 'bg-indigo-100 text-indigo-700 border-indigo-300'
      case 'MODERATOR': return 'bg-green-100 text-green-700 border-green-300'
      default: return 'bg-gray-100 text-gray-700 border-gray-300'
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Cover Photo */}
      <div className="relative h-64 md:h-80 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-b-3xl overflow-hidden">
        {community.coverUrl ? (
          <img src={resolveMediaUrl(community.coverUrl)} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        
        {/* Back Button */}
        <Link href="/communities" className="absolute top-4 left-4 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/30 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>

        {/* Admin Panel Button */}
        {isOwnerOrAdmin && (
          <button
            onClick={() => setAdminPanelOpen(true)}
            className="absolute top-4 right-4 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/30 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Header */}
      <div className="px-4 md:px-6 -mt-16 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6">
          {/* Avatar */}
          <div className="w-32 h-32 rounded-2xl overflow-hidden border-4 border-white shadow-lg bg-white flex-shrink-0">
            {community.avatarUrl ? (
              <img src={resolveMediaUrl(community.avatarUrl)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600">
                {community.name.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{community.name}</h1>
              {community.isVerified && <BadgeCheck className="w-6 h-6 text-indigo-500" />}
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
              <span className="flex items-center gap-1">
                <PrivIcon className="w-4 h-4" />
                {(community.privacy ?? '').toLowerCase().replace('_', ' ')}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {community.memberCount.toLocaleString()} members
              </span>
            </div>
            {community.myRole && (
              <span className={cn('text-xs font-semibold px-2 py-1 rounded-full border', getRoleBadgeColor(community.myRole))}>
                {community.myRole}
              </span>
            )}
          </div>

          {/* Join/Leave Button */}
          {showJoinButton && community.myRole !== 'OWNER' && (
            <button
              onClick={() => joinMutation.mutate()}
              disabled={joinDisabled || joinMutation.isPending}
              className={cn(
                'px-6 py-2.5 rounded-xl font-semibold transition-colors flex-shrink-0',
                isMember
                  ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700',
                (joinDisabled || joinMutation.isPending) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {joinMutation.isPending ? 'Processing...' : isMember ? 'Leave' : 'Join Community'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
          {[
            { id: 'feed', label: 'Feed', icon: FileText },
            { id: 'members', label: 'Members', icon: Users },
            { id: 'about', label: 'About', icon: Info },
            { id: 'media', label: 'Media', icon: Image },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as TabType)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 md:px-6 pb-8">
        {/* Feed Tab */}
        {tab === 'feed' && (
          <div className="space-y-4">
            {isMember && (
              <PostComposer
                placeholder={`Share something with ${community.name}…`}
                communityId={community.id}
                onCreated={() => queryClient.invalidateQueries({ queryKey: ['community-feed', slug] })}
              />
            )}
            {posts.length === 0 && !isFetchingNextPage ? (
              <div className="text-center py-12 text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No posts yet{isMember ? '. Be the first!' : '. Join to post.'}</p>
              </div>
            ) : (
              <>
                {posts.map((p: Post) => (
                  <PostCard key={p.id} post={p} />
                ))}
                {hasNextPage && (
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full py-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    {isFetchingNextPage ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Members Tab */}
        {tab === 'members' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-2">
              {filteredMembers.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No members found</p>
              ) : (
                filteredMembers.map((m: CommunityMember) => {
                  const src = getAvatarUrl(m.user.avatarUrl)
                  const init = `${m.user.firstName[0]}${m.user.lastName[0]}`
                  const canRemove = isOwnerOrAdmin && m.user.id !== user?.id && m.role !== 'OWNER'
                  
                  return (
                    <div key={m.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg">
                      <Link href={`/social/profile/${m.user.id}`}>
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                          {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : init}
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/social/profile/${m.user.id}`}
                          className="text-sm font-semibold text-gray-800 hover:underline truncate block"
                        >
                          {m.user.firstName} {m.user.lastName}
                        </Link>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full border', getRoleBadgeColor(m.role))}>
                          {(m.role ?? '').toLowerCase()}
                        </span>
                      </div>
                      {canRemove && (
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${m.user.firstName} ${m.user.lastName} from this community?`)) {
                              communitiesApi.kickMember(slug, m.user.id).then(() => {
                                toast({ title: 'Member removed' })
                                queryClient.invalidateQueries({ queryKey: ['community-members', slug] })
                              })
                            }
                          }}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* About Tab */}
        {tab === 'about' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
            {community.description && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">About</h3>
                <p className="text-gray-600 whitespace-pre-wrap">{community.description}</p>
              </div>
            )}
            {community.rules && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Community Rules
                </h3>
                <p className="text-gray-600 whitespace-pre-wrap">{community.rules}</p>
              </div>
            )}
            <div className="pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>Created</span>
                <span className="font-medium text-gray-700">
                  {format(new Date(community.createdAt), 'MMMM d, yyyy')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
                <span>Created by</span>
                <Link
                  href={`/social/profile/${community.owner.id}`}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  {community.owner.firstName} {community.owner.lastName}
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Media Tab */}
        {tab === 'media' && (
          <div>
            {mediaPosts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Image className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No media yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {mediaPosts.flatMap((post: Post) =>
                  post.media?.map((media: any) => (
                    <div key={`${post.id}-${media.id}`} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                      {media.type === 'IMAGE' ? (
                        <img
                          src={resolveMediaUrl(media.url)}
                          alt=""
                          className="w-full h-full object-cover hover:scale-105 transition-transform cursor-pointer"
                          loading="lazy"
                        />
                      ) : media.type === 'VIDEO' ? (
                        <div className="w-full h-full flex items-center justify-center bg-gray-900 relative">
                          <Video className="w-8 h-8 text-white/50" />
                          {media.thumbnailUrl && (
                            <img
                              src={resolveMediaUrl(media.thumbnailUrl)}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover opacity-50"
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin Panel Drawer */}
      <AnimatePresence>
        {adminPanelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdminPanelOpen(false)}
              className="fixed inset-0 z-40 bg-black/50"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-xl"
            >
              <div className="p-4 border-b flex items-center justify-between">
                <h2 className="text-lg font-semibold">Pending Join Requests</h2>
                <button
                  onClick={() => setAdminPanelOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto h-[calc(100%-60px)]">
                {pendingRequests.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">No pending requests</p>
                ) : (
                  <div className="space-y-3">
                    {pendingRequests.map((request: any) => (
                      <div key={request.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
                          {request.user.firstName[0]}{request.user.lastName[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {request.user.firstName} {request.user.lastName}
                          </p>
                          <p className="text-xs text-gray-500">
                            Requested {format(new Date(request.createdAt), 'MMM d')}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptRequestMutation.mutate(request.id)}
                            className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => declineRequestMutation.mutate(request.id)}
                            className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
