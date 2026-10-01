'use client'
import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { postsApi, type Post } from '@/lib/posts'
import { useFeedStore } from '@/store/feed.store'
import { useAuthStore } from '@/store/auth.store'
import { PostComposer } from '@/components/feed/PostComposer'
import { PostCard } from '@/components/feed/PostCard'
import { StoriesBar } from '@/components/stories/StoriesBar'
import { LiveSection } from '@/components/feed/LiveSection'
import { getSocket } from '@/lib/socket'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sparkles, TrendingUp, ArrowUp, RefreshCw, AlertCircle,
  Hash, Flame, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import Link from 'next/link'

// ─── Trending sidebar panel ────────────────────────────────────────────────────
function TrendingPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-hashtags'],
    queryFn:  () => postsApi.trending().then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="w-4 h-4 text-orange-500" />
        <h2 className="text-sm font-bold text-gray-900">Trending</h2>
      </div>
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-3 w-10 rounded" />
            </div>
          ))}
        </div>
      )}
      {data && data.length === 0 && (
        <p className="text-xs text-gray-400">No trending topics yet</p>
      )}
      {data?.map((tag) => (
        <Link
          key={tag.id}
          href={`/explore/hashtag/${tag.name}`}
          className="flex items-center justify-between group"
        >
          <div className="flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
            <span className="text-sm text-gray-700 group-hover:text-indigo-600 font-medium transition-colors">
              {tag.name}
            </span>
          </div>
          <span className="text-xs text-gray-400">{tag.postCount} posts</span>
        </Link>
      ))}
    </div>
  )
}

