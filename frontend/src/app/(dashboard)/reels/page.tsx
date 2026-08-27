'use client'
/**
 * Reels — TikTok-style vertical video feed
 *
 * Layout:
 *   - Full-screen vertical scroll snap (one reel per viewport)
 *   - Video auto-plays when 70%+ in view, pauses when out
 *   - Right-side action overlay: Like, Comment, Share, Follow, Bookmark
 *   - Bottom overlay: author info + caption
 *   - Infinite scroll — loads more when reaching the last reel
 */
import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi, type Post, type ReactionType } from '@/lib/posts'
import { socialApi } from '@/lib/social'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import {
  Heart, MessageCircle, Share2, Bookmark, BookmarkCheck,
  Volume2, VolumeX, UserPlus, UserCheck, ChevronUp, ChevronDown,
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { CommentsSection } from '@/components/feed/CommentsSection'

// ─── Single reel item ─────────────────────────────────────────────────────────
function ReelItem({
  post,
  isActive,
  globalMuted,
  onToggleMute,
}: {
  post:          Post
  isActive:      boolean
  globalMuted:   boolean
  onToggleMute:  () => void
}) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const videoRef    = useRef<HTMLVideoElement>(null)
  const [playing,   setPlaying]   = useState(false)
  const [comments,  setComments]  = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(post._count.comments)

  // Local reaction state — optimistic
  const [localMyReaction,    setLocalMyReaction]    = useState<ReactionType | undefined>(
    post.reactions?.[0]?.type as ReactionType | undefined
  )
  const [localReactionCount, setLocalReactionCount] = useState(post._count.reactions)
  const [isFollowing,        setIsFollowing]        = useState(post.isFollowing ?? false)
  const [isBookmarked,       setIsBookmarked]       = useState((post.bookmarks?.length ?? 0) > 0)

  const isOwn = user?.id === post.authorId
  const video = post.media.find(m => m.type === 'VIDEO')
  const avatarSrc = getAvatarUrl(post.author.avatarUrl)
  const initials  = `${post.author.firstName?.charAt(0) ?? ''}${post.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'

  // Auto-play/pause based on isActive
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (isActive) {
      v.play().then(() => setPlaying(true)).catch(() => {})
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [isActive])

  // Sync mute
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = globalMuted
  }, [globalMuted])

  // Tap to play/pause
  const handleTap = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else          { v.pause(); setPlaying(false) }
  }

  // ── Reaction ───────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: () => postsApi.react(post.id, localMyReaction ?? 'LIKE'),
    onMutate: () => {
      const removing = !!localMyReaction
      setLocalMyReaction(removing ? undefined : 'LIKE')
      setLocalReactionCount(c => removing ? Math.max(0, c - 1) : c + 1)
    },
    onError: () => {
      setLocalMyReaction(post.reactions?.[0]?.type as ReactionType | undefined)
      setLocalReactionCount(post._count.reactions)
      toast({ title: 'Failed to react', variant: 'destructive' })
    },
  })

  // ── Bookmark ───────────────────────────────────────────────────────────────
  const bookmarkMutation = useMutation({
    mutationFn: () => postsApi.bookmark(post.id),
    onMutate: () => setIsBookmarked(v => !v),
    onError:  () => {
      setIsBookmarked(v => !v)
      toast({ title: 'Failed to save', variant: 'destructive' })
    },
  })

  // ── Follow ─────────────────────────────────────────────────────────────────
  const followMutation = useMutation({
    mutationFn: () => isFollowing ? socialApi.unfollow(post.authorId) : socialApi.follow(post.authorId),
    onMutate: () => setIsFollowing(v => !v),
    onError:  () => {
      setIsFollowing(v => !v)
      toast({ title: 'Failed to update follow', variant: 'destructive' })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed-following'] }),
  })

  // Guard: only render if post has video media
  if (!video) return null

  const formatCount = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(1)}K`
    : String(n)

  return (
    <div className="relative w-full h-screen flex-shrink-0 snap-start snap-always bg-black overflow-hidden">
      {/* ── Video ────────────────────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        src={resolveMediaUrl(video.url)}
        className="absolute inset-0 w-full h-full object-cover"
        loop
        playsInline
        muted={globalMuted}
        preload="metadata"
        onClick={handleTap}
      />

      {/* Play/pause overlay icon (brief flash) */}
      {!playing && isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center">
            <div className="w-0 h-0 border-t-[12px] border-b-[12px] border-l-[20px] border-t-transparent border-b-transparent border-l-white ml-1" />
          </div>
        </div>
      )}

      {/* ── Mute toggle — top right ───────────────────────────────────────────── */}
      <button
        onClick={onToggleMute}
        className="absolute top-4 right-4 z-20 w-10 h-10 bg-black/40 rounded-full flex items-center justify-center"
      >
        {globalMuted
          ? <VolumeX className="w-5 h-5 text-white" />
          : <Volume2 className="w-5 h-5 text-white" />
        }
      </button>

      {/* ── Right action bar ─────────────────────────────────────────────────── */}
      <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5">
        {/* Avatar + Follow */}
        <div className="relative flex flex-col items-center gap-1">
          <Link href={`/social/profile/${post.authorId}`}>
            <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-white bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
              {avatarSrc
                ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                : initials}
            </div>
          </Link>
          {!isOwn && (
            <button
              onClick={() => followMutation.mutate()}
              disabled={followMutation.isPending}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-colors',
                isFollowing ? 'bg-gray-400' : 'bg-indigo-600'
              )}
            >
              {isFollowing
                ? <UserCheck className="w-3.5 h-3.5 text-white" />
                : <UserPlus  className="w-3.5 h-3.5 text-white" />
              }
            </button>
          )}
        </div>

        {/* Like */}
        <button
          onClick={() => reactMutation.mutate()}
          disabled={reactMutation.isPending}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            'w-12 h-12 rounded-full bg-black/30 flex items-center justify-center transition-colors',
            localMyReaction && 'bg-red-500/80'
          )}>
            <Heart className={cn('w-6 h-6', localMyReaction ? 'fill-white text-white' : 'text-white')} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">
            {formatCount(localReactionCount)}
          </span>
        </button>

        {/* Comment */}
        <button
          onClick={() => setComments(v => !v)}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            'w-12 h-12 rounded-full bg-black/30 flex items-center justify-center transition-colors',
            comments && 'bg-indigo-500/80'
          )}>
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">
            {formatCount(localCommentCount)}
          </span>
        </button>

        {/* Share */}
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/feed/post/${post.id}`)
            toast({ title: '🔗 Link copied!' })
          }}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 rounded-full bg-black/30 flex items-center justify-center">
            <Share2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">Share</span>
        </button>

        {/* Bookmark */}
        <button
          onClick={() => bookmarkMutation.mutate()}
          disabled={bookmarkMutation.isPending}
          className="flex flex-col items-center gap-1"
        >
          <div className={cn(
            'w-12 h-12 rounded-full bg-black/30 flex items-center justify-center transition-colors',
            isBookmarked && 'bg-indigo-500/80'
          )}>
            {isBookmarked
              ? <BookmarkCheck className="w-6 h-6 text-white" />
              : <Bookmark      className="w-6 h-6 text-white" />
            }
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">Save</span>
        </button>
      </div>

      {/* ── Bottom info overlay ───────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-16 z-20 p-4 pb-6 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
        <Link href={`/social/profile/${post.authorId}`} className="flex items-center gap-2 mb-2">
          <span className="text-white font-bold text-sm drop-shadow">
            @{post.author.firstName}{post.author.lastName}
          </span>
          <span className="text-white/60 text-xs">
            {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
          </span>
        </Link>
        {post.body && (
          <p className="text-white text-sm leading-relaxed line-clamp-2 drop-shadow">
            {post.body}
          </p>
        )}
      </div>

      {/* ── Comments sheet ────────────────────────────────────────────────────── */}
      {comments && (
        <>
          <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setComments(false)} />
          <div className="absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl max-h-[60vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">{localCommentCount} Comments</h3>
              <button onClick={() => setComments(false)} className="text-gray-400 hover:text-gray-600 text-sm">
                Close
              </button>
            </div>
            <CommentsSection
              postId={post.id}
              initialCount={localCommentCount}
              open={true}
              onCommentAdded={() => setLocalCommentCount(c => c + 1)}
              onCommentDeleted={() => setLocalCommentCount(c => Math.max(0, c - 1))}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Reels feed ───────────────────────────────────────────────────────────────
function ReelsFeed() {
  const { toast }       = useToast()
  const containerRef    = useRef<HTMLDivElement>(null)
  const [activeIdx,     setActiveIdx]  = useState(0)
  const [globalMuted,   setGlobalMuted] = useState(true)
  const sentinelRef     = useRef<HTMLDivElement>(null)

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading,
  } = useInfiniteQuery({
    queryKey:         ['reels'],
    queryFn:          ({ pageParam }) =>
      postsApi.getReels(pageParam as string | undefined).then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime:        60_000,
  })

  const reels = (data?.pages.flatMap(p => p.items) ?? [])
    .filter(p => p.media.some(m => m.type === 'VIDEO'))

  // ── Intersection observer to track active reel ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const children = Array.from(container.children) as HTMLElement[]
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            const idx = children.indexOf(entry.target as HTMLElement)
            if (idx !== -1) setActiveIdx(idx)
          }
        })
      },
      { threshold: 0.7 }
    )
    children.forEach(child => observer.observe(child))
    return () => observer.disconnect()
  }, [reels.length])

  // ── Infinite scroll sentinel ───────────────────────────────────────────────
  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }, { threshold: 0.1 })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        setActiveIdx(i => Math.min(reels.length - 1, i + 1))
        containerRef.current?.children[Math.min(reels.length - 1, activeIdx + 1)]?.scrollIntoView({ behavior: 'smooth' })
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        setActiveIdx(i => Math.max(0, i - 1))
        containerRef.current?.children[Math.max(0, activeIdx - 1)]?.scrollIntoView({ behavior: 'smooth' })
      }
      if (e.key === 'm') setGlobalMuted(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIdx, reels.length])

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (!reels.length) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 text-white">
        <p className="text-xl font-bold">No reels yet</p>
        <p className="text-white/60 text-sm">Videos posted by people will appear here</p>
        <Link href="/feed" className="mt-4 px-4 py-2 bg-indigo-600 rounded-xl text-sm font-semibold">
          Back to Feed
        </Link>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* Navigation arrows */}
      <div className="absolute left-1/2 -translate-x-1/2 top-4 z-50 flex items-center gap-4">
        <Link
          href="/feed"
          className="text-white/70 hover:text-white text-sm font-semibold transition-colors"
        >
          ← Feed
        </Link>
        <span className="text-white/40 text-xs">{activeIdx + 1} / {reels.length}</span>
      </div>

      {/* Scroll up/down hint buttons */}
      {activeIdx > 0 && (
        <button
          className="absolute top-16 left-1/2 -translate-x-1/2 z-50 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"
          onClick={() => {
            const prev = Math.max(0, activeIdx - 1)
            containerRef.current?.children[prev]?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          <ChevronUp className="w-5 h-5 text-white" />
        </button>
      )}
      {activeIdx < reels.length - 1 && (
        <button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center animate-bounce"
          onClick={() => {
            const next = Math.min(reels.length - 1, activeIdx + 1)
            containerRef.current?.children[next]?.scrollIntoView({ behavior: 'smooth' })
          }}
        >
          <ChevronDown className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Vertical snap scroll container */}
      <div
        ref={containerRef}
        className="h-full overflow-y-scroll snap-y snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {reels.map((post, idx) => (
          <ReelItem
            key={post.id}
            post={post}
            isActive={idx === activeIdx}
            globalMuted={globalMuted}
            onToggleMute={() => setGlobalMuted(v => !v)}
          />
        ))}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-4 bg-black" />

        {isFetchingNextPage && (
          <div className="h-screen bg-black flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReelsPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <ReelsFeed />
    </Suspense>
  )
}
