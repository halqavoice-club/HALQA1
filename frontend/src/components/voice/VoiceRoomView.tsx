'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVoiceStore, VoiceParticipant, MEMBER_LEVEL_META, ROOM_LEVEL_CAPACITY } from '@/store/voice.store'
import { useVoiceRoom, canModerate, canSpeak, VOICE_ROLES } from '@/hooks/useVoiceRoom'
import { useLiveKit } from '@/hooks/useLiveKit'
import { useAuthStore } from '@/store/auth.store'
import { useThemeStore } from '@/store/theme.store'
import { getAvatarUrl, getFileUrl } from '@/lib/avatar'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { ConnectionState } from 'livekit-client'
import './voice-room.css'
import './voice-room-dark.css'
import './mic-emoji.css'
import { useNetworkQuality } from '@/hooks/useNetworkQuality'
import { useLowDataMode, useLowData } from '@/lib/lowDataMode'
import { voiceOfflineBuffer } from '@/lib/voiceOfflineBuffer'
import { getSocket } from '@/lib/socket'
import { MicPassModal } from './MicPassModal'
import { WaitingListModal } from './WaitingListModal'
import { RoomSettingsSheet } from './RoomSettingsSheet'
import { GiftPanel } from './GiftPanel'
import { GiftOverlay } from './GiftOverlay'
import { GiftLeaderboard } from './GiftLeaderboard'
import { PremiumGiftOverlay } from './PremiumGiftOverlay'
import { UserProfileSheet, type SheetParticipant } from './UserProfileSheet'
import './user-profile-sheet.css'
import {
  useMicReaction,
  AvatarReactionBubble,
  MIC_EMOJIS,
} from './MicEmojiReaction'

const MAX_SPEAKERS = 10
const REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '🌹', '✅', '🎉']

// ─── Role badge config ────────────────────────────────────────────────────────
const ROLE_BADGE: Record<string, { icon: string; label: string; css: string }> = {
  HOST:      { icon: '👑', label: 'Host',      css: 'vc-badge-host' },
  MODERATOR: { icon: '🛡️', label: 'Mod',       css: 'vc-badge-mod' },
  SPEAKER:   { icon: '🎙️', label: 'Speaker',   css: 'vc-badge-speaker' },
  AUDIENCE:  { icon: '👂', label: 'Listener',  css: 'vc-badge-audience' },
}

interface Props {
  onLeave: () => void
}

// ─── Avatar circle (shared) ───────────────────────────────────────────────────
function AvatarCircle({
  avatarUrl, firstName, lastName, size = 64,
  isSpeaking = false, isMuted = false,
  role = 'AUDIENCE', handRaised = false, badge, onClick,
}: {
  avatarUrl: string | null; firstName: string; lastName: string
  size?: number; isSpeaking?: boolean; isMuted?: boolean
  role?: string; handRaised?: boolean
  badge?: React.ReactNode; onClick?: () => void
}) {
  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
  const src = getAvatarUrl(avatarUrl)
  const isHost = role === VOICE_ROLES.HOST
  const isMod  = role === VOICE_ROLES.MODERATOR

  return (
    <div
      className="vc-avatar-wrap"
      style={{ '--sz': `${size}px` } as React.CSSProperties}
      onClick={onClick}
    >
      {isSpeaking && !isMuted && <span className="vc-speaking-ring" />}

      <div className="vc-avatar-img">
        {src
          ? <img src={src} alt={firstName} />
          : <span className="vc-initials">{initials}</span>
        }
      </div>

      {/* Role badge — top right */}
      {isHost && <span className="vc-crown" title="Host">👑</span>}
      {isMod  && <span className="vc-crown" title="Moderator" style={{ fontSize: 13 }}>🛡️</span>}

      {/* Raised hand — top left */}
      {handRaised && <span className="vc-hand">✋</span>}

      {/* Mute badge — bottom right */}
      <span className={cn('vc-mic-badge', isMuted ? 'muted' : 'live')}>
        {isMuted ? '🔇' : '🎙️'}
      </span>

      {badge}
    </div>
  )
}

// ─── Empty speaker slot — open mic seat or individually locked ────────────────
function EmptySlot({
  index, micLocked, seatLocked, amModerating, onLockToggle
}: {
  index: number
  micLocked: boolean
  seatLocked: boolean      // individually locked by host (this specific seat)
  amModerating: boolean
  onLockToggle?: (index: number) => void
}) {
  const isLocked = micLocked || seatLocked

  const handleClick = () => {
    // Only HOST/MOD can tap to lock/unlock individual seats
    if (!amModerating || micLocked) return  // micLocked applies to all — no per-seat toggle
    onLockToggle?.(index)
  }

  return (
    <div
      className="vc-avatar-wrap"
      style={{ '--sz': '64px', cursor: amModerating && !micLocked ? 'pointer' : 'default' } as React.CSSProperties}
      onClick={handleClick}
      title={
        micLocked ? 'Mic locked (all seats)' :
        seatLocked ? 'Seat locked — tap to unlock' :
        amModerating ? 'Tap to lock this seat' : ''
      }
    >
      <div className={isLocked ? 'vc-avatar-img locked' : 'vc-avatar-img open'}
        style={seatLocked && !micLocked ? { outline: '2px solid #f59e0b', outlineOffset: 2 } : undefined}
      >
        <span className="vc-lock-icon">
          {seatLocked ? '🔒' : micLocked ? '🔒' : amModerating ? '🎤' : '🎤'}
        </span>
        {/* Host sees a subtle lock hint on unlocked seats */}
        {amModerating && !isLocked && (
          <span style={{
            position: 'absolute', bottom: 2, right: 2, fontSize: 9,
            background: 'rgba(0,0,0,0.4)', color: '#fff',
            borderRadius: 4, padding: '0 3px', lineHeight: '14px',
          }}>lock</span>
        )}
      </div>
      <span className="vc-slot-num">{index}</span>
    </div>
  )
}

