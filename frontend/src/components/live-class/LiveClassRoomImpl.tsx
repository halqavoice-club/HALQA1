'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Room, RoomEvent, Track, Participant,
  RemoteParticipant, RemoteTrackPublication, ConnectionState,
  type RemoteAudioTrack, type RemoteVideoTrack,
} from 'livekit-client'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useToast } from '@/components/ui/use-toast'
import { getSocket } from '@/lib/socket'
import { getAvatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  Hand, HandMetal, MessageSquare, PhoneOff, Play, Square,
  ChevronLeft, Send, Maximize2, Minimize2, Smile,
  LayoutGrid, Radio, PenLine, BarChart2, Settings, Users, X,
} from 'lucide-react'
import { LiveKitRoom } from '@livekit/components-react'
import { LiveClassQuranPanel, type QuranPosition } from './LiveClassQuranPanel'
import { LiveClassWhiteboard, type DrawEvent, type WhiteboardHandle } from './LiveClassWhiteboard'
import { LiveClassPollPanel, type Poll, type PollEvent } from './LiveClassPoll'
import { LiveClassHostControls, type ClassSettings } from './LiveClassHostControls'
import { SpeakerGrid } from './layout/SpeakerGrid'
import { useDynamicLayoutStore } from './layout/useDynamicLayoutStore'
import { GiftPanel } from '../voice/GiftPanel'
import { LiveClassGiftOverlay } from './LiveClassGiftOverlay'
import { useVoiceStore } from '@/store/voice.store'
import { useGiftEngine, useIsLowEndDevice } from '@/hooks/useGiftEngine'
import { createLiveClassAdapter } from '@/lib/giftAdapter'
import { AnimatePresence } from 'framer-motion'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LCParticipant {
  id: string; userId: string; role: 'HOST' | 'STUDENT' | 'OBSERVER'
  isMuted: boolean; isVideoOn: boolean; handRaised: boolean
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}
interface LCMessage {
  id: string; userId: string; body: string; type: string; createdAt: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}
interface LiveClass {
  id: string; title: string; description: string | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  chatEnabled: boolean; handRaiseEnabled: boolean; quranPanelEnabled: boolean
  whiteboardEnabled: boolean
  isOpenMic: boolean
  screenShareEnabled: boolean
  maxParticipants: number
  duration: number; scheduledAt: string | null
  recordingUrl: string | null
  class: { id: string; name: string }
  teacher: { id: string; user: { id: string; firstName: string; lastName: string } }
  participants: LCParticipant[]
  _count?: { participants: number; messages: number }  // from list endpoint
}
interface FloatingEmoji { id: string; emoji: string; x: number; fromName: string }

interface ParticipantPopup {
  participant: LCParticipant
  x: number
  y: number
}

type ViewMode = 'video' | 'audio'

// ─── Emoji reactions ──────────────────────────────────────────────────────────
const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '💯']

// ─── Audio pool ───────────────────────────────────────────────────────────────
const audioTracks = new Map<string, RemoteAudioTrack>()

function attachAudio(identity: string, track: RemoteAudioTrack, onCount?: (n: number) => void) {
  detachAudio(identity, onCount)
  const el = track.attach()
  el.setAttribute('playsinline', '')
  el.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(el)
  audioTracks.set(identity, track)
  onCount?.(audioTracks.size)
  const tryPlay = () => el.play().catch(() => {})
  tryPlay()
  document.addEventListener('click',      tryPlay, { once: true })
  document.addEventListener('touchstart', tryPlay, { once: true })
}

function detachAudio(identity: string, onCount?: (n: number) => void) {
  const track = audioTracks.get(identity)
  if (track) {
    track.detach().forEach(el => el.remove())
    audioTracks.delete(identity)
    onCount?.(audioTracks.size)
  }
}

function detachAllAudio(onCount?: (n: number) => void) {
  audioTracks.forEach(t => t.detach().forEach(el => el.remove()))
  audioTracks.clear()
  onCount?.(0)
}

// ─── RemoteVideoTile ──────────────────────────────────────────────────────────
// Uses useRef + useEffect to attach/detach remote video tracks.
// The <video> element is always in the DOM (never conditionally rendered) so
// videoElRef.current is guaranteed non-null when the effect runs.
function RemoteVideoTile({ p, isSpeaking, track, onClick }: {
  p: LCParticipant
  isSpeaking: boolean
  track: RemoteVideoTrack | null
  onClick?: (e: React.MouseEvent) => void
}) {
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = videoElRef.current
    if (!el) return
    if (track) {
      track.attach(el)
      el.play().catch(() => {})
    }
    return () => {
      if (track) track.detach(el)
    }
  }, [track])

  const initials  = (p.user.firstName[0] + p.user.lastName[0]).toUpperCase()
  const avatarSrc = getAvatarUrl(p.user.avatarUrl)
  const name      = `${p.user.firstName} ${p.user.lastName}`

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden bg-gray-800 aspect-video flex items-center justify-center cursor-pointer',
        isSpeaking && 'ring-2 ring-green-400'
      )}
      onClick={onClick}
    >
      {/* Always render <video> so videoElRef is always populated when effect runs.
          Visibility is controlled by CSS — avatar shown on top when no track. */}
      <video
        ref={videoElRef}
        autoPlay playsInline
        className={cn('absolute inset-0 w-full h-full object-cover', !track && 'invisible')}
      />

      {/* Fallback avatar when no video track */}
      {!track && (
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center font-bold text-indigo-300 text-xl">
            {avatarSrc ? <img src={avatarSrc} alt={name} className="w-full h-full object-cover" /> : initials}
          </div>
          <span className="text-xs text-gray-400">{name}</span>
        </div>
      )}

      {/* Name + status bar */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
        <span className="text-xs text-white font-medium truncate">
          {p.user.firstName}
          {p.role === 'HOST' && <span className="ml-1 text-yellow-400 text-[10px]">HOST</span>}
        </span>
        <div className="flex items-center gap-1">
          {p.handRaised && <span className="text-xs animate-bounce">✋</span>}
          {p.isMuted ? <MicOff className="w-3 h-3 text-red-400" /> : <Mic className="w-3 h-3 text-green-400" />}
        </div>
      </div>
      {isSpeaking && <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
      <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
        <span className="text-white text-xs bg-black/50 px-2 py-1 rounded-full">Tap to interact</span>
      </div>
    </div>
  )
}

// ─── ScreenShareTile — renders a remote screen share track ───────────────────
function ScreenShareTile({ track }: { track: RemoteVideoTrack }) {
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = videoElRef.current
    if (!el || !track) return
    track.attach(el)
    el.play().catch(() => {})
    return () => { track.detach(el) }
  }, [track])

  return (
    <video
      ref={videoElRef}
      autoPlay playsInline
      className="w-full h-full object-contain bg-black"
    />
  )
}

// ─── LocalScreenTile — renders the HOST's own screen share track ──────────────
// Uses useRef + useEffect (same as all other video tiles) so the track is
// correctly attached when the <video> element mounts and detached on cleanup.
function LocalScreenTile({ track }: { track: import('livekit-client').LocalVideoTrack }) {
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = videoElRef.current
    if (!el || !track) return
    track.attach(el)
    el.play().catch(() => {})
    return () => { track.detach(el) }
  }, [track])

  return (
    <video
      ref={videoElRef}
      autoPlay playsInline muted
      className="w-full h-full object-contain bg-black"
    />
  )
}

