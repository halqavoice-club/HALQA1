'use client'

/**
 * DM (Chat) Page — Full-featured private messaging
 *
 * Features:
 *  - Conversation list with unread badges, search, new-chat button
 *  - Real-time messaging: send, receive, typing indicators, read receipts (✓✓ blue)
 *  - Reply-to (quote): click reply on any message, shows preview bar
 *  - Emoji reactions: hover → picker → stored in DB, live updates via socket
 *  - Edit own message (hover → pencil, within 15 min)
 *  - Delete message (hover → trash)
 *  - File / image attachment upload
 *  - In-conversation search (magnifier in header)
 *  - Online indicator (header)
 *  - Infinite scroll (load older messages on scroll up)
 *  - Date separators
 *  - Context menu on right-click / long-press equivalent
 */

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { dmApi } from '@/lib/dm'
import {
  useDmStore,
  type DmConversation,
  type DmMessage,
  type DmReaction,
} from '@/store/dm.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { getSocket } from '@/lib/socket'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday, differenceInMinutes } from 'date-fns'
import api from '@/lib/api'
import {
  Send, Search, ArrowLeft, Check, CheckCheck,
  Loader2, MessageSquare, Trash2,
  Smile, Phone, Video, MoreVertical,
  Reply, Pencil, X, Plus, Copy, Forward,
} from 'lucide-react'
import Link from 'next/link'
import { DmMediaBubble } from '@/components/dm/DmMediaBubble'
import { DmInputBar } from '@/components/dm/DmInputBar'
import type { SendMessagePayload } from '@/lib/dm'
import { ShareSheet, type SharePayload } from '@/components/chat/ShareSheet'

// ─── Theme ─────────────────────────────────────────────────────────────────────
const WA_GREEN       = '#25d366'
const WA_DARK        = '#128c7e'
const WA_LIGHT_GREEN = '#dcf8c6'
const WA_BG          = '#efeae2'
const QUICK_EMOJIS   = ['❤️', '😂', '😮', '😢', '🙏', '👍', '🔥', '😊']

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string | null | undefined) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    if (isToday(d))     return format(d, 'h:mm a')
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'MMM d')
  } catch { return '' }
}
function fmtFull(iso: string | null | undefined) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return format(d, 'h:mm a')
  } catch { return '' }
}
function initials(u: { firstName: string; lastName: string }) {
  return `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase()
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ url, first, last, size = 40, online = false }: {
  url?: string | null; first?: string; last?: string; size?: number; online?: boolean
}) {
  const src = getAvatarUrl(url)
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="rounded-full overflow-hidden bg-teal-100 flex items-center justify-center font-bold text-teal-700"
        style={{ width: size, height: size, fontSize: size * 0.35 }}>
        {src
          ? <img src={src} alt="" className="w-full h-full object-cover" />
          : `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
        }
      </div>
      {online && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />}
    </div>
  )
}

// ─── Read ticks ───────────────────────────────────────────────────────────────
function Tick({ status }: { status: DmMessage['status'] }) {
  if (status === 'READ')      return <CheckCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#53bdeb' }} />
  if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
  return <Check className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
}

