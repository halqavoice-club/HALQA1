'use client'

/**
 * useDynamicLayout.ts  (web)
 *
 * Bridge between LiveKit room events / Socket.IO server events
 * and the DynamicLayoutStore Zustand slice.
 *
 * Requirements: 7.1–7.8, 8.2–8.4
 */

import { useEffect, useCallback } from 'react'
import {
  useRoomContext,
  useParticipants,
  useLocalParticipant,
} from '@livekit/components-react'
import {
  RoomEvent,
  ConnectionState,
  type Participant,
  type RemoteParticipant,
  type LocalParticipant,
  type TrackPublication,
  Track,
} from 'livekit-client'
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
// Helper — map LiveKit connection quality string to our union type
// ---------------------------------------------------------------------------

function mapQuality(
  q: string | undefined,
): SpeakerSlot['connectionQuality'] {
  if (q === 'excellent') return 'excellent'
  if (q === 'good') return 'good'
  if (q === 'poor') return 'poor'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Helper — map a LiveKit Participant to a SpeakerSlot
// ---------------------------------------------------------------------------

function mapParticipantToSlot(
  p: Participant,
  seatIndex = 0,
): SpeakerSlot {
  // Try to read seatIndex from participant metadata JSON
  let resolvedIndex = seatIndex
  if (p.metadata) {
    try {
      const meta = JSON.parse(p.metadata)
      if (typeof meta.seatIndex === 'number') {
        resolvedIndex = meta.seatIndex
      }
    } catch {
      // ignore parse errors
    }
  }

  // Derive role from metadata
  let role: SpeakerSlot['role'] = 'speaker'
  if (p.metadata) {
    try {
      const meta = JSON.parse(p.metadata)
      if (meta.role === 'owner') role = 'owner'
      else if (meta.role === 'moderator') role = 'moderator'
    } catch {
      // ignore
    }
  }

  return {
    userId: p.identity,
    seatIndex: resolvedIndex,
    role,
    displayName: p.name ?? p.identity,
    avatarUrl: undefined,
    isMuted: !p.isMicrophoneEnabled,
    isSpeaking: p.isSpeaking,
    isOnline: true,
    connectionQuality: mapQuality(p.connectionQuality as string),
  }
}

// ---------------------------------------------------------------------------
// Module-level socket singleton (one per API URL)
// ---------------------------------------------------------------------------

let _socket: Socket | null = null

function getSocket(): Socket {
  if (!_socket) {
    const url =
      (process.env.NEXT_PUBLIC_API_URL as string | undefined) ?? ''
    _socket = io(url, { autoConnect: false })
  }
  return _socket
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDynamicLayout(roomId: string): UseDynamicLayoutReturn {
  const store = useDynamicLayoutStore()
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()

  // -------------------------------------------------------------------------
  // Initial sync — add all current participants on mount / reconnect
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!room) return
    const allParticipants: Participant[] = [
      localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ]
    store.setSpeakers(
      allParticipants.map((p, i) => mapParticipantToSlot(p, i)),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  // -------------------------------------------------------------------------
  // LiveKit room events
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!room) return

    const onParticipantConnected = (p: RemoteParticipant) => {
      store.addSpeaker(mapParticipantToSlot(p))
    }

    const onParticipantDisconnected = (p: RemoteParticipant) => {
      store.removeSpeaker(p.identity)
    }

    const onTrackMuted = (
      pub: TrackPublication,
      p: Participant,
    ) => {
      if (pub.kind === Track.Kind.Audio) {
        store.updateSpeaker(p.identity, { isMuted: true })
      }
    }

    const onTrackUnmuted = (
      pub: TrackPublication,
      p: Participant,
    ) => {
      if (pub.kind === Track.Kind.Audio) {
        store.updateSpeaker(p.identity, { isMuted: false })
      }
    }

    const onConnectionStateChanged = (state: ConnectionState) => {
      if (state === ConnectionState.Disconnected) {
        // Req 8.2 — mark all speakers unknown/offline; do NOT clear array
        const { speakers } = store
        for (const sp of speakers) {
          store.updateSpeaker(sp.userId, {
            connectionQuality: 'unknown',
            isOnline: false,
          })
        }
      } else if (state === ConnectionState.Connected) {
        // Req 8.3 — resync on reconnect
        const allParticipants: Participant[] = [
          localParticipant,
          ...Array.from(room.remoteParticipants.values()),
        ]
        store.setSpeakers(
          allParticipants.map((p, i) => mapParticipantToSlot(p, i)),
        )
      }
    }

    room.on(RoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    room.on(RoomEvent.TrackMuted, onTrackMuted)
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted)
    room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged)

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      room.off(RoomEvent.TrackMuted, onTrackMuted)
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted)
      room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, localParticipant])

  // -------------------------------------------------------------------------
  // Socket.IO events
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

    return () => {
      socket.off('voice:seat_changed', onSeatChanged)
      socket.off('voice:role_changed', onRoleChanged)
      socket.off('voice:room_state', onRoomState)
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
