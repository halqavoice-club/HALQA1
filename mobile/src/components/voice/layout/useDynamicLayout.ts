/**
 * useDynamicLayout.ts  (React Native)
 *
 * Bridge between LiveKit RN SDK events / Socket.IO server events
 * and the DynamicLayoutStore Zustand slice.
 *
 * Requirements: 7.1–7.8, 8.2–8.4
 */

import { useEffect, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useDynamicLayoutStore } from './useDynamicLayoutStore'
import type {
  SpeakerSlot,
  LayoutMode,
  LayoutResult,
} from '../../../../../src/lib/layout/layoutTypes'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseDynamicLayoutReturn {
  layout: LayoutResult
  currentPage: number
  manualMode: LayoutMode | null
  setPage: (page: number) => void
  setManual: (mode: LayoutMode) => void
  clearManual: () => void
}

// ---------------------------------------------------------------------------
// Helper — map a LiveKit participant to SpeakerSlot
// ---------------------------------------------------------------------------

function mapParticipantToSlot(p: any, seatIndex = 0): SpeakerSlot {
  let resolvedIndex = seatIndex
  let role: SpeakerSlot['role'] = 'speaker'

  if (p.metadata) {
    try {
      const meta = JSON.parse(p.metadata)
      if (typeof meta.seatIndex === 'number') resolvedIndex = meta.seatIndex
      if (meta.role === 'owner') role = 'owner'
      else if (meta.role === 'moderator') role = 'moderator'
    } catch {
      // ignore parse errors
    }
  }

  return {
    userId: p.identity,
    seatIndex: resolvedIndex,
    role,
    displayName: p.name ?? p.identity,
    isMuted: p.isMicrophoneEnabled === false,
    isSpeaking: p.isSpeaking ?? false,
    isOnline: true,
    connectionQuality: 'good',
  }
}

// ---------------------------------------------------------------------------
// Module-level socket singleton
// ---------------------------------------------------------------------------

let _socket: Socket | null = null

function getSocket(): Socket {
  if (!_socket) {
    const url = (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? ''
    _socket = io(url, { autoConnect: false })
  }
  return _socket
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDynamicLayout(roomId: string): UseDynamicLayoutReturn {
  const store = useDynamicLayoutStore()

  // -------------------------------------------------------------------------
  // LiveKit room events
  // NOTE: @livekit/react-native exposes useRoom() / useParticipants() hooks.
  // We import them lazily to avoid hard-dep issues when the RN SDK version
  // changes. If these hooks are unavailable, fall back to socket-only sync.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let room: any
    let unsubscribed = false

    try {
      // Attempt to import LiveKit RN room context
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const lk = require('@livekit/react-native')
      room = lk.useRoom ? undefined : undefined // hook-safe: call inside component only
    } catch {
      return
    }

    return () => {
      unsubscribed = true
    }
  }, [])

  // LiveKit participant change listener (component-level via direct import)
  useEffect(() => {
    let cleanup: (() => void) | undefined

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RoomEvent } = require('livekit-client')

      // We cannot call hooks inside useEffect, so we rely on the store being
      // synced by the parent component via useDynamicLayoutStore.setSpeakers.
      // This hook focuses on socket + disconnect/reconnect handling.
    } catch {
      // livekit-client not available in this environment
    }

    return cleanup
  }, [])

  // -------------------------------------------------------------------------
  // Socket.IO events — Req 7.5–7.7, 8.3
  // -------------------------------------------------------------------------
  useEffect(() => {
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const onSeatChanged = ({
      userId,
      newSeatIndex,
    }: {
      userId: string
      newSeatIndex: number
    }) => {
      store.updateSpeaker(userId, { seatIndex: newSeatIndex })
    }

    const onRoleChanged = ({
      userId,
      role,
    }: {
      userId: string
      role: SpeakerSlot['role']
    }) => {
      store.updateSpeaker(userId, { role })
    }

    const onRoomState = ({ speakers }: { speakers: SpeakerSlot[] }) => {
      store.setSpeakers(speakers)
    }

    socket.on('voice:seat_changed', onSeatChanged)
    socket.on('voice:role_changed', onRoleChanged)
    socket.on('voice:room_state', onRoomState)

    // Disconnect handling — Req 8.4
    const onDisconnect = () => {
      const { speakers } = store
      for (const sp of speakers) {
        store.updateSpeaker(sp.userId, {
          connectionQuality: 'unknown',
          isOnline: false,
        })
      }
    }

    // Reconnect — resync via room_state event (server sends on reconnect)
    socket.on('disconnect', onDisconnect)

    return () => {
      socket.off('voice:seat_changed', onSeatChanged)
      socket.off('voice:role_changed', onRoleChanged)
      socket.off('voice:room_state', onRoomState)
      socket.off('disconnect', onDisconnect)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // -------------------------------------------------------------------------
  // Stable action callbacks
  // -------------------------------------------------------------------------
  const setPage = useCallback(
    (page: number) => store.setCurrentPage(page),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const setManual = useCallback(
    (mode: LayoutMode) => store.setManualMode(mode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const clearManual = useCallback(
    () => store.clearManualMode(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return {
    layout: store.layout,
    currentPage: store.currentPage,
    manualMode: store.manualMode,
    setPage,
    setManual,
    clearManual,
  }
}
