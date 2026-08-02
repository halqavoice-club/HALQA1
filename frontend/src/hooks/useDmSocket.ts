'use client'
import { useEffect, useRef } from 'react'
import { getSocket } from '@/lib/socket'
import { useDmStore, type DmMessage } from '@/store/dm.store'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { dmApi } from '@/lib/dm'

/** Mount once in the dashboard layout. Handles all DM socket events globally. */
export function useDmSocket() {
  const { user, isAuthenticated } = useAuthStore()
  const { toast } = useToast()
  const {
    addMessage, updateMessageStatus, setTyping,
    incrementUnread, updateConversationPreview,
    clearUnread, setTotalUnread,
  } = useDmStore()

  // Guard against React 18 Strict Mode double-invoke:
  // track whether we've already fetched the unread count this mount.
  const fetchedRef = useRef(false)

  // Load initial unread count — only once per authenticated session
  useEffect(() => {
    if (!isAuthenticated || !user?.id || fetchedRef.current) return
    fetchedRef.current = true
    dmApi.unreadCount()
      .then(r => setTotalUnread(r.data.data?.total ?? 0))
      .catch(() => {}) // non-fatal — badge just shows 0
    return () => {
      // Reset on unmount so next login re-fetches
      fetchedRef.current = false
    }
  }, [isAuthenticated, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Typing auto-clear timers
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const socket = getSocket()
    if (!socket || !user?.id) return

    // ── Incoming message ─────────────────────────────────────────────────
    const onMessage = (data: { convId: string; message: DmMessage }) => {
      const { convId, message } = data
      addMessage(convId, message)
      updateConversationPreview(convId, message)

      const currentConvId = useDmStore.getState().activeConvId
      if (currentConvId === convId) {
        dmApi.markRead(convId).then(() => clearUnread(convId)).catch(() => {})
      } else {
        incrementUnread(convId)
        toast({
          title:       `💬 ${message.sender.firstName} ${message.sender.lastName}`,
          description: message.body.slice(0, 60) + (message.body.length > 60 ? '…' : ''),
        })
      }
    }

    // ── Delivered receipt ────────────────────────────────────────────────
    const onDelivered = (data: { convId: string; messageIds: string[] }) => {
      updateMessageStatus(data.convId, data.messageIds, 'DELIVERED', new Date().toISOString())
    }

    // ── Read receipt ─────────────────────────────────────────────────────
    const onRead = (data: { convId: string; readBy: string; readAt: string }) => {
      const msgs = useDmStore.getState().messages[data.convId] ?? []
      const myMsgIds = msgs
        .filter(m => m.senderId === user.id && m.status !== 'READ')
        .map(m => m.id)
      if (myMsgIds.length > 0) {
        updateMessageStatus(data.convId, myMsgIds, 'READ', data.readAt)
      }
    }

    // ── Typing ───────────────────────────────────────────────────────────
    const onTypingStart = (data: { convId: string; userId: string }) => {
      setTyping(data.convId, data.userId, true)
      const key = `${data.convId}:${data.userId}`
      clearTimeout(typingTimers.current[key])
      typingTimers.current[key] = setTimeout(
        () => setTyping(data.convId, data.userId, false),
        4000
      )
    }

    const onTypingStop = (data: { convId: string; userId: string }) => {
      const key = `${data.convId}:${data.userId}`
      clearTimeout(typingTimers.current[key])
      setTyping(data.convId, data.userId, false)
    }

    // ── Reconnect — re-sync unread count ─────────────────────────────────
    const onReconnect = () => {
      dmApi.unreadCount()
        .then(r => setTotalUnread(r.data.data?.total ?? 0))
        .catch(() => {})
    }

    socket.on('dm:message',      onMessage)
    socket.on('dm:delivered',    onDelivered)
    socket.on('dm:read',         onRead)
    socket.on('dm:typing_start', onTypingStart)
    socket.on('dm:typing_stop',  onTypingStop)
    socket.io?.on('reconnect',   onReconnect)

    return () => {
      socket.off('dm:message',      onMessage)
      socket.off('dm:delivered',    onDelivered)
      socket.off('dm:read',         onRead)
      socket.off('dm:typing_start', onTypingStart)
      socket.off('dm:typing_stop',  onTypingStop)
      socket.io?.off('reconnect',   onReconnect)
      Object.values(typingTimers.current).forEach(clearTimeout)
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
