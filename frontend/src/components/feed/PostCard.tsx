'use client'
/**
 * PostCard v2 — with full edit + delete for own posts + view count tracking
 */
import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi, type Post, type ReactionType } from '@/lib/posts'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { resolveMediaUrl } from '@/lib/media'
import { renderBodyText } from '@/lib/postUtils'
import { cn } from '@/lib/utils'
import { ReactionPicker } from './ReactionPicker'
import { CommentsSection } from './CommentsSection'
import { ShareMenu } from './ShareMenu'
import { MediaGrid } from './MediaGrid'
import { LinkPreviewCard } from './LinkPreviewCard'
import { MediaViewer } from './MediaViewer'
import {
  MessageCircle, Bookmark, BookmarkCheck,
  MoreHorizontal, Trash2, Pin, PinOff, Flag,
  Repeat2, Globe, Users, Lock, School, MapPin,
  Pencil, X, Check, Loader2, Eye,
} from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

const VIS_ICON: Record<string, React.ElementType> = {
  PUBLIC: Globe, FOLLOWERS: Users, PRIVATE: Lock, SCHOOL_ONLY: School,
}

const VISIBILITY_OPTIONS = [
  { value: 'PUBLIC',      label: 'Everyone',    icon: Globe },
  { value: 'FOLLOWERS',   label: 'Followers',   icon: Users },
  { value: 'PRIVATE',     label: 'Only me',     icon: Lock },
  { value: 'SCHOOL_ONLY', label: 'School only', icon: School },
]

interface Props {
  post:                Post
  compact?:            boolean
  defaultCommentsOpen?: boolean
}

