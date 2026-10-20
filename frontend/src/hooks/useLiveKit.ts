'use client'

/**
 * useLiveKit — Voice Room LiveKit hook (VOICE CLUB ONLY)
 *
 * LC-007: This hook is scoped exclusively to the Voice Club (VoiceRoomView).
 * Do NOT use this hook in live class components. The live class system
 * (LiveClassRoomImpl.tsx) manages its own LiveKit Room instance inline
 * and emits `liveclass:speaking` socket events — not `voice:speaking`.
 * Mixing the two would emit wrong event names and break speaker detection.
 *
 * For live class audio, use the inline connectLiveKit() function in
 * LiveClassRoomImpl.tsx, or useLiveKitAudio() on mobile.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
  ConnectionState,
  DisconnectReason,
  type RemoteAudioTrack,
} from 'livekit-client'
import api from '@/lib/api'
import { useVoiceStore } from '@/store/voice.store'
import { getSocket } from '@/lib/socket'

export interface LiveKitState {
  room: Room | null
  connectionState: ConnectionState
  isMicEnabled: boolean
  activeSpeakers: Set<string>
  connect: () => Promise<void>
  disconnect: () => void
  toggleMic: () => Promise<void>
  // Called by useVoiceRoom when Socket.IO says role changed — no reconnect needed
  enableMic: () => Promise<void>
  disableMic: () => Promise<void>
}

// ─── Reconnect policy ─────────────────────────────────────────────────────────
// These reasons are user-initiated or fatal — do NOT auto-reconnect.
const NO_RECONNECT_REASONS = new Set([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.PARTICIPANT_REMOVED,
])

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY_MS = 1500 // doubles each attempt: 1.5s → 3s → 6s → 12s → 24s

// ─── Audio element pool ───────────────────────────────────────────────────────
// One RemoteAudioTrack per remote participant identity.
// Use track.attach() / track.detach() — never manual MediaStream construction.
// Elements are positioned off-screen (not display:none) to prevent browsers
// and LiveKit's adaptiveStream from pausing them.
const audioTracks = new Map<string, RemoteAudioTrack>()

function attachAudio(identity: string, track: RemoteAudioTrack) {
  detachAudio(identity)
  const el = track.attach()
  el.setAttribute('playsinline', '') // iOS Safari
  // Off-screen but technically visible — prevents autoplay suppression
  el.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(el)
  audioTracks.set(identity, track)
  const tryPlay = () => el.play().catch(() => {})
  tryPlay()
  document.addEventListener('click',      tryPlay, { once: true })
  document.addEventListener('touchstart', tryPlay, { once: true })
}

function detachAudio(identity: string) {
  const track = audioTracks.get(identity)
  if (track) {
    track.detach().forEach(el => el.remove())
    audioTracks.delete(identity)
  }
}

function detachAllAudio() {
  audioTracks.forEach(t => t.detach().forEach(el => el.remove()))
  audioTracks.clear()
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLiveKit(roomId: string | null): LiveKitState {
  const { setSpeaking } = useVoiceStore()

  const roomRef           = useRef<Room | null>(null)
  const reconnectTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const isUnmounted       = useRef(false)
  const isConnecting      = useRef(false)

  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [isMicEnabled, setIsMicEnabled]       = useState(false)
  const [activeSpeakers, setActiveSpeakers]   = useState<Set<string>>(new Set())
  const activeSpeakersRef = useRef<Set<string>>(new Set())

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
  }, [])

  // ── Core connect — called ONCE per room session ────────────────────────────
  const connect = useCallback(async () => {
    if (!roomId) return
    if (isUnmounted.current) return
    if (isConnecting.current) return
    if (roomRef.current?.state === ConnectionState.Connected) return

    isConnecting.current = true
    clearReconnectTimer()

    if (roomRef.current) {
      roomRef.current.removeAllListeners()
      roomRef.current.disconnect()
      roomRef.current = null
    }
    detachAllAudio()

    try {
      // Fetch token — backend returns micEnabled based on current role.
      // Token always has canPublish: true; mic state is controlled here, not by token.
      const res = await api.post(`/voice/${roomId}/livekit-token`)
      const { token, livekitUrl, micEnabled } = res.data.data

      if (isUnmounted.current) return

      const room = new Room({
        // ─── Phase 4: Low-network LiveKit optimizations ──────────────────────
        // adaptiveStream: false — prevents LiveKit silencing off-screen audio
        // elements (critical for voice-only rooms with no video in viewport).
        adaptiveStream: false,

        // dynacast: only publish when subscribers exist — saves uplink on 2G/3G
        dynacast: true,

        // Phase 7: aggressive reconnect for unstable mobile networks
        // Retries: 2s, 4s, 6s, 8s, 10s (max 5 attempts before giving up)
        reconnectPolicy: {
          nextRetryDelayInMs: (context) => {
            if (context.retryCount >= 5) return null
            return Math.min((context.retryCount + 1) * 2000, 10_000)
          },
        },

        // Phase 4: voice-quality audio capture settings
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
          // sampleRate: 16000 would save bandwidth further but reduces quality
          // Leaving at default (48kHz) — bitrate is the primary lever instead
        },

        // Phase 4: audio publish defaults with DTX (silence suppression)
        // DTX reduces uplink ~70% when the mic is open but nobody is speaking.
        // This is especially important for audience members who have canPublish:true
        // but are not speaking — they use almost no bandwidth.
        publishDefaults: {
          dtx:          true,   // Discontinuous Transmission — silence suppression
          red:          true,   // Redundancy / FEC — recovers ~15% packet loss
          audioPreset: {
            maxBitrate:  96_000, // 96kbps max — good-quality voice
          },
        },
      })

      roomRef.current = room

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (isUnmounted.current) return
        setConnectionState(state)
        if (state === ConnectionState.Connected) {
          reconnectAttempts.current = 0
          clearReconnectTimer()
        }
      })

      room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (isUnmounted.current) return
        setIsMicEnabled(false)
        setActiveSpeakers(new Set())
        activeSpeakersRef.current = new Set()
        detachAllAudio()

        // Clear any pending token refresh timer
        if ((roomRef.current as any)?._tokenRefreshTimer) {
          clearTimeout((roomRef.current as any)._tokenRefreshTimer)
        }

        const shouldReconnect = reason === undefined || !NO_RECONNECT_REASONS.has(reason)
        if (shouldReconnect && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.current)
          reconnectAttempts.current += 1
          // connect() always fetches a fresh token — handles 1h TTL expiry transparently
          reconnectTimer.current = setTimeout(() => { isConnecting.current = false; connect() }, delay)
        }
      })

      // ── Token refresh: proactive reconnect 5 min before 1-hour token expires ──
      // The LiveKit token TTL is 1h. At 55 min we gracefully reconnect so the
      // user never sees a forced disconnection from token expiry.
      const TOKEN_REFRESH_MS = 55 * 60 * 1000 // 55 minutes
      const tokenRefreshTimer = setTimeout(() => {
        if (isUnmounted.current) return
        const r = roomRef.current
        if (r && r.state === ConnectionState.Connected) {
          // Reset reconnect counter so the next connect() is treated as fresh
          reconnectAttempts.current = 0
          isConnecting.current = false
          r.disconnect() // triggers Disconnected → connect() with a new token
        }
      }, TOKEN_REFRESH_MS)
      ;(room as any)._tokenRefreshTimer = tokenRefreshTimer

      room.on(RoomEvent.Reconnecting, () => {
        if (!isUnmounted.current) setConnectionState(ConnectionState.Reconnecting)
      })

      room.on(RoomEvent.Reconnected, () => {
        if (isUnmounted.current) return
        reconnectAttempts.current = 0
        clearReconnectTimer()
        setConnectionState(ConnectionState.Connected)
        room.remoteParticipants.forEach((p) => {
          p.audioTrackPublications.forEach((pub) => {
            if (pub.track && pub.isSubscribed) attachAudio(p.identity, pub.track as RemoteAudioTrack)
          })
        })
      })

      room.on(RoomEvent.TrackSubscribed, (track, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!isUnmounted.current && track.kind === Track.Kind.Audio) {
          attachAudio(participant.identity, track as RemoteAudioTrack)
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) detachAudio(participant.identity)
      })

      room.on(RoomEvent.TrackMuted, (pub, participant) => {
        if (participant.identity === room.localParticipant.identity) {
          if (pub.source === Track.Source.Microphone) setIsMicEnabled(false)
        }
        // Remote track mute/unmute is handled by LiveKit internally via track.attach()
      })

      room.on(RoomEvent.TrackUnmuted, (pub, participant) => {
        if (participant.identity === room.localParticipant.identity) {
          if (pub.source === Track.Source.Microphone) setIsMicEnabled(true)
        }
      })

      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.Microphone) setIsMicEnabled(!pub.isMuted)
      })

      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.Microphone) setIsMicEnabled(false)
      })

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        detachAudio(participant.identity)
        setSpeaking(participant.identity, false)
      })

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (isUnmounted.current) return
        const newIds  = new Set(speakers.map((s) => s.identity))
        const prevIds = activeSpeakersRef.current
        prevIds.forEach(id => { if (!newIds.has(id)) setSpeaking(id, false) })
        activeSpeakersRef.current = newIds
        setActiveSpeakers(new Set(newIds))
        const socket = getSocket()
        if (socket) {
          socket.emit('voice:speaking', { roomId, speaking: newIds.has(room.localParticipant.identity) })
        }
        speakers.forEach((s) => setSpeaking(s.identity, true))
      })

      await room.connect(livekitUrl, token)

      if (isUnmounted.current) { room.disconnect(); detachAllAudio(); return }

      // Attach audio for participants already in the room
      room.remoteParticipants.forEach((p) => {
        p.audioTrackPublications.forEach((pub) => {
          if (pub.track && pub.isSubscribed) attachAudio(p.identity, pub.track as RemoteAudioTrack)
        })
      })

      // Set initial mic state based on role — no reconnect ever needed for role changes
      await room.localParticipant.setMicrophoneEnabled(!!micEnabled)
      setIsMicEnabled(!!micEnabled)

    } catch (err: any) {
      const isTransient =
        err?.message?.includes('network') ||
        err?.message?.includes('timeout') ||
        err?.message?.includes('fetch') ||
        err?.status >= 500 ||
        err?.status === undefined

      if (isTransient && !isUnmounted.current && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.current)
        reconnectAttempts.current += 1
        reconnectTimer.current = setTimeout(() => { isConnecting.current = false; connect() }, delay)
      }
    } finally {
      isConnecting.current = false
    }
  }, [roomId, setSpeaking, clearReconnectTimer]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Explicit disconnect (user-initiated) ──────────────────────────────────
  const disconnect = useCallback(() => {
    clearReconnectTimer()
    reconnectAttempts.current = 0
    isConnecting.current = false
    if (roomRef.current) {
      // Clear token refresh timer before disconnecting
      if ((roomRef.current as any)._tokenRefreshTimer) {
        clearTimeout((roomRef.current as any)._tokenRefreshTimer)
      }
      roomRef.current.removeAllListeners()
      roomRef.current.disconnect()
      roomRef.current = null
    }
    detachAllAudio()
    setConnectionState(ConnectionState.Disconnected)
    setIsMicEnabled(false)
    setActiveSpeakers(new Set())
    activeSpeakersRef.current = new Set()
  }, [clearReconnectTimer])

  // ── Mic controls — called by useVoiceRoom on role change via Socket.IO ────
  // These never reconnect. They just enable/disable the local mic track.
  const enableMic = useCallback(async () => {
    const room = roomRef.current
    if (!room || room.state !== ConnectionState.Connected) return
    await room.localParticipant.setMicrophoneEnabled(true)
    setIsMicEnabled(true)
  }, [])

  const disableMic = useCallback(async () => {
    const room = roomRef.current
    if (!room || room.state !== ConnectionState.Connected) return
    await room.localParticipant.setMicrophoneEnabled(false)
    setIsMicEnabled(false)
  }, [])

  // ── Toggle mic (user-initiated mute button) ────────────────────────────────
  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room || room.state !== ConnectionState.Connected) return
    const next = !room.localParticipant.isMicrophoneEnabled
    await room.localParticipant.setMicrophoneEnabled(next)
    setIsMicEnabled(next)
  }, [])

  // ── Volume control ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const vol = (e as CustomEvent<number>).detail
      // Apply volume to all attached audio elements via the track API
      audioTracks.forEach(track => {
        track.attachedElements.forEach(el => {
          el.volume = Math.max(0, Math.min(1, vol))
        })
      })
    }
    document.addEventListener('vc:volume', handler)
    return () => document.removeEventListener('vc:volume', handler)
  }, [])

  // ── Media Session API — lock screen / Bluetooth headset controls ───────────
  // Registers the room as an active audio session so:
  //   • iOS/Android lock screen shows playback controls
  //   • Bluetooth headset play/pause button toggles mic
  //   • Background audio continues without browser throttling
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    // Set metadata so lock screen shows the room name
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Voice Club',
      artist: 'Live Voice Room',
      artwork: [{ src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
    })

    // Play/pause (headset button) → toggle mic mute
    navigator.mediaSession.setActionHandler('play', () => {
      const room = roomRef.current
      if (!room || room.state !== ConnectionState.Connected) return
      room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
      setIsMicEnabled(true)
    })

    navigator.mediaSession.setActionHandler('pause', () => {
      const room = roomRef.current
      if (!room || room.state !== ConnectionState.Connected) return
      room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
      setIsMicEnabled(false)
    })

    // Next/previous track not applicable — clear them
    navigator.mediaSession.setActionHandler('nexttrack', null)
    navigator.mediaSession.setActionHandler('previoustrack', null)

    // Mark session as playing so background audio isn't paused
    navigator.mediaSession.playbackState = 'playing'

    return () => {
      // Clean up when leaving the room
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.metadata = null
        navigator.mediaSession.playbackState = 'none'
      }
    }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    isUnmounted.current = false
    return () => {
      isUnmounted.current = true
      clearReconnectTimer()
      if (roomRef.current) {
        // Clear the token refresh timer on unmount
        if ((roomRef.current as any)._tokenRefreshTimer) {
          clearTimeout((roomRef.current as any)._tokenRefreshTimer)
        }
        roomRef.current.removeAllListeners()
        roomRef.current.disconnect()
        roomRef.current = null
      }
      detachAllAudio()
    }
  }, [clearReconnectTimer])

  return {
    room: roomRef.current,
    connectionState,
    isMicEnabled,
    activeSpeakers,
    connect,
    disconnect,
    toggleMic,
    enableMic,
    disableMic,
  }
}