// ─── Main feed content (needs useSearchParams so wrapped in Suspense) ──────────
function FeedContent() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = searchParams.get('tab') ?? 'feed'

  const { incomingPosts, addIncoming, clearIncoming, removePost, updatePost } = useFeedStore()
  const [showNew, setShowNew] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const loaderRef          = useRef<HTMLDivElement>(null)
  const loaderFollowingRef = useRef<HTMLDivElement>(null)

  // ── Infinite feed — "For You" (all public posts) ───────────────────────────
  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage,
    isLoading, isError, refetch,
  } = useInfiniteQuery({
    queryKey: ['feed', retryCount],
    queryFn:  ({ pageParam }) =>
      postsApi.getFeed(pageParam as string | undefined, 20, 'all').then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnMount: true,
    enabled: activeTab === 'feed',
  })

  // ── Infinite feed — "Following" (only people you follow) ───────────────────
  const {
    data: followingData,
    fetchNextPage: fetchNextFollowing,
    hasNextPage: hasNextFollowing,
    isFetchingNextPage: isFetchingNextFollowing,
    isLoading: isLoadingFollowing,
    isError: isErrorFollowing,
  } = useInfiniteQuery({
    queryKey: ['feed-following', retryCount],
    queryFn:  ({ pageParam }) =>
      postsApi.getFeed(pageParam as string | undefined, 20, 'following').then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnMount: true,
    enabled: activeTab === 'following',
  })

  const posts          = data?.pages.flatMap(p => p.items) ?? []
  const followingPosts = followingData?.pages.flatMap(p => p.items) ?? []

  // ── Intersection observer for infinite scroll ──────────────────────────────
  useEffect(() => {
    if (!loaderRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }, { threshold: 0.1 })
    obs.observe(loaderRef.current)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // ── Intersection observer — Following tab ──────────────────────────────────
  useEffect(() => {
    if (!loaderFollowingRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextFollowing && !isFetchingNextFollowing) {
        fetchNextFollowing()
      }
    }, { threshold: 0.1 })
    obs.observe(loaderFollowingRef.current)
    return () => obs.disconnect()
  }, [hasNextFollowing, isFetchingNextFollowing, fetchNextFollowing])

  // ── Socket.IO — real-time feed events ──────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.emit('feed:join')
    // Also join school-scoped room for SCHOOL_ONLY posts
    if (user?.schoolId) {
      socket.emit('feed:join:school', { schoolId: user.schoolId })
    }

    const onPostCreate = (d: { post: Post }) => {
      if (d.post.authorId !== user?.id) {
        addIncoming(d.post)
        setShowNew(true)
      }
    }
    const onPostUpdate = (d: { post: Post })     => updatePost(d.post)
    const onPostDelete = (d: { postId: string }) => removePost(d.postId)
    const onPostLike   = ()                      => queryClient.invalidateQueries({ queryKey: ['feed'] })
    const onCommentNew = ()                      => queryClient.invalidateQueries({ queryKey: ['feed'] })

    socket.on('post:create',    onPostCreate)
    socket.on('post:update',    onPostUpdate)
    socket.on('post:delete',    onPostDelete)
    socket.on('post:like',      onPostLike)
    socket.on('comment:create', onCommentNew)

    return () => {
      socket.emit('feed:leave')
      if (user?.schoolId) socket.emit('feed:leave:school', { schoolId: user.schoolId })
      socket.off('post:create',    onPostCreate)
      socket.off('post:update',    onPostUpdate)
      socket.off('post:delete',    onPostDelete)
      socket.off('post:like',      onPostLike)
      socket.off('comment:create', onCommentNew)
    }
  }, [addIncoming, removePost, updatePost, queryClient, user?.id])

  const handleShowNew = useCallback(() => {
    setShowNew(false)
    clearIncoming()
    queryClient.invalidateQueries({ queryKey: ['feed'] })
    queryClient.invalidateQueries({ queryKey: ['feed-following'] })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [clearIncoming, queryClient])

  const handleRetry = useCallback(() => setRetryCount(prev => prev + 1), [])

  const allPosts = [...incomingPosts, ...posts].filter(
    (p, idx, self) => self.findIndex(x => x.id === p.id) === idx
  )
  return (
    <div className="max-w-2xl mx-auto pb-10">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-500" />
          <h1 className="text-xl font-bold text-gray-900">Feed</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Reels shortcut */}
          <Link
            href="/reels"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-pink-500 to-red-500 text-white text-xs font-bold rounded-xl hover:opacity-90 transition-opacity"
          >
            <span>▶</span> Reels
          </Link>

          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => router.push('/feed')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
              activeTab === 'feed'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Sparkles className="w-3.5 h-3.5" /> For You
          </button>
          <button
            onClick={() => router.push('/feed?tab=following')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
              activeTab === 'following'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Users className="w-3.5 h-3.5" /> Following
          </button>
          <button
            onClick={() => router.push('/feed?tab=trending')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
              activeTab === 'trending'
                ? 'bg-white text-orange-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <TrendingUp className="w-3.5 h-3.5" /> Trending
          </button>
          </div>
        </div>
      </div>

      {/* ── TRENDING TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'trending' && (
        <div className="space-y-4">
          <TrendingPanel />
          <p className="text-center text-xs text-gray-400 py-4">
            Tap a hashtag to explore all posts with that tag
          </p>
        </div>
      )}

      {/* ── FOLLOWING TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'following' && (
        <div className="space-y-4">
          {/* Composer */}
          <PostComposer />

          {/* "New posts" banner — same as For You tab */}
          {showNew && incomingPosts.length > 0 && (
            <button
              onClick={handleShowNew}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors animate-in slide-in-from-top-2 duration-200"
            >
              <ArrowUp className="w-4 h-4" />
              {incomingPosts.length} new post{incomingPosts.length > 1 ? 's' : ''} — tap to refresh
            </button>
          )}

          {/* Skeletons */}
          {isLoadingFollowing && (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3 w-32 rounded" />
                      <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoadingFollowing && !isErrorFollowing && followingPosts.length === 0 && incomingPosts.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-gray-500">No posts from people you follow yet</p>
              <p className="text-sm mt-1">Follow people to see their posts here</p>
              <Link
                href="/social/people"
                className="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Find people to follow →
              </Link>
            </div>
          )}

          {/* Posts */}
          <div className="space-y-4">
            {followingPosts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {/* Error state */}
          {isErrorFollowing && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
              <p className="text-gray-600 mb-4">Failed to load following feed</p>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={loaderFollowingRef} className="h-8 flex items-center justify-center">
            {isFetchingNextFollowing && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="w-4 h-4 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
                Loading more…
              </div>
            )}
            {!hasNextFollowing && followingPosts.length > 0 && !isErrorFollowing && (
              <p className="text-xs text-gray-300">You're all caught up ✓</p>
            )}
          </div>
        </div>
      )}

      {/* ── FEED TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'feed' && (
        <div className="space-y-4">
          {/* Stories */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <StoriesBar />
          </div>

          {/* Live sessions — voice rooms + live classes */}
          <LiveSection />

          {/* Composer */}
          <PostComposer />

          {/* "New posts" banner */}
          {showNew && incomingPosts.length > 0 && (
            <button
              onClick={handleShowNew}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors animate-in slide-in-from-top-2 duration-200"
            >
              <ArrowUp className="w-4 h-4" />
              {incomingPosts.length} new post{incomingPosts.length > 1 ? 's' : ''} — tap to refresh
            </button>
          )}

          {/* Skeletons */}
          {isLoading && (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3 w-32 rounded" />
                      <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && allPosts.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-gray-500">Your feed is empty</p>
              <p className="text-sm mt-1">Follow people to see their posts here</p>
              <Link
                href="/social/people"
                className="mt-4 inline-block px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Find people to follow →
              </Link>
            </div>
          )}

          {/* Posts */}
          <div className="space-y-4">
            {allPosts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
              <p className="text-gray-600 mb-4">Failed to load feed</p>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={loaderRef} className="h-8 flex items-center justify-center">
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="w-4 h-4 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
                Loading more…
              </div>
            )}
            {!hasNextPage && allPosts.length > 0 && !isError && (
              <p className="text-xs text-gray-300">You're all caught up ✓</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page export (Suspense boundary for useSearchParams) ─────────────────────
export default function FeedPage() {
  return (
    <Suspense fallback={
      <div className="max-w-xl mx-auto space-y-4 pb-10">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <Skeleton className="h-10 w-full rounded" />
          </div>
        ))}
      </div>
    }>
      <FeedContent />
    </Suspense>
  )
}
