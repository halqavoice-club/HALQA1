'use client'
import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { postsApi, type Post } from '@/lib/posts'
import { groupChatApi } from '@/lib/groupChat'
import { dmApi } from '@/lib/dm'
import { buildShareUrl } from '@/lib/postUtils'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getAvatarUrl } from '@/lib/avatar'
import { Share2, Repeat2, Link2, Users, MessageCircle, X, Loader2, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  post: Post
  onShared?: () => void   // called after a successful repost/quote so parent can bump share count
  shareCount?: number     // current repost count to display on the pill
  variant?: 'light' | 'dark'  // 'dark' = white icon for video overlays, 'light' = default gray pill
}

export function ShareMenu({ post, onShared, shareCount = 0, variant = 'light' }: Props) {
  const [open, setOpen]                     = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const [showDmPicker, setShowDmPicker]       = useState(false)
  const [showQuote, setShowQuote]           = useState(false)
  const menuRef                             = useRef<HTMLDivElement>(null)
  const { toast }                 = useToast()
  const queryClient               = useQueryClient()

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const repostMutation = useMutation({
    mutationFn: () =>
      postsApi.create({ type: 'REPOST', originalPostId: post.id, visibility: 'PUBLIC' }),
    onSuccess: () => {
      toast({ title: '✅ Shared to your feed!' })
      onShared?.()
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      setOpen(false)
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to share', variant: 'destructive' })
      setOpen(false)
    },
  })

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(post.id))
      toast({ title: '🔗 Link copied!' })
      // MF-006: increment shareCount for clipboard shares (fire-and-forget)
      postsApi.recordShare(post.id).catch(() => {})
      onShared?.()
    } catch {
      toast({ title: 'Failed to copy link', variant: 'destructive' })
    }
    setOpen(false)
  }

  const handleShareToGroup = () => {
    setOpen(false)
    setShowGroupPicker(true)
  }

  const handleShareToDm = () => {
    setOpen(false)
    setShowDmPicker(true)
  }

  const handleQuotePost = () => {
    setOpen(false)
    setShowQuote(true)
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-full text-sm font-semibold transition-colors',
            variant === 'dark'
              ? 'w-12 h-12 justify-center bg-black/30 text-white hover:bg-black/50'
              : 'px-3.5 py-1.5 bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          <Share2 className="w-4 h-4" />
          {shareCount > 0 && (
            <span>
              {shareCount >= 1_000_000
                ? `${(shareCount / 1_000_000).toFixed(1)}M`
                : shareCount >= 1_000
                ? `${(shareCount / 1_000).toFixed(shareCount >= 10_000 ? 0 : 1)}K`
                : shareCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className={cn(
              'absolute bottom-full mb-1 left-0 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 min-w-[180px]',
              'animate-in fade-in slide-in-from-bottom-2 duration-150',
              variant === 'dark' ? 'z-[9999]' : 'z-20'
            )}>
              <button
                onClick={() => repostMutation.mutate()}
                disabled={repostMutation.isPending}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Repeat2 className="w-4 h-4 text-green-500" />
                Share to feed
              </button>
              <button
                onClick={handleQuotePost}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Quote className="w-4 h-4 text-indigo-500" />
                Quote post
              </button>
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Link2 className="w-4 h-4 text-blue-500" />
                Copy link
              </button>
              <button
                onClick={handleShareToGroup}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Users className="w-4 h-4 text-purple-500" />
                Share to group
              </button>
              <button
                onClick={handleShareToDm}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-rose-500" />
                Share to DM
              </button>
            </div>
          </>
        )}
      </div>

      {/* Group picker modal */}
      <AnimatePresence>
        {showGroupPicker && (
          <GroupShareModal
            post={post}
            onClose={() => setShowGroupPicker(false)}
          />
        )}
        {showDmPicker && (
          <DmShareModal
            post={post}
            onClose={() => setShowDmPicker(false)}
          />
        )}
        {showQuote && (
          <QuotePostModal
            post={post}
            onClose={() => setShowQuote(false)}
            onShared={onShared}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── DM picker modal ─────────────────────────────────────────────────────────

function DmShareModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const { toast } = useToast()
  const [sending, setSending] = useState<string | null>(null)
  const shareUrl = buildShareUrl(post.id)

  const { data: convs = [], isLoading } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: async () => {
      const res = await dmApi.conversations()
      return Array.isArray(res.data?.data) ? res.data.data : []
    },
    staleTime: 60_000,
  })

  const handleSendToDm = async (convId: string, recipientName: string) => {
    setSending(convId)
    try {
      const body = [
        post.body ? post.body.slice(0, 100) + (post.body.length > 100 ? '…' : '') : '',
        shareUrl,
      ].filter(Boolean).join('\n')

      await dmApi.send(convId, { body, msgType: 'TEXT' })
      toast({ title: `✅ Shared to ${recipientName}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to share', variant: 'destructive' })
    } finally {
      setSending(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50"
      />

      {/* Sheet */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-rose-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Share via DM</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Post preview */}
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500 line-clamp-2">
            {post.body?.slice(0, 100) || shareUrl}
          </p>
        </div>

        {/* DM conversation list */}
        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : convs.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Start a DM first</p>
            </div>
          ) : (
            convs.map((conv: any) => {
              const other = conv.other ?? {}
              const name = `${other.firstName ?? ''} ${other.lastName ?? ''}`.trim() || 'Unknown'
              const avatarSrc = getAvatarUrl(other.avatarUrl)
              const initials = `${other.firstName?.charAt(0) ?? ''}${other.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
              return (
                <button
                  key={conv.id}
                  onClick={() => handleSendToDm(conv.id, name)}
                  disabled={!!sending}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {avatarSrc
                      ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                      : <span className="text-rose-600 font-semibold text-sm">{initials}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
                    {other.username && <p className="text-xs text-gray-400">@{other.username}</p>}
                  </div>
                  {sending === conv.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-rose-500 flex-shrink-0" />
                    : <MessageCircle className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  }
                </button>
              )
            })
          )}
        </div>

        {/* Cancel */}
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </>
  )
}

// ─── Group picker modal ───────────────────────────────────────────────────────

function GroupShareModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const { toast } = useToast()
  const [sending, setSending] = useState<string | null>(null)
  const shareUrl = buildShareUrl(post.id)

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['group-chat-conversations'],
    queryFn: async () => {
      const res = await groupChatApi.list()
      return Array.isArray(res.data?.data) ? res.data.data : []
    },
    staleTime: 60_000,
  })

  const handleSendToGroup = async (convId: string, convName: string) => {
    setSending(convId)
    try {
      // Build a tidy share message: title + link
      const body = [
        post.body ? post.body.slice(0, 100) + (post.body.length > 100 ? '…' : '') : '',
        shareUrl,
      ].filter(Boolean).join('\n')

      await groupChatApi.send(convId, { body, type: 'TEXT' })
      toast({ title: `✅ Shared to ${convName}` })
      onClose()
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to share', variant: 'destructive' })
    } finally {
      setSending(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50"
      />

      {/* Sheet */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Share to Group</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Post preview */}
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500 line-clamp-2">
            {post.body?.slice(0, 100) || shareUrl}
          </p>
        </div>

        {/* Group list */}
        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No groups yet</p>
              <p className="text-xs mt-1">Create a group first in Group Chat</p>
            </div>
          ) : (
            groups.map((conv: any) => (
              <button
                key={conv.id}
                onClick={() => handleSendToGroup(conv.id, conv.name)}
                disabled={!!sending}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {conv.avatarUrl
                    ? <img src={conv.avatarUrl} alt="" className="w-full h-full object-cover" />
                    : <span className="text-indigo-600 font-semibold text-sm">
                        {conv.name?.slice(0, 2).toUpperCase() || '??'}
                      </span>
                  }
                </div>
                {/* Name + member count */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{conv.name}</p>
                  <p className="text-xs text-gray-400">{conv.memberCount || 0} members</p>
                </div>
                {/* Spinner or send icon */}
                {sending === conv.id
                  ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" />
                  : <Share2 className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 flex-shrink-0" />
                }
              </button>
            ))
          )}
        </div>

        {/* Cancel */}
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </>
  )
}

