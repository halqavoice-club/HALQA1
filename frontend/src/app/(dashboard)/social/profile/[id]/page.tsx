'use client'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import api from '@/lib/api'
import { socialApi } from '@/lib/social'
import { postsApi } from '@/lib/posts'
import { creatorApi } from '@/lib/creator'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { SocialButton } from '@/components/social/SocialButton'
import { PostCard } from '@/components/feed/PostCard'
import { TipButton } from '@/components/creator/TipButton'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { Users, UserCheck, ArrowLeft, MessageSquare, MoreHorizontal, Flag, ShieldOff, ShieldCheck, X, Grid3X3, FileText, Bookmark, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { SocialUser } from '@/store/social.store'

const REPORT_REASONS = [
  { value: 'spam',           label: 'Spam or fake account' },
  { value: 'harassment',     label: 'Harassment or bullying' },
  { value: 'hate_speech',    label: 'Hate speech' },
  { value: 'sexual_content', label: 'Inappropriate content' },
  { value: 'scam',           label: 'Scam or fraud' },
  { value: 'impersonation',  label: 'Impersonation' },
  { value: 'other',          label: 'Other' },
]

interface SocialCounts {
  followers: number
  following: number
  friends: number
  isFollowing: boolean
  friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends'
  mutualFriends: number
}

interface ProfileUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: string
  schoolId: string | null
  bio?: string | null
  createdAt: string
}

