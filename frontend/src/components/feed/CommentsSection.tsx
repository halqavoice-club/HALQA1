'use client'
/**
 * CommentsSection v3
 * - Top-level comments with infinite scroll
 * - Expandable inline replies per comment
 * - Edit + Delete on both comments AND replies (own only)
 * - Like reaction on both
 * - Optimistic add for both comments and replies
 */
import { useState, useRef, useCallback } from 'react'
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { postsApi, type Comment, type ReactionType } from '@/lib/posts'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { formatDistanceToNow } from 'date-fns'
import {
  Send, Loader2, CornerDownRight, ThumbsUp,
  Pencil, Trash2, X, Check, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  postId:           string
  initialCount:     number
  open:             boolean
  onCommentAdded?:  () => void
  onCommentDeleted?: () => void
}

// ─── Shared CommentRow — used for both top-level comments and replies ──────────
function CommentRow({
  comment,
  postId,
  depth = 0,
  onReplyTo,
  onDeleted,
  showReplies = true,
}: {
  comment:      Comment & { _optimistic?: boolean }
  postId:       string
  depth?:       number
  onReplyTo:    (c: Comment) => void
  onDeleted?:   () => void
  showReplies?: boolean
}) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const isOwn       = user?.id === comment.authorId
  const myReaction  = comment.reactions?.[0]?.type as ReactionType | undefined
  const avatarSrc   = getAvatarUrl(comment.author.avatarUrl)
  const initials    = `${comment.author.firstName?.charAt(0) ?? ''}${comment.author.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
  const replyCount  = comment._count?.replies ?? 0

  const [editing,        setEditing]        = useState(false)
  const [editBody,       setEditBody]       = useState(comment.body)
  const [repliesOpen,    setRepliesOpen]    = useState(false)
  const [replyText,      setReplyText]      = useState('')
  const [showReplyInput, setShowReplyInput] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // ── React ────────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: () => postsApi.reactComment(postId, comment.id, myReaction ?? 'LIKE'),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
    onError:    (e: any) => toast({ title: e?.response?.data?.message || 'Failed', variant: 'destructive' }),
  })

  // ── Edit ─────────────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: (body: string) => postsApi.editComment(postId, comment.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      queryClient.invalidateQueries({ queryKey: ['replies', postId, comment.parentId ?? ''] })
      setEditing(false)
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message || 'Failed to edit', variant: 'destructive' }),
  })

  // ── Delete ────────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => postsApi.deleteComment(postId, comment.id),
    onMutate: async () => {
      // Optimistically remove from whichever list this comment is in
      const parentKey = comment.parentId
        ? ['replies', postId, comment.parentId]
        : ['comments', postId]

      await queryClient.cancelQueries({ queryKey: parentKey })
      const prev = queryClient.getQueryData(parentKey)

      const removeFromPages = (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.filter((c: Comment) => c.id !== comment.id),
          })),
        }
      }

      queryClient.setQueryData(parentKey, removeFromPages)
      return { prev, parentKey }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx) queryClient.setQueryData(ctx.parentKey, ctx.prev)
      toast({ title: 'Failed to delete', variant: 'destructive' })
    },
    onSuccess: () => {
      // Only decrement for top-level comments (depth 0), not replies
      if (!comment.parentId) onDeleted?.()
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })

  // ── Add reply ─────────────────────────────────────────────────────────────────
  const replyMutation = useMutation({
    mutationFn: (body: string) => postsApi.addComment(postId, body, comment.id),
    onMutate: async (body: string) => {
      const key = ['replies', postId, comment.id]
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      const optimistic = {
        id:         uuidv4(),
        postId,
        authorId:   user?.id ?? '',
        parentId:   comment.id,
        body,
        author:     {
          id:        user?.id ?? '',
          firstName: user?.firstName ?? '',
          lastName:  user?.lastName ?? '',
          avatarUrl: user?.avatarUrl ?? null,
          role: user?.role ?? '',
          schoolId: user?.schoolId ?? null,
        },
        replyCount:  0,
        likeCount:   0,
        reactions:   [],
        _count:      { replies: 0, reactions: 0 },
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        deletedAt:   null,
        _optimistic: true,
      }
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return { pages: [{ items: [optimistic], nextCursor: null, hasMore: false }], pageParams: [undefined] }
        return {
          ...old,
          pages: [
            { ...old.pages[0], items: [...(old.pages[0]?.items ?? []), optimistic] },
            ...old.pages.slice(1),
          ],
        }
      })
      return { prev }
    },
    onError: (_e, _v, ctx: any) => {
      queryClient.setQueryData(['replies', postId, comment.id], ctx?.prev)
      toast({ title: 'Failed to add reply', variant: 'destructive' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replies', postId, comment.id] })
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      setReplyText('')
      setShowReplyInput(false)
      setRepliesOpen(true)
    },
  })

  const handleReplySubmit = () => {
    const t = replyText.trim()
    if (!t) return
    replyMutation.mutate(t)
  }

  // ── Replies (lazy-loaded only when expanded) ──────────────────────────────────
  const { data: repliesData, isLoading: repliesLoading } = useInfiniteQuery({
    queryKey:        ['replies', postId, comment.id],
    queryFn:         ({ pageParam }) =>
      postsApi.getComments(postId, pageParam as string | undefined, comment.id)
               .then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled:          repliesOpen && replyCount > 0,
    staleTime:        30_000,
  })

  const replies = repliesData?.pages.flatMap(p => p.items) ?? []

  return (
    <div className={cn('flex gap-2', comment._optimistic && 'opacity-60')}>
      {/* Avatar */}
      <div className={cn(
        'rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 flex-shrink-0 mt-0.5',
        depth === 0 ? 'w-7 h-7 text-[10px]' : 'w-6 h-6 text-[9px]'
      )}>
        {avatarSrc
          ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
          : initials}
      </div>

      <div className="flex-1 min-w-0">
        {/* Bubble */}
        <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-3 py-2">
          <span className="text-xs font-semibold text-gray-800">
            {comment.author.firstName} {comment.author.lastName}
          </span>

          {editing ? (
            <div className="mt-1 space-y-1.5">
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={2}
                maxLength={2000}
                autoFocus
                className="w-full text-sm text-gray-800 bg-white border border-indigo-200 rounded-lg px-2 py-1.5 outline-none resize-none"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { const t = editBody.trim(); if (t && t !== comment.body) editMutation.mutate(t); else setEditing(false) }}
                  disabled={editMutation.isPending || !editBody.trim()}
                  className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
                >
                  {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setEditBody(comment.body) }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{comment.body}</p>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-1 ml-1 flex-wrap">
          <span className="text-[11px] text-gray-400">
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </span>

          {/* Like */}
          <button
            onClick={() => reactMutation.mutate()}
            disabled={reactMutation.isPending}
            className={cn(
              'flex items-center gap-0.5 text-[11px] font-medium transition-colors',
              myReaction ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-600'
            )}
          >
            <ThumbsUp className="w-3 h-3" />
            {(comment._count?.reactions ?? 0) > 0 && <span>{comment._count?.reactions}</span>}
            {!myReaction && <span>Like</span>}
          </button>

          {/* Reply — only on top-level */}
          {depth === 0 && (
            <button
              className="text-[11px] text-gray-400 hover:text-indigo-600 font-medium transition-colors flex items-center gap-0.5"
              onClick={() => { setShowReplyInput(v => !v); setTimeout(() => replyRef.current?.focus(), 50) }}
            >
              <CornerDownRight className="w-3 h-3" />Reply
            </button>
          )}

          {/* Edit — own only */}
          {isOwn && !comment._optimistic && (
            <button
              onClick={() => { setEditing(true); setEditBody(comment.body) }}
              className="text-[11px] text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-0.5"
              title="Edit"
            >
              <Pencil className="w-3 h-3" />
              <span>Edit</span>
            </button>
          )}

          {/* Delete — own only */}
          {isOwn && !comment._optimistic && (
            <button
              onClick={() => { if (confirm('Delete this comment?')) deleteMutation.mutate() }}
              disabled={deleteMutation.isPending}
              className="text-[11px] text-red-400 hover:text-red-600 transition-colors disabled:opacity-40 flex items-center gap-0.5"
              title="Delete"
            >
              {deleteMutation.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <><Trash2 className="w-3 h-3" /><span>Delete</span></>
              }
            </button>
          )}
        </div>

        {/* Inline reply input */}
        {showReplyInput && depth === 0 && (
          <div className="flex gap-2 items-end mt-2">
            <div className="w-6 h-6 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-[9px] font-bold text-indigo-600 flex-shrink-0">
              {user?.avatarUrl
                ? <img src={getAvatarUrl(user.avatarUrl)} alt="" className="w-full h-full object-cover" />
                : `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`
              }
            </div>
            <div className="flex-1 flex items-end gap-1.5 bg-white border border-gray-200 rounded-2xl px-3 py-1.5">
              <textarea
                ref={replyRef}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReplySubmit() } }}
                placeholder={`Reply to ${comment.author.firstName}…`}
                rows={1}
                maxLength={2000}
                className="flex-1 resize-none text-xs text-gray-800 placeholder-gray-400 outline-none bg-transparent leading-relaxed min-h-[20px] max-h-24 overflow-y-auto"
              />
              <button
                onClick={handleReplySubmit}
                disabled={!replyText.trim() || replyMutation.isPending}
                className={cn(
                  'flex-shrink-0 p-1 rounded-lg transition-colors',
                  replyText.trim() ? 'text-indigo-600 hover:bg-indigo-50' : 'text-gray-300'
                )}
              >
                {replyMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>
        )}

        {/* Expand/collapse replies */}
        {depth === 0 && (replyCount > 0 || replies.length > 0) && (
          <button
            onClick={() => setRepliesOpen(v => !v)}
            className="mt-1.5 ml-1 flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
          >
            {repliesOpen
              ? <><ChevronUp className="w-3 h-3" /> Hide replies</>
              : <><ChevronDown className="w-3 h-3" /> {replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</>
            }
          </button>
        )}

        {/* Replies list */}
        {repliesOpen && depth === 0 && (
          <div className="mt-2 ml-2 border-l-2 border-gray-100 pl-3 space-y-2.5">
            {repliesLoading && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading replies…
              </div>
            )}
            {replies.map((reply: any) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                postId={postId}
                depth={1}
                onReplyTo={() => { setShowReplyInput(true); setTimeout(() => replyRef.current?.focus(), 50) }}
                showReplies={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────
export function CommentsSection({ postId, initialCount, open, onCommentAdded, onCommentDeleted }: Props) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const [body,    setBody]    = useState('')
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string } | null>(null)

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey:         ['comments', postId],
    queryFn:          ({ pageParam }) =>
      postsApi.getComments(postId, pageParam as string | undefined)
               .then(r => r.data.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled:          open,
    staleTime:        30_000,
  })

  const comments = data?.pages.flatMap(p => p.items) ?? []

  const addMutation = useMutation({
    mutationFn: ({ body: commentBody, parentId }: { body: string; parentId?: string }) =>
      postsApi.addComment(postId, commentBody, parentId),
    onMutate: async ({ body: commentBody, parentId }) => {
      await queryClient.cancelQueries({ queryKey: ['comments', postId] })
      const prev = queryClient.getQueryData(['comments', postId])
      const optimistic = {
        id:         uuidv4(),
        postId,
        authorId:   user?.id ?? '',
        parentId:   parentId ?? null,
        body:       commentBody,
        author: {
          id:        user?.id ?? '',
          firstName: user?.firstName ?? '',
          lastName:  user?.lastName ?? '',
          avatarUrl: user?.avatarUrl ?? null,
          role:      user?.role ?? '',
          schoolId:  user?.schoolId ?? null,
        },
        replyCount: 0, likeCount: 0,
        reactions: [], _count: { replies: 0, reactions: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null, _optimistic: true,
      }
      queryClient.setQueryData(['comments', postId], (old: any) => {
        if (!old) return { pages: [{ items: [optimistic], nextCursor: null, hasMore: false }], pageParams: [undefined] }
        return {
          ...old,
          pages: [
            { ...old.pages[0], items: [optimistic, ...(old.pages[0]?.items ?? [])] },
            ...old.pages.slice(1),
          ],
        }
      })
      return { prev }
    },
    onError: (_err, _vars, ctx: any) => {
      queryClient.setQueryData(['comments', postId], ctx?.prev)
      toast({ title: 'Failed to add comment', variant: 'destructive' })
    },
    onSuccess: () => {
      onCommentAdded?.()
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['post', postId] })
    },
  })

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim()
    if (!trimmed) return
    setBody('')
    setReplyTo(null)
    addMutation.mutate({ body: trimmed, parentId: replyTo?.id })
  }, [body, replyTo, addMutation])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  if (!open) return null

  return (
    <div className="mt-3 border-t border-gray-50 pt-3 space-y-3">
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading comments…
        </div>
      )}

      {!isLoading && comments.map((c: any) => (
        <CommentRow
          key={c.id}
          comment={c}
          postId={postId}
          depth={0}
          onReplyTo={(comment) => {
            setReplyTo({ id: comment.id, authorName: `${comment.author.firstName} ${comment.author.lastName}` })
            inputRef.current?.focus()
          }}
          onDeleted={onCommentDeleted}
        />
      ))}

      {!isLoading && comments.length === 0 && initialCount > 0 && (
        <p className="text-xs text-gray-400 text-center py-1">No comments yet</p>
      )}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full text-xs text-indigo-500 hover:underline py-1 flex items-center justify-center gap-1 disabled:opacity-40"
        >
          {isFetchingNextPage
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
            : 'Load more comments'
          }
        </button>
      )}

      {replyTo && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-500 bg-indigo-50 rounded-xl px-3 py-1.5">
          <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Replying to <strong>{replyTo.authorName}</strong></span>
          <button className="ml-auto text-gray-400 hover:text-gray-600" onClick={() => setReplyTo(null)}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Comment input */}
      <div className="flex gap-2 items-end">
        <div className="w-7 h-7 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 flex-shrink-0">
          {user?.avatarUrl
            ? <img src={getAvatarUrl(user.avatarUrl)} alt="" className="w-full h-full object-cover" />
            : `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`
          }
        </div>
        <div className="flex-1 flex items-end gap-2 bg-gray-50 rounded-2xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment…"
            rows={1}
            maxLength={2000}
            className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent leading-relaxed min-h-[24px] max-h-32 overflow-y-auto"
          />
          <button
            onClick={handleSubmit}
            disabled={!body.trim() || addMutation.isPending}
            className={cn(
              'flex-shrink-0 p-1.5 rounded-xl transition-colors',
              body.trim() ? 'text-indigo-600 hover:bg-indigo-100' : 'text-gray-300'
            )}
          >
            {addMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
      </div>
    </div>
  )
}
