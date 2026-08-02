'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { dmApi } from '@/lib/dm'
import { useDmStore, type DmConversation, type DmMessage } from '@/store/dm.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { getSocket } from '@/lib/socket'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'
import api from '@/lib/api'
import {
  Send, Search, ArrowLeft, Check, CheckCheck,
  Loader2, MessageSquare, Trash2, Paperclip, X, Image,
} from 'lucide-react'
import Link from 'next/link'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (isToday(d))     return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

function fmtFull(iso: string) {
  return format(new Date(iso), 'h:mm a')
}

function initials(u: { firstName: string; lastName: string }) {
  return `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase()
}

// ─── Status tick ──────────────────────────────────────────────────────────────
function StatusTick({ status }: { status: DmMessage['status'] }) {
  if (status === 'READ')      return <CheckCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
  if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
  return <Check className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
}

// ─── Conversation row ─────────────────────────────────────────────────────────
function ConvRow({ conv, isActive, onClick }: {
  conv: DmConversation; isActive: boolean; onClick: () => void
}) {
  const src = getAvatarUrl(conv.other.avatarUrl)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left',
        isActive && 'bg-indigo-50 border-r-2 border-indigo-500'
      )}
    >
      <div className="relative flex-shrink-0">
        <div className="w-11 h-11 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-sm">
          {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials(conv.other)}
        </div>
        {conv.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-indigo-600 rounded-full text-[9px] font-black text-white flex items-center justify-center">
            {conv.unread > 9 ? '9+' : conv.unread}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className={cn('text-sm truncate', conv.unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-700')}>
            {conv.other.firstName} {conv.other.lastName}
          </p>
          {conv.lastMessageAt && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(conv.lastMessageAt)}</span>
          )}
        </div>
        <p className={cn('text-xs truncate mt-0.5', conv.unread > 0 ? 'text-gray-700 font-medium' : 'text-gray-400')}>
          {conv.lastMessage ?? 'Start a conversation'}
        </p>
      </div>
    </button>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, isMe, showTime, onDelete }: {
  msg: DmMessage; isMe: boolean; showTime: boolean; onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isImageUrl = (s: string) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(s)
  const isFileUrl  = (s: string) => s.startsWith('/uploads/') || s.startsWith('http')

  const renderBody = () => {
    const body = msg.body
    if (isImageUrl(body)) {
      return (
        <img
          src={body}
          alt="attachment"
          className="max-w-[200px] rounded-xl object-cover"
          loading="lazy"
        />
      )
    }
    // Generic file link
    if (isFileUrl(body) && !body.includes(' ')) {
      const filename = body.split('/').pop() ?? 'file'
      return (
        <a
          href={body}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-center gap-2 text-xs underline',
            isMe ? 'text-indigo-200' : 'text-indigo-600'
          )}
        >
          <Paperclip className="w-3 h-3 flex-shrink-0" />
          {filename}
        </a>
      )
    }
    return <span>{body}</span>
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-end gap-1.5 group', isMe ? 'flex-row-reverse' : 'flex-row')}
      ref={ref}
    >
      {/* Bubble */}
      <div className={cn(
        'relative max-w-[72%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words',
        isMe
          ? 'bg-indigo-600 text-white rounded-br-sm'
          : 'bg-white text-gray-900 border border-gray-100 shadow-sm rounded-bl-sm'
      )}>
        {renderBody()}

        {/* Time + status */}
        <div className={cn(
          'flex items-center gap-1 mt-1',
          isMe ? 'justify-end' : 'justify-start'
        )}>
          <span className={cn('text-[10px]', isMe ? 'text-indigo-200' : 'text-gray-400')}>
            {fmtFull(msg.createdAt)}
          </span>
          {isMe && <StatusTick status={msg.status} />}
        </div>
      </div>

      {/* Delete button — appears on hover */}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
        title="Delete"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3.5 py-2.5 bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm w-fit">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

// ─── Date separator ───────────────────────────────────────────────────────────
function DateSep({ date }: { date: string }) {
  const d = new Date(date)
  const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy')
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-gray-100" />
      <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
function DmContent() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const {
    conversations, setConversations,
    messages, setMessages, addMessage, removeMessage, updateMessageStatus,
    activeConvId, setActiveConvId,
    typing, setTyping,
    clearUnread,
  } = useDmStore()

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [showSidebar, setShowSidebar] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const chatEndRef  = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()

  // ── Load conversations ────────────────────────────────────────────────────
  const { isLoading: convsLoading } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => dmApi.conversations().then(r => {
      setConversations(r.data.data)
      return r.data.data
    }),
    staleTime: 30000,
  })

  // ── Auto-open conversation from ?userId= param ────────────────────────────
  useEffect(() => {
    const userId = searchParams.get('userId')
    if (!userId || !user) return
    dmApi.startWith(userId)
      .then(r => {
        const conv = r.data.data
        // Add to list if not already there
        setConversations(prev => {
          if (prev.find(c => c.id === conv.id)) return prev
          return [{ ...conv, unread: 0 }, ...prev]
        })
        setActiveConvId(conv.id)
      })
      .catch(e => toast({ title: e?.response?.data?.message || 'Cannot open chat', variant: 'destructive' }))
  }, [searchParams.get('userId')]) // eslint-disable-line

  // ── Load messages when conversation changes ───────────────────────────────
  useEffect(() => {
    if (!activeConvId) return
    setHasMore(true)

    // Already loaded — just scroll
    if (messages[activeConvId]?.length) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      // Mark as read
      dmApi.markRead(activeConvId).then(() => clearUnread(activeConvId)).catch(() => {})
      return
    }

    dmApi.messages(activeConvId)
      .then(r => {
        const msgs: DmMessage[] = r.data.data
        setMessages(activeConvId, msgs)
        if (msgs.length < 30) setHasMore(false)
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 50)
        dmApi.markRead(activeConvId).then(() => clearUnread(activeConvId)).catch(() => {})
      })
      .catch(() => {})
  }, [activeConvId]) // eslint-disable-line

  // ── Scroll to bottom on new message ──────────────────────────────────────
  const currentMsgs = activeConvId ? (messages[activeConvId] ?? []) : []
  const lastMsg = currentMsgs[currentMsgs.length - 1]
  useEffect(() => {
    if (lastMsg?.senderId === user?.id) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lastMsg?.id]) // eslint-disable-line

  // ── Load older messages (infinite scroll up) ──────────────────────────────
  const loadMore = useCallback(async () => {
    if (!activeConvId || loadingMore || !hasMore) return
    const oldest = currentMsgs[0]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const r = await dmApi.messages(activeConvId, oldest.createdAt)
      const older: DmMessage[] = r.data.data
      if (older.length < 30) setHasMore(false)
      setMessages(activeConvId, [...older, ...currentMsgs])
    } finally {
      setLoadingMore(false)
    }
  }, [activeConvId, currentMsgs, loadingMore, hasMore]) // eslint-disable-line

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeConvId || sending) return
    const body = input.trim()
    setInput('')
    setSending(true)

    // Stop typing
    const socket = getSocket()
    const conv = conversations.find(c => c.id === activeConvId)
    if (socket && conv) {
      socket.emit('dm:typing_stop', { convId: activeConvId, receiverId: conv.other.id })
    }

    try {
      const r = await dmApi.send(activeConvId, body)
      const msg: DmMessage = r.data.data
      addMessage(activeConvId, msg)
      // Update conversation preview
      useDmStore.getState().updateConversationPreview(activeConvId, msg)
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
      setInput(body) // restore
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, activeConvId, sending, conversations]) // eslint-disable-line

  // ── Typing indicator ──────────────────────────────────────────────────────
  const handleTyping = useCallback(() => {
    if (!activeConvId) return
    const socket = getSocket()
    const conv = conversations.find(c => c.id === activeConvId)
    if (!socket || !conv) return

    // Only emit if not already in a typing window (debounce)
    if (!typingTimer.current) {
      socket.emit('dm:typing_start', { convId: activeConvId, receiverId: conv.other.id })
    }
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      socket.emit('dm:typing_stop', { convId: activeConvId, receiverId: conv.other.id })
      typingTimer.current = undefined
    }, 2500)
  }, [activeConvId, conversations])

  // ── Delete message ────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (msgId: string) => {
    if (!activeConvId) return
    try {
      await dmApi.deleteMessage(msgId)
      removeMessage(activeConvId, msgId)
    } catch {
      toast({ title: 'Failed to delete', variant: 'destructive' })
    }
  }, [activeConvId]) // eslint-disable-line

  // ── File / media upload ────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    if (!activeConvId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await api.post('/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const fileUrl = uploadRes.data.data?.url
      if (!fileUrl) throw new Error('No URL returned')

      // Send as a DM with the file URL as the body (for now — text only API)
      // We encode the media as a special URL message
      const r = await dmApi.send(activeConvId, fileUrl)
      const msg: DmMessage = r.data.data
      addMessage(activeConvId, msg)
      useDmStore.getState().updateConversationPreview(activeConvId, msg)
    } catch (e: any) {
      toast({ title: e?.message || 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }, [activeConvId, addMessage, toast])

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredConvs = search
    ? conversations.filter(c =>
        `${c.other.firstName} ${c.other.lastName}`.toLowerCase().includes(search.toLowerCase())
      )
    : conversations

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null
  const typingInConv = activeConvId ? (typing[activeConvId] ?? []) : []
  const isOtherTyping = typingInConv.some(id => id !== user?.id)

  // Group messages by date for separators
  const groupedMsgs: Array<DmMessage | { type: 'date'; date: string }> = []
  let lastDate = ''
  for (const msg of currentMsgs) {
    const d = msg.createdAt.slice(0, 10)
    if (d !== lastDate) {
      groupedMsgs.push({ type: 'date', date: msg.createdAt })
      lastDate = d
    }
    groupedMsgs.push(msg)
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

      {/* ── LEFT: Conversation list ── */}
      <div className={cn(
        'flex flex-col border-r border-gray-100 flex-shrink-0 transition-all',
        activeConvId ? 'hidden md:flex w-72' : 'flex w-full md:w-72'
      )}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Messages</h2>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-indigo-300"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
                    <div className="h-2.5 bg-gray-100 rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
              <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">{search ? 'No results' : 'No conversations yet'}</p>
              {!search && (
                <Link href="/social/friends" className="mt-2 text-xs text-indigo-600 hover:underline">
                  Find friends to message →
                </Link>
              )}
            </div>
          ) : (
            filteredConvs.map(conv => (
              <ConvRow
                key={conv.id}
                conv={conv}
                isActive={conv.id === activeConvId}
                onClick={() => {
                  setActiveConvId(conv.id)
                  setShowSidebar(false)
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── RIGHT: Chat window ── */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0',
        !activeConvId && 'hidden md:flex'
      )}>
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0 bg-white">
              {/* Back button (mobile) */}
              <button
                className="md:hidden p-1 text-gray-500 hover:text-gray-700"
                onClick={() => setActiveConvId(null)}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Avatar */}
              <Link href={`/social/profile/${activeConv.other.id}`}>
                <div className="w-9 h-9 rounded-full overflow-hidden bg-indigo-100 flex items-center justify-center font-bold text-indigo-600 text-sm flex-shrink-0">
                  {getAvatarUrl(activeConv.other.avatarUrl)
                    ? <img src={getAvatarUrl(activeConv.other.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                    : initials(activeConv.other)
                  }
                </div>
              </Link>

              <div className="flex-1 min-w-0">
                <Link href={`/social/profile/${activeConv.other.id}`}>
                  <p className="font-semibold text-gray-900 text-sm hover:text-indigo-600 transition-colors">
                    {activeConv.other.firstName} {activeConv.other.lastName}
                  </p>
                </Link>
                {isOtherTyping && (
                  <p className="text-xs text-indigo-500 font-medium">typing…</p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gray-50"
              onScroll={e => {
                if ((e.target as HTMLDivElement).scrollTop < 80) loadMore()
              }}
            >
              {/* Load more spinner */}
              {loadingMore && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              )}

              {/* No more messages */}
              {!loadingMore && !hasMore && currentMsgs.length > 0 && (
                <div className="text-center py-2">
                  <span className="text-[10px] text-gray-300 font-medium uppercase tracking-wide">
                    Beginning of conversation
                  </span>
                </div>
              )}

              {/* No messages */}
              {currentMsgs.length === 0 && !loadingMore && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                  <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs mt-1">Say hello! 👋</p>
                </div>
              )}

              {/* Message list */}
              <AnimatePresence initial={false}>
                {groupedMsgs.map((item, i) => {
                  if ('type' in item) {
                    return <DateSep key={`date-${item.date}`} date={item.date} />
                  }
                  const msg = item as DmMessage
                  const isMe = msg.senderId === user?.id
                  return (
                    <Bubble
                      key={msg.id}
                      msg={msg}
                      isMe={isMe}
                      showTime={true}
                      onDelete={() => handleDelete(msg.id)}
                    />
                  )
                })}
              </AnimatePresence>

              {/* Typing indicator */}
              {isOtherTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-end gap-1.5"
                >
                  <TypingDots />
                </motion.div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
              <div className="flex items-center gap-2">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,application/pdf,.doc,.docx"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(file)
                    e.target.value = ''
                  }}
                />
                {/* Attachment button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Attach file"
                  className="w-9 h-9 flex items-center justify-center rounded-full text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors flex-shrink-0"
                >
                  {uploading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Paperclip className="w-4 h-4" />
                  }
                </button>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); handleTyping() }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                  }}
                  placeholder="Type a message…"
                  className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm outline-none focus:border-indigo-300 focus:bg-white transition-colors"
                  autoFocus
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0 shadow-sm"
                >
                  {sending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-gray-50">
            <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-indigo-300" />
            </div>
            <p className="font-semibold text-gray-500 text-lg">Your Messages</p>
            <p className="text-sm mt-1">Select a conversation or start a new one</p>
            <Link
              href="/social/friends"
              className="mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Find Friends to Message
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Suspense boundary (required for useSearchParams in Next.js 14) ──────────
export default function DmPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DmContent />
    </Suspense>
  )
}
