'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/store/auth.store'
import { getSocket } from '@/lib/socket'
import { useDebounce } from '@/hooks/useDebounce'
import { getAvatarUrl } from '@/lib/avatar'
import {
  Send, MessageSquare, Plus, X, Paperclip,
  CheckCheck, Check, Loader2, Inbox, SendHorizonal,
  Trash2, Search, RefreshCw
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMsgTime(date: string) {
  const d = new Date(date)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

function getInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // ── State ──
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox')
  const [selectedMsg, setSelectedMsg] = useState<any>(null)
  const [showCompose, setShowCompose] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()

  // Compose state
  const [composeBody, setComposeBody] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [recipients, setRecipients] = useState<any[]>([])
  const [composeAttachments, setComposeAttachments] = useState<string[]>([])
  const [attachUploading, setAttachUploading] = useState(false)
  const attachFileRef = useRef<HTMLInputElement>(null)
  const debouncedRecipientSearch = useDebounce(recipientSearch, 300)

  // ── Queries ──
  const { data: inboxData, isLoading: inboxLoading, isError: inboxError, refetch: refetchInbox } = useQuery({
    queryKey: ['messages', 'inbox'],
    queryFn: () => api.get('/messages/inbox').then(r => r.data),
    refetchInterval: 30000
  })

  const { data: sentData, isLoading: sentLoading } = useQuery({
    queryKey: ['messages', 'sent'],
    queryFn: () => api.get('/messages/sent').then(r => r.data),
    enabled: tab === 'sent'
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-search', debouncedRecipientSearch],
    queryFn: () => api.get('/users', { params: { search: debouncedRecipientSearch, limit: 8 } }).then(r => r.data.data),
    enabled: debouncedRecipientSearch.length >= 2
  })

  const msgId = selectedMsg?.message?.id || selectedMsg?.id
  const { data: msgDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['message', msgId],
    queryFn: () => api.get(`/messages/${msgId}`).then(r => r.data.data),
    enabled: !!msgId
  })

  // ── Mutations ──
  const sendMutation = useMutation({
    mutationFn: () => api.post('/messages', {
      recipientIds: recipients.map(r => r.id),
      subject: composeSubject,
      body: composeBody,
      attachments: composeAttachments,
    }),
    onSuccess: () => {
      toast({ title: 'Message sent' })
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      setShowCompose(false)
      setComposeBody('')
      setComposeSubject('')
      setRecipients([])
      setComposeAttachments([])
    },
    onError: () => toast({ title: 'Failed to send', variant: 'destructive' })
  })

  const handleAttachFile = async (file: File) => {
    setAttachUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const url: string = res.data.data?.url
      if (!url) throw new Error('No URL')
      setComposeAttachments(prev => [...prev, url])
    } catch {
      toast({ title: 'Attachment upload failed', variant: 'destructive' })
    } finally {
      setAttachUploading(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/messages/${id}`),
    onSuccess: () => {
      toast({ title: 'Message deleted' })
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      setSelectedMsg(null)
    },
    onError: () => toast({ title: 'Delete failed', variant: 'destructive' })
  })

  // ── Mark as read when opening ──
  useEffect(() => {
    if (!selectedMsg) return
    // selectedMsg is a MessageRecipient record — use its own id for the read endpoint
    const recipientRecordId = selectedMsg.id
    const currentStatus = selectedMsg.status
    if (currentStatus === 'SENT' && recipientRecordId) {
      api.put(`/messages/${recipientRecordId}/read`).then(() => {
        queryClient.invalidateQueries({ queryKey: ['messages', 'inbox'] })
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
      }).catch(() => {})
    }
  }, [selectedMsg?.id, queryClient])

  // ── Socket events ──
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.on('message:new', () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    socket.on('typing:start', ({ userId }: { userId: string }) => {
      setTypingUsers(prev => new Set([...Array.from(prev), userId]))
    })
    socket.on('typing:stop', ({ userId }: { userId: string }) => {
      setTypingUsers(prev => { const n = new Set(Array.from(prev)); n.delete(userId); return n })
    })

    return () => {
      socket.off('message:new')
      socket.off('typing:start')
      socket.off('typing:stop')
    }
  }, [queryClient])

  // ── Typing indicator ──
  const handleTyping = useCallback(() => {
    const socket = getSocket()
    if (!socket || !msgDetail) return
    const recipientId = msgDetail?.sender?.id
    if (recipientId && recipientId !== user?.id) {
      socket.emit('typing:start', { recipientId })
      clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => {
        socket.emit('typing:stop', { recipientId })
      }, 2000)
    }
  }, [msgDetail, user])

  // ── Reply ──
  const handleReply = async () => {
    if (!replyText.trim() || !msgDetail) return
    const senderId = msgDetail?.sender?.id
    if (!senderId || senderId === user?.id) return
    setReplySending(true)
    try {
      // Use the top-level message id as parentMessageId so replies are threaded
      const topLevelId = msgDetail?.parentMessageId || msgDetail?.id
      await api.post('/messages', {
        recipientIds: [senderId],
        subject: msgDetail?.subject ? `Re: ${msgDetail.subject}` : undefined,
        body: replyText.trim(),
        parentMessageId: topLevelId,
      })
      queryClient.invalidateQueries({ queryKey: ['message', msgId] })
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      toast({ title: 'Reply sent' })
      setReplyText('')
    } catch {
      toast({ title: 'Reply failed', variant: 'destructive' })
    } finally {
      setReplySending(false)
    }
  }

  // ── Compose helpers ──
  const addRecipient = (u: any) => {
    if (!recipients.find(r => r.id === u.id) && u.id !== user?.id) {
      setRecipients(prev => [...prev, u])
    }
    setRecipientSearch('')
  }

  // ── Derived ──
  const rawMessages = tab === 'inbox' ? (inboxData?.data || []) : (sentData?.data || [])
  const messages = listSearch
    ? rawMessages.filter((m: any) => {
        const q = listSearch.toLowerCase()
        const sender = m.message?.sender
        return (
          `${sender?.firstName} ${sender?.lastName}`.toLowerCase().includes(q) ||
          m.message?.subject?.toLowerCase().includes(q) ||
          m.message?.body?.toLowerCase().includes(q)
        )
      })
    : rawMessages

  const unreadCount = (inboxData?.data || []).filter((m: any) => m.status === 'SENT').length
  const isLoading = tab === 'inbox' ? inboxLoading : sentLoading

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-gray-500 text-sm">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <Button onClick={() => setShowCompose(true)} className="bg-halqa-700 hover:bg-halqa-800 gap-2">
          <Plus className="w-4 h-4" /> Compose
        </Button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ── LEFT PANEL — message list ── */}
        <Card className="w-80 flex-shrink-0 border-0 shadow-sm flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b flex-shrink-0">
            <button
              onClick={() => setTab('inbox')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                tab === 'inbox' ? 'text-halqa-700 border-b-2 border-halqa-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Inbox className="w-3.5 h-3.5" />
              Inbox
              {unreadCount > 0 && (
                <span className="bg-halqa-600 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('sent')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                tab === 'sent' ? 'text-halqa-700 border-b-2 border-halqa-700' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <SendHorizonal className="w-3.5 h-3.5" />
              Sent
            </button>
          </div>

          {/* Search */}
          <div className="p-2 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder="Search messages..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-halqa-400 bg-gray-50"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : inboxError && tab === 'inbox' ? (
              <div className="p-4">
                <ErrorState onRetry={refetchInbox} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-gray-400">
                <MessageSquare className="w-10 h-10 mb-2 text-gray-200" />
                <p className="text-sm">{listSearch ? 'No results' : `No ${tab} messages`}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {messages.map((item: any) => {
                  const isSelected = selectedMsg?.id === item.id
                  const isUnread = item.status === 'SENT' && tab === 'inbox'
                  const person = tab === 'inbox' ? item.message?.sender : item.recipients?.[0]?.recipient

                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedMsg(item)}
                      className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-halqa-50 border-r-2 border-halqa-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar className="w-9 h-9 flex-shrink-0 mt-0.5">
                          <AvatarImage src={getAvatarUrl(person?.avatarUrl)} />
                          <AvatarFallback className="bg-halqa-100 text-halqa-700 text-xs font-semibold">
                            {getInitials(person?.firstName, person?.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                              {person?.firstName} {person?.lastName}
                            </p>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              {formatMsgTime(item.message?.createdAt || item.createdAt)}
                            </span>
                          </div>
                          {item.message?.subject && (
                            <p className={`text-xs truncate mt-0.5 ${isUnread ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                              {item.message.subject}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {item.message?.body?.substring(0, 55)}
                          </p>
                        </div>
                        {isUnread && (
                          <div className="w-2 h-2 bg-halqa-500 rounded-full flex-shrink-0 mt-2" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Card>

        {/* ── RIGHT PANEL — message detail ── */}
        <Card className="flex-1 border-0 shadow-sm flex flex-col overflow-hidden">
          {selectedMsg ? (
            <>
              {/* Message header */}
              <div className="p-4 border-b flex-shrink-0">
                {detailLoading ? (
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <Avatar className="w-10 h-10 flex-shrink-0">
                      <AvatarImage src={getAvatarUrl(msgDetail?.sender?.avatarUrl)} />
                      <AvatarFallback className="bg-halqa-100 text-halqa-700 font-semibold">
                        {getInitials(msgDetail?.sender?.firstName, msgDetail?.sender?.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">
                        {msgDetail?.sender?.firstName} {msgDetail?.sender?.lastName}
                      </p>
                      {msgDetail?.subject && (
                        <p className="text-sm text-gray-700 font-medium mt-0.5">{msgDetail.subject}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {msgDetail?.createdAt && format(new Date(msgDetail.createdAt), 'MMMM d, yyyy · h:mm a')}
                      </p>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        {msgDetail?.recipients?.every((r: any) => r.status === 'READ')
                          ? <><CheckCheck className="w-4 h-4 text-halqa-500" /> Read</>
                          : <><Check className="w-4 h-4" /> Sent</>
                        }
                      </div>
                      <button
                        onClick={() => deleteMutation.mutate(selectedMsg.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        {deleteMutation.isPending
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />
                        }
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Message body */}
              <div className="flex-1 overflow-y-auto p-5">
                {detailLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                ) : (
                  <>
                    <p className="text-gray-700 whitespace-pre-wrap leading-relaxed text-sm">
                      {msgDetail?.body}
                    </p>

                    {/* Attachments */}
                    {msgDetail?.attachments && msgDetail.attachments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                          <Paperclip className="w-3 h-3" /> Attachments
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {msgDetail.attachments.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-halqa-600 hover:text-halqa-700 underline">
                              Attachment {i + 1}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reply thread */}
                    {msgDetail?.replies && msgDetail.replies.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          {msgDetail.replies.length} {msgDetail.replies.length === 1 ? 'Reply' : 'Replies'}
                        </p>
                        {msgDetail.replies.map((reply: any) => (
                          <div key={reply.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <Avatar className="w-7 h-7 flex-shrink-0 mt-0.5">
                              <AvatarImage src={getAvatarUrl(reply.sender?.avatarUrl)} />
                              <AvatarFallback className="bg-halqa-100 text-halqa-700 text-[10px]">
                                {getInitials(reply.sender?.firstName, reply.sender?.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <p className="text-xs font-semibold text-gray-800">
                                  {reply.sender?.firstName} {reply.sender?.lastName}
                                </p>
                                <span className="text-[10px] text-gray-400">
                                  {reply.createdAt && format(new Date(reply.createdAt), 'MMM d · h:mm a')}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{reply.body}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Typing indicator */}
                    {typingUsers.size > 0 && (
                      <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
                        <div className="flex gap-0.5">
                          {[0, 1, 2].map(i => (
                            <div key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }} />
                          ))}
                        </div>
                        <span>Typing...</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Reply bar — only show for inbox messages where sender isn't self */}
              {tab === 'inbox' && msgDetail?.sender?.id !== user?.id && (
                <div className="p-3 border-t flex-shrink-0 bg-gray-50/80">
                  <div className="flex gap-2">
                    <input
                      value={replyText}
                      onChange={e => { setReplyText(e.target.value); handleTyping() }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleReply()
                        }
                      }}
                      placeholder="Write a reply... (Enter to send)"
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 bg-white"
                    />
                    <Button
                      size="sm"
                      onClick={handleReply}
                      disabled={!replyText.trim() || replySending}
                      className="bg-halqa-700 hover:bg-halqa-800 px-3"
                    >
                      {replySending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Send className="w-4 h-4" />
                      }
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-gray-300" />
                </div>
                <p className="font-medium text-gray-500">Select a message</p>
                <p className="text-sm text-gray-400 mt-1">Or compose a new one</p>
                <Button
                  onClick={() => setShowCompose(true)}
                  className="mt-4 bg-halqa-700 hover:bg-halqa-800 gap-2"
                  size="sm"
                >
                  <Plus className="w-4 h-4" /> Compose
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── COMPOSE MODAL ── */}
      <Modal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        title="New Message"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCompose(false)}>Cancel</Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={recipients.length === 0 || !composeBody.trim() || sendMutation.isPending}
              className="bg-halqa-700 hover:bg-halqa-800 gap-2"
            >
              {sendMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                : <><Send className="w-4 h-4" /> Send</>
              }
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* To field */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">To</label>
            <div className="mt-1.5 border border-gray-200 rounded-lg p-2 min-h-[42px] flex flex-wrap gap-1.5 focus-within:border-halqa-400 transition-colors">
              {recipients.map(r => (
                <Badge key={r.id} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5">
                  <Avatar className="w-4 h-4">
                    <AvatarFallback className="text-[8px] bg-halqa-100 text-halqa-700">
                      {getInitials(r.firstName, r.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs">{r.firstName} {r.lastName}</span>
                  <button
                    onClick={() => setRecipients(prev => prev.filter(x => x.id !== r.id))}
                    className="hover:text-red-500 transition-colors ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              <input
                className="flex-1 min-w-[140px] text-sm outline-none bg-transparent placeholder:text-gray-400"
                placeholder={recipients.length === 0 ? 'Search by name...' : ''}
                value={recipientSearch}
                onChange={e => setRecipientSearch(e.target.value)}
              />
            </div>
            {/* Search results */}
            {usersData && usersData.length > 0 && recipientSearch.length >= 2 && (
              <div className="border border-gray-200 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-sm bg-white">
                {usersData
                  .filter((u: any) => u.id !== user?.id && !recipients.find(r => r.id === u.id))
                  .map((u: any) => (
                    <button
                      key={u.id}
                      onClick={() => addRecipient(u)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-halqa-50 flex items-center gap-2.5 transition-colors"
                    >
                      <Avatar className="w-7 h-7 flex-shrink-0">
                        <AvatarImage src={getAvatarUrl(u.avatarUrl)} />
                        <AvatarFallback className="text-[10px] bg-halqa-100 text-halqa-700">
                          {getInitials(u.firstName, u.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-gray-900">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-400">{u.role?.replace(/_/g, ' ')}</p>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject</label>
            <input
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 transition-colors"
              placeholder="Optional subject..."
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Message</label>
            <textarea
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-halqa-400 transition-colors resize-none min-h-[140px]"
              placeholder="Write your message..."
              value={composeBody}
              onChange={e => setComposeBody(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{composeBody.length} chars</p>
          </div>

          {/* Attachments */}
          <div>
            <input
              ref={attachFileRef}
              type="file"
              accept="image/*,video/*,application/pdf,.doc,.docx"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleAttachFile(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => attachFileRef.current?.click()}
              disabled={attachUploading}
              className="flex items-center gap-1.5 text-xs text-halqa-600 hover:text-halqa-700 font-medium disabled:opacity-50"
            >
              {attachUploading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Paperclip className="w-3.5 h-3.5" />
              }
              Attach file
            </button>
            {composeAttachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {composeAttachments.map((url, i) => (
                  <div key={i} className="flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1 text-xs text-gray-600">
                    <Paperclip className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">{url.split('/').pop()}</span>
                    <button
                      onClick={() => setComposeAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500 ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
