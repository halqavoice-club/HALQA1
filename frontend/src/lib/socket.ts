'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function getSocket(): Socket | null {
  return socket
}

export function initSocket(token: string): Socket {
  // Return existing connected socket
  if (socket?.connected) return socket

  // Clean up any previous instance
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

  const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000'

  socket = io(url, {
    auth: { token },
    // Start with polling (always works through HTTP/proxies),
    // then upgrade to WebSocket once connection is confirmed.
    // This avoids "Invalid frame header" errors when the WS handshake
    // is intercepted by a reverse proxy or when the backend is behind
    // Next.js dev server.
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
    forceNew: false,
  })

  socket.on('connect', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[socket] connected:', socket?.id, '| transport:', socket?.io?.engine?.transport?.name)
    }
  })

  socket.on('disconnect', (reason) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[socket] disconnected:', reason)
    }
  })

  socket.on('connect_error', (error) => {
    // Suppress noisy "websocket error" in dev when backend is not running.
    // Only log meaningful errors (not the routine WebSocket upgrade failures
    // that resolve automatically once polling handshake completes).
    const msg = error?.message ?? ''
    const isRoutineWsError = msg.toLowerCase().includes('websocket error') ||
                             msg.toLowerCase().includes('xhr poll error')
    if (!isRoutineWsError || process.env.NODE_ENV !== 'development') {
      console.warn('[socket] connection error:', msg)
    }
  })

  return socket
}

/**
 * FE-010: Update the socket's auth token without full reconnection.
 *
 * Socket.IO uses the auth token ONLY during the initial handshake and on
 * each reconnection attempt. When the access token is refreshed (every 15 min),
 * the existing connected socket still works — but if it disconnects (network
 * blip, server restart) and tries to reconnect, it will use the stale token
 * and get an "Invalid token" error from the auth middleware.
 *
 * Fix: update socket.auth.token whenever a new access token is issued.
 * The next reconnection attempt will use the fresh token automatically.
 * No disconnect/reconnect needed for the currently-connected socket.
 *
 * Called from: auth.store.ts → setToken() and refreshToken()
 */
export function updateSocketToken(token: string): void {
  if (!socket) return
  // Mutate the auth object in-place — Socket.IO reads it on each reconnect
  socket.auth = { token }
  // If the socket is currently disconnected (e.g. mid-reconnect loop),
  // reconnect immediately with the fresh token instead of waiting for
  // the next reconnection delay.
  if (!socket.connected && !socket.active) {
    socket.connect()
  }
}

export function disconnectSocket() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export function joinClass(classId: string) {
  socket?.emit('join:class', classId)
}

export function leaveClass(classId: string) {
  socket?.emit('leave:class', classId)
}
