'use client'

import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/store/auth.store'

let socket: Socket | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
// Guard: prevent concurrent token-refresh calls triggered by rapid connect_error bursts.
let _isRefreshingForSocket = false

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
    reconnectionAttempts: 15,  // bounded — prevents infinite storm on permanent token expiry
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,    // cap at 10s so reconnect is prompt after a restart
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
    // Proactively refresh the access token when the server rejects it.
    // This closes the timing gap between token expiry and the next HTTP 401:
    // instead of waiting for an API call to fail and trigger the interceptor,
    // we refresh here as soon as the socket reports the rejection reason.
    // _isRefreshingForSocket prevents rapid-fire connect_error bursts from
    // calling refreshToken() more than once at a time.
    const isTokenError = msg.includes('Token expired') || msg.includes('Invalid token')
    if (isTokenError && !_isRefreshingForSocket) {
      _isRefreshingForSocket = true
      useAuthStore.getState().refreshToken().finally(() => {
        _isRefreshingForSocket = false
      })
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
  if (socket.active && !socket.connected) {
    // Socket is mid-reconnect with the stale token. Interrupt the current
    // reconnect cycle, apply the fresh token, and restart the handshake.
    socket.disconnect()
    socket.auth = { token }
    socket.connect()
  } else if (!socket.connected && !socket.active) {
    // Socket is fully stopped — reconnect immediately with fresh token.
    socket.connect()
  }
  // If socket.connected === true: auth is updated in-place; used on next reconnect.
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
  socket?.emit('class:join', classId)
}

export function leaveClass(classId: string) {
  socket?.emit('class:leave', classId)
}
