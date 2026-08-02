'use client'
/**
 * useGroupChatSocket — global group-chat socket hook.
 * Mount once in the dashboard layout.
 *
 * Handles events that should be processed even when the user is NOT
 * on the /group-chat page:
 *   - group:message   → increment unread badge, show toast
 *   - group:message_deleted → remove message from store if loaded
 *   - group:reaction  → update reaction in store if loaded
 *
 * The /group-chat page itself handles join/leave and updates its own
 * messages in real-time while it's mounted.
 */
import { useEffect } from 'react'
import { getSocket } from '@/lib/socket'
import { useGroupChatStore, type GcMessage, type GcReaction } from '@/store/groupChat.store'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'

export function useGroupChatSocket() {
  const { user, isAuthenticated } = useAuthStore()
  const { toast } = useToast()
  const {
    addMessage,
    removeMessage,
    updateReaction,
    incrementUnread,
    activeConvId,
  } = useGroupChatStore()

  useEffect(() => {
    const socket = getSocket()
    if (!socket || !user?.id || !isAuthenticated) return

    const onMessage = (msg: GcMessage) => {
      const currentConvId = useGroupChatStore.getState().activeConvId
      // Normalise readBy
      const normalised: GcMessage = {
        ...msg,
        readBy: Array.isArray((msg as any).reads)
          ? (msg as any).reads.map((r: any) => r.userId)
          : (msg.readBy ?? []),
      }

      if (currentConvId !== msg.conversationId) {
        // Not currently viewing this conversation — increment badge and toast
        incrementUnread(msg.conversationId)
        toast({
          title: `💬 ${msg.sender?.firstName ?? 'Group message'}`,
          description: (msg.body ?? '').slice(0, 60) + ((msg.body ?? '').length > 60 ? '…' : ''),
        })
      }
      // addMessage is safe even if the conv isn't loaded — the page will
      // setMessages on next open. Only add if store already has messages for it.
      const loaded = useGroupChatStore.getState().messages[msg.conversationId]
      if (loaded) {
        addMessage(msg.conversationId, normalised)
      }
    }

    const onDeleted = (data: { messageId: string; conversationId: string }) => {
      removeMessage(data.conversationId, data.messageId)
    }

    const onReaction = (data: { messageId: string; reaction: GcReaction; conversationId?: string }) => {
      if (data.conversationId) {
        updateReaction(data.conversationId, data.messageId, data.reaction)
      }
    }

    socket.on('group:message',         onMessage)
    socket.on('group:message_deleted', onDeleted)
    socket.on('group:reaction',        onReaction)

    return () => {
      socket.off('group:message',         onMessage)
      socket.off('group:message_deleted', onDeleted)
      socket.off('group:reaction',        onReaction)
    }
  }, [user?.id, isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps
}
