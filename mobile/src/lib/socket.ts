/**
 * HALQA Mobile — Socket.IO client
 * Uses the same dynamic URL as the API client so both
 * update together when the server URL changes at runtime.
 */
import { io, Socket } from 'socket.io-client';
import { getSocketURL } from '@/lib/api';

let socket: Socket | null = null;

export function initSocket(token: string): Socket {
  if (socket?.connected) return socket;

  // Always read the current socket URL (supports runtime override)
  socket = io(getSocketURL(), {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
  });

  socket.on('connect',       () => console.log('[socket] connected:', socket?.id));
  socket.on('disconnect',    (r) => console.log('[socket] disconnected:', r));
  socket.on('connect_error', (e) => console.warn('[socket] error:', e.message));

  return socket;
}

export function getSocket(): Socket | null { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