// ─── Reaction pills ────────────────────────────────────────────────────────────
function ReactionPills({ reactions, myId, onToggle }: {
  reactions: DmReaction[]
  myId: string
  onToggle: (emoji: string) => void
}) {
  if (!reactions?.length) return null
  const grouped = reactions.reduce<Record<string, number>>((a, r) => {
    a[r.emoji] = (a[r.emoji] ?? 0) + 1; return a
  }, {})
  return (
    <div className="flex flex-wrap gap-0.5 mt-0.5">
      {Object.entries(grouped).map(([emoji, count]) => {
        const mine = reactions.some(r => r.emoji === emoji && r.userId === myId)
        return (
          <button key={emoji} onClick={() => onToggle(emoji)}
            className={cn(
              'flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] transition-colors',
              mine ? 'bg-teal-100 border border-teal-300' : 'bg-white/80 border border-gray-200 hover:bg-gray-100'
            )}>
            {emoji}{count > 1 ? ` ${count}` : ''}
          </button>
        )
      })}
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({
  msg, isMe, myId,
  onDelete, onEdit, onReply, onReact, onForward,
}: {
  msg: DmMessage; isMe: boolean; myId: string
  onDelete: () => void
  onEdit: () => void
  onReply: () => void
  onReact: (emoji: string) => void
  onForward: () => void
}) {
  const [hover, setHover]         = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const canEdit = isMe && differenceInMinutes(new Date(), new Date(msg.createdAt)) <= 15

  const isImageUrl = (s: string) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(s)
  const isFileUrl  = (s: string) => s.startsWith('/uploads/') || s.startsWith('http')

  const renderBody = () => {
    // Phase 4: use DmMediaBubble for rich rendering — it handles all types
    return null // rendered below via DmMediaBubble
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-end gap-1.5 group mb-1.5', isMe ? 'flex-row-reverse' : 'flex-row')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setShowEmojiPicker(false) }}
    >
      {/* Bubble */}
      <div className="flex flex-col" style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        {/* Reply context */}
        {msg.replyTo && (
          <div className={cn(
            'px-2.5 py-1.5 rounded-xl mb-0.5 text-xs border-l-2 max-w-[220px]',
            isMe ? 'bg-green-100 border-green-400 text-gray-600' : 'bg-gray-100 border-gray-400 text-gray-500'
          )}>
            <p className="font-semibold text-teal-700 truncate">{msg.replyTo.sender.firstName}</p>
            <p className="truncate">{msg.replyTo.body}</p>
          </div>
        )}

        <div
          className={cn(
            'relative rounded-2xl text-sm leading-relaxed shadow-sm',
            // Images/videos: minimal padding, no overflow hidden (let image size naturally)
            (msg.msgType === 'IMAGE' || msg.msgType === 'VIDEO' || msg.msgType === 'GIF')
              ? 'p-0.5 inline-block max-w-[75vw] md:max-w-[320px]'
              : 'px-3 py-2 max-w-[70%]',
            isMe ? 'rounded-br-sm text-gray-900' : 'bg-white text-gray-900 rounded-bl-sm'
          )}
          style={isMe ? { backgroundColor: WA_LIGHT_GREEN } : {}}
        >
          <DmMediaBubble msg={msg} isMe={isMe} />
          <div className={cn('flex items-center gap-1 mt-0.5', isMe ? 'justify-end' : 'justify-start')}>
            {msg.isEdited && <span className="text-[9px] text-gray-400 italic">edited</span>}
            <span className="text-[10px] text-gray-500">{fmtFull(msg.createdAt)}</span>
            {isMe && <Tick status={msg.status} />}
          </div>
        </div>

        {/* Reactions */}
        <ReactionPills
          reactions={msg.reactions ?? []}
          myId={myId}
          onToggle={onReact}
        />
      </div>

      {/* Hover action buttons */}
      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className={cn('flex items-center gap-0.5 flex-shrink-0', isMe ? 'flex-row-reverse' : 'flex-row')}
          >
            {/* Emoji picker */}
            <div className="relative">
              <button
                onClick={() => setShowEmojiPicker(v => !v)}
                className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-500 transition-all"
              >
                <Smile className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {showEmojiPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className={cn(
                      'absolute bottom-8 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 px-2 py-1.5 flex gap-1',
                      isMe ? 'right-0' : 'left-0'
                    )}
                  >
                    {QUICK_EMOJIS.map(e => (
                      <button key={e} onClick={() => { onReact(e); setShowEmojiPicker(false) }}
                        className="text-lg hover:scale-125 transition-transform">
                        {e}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Reply */}
            <button onClick={onReply}
              className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-500 transition-all">
              <Reply className="w-4 h-4" />
            </button>

            {/* Copy */}
            {msg.body && (
              <button
                onClick={() => navigator.clipboard.writeText(msg.body!)}
                className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-500 transition-all">
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Forward */}
            <button onClick={onForward}
              className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-500 transition-all"
              title="Forward message">
              <Forward className="w-3.5 h-3.5" />
            </button>

            {/* Edit (own + within 15min) */}
            {canEdit && (
              <button onClick={onEdit}
                className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-500 transition-all">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Delete */}
            {isMe && (
              <button onClick={onDelete}
                className="p-1.5 rounded-full bg-white/80 shadow hover:bg-white text-gray-400 hover:text-red-400 transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Normalize a raw API/socket message to DmMessage with safe defaults ───────
function normalizeDmMessage(raw: any): DmMessage {
  return {
    reactions:  raw.reactions  ?? [],
    replyTo:    raw.replyTo    ?? null,
    replyToId:  raw.replyToId  ?? null,
    msgType:    raw.msgType    ?? 'TEXT',
    mediaUrl:   raw.mediaUrl   ?? null,
    mimeType:   raw.mimeType   ?? null,
    fileSize:   raw.fileSize   ?? null,
    fileName:   raw.fileName   ?? null,
    duration:   raw.duration   ?? null,
    width:      raw.width      ?? null,
    height:     raw.height     ?? null,
    thumbnail:  raw.thumbnail  ?? null,
    // Core fields always present
    id:            raw.id,
    conversationId:raw.conversationId,
    senderId:      raw.senderId,
    receiverId:    raw.receiverId,
    body:          raw.body ?? null,
    status:        raw.status ?? 'SENT',
    deliveredAt:   raw.deliveredAt ?? null,
    readAt:        raw.readAt ?? null,
    isEdited:      raw.isEdited ?? false,
    editedAt:      raw.editedAt ?? null,
    sender:        raw.sender,
    createdAt: typeof raw.createdAt === 'string'
      ? raw.createdAt
      : raw.createdAt
        ? new Date(raw.createdAt).toISOString()
        : new Date().toISOString(),
  }
}
function DateSep({ date }: { date: string }) {
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return null
    const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'MMMM d, yyyy')
    return (
      <div className="flex justify-center my-3">
        <span className="bg-[#e1f2fb] text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
          {label}
        </span>
      </div>
    )
  } catch { return null }
}

// ─── Typing dots ──────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-end gap-1.5 mb-2 px-4">
      <div className="px-4 py-2.5 bg-white rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-1">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce block"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}

// ─── Conversation row ─────────────────────────────────────────────────────────
function ConvRow({ conv, isActive, onClick }: {
  conv: DmConversation; isActive: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors text-left border-b border-gray-100',
        isActive && 'bg-teal-50 border-l-2 border-teal-500'
      )}>
      <Av url={conv.other.avatarUrl} first={conv.other.firstName} last={conv.other.lastName} size={48} online={conv.unread > 0} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className={cn('text-sm truncate', conv.unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-700')}>
            {conv.other.firstName} {conv.other.lastName}
          </p>
          {conv.lastMessageAt && (
            <span className={cn('text-[10px] flex-shrink-0 ml-1', conv.unread > 0 ? 'font-semibold' : 'text-gray-400')}
              style={conv.unread > 0 ? { color: WA_DARK } : {}}>
              {fmtTime(conv.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className={cn('text-xs truncate', conv.unread > 0 ? 'text-gray-700' : 'text-gray-400')}>
            {conv.lastMessage ?? 'Tap to chat'}
          </p>
          {conv.unread > 0 && (
            <span className="ml-2 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0"
              style={{ backgroundColor: WA_GREEN }}>
              {conv.unread > 9 ? '9+' : conv.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Main content ─────────────────────────────────────────────────────────────
function ChatContent() {
  const { user }       = useAuthStore()
  const { toast }      = useToast()
  const searchParams   = useSearchParams()
  const queryClient    = useQueryClient()

  const {
    conversations, setConversations,
    messages, setMessages, addMessage, removeMessage,
    updateMessageStatus, updateMessageBody, updateReaction,
    activeConvId, setActiveConvId,
    typing, setTyping,
    clearUnread,
  } = useDmStore()

  const [input,        setInput]        = useState('')
  const [sending,      setSending]      = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [convSearch,   setConvSearch]   = useState('')
  const [msgSearch,    setMsgSearch]    = useState('')
  const [showMsgSearch, setShowMsgSearch] = useState(false)
  const [searchResults, setSearchResults] = useState<DmMessage[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [hasMore,      setHasMore]      = useState(true)
  const [replyTo,      setReplyTo]      = useState<DmMessage | null>(null)
  const [editingMsg,   setEditingMsg]   = useState<DmMessage | null>(null)
  const [showNewChat,  setShowNewChat]  = useState(false)
  const [newChatSearch, setNewChatSearch] = useState('')
  const [forwardMsg,   setForwardMsg]   = useState<DmMessage | null>(null)
  const [showForwardPicker, setShowForwardPicker] = useState(false)

  const chatEndRef    = useRef<HTMLDivElement>(null)
  const inputRef      = useRef<HTMLInputElement>(null)
  const typingTimer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const msgSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Load conversations ─────────────────────────────────────────────────────
  const { isLoading: convsLoading } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn:  () => dmApi.conversations().then(r => { setConversations(r.data.data); return r.data.data }),
    staleTime: 30000,
  })

  // ── Load groups (for ShareSheet) ───────────────────────────────────────────
  const { data: groupConvs = [] } = useQuery({
    queryKey: ['group-chat-conversations'],
    queryFn:  () => api.get('/group-chat/conversations').then(r => r.data.data ?? []),
    staleTime: 60000,
  })

  // ── New-chat user search ───────────────────────────────────────────────────
  const { data: newChatUsers } = useQuery({
    queryKey: ['users-search', newChatSearch],
    queryFn:  () => api.get('/users', { params: { search: newChatSearch, limit: 8 } }).then(r => r.data.data),
    enabled:  newChatSearch.length >= 2,
  })

  // ── Auto-open from ?userId= ────────────────────────────────────────────────
  useEffect(() => {
    const userId = searchParams.get('userId')
    if (!userId || !user) return
    dmApi.startWith(userId).then(r => {
      const conv = r.data.data
      setConversations(prev => prev.find(c => c.id === conv.id) ? prev : [{ ...conv, unread: 0 }, ...prev])
      setActiveConvId(conv.id)
    }).catch(e => toast({ title: e?.response?.data?.message || 'Cannot open chat', variant: 'destructive' }))
  }, [searchParams.get('userId')]) // eslint-disable-line

  // ── Load messages when conversation changes ────────────────────────────────
  useEffect(() => {
    if (!activeConvId) return
    setHasMore(true)
    setReplyTo(null)
    setEditingMsg(null)
    setShowMsgSearch(false)
    setMsgSearch('')
    setSearchResults([])
    if (messages[activeConvId]?.length) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      dmApi.markRead(activeConvId).then(() => clearUnread(activeConvId)).catch(() => {})
      return
    }
    dmApi.messages(activeConvId).then(r => {
      const msgs: DmMessage[] = (r.data.data ?? []).map((m: any) => ({
        ...m,
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date(m.createdAt).toISOString(),
      }))
      setMessages(activeConvId, msgs)
      if (msgs.length < 30) setHasMore(false)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }), 50)
      dmApi.markRead(activeConvId).then(() => clearUnread(activeConvId)).catch(() => {})
    }).catch(() => {})
  }, [activeConvId]) // eslint-disable-line

  const currentMsgs = activeConvId ? (messages[activeConvId] ?? []) : []

  // Scroll on new own message
  const lastMsg = currentMsgs[currentMsgs.length - 1]
  useEffect(() => {
    if (lastMsg?.senderId === user?.id) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lastMsg?.id]) // eslint-disable-line

  // ── Load older ─────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!activeConvId || loadingMore || !hasMore) return
    const oldest = currentMsgs[0]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const r = await dmApi.messages(activeConvId, oldest.createdAt)
      const older: DmMessage[] = (r.data.data ?? []).map((m: any) => ({
        ...m,
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date(m.createdAt).toISOString(),
      }))
      if (older.length < 30) setHasMore(false)
      setMessages(activeConvId, [...older, ...currentMsgs])
    } finally { setLoadingMore(false) }
  }, [activeConvId, currentMsgs, loadingMore, hasMore]) // eslint-disable-line

  // ── Send / edit ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeConvId || sending) return
    const body = input.trim()

    if (editingMsg) {
      // Edit mode
      setInput(''); setEditingMsg(null)
      try {
        await dmApi.editMessage(editingMsg.id, body)
        updateMessageBody(activeConvId, editingMsg.id, body)
      } catch (e: any) {
        toast({ title: e?.response?.data?.message || 'Edit failed', variant: 'destructive' })
        setInput(body); setEditingMsg(editingMsg)
      }
      return
    }

    setInput('')
    setSending(true)
    const socket = getSocket()
    const conv   = conversations.find(c => c.id === activeConvId)
    if (socket && conv) socket.emit('dm:typing_stop', { convId: activeConvId, receiverId: conv.other.id })
    try {
      const r = await dmApi.send(activeConvId!, { body, replyToId: replyTo?.id })
      const msg: DmMessage = r.data.data
      addMessage(activeConvId, msg)
      useDmStore.getState().updateConversationPreview(activeConvId, msg)
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setReplyTo(null)
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' })
      setInput(body)
    } finally { setSending(false); inputRef.current?.focus() }
  }, [input, activeConvId, sending, conversations, replyTo, editingMsg, addMessage, updateMessageBody, toast]) // eslint-disable-line

  // ── Typing indicator ───────────────────────────────────────────────────────
  const handleTyping = useCallback(() => {
    if (!activeConvId) return
    const socket = getSocket()
    const conv   = conversations.find(c => c.id === activeConvId)
    if (!socket || !conv) return
    if (!typingTimer.current) socket.emit('dm:typing_start', { convId: activeConvId, receiverId: conv.other.id })
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      socket.emit('dm:typing_stop', { convId: activeConvId, receiverId: conv.other.id })
      typingTimer.current = undefined
    }, 2500)
  }, [activeConvId, conversations])

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (msgId: string) => {
    if (!activeConvId) return
    try { await dmApi.deleteMessage(msgId); removeMessage(activeConvId, msgId) }
    catch { toast({ title: 'Failed to delete', variant: 'destructive' }) }
  }, [activeConvId, removeMessage, toast])

  // ── Forward ─────────────────────────────────────────────────────────────────
  const sharePayload: SharePayload | null = forwardMsg ? {
    body: forwardMsg.body,
    msgType: forwardMsg.msgType ?? 'TEXT',
    mediaUrl: forwardMsg.mediaUrl,
    mimeType: forwardMsg.mimeType,
    fileSize: forwardMsg.fileSize,
    fileName: forwardMsg.fileName,
    duration: forwardMsg.duration,
  } : null

  // ── React ──────────────────────────────────────────────────────────────────
  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    if (!activeConvId || !user) return
    try {
      const r = await dmApi.reactMessage(msgId, emoji)
      const { action, reaction } = r.data.data ?? r.data
      updateReaction(activeConvId, msgId, emoji, user.id, action, reaction)
    } catch { /* silent */ }
  }, [activeConvId, user, updateReaction])

  // ── File upload (legacy — DmInputBar now handles this via useDmUpload) ──────
  const handleFileUpload = useCallback(async (file: File) => {
    if (!activeConvId) return
    setUploading(true)
    try {
      const { mimeToMsgType } = await import('@/hooks/useDmUpload')
      const form = new FormData()
      form.append('file', file)
      const res  = await api.post('/upload', form)
      const record = res.data.data
      if (!record?.url) throw new Error('No URL returned')
      const msgType = mimeToMsgType(file.type)
      const r = await dmApi.send(activeConvId, {
        msgType,
        mediaUrl: record.url,
        mimeType: record.mimeType ?? file.type,
        fileSize: record.size ?? file.size,
        fileName: record.originalName ?? file.name,
      })
      const rawMsg: any = r.data.data
      const msg = normalizeDmMessage(rawMsg)
      addMessage(activeConvId, msg)
      useDmStore.getState().updateConversationPreview(activeConvId, msg)
    } catch (e: any) {
      toast({ title: e?.message || 'Upload failed', variant: 'destructive' })
    } finally { setUploading(false) }
  }, [activeConvId, addMessage, toast])

  // ── Message search (debounced) ─────────────────────────────────────────────
  const handleMsgSearch = useCallback((q: string) => {
    setMsgSearch(q)
    clearTimeout(msgSearchTimer.current)
    if (!q.trim() || !activeConvId) { setSearchResults([]); return }
    msgSearchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const r = await dmApi.searchMessages(activeConvId, q.trim())
        setSearchResults(r.data.data)
      } catch { setSearchResults([]) }
      finally { setSearchLoading(false) }
    }, 400)
  }, [activeConvId])

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const onMessage = (data: { convId: string; message: DmMessage }) => {
      const msg = normalizeDmMessage(data.message)
      addMessage(data.convId, msg)
      useDmStore.getState().updateConversationPreview(data.convId, msg)
      if (data.convId !== activeConvId) useDmStore.getState().incrementUnread(data.convId)
      else {
        dmApi.markRead(data.convId).catch(() => {})
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    const onDelivered = (data: { convId: string; messageIds: string[]; at: string }) =>
      updateMessageStatus(data.convId, data.messageIds, 'DELIVERED', data.at ?? new Date().toISOString())
    // BUG-3 FIX: Only mark outgoing messages (senderId === myId) as READ.
    // Previously all messages in the conversation were marked READ, including
    // incoming ones — which made received messages incorrectly show double-blue ticks.
    const onRead = (data: { convId: string; readAt: string }) => {
      const myId = user?.id
      if (!myId) return
      const msgs = useDmStore.getState().messages[data.convId] ?? []
      const outgoingIds = msgs.filter(m => m.senderId === myId).map(m => m.id)
      if (outgoingIds.length > 0) updateMessageStatus(data.convId, outgoingIds, 'READ', data.readAt)
    }
    const onEdited = (data: { convId: string; messageId: string; newBody: string }) =>
      updateMessageBody(data.convId, data.messageId, data.newBody)
    // BUG-4 FIX: Receiver-only delete must NOT remove message from sender's UI.
    // forEveryone=false + deletedBy !== myId means only the other person deleted
    // their copy — the current user's view should be unchanged.
    const onDeleted = (data: { convId: string; messageId: string; forEveryone?: boolean; deletedBy?: string }) => {
      if (!data.forEveryone && data.deletedBy !== user?.id) return
      removeMessage(data.convId, data.messageId)
    }
    const onTypingStart = (data: { convId: string; userId: string }) =>
      setTyping(data.convId, data.userId, true)
    const onTypingStop = (data: { convId: string; userId: string }) =>
      setTyping(data.convId, data.userId, false)
    const onReaction = (data: { convId: string; messageId: string; emoji: string; userId: string; action: 'added' | 'removed'; reaction: DmReaction | null }) =>
      updateReaction(data.convId, data.messageId, data.emoji, data.userId, data.action, data.reaction)

    socket.on('dm:message',        onMessage)
    socket.on('dm:delivered',      onDelivered)
    socket.on('dm:read',           onRead)
    socket.on('dm:message_edited', onEdited)
    socket.on('dm:message_deleted', onDeleted)
    socket.on('dm:typing_start',   onTypingStart)
    socket.on('dm:typing_stop',    onTypingStop)
    socket.on('dm:reaction',       onReaction)

    return () => {
      socket.off('dm:message',        onMessage)
      socket.off('dm:delivered',      onDelivered)
      socket.off('dm:read',           onRead)
      socket.off('dm:message_edited', onEdited)
      socket.off('dm:message_deleted', onDeleted)
      socket.off('dm:typing_start',   onTypingStart)
      socket.off('dm:typing_stop',    onTypingStop)
      socket.off('dm:reaction',       onReaction)
    }
  }, [activeConvId, addMessage, updateMessageStatus, updateMessageBody, updateReaction, setTyping]) // eslint-disable-line

  const filteredConvs   = convSearch
    ? conversations.filter(c => `${c.other.firstName} ${c.other.lastName}`.toLowerCase().includes(convSearch.toLowerCase()))
    : conversations
  const activeConv      = conversations.find(c => c.id === activeConvId) ?? null
  const typingInConv    = activeConvId ? (typing[activeConvId] ?? []) : []
  const isOtherTyping   = typingInConv.some(id => id !== user?.id)

  // Date-grouped messages
  const groupedMsgs: Array<DmMessage | { type: 'date'; date: string }> = []
  let lastDate = ''
  for (const msg of currentMsgs) {
    // Ensure createdAt is always a string (socket may send Date objects)
    const createdAtStr = typeof msg.createdAt === 'string'
      ? msg.createdAt
      : msg.createdAt ? new Date(msg.createdAt as any).toISOString() : ''
    if (!createdAtStr) continue
    const d = createdAtStr.slice(0, 10)
    if (d !== lastDate) { groupedMsgs.push({ type: 'date', date: createdAtStr }); lastDate = d }
    groupedMsgs.push({ ...msg, createdAt: createdAtStr })
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden" style={{ backgroundColor: '#f0f2f5' }}>

      {/* ── LEFT SIDEBAR ── */}
      <div className={cn(
        'flex flex-col flex-shrink-0 bg-white border-r border-gray-200',
        activeConvId ? 'hidden md:flex w-[340px]' : 'flex w-full md:w-[340px]'
      )}>
        {/* Header */}
        <div className="px-4 py-4 flex items-center justify-between" style={{ backgroundColor: '#f0f2f5' }}>
          <h1 className="text-xl font-bold text-gray-800">Messages</h1>
          <button
            onClick={() => setShowNewChat(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
            title="New conversation"
          >
            <Plus className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 bg-white rounded-full px-3 py-1.5 border border-gray-200">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input value={convSearch} onChange={e => setConvSearch(e.target.value)}
              placeholder="Search conversations"
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-gray-400" />
            {convSearch && (
              <button onClick={() => setConvSearch('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto bg-white">
          {convsLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                    <div className="h-2.5 bg-gray-200 rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">{convSearch ? 'No results' : 'No conversations yet'}</p>
              {!convSearch && (
                <button onClick={() => setShowNewChat(true)} className="mt-2 text-sm font-medium hover:underline" style={{ color: WA_DARK }}>
                  Start a new chat →
                </button>
              )}
            </div>
          ) : filteredConvs.map(conv => (
            <ConvRow key={conv.id} conv={conv} isActive={conv.id === activeConvId}
              onClick={() => setActiveConvId(conv.id)} />
          ))}
        </div>
      </div>

      {/* ── RIGHT: Chat window ── */}
      <div className={cn('flex-1 flex flex-col min-w-0', !activeConvId && 'hidden md:flex')}>
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 shadow-sm z-10"
              style={{ backgroundColor: '#f0f2f5' }}>
              <button className="md:hidden p-1.5 rounded-full hover:bg-gray-200" onClick={() => setActiveConvId(null)}>
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <Link href={`/social/profile/${activeConv.other.id}`}>
                <Av url={activeConv.other.avatarUrl} first={activeConv.other.firstName}
                  last={activeConv.other.lastName} size={40} online />
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/social/profile/${activeConv.other.id}`}>
                  <p className="font-semibold text-gray-900 text-sm hover:underline">
                    {activeConv.other.firstName} {activeConv.other.lastName}
                  </p>
                </Link>
                <p className="text-xs" style={{ color: WA_DARK }}>
                  {isOtherTyping ? 'typing…' : 'online'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setShowMsgSearch(v => !v); setMsgSearch(''); setSearchResults([]) }}
                  className={cn('w-9 h-9 rounded-full flex items-center justify-center transition-colors',
                    showMsgSearch ? 'bg-teal-100 text-teal-700' : 'hover:bg-gray-200 text-gray-600'
                  )}>
                  <Search className="w-5 h-5" />
                </button>
                {[Phone, Video, MoreVertical].map((Icon, i) => (
                  <button key={i} className="w-9 h-9 rounded-full hover:bg-gray-200 flex items-center justify-center transition-colors">
                    <Icon className="w-5 h-5 text-gray-600" />
                  </button>
                ))}
              </div>
            </div>

            {/* In-chat search bar */}
            <AnimatePresence>
              {showMsgSearch && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="px-4 py-2 border-b border-gray-200 flex items-center gap-2"
                  style={{ backgroundColor: '#f0f2f5' }}
                >
                  <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    autoFocus
                    value={msgSearch}
                    onChange={e => handleMsgSearch(e.target.value)}
                    placeholder="Search in conversation…"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
                  />
                  {searchLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                  {msgSearch && !searchLoading && (
                    <span className="text-xs text-gray-400">{searchResults.length} results</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search results overlay */}
            {showMsgSearch && msgSearch && searchResults.length > 0 && (
              <div className="absolute z-20 left-[340px] right-0 top-[106px] bg-white shadow-lg border-b max-h-64 overflow-y-auto">
                {searchResults.map(m => (
                  <div key={m.id} className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50">
                    <p className="text-xs text-gray-400">{fmtFull(m.createdAt)}</p>
                    <p className="text-sm text-gray-800 truncate">{m.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-2"
              style={{ backgroundColor: WA_BG }}
              onScroll={e => { if ((e.target as HTMLDivElement).scrollTop < 80) loadMore() }}>
              {loadingMore && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                </div>
              )}
              {!loadingMore && !hasMore && currentMsgs.length > 0 && (
                <div className="flex justify-center py-2">
                  <span className="bg-[#e1f2fb] text-[#54656f] text-[10px] px-3 py-1 rounded-full">
                    Beginning of conversation
                  </span>
                </div>
              )}
              {currentMsgs.length === 0 && !loadingMore && (
                <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
                  <MessageSquare className="w-10 h-10 opacity-30 mb-2" />
                  <p className="text-sm">No messages yet. Say hi! 👋</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {groupedMsgs.map((item, i) => {
                  if ('type' in item) return <DateSep key={`date-${item.date}`} date={item.date} />
                  const msg  = item as DmMessage
                  const isMe = msg.senderId === user?.id
                  return (
                    <Bubble
                      key={msg.id}
                      msg={msg}
                      isMe={isMe}
                      myId={user?.id ?? ''}
                      onDelete={() => handleDelete(msg.id)}
                      onEdit={() => { setEditingMsg(msg); setInput(msg.body ?? ''); inputRef.current?.focus() }}
                      onReply={() => { setReplyTo(msg); setEditingMsg(null); inputRef.current?.focus() }}
                      onReact={(emoji) => handleReact(msg.id, emoji)}
                      onForward={() => { setForwardMsg(msg); setShowForwardPicker(true) }}
                    />
                  )
                })}
              </AnimatePresence>

              {isOtherTyping && <TypingDots />}
              <div ref={chatEndRef} />
            </div>

            {/* DmInputBar — Phase 4: handles all media types + voice recording */}
            <DmInputBar
              convId={activeConvId}
              replyTo={replyTo}
              editingMsg={editingMsg}
              onSendText={async (body, replyToId) => {
                if (editingMsg) {
                  setInput(''); setEditingMsg(null)
                  try {
                    await dmApi.editMessage(editingMsg.id, body)
                    updateMessageBody(activeConvId!, editingMsg.id, body)
                  } catch (e: any) { toast({ title: e?.response?.data?.message || 'Edit failed', variant: 'destructive' }) }
                } else {
                  setSending(true)
                  const socket = getSocket()
                  const conv = conversations.find(c => c.id === activeConvId)
                  if (socket && conv) socket.emit('dm:typing_stop', { convId: activeConvId, receiverId: conv.other.id })
                  try {
                    const r = await dmApi.send(activeConvId!, { body, replyToId })
                    const msg = normalizeDmMessage(r.data.data)
                    addMessage(activeConvId!, msg)
                    useDmStore.getState().updateConversationPreview(activeConvId!, msg)
                    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                    setReplyTo(null)
                  } catch (e: any) { toast({ title: e?.response?.data?.message || 'Failed to send', variant: 'destructive' }) }
                  finally { setSending(false) }
                }
              }}
              onSendMedia={async (payload) => {
                if (!activeConvId) return
                try {
                  const r = await dmApi.send(activeConvId, payload)
                  const msg = normalizeDmMessage(r.data.data)
                  // Add to local store immediately — no refetch needed
                  addMessage(activeConvId, msg)
                  useDmStore.getState().updateConversationPreview(activeConvId, msg)
                  chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                } catch (e: any) { toast({ title: e?.message || 'Failed to send', variant: 'destructive' }) }
              }}
              onTyping={handleTyping}
              onClearReply={() => setReplyTo(null)}
              onCancelEdit={() => { setEditingMsg(null); setInput('') }}
              sending={sending}
            />
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5]">
            <div className="flex flex-col items-center max-w-sm text-center px-8">
              <div className="w-32 h-32 rounded-full border-4 border-dashed border-gray-300 flex items-center justify-center mb-6">
                <MessageSquare className="w-16 h-16 text-gray-300" />
              </div>
              <h2 className="text-3xl font-light text-gray-700 mb-2">Halqa Messages</h2>
              <p className="text-sm text-gray-500">Select a conversation to start chatting, or find someone new to message.</p>
              <button onClick={() => setShowNewChat(true)}
                className="mt-6 px-5 py-2.5 rounded-full text-white text-sm font-semibold transition-colors"
                style={{ backgroundColor: WA_GREEN }}>
                New Conversation
              </button>
              <div className="mt-8 w-full h-px bg-gray-200" />
              <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Your messages are private
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── New chat modal ── */}
      <AnimatePresence>
        {showNewChat && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowNewChat(false) }}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">New conversation</h2>
                <button onClick={() => setShowNewChat(false)} className="p-1.5 rounded-full hover:bg-gray-100">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200">
                  <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input autoFocus value={newChatSearch} onChange={e => setNewChatSearch(e.target.value)}
                    placeholder="Search by name…"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400" />
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto">
                  {(newChatUsers ?? []).filter((u: any) => u.id !== user?.id).map((u: any) => (
                    <button key={u.id}
                      onClick={async () => {
                        try {
                          const r = await dmApi.startWith(u.id)
                          const conv = r.data.data
                          setConversations(prev => prev.find(c => c.id === conv.id) ? prev : [{ ...conv, unread: 0 }, ...prev])
                          setActiveConvId(conv.id)
                          setShowNewChat(false); setNewChatSearch('')
                        } catch (e: any) {
                          toast({ title: e?.response?.data?.message || 'Cannot start chat', variant: 'destructive' })
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 rounded-xl text-left transition-colors">
                      <Av url={u.avatarUrl} first={u.firstName} last={u.lastName} size={36} />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-400">{u.role?.replace(/_/g, ' ')}</p>
                      </div>
                    </button>
                  ))}
                  {newChatSearch.length >= 2 && (newChatUsers ?? []).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No users found</p>
                  )}
                  {newChatSearch.length < 2 && (
                    <p className="text-sm text-gray-400 text-center py-4">Type at least 2 characters to search</p>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SHARE SHEET — DM, Group, Feed, Community ── */}
      <ShareSheet
        open={showForwardPicker}
        payload={sharePayload}
        onClose={() => { setShowForwardPicker(false); setForwardMsg(null) }}
        onSuccess={() => { setShowForwardPicker(false); setForwardMsg(null); toast({ title: 'Shared successfully' }) }}
        dmConversations={conversations.filter(c => c.id !== activeConvId)}
        groupConversations={groupConvs}
      />
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  )
}