export function PostCard({ post, compact = false, defaultCommentsOpen = false }: Props) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const editRef     = useRef<HTMLTextAreaElement>(null)
  const cardRef     = useRef<HTMLElement>(null)
  const viewedRef   = useRef(false) // prevent duplicate view calls

  const [showMenu,       setShowMenu]       = useState(false)
  const [mediaIdx,       setMediaIdx]       = useState<number | null>(null)
  const [commentsOpen,   setCommentsOpen]   = useState(defaultCommentsOpen)
  const [bodyExpanded,   setBodyExpanded]   = useState(false)
  // Local view count — starts with server value, increments when viewed
  const [viewCount, setViewCount] = useState(post.viewCount ?? 0)

  // ── Intersection Observer — fire view when 50% of card visible for 1s ───────
  useEffect(() => {
    if (viewedRef.current) return // already counted this mount
    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !viewedRef.current) {
          // Must be visible for at least 1 second
          const timer = setTimeout(() => {
            if (viewedRef.current) return
            viewedRef.current = true
            setViewCount(c => c + 1)
            postsApi.recordView(post.id).catch(() => {}) // fire-and-forget
          }, 1000)
          return () => clearTimeout(timer)
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [post.id])

  // ── Edit state ──────────────────────────────────────────────────────────────
  const [editing,        setEditing]        = useState(false)
  const [editBody,       setEditBody]       = useState(post.body ?? '')
  const [editVisibility, setEditVisibility] = useState(post.visibility)

  // Auto-resize textarea
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.style.height = 'auto'
      editRef.current.style.height = editRef.current.scrollHeight + 'px'
      editRef.current.focus()
    }
  }, [editing])

  const isOwn        = user?.id === post.authorId
  const myReaction   = post.reactions?.[0]?.type as ReactionType | undefined
  const isBookmarked = (post.bookmarks?.length ?? 0) > 0
  const avatarSrc    = getAvatarUrl(post.author.avatarUrl)
  const initials     = `${post.author.firstName?.charAt(0) ?? ''}${post.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
  const VisIcon      = VIS_ICON[post.visibility] ?? Globe

  const { displayText, showToggle } = renderBodyText(post.body ?? '', bodyExpanded)

  // ── Reaction ────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: (type: ReactionType) => postsApi.react(post.id, type),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
    onError:    (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  // ── Bookmark ────────────────────────────────────────────────────────────────
  const bookmarkMutation = useMutation({
    mutationFn: () => postsApi.bookmark(post.id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
    onError:    (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  // ── Edit ────────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: () => postsApi.update(post.id, {
      body: editBody.trim() || undefined,
      visibility: editVisibility,
    }),
    onSuccess: (res) => {
      toast({ title: '✅ Post updated' })
      setEditing(false)
      // Patch the cached post in-place so feed updates instantly
      queryClient.setQueryData(['feed'], (old: any) => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.map((p: Post) =>
              p.id === post.id ? { ...p, ...res.data.data } : p
            ),
          })),
        }
      })
      queryClient.invalidateQueries({ queryKey: ['post', post.id] })
    },
    onError: (e: any) => toast({
      title: e?.response?.data?.message || 'Failed to update post',
      variant: 'destructive',
    }),
  })

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => postsApi.remove(post.id),
    onSuccess: () => {
      toast({ title: '🗑️ Post deleted' })
      // Remove from feed cache immediately
      queryClient.setQueryData(['feed'], (old: any) => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.filter((p: Post) => p.id !== post.id),
          })),
        }
      })
      queryClient.invalidateQueries({ queryKey: ['user-posts'] })
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Failed to delete post'
      const status = e?.response?.status
      if (status === 401) {
        toast({ title: 'Session expired — please log in again', variant: 'destructive' })
      } else if (status === 403) {
        toast({ title: 'You can only delete your own posts', variant: 'destructive' })
      } else {
        toast({ title: msg, variant: 'destructive' })
      }
    },
  })

  // ── Pin ─────────────────────────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: () => postsApi.pin(post.id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['user-posts'] }),
  })

  const handleDelete = () => {
    // Double-check ownership before sending delete request
    if (!isOwn) {
      toast({ title: 'You can only delete your own posts', variant: 'destructive' })
      return
    }
    if (!confirm('Delete this post? This cannot be undone.')) return
    setShowMenu(false)
    deleteMutation.mutate()
  }

  const handleEditOpen = () => {
    if (!isOwn) return
    setEditBody(post.body ?? '')
    setEditVisibility(post.visibility)
    setEditing(true)
    setShowMenu(false)
  }

  const handleEditCancel = () => {
    setEditing(false)
    setEditBody(post.body ?? '')
    setEditVisibility(post.visibility)
  }

  const handleEditSave = () => {
    if (!editBody.trim() && post.media.length === 0) {
      toast({ title: 'Post cannot be empty', variant: 'destructive' })
      return
    }
    editMutation.mutate()
  }

  const handleReport = () => {
    postsApi.report(post.id, 'inappropriate').catch(() => {})
    toast({ title: 'Report submitted' })
    setShowMenu(false)
  }

  // ── Body rendering — hashtags + @mentions ──────────────────────────────────
  const renderBody = (text: string) =>
    text.split(/(\s+)/).map((word, i) => {
      if (word.startsWith('#')) {
        return (
          <Link key={i} href={`/explore/hashtag/${word.slice(1)}`}
            className="text-indigo-600 hover:underline font-medium">
            {word}
          </Link>
        )
      }
      if (word.startsWith('@')) {
        return <span key={i} className="text-indigo-500 font-medium">{word}</span>
      }
      return word
    })

  return (
    <article
      ref={cardRef}
      className={cn(
        'bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow',
        compact ? 'p-3' : 'p-4',
        post.isPinned && 'ring-1 ring-indigo-200'
      )}
    >
      {/* Pinned indicator */}
      {post.isPinned && (
        <div className="flex items-center gap-1 text-xs text-indigo-500 font-semibold mb-2">
          <Pin className="w-3 h-3" /> Pinned
        </div>
      )}

      {/* Repost banner */}
      {post.type === 'REPOST' && post.originalPost && (
        <div className="text-xs text-gray-400 flex items-center gap-1 mb-2">
          <Repeat2 className="w-3.5 h-3.5" />
          <Link href={`/social/profile/${post.authorId}`} className="font-semibold hover:underline">
            {post.author.firstName}
          </Link>{' '}reposted
        </div>
      )}

      {/* ── Author header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <Link href={`/social/profile/${post.authorId}`}>
            <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
              {avatarSrc
                ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                : initials}
            </div>
          </Link>
          <div>
            <Link href={`/social/profile/${post.authorId}`}
              className="text-sm font-semibold text-gray-900 hover:underline">
              {post.author.firstName} {post.author.lastName}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
              <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
              {post.updatedAt !== post.createdAt && (
                <span className="text-gray-300">· edited</span>
              )}
              <span>·</span>
              <VisIcon className="w-3 h-3" />
              {post.location && (
                <>
                  <span>·</span>
                  <MapPin className="w-3 h-3" />
                  <span>{post.location}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3-dot menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowMenu(v => !v)}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
            aria-label="Post options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 z-20 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 min-w-[170px]">
                {isOwn ? (
                  <>
                    {/* Edit */}
                    <button
                      onClick={handleEditOpen}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4 text-indigo-500" />
                      Edit post
                    </button>

                    {/* Pin / Unpin */}
                    <button
                      onClick={() => { pinMutation.mutate(); setShowMenu(false) }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {post.isPinned
                        ? <PinOff className="w-4 h-4 text-gray-400" />
                        : <Pin className="w-4 h-4 text-gray-400" />}
                      {post.isPinned ? 'Unpin' : 'Pin post'}
                    </button>

                    <div className="h-px bg-gray-100 mx-3 my-0.5" />

                    {/* Delete */}
                    <button
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {deleteMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                      Delete post
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleReport}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-orange-500 hover:bg-orange-50 transition-colors"
                  >
                    <Flag className="w-4 h-4" /> Report
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Inline edit form (replaces body when editing) ──────────────────── */}
      {editing ? (
        <div className="mb-3 space-y-2">
          <textarea
            ref={editRef}
            value={editBody}
            onChange={e => {
              setEditBody(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = e.target.scrollHeight + 'px'
            }}
            maxLength={5000}
            rows={3}
            placeholder="What's on your mind?"
            className="w-full resize-none rounded-xl border border-indigo-200 bg-indigo-50/30 px-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-indigo-300 leading-relaxed transition"
          />

          {/* Character counter */}
          {editBody.length > 4000 && (
            <p className={cn(
              'text-xs text-right',
              editBody.length >= 5000 ? 'text-red-500' : 'text-gray-400'
            )}>
              {5000 - editBody.length} left
            </p>
          )}

          {/* Visibility selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">Visible to:</span>
            <div className="flex items-center gap-1">
              {VISIBILITY_OPTIONS.map(opt => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    onClick={() => setEditVisibility(opt.value)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                      editVisibility === opt.value
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Save / Cancel buttons */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={handleEditCancel}
              disabled={editMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={editMutation.isPending || (!editBody.trim() && post.media.length === 0)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-40"
            >
              {editMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                : <><Check className="w-3.5 h-3.5" /> Save</>
              }
            </button>
          </div>
        </div>
      ) : (
        /* ── Normal body display ────────────────────────────────────────── */
        post.body && (
          <div className="mb-3">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {renderBody(displayText)}
            </p>
            {showToggle && (
              <button
                onClick={() => setBodyExpanded(v => !v)}
                className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 mt-1"
              >
                {bodyExpanded ? 'See less' : 'See more'}
              </button>
            )}
          </div>
        )
      )}

      {/* ── Media grid ──────────────────────────────────────────────────────── */}
      {post.media.length > 0 && (
        <div className="mb-3">
          <MediaGrid media={post.media} onOpen={setMediaIdx} />
        </div>
      )}

      {/* ── Quoted post ──────────────────────────────────────────────────────── */}
      {post.type === 'QUOTE' && post.originalPost && (
        <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-gray-50">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">
              {post.originalPost.author.firstName?.charAt(0) ?? '?'}
            </div>
            <span className="text-xs font-semibold text-gray-700">
              {post.originalPost.author.firstName} {post.originalPost.author.lastName}
            </span>
          </div>
          <p className="text-xs text-gray-600 line-clamp-3">{post.originalPost.body}</p>
          {post.originalPost.media.length > 0 && (
            <div className="mt-2 rounded-lg overflow-hidden">
              <img
                src={resolveMediaUrl(post.originalPost.media[0].url)}
                alt=""
                loading="lazy"
                className="w-full h-24 object-cover"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Link preview ─────────────────────────────────────────────────────── */}
      {post.linkUrl && post.linkTitle && (
        <div className="mb-3">
          <LinkPreviewCard
            linkUrl={post.linkUrl}
            linkTitle={post.linkTitle}
            linkDescription={post.linkDescription}
            linkImage={post.linkImage}
          />
        </div>
      )}

      {/* ── Reaction + comment counts ────────────────────────────────────────── */}
      {(post._count.reactions > 0 || post._count.comments > 0 || viewCount > 0) && (
        <div className="flex items-center justify-between text-xs text-gray-400 mb-2 pb-2 border-b border-gray-50">
          <div className="flex items-center gap-3">
            <span>
              {post._count.reactions > 0 &&
                `${post._count.reactions} reaction${post._count.reactions !== 1 ? 's' : ''}`}
            </span>
            {/* View count — shown to post author only, or as small indicator for all */}
            {viewCount > 0 && (
              <span className="flex items-center gap-1 text-gray-300">
                <Eye className="w-3 h-3" />
                {viewCount.toLocaleString()}
              </span>
            )}
          </div>
          <button onClick={() => setCommentsOpen(v => !v)} className="hover:underline">
            {post._count.comments > 0 &&
              `${post._count.comments} comment${post._count.comments !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <ReactionPicker
            postId={post.id}
            current={myReaction}
            count={post._count.reactions}
            onReact={t => reactMutation.mutate(t)}
            disabled={reactMutation.isPending}
          />

          <button
            onClick={() => setCommentsOpen(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition-colors',
              commentsOpen
                ? 'text-indigo-600 bg-indigo-50'
                : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            )}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Comment</span>
            {post._count.comments > 0 && (
              <span className="text-xs text-gray-400">{post._count.comments}</span>
            )}
          </button>

          <ShareMenu post={post} />
        </div>

        <button
          onClick={() => bookmarkMutation.mutate()}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-sm transition-colors',
            isBookmarked
              ? 'text-indigo-600 bg-indigo-50'
              : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
          )}
        >
          {isBookmarked
            ? <BookmarkCheck className="w-4 h-4" />
            : <Bookmark className="w-4 h-4" />
          }
        </button>
      </div>

      {/* ── Inline comments ──────────────────────────────────────────────────── */}
      <CommentsSection
        postId={post.id}
        initialCount={post._count.comments}
        open={commentsOpen}
      />

      {/* ── Media lightbox ───────────────────────────────────────────────────── */}
      {mediaIdx !== null && (
        <MediaViewer
          media={post.media}
          initialIndex={mediaIdx}
          onClose={() => setMediaIdx(null)}
        />
      )}
    </article>
  )
}
