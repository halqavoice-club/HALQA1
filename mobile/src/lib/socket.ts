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
    // Must start with polling so Socket.IO can upgrade to websocket.
    // Starting with websocket-only fails behind most reverse proxies.
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
  });

  socket.on('connect',       () => console.log('[socket] connected:', socket?.id));
  socket.on('disconnect',    (r) => console.log('[socket] disconnected:', r));
  socket.on('connect_error', (e) => console.warn('[socket] error:', e.message));

  return socket;
}

export function getSocket(): Socket | null { return socket; }

/**
 * VC-SYNC-001: Update the socket's auth token without full reconnection.
 *
 * Socket.IO uses the auth token ONLY during the initial handshake and on
 * each reconnection attempt. When the access token is refreshed, the existing
 * connected socket still works — but if it disconnects (network blip, app
 * foreground) and tries to reconnect, it will use the stale token and be
 * rejected by the auth middleware.
 *
 * Fix: update socket.auth.token whenever a new access token is issued.
 * The next reconnection attempt will use the fresh token automatically.
 * No disconnect/reconnect is needed for the currently-connected socket.
 *
 * Called from: auth.store.ts → login() and restoreSession()
 */
export function updateSocketToken(token: string): void {
  if (!socket) {
    console.warn('[socket] updateSocketToken called before socket initialized');
    return;
  }
  // Mutate auth in-place — Socket.IO reads it on each reconnect attempt.
  // Do NOT log the token value.
  socket.auth = { ...(socket.auth as object), token };
  // If the socket is currently disconnected and not actively reconnecting,
  // reconnect immediately with the fresh token instead of waiting for
  // the next reconnection delay.
  if (!socket.connected && !socket.active) {
    socket.connect();
  }
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