// ─── Speaker tile with host/mod context menu ─────────────────────────────────
function SpeakerTile({
  participant, isMe, isSpeaking, myRole,
  onMute, onDemote, onKick, onMakeMod, onRemoveMod, onTransfer, onPassMic,
  onProfileOpen, remoteReactions, localEmojis,
}: {
  participant: VoiceParticipant; isMe: boolean; isSpeaking: boolean
  myRole: string
  onMute: () => void; onDemote: () => void; onKick: () => void
  onMakeMod: () => void; onRemoveMod: () => void; onTransfer: () => void
  onPassMic: () => void
  onProfileOpen: () => void
  remoteReactions: Parameters<typeof AvatarReactionBubble>[0]['reactions']
  localEmojis:     Parameters<typeof AvatarReactionBubble>[0]['localEmojis']
}) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const name = isMe ? 'You'
    : `${participant.user.firstName} ${participant.user.lastName}`.slice(0, 10) +
      (`${participant.user.firstName} ${participant.user.lastName}`.length > 10 ? '…' : '')

  const canControl = canModerate(myRole) && !isMe
  const isTargetHost = participant.role === VOICE_ROLES.HOST
  const isTargetMod  = participant.role === VOICE_ROLES.MODERATOR
  const amHost = myRole === VOICE_ROLES.HOST
  // HOST and SPEAKER can open self-menu to pass mic
  const amSpeaker = myRole === VOICE_ROLES.SPEAKER && isMe
  const amHostSelf = myRole === VOICE_ROLES.HOST && isMe
  const showSelfMenu = amSpeaker || amHostSelf

  return (
    <div className="vc-speaker-tile" ref={ref}>
      {/* Emoji reactions float above this speaker's avatar circle on stage */}
      <AvatarReactionBubble
        reactions={remoteReactions}
        userId={participant.userId}
        localEmojis={isMe ? localEmojis : []}
      />
      <AvatarCircle
        avatarUrl={participant.user.avatarUrl}
        firstName={participant.user.firstName}
        lastName={participant.user.lastName}
        size={64}
        isSpeaking={isSpeaking}
        isMuted={participant.isMuted}
        role={participant.role}
        handRaised={participant.handRaised}
        onClick={() => {
          if (!isMe) {
            // Tap other user → open profile sheet
            onProfileOpen()
          } else if (showSelfMenu) {
            // Tap self → open self context menu
            setMenu(v => !v)
          }
        }}
      />
      <span className="vc-speaker-name">{name}</span>

      {/* Role label under name */}
      {!isMe && (
        <span className={cn('vc-role-label', ROLE_BADGE[participant.role]?.css)}>
          {ROLE_BADGE[participant.role]?.icon} {ROLE_BADGE[participant.role]?.label}
        </span>
      )}

      <AnimatePresence>
        {menu && (canControl || showSelfMenu) && (
          <motion.div
            className="vc-ctx-menu"
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 6 }}
          >
            {/* Self-menu: Pass Mic (HOST and SPEAKER) */}
            {showSelfMenu && (
              <button onClick={() => { onPassMic(); setMenu(false) }}>
                🎙️ Pass Mic
              </button>
            )}

            {/* Mute — HOST and MOD can mute speakers/mods (not host) */}
            {canControl && !isTargetHost && (
              <button onClick={() => { onMute(); setMenu(false) }}>
                {participant.isMuted ? '🎙️ Unmute' : '🔇 Mute'}
              </button>
            )}

            {/* Demote to audience — HOST and MOD (MOD can't demote MOD) */}
            {canControl && !isTargetHost && !(isTargetMod && !amHost) && (
              <button onClick={() => { onDemote(); setMenu(false) }}>
                ⬇️ To audience
              </button>
            )}

            {/* HOST-only: make moderator */}
            {canControl && amHost && !isTargetHost && !isTargetMod && (
              <button onClick={() => { onMakeMod(); setMenu(false) }}>
                🛡️ Make moderator
              </button>
            )}

            {/* HOST-only: remove moderator */}
            {canControl && amHost && isTargetMod && (
              <button onClick={() => { onRemoveMod(); setMenu(false) }}>
                🛡️ Remove moderator
              </button>
            )}

            {/* HOST-only: transfer ownership */}
            {canControl && amHost && !isTargetHost && (
              <button onClick={() => { onTransfer(); setMenu(false) }}>
                👑 Transfer host
              </button>
            )}

            {/* Kick — HOST and MOD (MOD can't kick MOD or HOST) */}
            {canControl && !isTargetHost && !(isTargetMod && !amHost) && (
              <button className="danger" onClick={() => { onKick(); setMenu(false) }}>
                🚫 Remove
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Audience avatar (small, grid) ───────────────────────────────────────────
function AudienceAvatar({
  participant, isMe, onProfileOpen,
}: {
  participant: VoiceParticipant; isMe: boolean
  onProfileOpen: () => void
}) {
  const name = isMe ? 'You'
    : participant.user.firstName.slice(0, 9) +
      (participant.user.firstName.length > 9 ? '…' : '')

  return (
    <div className="vc-audience-item">
      <AvatarCircle
        avatarUrl={participant.user.avatarUrl}
        firstName={participant.user.firstName}
        lastName={participant.user.lastName}
        size={52}
        role={participant.role}
        handRaised={participant.handRaised}
        onClick={() => { if (!isMe) onProfileOpen() }}
      />
      <span className="vc-audience-name">{name}</span>
    </div>
  )
}

// ─── Main VoiceRoomView ───────────────────────────────────────────────────────
export function VoiceRoomView({ onLeave }: Props) {
  const { user } = useAuthStore()
  const router = useRouter()
  const { theme, setTheme } = useThemeStore()
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const {
    activeRoom, messages, speakingUsers, reactions,
    isChatOpen, toggleChat, isHandQueueOpen, toggleHandQueue,
    speakerQueue, isWaitingListOpen, toggleWaitingList,
    wallet, isGiftPanelOpen, toggleGiftPanel,
  } = useVoiceStore()

  const roomId = activeRoom?.id ?? null

  const {
    myParticipant,
    toggleMute,
    sendMessage,
    promoteUser,
    kickUser,
    banUser,
    unbanUser,
    muteUser,
    muteAll,
    unmuteAll,
    assignModerator,
    removeModerator,
    transferAdmin,
    broadcastReaction,
    passMic,
    grabMic,
    dropMic,
    raiseHand,
    sendGift,
    sendGiftToAll,
    toggleOpenMic,
    toggleMicLock,
    toggleSeatLock,
    pinSpeaker,
  } = useVoiceRoom(roomId)

  const {
    connectionState,
    isMicEnabled,
    activeSpeakers,
    connect,
    disconnect,
    toggleMic,
    enableMic,
    disableMic,
  } = useLiveKit(roomId)

  const [volume, setVolume] = useState(100)

  // Phase 1+9: Network quality -> Low Data Mode auto-toggle
  const netQuality     = useNetworkQuality()
  const { setAutoEnabled } = useLowDataMode()
  const isLowData      = useLowData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setAutoEnabled(netQuality.lowDataMode) }, [netQuality.lowDataMode])

  const [chatInput, setChatInput] = useState('')
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [roomMuted, setRoomMuted] = useState(false)  // local mute-room (mutes all incoming audio)
  const micBtnRef = useRef<HTMLButtonElement>(null)

  // Apply volume to all active audio elements whenever it changes
  useEffect(() => {
    const vol = volume / 100
    document.dispatchEvent(new CustomEvent('vc:volume', { detail: vol }))
  }, [volume])

  const [sendingMsg, setSendingMsg] = useState(false)
  const [showEmojis, setShowEmojis] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [showMicPassPicker, setShowMicPassPicker] = useState(false)
  const [handLoading, setHandLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDotMenu, setShowDotMenu] = useState(false)
  const dotMenuRef = useRef<HTMLDivElement>(null)
  const [participantSearch, setParticipantSearch] = useState('')
  const [profileSheet, setProfileSheet] = useState<SheetParticipant | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── Room membership (permanent member status) ─────────────────────────────
  const queryClient = useQueryClient()
  const { data: membershipData, refetch: refetchMembership } = useQuery({
    queryKey: ['room-membership', roomId],
    queryFn: () => api.get(`/voice/${roomId}/members/status`).then(r => r.data.data),
    enabled: !!roomId,
    staleTime: 0,          // always fetch fresh — backend auto-creates on join
    refetchOnMount: true,  // re-fetch every time component mounts
  })

  const isMember   = membershipData?.isMember ?? false
  const isBanned   = membershipData?.isBanned ?? false
  const myMemberLevel = membershipData?.member?.memberLevel ?? 0
  const memberLevelMeta = myMemberLevel > 0 ? (MEMBER_LEVEL_META[myMemberLevel] ?? null) : null
  const [joiningMember, setJoiningMember] = useState(false)
  const [leavingMember, setLeavingMember] = useState(false)
  // Live member count — initialised from API, updated via socket
  const [liveMemberCount, setLiveMemberCount] = useState<number | null>(null)
  const displayCount    = liveMemberCount ?? membershipData?.currentCount ?? 0
  const displayMaxCount = membershipData?.maxMembers ?? ROOM_LEVEL_CAPACITY[activeRoom?.roomLevel ?? 1] ?? 500

  // Sync liveMemberCount from API response
  useEffect(() => {
    if (membershipData?.currentCount !== undefined) {
      setLiveMemberCount(membershipData.currentCount)
    }
  }, [membershipData?.currentCount])

  const handleJoinMembership = useCallback(async () => {
    if (!roomId || joiningMember) return
    setJoiningMember(true)
    try {
      await api.post(`/voice/${roomId}/members/join`)
      refetchMembership()
      setLiveMemberCount(c => (c ?? 0) + 1)
      queryClient.invalidateQueries({ queryKey: ['room-level-stats', roomId] })
    } catch (e: any) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[membership] join failed:', e?.response?.data?.message)
      }
    } finally {
      setJoiningMember(false)
    }
  }, [roomId, joiningMember, refetchMembership, queryClient])

  const handleLeaveMembership = useCallback(async () => {
    if (!roomId || leavingMember) return
    setLeavingMember(true)
    try {
      await api.delete(`/voice/${roomId}/members/leave`)
      refetchMembership()
      setLiveMemberCount(c => Math.max(0, (c ?? 1) - 1))
      queryClient.invalidateQueries({ queryKey: ['room-level-stats', roomId] })
    } catch {}
    finally { setLeavingMember(false) }
  }, [roomId, leavingMember, refetchMembership, queryClient])

  // ── Mic emoji reaction system ──────────────────────────────────────────────
  const { localEmojis, remoteEmojis, triggerReaction } = useMicReaction(roomId)

  // Open profile sheet for any participant
  const openProfile = (p: VoiceParticipant) => {
    setProfileSheet({
      userId:    p.userId,
      firstName: p.user.firstName,
      lastName:  p.user.lastName,
      avatarUrl: p.user.avatarUrl,
      role:      p.role,
      isMuted:   p.isMuted,
    })
  }

  const isConnected    = connectionState === ConnectionState.Connected
  const isConnecting   = connectionState === ConnectionState.Connecting
  const isReconnecting = connectionState === ConnectionState.Reconnecting
  const isDisconnected = connectionState === ConnectionState.Disconnected

  useEffect(() => {
    if (roomId) {
      connect().catch((err: any) => {
        const msg = err?.message ?? ''
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setMicError('Microphone permission denied. Please allow mic access and reconnect.')
        } else if (msg.includes('not an active participant') || msg.includes('403')) {
          setMicError('You are not an active participant in this room.')
        } else if (msg.includes('Room has ended') || msg.includes('400')) {
          setMicError('This room has ended.')
        }
        // Other errors (network, timeout) are handled by the auto-reconnect loop
      })
    }
    return () => disconnect()
  }, [roomId]) // eslint-disable-line

  // Fetch initial FIFO queue state when entering room
  useEffect(() => {
    if (!roomId) return
    api.get(`/voice/${roomId}/queue`)
      .then(r => {
        const q = r.data.data?.queue
        if (Array.isArray(q)) useVoiceStore.getState().setSpeakerQueue(q)
      })
      .catch(() => {})
  }, [roomId]) // eslint-disable-line

  // ── Live member count socket updates ──────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()
    if (!socket) return

    const onMemberJoined = (d: { roomId: string; memberCount: number }) => {
      if (d.roomId !== roomId) return
      setLiveMemberCount(d.memberCount)
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
    }
    const onMemberLeft = (d: { roomId: string; memberCount: number }) => {
      if (d.roomId !== roomId) return
      setLiveMemberCount(d.memberCount)
      queryClient.invalidateQueries({ queryKey: ['room-members', roomId] })
    }
    const onRoomLevelUpgraded = (d: { roomId: string; roomLevel: number; maxMembers: number }) => {
      if (d.roomId !== roomId) return
      useVoiceStore.getState().updateRoom({ roomLevel: d.roomLevel })
    }

    socket.on('voice:member_joined',       onMemberJoined)
    socket.on('voice:member_left',         onMemberLeft)
    socket.on('voice:room_level_upgraded', onRoomLevelUpgraded)

    return () => {
      socket.off('voice:member_joined',       onMemberJoined)
      socket.off('voice:member_left',         onMemberLeft)
      socket.off('voice:room_level_upgraded', onRoomLevelUpgraded)
    }
  }, [roomId, queryClient]) // eslint-disable-line

  // When role changes to a speaking role → enable mic via Socket.IO signal.
  // No reconnect, no new token — the LiveKit connection stays alive.
  useEffect(() => {
    const role = myParticipant?.role
    if (!roomId || !role) return
    const isSpeaker = role === VOICE_ROLES.HOST || role === VOICE_ROLES.MODERATOR || role === VOICE_ROLES.SPEAKER
    if (isSpeaker) {
      enableMic().catch(() => {})
    } else {
      disableMic().catch(() => {})
    }
  }, [myParticipant?.role]) // eslint-disable-line

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!activeRoom) return null

  const participants = activeRoom.participants.filter(p => p.isActive)
  const speakers = participants.filter(p => p.role === 'HOST' || p.role === 'MODERATOR' || p.role === 'SPEAKER')
  const audience = participants.filter(p => p.role === 'AUDIENCE')
  const filteredAudience = participantSearch
    ? audience.filter(p =>
        `${p.user.firstName} ${p.user.lastName}`.toLowerCase().includes(participantSearch.toLowerCase())
      )
    : audience
  const handQueue = audience
    .filter(p => p.handRaised)
    .sort((a, b) => (a.handRaisedAt ?? '').localeCompare(b.handRaisedAt ?? ''))

  const isHost = myParticipant?.role === VOICE_ROLES.HOST || activeRoom.hostId === user?.id
  const amModerating = canModerate(myParticipant?.role) || activeRoom.hostId === user?.id
  const iCanSpeak = canSpeak(myParticipant?.role)
  const myRole = myParticipant?.role || (activeRoom.hostId === user?.id ? VOICE_ROLES.HOST : VOICE_ROLES.AUDIENCE)
  const speakerCount = speakers.length
  const speakerLimitReached = speakerCount >= (activeRoom?.maxSpeakers ?? MAX_SPEAKERS)
  const speakerSlots = Array.from({ length: MAX_SPEAKERS }, (_, i) => speakers[i] ?? null)
  const isSpeaking = (uid: string) => activeSpeakers.has(uid) || !!speakingUsers[uid]

  const handleLeave = async () => {
    // Cancel queue position if waiting
    if (myParticipant?.handRaised && roomId) {
      await api.delete(`/voice/${roomId}/queue/cancel`).catch(() => {})
    }
    // Disconnect LiveKit audio
    disconnect()
    // Notify backend (marks participant inactive, room stays LIVE)
    try { await api.post(`/voice/${roomId}/leave`) } catch {}
    onLeave()
  }

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return
    setSendingMsg(true)
    await sendMessage(chatInput.trim())
    setChatInput('')
    setSendingMsg(false)
  }

  const handlePromote = (uid: string) => {
    if (!speakerLimitReached) promoteUser(uid, 'SPEAKER')
  }

  const handleReaction = (emoji: string) => {
    broadcastReaction(emoji)
    setShowEmojis(false)
  }

  return (
    <div className="vc-root">

      {/* Mic pass offer modal (shown to receiver) */}
      {roomId && <MicPassModal roomId={roomId} />}

      {/* User profile sheet — shown when any avatar is tapped */}
      <UserProfileSheet
        participant={profileSheet}
        onClose={() => setProfileSheet(null)}
        myRole={myRole}
        roomId={roomId}
        onMute={profileSheet ? () => muteUser(profileSheet.userId, !profileSheet.isMuted) : undefined}
        onDemote={profileSheet ? () => promoteUser(profileSheet.userId, 'AUDIENCE') : undefined}
        onKick={profileSheet ? () => kickUser(profileSheet.userId) : undefined}
        onBan={profileSheet && amModerating ? () => banUser(profileSheet.userId) : undefined}
        onUnban={profileSheet && amModerating ? () => unbanUser(profileSheet.userId) : undefined}
        onMakeMod={profileSheet ? () => assignModerator(profileSheet.userId) : undefined}
        onRemoveMod={profileSheet ? () => removeModerator(profileSheet.userId) : undefined}
        onTransfer={profileSheet ? () => transferAdmin(profileSheet.userId) : undefined}
        onPassMic={profileSheet ? () => setShowMicPassPicker(true) : undefined}
      />

      {/* Gift overlay — real-time gift animations (Phase 9: skipped in Low Data Mode) */}
      {!isLowData && <GiftOverlay />}

      {/* Premium gift overlay (Phase 9: skipped in Low Data Mode) */}
      {!isLowData && <PremiumGiftOverlay />}

      {/* Gift panel — bottom sheet for sending gifts */}
      <AnimatePresence>
        {isGiftPanelOpen && roomId && (
          <GiftPanel
            receivers={speakers}
            onClose={toggleGiftPanel}
            onSendGift={sendGift}
            onSendGiftAll={sendGiftToAll}
          />
        )}
      </AnimatePresence>

      {/* Waiting list modal — shows queue position, cancel button */}
      {roomId && (
        <WaitingListModal
          roomId={roomId}
          isInQueue={!!myParticipant?.handRaised}
          isLoading={handLoading}
          onRaiseHand={async () => {
            setHandLoading(true)
            await grabMic()  // instant promote or auto-queue when stage is full
            setHandLoading(false)
          }}
          onCancelHand={async () => {
            setHandLoading(true)
            await api.delete(`/voice/${roomId}/queue/cancel`).catch(() => {})
            setHandLoading(false)
          }}
        />
      )}

      {/* Mic pass audience picker (shown to passer) */}
      <AnimatePresence>
        {showMicPassPicker && (
          <motion.div
            className="vc-invite-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowMicPassPicker(false)}
          >
            <motion.div
              className="vc-invite-card"
              initial={{ scale: 0.85, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 40 }}
              onClick={e => e.stopPropagation()}
            >
              <h3 className="vc-invite-title">🎙️ Pass Mic To</h3>
              <p className="vc-invite-desc">Choose an audience member to receive your mic</p>
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {audience.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '16px 0' }}>
                    No audience members available
                  </p>
                ) : (
                  audience.map(p => (
                    <button
                      key={p.userId}
                      onClick={async () => {
                        setShowMicPassPicker(false)
                        await passMic(p.userId)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 12, border: '1px solid #e5e7eb',
                        background: '#fff', cursor: 'pointer', textAlign: 'left',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', overflow: 'hidden',
                        background: '#e0e7ff', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1',
                        flexShrink: 0
                      }}>
                        {p.user.avatarUrl
                          ? <img src={getAvatarUrl(p.user.avatarUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : `${p.user.firstName[0]}${p.user.lastName[0]}`
                        }
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                          {p.user.firstName} {p.user.lastName}
                        </p>
                        {p.handRaised && (
                          <p style={{ margin: 0, fontSize: 11, color: '#d97706' }}>✋ Hand raised</p>
                        )}
                      </div>
                      <span style={{ fontSize: 18 }}>🎙️</span>
                    </button>
                  ))
                )}
              </div>
              <button className="vc-invite-close" onClick={() => setShowMicPassPicker(false)}>Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating reactions — each emoji streams up independently from the right side */}
      <div className="vc-float-container" aria-hidden="true">
        <AnimatePresence>
          {reactions.map(r => {
            // Each emoji gets a unique random path so they don't stack
            const startX  = Math.random() * 60 - 10   // 0 → 50px from right edge
            const driftX  = Math.random() * 50 - 25   // drift left or right while rising
            const size    = 26 + Math.random() * 16   // 26–42px
            const dur     = 2.2 + Math.random() * 1.2 // 2.2–3.4s
            const rot     = Math.random() * 30 - 15   // slight tilt
            return (
              <motion.div
                key={r.id}
                className="vc-float-emoji"
                style={{ fontSize: size, right: startX }}
                initial={{ opacity: 0, y: 0, x: 0, scale: 0.3, rotate: 0 }}
                animate={{
                  opacity: [0, 1, 1, 1, 0],
                  y:       [0, -60, -120, -180, -240],
                  x:       [0, driftX * 0.3, driftX * 0.7, driftX, driftX * 1.1],
                  scale:   [0.3, 1.2, 1.0, 0.95, 0.7],
                  rotate:  [0, rot * 0.5, rot, rot * 0.7, rot * 0.3],
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: dur, ease: 'easeOut', times: [0, 0.15, 0.4, 0.75, 1] }}
              >
                {r.emoji}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Mic permission error banner */}
      <AnimatePresence>
        {micError && (
          <motion.div
            className="vc-mic-error"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <span>🎤 {micError}</span>
            <button onClick={() => { setMicError(null); connect() }}>Retry</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reconnecting banner — shown while auto-reconnect is in progress */}
      <AnimatePresence>
        {(isReconnecting || (isConnecting && !isConnected)) && !micError && (
          <motion.div
            className="vc-reconnecting-banner"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <span className="vc-reconnecting-spinner" />
            <span>Reconnecting audio…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disconnected banner — shown when all retries exhausted */}
      <AnimatePresence>
        {isDisconnected && !micError && !isConnecting && !isReconnecting && (
          <motion.div
            className="vc-mic-error"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <span>📡 Audio disconnected</span>
            <button onClick={() => connect()}>Reconnect</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Room header */}
      <div className="vc-header">
        <div className="vc-header-left"
          onClick={() => router.push(`/voice-club/${roomId}/members`)}
          style={{ cursor: 'pointer' }}
          title="View room details & members"
        >
          {/* Show cover image if set, otherwise emoji */}
          {activeRoom.coverImageUrl ? (
            <img
              src={getFileUrl(activeRoom.coverImageUrl)}
              alt=""
              className="vc-header-cover-img"
            />
          ) : (
            <span className="vc-header-emoji">{activeRoom.coverEmoji ?? '🎙️'}</span>
          )}
          <div className="vc-header-text">
            <h2 className="vc-title">{activeRoom.title}</h2>
            {activeRoom.topic && <p className="vc-topic">{activeRoom.topic}</p>}
          </div>
        </div>
        <div className="vc-header-right">
          <span className="vc-member-count">👥 {participants.length}</span>
          {isDisconnected && !micError && (
            <button className="vc-reconnect-btn" onClick={() => connect()} title="Reconnect audio">🔄</button>
          )}
          <span className={cn(
            'vc-conn-dot',
            isConnected    ? 'live'        :
            isReconnecting ? 'connecting'  :
            isConnecting   ? 'connecting'  : 'off'
          )} />
          {/* Auto-member badge — shown when member record exists */}
          {isMember && !isBanned && (
            <span
              title={`Member${memberLevelMeta ? ' · ' + memberLevelMeta.label : ''}`}
              style={{ padding: '3px 7px', borderRadius: 14, border: '1px solid #22c55e',
                background: '#f0fdf4', fontSize: 10, fontWeight: 700, color: '#22c55e',
                flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {memberLevelMeta?.emoji ?? '⭐'} Member
            </span>
          )}
          {/* Room full indicator (only shown when capacity reached and not a member) */}
          {!isMember && displayCount >= displayMaxCount && (
            <span style={{ padding: '3px 7px', borderRadius: 14, fontSize: 9, fontWeight: 700,
              color: '#94a3b8', background: '#f1f5f9', flexShrink: 0 }}>
              🔒 Full
            </span>
          )}
          {/* Room level badge */}
          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 8, background: '#ede9fe', color: '#7c3aed', flexShrink: 0 }}>
            Lv{activeRoom.roomLevel ?? 1}
          </span>
          <button className="vc-settings-btn" onClick={() => setShowDotMenu(v => !v)} title="Room options">⋮</button>
        </div>
      </div>

      {/* ── Three-dot dropdown menu ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showDotMenu && (
          <>
            {/* Click-away backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 138 }}
              onClick={() => setShowDotMenu(false)}
            />
            <motion.div
              ref={dotMenuRef}
              initial={{ opacity: 0, scale: 0.9, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -8 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'fixed',
                top: 52,
                right: 12,
                zIndex: 139,
                background: '#fff',
                borderRadius: 16,
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                minWidth: 220,
                overflow: 'hidden',
                border: '1px solid #f1f5f9',
              }}
            >
              {/* HOST / MOD quick controls */}
              {amModerating && (
                <>
                  <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Quick Controls
                  </div>

                  {/* Open Mic toggle */}
                  <button
                    onClick={() => { toggleOpenMic(); setShowDotMenu(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>🎙️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Open Mic</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{activeRoom.isOpenMic ? 'ON — tap to turn off' : 'OFF — tap to turn on'}</div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                      background: activeRoom.isOpenMic ? '#ede9fe' : '#f1f5f9',
                      color: activeRoom.isOpenMic ? '#7c3aed' : '#94a3b8',
                    }}>
                      {activeRoom.isOpenMic ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  {/* Lock Mic toggle */}
                  <button
                    onClick={() => { toggleMicLock(); setShowDotMenu(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                      {(activeRoom.micLocked ?? false) ? '🔒' : '🔓'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Lock Mic</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {(activeRoom.micLocked ?? false) ? 'Locked — tap to unlock' : 'Unlocked — tap to lock'}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                      background: (activeRoom.micLocked ?? false) ? '#fef3c7' : '#f1f5f9',
                      color: (activeRoom.micLocked ?? false) ? '#d97706' : '#94a3b8',
                    }}>
                      {(activeRoom.micLocked ?? false) ? 'Locked' : 'Allow'}
                    </span>
                  </button>

                  {/* Divider */}
                  <div style={{ height: 1, background: '#f1f5f9', margin: '2px 0' }} />

                  {/* Mute All */}
                  <button
                    onClick={() => { muteAll(); setShowDotMenu(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>🔇</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>Mute All</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Silence all speakers</div>
                    </div>
                  </button>

                  {/* Unmute All */}
                  <button
                    onClick={() => { unmuteAll(); setShowDotMenu(false) }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 16px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>🔊</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>Unmute All</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Allow all speakers</div>
                    </div>
                  </button>

                  {/* Divider before more settings */}
                  <div style={{ height: 1, background: '#f1f5f9', margin: '2px 0' }} />
                </>
              )}

              {/* More Settings (opens full sheet) */}
              <button
                onClick={() => { setShowDotMenu(false); setShowSettings(true) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 16px', border: 'none', background: 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>⚙️</span>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>More Settings</div>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Room Settings Sheet (full sheet — opened from More Settings) */}
      <RoomSettingsSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        isHost={isHost}
        amModerating={amModerating}
        onMuteAll={amModerating ? () => muteAll() : undefined}
        onUnmuteAll={amModerating ? () => unmuteAll() : undefined}
        onToggleOpenMic={amModerating ? toggleOpenMic : undefined}
        onToggleMicLock={amModerating ? toggleMicLock : undefined}
        isOpenMic={activeRoom.isOpenMic}
        micLocked={activeRoom.micLocked ?? false}
      />

      {/* Description banner */}
      {activeRoom.description && (
        <div className="vc-desc-banner">
          <span className="vc-desc-icon">📢</span>
          <p className="vc-desc-text">{activeRoom.description}</p>
        </div>
      )}

      {/* Stage bar */}
      <div className="vc-stage-bar">
        <span className="vc-stage-label">🎙️ On Stage</span>
        <div className="vc-stage-bar-right">
          {/* Room level badge */}
          <span style={{
            fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10,
            background: 'linear-gradient(135deg, #7c3aed22, #db277722)',
            color: '#7c3aed', border: '1px solid #7c3aed33',
          }}>
            Lv{activeRoom.roomLevel ?? 1} · {((ROOM_LEVEL_CAPACITY[activeRoom.roomLevel ?? 1]) ?? 500).toLocaleString()} members
          </span>
          <span className={cn('vc-stage-count', speakerLimitReached && 'full')}>
            {speakerCount} / {MAX_SPEAKERS}{speakerLimitReached && ' · Full'}
          </span>
        </div>
      </div>

      {/* Speakers grid 5x2 */}
      <div className="vc-speakers-grid">
        {speakerSlots.map((p, i) =>
          p ? (
            <SpeakerTile
              key={p.userId}
              participant={p}
              isMe={p.userId === user?.id}
              isSpeaking={isSpeaking(p.userId)}
              myRole={myRole}
              onMute={() => muteUser(p.userId, !p.isMuted)}
              onDemote={() => promoteUser(p.userId, 'AUDIENCE')}
              onKick={() => kickUser(p.userId)}
              onMakeMod={() => assignModerator(p.userId)}
              onRemoveMod={() => removeModerator(p.userId)}
              onTransfer={() => transferAdmin(p.userId)}
              onPassMic={() => setShowMicPassPicker(true)}
              onProfileOpen={() => openProfile(p)}
              remoteReactions={remoteEmojis}
              localEmojis={localEmojis}
            />
          ) : (
            <EmptySlot
              key={`empty-${i}`}
              index={i + 1}
              micLocked={activeRoom.micLocked ?? false}
              seatLocked={(activeRoom.lockedSeats ?? []).includes(i)}
              amModerating={amModerating}
              onLockToggle={(seatIdx) => {
                const isSeatLocked = (activeRoom.lockedSeats ?? []).includes(i)
                // Confirm before locking/unlocking
                const action = isSeatLocked ? 'unlock' : 'lock'
                if (window.confirm(`${isSeatLocked ? '🔓 Unlock' : '🔒 Lock'} Seat ${seatIdx}?\n\n${isSeatLocked ? 'This seat can be occupied again.' : 'Nobody can take this seat until you unlock it.'}`)) {
                  toggleSeatLock(i)
                }
              }}
            />
          )
        )}
      </div>

      {/* Audience header */}
      <div className="vc-audience-header">
        <span className="vc-audience-label">Audience · {audience.length}</span>
        <div className="vc-audience-header-right">
          {amModerating && handQueue.length > 0 && (
            <button className="vc-hand-badge" onClick={toggleHandQueue}>
              ✋ {handQueue.length} raised
            </button>
          )}
        </div>
      </div>

      {/* Participant search — shown when audience > 5 */}
      {audience.length > 5 && (
        <div className="vc-participant-search">
          <input
            value={participantSearch}
            onChange={e => setParticipantSearch(e.target.value)}
            placeholder="Search audience…"
            className="vc-participant-search-input"
          />
          {participantSearch && (
            <button onClick={() => setParticipantSearch('')} className="vc-participant-search-clear">✕</button>
          )}
        </div>
      )}

      {/* Audience grid scrollable */}
      <div className="vc-audience-grid">
        {audience.length === 0 ? (
          <p className="vc-empty-audience">No listeners yet</p>
        ) : filteredAudience.length === 0 ? (
          <p className="vc-empty-audience">No match for "{participantSearch}"</p>
        ) : (
          filteredAudience.map(p => (
            <AudienceAvatar
              key={p.userId}
              participant={p}
              isMe={p.userId === user?.id}
              onProfileOpen={() => openProfile(p)}
            />
          ))
        )}
      </div>

      {/* Chat / Hand queue drawer */}
      <AnimatePresence>
        {(isChatOpen || isHandQueueOpen) && (
          <motion.div
            className="vc-drawer"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="vc-drawer-handle" />
            <div className="vc-drawer-tabs">
              <button
                className={cn('vc-drawer-tab', isChatOpen && 'active')}
                onClick={() => { if (isHandQueueOpen) toggleHandQueue(); if (!isChatOpen) toggleChat() }}
              >
                💬 Chat
              </button>
              {amModerating && (
                <button
                  className={cn('vc-drawer-tab', isHandQueueOpen && 'active')}
                  onClick={() => { if (isChatOpen) toggleChat(); if (!isHandQueueOpen) toggleHandQueue() }}
                >
                  ✋ Hands {handQueue.length > 0 && <span className="vc-tab-badge">{handQueue.length}</span>}
                </button>
              )}
              <button className="vc-drawer-close" onClick={() => { if (isChatOpen) toggleChat(); if (isHandQueueOpen) toggleHandQueue() }}>✕</button>
            </div>

            {isChatOpen && (
              <>
                <div className="vc-chat-messages">
                  {messages.length === 0 && <p className="vc-chat-empty">No messages yet</p>}
                  {messages.map(msg => (
                    <div key={msg.id} className={cn('vc-chat-row', msg.userId === user?.id && 'mine')}>
                      {msg.userId !== user?.id && (
                        <div className="vc-chat-avatar">
                          {getAvatarUrl(msg.user.avatarUrl)
                            ? <img src={getAvatarUrl(msg.user.avatarUrl)} alt="" />
                            : <span>{msg.user.firstName[0]}</span>}
                        </div>
                      )}
                      <div className="vc-chat-bubble">
                        {msg.userId !== user?.id && <p className="vc-chat-sender">{msg.user.firstName}</p>}
                        <p className="vc-chat-text">{msg.body}</p>
                      </div>
                      {/* Delete button — visible on hover for host/mod or message author */}
                      {(amModerating || msg.userId === user?.id) && (
                        <button
                          className="vc-msg-delete"
                          title="Delete message"
                          onClick={async () => {
                            try { await api.delete(`/voice/${roomId}/messages/${msg.id}`) } catch {}
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                {activeRoom.commentsEnabled && activeRoom.messageType !== 'none' ? (
                  (() => {
                    // For followers-only rooms, check if current user follows the host
                    // HOST/MOD always can chat; the host themselves always can chat
                    const isHostOrMod = myParticipant?.role === VOICE_ROLES.HOST ||
                                        myParticipant?.role === VOICE_ROLES.MODERATOR
                    const isHost = myParticipant?.userId === activeRoom.hostId
                    const canChat = activeRoom.messageType !== 'followers' ||
                                    isHostOrMod ||
                                    isHost ||
                                    activeRoom.isFollowingHost === true

                    return canChat ? (
                      <div className="vc-chat-input-row">
                        <input
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage() } }}
                          placeholder={activeRoom.slowMode ? 'Slow mode on — 1 msg / 5s…' : 'Type a message…'}
                          className="vc-chat-input"
                        />
                        <button onClick={handleSendMessage} disabled={!chatInput.trim() || sendingMsg} className="vc-chat-send">
                          {sendingMsg ? '…' : '➤'}
                        </button>
                      </div>
                    ) : (
                      <div className="vc-chat-disabled">
                        👥 Only followers of the host can chat
                        <a
                          href={`/social/profile/${activeRoom.hostId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="vc-chat-follow-link"
                        >
                          Follow host →
                        </a>
                      </div>
                    )
                  })()
                ) : (
                  <div className="vc-chat-disabled">
                    🔇 Chat is disabled in this room
                  </div>
                )}
              </>
            )}

            {isHandQueueOpen && amModerating && (
              <div className="vc-hand-queue">
                {handQueue.length === 0
                  ? <p className="vc-chat-empty">No raised hands</p>
                  : handQueue.map(p => (
                    <div key={p.userId} className="vc-hand-row">
                      <div className="vc-hand-avatar">
                        {getAvatarUrl(p.user.avatarUrl)
                          ? <img src={getAvatarUrl(p.user.avatarUrl)} alt="" />
                          : <span>{p.user.firstName[0]}</span>}
                      </div>
                      <span className="vc-hand-name">{p.user.firstName} {p.user.lastName}</span>
                      <button
                        className={cn('vc-approve-btn', speakerLimitReached && 'disabled')}
                        onClick={() => handlePromote(p.userId)}
                        disabled={speakerLimitReached}
                      >
                        {speakerLimitReached ? '🔒 Full' : '✅ Approve'}
                      </button>
                    </div>
                  ))
                }
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unified emoji picker — custom stage reactions (top) + broadcast reactions (bottom) */}
      <AnimatePresence>
        {showEmojis && (
          <motion.div
            className="vc-emoji-picker"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
          >
            {/* Row 1 — custom emoji images (speakers only): appear on YOUR avatar circle */}
            {iCanSpeak && (
              <div className="vc-emoji-row vc-emoji-row-stage">
                <span className="vc-emoji-row-label">On stage</span>
                <div className="vc-emoji-row-items">
                  {MIC_EMOJIS.map((emoji, idx) => (
                    <button
                      key={emoji.id}
                      className="vc-emoji-btn vc-emoji-btn-img"
                      title={emoji.label}
                      onClick={() => {
                        triggerReaction(idx)
                        setShowEmojis(false)
                      }}
                    >
                      <img
                        src={emoji.src}
                        alt={emoji.label}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          const span = document.createElement('span')
                          span.textContent = emoji.unicode
                          e.currentTarget.parentElement?.appendChild(span)
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 2 — unicode reactions: float across the room for everyone */}
            <div className="vc-emoji-row">
              {iCanSpeak && <span className="vc-emoji-row-label">Room</span>}
              <div className="vc-emoji-row-items">
                {REACTIONS.map(e => (
                  <button key={e} className="vc-emoji-btn" onClick={() => handleReaction(e)}>{e}</button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite modal */}
      <AnimatePresence>
        {showInvite && (
          <motion.div className="vc-invite-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowInvite(false)}>
            <motion.div className="vc-invite-card" initial={{ scale: 0.85, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 40 }} onClick={e => e.stopPropagation()}>
              <h3 className="vc-invite-title">🎁 Invite to Room</h3>
              <p className="vc-invite-desc">Share this link — anyone with it can join directly</p>
              <div className="vc-invite-link">
                <span style={{ fontSize: 11, color: '#6b7280', wordBreak: 'break-all' }}>
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/voice-club/${activeRoom.id}`
                    : `/voice-club/${activeRoom.id}`}
                </span>
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      navigator.clipboard.writeText(`${window.location.origin}/voice-club/${activeRoom.id}`)
                    }
                  }}
                >
                  📋 Copy
                </button>
              </div>
              <button className="vc-invite-close" onClick={() => setShowInvite(false)}>Close</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Mic Context Popup Menu — rendered OUTSIDE bottom bar to escape overflow:hidden ── */}
      <AnimatePresence>
        {showMicMenu && (
          <>
            {/* Dismiss overlay */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 199 }}
              onClick={() => setShowMicMenu(false)}
            />
            <motion.div
              className="mic-menu-card"
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                bottom: 72, // above the bottom bar
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 200,
              }}
            >
              {/* Waiting List */}
              <button className="mic-menu-item" onClick={() => { setShowMicMenu(false); toggleWaitingList() }}>
                <span className="mic-menu-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                <span className="mic-menu-label">Waiting List</span>
                {speakerQueue.length > 0 && (
                  <span className="mic-menu-badge">{speakerQueue.length}</span>
                )}
              </button>

              <div className="mic-menu-divider" />

              {/* Turn Off Mic */}
              <button className="mic-menu-item" onClick={async () => {
                setShowMicMenu(false)
                await toggleMic().catch(() => {})
                await toggleMute().catch(() => {})
              }}>
                <span className="mic-menu-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </span>
                <span className="mic-menu-label">{isMicEnabled ? 'Turn Off Mic' : 'Turn On Mic'}</span>
              </button>

              <div className="mic-menu-divider" />

              {/* Mute Room */}
              <button className="mic-menu-item" onClick={() => {
                setShowMicMenu(false)
                const newMuted = !roomMuted
                setRoomMuted(newMuted)
                document.querySelectorAll<HTMLAudioElement>('audio[data-lk-source]').forEach(a => { a.muted = newMuted })
                document.dispatchEvent(new CustomEvent('vc:volume', { detail: newMuted ? 0 : volume / 100 }))
              }}>
                <span className="mic-menu-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {roomMuted ? (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <line x1="23" y1="9" x2="17" y2="15"/>
                        <line x1="17" y1="9" x2="23" y2="15"/>
                      </>
                    ) : (
                      <>
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                      </>
                    )}
                  </svg>
                </span>
                <span className="mic-menu-label">{roomMuted ? 'Unmute Room' : 'Mute Room'}</span>
              </button>

              <div className="mic-menu-divider" />

              {/* End Mic — danger red */}
              <button className="mic-menu-item mic-menu-item--danger" onClick={() => { setShowMicMenu(false); dropMic() }}>
                <span className="mic-menu-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                  </svg>
                </span>
                <span className="mic-menu-label">End Mic</span>
              </button>

              {/* Down arrow caret */}
              <div className="mic-menu-arrow" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom bar */}
      <div className="vc-bottom-bar" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        width: '100%', maxWidth: 'none', transform: 'none',
        display: 'flex', alignItems: 'center',
        overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'none',
        padding: '6px 0 10px', gap: 0,
        background: 'inherit',
      }}>

        {/* Shared style for all bar buttons */}
        {/* Mic control — context-aware per role */}
        {iCanSpeak ? (
          myParticipant?.role === VOICE_ROLES.SPEAKER ? (
            // ── Speaker: mic button (popup rendered outside bar as sibling)
            <button
              ref={micBtnRef}
              className={cn('vc-bar-btn', isMicEnabled ? 'active-mic' : '')}
              style={{ flex: '1 1 0', minWidth: 44 }}
              onClick={() => setShowMicMenu(v => !v)}
            >
              <span className="vc-bar-icon">{isMicEnabled ? '🎙️' : '🔇'}</span>
              <span className="vc-bar-label">Mic</span>
            </button>
          ) : (
            <button
              className={cn('vc-bar-btn', isMicEnabled ? 'active-mic' : '')}
              style={{ flex: '1 1 0', minWidth: 44 }}
              onClick={async () => {
                // If muted by moderator, self cannot unmute — show a hint instead
                if (myParticipant?.mutedByModerator && myParticipant.isMuted) {
                  return // button is visually locked; tooltip explains why
                }
                toggleMic().catch(() => {})
                toggleMute().catch(() => {})
              }}
              title={myParticipant?.mutedByModerator && myParticipant?.isMuted
                ? '🔒 Muted by moderator — only a host/mod can unmute you'
                : undefined}
            >
              <span className="vc-bar-icon">
                {myParticipant?.mutedByModerator && myParticipant?.isMuted
                  ? '🔒'
                  : isMicEnabled ? '🎙️' : '🔇'}
              </span>
              <span className="vc-bar-label">
                {myParticipant?.mutedByModerator && myParticipant?.isMuted
                  ? 'Mod Muted'
                  : isMicEnabled ? 'Mute' : 'Unmute'}
              </span>
            </button>
          )
        ) : speakerLimitReached ? (
          <button
            className={cn('vc-bar-btn', myParticipant?.handRaised ? 'active-hand' : '')}
            style={{ flex: '1 1 0', minWidth: 44, opacity: activeRoom.micLocked ? 0.5 : 1 }}
            disabled={activeRoom.micLocked ?? false}
            onClick={() => {
              if (activeRoom.micLocked) return
              if (myParticipant?.handRaised) { if (!isWaitingListOpen) toggleWaitingList() }
              else { grabMic() }
            }}
          >
            <span className="vc-bar-icon">
              {activeRoom.micLocked ? '🔒' : myParticipant?.handRaised ? '✋' : '🔒'}
            </span>
            <span className="vc-bar-label">
              {activeRoom.micLocked ? 'Locked' : myParticipant?.handRaised ? 'Waiting' : 'Stage Full'}
            </span>
          </button>
        ) : (
          <button
            className={cn('vc-bar-btn', activeRoom.micLocked ? '' : (myParticipant?.handRaised ? 'active-hand' : 'active-mic'))}
            style={{ flex: '1 1 0', minWidth: 44, opacity: activeRoom.micLocked ? 0.5 : 1 }}
            onClick={() => {
              if (activeRoom.micLocked) return
              if (myParticipant?.handRaised) { toggleWaitingList(); return }
              grabMic()
            }}
            disabled={activeRoom.micLocked ?? false}
            title={activeRoom.micLocked ? '🔒 Mic locked by host' : myParticipant?.handRaised ? 'View waiting list' : 'Take Mic'}
          >
            <span className="vc-bar-icon">
              {activeRoom.micLocked ? '🔒' : myParticipant?.handRaised ? '✋' : '🎙️'}
            </span>
            <span className="vc-bar-label">
              {activeRoom.micLocked ? 'Locked' : myParticipant?.handRaised ? 'Waiting' : 'Take Mic'}
            </span>
          </button>
        )}

        <button
          className={cn('vc-bar-btn', showEmojis && 'active-emoji')}
          style={{ flex: '1 1 0', minWidth: 44, opacity: (activeRoom.reactionsEnabled ?? true) ? 1 : 0.4 }}
          onClick={() => { if (activeRoom.reactionsEnabled ?? true) setShowEmojis(v => !v) }}
          title={(activeRoom.reactionsEnabled ?? true) ? 'React' : 'Reactions disabled'}
        >
          <span className="vc-bar-icon">🌹</span>
          <span className="vc-bar-label">React</span>
        </button>

        <button className={cn('vc-bar-btn', isChatOpen && 'active-chat')} style={{ flex: '1 1 0', minWidth: 44 }} onClick={toggleChat}>
          <span className="vc-bar-icon">💬</span>
          <span className="vc-bar-label">Chat</span>
        </button>

        <button
          className={cn('vc-bar-btn', (isWaitingListOpen || isHandQueueOpen) && 'active-hand')}
          style={{ flex: '1 1 0', minWidth: 44 }}
          onClick={() => { amModerating ? toggleHandQueue() : toggleWaitingList() }}
        >
          <span className="vc-bar-icon">🔲</span>
          <span className="vc-bar-label">Members</span>
          {amModerating && handQueue.length > 0 && (
            <span className="vc-bar-badge">{handQueue.length}</span>
          )}
          {!amModerating && speakerQueue.length > 0 && (
            <span className="vc-bar-badge">{speakerQueue.length}</span>
          )}
        </button>

        <button className="vc-bar-btn" style={{ flex: '1 1 0', minWidth: 44 }} onClick={() => setShowInvite(true)}>
          <span className="vc-bar-icon">📨</span>
          <span className="vc-bar-label">Invite</span>
        </button>

        <button
          className={cn('vc-bar-btn', isGiftPanelOpen && 'active-emoji')}
          style={{ flex: '1 1 0', minWidth: 44 }}
          onClick={toggleGiftPanel}
          title="Send a gift"
        >
          <span className="vc-bar-icon">🎁</span>
          <span className="vc-bar-label">Gift</span>
          {wallet !== null && wallet.coins > 0 && (
            <span className="vc-bar-badge" style={{ background: '#7c3aed' }}>
              {wallet.coins > 999 ? `${Math.floor(wallet.coins / 1000)}k` : wallet.coins}
            </span>
          )}
        </button>

        <button className="vc-bar-btn leave" style={{ flex: '1 1 0', minWidth: 44 }} onClick={handleLeave}>
          <span className="vc-bar-icon">📵</span>
          <span className="vc-bar-label">Leave</span>
        </button>

      </div>
    </div>
  )
}