function StatPill({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = (
    <div className="flex flex-col items-center gap-0.5 px-4 py-2">
      <span className="text-lg font-black text-gray-900">{value.toLocaleString()}</span>
      <span className="text-xs text-gray-400 font-medium">{label}</span>
    </div>
  )
  return href
    ? <Link href={href} className="hover:bg-gray-50 rounded-xl transition-colors">{content}</Link>
    : <div>{content}</div>
}

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuthStore()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const isMe = me?.id === id

  const [showMenu,    setShowMenu]    = useState(false)
  const [showReport,  setShowReport]  = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDesc,   setReportDesc]   = useState('')
  // Posts tab state (Phase B-1 extension — profile posts)
  const [postsTab,    setPostsTab]    = useState<'posts' | 'media' | 'bookmarks'>('posts')

  const { data: profile, isLoading: loadingProfile } = useQuery<ProfileUser>({
    queryKey: ['user-profile', id],
    queryFn: () => api.get(`/users/${id}`).then(r => r.data.data),
    enabled: !!id
  })

  const { data: counts, isLoading: loadingCounts } = useQuery<SocialCounts>({
    queryKey: ['social-counts', id],
    queryFn: () => socialApi.counts(id).then(r => r.data.data),
    enabled: !!id
  })

  const { data: followers = [] } = useQuery<SocialUser[]>({
    queryKey: ['profile-followers', id],
    queryFn: () => socialApi.followers(id, 6).then(r => r.data.data?.items ?? r.data.data ?? []),
    enabled: !!id
  })

  const { data: following = [] } = useQuery<SocialUser[]>({
    queryKey: ['profile-following', id],
    queryFn: () => socialApi.following(id, 6).then(r => r.data.data?.items ?? r.data.data ?? []),
    enabled: !!id
  })

  // Block status
  const { data: blockStatus } = useQuery<{ iBlockedThem: boolean; theyBlockedMe: boolean }>({
    queryKey: ['block-status', id],
    queryFn: () => api.get(`/social/block/${id}/status`).then(r => r.data.data),
    enabled: !!id && !isMe,
  })

  // Posts tab (Phase B-1 extension)
  const { data: postsData, fetchNextPage: fetchNextPosts, hasNextPage: hasMorePosts, isFetchingNextPage: loadingMorePosts } = useInfiniteQuery({
    queryKey: ['user-posts', id, postsTab],
    queryFn:  ({ pageParam }) => postsApi.getUserPosts(id, postsTab, pageParam as string | undefined).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!id,
  })
  const userPosts = postsData?.pages.flatMap(p => p.items) ?? []

  // Creator profile (Phase B-6 — additive, shown if user is a creator)
  const { data: creatorData } = useQuery({
    queryKey: ['creator-profile', id],
    queryFn:  () => creatorApi.getProfile(id).then(r => r.data.data).catch(() => null),
    enabled:  !!id && !isMe,
  })

  const blockMutation = useMutation({
    mutationFn: () => blockStatus?.iBlockedThem
      ? api.delete(`/social/block/${id}`)
      : api.post(`/social/block/${id}`),
    onSuccess: (_, __, _ctx) => {
      const wasBlocked = blockStatus?.iBlockedThem
      toast({ title: wasBlocked ? 'User unblocked' : 'User blocked' })
      queryClient.invalidateQueries({ queryKey: ['block-status', id] })
      queryClient.invalidateQueries({ queryKey: ['social-counts', id] })
      setShowMenu(false)
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  const reportMutation = useMutation({
    mutationFn: () => api.post(`/social/report/${id}`, { reason: reportReason, description: reportDesc }),
    onSuccess: () => {
      toast({ title: '✅ Report submitted. Our team will review it.' })
      setShowReport(false)
      setReportReason('')
      setReportDesc('')
      setShowMenu(false)
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  if (loadingProfile) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <div className="h-48 bg-gray-100 rounded-3xl animate-pulse" />
        <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto text-center py-20 text-gray-400">
        <p>User not found</p>
        <Link href="/social/people" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
          ← Back to People
        </Link>
      </div>
    )
  }

  const src = getAvatarUrl(profile.avatarUrl)
  const initials = `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* Back */}
      <Link href="/social/people" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        <ArrowLeft className="w-4 h-4" /> People
      </Link>

      {/* Profile card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
      >
        {/* Banner */}
        <div className="h-24 bg-gradient-to-br from-indigo-500 to-purple-600" />

        {/* Avatar + info */}
        <div className="px-5 pb-5">
          <div className="flex items-end justify-between -mt-10 mb-3">
            <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-white bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-xl shadow-sm">
              {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials}
            </div>
            <div className="flex items-center gap-2">
              {!isMe && counts && (
                <SocialButton
                  userId={id}
                  isFollowing={counts.isFollowing}
                  friendStatus={counts.friendStatus}
                  onUpdate={() => {
                    queryClient.invalidateQueries({ queryKey: ['social-counts', id] })
                    queryClient.invalidateQueries({ queryKey: ['profile-followers', id] })
                  }}
                />
              )}
              {isMe && (
                <Link
                  href="/profile"
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  Edit Profile
                </Link>
              )}
              {/* ⋯ menu — only for other users */}
              {!isMe && (
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(v => !v)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-600" />
                  </button>
                  <AnimatePresence>
                    {showMenu && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          className="absolute right-0 top-11 z-40 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
                        >
                          <button
                            onClick={() => { setShowReport(true); setShowMenu(false) }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Flag className="w-4 h-4 text-orange-500" />
                            Report {profile.firstName}
                          </button>
                          <div className="h-px bg-gray-100 mx-3" />
                          <button
                            onClick={() => {
                              if (confirm(blockStatus?.iBlockedThem
                                ? `Unblock ${profile.firstName}?`
                                : `Block ${profile.firstName}? They won't be able to follow or message you.`
                              )) blockMutation.mutate()
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors"
                          >
                            {blockStatus?.iBlockedThem
                              ? <><ShieldCheck className="w-4 h-4" /> Unblock {profile.firstName}</>
                              : <><ShieldOff  className="w-4 h-4" /> Block {profile.firstName}</>
                            }
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          <h1 className="text-xl font-black text-gray-900">
            {profile.firstName} {profile.lastName}
          </h1>
          <p className="text-sm text-gray-400 capitalize mt-0.5">{(profile.role ?? '').toLowerCase()}</p>

          {/* Bio */}
          {profile.bio && (
            <p className="text-sm text-gray-500 mt-2 text-center italic leading-relaxed">
              {profile.bio}
            </p>
          )}

          {/* Action buttons for non-self */}
          {!isMe && counts?.friendStatus === 'friends' && (
            <Link
              href={`/dm?userId=${id}`}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors"
            >
              <MessageSquare className="w-4 h-4" /> Send Message
            </Link>
          )}
          {/* Mutual friends hint */}
          {!isMe && counts && counts.mutualFriends > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              👥 {counts.mutualFriends} mutual friend{counts.mutualFriends !== 1 ? 's' : ''}
            </p>
          )}
          {/* Creator tip button (Phase B-6 — additive) */}
          {!isMe && creatorData && creatorData.isActive && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <TipButton
                creatorUserId={id}
                creatorName={creatorData.displayName || profile.firstName}
                size="sm"
              />
              {creatorData.tagline && (
                <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-2.5 h-2.5 inline mr-0.5" />Creator
                </span>
              )}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="border-t border-gray-50 flex divide-x divide-gray-100">
          <StatPill
            label="Followers"
            value={counts?.followers ?? 0}
            href={`/social/profile/${id}/followers`}
          />
          <StatPill
            label="Following"
            value={counts?.following ?? 0}
            href={`/social/profile/${id}/following`}
          />
          <StatPill
            label="Friends"
            value={counts?.friends ?? 0}
            href="/social/friends"
          />
        </div>
      </motion.div>

      {/* Followers preview */}
      {followers.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-indigo-500" /> Followers
            </h3>
            <Link href={`/social/profile/${id}/followers`} className="text-xs text-indigo-600 hover:underline">
              See all
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {followers.map(u => {
              const s = getAvatarUrl(u.avatarUrl)
              return (
                <Link key={u.id} href={`/social/profile/${u.id}`} title={`${u.firstName} ${u.lastName}`}>
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 border-2 border-white shadow-sm">
                    {s ? <img src={s} alt="" className="w-full h-full object-cover" /> : `${u.firstName[0]}${u.lastName[0]}`}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Following preview */}
      {following.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-purple-500" /> Following
            </h3>
            <Link href={`/social/profile/${id}/following`} className="text-xs text-indigo-600 hover:underline">
              See all
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {following.map(u => {
              const s = getAvatarUrl(u.avatarUrl)
              return (
                <Link key={u.id} href={`/social/profile/${u.id}`} title={`${u.firstName} ${u.lastName}`}>
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-600 border-2 border-white shadow-sm">
                    {s ? <img src={s} alt="" className="w-full h-full object-cover" /> : `${u.firstName[0]}${u.lastName[0]}`}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
      {/* ── Posts tab (Phase B-1 extension — additive, no existing UI changed) ── */}
      {!blockStatus?.theyBlockedMe && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100">
            {([
              { key: 'posts',     label: 'Posts',     icon: FileText  },
              { key: 'media',     label: 'Media',     icon: Grid3X3   },
              ...(isMe ? [{ key: 'bookmarks' as const, label: 'Saved', icon: Bookmark }] : []),
            ] as { key: 'posts'|'media'|'bookmarks'; label: string; icon: React.ElementType }[]).map(t => (
              <button key={t.key} onClick={() => setPostsTab(t.key)}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors',
                  postsTab === t.key
                    ? 'text-indigo-600 border-b-2 border-indigo-500'
                    : 'text-gray-400 hover:text-gray-600')}>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Posts grid / list */}
          <div className="p-4 space-y-4">
            {userPosts.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-6">
                {postsTab === 'bookmarks' ? 'No saved posts yet' : 'No posts yet'}
              </p>
            )}
            {postsTab === 'media' ? (
              <div className="grid grid-cols-3 gap-1">
                {userPosts.flatMap(p => p.media).map(m => (
                  <div key={m.id} className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <img
                      src={resolveMediaUrl(m.url)}
                      alt="" className="w-full h-full object-cover hover:opacity-90 transition-opacity cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            ) : (
              userPosts.map(p => (
                <PostCard key={p.id} post={p} compact showPinIndicator />
              ))
            )}
            {hasMorePosts && (
              <button onClick={() => fetchNextPosts()} disabled={loadingMorePosts}
                className="w-full py-2 text-xs text-indigo-500 hover:underline">
                {loadingMorePosts ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Blocked banner */}
      {blockStatus?.theyBlockedMe && (
        <div className="bg-gray-100 border border-gray-200 rounded-2xl p-4 text-center">
          <p className="text-sm text-gray-500">This user has restricted who can view their profile.</p>
        </div>
      )}
      {blockStatus?.iBlockedThem && (
        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-center justify-between">
          <p className="text-sm text-orange-600 flex items-center gap-2">
            <ShieldOff className="w-4 h-4" /> You have blocked this user.
          </p>
          <button
            onClick={() => blockMutation.mutate()}
            className="text-xs text-orange-600 underline hover:no-underline"
          >
            Unblock
          </button>
        </div>
      )}

      {/* Report modal */}
      <AnimatePresence>
        {showReport && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Flag className="w-4 h-4 text-orange-500" />
                  <h2 className="font-bold text-gray-900 text-sm">
                    Report {profile.firstName}
                  </h2>
                </div>
                <button
                  onClick={() => setShowReport(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">What's the issue?</p>
                  <div className="space-y-1.5">
                    {REPORT_REASONS.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setReportReason(r.value)}
                        className={cn(
                          'w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors',
                          reportReason === r.value
                            ? 'bg-orange-50 border-orange-300 text-orange-700 font-medium'
                            : 'border-gray-100 hover:bg-gray-50 text-gray-700'
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">
                    Additional details <span className="text-gray-400 font-normal">(optional)</span>
                  </p>
                  <textarea
                    value={reportDesc}
                    onChange={e => setReportDesc(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Describe what happened…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-orange-400"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowReport(false)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => reportMutation.mutate()}
                    disabled={!reportReason || reportMutation.isPending}
                    className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {reportMutation.isPending
                      ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      : <Flag className="w-3.5 h-3.5" />
                    }
                    Submit Report
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