// ─── Local video tile ─────────────────────────────────────────────────────────
// The parent passes videoRef so LocalTrackPublished can imperatively attach
// the track. The tile also re-attaches the track on mount in case LocalTrackPublished
// fired before this tile was rendered (e.g. late participant list load).
function LocalVideoTile({ p, isSpeaking, videoRef, videoOn, room }: {
  p: LCParticipant
  isSpeaking: boolean
  videoRef: React.RefObject<HTMLVideoElement>
  videoOn: boolean
  room: Room | null
}) {
  const initials  = (p.user.firstName[0] + p.user.lastName[0]).toUpperCase()
  const avatarSrc = getAvatarUrl(p.user.avatarUrl)

  // Single authoritative camera track attach path.
  //
  // This effect runs when:
  //   1. The tile first mounts (room + videoOn already true after reconnect)
  //   2. videoOn becomes true (LocalTrackPublished fired, state updated)
  //   3. roomConnected changes (LiveKit reconnect — new room object)
  //
  // We use requestAnimationFrame to ensure the video element has been painted
  // by the browser before calling attach(). This prevents the race where:
  //   setVideoOn(true) → re-render starts → effect runs → element still hidden
  // By deferring one frame, the element is visible and play() succeeds.
  React.useEffect(() => {
    if (!room || !videoRef.current || !videoOn) return
    const el = videoRef.current
    const raf = requestAnimationFrame(() => {
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera)
      if (camPub?.track) {
        // Detach from any previous elements to prevent duplicate streams
        camPub.track.detach()
        // Attach to this tile's video element
        camPub.track.attach(el)
      }
    })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, videoOn])

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden bg-gray-800 aspect-video flex items-center justify-center',
        isSpeaking && 'ring-2 ring-green-400'
      )}
    >
      <video
        ref={videoRef}
        autoPlay playsInline muted
        className={cn('w-full h-full object-cover', !videoOn && 'hidden')}
      />
      {!videoOn && (
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center font-bold text-indigo-300 text-xl">
            {avatarSrc ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
          <span className="text-xs text-gray-400">You</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between">
        <span className="text-xs text-white font-medium">
          You
          {p.role === 'HOST' && <span className="ml-1 text-yellow-400 text-[10px]">HOST</span>}
        </span>
        <div className="flex items-center gap-1">
          {p.isMuted ? <MicOff className="w-3 h-3 text-red-400" /> : <Mic className="w-3 h-3 text-green-400" />}
        </div>
      </div>
      {isSpeaking && <div className="absolute top-2 right-2 w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
    </div>
  )
}

// ─── AudioTile (audio-only view) ──────────────────────────────────────────────
function AudioTile({ p, isMe, isSpeaking, onClick }: {
  p: LCParticipant; isMe: boolean; isSpeaking: boolean
  onClick?: (e: React.MouseEvent) => void
}) {
  const initials  = (p.user.firstName[0] + p.user.lastName[0]).toUpperCase()
  const avatarSrc = getAvatarUrl(p.user.avatarUrl)
  const name      = isMe ? 'You' : `${p.user.firstName} ${p.user.lastName}`
  return (
    <div
      className={cn('flex flex-col items-center gap-2 p-3', !isMe && 'cursor-pointer')}
      onClick={!isMe ? onClick : undefined}
    >
      <div className={cn(
        'relative w-16 h-16 rounded-full flex-shrink-0 transition-all duration-200',
        isSpeaking
          ? 'ring-4 ring-green-400 ring-offset-2 ring-offset-gray-900 scale-110'
          : 'ring-2 ring-gray-700'
      )}>
        <div className="w-full h-full rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center font-bold text-indigo-300 text-lg">
          {avatarSrc ? <img src={avatarSrc} alt={name} className="w-full h-full object-cover" /> : initials}
        </div>
        <span className={cn(
          'absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-gray-900 flex items-center justify-center',
          p.isMuted ? 'bg-red-500' : 'bg-green-500'
        )}>
          {p.isMuted ? <MicOff className="w-2.5 h-2.5 text-white" /> : <Mic className="w-2.5 h-2.5 text-white" />}
        </span>
        {isSpeaking && (
          <>
            <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-40" />
            <span className="absolute -inset-1 rounded-full border border-green-400/30 animate-ping opacity-20" style={{ animationDelay: '0.15s' }} />
          </>
        )}
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-gray-200 truncate max-w-[80px]">{name}</p>
        {p.role === 'HOST' && <span className="text-[9px] text-yellow-400 font-bold">HOST</span>}
        {p.handRaised && <span className="text-xs block animate-bounce">✋</span>}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function LiveClassRoomPage({ id }: { id: string }) {
  const router      = useRouter()
  const { user }    = useAuthStore()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const roomRef           = useRef<Room | null>(null)
  const isUnmounted       = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localVideoRef     = useRef<HTMLVideoElement>(null)       // tile's visible <video>
  const localVideoFallbackRef = useRef<HTMLVideoElement>(null)   // hidden 0×0 fallback
  const cameraOpInProgressRef = useRef(false)                    // concurrency guard
  const connectLiveKitRef = useRef<(() => void) | null>(null)
  const whiteboardRef     = useRef<WhiteboardHandle>(null)
  // roomConnected state — triggers re-render of LocalVideoTile when LiveKit connects,
  // so the useEffect(room, videoOn) in LocalVideoTile runs with a non-null room.
  const [roomConnected,  setRoomConnected]  = useState<Room | null>(null)

  // ── Remote video tracks — keyed by participant identity (userId) ──────────
  const [remoteVideoTracks, setRemoteVideoTracks] = useState<Map<string, RemoteVideoTrack>>(new Map())
  const [screenTrack,       setScreenTrack]       = useState<RemoteVideoTrack | null>(null)

  // ── Local screen share track — stored in state so LocalScreenTile attaches
  // it after the <video> element is rendered in DOM.
  const [localScreenTrack, setLocalScreenTrack] = useState<import('livekit-client').LocalVideoTrack | null>(null)

  const [connState,        setConnState]        = useState<ConnectionState>(ConnectionState.Disconnected)
  const [micOn,            setMicOn]            = useState(false)
  const [videoOn,          setVideoOn]          = useState(false)
  const [screenOn,         setScreenOn]         = useState(false)
  const [screenSharer,     setScreenSharer]     = useState<string | null>(null)
  const [screenFullscreen, setScreenFullscreen] = useState(false)
  const [activeSpeakers,   setActiveSpeakers]   = useState<Set<string>>(new Set())
  const [tab,              setTab]              = useState<'participants' | 'chat' | 'polls' | 'host'>('participants')
  const [chatInput,        setChatInput]        = useState('')
  const [messages,         setMessages]         = useState<LCMessage[]>([])
  const [participants,     setParticipants]     = useState<LCParticipant[]>([])
  const [joined,           setJoined]           = useState(false)
  const [audioTrackCount,  setAudioTrackCount]  = useState(0)
  const [showEmojiPicker,  setShowEmojiPicker]  = useState(false)
  const [floatingEmojis,   setFloatingEmojis]   = useState<FloatingEmoji[]>([])
  // View mode: 'video' shows camera tiles, 'audio' shows avatar circles
  const [viewMode,         setViewMode]         = useState<ViewMode>('video')
  // Participant interaction popup (click on a tile)
  const [participantPopup, setParticipantPopup] = useState<ParticipantPopup | null>(null)
  // Open mic mode (all students can publish freely)
  const [isOpenMic,        setIsOpenMic]        = useState(false)

  // ── New feature state ─────────────────────────────────────────────────────
  // Sidebar tab (extended)
  const [isRecording,      setIsRecording]      = useState(false)
  // Quran sync
  const [quranPosition,    setQuranPosition]    = useState<QuranPosition | null>(null)
  // Whiteboard remote events
  const [remoteDrawEvent,  setRemoteDrawEvent]  = useState<DrawEvent | null>(null)
  // Polls
  const [polls,            setPolls]            = useState<Poll[]>([])
  // Active panel in main area (null = normal view, 'whiteboard' = whiteboard)
  const [activePanel,      setActivePanel]      = useState<'whiteboard' | null>(null)
  // Video grid pagination — current page index (17+ participants)
  const [videoPage,        setVideoPage]        = useState(0)
  // Mobile sidebar visibility
  const [showSidebar,      setShowSidebar]      = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const isHost = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(user?.role || '')

  // ── Universal Gift Engine ───────────────────────────────────────────────────
  const giftAdapter  = createLiveClassAdapter(id)
  const isLowEnd     = useIsLowEndDevice()
  const {
    sendGift,
    sendGiftToAll,
    isGiftPanelOpen,
    toggleGiftPanel,
  } = useGiftEngine({ adapter: giftAdapter })

  const { data: lc, isLoading } = useQuery<LiveClass>({
    queryKey: ['live-class', id],
    queryFn:  () => api.get('/live-classes/' + id).then(r => r.data.data),
    enabled:  !!id,
    refetchInterval: joined ? 30000 : 10000,
  })

  // Sync isOpenMic from server data
  useEffect(() => {
    if (lc) setIsOpenMic(lc.isOpenMic)
  }, [lc?.isOpenMic])

  // Clamp videoPage when participants leave and totalVideoPages shrinks
  useEffect(() => {
    const pages = Math.ceil(Math.max(participants.length, 1) / 16)
    setVideoPage(p => Math.min(p, Math.max(0, pages - 1)))
  }, [participants.length])

  // ── Sync live class participants → useDynamicLayoutStore (for SpeakerGrid in audio mode) ──
  // useDynamicLayout subscribes to LiveKit events, but when SpeakerGrid is used in the
  // live class audio view the participant source of truth is the liveclass socket events
  // (liveclass:user_joined / liveclass:user_left / liveclass:mute_changed) that feed the
  // `participants` state array above. We bridge the two here: whenever `participants`
  // changes, map them to SpeakerSlot format and push into the store so SpeakerGrid
  // renders the correct seats without needing a separate socket subscription.
  const dynamicLayoutStore = useDynamicLayoutStore()
  useEffect(() => {
    if (!joined) return  // only sync when inside the room
    dynamicLayoutStore.setSpeakers(
      participants.map((p, i) => ({
        userId:            p.userId,
        seatIndex:         i,
        role:              p.role === 'HOST' ? 'owner' : 'speaker',
        displayName:       `${p.user.firstName} ${p.user.lastName}`,
        avatarUrl:         p.user.avatarUrl ?? undefined,
        isMuted:           p.isMuted,
        isSpeaking:        activeSpeakers.has(p.userId),
        isOnline:          true,
        connectionQuality: 'unknown' as const,
      }))
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, activeSpeakers, joined])


  // The backend emits `liveclass:started` to both `school:{id}` and `class:{classId}`.
  // Students sitting on the lobby page need to be in the class room to be notified.
  useEffect(() => {
    if (!lc?.class?.id) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('class:join', lc.class.id)
    return () => { socket.emit('class:leave', lc.class.id) }
  }, [lc?.class?.id])

  // ── Floating emoji spawner ──────────────────────────────────────────────────
  const spawnEmoji = useCallback((emoji: string, fromName: string) => {
    const fe: FloatingEmoji = { id: Math.random().toString(36).slice(2), emoji, x: 10 + Math.random() * 80, fromName }
    setFloatingEmojis(prev => [...prev, fe])
    setTimeout(() => setFloatingEmojis(prev => prev.filter(e => e.id !== fe.id)), 3000)
  }, [])

  // ── Socket events ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    const socket = getSocket()
    if (!socket) return
    socket.emit('liveclass:join_room', id)

    const onJoined   = (d: any) => setParticipants(prev => {
      const exists = prev.find(p => p.userId === d.userId)
      if (exists) return prev.map(p => p.userId === d.userId ? { ...p, ...d } : p)
      return [...prev, { id: d.userId, userId: d.userId, role: d.role, isMuted: true, isVideoOn: false, handRaised: false, user: d.user }]
    })
    const onLeft     = (d: any) => setParticipants(prev => prev.filter(p => p.userId !== d.userId))
    const onMute     = (d: any) => setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, isMuted: d.isMuted } : p))
    const onMuteAll  = ()       => setParticipants(prev => prev.map(p => p.role !== 'HOST' ? { ...p, isMuted: true } : p))
    const onHand     = (d: any) => {
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: true  } : p))
      if (isHost) setTab('host')  // bring host to controls tab so they see the queue
    }
    const onHandLow  = (d: any) => setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false } : p))
    const onMsg      = (msg: LCMessage) => setMessages(prev => [...prev, msg])
    const onEnded    = () => { toast({ title: 'Class ended' }); router.push('/live-class') }
    const onKicked   = () => { toast({ title: 'You were removed', variant: 'destructive' }); router.push('/live-class') }
    const onUpdated  = () => queryClient.invalidateQueries({ queryKey: ['live-class', id] })
    const onSpeak    = (d: any) => setActiveSpeakers(prev => { const n = new Set(prev); d.speaking ? n.add(d.userId) : n.delete(d.userId); return n })
    const onVideo    = (d: any) => setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, isVideoOn: d.isVideoOn } : p))
    const onReaction = (d: any) => spawnEmoji(d.emoji, d.firstName || '')
    const onCanSpeak = () => {
      toast({ title: '🎙 You can speak now!' })
      // FIX: just enable the mic — no reconnect needed since canPublish is always true.
      // The old approach triggered a full LiveKit reconnect (1–2s lag).
      const room = roomRef.current
      if (room && room.state === ConnectionState.Connected) {
        room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
        setMicOn(true)
      } else {
        // Not connected yet — connect and start with mic enabled
        connectLiveKitRef.current?.()
      }
    }
    const onOpenMicChanged = (d: any) => {
      setIsOpenMic(d.isOpenMic)
      if (d.isOpenMic) {
        toast({ title: '🎙 Open mic enabled — everyone can speak!' })
        // Just enable mic — no reconnect needed
        const room = roomRef.current
        if (room && room.state === ConnectionState.Connected) {
          room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
          setMicOn(true)
        }
      } else {
        toast({ title: '🔇 Open mic disabled' })
      }
    }

    // ── View mode change from host ─────────────────────────────────────────
    const onViewModeChanged = (d: any) => {
      if (d.liveClassId !== id) return
      setViewMode(d.viewMode)
      if (!isHost) {
        toast({
          title: d.viewMode === 'audio' ? '🔇 Host switched to audio-only view' : '📹 Host switched to video view'
        })
      }
    }

    // ── New feature handlers ──────────────────────────────────────────────
    const onRecordingStarted = () => { setIsRecording(true); toast({ title: '🔴 Recording started' }) }
    const onRecordingStopped = () => { setIsRecording(false); toast({ title: '⏹ Recording stopped' }) }
    const onQuranPosition    = (d: any) => setQuranPosition({ surahNumber: d.surahNumber, ayahNumber: d.ayahNumber })
    const onDraw             = (d: any) => {
      setRemoteDrawEvent(d.event)
      // Auto-open whiteboard panel for students when host starts drawing
      if (!isHost) {
        setActivePanel(prev => {
          if (prev === 'whiteboard') return prev  // already open — no-op
          // First time opening: fetch saved state from server
          api.get('/live-classes/' + id + '/whiteboard/state')
            .then(res => {
              const dataUrl = res.data.data?.snapshot
              if (dataUrl) setTimeout(() => whiteboardRef.current?.loadSnapshot(dataUrl), 100)
            })
            .catch(() => {})
          return 'whiteboard'
        })
      }
    }
    const onPoll             = (d: any) => {
      const ev = d.event as PollEvent
      if (ev.type === 'create' && ev.poll) {
        setPolls(prev => [ev.poll!, ...prev])
        // Auto-switch students to polls tab when a new poll is launched
        if (!isHost) {
          setTab('polls')
          toast({ title: '📊 New poll launched!' })
        }
      } else if (ev.type === 'vote' && ev.pollId && ev.optionId && ev.userId) {
        setPolls(prev => prev.map(p => p.id !== ev.pollId ? p : {
          ...p,
          options: p.options.map(o => o.id !== ev.optionId ? o : {
            ...o,
            votes: o.votes.includes(ev.userId!) ? o.votes : [...o.votes, ev.userId!]
          })
        }))
      } else if (ev.type === 'close' && ev.pollId) {
        setPolls(prev => prev.map(p => p.id !== ev.pollId ? p : { ...p, isActive: false }))
      }
    }

    socket.on('liveclass:user_joined',     onJoined)
    socket.on('liveclass:user_left',       onLeft)
    socket.on('liveclass:mute_changed',    onMute)
    socket.on('liveclass:mute_all',        onMuteAll)
    // New: unmute all
    socket.on('liveclass:unmute_all',      () => setParticipants(prev => prev.map(p => p.role !== 'HOST' ? { ...p, isMuted: false } : p)))
    socket.on('liveclass:hand_raised',     onHand)
    socket.on('liveclass:hand_lowered',    onHandLow)
    // Hand approved: lower hand + unmute for the approved user; non-host clients update their own state
    socket.on('liveclass:hand_approved',   (d: any) => {
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false, isMuted: false } : p))
    })
    // Hand rejected: lower hand for the rejected user across all clients
    socket.on('liveclass:hand_rejected',   (d: any) => {
      setParticipants(prev => prev.map(p => p.userId === d.userId ? { ...p, handRaised: false } : p))
    })
    // Speak request: host sees a toast prompt so they know a student wants to speak
    socket.on('liveclass:speak_request',   (d: any) => {
      if (isHost) toast({ title: `🎙 ${d.firstName || 'A student'} wants to speak` })
    })
    // New: all hands lowered
    socket.on('liveclass:all_hands_lowered', () => setParticipants(prev => prev.map(p => ({ ...p, handRaised: false }))))
    socket.on('liveclass:message',         onMsg)
    // New: message deleted — remove from local state
    socket.on('liveclass:message_deleted', (d: { liveClassId: string; messageId: string }) => {
      if (d.liveClassId !== id) return
      setMessages(prev => prev.filter(m => m.id !== d.messageId))
    })
    socket.on('liveclass:ended',           onEnded)
    socket.on('liveclass:you_were_kicked', onKicked)
    socket.on('liveclass:updated',         onUpdated)
    socket.on('liveclass:speaking',        onSpeak)
    socket.on('liveclass:video_changed',   onVideo)
    socket.on('liveclass:reaction',        onReaction)
    socket.on('liveclass:you_can_speak',   onCanSpeak)
    socket.on('liveclass:open_mic_changed', onOpenMicChanged)
    socket.on('liveclass:viewmode_changed',  onViewModeChanged)
    socket.on('liveclass:recording_started', onRecordingStarted)
    socket.on('liveclass:recording_stopped', onRecordingStopped)
    socket.on('liveclass:quran_position',    onQuranPosition)
    socket.on('liveclass:draw',              onDraw)
    socket.on('liveclass:poll',              onPoll)

    return () => {
      socket.emit('liveclass:leave_room', id)
      socket.off('liveclass:user_joined',     onJoined)
      socket.off('liveclass:user_left',       onLeft)
      socket.off('liveclass:mute_changed',    onMute)
      socket.off('liveclass:mute_all',        onMuteAll)
      socket.off('liveclass:unmute_all')
      socket.off('liveclass:hand_raised',     onHand)
      socket.off('liveclass:hand_lowered',    onHandLow)
      socket.off('liveclass:hand_approved')
      socket.off('liveclass:hand_rejected')
      socket.off('liveclass:speak_request')
      socket.off('liveclass:all_hands_lowered')
      socket.off('liveclass:message',         onMsg)
      socket.off('liveclass:message_deleted')
      socket.off('liveclass:ended',           onEnded)
      socket.off('liveclass:you_were_kicked', onKicked)
      socket.off('liveclass:updated',         onUpdated)
      socket.off('liveclass:speaking',        onSpeak)
      socket.off('liveclass:video_changed',   onVideo)
      socket.off('liveclass:reaction',        onReaction)
      socket.off('liveclass:you_can_speak',   onCanSpeak)
      socket.off('liveclass:open_mic_changed', onOpenMicChanged)
      socket.off('liveclass:viewmode_changed',  onViewModeChanged)
      socket.off('liveclass:recording_started', onRecordingStarted)
      socket.off('liveclass:recording_stopped', onRecordingStopped)
      socket.off('liveclass:quran_position',    onQuranPosition)
      socket.off('liveclass:draw',              onDraw)
      socket.off('liveclass:poll',              onPoll)
    }
  }, [id, queryClient, router, toast, spawnEmoji])

  // ── LiveKit connection ──────────────────────────────────────────────────────
  const connectLiveKit = useCallback(async () => {
    try {
      const res = await api.post('/live-classes/' + id + '/token')
      const { token, livekitUrl } = res.data.data
      if (!token || !livekitUrl) { toast({ title: 'No token', variant: 'destructive' }); return }

      const room = new Room({
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        // Relaxed video constraints so any webcam works — no OverconstrainedError.
        // LiveKit's default of 1280×720 @ 30fps fails on many integrated/school webcams.
        // Use VideoPresets which LiveKit supports, or plain numbers as fallback.
        videoCaptureDefaults: {
          resolution: { width: 640, height: 480, frameRate: 15 },
        },
        // Exponential back-off reconnect: 1s, 2s, 4s, 8s, 16s — stop after 5 attempts
        reconnectPolicy: {
          nextRetryDelayInMs: (context) => {
            if (context.retryCount >= 5) return null
            return Math.min(1000 * Math.pow(2, context.retryCount), 16_000)
          },
        },
      })
      roomRef.current = room

      room.on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
        if (!isUnmounted.current) setConnState(s)

        // Auto-reconnect: if LiveKit fully disconnects while the class is
        // still live (user didn't press Leave), try reconnecting after 3 s.
        // This handles network blips, laptop sleep, etc.
        //
        // P2-04 FIX (PERF-05): Use reconnectTimerRef to prevent timer accumulation.
        // The old code did `return () => clearTimeout(retryTimer)` inside a room.on()
        // callback — that return value goes to the LiveKit event emitter, NOT to
        // React's useEffect cleanup slot. React never called it, so timers piled up
        // on every disconnect. Now we cancel the previous timer before scheduling
        // a new one, and the unmount cleanup also cancels via the ref.
        if (s === ConnectionState.Disconnected && !isUnmounted.current) {
          setRoomConnected(null)
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null
            if (isUnmounted.current) return
            // Only retry if room object is still ours (not replaced by a newer call)
            if (roomRef.current === room) {
              toast({ title: '🔄 Connection lost — reconnecting…' })
              connectLiveKitRef.current?.()
            }
          }, 3000)
        }

        // Clear the timer when connection succeeds — no retry needed
        if (s === ConnectionState.Connected) {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current)
            reconnectTimerRef.current = null
          }
          // Update state so LocalVideoTile re-renders with the connected room
          if (!isUnmounted.current) setRoomConnected(room)
        }
      })

      room.on(RoomEvent.TrackSubscribed, (track, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (isUnmounted.current) return
        if (track.kind === Track.Kind.Audio) {
          attachAudio(participant.identity, track as RemoteAudioTrack, setAudioTrackCount)
        }
        if (track.kind === Track.Kind.Video) {
          if (pub.source === Track.Source.ScreenShare) {
            // Remote screen share track — store in state so ScreenShareTile renders it
            setScreenTrack(track as RemoteVideoTrack)
            setScreenOn(true)
            setScreenSharer(participant.identity)
          } else {
            // Camera track: store in React state so RemoteVideoTile renders it
            setRemoteVideoTracks(prev => {
              const next = new Map(prev)
              next.set(participant.identity, track as RemoteVideoTrack)
              return next
            })
            setParticipants(prev => prev.map(p =>
              p.userId === participant.identity ? { ...p, isVideoOn: true } : p
            ))
          }
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          detachAudio(participant.identity, setAudioTrackCount)
        }
        if (track.kind === Track.Kind.Video) {
          if (pub.source === Track.Source.ScreenShare) {
            setScreenTrack(null)
            setScreenOn(false); setScreenSharer(null)
          } else {
            // Remove from React state — RemoteVideoTile will re-render with null track
            setRemoteVideoTracks(prev => {
              const next = new Map(prev)
              next.delete(participant.identity)
              return next
            })
            setParticipants(prev => prev.map(p =>
              p.userId === participant.identity ? { ...p, isVideoOn: false } : p
            ))
          }
        }
      })

      room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        detachAudio(p.identity, setAudioTrackCount)
        // Remove video track from React state
        setRemoteVideoTracks(prev => {
          const next = new Map(prev)
          next.delete(p.identity)
          return next
        })
        setScreenSharer(prev => {
          if (prev === p.identity) {
            setScreenTrack(null)
            setScreenOn(false); return null
          }
          return prev
        })
      })

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (isUnmounted.current) return
        const ids = new Set(speakers.map(s => s.identity))
        setActiveSpeakers(ids)
        const socket = getSocket()
        if (socket) socket.emit('liveclass:speaking', { liveClassId: id, speaking: ids.has(room.localParticipant.identity), userId: user?.id })
      })

      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.Microphone) setMicOn(!pub.isMuted)
        if (pub.source === Track.Source.Camera) {
          // [Camera] LocalTrackPublished → update state only.
          // The actual track attachment is handled by LocalVideoTile's useEffect,
          // which runs after setVideoOn(true) triggers a re-render and the
          // video element is guaranteed to be in the DOM at that point.
          // Attaching here (before the tile re-renders) risks attaching to a
          // stale or wrong element reference.
          setVideoOn(true)
        }
        if (pub.source === Track.Source.ScreenShare) {
          setLocalScreenTrack(pub.track as import('livekit-client').LocalVideoTrack ?? null)
          setScreenOn(true)
          setScreenSharer(room.localParticipant.identity)
        }
      })

      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.Microphone) setMicOn(false)
        if (pub.source === Track.Source.Camera) {
          // [Camera] LocalTrackUnpublished → update state.
          // The video element stops showing because videoOn becomes false (CSS hidden).
          // LiveKit also calls detach() internally when the track is stopped.
          setVideoOn(false)
        }
        if (pub.source === Track.Source.ScreenShare) {
          setLocalScreenTrack(null)
          setScreenOn(false)
          setScreenSharer(null)
        }
      })

      await room.connect(livekitUrl, token)
      if (isUnmounted.current) { room.disconnect(); detachAllAudio(); return }

      room.remoteParticipants.forEach((p) => {
        p.audioTrackPublications.forEach((pub) => {
          if (pub.track && pub.isSubscribed) attachAudio(p.identity, pub.track as RemoteAudioTrack, setAudioTrackCount)
        })
        p.videoTrackPublications.forEach((pub) => {
          if (!pub.track || !pub.isSubscribed) return
          if (pub.source === Track.Source.ScreenShare) {
            setScreenTrack(pub.track as RemoteVideoTrack)
            setScreenOn(true); setScreenSharer(p.identity)
          } else {
            // Store in React state — RemoteVideoTile will attach to its <video> ref
            setRemoteVideoTracks(prev => {
              const next = new Map(prev)
              next.set(p.identity, pub.track as RemoteVideoTrack)
              return next
            })
            setParticipants(prev => prev.map(part => part.userId === p.identity ? { ...part, isVideoOn: true } : part))
          }
        })
      })

      if (isHost) await room.localParticipant.setMicrophoneEnabled(true).then(() => setMicOn(true)).catch(() => {})
    } catch (e: any) {
      if (!isUnmounted.current) toast({ title: 'Connection failed: ' + (e?.message || 'unknown'), variant: 'destructive' })
    }
  }, [id, isHost, toast, user?.id])

  useEffect(() => { connectLiveKitRef.current = connectLiveKit }, [connectLiveKit])

  // ── Join mutation ───────────────────────────────────────────────────────────
  const joinMutation = useMutation({
    mutationFn: () => api.post('/live-classes/' + id + '/join'),
    onSuccess: async (res) => {
      setJoined(true)
      if (isHost) setTab('host')  // hosts land on the controls tab
      const joinedParticipants = res.data.data?.liveClass?.participants
      if (joinedParticipants?.length > 0) {
        setParticipants(joinedParticipants)
      } else {
        const pRes = await api.get('/live-classes/' + id + '/participants').catch(() => null)
        if (pRes) setParticipants(pRes.data.data || [])
      }
      const msgs = await api.get('/live-classes/' + id + '/messages').then(r => r.data.data?.messages || [])
      setMessages(msgs)

      // LC-003 FIX: Load cached poll state from Redis so students joining mid-class
      // see polls that were created before they joined (not just future socket events).
      api.get('/live-classes/' + id + '/poll/state').then(r => {
        const cachedPolls: Poll[] = r.data.data?.polls ?? []
        if (cachedPolls.length > 0) {
          setPolls(cachedPolls)
          // If there's an active poll, switch students to the polls tab automatically
          if (!isHost && cachedPolls.some((p: Poll) => p.isActive)) {
            setTab('polls')
            toast({ title: '📊 There is an active poll' })
          }
        }
      }).catch(() => { /* non-fatal — polls still work via socket events */ })

      await connectLiveKit()
      queryClient.invalidateQueries({ queryKey: ['live-class', id] })

      // Fetch wallet balance so GiftPanel shows correct coin count
      api.get('/wallets/me').then(r => {
        const w = r.data.data
        if (w) useVoiceStore.getState().setWallet({ coins: w.coins ?? 0, diamonds: w.diamonds ?? 0 })
      }).catch(() => {})
    },
    onError: (e: any) => {
      const msg    = e?.response?.data?.message || 'Failed to join'
      const status = e?.response?.status
      // 403 + "full" → show a more descriptive, styled error
      if (status === 403 && msg.toLowerCase().includes('full')) {
        toast({
          title:       '🚫 Class is Full',
          description: msg,   // e.g. "Class is full (max 30 participants)"
          variant:     'destructive',
        })
      } else {
        toast({ title: msg, variant: 'destructive' })
      }
    },
  })

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  useEffect(() => {
    isUnmounted.current = false
    return () => {
      isUnmounted.current = true
      // P2-04: cancel any pending reconnect timer on unmount
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      roomRef.current?.disconnect()
      detachAllAudio(setAudioTrackCount)
      setLocalScreenTrack(null)
    }
  }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── Controls ────────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    const room = roomRef.current; if (!room || !user?.id) return
    const next = !room.localParticipant.isMicrophoneEnabled
    await room.localParticipant.setMicrophoneEnabled(next)
    setMicOn(next)
    await api.patch('/live-classes/' + id + '/participants/' + user.id + '/mute', { muted: !next }).catch(() => {})
  }

  const toggleVideo = async () => {
    const room = roomRef.current
    if (!room) {
      toast({ title: '📷 Not connected', description: 'LiveKit connection not ready. Try leaving and rejoining.', variant: 'destructive' })
      return
    }
    if (connState !== ConnectionState.Connected) {
      toast({ title: '📷 Connecting…', description: `Room state: ${connState}. Please wait for the green "Connected" indicator.`, variant: 'destructive' })
      return
    }

    const next = !room.localParticipant.isCameraEnabled

    // Concurrency guard — use a ref so it persists across async operations
    if (cameraOpInProgressRef.current) {
      console.debug('[Camera] action=toggle SKIPPED — operation already in progress')
      return
    }
    cameraOpInProgressRef.current = true

    try {
      console.debug(`[Camera] action=toggle requestedState=${next ? 'ON' : 'OFF'}`)
      await room.localParticipant.setCameraEnabled(next)
      console.debug(`[Camera] action=setCameraEnabled success state=${next ? 'ON' : 'OFF'}`)
      // NOTE: Do NOT call setVideoOn here.
      // LocalTrackPublished/LocalTrackUnpublished are the single source of truth.
      // They set videoOn AND attach/detach the track to the visible <video> element.
      // If setVideoOn is called here (optimistically), the useEffect in LocalVideoTile
      // runs while the track publication is still in progress → getTrackPublication
      // returns null → attach is skipped → video never shows.

      // Persist to DB + notify participants (fire-and-forget, non-fatal)
      if (user?.id) {
        api.patch('/live-classes/' + id + '/participants/' + user.id + '/video', { isVideoOn: next }).catch(() => {})
      }
      const socket = getSocket()
      if (socket) socket.emit('liveclass:video_changed', { liveClassId: id, isVideoOn: next })

    } catch (e: any) {
      const name = (e?.name  || '').toLowerCase()
      const msg  = (e?.message || '').toLowerCase()
      console.error('[Camera] action=setCameraEnabled failed:', e?.name, e?.message)

      if (name === 'notallowederror' || msg.includes('permission') || msg.includes('not allowed') || msg.includes('denied')) {
        toast({
          title: '📷 Camera permission denied',
          description: 'Click the camera icon in your browser address bar → Allow → then try again. Or open /live-class/camera-test to diagnose.',
          variant: 'destructive',
          duration: 12000,
        })
      } else if (name === 'notfounderror' || msg.includes('not found') || msg.includes('no camera')) {
        toast({ title: '📷 No camera found', description: 'Make sure your camera is connected and not in use by another app.', variant: 'destructive', duration: 8000 })
      } else if (name === 'notreadableerror' || msg.includes('in use') || msg.includes('hardware')) {
        toast({ title: '📷 Camera busy', description: 'Your camera is being used by another app (Zoom, Teams, etc.). Close it first.', variant: 'destructive', duration: 8000 })
      } else if (name === 'overconstrainederror' || msg.includes('overconstrained')) {
        toast({ title: '📷 Camera not supported', description: 'Try a different camera or browser.', variant: 'destructive', duration: 8000 })
      } else if (name === 'securityerror') {
        toast({ title: '📷 Blocked by security policy', description: 'Camera requires HTTPS. Make sure you\'re on https://.', variant: 'destructive', duration: 10000 })
      } else {
        const isInsecure = typeof window !== 'undefined' &&
          window.location.protocol === 'http:' &&
          !['localhost', '127.0.0.1'].includes(window.location.hostname)
        if (isInsecure) {
          toast({
            title: '🔒 HTTPS Required',
            description: `Camera requires HTTPS. Open http://localhost:3000 instead of http://${window.location.hostname}.`,
            variant: 'destructive',
            duration: 15000,
          })
        } else {
          toast({ title: '📷 Camera error', description: e?.message || 'Could not start camera. Check console (F12) for details.', variant: 'destructive' })
        }
      }
    } finally {
      cameraOpInProgressRef.current = false
    }
  }

  const toggleScreen = async () => {
    const room = roomRef.current; if (!room) return
    if (screenOn && screenSharer === room.localParticipant.identity) {
      await room.localParticipant.setScreenShareEnabled(false)
    } else if (!screenOn) {
      await room.localParticipant.setScreenShareEnabled(true, { audio: true })
        .catch(() => toast({ title: 'Screen share denied', variant: 'destructive' }))
    }
  }

  const handleLeave = async () => {
    setJoined(false)
    // Task 6 (P3-C): cancel any pending reconnect timer before disconnecting
    // so a voluntary Leave cannot accidentally schedule a reconnect attempt
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    roomRef.current?.disconnect()
    detachAllAudio(setAudioTrackCount)
    setLocalScreenTrack(null)
    await api.post('/live-classes/' + id + '/leave').catch(() => {})
    router.push('/live-class')
  }

  const handleStart = async () => {
    try {
      await api.post('/live-classes/' + id + '/start')
      queryClient.invalidateQueries({ queryKey: ['live-class', id] })
      toast({ title: '▶ Class started' })
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to start class', variant: 'destructive' })
    }
  }

  const handleEnd = async () => {
    if (!confirm('End the class for all participants?')) return
    try {
      await api.post('/live-classes/' + id + '/end')
      router.push('/live-class')
    } catch (e: any) {
      toast({ title: e?.response?.data?.message || 'Failed to end class', variant: 'destructive' })
    }
  }

  const sendMessage = async () => {
    if (!chatInput.trim()) return
    await api.post('/live-classes/' + id + '/messages', { body: chatInput.trim() }).catch(() => {})
    setChatInput('')
  }

  const raiseHand = async () => { await api.post('/live-classes/' + id + '/hand/raise'); toast({ title: 'Hand raised ✋' }) }
  const lowerHand = async () => {
    await api.post('/live-classes/' + id + '/hand/lower')
    setParticipants(prev => prev.map(p => p.userId === user?.id ? { ...p, handRaised: false } : p))
  }
  const approveHand = async (uid: string) => {
    await api.post('/live-classes/' + id + '/hand/approve/' + uid)
    setParticipants(prev => prev.map(p => p.userId === uid ? { ...p, handRaised: false } : p))
  }

  const rejectHand = async (uid: string) => {
    await api.post('/live-classes/' + id + '/hand/reject/' + uid)
    setParticipants(prev => prev.map(p => p.userId === uid ? { ...p, handRaised: false } : p))
  }

  const muteParticipant = async (uid: string, muted: boolean) => {
    await api.patch('/live-classes/' + id + '/participants/' + uid + '/mute', { muted }).catch(() => {})
    setParticipants(prev => prev.map(p => p.userId === uid ? { ...p, isMuted: muted } : p))
  }

  const kickParticipant = async (uid: string) => {
    await api.delete('/live-classes/' + id + '/participants/' + uid).catch(() => {})
    setParticipants(prev => prev.filter(p => p.userId !== uid))
  }

  // ── Toggle class settings live (PATCH) — optimistic update ───────────────
  const toggleSetting = async (key: keyof Pick<ClassSettings, 'chatEnabled' | 'handRaiseEnabled' | 'quranPanelEnabled' | 'whiteboardEnabled' | 'screenShareEnabled'>) => {
    const current = lc?.[key as keyof typeof lc]
    const newValue = !current
    // Optimistic: update cache immediately so UI reflects instantly
    queryClient.setQueryData(['live-class', id], (old: any) =>
      old ? { ...old, [key]: newValue } : old
    )
    try {
      await api.patch('/live-classes/' + id, { [key]: newValue })
    } catch {
      // Rollback on error
      queryClient.setQueryData(['live-class', id], (old: any) =>
        old ? { ...old, [key]: current } : old
      )
    }
  }
  const sendReaction = (emoji: string) => {
    setShowEmojiPicker(false); spawnEmoji(emoji, 'You')
    const socket = getSocket()
    if (socket) socket.emit('liveclass:reaction', { liveClassId: id, emoji, userId: user?.id, firstName: user?.firstName || 'Someone' })
  }

  const toggleOpenMic = async () => {
    await api.post('/live-classes/' + id + '/open-mic').catch(() => {})
  }

  // ── Recording ───────────────────────────────────────────────────────────────
  const toggleRecording = async () => {
    if (isRecording) {
      await api.post('/live-classes/' + id + '/recording/stop').catch(() => {})
    } else {
      await api.post('/live-classes/' + id + '/recording/start').catch(() => {})
    }
  }

  // ── Whiteboard draw broadcast ────────────────────────────────────────────────
  const handleDraw = useCallback((event: DrawEvent) => {
    api.post('/live-classes/' + id + '/whiteboard', { event }).catch(() => {})
  }, [id])

  // ── Open whiteboard — load persisted state for students joining mid-class ───
  const openWhiteboard = useCallback(async () => {
    // Use a ref-read pattern: capture opening state via functional updater
    // to avoid stale closure on activePanel
    let opening = false
    setActivePanel(prev => {
      opening = prev !== 'whiteboard'
      return prev === 'whiteboard' ? null : 'whiteboard'
    })

    // Microtask flush — wait for state update so opening is correctly set
    await Promise.resolve()

    if (!opening) return  // was already open, now closing — nothing to load

    if (isHost) {
      // Host: push current canvas snapshot to Redis immediately
      setTimeout(() => {
        const dataUrl = whiteboardRef.current?.getSnapshot()
        if (dataUrl) {
          api.post('/live-classes/' + id + '/whiteboard', {
            event: { type: 'snapshot', dataUrl }
          }).catch(() => {})
        }
      }, 200)
    } else {
      // Student: fetch saved state from Redis
      try {
        const res = await api.get('/live-classes/' + id + '/whiteboard/state')
        const dataUrl = res.data.data?.snapshot
        if (dataUrl) setTimeout(() => whiteboardRef.current?.loadSnapshot(dataUrl), 100)
      } catch { /* non-fatal */ }
    }
  }, [id, isHost])  // activePanel removed — read via functional updater to avoid stale closure
  // ── Poll broadcast ───────────────────────────────────────────────────────────
  const handlePollEvent = useCallback((ev: PollEvent) => {
    // Apply locally first for host
    if (ev.type === 'create' && ev.poll) {
      setPolls(prev => [ev.poll!, ...prev])
    } else if (ev.type === 'vote' && ev.pollId && ev.optionId) {
      const uid = user?.id
      setPolls(prev => prev.map(p => p.id !== ev.pollId ? p : {
        ...p,
        options: p.options.map(o => o.id !== ev.optionId ? o : {
          ...o,
          votes: o.votes.includes(uid ?? '') ? o.votes : [...o.votes, uid ?? '']
        })
      }))
    } else if (ev.type === 'close' && ev.pollId) {
      setPolls(prev => prev.map(p => p.id !== ev.pollId ? p : { ...p, isActive: false }))
    }
    // Broadcast to students
    api.post('/live-classes/' + id + '/poll', { event: ev }).catch(() => {})
  }, [id, user?.id])

  // ── Quran position broadcast ─────────────────────────────────────────────────
  const handleQuranPosition = useCallback((pos: QuranPosition) => {
    setQuranPosition(pos)
    api.post('/live-classes/' + id + '/quran-position', pos).catch(() => {})
  }, [id])

  // Send a targeted emoji reaction to a specific participant
  const sendTargetedReaction = (emoji: string, target: LCParticipant) => {
    setParticipantPopup(null)
    spawnEmoji(emoji, 'You → ' + target.user.firstName)
    const socket = getSocket()
    if (socket) socket.emit('liveclass:reaction', {
      liveClassId: id, emoji, userId: user?.id,
      firstName: user?.firstName || 'Someone',
      targetUserId: target.userId,
      targetName: target.user.firstName,
    })
  }

  // Open DM with a participant
  const openDm = (target: LCParticipant) => {
    setParticipantPopup(null)
    window.open('/dm?userId=' + target.userId, '_blank')
  }

  // Handle clicking a participant tile
  const handleParticipantClick = (p: LCParticipant, e: React.MouseEvent) => {
    if (p.userId === user?.id) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setParticipantPopup({ participant: p, x: rect.left, y: rect.top })
  }

  // ── Render guards ───────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  )
  if (!lc) return <div className="text-center py-16 text-gray-500">Class not found</div>

  const myParticipant = participants.find(p => p.userId === user?.id)
  const isConnected   = connState === ConnectionState.Connected
  const iAmSharing    = screenOn && screenSharer === roomRef.current?.localParticipant?.identity

  // ── Dynamic video grid layout (matches AUTO_GRID from LayoutEngine) ────────
  // 1        → full-width (Teacher spotlight)
  // 2        → 2-column split view
  // 3–4      → 2×2 grid
  // 5–6      → 3×2 grid
  // 7–9      → 3×3 grid
  // 10–12    → 4×3 grid
  // 13–16    → 4×4 grid
  // 17+      → paginated 4×4 (16 per page)
  const PAGE_SIZE = 16

  const totalVideoPages = Math.ceil(Math.max(participants.length, 1) / PAGE_SIZE)
  const pagedParticipants = participants.slice(
    videoPage * PAGE_SIZE,
    videoPage * PAGE_SIZE + PAGE_SIZE,
  )

  const n = participants.length
  // Desktop uses the full AUTO_GRID breakpoints; mobile caps at 2 columns
  const videoCols =
    n <= 1  ? 'grid-cols-1 max-w-sm mx-auto' :
    n <= 2  ? 'grid-cols-2' :
    n <= 4  ? 'grid-cols-2' :
    n <= 6  ? 'grid-cols-2 sm:grid-cols-3' :
    n <= 9  ? 'grid-cols-2 sm:grid-cols-3' :
    n <= 12 ? 'grid-cols-2 sm:grid-cols-4' :
              'grid-cols-2 sm:grid-cols-4'

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-950 text-white overflow-hidden relative">

      {/* ── Gift animations — fixed overlay, z-index 500+, never interrupts AV ── */}
      <LiveClassGiftOverlay isLowEnd={isLowEnd} />

      {/* ── Gift Panel — bottom sheet ─────────────────────────────────────── */}
      <AnimatePresence>
        {isGiftPanelOpen && (
          <GiftPanel
            receivers={giftAdapter.mapParticipants(participants)}
            onClose={toggleGiftPanel}
            onSendGift={sendGift}
            onSendGiftAll={sendGiftToAll}
          />
        )}
      </AnimatePresence>

      {/* Floating emoji reactions */}
      {floatingEmojis.map(fe => (
        <div key={fe.id} className="pointer-events-none absolute bottom-24 z-50 flex flex-col items-center"
          style={{ left: `${fe.x}%`, animation: 'floatUp 3s ease-out forwards' }}>
          <span className="text-4xl drop-shadow-lg">{fe.emoji}</span>
          <span className="text-[10px] text-white/60 mt-0.5">{fe.fromName}</span>
        </div>
      ))}

      {/* Participant interaction popup */}
      {participantPopup && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setParticipantPopup(null)} />
          {/* Popup card */}
          <div
            className="fixed z-50 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl p-4 w-64"
            style={{
              top:  Math.min(participantPopup.y, window.innerHeight - 280),
              left: Math.min(participantPopup.x, window.innerWidth  - 280),
            }}
          >
            {/* Participant info */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center font-bold text-indigo-300 text-lg flex-shrink-0">
                {getAvatarUrl(participantPopup.participant.user.avatarUrl)
                  ? <img src={getAvatarUrl(participantPopup.participant.user.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                  : participantPopup.participant.user.firstName[0] + participantPopup.participant.user.lastName[0]}
              </div>
              <div>
                <p className="font-semibold text-sm text-white">
                  {participantPopup.participant.user.firstName} {participantPopup.participant.user.lastName}
                </p>
                <p className="text-xs text-gray-400 capitalize">{(participantPopup.participant.role ?? '').toLowerCase()}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {activeSpeakers.has(participantPopup.participant.userId) && (
                    <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Speaking
                    </span>
                  )}
                  {participantPopup.participant.isMuted
                    ? <span className="text-[10px] text-red-400">🔇 Muted</span>
                    : <span className="text-[10px] text-green-400">🎙 Unmuted</span>}
                </div>
              </div>
            </div>

            {/* React with emoji */}
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">React</p>
            <div className="flex flex-wrap gap-1 mb-3">
              {REACTIONS.map(emoji => (
                <button key={emoji}
                  onClick={() => sendTargetedReaction(emoji, participantPopup.participant)}
                  className="text-xl hover:scale-125 transition-transform p-1 rounded-lg hover:bg-gray-700">
                  {emoji}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-1">
              <button
                onClick={() => openDm(participantPopup.participant)}
                className="w-full text-left text-xs text-gray-300 hover:text-white hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Send private message
              </button>
              {isHost && participantPopup.participant.role !== 'HOST' && (
                <>
                  {/* Mute/Unmute toggle based on current state */}
                  <button
                    onClick={async () => {
                      const isMuted = participantPopup.participant.isMuted
                      await muteParticipant(participantPopup.participant.userId, !isMuted)
                      setParticipantPopup(null)
                    }}
                    className={`w-full text-left text-xs hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${participantPopup.participant.isMuted ? 'text-green-400 hover:text-green-300' : 'text-yellow-400 hover:text-yellow-300'}`}
                  >
                    {participantPopup.participant.isMuted
                      ? <><Mic className="w-3.5 h-3.5" /> Unmute</>
                      : <><MicOff className="w-3.5 h-3.5" /> Mute</>
                    }
                  </button>
                  {/* Allow to speak (approve hand) — shown when hand is raised */}
                  {participantPopup.participant.handRaised && (
                    <button
                      onClick={() => { approveHand(participantPopup.participant.userId); setParticipantPopup(null) }}
                      className="w-full text-left text-xs text-indigo-400 hover:text-indigo-300 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Hand className="w-3.5 h-3.5" /> Approve hand
                    </button>
                  )}
                  {/* Lower hand — shown when hand is raised */}
                  {participantPopup.participant.handRaised && (
                    <button
                      onClick={() => { rejectHand(participantPopup.participant.userId); setParticipantPopup(null) }}
                      className="w-full text-left text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <HandMetal className="w-3.5 h-3.5" /> Lower hand
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      await kickParticipant(participantPopup.participant.userId)
                      setParticipantPopup(null)
                    }}
                    className="w-full text-left text-xs text-red-400 hover:text-red-300 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <PhoneOff className="w-3.5 h-3.5" /> Remove from class
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── HTTPS warning — shown when camera/mic won't work due to HTTP ──── */}
      {typeof window !== 'undefined' &&
        window.location.protocol === 'http:' &&
        !['localhost', '127.0.0.1'].includes(window.location.hostname) && (
        <div className="flex items-start gap-3 px-4 py-3 bg-yellow-600/20 border-b border-yellow-600/30 text-yellow-300 text-xs flex-shrink-0">
          <span className="text-lg leading-none flex-shrink-0">🔒</span>
          <div>
            <span className="font-bold">Camera &amp; microphone require HTTPS. </span>
            You are on <code className="bg-yellow-900/40 px-1 rounded">http://{window.location.hostname}</code>.
            {' '}Fix: open <code className="bg-yellow-900/40 px-1 rounded">http://localhost:3000</code> in your browser instead,
            or restart the frontend with <code className="bg-yellow-900/40 px-1 rounded">npm run dev</code> (HTTPS enabled).
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/live-class')} className="p-1.5 rounded-lg hover:bg-gray-800" aria-label="Back to live classes">
            <ChevronLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div>
            <h1 className="font-semibold text-sm">{lc.title}</h1>
            <p className="text-xs text-gray-400">{lc.class?.name ?? lc.title}</p>
          </div>
          {lc.status === 'LIVE' && (
            <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle — only visible when joined */}
          {joined && (
            <div className="flex items-center bg-gray-800 rounded-lg p-0.5 gap-0.5">
              <button
                onClick={() => setViewMode('video')}
                title="Video view"
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors',
                  viewMode === 'video'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Video</span>
              </button>
              <button
                onClick={() => setViewMode('audio')}
                title="Audio view"
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors',
                  viewMode === 'audio'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Radio className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Audio</span>
              </button>
            </div>
          )}
          {isConnected && <span className="w-2 h-2 bg-green-500 rounded-full" title="Connected" />}
          {isRecording && (
            <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full animate-pulse">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> REC
            </span>
          )}
          <span className="text-xs text-gray-400">{participants.length} in class</span>
          {isHost && lc.status === 'SCHEDULED' && (
            <Button size="sm" className="bg-red-600 hover:bg-red-700 gap-1 text-xs h-7" onClick={handleStart}>
              <Play className="w-3 h-3" /> Start
            </Button>
          )}
          {isHost && lc.status === 'LIVE' && (
            <Button size="sm" variant="outline" className="border-red-700 text-red-400 hover:bg-red-900/20 gap-1 text-xs h-7" onClick={handleEnd}>
              <Square className="w-3 h-3" /> End
            </Button>
          )}
        </div>
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      {joined && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-950 border-b border-gray-800/60 text-[11px] flex-shrink-0 overflow-x-auto">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className={cn('w-2 h-2 rounded-full',
              connState === ConnectionState.Connected    && 'bg-green-500',
              connState === ConnectionState.Connecting   && 'bg-yellow-400 animate-pulse',
              connState === ConnectionState.Reconnecting && 'bg-orange-400 animate-pulse',
              connState === ConnectionState.Disconnected && 'bg-red-500',
            )} />
            <span className="text-gray-400">
              {connState === ConnectionState.Connected    && 'Connected'}
              {connState === ConnectionState.Connecting   && 'Connecting…'}
              {connState === ConnectionState.Reconnecting && 'Reconnecting…'}
              {connState === ConnectionState.Disconnected && 'Disconnected'}
            </span>
          </span>
          <span className="text-gray-700 shrink-0">|</span>
          <span className={cn('flex items-center gap-1 shrink-0', audioTrackCount > 0 ? 'text-green-400' : 'text-gray-500')}>
            🔊 {audioTrackCount} audio {audioTrackCount === 1 ? 'stream' : 'streams'}
          </span>
          <span className="text-gray-700 shrink-0">|</span>
          <span className={cn('flex items-center gap-1 shrink-0', micOn ? 'text-green-400' : 'text-red-400')}>
            {micOn ? '🎙 Mic on' : '🔇 Mic off'}
          </span>
          {screenOn && (
            <>
              <span className="text-gray-700 shrink-0">|</span>
              <span className="text-indigo-400 flex items-center gap-1 shrink-0">
                🖥 {iAmSharing ? 'You are sharing' : 'Screen shared'}
              </span>
            </>
          )}
          {activeSpeakers.size > 0 && (
            <>
              <span className="text-gray-700 shrink-0">|</span>
              <span className="text-green-400 flex items-center gap-1 animate-pulse shrink-0">
                🗣 {activeSpeakers.size} speaking
              </span>
            </>
          )}
          {isOpenMic && (
            <>
              <span className="text-gray-700 shrink-0">|</span>
              <span className="text-green-400 flex items-center gap-1 shrink-0 font-bold">
                🎙 Open Mic — everyone can speak
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Pre-join lobby */}
          {!joined ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="w-20 h-20 bg-indigo-900/50 rounded-full flex items-center justify-center">
                <Video className="w-10 h-10 text-indigo-400" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold">{lc.title}</h2>
                <p className="text-gray-400 text-sm mt-1">{lc.class?.name ? `${lc.class.name} — ` : ''}{lc.duration ? `${lc.duration} min` : 'Open stream'}</p>
                {lc.status === 'SCHEDULED' && <p className="text-yellow-400 text-sm mt-2">Class not started yet</p>}
                {lc.status === 'ENDED'     && <p className="text-gray-500 text-sm mt-2">This class has ended</p>}
                {/* Show capacity warning when class is live and near/at limit */}
                {lc.status === 'LIVE' && !isHost && (() => {
                  // Use _count.participants (active) from API, fall back to local state length
                  const active = lc._count?.participants ?? participants.length
                  const max    = lc.maxParticipants ?? 100
                  const pct    = max > 0 ? active / max : 0
                  if (pct >= 1) return (
                    <p className="text-red-400 text-sm mt-2 font-semibold">
                      🚫 Class is full ({active}/{max} participants)
                    </p>
                  )
                  if (pct >= 0.9) return (
                    <p className="text-orange-400 text-sm mt-2">
                      ⚠️ Almost full — {max - active} spot{max - active !== 1 ? 's' : ''} left
                    </p>
                  )
                  return null
                })()}
              </div>
              {lc.status !== 'ENDED' && lc.status !== 'CANCELLED' && (
                <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 px-8"
                  onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}>
                  {joinMutation.isPending ? 'Joining…' : 'Join Class'}
                </Button>
              )}
              {lc.status === 'ENDED' && lc.recordingUrl && (
                <a
                  href={lc.recordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Play className="w-4 h-4" /> Watch Recording
                </a>
              )}
            </div>

          ) : viewMode === 'video' ? (
            /* ── VIDEO VIEW ─────────────────────────────────────────────────── */
            <div className="flex-1 overflow-y-auto p-3 space-y-3">

              {/* Always-mounted fallback video element — kept in DOM so
                  localVideoFallbackRef.current is never null. Not used for
                  camera display — only present to avoid null-ref crashes.
                  The actual camera video renders inside LocalVideoTile. */}
              <video
                ref={localVideoFallbackRef}
                autoPlay
                playsInline
                muted
                style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
                aria-hidden="true"
              />

              {/* Screen share panel — uses screenTrack state via ScreenShareTile */}
              <div className={cn('w-full rounded-xl overflow-hidden bg-gray-900 relative', screenOn ? 'block' : 'hidden')}>
                <button onClick={() => setScreenFullscreen(f => !f)}
                  className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-lg transition-colors"
                  title={screenFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  aria-label={screenFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                  {screenFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <div className={cn('transition-all',
                  screenFullscreen ? 'fixed inset-0 z-40 bg-black flex items-center justify-center' : 'aspect-video')}>
                  {screenFullscreen && (
                    <button onClick={() => setScreenFullscreen(false)}
                      className="absolute top-4 right-4 z-50 bg-black/60 hover:bg-black/80 text-white p-2 rounded-xl"
                      aria-label="Exit fullscreen">
                      <Minimize2 className="w-5 h-5" />
                    </button>
                  )}
                  {/* Screen share track — local uses LocalScreenTile (ref callback pattern),
                      remote uses ScreenShareTile (same pattern for remote tracks) */}
                  {iAmSharing
                    ? localScreenTrack
                      ? <LocalScreenTile track={localScreenTrack} />
                      : <div className="w-full h-full bg-black flex items-center justify-center text-gray-500 text-xs">Starting screen share…</div>
                    : screenTrack
                      ? <ScreenShareTile track={screenTrack} />
                      : <div className="w-full h-full bg-black" />
                  }
                  <div className="absolute top-2 left-2 bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {iAmSharing ? '🖥 You are sharing' : '🖥 Screen Share'}
                  </div>
                </div>
              </div>

              {/* Participant video grid */}
              <div className={'grid gap-2 ' + videoCols}>
                {/* Always show the current user's own tile first, even if participants
                    list hasn't loaded yet — ensures localVideoRef is always in DOM */}
                {(() => {
                  const meInGrid = pagedParticipants.find(p => p.userId === user?.id)
                  if (!meInGrid) {
                    // Synthetic "me" tile while participant list loads
                    const meSynth = participants.find(p => p.userId === user?.id) || {
                      id: user?.id ?? '',
                      userId: user?.id ?? '',
                      role: 'HOST' as const,
                      isMuted: !micOn,
                      isVideoOn: videoOn,
                      handRaised: false,
                      user: {
                        id: user?.id ?? '',
                        firstName: user?.firstName ?? '',
                        lastName: user?.lastName ?? '',
                        avatarUrl: user?.avatarUrl ?? null,
                      }
                    }
                    return (
                      <div key="me-fallback">
                        <LocalVideoTile
                          p={meSynth as any}
                          isSpeaking={activeSpeakers.has(user?.id ?? '')}
                          videoRef={localVideoRef}
                          videoOn={videoOn}
                          room={roomConnected}
                        />
                      </div>
                    )
                  }
                  return null
                })()}
                {pagedParticipants.map(p => {
                  const isMe = p.userId === user?.id
                  if (isMe) {
                    return (
                      <div key={p.userId} className="relative">
                        <LocalVideoTile
                          p={p}
                          isSpeaking={activeSpeakers.has(p.userId)}
                          videoRef={localVideoRef}
                          videoOn={videoOn}
                          room={roomConnected}
                        />
                      </div>
                    )
                  }
                  // Remote participant — get their video track from state
                  const remoteTrack = remoteVideoTracks.get(p.userId) ?? null
                  return (
                    <div key={p.userId} className="relative">
                      <RemoteVideoTile
                        p={p}
                        isSpeaking={activeSpeakers.has(p.userId)}
                        track={remoteTrack}
                        onClick={(e) => handleParticipantClick(p, e)}
                      />
                      {isHost && p.userId !== user?.id && p.handRaised && (
                        <button onClick={() => approveHand(p.userId)}
                          className="absolute top-1 right-1 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          Allow
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Video grid pagination — shown when 17+ participants */}
              {totalVideoPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <button
                    onClick={() => setVideoPage(p => Math.max(0, p - 1))}
                    disabled={videoPage === 0}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 text-gray-300 disabled:opacity-30 hover:bg-gray-700 transition-colors"
                  >
                    ← Prev
                  </button>
                  <div className="flex gap-1.5">
                    {Array.from({ length: totalVideoPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setVideoPage(i)}
                        aria-label={`Page ${i + 1}`}
                        className={cn(
                          'transition-all rounded-full',
                          i === videoPage
                            ? 'w-4 h-2 bg-indigo-500'
                            : 'w-2 h-2 bg-gray-600 hover:bg-gray-500'
                        )}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => setVideoPage(p => Math.min(totalVideoPages - 1, p + 1))}
                    disabled={videoPage === totalVideoPages - 1}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-800 text-gray-300 disabled:opacity-30 hover:bg-gray-700 transition-colors"
                  >
                    Next →
                  </button>
                  <span className="text-xs text-gray-500">
                    Page {videoPage + 1} of {totalVideoPages} · {participants.length} participants
                  </span>
                </div>
              )}

              {/* Raised hands panel */}
              {isHost && participants.some(p => p.handRaised) && (
                <div className="p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-xl">
                  <p className="text-xs font-bold text-yellow-400 mb-2">✋ Raised hands</p>
                  <div className="flex flex-wrap gap-2">
                    {participants.filter(p => p.handRaised).map(p => (
                      <div key={p.userId} className="flex items-center gap-2 bg-gray-800 rounded-lg px-2 py-1">
                        <span className="text-xs text-gray-300">{p.user.firstName} {p.user.lastName}</span>
                        <button onClick={() => approveHand(p.userId)} className="text-xs text-green-400 font-bold">Allow</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Whiteboard panel */}
              {activePanel === 'whiteboard' && lc.whiteboardEnabled && (
                <LiveClassWhiteboard
                  ref={whiteboardRef}
                  isHost={isHost}
                  remoteEvent={remoteDrawEvent}
                  onDraw={handleDraw}
                />
              )}

              {/* Quran panel */}
              {lc.quranPanelEnabled && (
                <LiveClassQuranPanel
                  isHost={isHost}
                  liveClassId={id}
                  syncedPosition={quranPosition}
                  onPositionChange={handleQuranPosition}
                />
              )}
            </div>

          ) : (
            /* ── AUDIO VIEW ─────────────────────────────────────────────────── */
            <div className="flex-1 overflow-y-auto p-4">
              {/* Screen share still visible in audio mode if active */}
              {screenOn && (
                <div className="w-full rounded-xl overflow-hidden bg-gray-900 relative aspect-video mb-4">
                  {iAmSharing
                    ? localScreenTrack
                      ? <LocalScreenTile track={localScreenTrack} />
                      : <div className="w-full h-full bg-black flex items-center justify-center text-gray-500 text-xs">Starting screen share…</div>
                    : screenTrack
                      ? <ScreenShareTile track={screenTrack} />
                      : <div className="w-full h-full bg-black" />
                  }
                  <div className="absolute top-2 left-2 bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {iAmSharing ? '🖥 You are sharing' : '🖥 Screen Share'}
                  </div>
                </div>
              )}

              {/* Dynamic Speaker Grid — replaces the manual AudioTile flex-wrap grid.
                  Wrapped in LiveKitRoom so SpeakerGrid's useDynamicLayout hook can
                  call useRoomContext() to subscribe to LiveKit participant events.
                  roomRef.current is the already-connected Room instance. */}
              {roomRef.current ? (
                <LiveKitRoom room={roomRef.current} serverUrl="" token="">
                  <SpeakerGrid
                    roomId={id}
                    isHost={isHost}
                    currentUserId={user?.id ?? ''}
                    theme="dark"
                    className="flex-1"
                  />
                </LiveKitRoom>
              ) : (
                /* Fallback: show AudioTiles before LiveKit connects */
                <div className="flex flex-wrap justify-center gap-2">
                  {participants.map(p => {
                    const isMe = p.userId === user?.id
                    return (
                      <div key={p.userId} className="relative">
                        <AudioTile p={p} isMe={isMe} isSpeaking={activeSpeakers.has(p.userId)}
                          onClick={(e) => handleParticipantClick(p, e)} />
                        {isHost && p.userId !== user?.id && p.handRaised && (
                          <button onClick={() => approveHand(p.userId)}
                            className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                            Allow
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Raised hands panel */}
              {isHost && participants.some(p => p.handRaised) && (
                <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-xl">
                  <p className="text-xs font-bold text-yellow-400 mb-2">✋ Raised hands</p>
                  <div className="flex flex-wrap gap-2">
                    {participants.filter(p => p.handRaised).map(p => (
                      <div key={p.userId} className="flex items-center gap-2 bg-gray-800 rounded-lg px-2 py-1">
                        <span className="text-xs text-gray-300">{p.user.firstName} {p.user.lastName}</span>
                        <button onClick={() => approveHand(p.userId)} className="text-xs text-green-400 font-bold">Allow</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quran panel */}
              {lc.quranPanelEnabled && (
                <div className="mt-4">
                  <LiveClassQuranPanel
                    isHost={isHost}
                    liveClassId={id}
                    syncedPosition={quranPosition}
                    onPositionChange={handleQuranPosition}
                  />
                </div>
              )}

              {/* Whiteboard panel in audio mode */}
              {activePanel === 'whiteboard' && lc.whiteboardEnabled && (
                <div className="mt-4">
                  <LiveClassWhiteboard
                    ref={whiteboardRef}
                    isHost={isHost}
                    remoteEvent={remoteDrawEvent}
                    onDraw={handleDraw}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Controls bar ──────────────────────────────────────────────── */}
          {joined && (
            <div className="relative flex-shrink-0 bg-gray-900 border-t border-gray-800">
              {/* Emoji picker — rendered above the bar, escapes overflow-hidden via position fixed */}
              {showEmojiPicker && (
                <div
                  className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-2xl p-2 flex gap-1 shadow-2xl z-50"
                  style={{ maxWidth: 'calc(100vw - 16px)' }}
                >
                  {REACTIONS.map(emoji => (
                    <button key={emoji} onClick={() => sendReaction(emoji)}
                      className="text-2xl hover:scale-125 transition-transform p-1 rounded-lg hover:bg-gray-700"
                      aria-label={`React with ${emoji}`}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Single scrollable row — no wrapping, buttons never jump positions */}
              <div className="flex items-center justify-center gap-2 px-3 py-3 overflow-x-auto scrollbar-none">

                {/* ── Reconnect button — shown when disconnected ──────────── */}
                {!isConnected && (
                  <button
                    onClick={() => connectLiveKitRef.current?.()}
                    title="Reconnect to LiveKit"
                    aria-label="Reconnect to LiveKit"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-bold transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    {connState === 'connecting' || connState === 'reconnecting' ? 'Connecting…' : 'Reconnect'}
                  </button>
                )}

                {/* ── Primary controls (always visible) ───────────────────── */}

                {/* Mic */}
                <button
                  onClick={toggleMic}
                  title={micOn ? 'Mute' : 'Unmute'}
                  aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  className={cn(
                    'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                    micOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700',
                  )}
                >
                  {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>

                {/* Camera — video mode only */}
                {viewMode === 'video' && (
                  <button
                    onClick={toggleVideo}
                    title={videoOn ? 'Stop camera' : 'Start camera'}
                    aria-label={videoOn ? 'Stop camera' : 'Start camera'}
                    disabled={!isConnected}
                    className={cn(
                      'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                      videoOn ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600',
                      !isConnected && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    {videoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  </button>
                )}

                {/* View mode toggle — all users can switch audio/video */}
                <button
                  onClick={() => setViewMode(v => v === 'video' ? 'audio' : 'video')}
                  title={viewMode === 'video' ? 'Switch to audio only' : 'Switch to video'}
                  aria-label={viewMode === 'video' ? 'Switch to audio only' : 'Switch to video'}
                  className={cn(
                    'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                    viewMode === 'audio' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600',
                  )}
                >
                  {viewMode === 'audio' ? <Radio className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
                </button>

                {/* Screen share — video mode, host always + students when enabled.
                    PLAT-02 FIX: Only render when navigator.mediaDevices?.getDisplayMedia
                    is available. iOS Safari and mobile Chrome do not support getDisplayMedia,
                    so clicking the button on those platforms threw an unhandled runtime error.
                    The check is evaluated at render time — SSR-safe because `typeof window`
                    guard ensures it runs only in the browser. */}
                {viewMode === 'video' &&
                  (isHost || lc.screenShareEnabled !== false) &&
                  typeof window !== 'undefined' &&
                  typeof navigator !== 'undefined' &&
                  !!(navigator.mediaDevices?.getDisplayMedia) && (
                  <button
                    onClick={toggleScreen}
                    title={iAmSharing ? 'Stop sharing' : 'Share screen'}
                    aria-label={iAmSharing ? 'Stop screen share' : 'Share screen'}
                    className={cn(
                      'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                      iAmSharing ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600',
                    )}
                  >
                    {iAmSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                  </button>
                )}

                {/* ── Secondary controls (role/feature gated) ──────────────── */}

                {/* Hand raise — students, hand-raise enabled, not open mic */}
                {!isHost && lc.handRaiseEnabled && !isOpenMic && (
                  <button
                    onClick={myParticipant?.handRaised ? lowerHand : raiseHand}
                    title={myParticipant?.handRaised ? 'Lower hand' : 'Raise hand'}
                    aria-label={myParticipant?.handRaised ? 'Lower hand' : 'Raise hand'}
                    className={cn(
                      'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                      myParticipant?.handRaised ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600',
                    )}
                  >
                    <Hand className="w-5 h-5" />
                  </button>
                )}

                {/* Emoji reactions */}
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  title="React"
                  aria-label="Send emoji reaction"
                  className={cn(
                    'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                    showEmojiPicker ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600',
                  )}
                >
                  <Smile className="w-5 h-5" />
                </button>

                {/* Gift button — opens universal gift panel */}
                <button
                  onClick={toggleGiftPanel}
                  title="Send a gift"
                  aria-label="Send a gift"
                  className={cn(
                    'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                    isGiftPanelOpen ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600',
                  )}
                >
                  🎁
                </button>

                {/* Chat — opens sidebar */}
                <button
                  onClick={() => { setTab('chat'); setShowSidebar(true) }}
                  title="Chat"
                  aria-label="Open chat"
                  className="w-12 h-12 rounded-full flex-shrink-0 bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>

                {/* Participants — mobile only (desktop sidebar always visible) */}
                <button
                  onClick={() => { setTab('participants'); setShowSidebar(true) }}
                  title="Participants"
                  aria-label="Open participants"
                  className="md:hidden w-12 h-12 rounded-full flex-shrink-0 bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                >
                  <Users className="w-5 h-5" />
                </button>

                {/* Whiteboard — students, when enabled */}
                {!isHost && lc.whiteboardEnabled && (
                  <button
                    onClick={() => openWhiteboard()}
                    title={activePanel === 'whiteboard' ? 'Close whiteboard' : 'View whiteboard'}
                    aria-label={activePanel === 'whiteboard' ? 'Close whiteboard' : 'Open whiteboard'}
                    className={cn(
                      'w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-colors',
                      activePanel === 'whiteboard' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600',
                    )}
                  >
                    <PenLine className="w-5 h-5" />
                  </button>
                )}

                {/* ── Leave (always last, always red) ──────────────────────── */}
                <button
                  onClick={handleLeave}
                  title="Leave class"
                  aria-label="Leave class"
                  className="w-12 h-12 rounded-full flex-shrink-0 bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>

              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        {joined && (
          <div className={cn(
            'flex flex-col bg-gray-900 border-l border-gray-800 flex-shrink-0',
            // Desktop: always visible as fixed sidebar
            'md:w-72 md:relative md:flex',
            // Mobile: full-screen overlay, toggled by showSidebar
            showSidebar
              ? 'fixed inset-0 z-20 w-full'
              : 'hidden md:flex',
          )}>
            <div className="flex border-b border-gray-800 overflow-x-auto">
              {/* Mobile close button */}
              <button
                onClick={() => setShowSidebar(false)}
                className="md:hidden flex items-center justify-center px-3 text-gray-400 hover:text-white border-r border-gray-800"
                aria-label="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
              {(isHost
                ? ['host', 'participants', 'chat', 'polls'] as const
                // Students only see polls tab when there's at least one poll active
                : (['participants', 'chat', ...(polls.length > 0 ? ['polls'] : [])] as const)
              ).map(t => (
                <button key={t} onClick={() => setTab(t as any)}
                  className={cn('flex-1 py-3 text-xs font-semibold transition-colors whitespace-nowrap px-2',
                    tab === t ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300')}>
                  {t === 'host'
                    ? <span className="flex items-center justify-center gap-1">
                        <Settings className="w-3 h-3" /> Controls
                        {participants.filter(p => p.handRaised).length > 0 && (
                          <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full" />
                        )}
                      </span>
                    : t === 'participants' ? `${participants.length} People`
                    : t === 'chat' ? 'Chat'
                    : <span className="flex items-center justify-center gap-1">
                        <BarChart2 className="w-3 h-3" /> Polls
                        {polls.filter(p => p.isActive).length > 0 && (
                          <span className="ml-0.5 w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                        )}
                      </span>}
                </button>
              ))}
            </div>

            {/* Host controls tab */}
            {tab === 'host' && isHost && lc && (
              <div className="flex-1 overflow-y-auto">
                <LiveClassHostControls
                liveClassId={id}
                status={lc.status}
                participants={participants}
                settings={{
                  chatEnabled:        lc.chatEnabled,
                  handRaiseEnabled:   lc.handRaiseEnabled,
                  quranPanelEnabled:  lc.quranPanelEnabled,
                  whiteboardEnabled:  lc.whiteboardEnabled,
                  isOpenMic,
                  isRecording,
                  // screenShareEnabled: real DB field (true = participants can share)
                  screenShareEnabled: lc.screenShareEnabled !== false,
                  viewMode,
                }}
                activeSpeakers={activeSpeakers}
                currentUserId={user?.id}
                activePanel={activePanel}
                onStart={handleStart}
                onEnd={handleEnd}
                onMuteAll={async () => {
                  await api.patch('/live-classes/' + id + '/mute-all').catch(() => {})
                  setParticipants(prev => prev.map(p => p.role !== 'HOST' ? { ...p, isMuted: true } : p))
                }}
                onUnmuteAll={async () => {
                  await api.patch('/live-classes/' + id + '/unmute-all').catch(() => {})
                  setParticipants(prev => prev.map(p => p.role !== 'HOST' ? { ...p, isMuted: false } : p))
                }}
                onLowerAllHands={async () => {
                  await api.post('/live-classes/' + id + '/hand/lower-all').catch(() => {})
                  setParticipants(prev => prev.map(p => ({ ...p, handRaised: false })))
                }}
                onMute={muteParticipant}
                onKick={kickParticipant}
                onApproveHand={approveHand}
                onRejectHand={rejectHand}
                onToggleOpenMic={toggleOpenMic}
                onToggleRecording={toggleRecording}
                onToggleWhiteboard={() => openWhiteboard()}
                onToggleSetting={toggleSetting}
                onSetViewMode={(mode) => {
                  setViewMode(mode)
                  // Broadcast view mode change to all participants via socket
                  const socket = getSocket()
                  if (socket) socket.emit('liveclass:viewmode_changed', { liveClassId: id, viewMode: mode })
                  toast({ title: mode === 'audio' ? '🔇 Switched to audio-only view' : '📹 Switched to video view' })
                }}
              />
              </div>
            )}

            {tab === 'participants' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {participants.map(p => (
                  <div key={p.userId}
                    className={cn('flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800 transition-colors', p.userId !== user?.id && 'cursor-pointer')}
                    onClick={p.userId !== user?.id ? (e) => handleParticipantClick(p, e) : undefined}
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
                      {getAvatarUrl(p.user.avatarUrl)
                        ? <img src={getAvatarUrl(p.user.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                        : p.user.firstName[0] + p.user.lastName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">
                        {p.user.firstName} {p.user.lastName}{p.userId === user?.id && ' (You)'}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">{(p.role ?? '').toLowerCase()}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {p.handRaised && <span className="text-xs">✋</span>}
                      {activeSpeakers.has(p.userId) && <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />}
                      {p.isVideoOn && <Video className="w-3 h-3 text-indigo-400" />}
                      {p.isMuted ? <MicOff className="w-3 h-3 text-red-400" /> : <Mic className="w-3 h-3 text-green-400" />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'chat' && (
              <>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {messages.length === 0 && <p className="text-center text-gray-600 text-xs mt-8">No messages yet</p>}
                  {messages.map(msg => (
                    <div key={msg.id} className={cn('flex gap-2 group', msg.userId === user?.id && 'flex-row-reverse')}>
                      <div className="w-6 h-6 rounded-full bg-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0 mt-1">
                        {msg.user.firstName[0]}
                      </div>
                      <div className="flex-1 min-w-0 relative">
                        <div className={cn('max-w-[80%] px-3 py-1.5 rounded-xl text-xs',
                          msg.userId === user?.id ? 'bg-indigo-600 text-white ml-auto' : 'bg-gray-800 text-gray-200')}>
                          {msg.userId !== user?.id && <p className="font-bold text-indigo-400 mb-0.5">{msg.user.firstName}</p>}
                          <p>{msg.body}</p>
                        </div>
                        {/* Delete button — shown on hover for host or own message */}
                        {(isHost || msg.userId === user?.id) && (
                          <button
                            onClick={async () => {
                              await api.delete(`/live-classes/${id}/messages/${msg.id}`).catch(() => {})
                              setMessages(prev => prev.filter(m => m.id !== msg.id))
                            }}
                            title="Delete message"
                            className={cn(
                              'absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity',
                              'w-5 h-5 rounded-full bg-gray-700 hover:bg-red-800 flex items-center justify-center',
                              msg.userId === user?.id ? '-left-6' : '-right-6'
                            )}
                          >
                            <span className="text-[10px] text-gray-400 hover:text-red-300">✕</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                {lc.chatEnabled ? (
                  <div className="p-3 border-t border-gray-800 flex gap-2">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                      placeholder="Type a message…"
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500" />
                    <button onClick={sendMessage} disabled={!chatInput.trim()}
                      className="w-8 h-8 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-gray-600 border-t border-gray-800">Chat is disabled</div>
                )}
              </>
            )}

            {/* ── Polls tab ─────────────────────────────────────────────── */}
            {tab === 'polls' && (
              <div className="flex-1 overflow-y-auto p-3">
                <LiveClassPollPanel
                  isHost={isHost}
                  userId={user?.id}
                  polls={polls}
                  onEvent={handlePollEvent}
                />
                {polls.length === 0 && !isHost && (
                  <p className="text-center text-gray-600 text-xs mt-8">No polls yet</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes floatUp {
          0%   { opacity: 1; transform: translateY(0) scale(1); }
          80%  { opacity: 0.8; }
          100% { opacity: 0; transform: translateY(-160px) scale(1.4); }
        }
      `}</style>
    </div>
  )
}
