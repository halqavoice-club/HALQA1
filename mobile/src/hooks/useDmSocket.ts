/**
 * useDmSocket — subscribes to all DM socket events for a given conversation.
 *
 * Encapsulates the repeated socket.on/off boilerplate so each DM screen
 * doesn't need to inline it. Mirrors the event handling in the web /dm page.
 *
 * Usage:
 *   useDmSocket({ convId, userId, onMessage, onDelivered, onRead, onEdited,
 *                 onTypingStart, onTypingStop })
 */
import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';

interface Options {
  convId: string | null;
  userId?: string;
  onMessage?: (data: { convId: string; message: any }) => void;
  onDelivered?: (data: { convId: string; messageIds: string[]; at: string }) => void;
  onRead?: (data: { convId: string; readAt: string; readBy: string }) => void;
  onEdited?: (data: { convId: string; messageId: string; newBody: string; editedAt: string }) => void;
  onTypingStart?: (data: { convId: string; userId: string }) => void;
  onTypingStop?: (data: { convId: string; userId: string }) => void;
}

export function useDmSocket({
  convId,
  userId,
  onMessage,
  onDelivered,
  onRead,
  onEdited,
  onTypingStart,
  onTypingStop,
}: Options) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !convId) return;

    const handlers: Array<[string, (...args: any[]) => void]> = [];

    if (onMessage) {
      const fn = (data: any) => { if (data.convId === convId) onMessage(data); };
      socket.on('dm:message', fn);
      handlers.push(['dm:message', fn]);
    }
    if (onDelivered) {
      const fn = (data: any) => { if (data.convId === convId) onDelivered(data); };
      socket.on('dm:delivered', fn);
      handlers.push(['dm:delivered', fn]);
    }
    if (onRead) {
      const fn = (data: any) => { if (data.convId === convId) onRead(data); };
      socket.on('dm:read', fn);
      handlers.push(['dm:read', fn]);
    }
    if (onEdited) {
      const fn = (data: any) => { if (data.convId === convId) onEdited(data); };
      socket.on('dm:message_edited', fn);
      handlers.push(['dm:message_edited', fn]);
    }
    if (onTypingStart) {
      const fn = (data: any) => {
        if (data.convId === convId && data.userId !== userId) onTypingStart(data);
      };
      socket.on('dm:typing_start', fn);
      handlers.push(['dm:typing_start', fn]);
    }
    if (onTypingStop) {
      const fn = (data: any) => {
        if (data.convId === convId) onTypingStop(data);
      };
      socket.on('dm:typing_stop', fn);
      handlers.push(['dm:typing_stop', fn]);
    }

    return () => {
      handlers.forEach(([event, fn]) => socket.off(event, fn));
    };
  }, [convId, userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * useEmitDmTyping — returns a function to call on text change.
 * Emits dm:typing_start throttled to once per 2.5s, then dm:typing_stop
 * after 2.5s of inactivity. Cleans up on unmount.
 */
import { useRef, useCallback } from 'react';

export function useEmitDmTyping(convId: string | null, receiverId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEmit = useRef(0);

  const emit = useCallback(() => {
    if (!convId || !receiverId) return;
    const socket = getSocket();
    if (!socket) return;
    const now = Date.now();
    if (now - lastEmit.current > 2500) {
      socket.emit('dm:typing_start', { convId, receiverId });
      lastEmit.current = now;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      socket.emit('dm:typing_stop', { convId, receiverId });
      lastEmit.current = 0;
    }, 2500);
  }, [convId, receiverId]);

  // Stop typing on unmount
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      if (!convId || !receiverId) return;
      getSocket()?.emit('dm:typing_stop', { convId, receiverId });
    };
  }, [convId, receiverId]);

  return emit;
}