// ─── Quote post modal ─────────────────────────────────────────────────────────

function QuotePostModal({ post, onClose, onShared }: { post: Post; onClose: () => void; onShared?: () => void }) {
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('PUBLIC')

  const avatarSrc = getAvatarUrl(user?.avatarUrl)
  const initials  = user
    ? `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || '?'
    : '?'

  const quoteMutation = useMutation({
    mutationFn: () =>
      postsApi.create({
        type:           'QUOTE',
        originalPostId: post.id,
        quotedBody:     post.body ?? '',
        body:           body.trim() || undefined,
        visibility,
      }),
    onSuccess: () => {
      toast({ title: '✅ Quote posted!' })
      onShared?.()
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      onClose()
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to quote post', variant: 'destructive' })
    },
  })

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Quote className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Quote Post</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Composer row */}
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600 flex-shrink-0">
              {avatarSrc
                ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
                : initials}
            </div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 500))}
              placeholder="Add your thoughts…"
              rows={3}
              autoFocus
              className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent leading-relaxed"
            />
          </div>

          {/* Quoted post preview */}
          <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">
                {post.author.firstName?.charAt(0) ?? '?'}
              </div>
              <span className="text-xs font-semibold text-gray-700">
                {post.author.firstName} {post.author.lastName}
              </span>
            </div>
            <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">
              {post.body ?? '(no text)'}
            </p>
            {post.media.length > 0 && (
              <div className="mt-2 rounded-lg overflow-hidden">
                <img
                  src={post.media[0].url}
                  alt=""
                  className="w-full h-20 object-cover"
                />
              </div>
            )}
          </div>

          {/* Visibility + Post button */}
          <div className="flex items-center justify-between pt-1">
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value)}
              className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300"
            >
              <option value="PUBLIC">Everyone</option>
              <option value="FOLLOWERS">Followers</option>
              <option value="PRIVATE">Only me</option>
              <option value="SCHOOL_ONLY">School only</option>
            </select>

            <button
              onClick={() => quoteMutation.mutate()}
              disabled={quoteMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {quoteMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Quote className="w-3.5 h-3.5" />
              }
              Quote
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
