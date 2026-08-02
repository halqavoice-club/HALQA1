'use client'
import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { postsApi, type Post } from '@/lib/posts'
import { groupChatApi } from '@/lib/groupChat'
import { buildShareUrl } from '@/lib/postUtils'
import { useToast } from '@/components/ui/use-toast'
import { Share2, Repeat2, Link2, Users, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  post: Post
}

export function ShareMenu({ post }: Props) {
  const [open, setOpen]           = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)
  const menuRef                   = useRef<HTMLDivElement>(null)
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
    } catch {
      toast({ title: 'Failed to copy link', variant: 'destructive' })
    }
    setOpen(false)
  }

  const handleShareToGroup = () => {
    setOpen(false)
    setShowGroupPicker(true)
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-gray-500 hover:text-green-600 hover:bg-green-50 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">Share</span>
          {post.shareCount > 0 && (
            <span className="text-xs text-gray-400">{post.shareCount}</span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className={cn(
              'absolute bottom-full mb-1 left-0 z-20 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 min-w-[180px]',
              'animate-in fade-in slide-in-from-bottom-2 duration-150'
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
      </AnimatePresence>
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
