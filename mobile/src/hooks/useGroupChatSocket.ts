/**
 * useGroupChatSocket — subscribes to all group chat socket events for a conversation.
 *
 * Joins the group:join room on mount and leaves on unmount.
 * Mirrors the event handling in the web /group-chat page.
 *
 * Usage:
 *   useGroupChatSocket({ convId, userId, onMessage, onReaction,
 *                        onDeleted, onPinned, onTypingStart, onTypingStop })
 */
import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';

interface Options {
  convId: string | null;
  userId?: string;
  onMessage?: (msg: any) => void;
  onReaction?: (data: { messageId: string; reaction: any }) => void;
  onDeleted?: (data: { messageId: string; conversationId: string }) => void;
  onPinned?: (data: { messageId: string; conversationId: string; pin: boolean }) => void;
  onTypingStart?: (data: { convId: string; userId: string; userName: string }) => void;
  onTypingStop?: (data: { convId: string; userId: string; userName: string }) => void;
}

export function useGroupChatSocket({
  convId,
  userId,
  onMessage,
  onReaction,
  onDeleted,
  onPinned,
  onTypingStart,
  onTypingStop,
}: Options) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;

    socket.emit('group:join', convId);
    const handlers: Array<[string, (...args: any[]) => void]> = [];

    if (onMessage) {
      const fn = (msg: any) => { if (msg.conversationId === convId) onMessage(msg); };
      socket.on('group:message', fn);
      handlers.push(['group:message', fn]);
    }
    if (onReaction) {
      const fn = (data: any) => onReaction(data);
      socket.on('group:reaction', fn);
      handlers.push(['group:reaction', fn]);
    }
    if (onDeleted) {
      const fn = (data: any) => { if (data.conversationId === convId) onDeleted(data); };
      socket.on('group:message_deleted', fn);
      handlers.push(['group:message_deleted', fn]);
    }
    if (onPinned) {
      const fn = (data: any) => { if (data.conversationId === convId) onPinned(data); };
      socket.on('group:message_pinned', fn);
      handlers.push(['group:message_pinned', fn]);
    }
    if (onTypingStart) {
      const fn = (data: any) => {
        if (data.convId === convId && data.userId !== userId) onTypingStart(data);
      };
      socket.on('group:typing_start', fn);
      handlers.push(['group:typing_start', fn]);
    }
    if (onTypingStop) {
      const fn = (data: any) => { if (data.convId === convId) onTypingStop(data); };
      socket.on('group:typing_stop', fn);
      handlers.push(['group:typing_stop', fn]);
    }

    return () => {
      socket.emit('group:leave', convId);
      handlers.forEach(([event, fn]) => socket.off(event, fn));
    };
  }, [convId, userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * useEmitGroupTyping — throttled typing emit for group chat.
 * Emits group:typing_start once per 2.5s, then group:typing_stop after 2.5s idle.
 */
export function useEmitGroupTyping(
  convId: string | null,
  userId?: string,
  userName?: string,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastEmit = useRef(0);

  const emit = useCallback(() => {
    if (!convId) return;
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastEmit.current > 2500) {
      socket.emit('group:typing_start', { convId, userId, userName });
      lastEmit.current = now;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      socket.emit('group:typing_stop', { convId, userId, userName });
      lastEmit.current = 0;
    }, 2500);
  }, [convId, userId, userName]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      if (!convId) return;
      getSocket()?.emit('group:typing_stop', { convId, userId, userName });
    };
  }, [convId, userId, userName]);

  return emit;
}
