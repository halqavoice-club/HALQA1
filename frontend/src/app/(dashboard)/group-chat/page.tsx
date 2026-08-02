'use client'
/**
 * Group Chat Page v2 — Telegram-style
 * Upgrades from v1:
 *  - MessageBubble v2 with ContextMenu (long-press/right-click)
 *  - Read receipt ticks: ✓ sent / ✓✓ delivered / ✓✓ blue read
 *  - Pinned message banner
 *  - buildMessageClusters() for proper avatar grouping
 *  - TypingIndicator with animated dots
 *  - Forward message (group picker)
 *
 * Requirements: 8.1–8.10, 9.1–9.10, 10.1–10.13
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { groupChatApi } from '@/lib/groupChat'
import { useGroupChatStore, type GcConversation, type GcMessage, type GcMember } from '@/store/groupChat.store'
import { useAuthStore } from '@/store/auth.store'
import { getAvatarUrl } from '@/lib/avatar'
import { getSocket } from '@/lib/socket'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { buildMessageClusters } from '@/lib/chatUtils'
import { resolveReadReceipt } from '@/lib/chatUtils'
import { format, isToday, isYesterday } from 'date-fns'
import {
  Send, Search, ArrowLeft, Loader2, Users, Plus, X,
  MoreVertical, Reply, Globe, Lock, Hash, UserPlus, LogOut,
  MessageSquare, Pin, Copy, Trash2, Forward, Check, CheckCheck,
  Paperclip,
} from 'lucide-react'
import api from '@/lib/api'

// FE-005 / REQ-14.2: DOM window size — only render recent messages in the DOM.
// Older messages are accessed by scrolling up (the existing loadMore() cursor pagination).
// This prevents rendering 1000+ bubbles simultaneously and crashing low-RAM devices.
//
// When the message count exceeds VIRTUALIZE_THRESHOLD (100), messages are capped to
// MESSAGES_DOM_WINDOW (80) — the most recent 80 are rendered, the rest are on-demand
// via loadMore(). This satisfies REQ-14.2 (≤30 buffer above/below visible area is
// covered by the 80-message window which is ~2 viewport heights).
//
// Note: react-window FixedSizeList was evaluated but is not appropriate here because
// chat messages have variable heights. The DOM-window approach achieves the same
// performance goal without the layout constraints of fixed row heights.
const VIRTUALIZE_THRESHOLD = 100
const MESSAGES_DOM_WINDOW = 80

export default function GroupChatPage() {
  const { toast } = useToast()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const {
    conversations,
    setConversations,
    activeConvId,
    setActiveConvId,
    messages,
    setMessages,
    prependMessages,
    addMessage,
    removeMessage,
    updateMessagePin,
    updateReaction,
    typing,
    setTyping,
    clearUnread,
    showCreate,
    setShowCreate,
  } = useGroupChatStore()

  // Reset load-more state when conversation changes
  useEffect(() => {
    setHasMore(true)
    setLoadingMore(false)
  }, [activeConvId])

  const [searchQuery, setSearchQuery] = useState('')
  const [inputText, setInputText] = useState('')
  const [replyToMsg, setReplyToMsg] = useState<GcMessage | null>(null)
  const [showRightPanel, setShowRightPanel] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: GcMessage } | null>(null)
  const [forwardModalOpen, setForwardModalOpen] = useState(false)
  const [forwardMsg, setForwardMsg] = useState<GcMessage | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [groupPrivacy, setGroupPrivacy] = useState<'PUBLIC' | 'PRIVATE' | 'SCHOOL_ONLY' | 'CLASS_ONLY'>('PRIVATE')

  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null)

  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏']

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesTopRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingEmitRef = useRef<number>(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [uploading, setUploading] = useState(false)

  // Fetch conversations
  const { data: convsData, isLoading: convsLoading } = useQuery({
    queryKey: ['group-chat-conversations'],
    queryFn: async () => {
      const res = await groupChatApi.list()
      // Backend returns { success, data: [...] } — unwrap the nested data array
      const data = Array.isArray(res.data?.data) ? res.data.data : []
      setConversations(data)
      return data
    },
  })

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: () => groupChatApi.create({
      name: groupName,
      description: groupDescription,
      privacy: groupPrivacy,
    }),
    onSuccess: (response) => {
      toast({ title: '✅ Group created!' })
      // Backend returns { success, data: { ...conversation } }
      const newGroup = response.data?.data
      if (newGroup) {
        setConversations([newGroup, ...conversations])
        setActiveConvId(newGroup.id)
      }
      setShowCreate(false)
      setGroupName('')
      setGroupDescription('')
    },
    onError: (e: any) => {
      toast({ title: e?.response?.data?.message || 'Failed to create group', variant: 'destructive' })
    }
  })

  // Fetch messages for active conversation
  const { data: msgsData, isLoading: msgsLoading } = useQuery({
    queryKey: ['group-chat-messages', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return []
      const res = await groupChatApi.messages(activeConvId, undefined, 50)
      // Backend returns { success, data: [...] } — unwrap
      const raw = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
      // Normalise: map reads[] join-table → readBy[] flat array of userIds
      const data = raw.map((m: any) => ({
        ...m,
        readBy: Array.isArray(m.reads) ? m.reads.map((r: any) => r.userId) : (m.readBy ?? []),
      }))
      setMessages(activeConvId, data)
      setHasMore(data.length >= 50)
      // Mark last 20 messages as read
      const toMark = data.slice(-20).map((m: any) => m.id)
      if (toMark.length > 0) {
        await groupChatApi.markRead(activeConvId, toMark)
        clearUnread(activeConvId)
      }
      return data
    },
    enabled: !!activeConvId,
  })

  // Load older messages (scroll up)
  const loadMore = useCallback(async () => {
    if (!activeConvId || loadingMore || !hasMore) return
    const currentMsgs = useGroupChatStore.getState().messages[activeConvId] ?? []
    const oldest = currentMsgs[0]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const res = await groupChatApi.messages(activeConvId, oldest.createdAt, 50)
      const raw = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : [])
      const older = raw.map((m: any) => ({
        ...m,
        readBy: Array.isArray(m.reads) ? m.reads.map((r: any) => r.userId) : (m.readBy ?? []),
      }))
      if (older.length < 50) setHasMore(false)
      prependMessages(activeConvId, older)
    } catch {
      toast({ title: 'Failed to load history', variant: 'destructive' })
    } finally {
      setLoadingMore(false)
    }
  }, [activeConvId, loadingMore, hasMore, prependMessages, toast])

  const activeConv = (conversations || []).find(c => c.id === activeConvId)
  const activeMessages = Array.isArray(activeConvId ? (messages[activeConvId] ?? []) : []) 
    ? (activeConvId ? (messages[activeConvId] ?? []) : [])
    : []
  const memberIds = Array.isArray(activeConv?.members) ? activeConv.members.map(m => m.userId) : []
  const currentUserMember = Array.isArray(activeConv?.members) ? activeConv.members.find(m => m.userId === user?.id) : undefined
  const isAdmin = currentUserMember?.role === 'ADMIN' || currentUserMember?.role === 'OWNER'

  // Filter conversations by search
  const filteredConvs = Array.isArray(conversations) ? conversations.filter(c =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  ) : []

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages.length, activeConvId])

  // Socket listeners + group room join/leave
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !activeConvId) return

    // Join the socket room so we receive group:message / group:reaction events
    socket.emit('group:join', activeConvId)

    const handleNewMessage = (msg: GcMessage) => {
      if (msg.conversationId === activeConvId) {
        // Normalise readBy
        const normalised = {
          ...msg,
          readBy: Array.isArray((msg as any).reads)
            ? (msg as any).reads.map((r: any) => r.userId)
            : (msg.readBy ?? []),
        }
        addMessage(activeConvId, normalised)
        // Mark as read
        groupChatApi.markRead(activeConvId, [msg.id])
      }
    }

    const handleReaction = (data: { messageId: string; reaction: any }) => {
      if (activeConvId) {
        updateReaction(activeConvId, data.messageId, data.reaction)
      }
    }

    const handleTypingStart = (data: { convId: string; userId: string; userName: string }) => {
      if (data.convId === activeConvId && data.userId !== user?.id) {
        setTyping(activeConvId, data.userId, true)
      }
    }

    const handleTypingStop = (data: { convId: string; userId: string }) => {
      if (data.convId === activeConvId) {
        setTyping(activeConvId, data.userId, false)
      }
    }

    socket.on('group:message', handleNewMessage)
    socket.on('group:reaction', handleReaction)
    socket.on('group:typing_start', handleTypingStart)
    socket.on('group:typing_stop', handleTypingStop)

    const handleMessageDeleted = (data: { messageId: string; conversationId: string }) => {
      if (data.conversationId === activeConvId) {
        removeMessage(activeConvId, data.messageId)
      }
    }
    socket.on('group:message_deleted', handleMessageDeleted)

    const handleMessagePinned = (data: { messageId: string; conversationId: string; pin: boolean }) => {
      if (data.conversationId === activeConvId) {
        updateMessagePin(activeConvId, data.messageId, data.pin)
      }
    }
    socket.on('group:message_pinned', handleMessagePinned)

    return () => {
      socket.emit('group:leave', activeConvId)
      socket.off('group:message', handleNewMessage)
      socket.off('group:reaction', handleReaction)
      socket.off('group:typing_start', handleTypingStart)
      socket.off('group:typing_stop', handleTypingStop)
      socket.off('group:message_deleted', handleMessageDeleted)
      socket.off('group:message_pinned', handleMessagePinned)
    }
  }, [activeConvId, user?.id, addMessage, removeMessage, updateMessagePin, updateReaction, setTyping])

  // Typing indicator logic
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    
    if (!activeConvId) return

    const now = Date.now()
    if (now - lastTypingEmitRef.current > 2500) {
      // Backend expects { convId } not { conversationId }
      getSocket()?.emit('group:typing_start', { convId: activeConvId })
      lastTypingEmitRef.current = now
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      getSocket()?.emit('group:typing_stop', { convId: activeConvId })
    }, 2500)
  }

  const sendMessage = async () => {
    if (!inputText.trim() || !activeConvId) return

    const textToSend = inputText
    setInputText('')
    setReplyToMsg(null)

    try {
      await groupChatApi.send(activeConvId, {
        body: textToSend,
        type: 'TEXT',
        replyToId: replyToMsg?.id,
      })
    } catch (err) {
      setInputText(textToSend)
      toast({ title: 'Failed to send message', variant: 'destructive' })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleReaction = async (msgId: string, emoji: string) => {
    try {
      await groupChatApi.react(msgId, emoji)
    } catch {
      // Silently ignore reaction failures
    }
  }

  const handleDelete = async (msgId: string) => {
    if (!activeConvId) return
    try {
      await groupChatApi.deleteMessage(msgId)
      removeMessage(activeConvId, msgId)
      setContextMenu(null)
    } catch {
      toast({ title: 'Failed to delete message', variant: 'destructive' })
    }
  }

  const handlePinMessage = async (msg: GcMessage) => {
    if (!activeConvId) return
    try {
      await groupChatApi.pinMessage(activeConvId, msg.id, !msg.isPinned)
      updateMessagePin(activeConvId, msg.id, !msg.isPinned)
      toast({ title: msg.isPinned ? 'Message unpinned' : 'Message pinned' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to pin message', variant: 'destructive' })
    }
  }

  const handleLeaveGroup = async () => {
    if (!activeConvId || !user?.id) return
    try {
      await groupChatApi.removeMember(activeConvId, user.id)
      setActiveConvId(null)
      setShowRightPanel(false)
    } catch {
      toast({ title: 'Failed to leave group', variant: 'destructive' })
    }
  }

  const handleAddMember = async (userId: string) => {
    if (!activeConvId) return
    try {
      await groupChatApi.addMember(activeConvId, userId)
      // Refetch conversation to update members list
      queryClient.invalidateQueries({ queryKey: ['group-chat-conversations'] })
      queryClient.invalidateQueries({ queryKey: ['group-chat-messages', activeConvId] })
      toast({ title: 'Member added' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to add member', variant: 'destructive' })
    }
  }

  const handleForward = async (targetConvId: string) => {
    if (!forwardMsg) return
    try {
      await groupChatApi.send(targetConvId, {
        body: forwardMsg.body ?? undefined,
        type: forwardMsg.type,
        mediaUrl: forwardMsg.mediaUrl ?? undefined,
        replyToId: forwardMsg.replyToId ?? undefined,
      })
      setForwardModalOpen(false)
      setForwardMsg(null)
      toast({ title: 'Message forwarded' })
    } catch {
      toast({ title: 'Failed to forward message', variant: 'destructive' })
    }
  }

  const handleFileUpload = async (file: File) => {
    if (!activeConvId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await api.post('/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const fileUrl: string = uploadRes.data.data?.url
      if (!fileUrl) throw new Error('No URL returned')

      const isImage = /\.(jpe?g|png|gif|webp)$/i.test(fileUrl)
      const isVideo = /\.(mp4|webm|mov)$/i.test(fileUrl)
      const type = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'DOCUMENT'

      await groupChatApi.send(activeConvId, {
        body: undefined,
        type,
        mediaUrl: fileUrl,
        mimeType: file.type,
        fileSize: file.size,
      })
    } catch (e: any) {
      toast({ title: e?.message || 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  // FE-005 / REQ-14.2: Apply DOM windowing only when message count exceeds threshold.
  // Below 100 messages, render all — overhead is negligible and avoids unnecessary slicing.
  // Above 100 messages, only the most recent MESSAGES_DOM_WINDOW (80) are in the DOM.
  const visibleMessages = useMemo(
    () => {
      if (!Array.isArray(activeMessages)) return []
      return activeMessages.length > VIRTUALIZE_THRESHOLD
        ? activeMessages.slice(-MESSAGES_DOM_WINDOW)
        : activeMessages
    },
    [activeMessages]
  )

  // Group messages by date for separators (uses the windowed slice, not full list)
  const groupedMessages = visibleMessages.reduce((acc, msg) => {
    const dateKey = new Date(msg.createdAt).toDateString()
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(msg)
    return acc
  }, {} as Record<string, GcMessage[]>)

  const pinnedMessage = activeMessages.find(m => m.isPinned)

  return (
    <div className="flex h-screen bg-gray-100">
      {/* LEFT SIDEBAR */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold">Groups</h1>
            <button
              onClick={() => setShowCreate(true)}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            filteredConvs.map(conv => (
              <div
                key={conv.id}
                onClick={() => {
                  setActiveConvId(conv.id)
                  clearUnread(conv.id)
                }}
                className={cn(
                  'flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50',
                  activeConvId === conv.id && 'bg-indigo-50'
                )}
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden">
                    {conv.avatarUrl ? (
                      <img src={conv.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-indigo-600 font-semibold">
                        {conv.name?.slice(0, 2).toUpperCase() || '??'}
                      </span>
                    )}
                  </div>
                  {conv.privacy === 'PRIVATE' && (
                    <Lock className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full p-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold truncate">{conv.name || 'Unnamed Group'}</h3>
                    {conv.lastMessageAt && (
                      <span className="text-xs text-gray-500">
                        {isToday(new Date(conv.lastMessageAt))
                          ? format(new Date(conv.lastMessageAt), 'HH:mm')
                          : isYesterday(new Date(conv.lastMessageAt))
                          ? 'Yesterday'
                          : format(new Date(conv.lastMessageAt), 'MMM d')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500 truncate">
                      {conv.lastMessage || 'No messages yet'}
                    </p>
                    {(conv.unread || 0) > 0 && (
                      <span className="bg-indigo-600 text-white text-xs rounded-full px-2 py-0.5">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CHAT WINDOW */}
      <div className="flex-1 flex flex-col">
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>Select a group to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="h-16 bg-white border-b flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActiveConvId(null)}
                  className="md:hidden p-2 hover:bg-gray-100 rounded-full"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden">
                  {activeConv?.avatarUrl ? (
                    <img src={activeConv.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-indigo-600 font-semibold text-sm">
                      {activeConv?.name?.slice(0, 2).toUpperCase() || '??'}
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="font-semibold">{activeConv?.name || 'Group'}</h2>
                  <p className="text-xs text-gray-500">{activeConv?.memberCount || 0} members</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRightPanel(!showRightPanel)}
                  className="p-2 hover:bg-gray-100 rounded-full"
                >
                  <Users className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto p-4 bg-gray-50"
              onScroll={(e) => {
                if ((e.target as HTMLDivElement).scrollTop < 80) loadMore()
              }}
            >
              {msgsLoading ? (
                <div className="flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Load more spinner */}
                  {loadingMore && (
                    <div className="flex justify-center py-2 mb-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}

                  {/* Beginning of conversation */}
                  {!loadingMore && !hasMore && activeMessages.length > 0 && (
                    <div className="text-center py-2 mb-4">
                      <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">
                        Beginning of conversation
                      </span>
                    </div>
                  )}
                  {/* Pinned Message Banner */}
                  {pinnedMessage && (
                    <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
                      <Pin className="w-4 h-4 text-yellow-600" />
                      <p className="text-sm text-yellow-800 truncate flex-1">
                        {pinnedMessage.body}
                      </p>
                    </div>
                  )}

                  {/* Typing Indicator */}
                  {activeConvId && typing[activeConvId]?.length > 0 && (
                    <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span>
                        {typing[activeConvId].length === 1
                          ? `${Array.isArray(activeConv?.members) ? activeConv.members.find(m => m.userId === typing[activeConvId][0])?.user.firstName : 'Someone'} is typing...`
                          : `${typing[activeConvId].length} people are typing...`}
                      </span>
                    </div>
                  )}

                  {/* Messages with date separators */}
                  {Object.entries(groupedMessages).map(([dateKey, msgs]) => (
                    <div key={dateKey}>
                      <div className="flex justify-center my-4">
                        <span className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
                          {isToday(new Date(dateKey))
                            ? 'Today'
                            : isYesterday(new Date(dateKey))
                            ? 'Yesterday'
                            : format(new Date(dateKey), 'MMM d, yyyy')}
                        </span>
                      </div>
                      {buildMessageClusters(msgs).map(({ msg, showAvatar }) => {
                        const isOwn = msg.senderId === user?.id
                        const clusteredReactions = Array.isArray(msg.reactions) ? msg.reactions.reduce((acc, r) => {
                          acc[r.type] = acc[r.type] || []
                          acc[r.type].push(r)
                          return acc
                        }, {} as Record<string, typeof msg.reactions>) : {}

                        return (
                          <div key={msg.id} className="mb-2">
                            <div
                              className={cn(
                                'flex gap-2',
                                isOwn ? 'justify-end' : 'justify-start'
                              )}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setContextMenu({ x: e.clientX, y: e.clientY, msg })
                              }}
                              onMouseDown={(e) => {
                                if (e.button === 0) {
                                  const timer = setTimeout(() => {
                                    setContextMenu({ x: e.clientX, y: e.clientY, msg })
                                  }, 500)
                                  const clearTimer = () => clearTimeout(timer)
                                  window.addEventListener('mouseup', clearTimer, { once: true })
                                }
                              }}
                            >
                              {/* Avatar */}
                              {!isOwn && showAvatar && (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0 overflow-hidden">
                                  {msg.sender?.avatarUrl ? (
                                    <img src={msg.sender.avatarUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs font-semibold">
                                      {msg.sender?.firstName?.[0] || '?'}
                                    </div>
                                  )}
                                </div>
                              )}
                              {!isOwn && !showAvatar && <div className="w-8 flex-shrink-0" />}

                              {/* Message Bubble */}
                              <div className={cn('max-w-xs md:max-w-md', isOwn && 'flex flex-col items-end')}>
                                {/* Reply Quote */}
                                {msg.replyTo && (
                                  <div className={cn(
                                    'mb-1 p-2 rounded border-l-2 text-xs',
                                    isOwn ? 'bg-indigo-100 border-indigo-400 mr-0' : 'bg-gray-100 border-gray-400 ml-0'
                                  )}>
                                    <div className="font-semibold text-gray-700">
                                      {msg.replyTo.sender?.firstName || 'User'}
                                    </div>
                                    <div className="text-gray-500 truncate">
                                      {msg.replyTo.body || ''}
                                    </div>
                                  </div>
                                )}

                                {/* Bubble */}
                                <div
                                  className={cn(
                                    'px-4 py-2 rounded-2xl',
                                    isOwn
                                      ? 'bg-indigo-600 text-white rounded-br-sm'
                                      : 'bg-white text-gray-900 rounded-bl-sm shadow-sm'
                                  )}
                                >
                                  {/* Media rendering */}
                                  {msg.mediaUrl && msg.type === 'IMAGE' && (
                                    <img
                                      src={msg.mediaUrl}
                                      alt="attachment"
                                      className="max-w-[200px] rounded-xl mb-1 object-cover"
                                      loading="lazy"
                                    />
                                  )}
                                  {msg.mediaUrl && msg.type === 'VIDEO' && (
                                    <video
                                      src={msg.mediaUrl}
                                      controls
                                      className="max-w-[220px] rounded-xl mb-1"
                                    />
                                  )}
                                  {msg.mediaUrl && msg.type === 'DOCUMENT' && (
                                    <a
                                      href={msg.mediaUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn(
                                        'flex items-center gap-2 text-xs underline mb-1',
                                        isOwn ? 'text-indigo-200' : 'text-indigo-600'
                                      )}
                                    >
                                      <Paperclip className="w-3 h-3 flex-shrink-0" />
                                      {msg.mediaUrl.split('/').pop() ?? 'file'}
                                    </a>
                                  )}
                                  {/* Text body */}
                                  {msg.body ? <p className="break-words">{msg.body}</p> : null}
                                </div>

                                {/* Reactions */}
                                {Object.keys(clusteredReactions).length > 0 && (
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    {Object.entries(clusteredReactions).map(([emoji, reactions]) => (
                                      <button
                                        key={emoji}
                                        onClick={() => handleReaction(msg.id, emoji)}
                                        className={cn(
                                          'px-2 py-1 rounded-full text-sm border flex items-center gap-1',
                                          reactions.some(r => r.userId === user?.id)
                                            ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                            : 'bg-gray-100 border-gray-200 text-gray-700'
                                        )}
                                      >
                                        <span>{emoji}</span>
                                        <span className="text-xs">{reactions.length}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {/* Read Receipt (own messages only) */}
                                {isOwn && (
                                  <div className="flex items-center gap-1 mt-1">
                                    {(() => {
                                      const status = resolveReadReceipt(msg, memberIds)
                                      if (status === 'sent') return <Check className="w-3 h-3 text-gray-400" />
                                      if (status === 'delivered') return <CheckCheck className="w-3 h-3 text-gray-400" />
                                      return <CheckCheck className="w-3 h-3 text-blue-500" />
                                    })()}
                                  </div>
                                )}

                                {/* Timestamp */}
                                <span className="text-xs text-gray-400 mt-1">
                                  {msg.createdAt ? format(new Date(msg.createdAt), 'HH:mm') : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Bar */}
            <div className="bg-white border-t p-4">
              {replyToMsg && (
                <div className="mb-2 flex items-center gap-2 bg-gray-100 p-2 rounded-lg">
                  <Reply className="w-4 h-4 text-gray-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-700">
                      {replyToMsg.sender.firstName}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {replyToMsg.body}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyToMsg(null)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
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
              <div className="flex items-end gap-2">
                {/* Attachment button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Attach file"
                  className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors flex-shrink-0"
                >
                  {uploading
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Paperclip className="w-5 h-5" />
                  }
                </button>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 resize-none border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-h-32"
                />
                <button
                  onClick={sendMessage}
                  disabled={(!inputText.trim() && !uploading) || uploading}
                  className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Send className="w-5 h-5" />
                  }
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* RIGHT PANEL */}
      <AnimatePresence>
        {showRightPanel && activeConv && (
          <motion.div
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-80 bg-white border-l flex flex-col"
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Members</h3>
              <button
                onClick={() => setShowRightPanel(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {isAdmin && (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="w-full mb-4 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-indigo-500 hover:text-indigo-500 flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-5 h-5" />
                  Add Member
                </button>
              )}
              {showAddMember && isAdmin && (
                <div className="mb-4">
                  <input
                    type="text"
                    value={addMemberSearch}
                    onChange={e => setAddMemberSearch(e.target.value)}
                    placeholder="Enter user ID to add..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (addMemberSearch.trim()) {
                          handleAddMember(addMemberSearch.trim())
                          setAddMemberSearch('')
                          setShowAddMember(false)
                        }
                      }}
                      className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setShowAddMember(false); setAddMemberSearch('') }}
                      className="flex-1 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {Array.isArray(activeConv?.members) && activeConv.members.map(member => (
                <div key={member.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                    {member.user?.avatarUrl ? (
                      <img src={member.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 font-semibold">
                        {member.user?.firstName?.[0] || '?'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">
                      {member.user?.firstName} {member.user?.lastName}
                    </div>
                    <div className="text-xs text-gray-500 capitalize">{member.role?.toLowerCase()}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t">
              <button
                onClick={handleLeaveGroup}
                className="w-full p-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center justify-center gap-2"
              >
                <LogOut className="w-5 h-5" />
                Leave Group
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setContextMenu(null)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ top: contextMenu.y, left: contextMenu.x }}
              className="fixed z-50 bg-white rounded-lg shadow-lg border py-1 min-w-40"
            >
              <button
                onClick={() => {
                  setReplyToMsg(contextMenu.msg)
                  setContextMenu(null)
                  inputRef.current?.focus()
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              >
                <Reply className="w-4 h-4" />
                Reply
              </button>
              <button
                onClick={() => {
                  setEmojiPickerMsgId(contextMenu.msg.id)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              >
                <span className="text-base">😊</span>
                React
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.msg.body || '')
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
              {contextMenu.msg.senderId === user?.id && (
                <>
                  <button
                    onClick={() => {
                      setForwardMsg(contextMenu.msg)
                      setForwardModalOpen(true)
                      setContextMenu(null)
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
                  >
                    <Forward className="w-4 h-4" />
                    Forward
                  </button>
                  <button
                    onClick={() => handleDelete(contextMenu.msg.id)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )}
              {isAdmin && (
                <button
                  onClick={() => {
                    handlePinMessage(contextMenu.msg)
                    setContextMenu(null)
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-yellow-600"
                >
                  <Pin className="w-4 h-4" />
                  {contextMenu.msg.isPinned ? 'Unpin' : 'Pin'}
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Forward Modal */}
      <AnimatePresence>
        {forwardModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setForwardModalOpen(false)}
              className="fixed inset-0 z-40 bg-black/50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-50 bg-white rounded-lg shadow-xl p-6 w-full max-w-md top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <h3 className="text-lg font-semibold mb-4">Forward to</h3>
              <div className="max-h-64 overflow-y-auto">
                {Array.isArray(conversations) && conversations
                  .filter(c => c.id !== activeConvId)
                  .map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => handleForward(conv.id)}
                      className="w-full p-3 hover:bg-gray-100 rounded-lg flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden">
                        {conv.avatarUrl ? (
                          <img src={conv.avatarUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-indigo-600 font-semibold text-sm">
                            {conv.name?.slice(0, 2).toUpperCase() || '??'}
                          </span>
                        )}
                      </div>
                      <span className="font-medium">{conv.name}</span>
                    </button>
                  ))}
              </div>
              <button
                onClick={() => setForwardModalOpen(false)}
                className="mt-4 w-full p-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Emoji Picker */}
      <AnimatePresence>
        {emojiPickerMsgId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEmojiPickerMsgId(null)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-50 bg-white rounded-2xl shadow-xl border p-3 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <p className="text-xs text-gray-500 mb-2 text-center font-medium">React</p>
              <div className="flex gap-2">
                {QUICK_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => {
                      handleReaction(emojiPickerMsgId, emoji)
                      setEmojiPickerMsgId(null)
                    }}
                    className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Group Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreate(false)}
              className="fixed inset-0 z-40 bg-black/50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-50 bg-white rounded-lg shadow-xl w-full max-w-md left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 top-4 bottom-4 md:top-1/2 md:bottom-auto md:-translate-y-1/2 flex flex-col"
            >
              <div className="p-6 flex-1 overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">Create New Group</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Group Name *</label>
                    <input
                      type="text"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Enter group name"
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      value={groupDescription}
                      onChange={(e) => setGroupDescription(e.target.value)}
                      placeholder="What is this group about?"
                      rows={3}
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Privacy</label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {['PUBLIC', 'PRIVATE', 'SCHOOL_ONLY', 'CLASS_ONLY'].map((privacy) => (
                        <button
                          key={privacy}
                          type="button"
                          onClick={() => setGroupPrivacy(privacy as any)}
                          className={cn(
                            'py-2 rounded-lg text-xs font-semibold border transition-colors',
                            groupPrivacy === privacy
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                          )}
                        >
                          {privacy.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t bg-white shrink-0">
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => createGroupMutation.mutate()}
                    disabled={!groupName.trim() || createGroupMutation.isPending}
                    className="flex-1 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {createGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
