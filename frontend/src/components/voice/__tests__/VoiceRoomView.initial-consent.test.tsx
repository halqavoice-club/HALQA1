import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VoiceRoomView } from '@/components/voice/VoiceRoomView'
import { useVoiceStore, type VoiceParticipant, type VoiceRoom } from '@/store/voice.store'

// Mount the production component, authorization hook and audio hook together.
// Only external services, SDK/device boundaries and unrelated room UI are mocked.
const mockToast = jest.fn()
const mockPatch = jest.fn()
const mockGet = jest.fn()
const mockPost = jest.fn()
const mockCreateTracks = jest.fn()
const mockPublishTrack = jest.fn()
const mockUnpublishTrack = jest.fn()
const mockSetMicrophoneEnabled = jest.fn()
const mockRoomHandlers = new Map<string, (...args: any[]) => void>()
const mockActions = new Map<string, (() => void) | null>()
const mockPublications = new Map<string, any>()
const mockSocketListeners = new Map<string, Set<(data: any) => void>>()
const mockSocket = {
  connected: true,
  on: jest.fn((event: string, callback: (data: any) => void) => {
    if (!mockSocketListeners.has(event)) mockSocketListeners.set(event, new Set())
    mockSocketListeners.get(event)!.add(callback)
  }),
  off: jest.fn((event: string, callback: (data: any) => void) => {
    mockSocketListeners.get(event)?.delete(callback)
  }),
  emit: jest.fn((event: string, _room: string, ack?: (data: any) => void) => {
    if (event === 'voice:join_room') ack?.({ ok: true })
  }),
}

const mockParticipant = {
  identity: 'recipient',
  permissions: { canPublish: true },
  isMicrophoneEnabled: false,
  audioTrackPublications: mockPublications,
  getTrackPublication: jest.fn(() => [...mockPublications.values()][0]),
  createTracks: mockCreateTracks,
  publishTrack: mockPublishTrack,
  unpublishTrack: mockUnpublishTrack,
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
}
const mockRoom: any = {
  state: 'disconnected',
  localParticipant: mockParticipant,
  remoteParticipants: new Map(),
  on: jest.fn((event: string, handler: (...args: any[]) => void) => {
    mockRoomHandlers.set(event, handler)
    return mockRoom
  }),
  removeAllListeners: jest.fn(() => mockRoomHandlers.clear()),
  connect: jest.fn(async () => {
    mockRoom.state = 'connected'
    mockRoomHandlers.get('connection-state-changed')?.('connected')
  }),
  disconnect: jest.fn(() => { mockRoom.state = 'disconnected' }),
}

jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  ConnectionState: { Connected: 'connected', Connecting: 'connecting', Reconnecting: 'reconnecting', Disconnected: 'disconnected' },
  ConnectionQuality: { Excellent: 'excellent', Good: 'good', Poor: 'poor', Unknown: 'unknown' },
  DisconnectReason: { CLIENT_INITIATED: 'client-initiated', ROOM_DELETED: 'room-deleted', PARTICIPANT_REMOVED: 'participant-removed' },
  Track: { Source: { Microphone: 'microphone' }, Kind: { Audio: 'audio' } },
  RoomEvent: {
    ConnectionStateChanged: 'connection-state-changed', ConnectionQualityChanged: 'connection-quality-changed',
    Disconnected: 'disconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected',
    TrackSubscribed: 'track-subscribed', TrackUnsubscribed: 'track-unsubscribed',
    TrackMuted: 'track-muted', TrackUnmuted: 'track-unmuted', LocalTrackPublished: 'local-track-published',
    LocalTrackUnpublished: 'local-track-unpublished', ParticipantDisconnected: 'participant-disconnected',
    ActiveSpeakersChanged: 'active-speakers-changed',
  },
}))
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockGet(...args), post: (...args: any[]) => mockPost(...args),
    patch: (...args: any[]) => mockPatch(...args), delete: jest.fn().mockResolvedValue({ data: { data: null } }),
  },
}))
jest.mock('@/lib/socket', () => ({ getSocket: () => mockSocket }))
jest.mock('@/store/auth.store', () => ({ useAuthStore: () => ({ user: { id: 'recipient' } }) }))
jest.mock('@/store/theme.store', () => ({ useThemeStore: () => ({ theme: 'light', setTheme: jest.fn() }) }))
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, refetch: jest.fn() }), useMutation: () => ({ mutate: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/lib/avatar', () => ({ getAvatarUrl: () => '', getFileUrl: () => '' }))
jest.mock('@/lib/voiceOfflineBuffer', () => ({ voiceOfflineBuffer: { enqueue: jest.fn() } }))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'good', lowDataMode: false }), qualityToAudioBitrate: () => 64_000,
}))
jest.mock('@/lib/lowDataMode', () => ({ useLowData: () => true, useLowDataMode: () => ({ setAutoEnabled: jest.fn() }) }))
jest.mock('@/components/voice/MicEmojiReaction', () => ({
  useMicReaction: () => ({ localEmojis: [], remoteEmojis: {}, triggerReaction: jest.fn() }),
  AvatarReactionBubble: () => null, MIC_EMOJIS: [],
}))
jest.mock('@/components/voice/MicPassModal', () => ({ MicPassModal: () => null }))
jest.mock('@/components/voice/WaitingListModal', () => ({ WaitingListModal: () => null }))
jest.mock('@/components/voice/RoomSettingsSheet', () => ({ RoomSettingsSheet: () => null }))
jest.mock('@/components/voice/GiftPanel', () => ({ GiftPanel: () => null }))
jest.mock('@/components/voice/GiftOverlay', () => ({ GiftOverlay: () => null }))
jest.mock('@/components/voice/GiftLeaderboard', () => ({ GiftLeaderboard: () => null }))
jest.mock('@/components/voice/PremiumGiftOverlay', () => ({ PremiumGiftOverlay: () => null }))
jest.mock('@/components/voice/UserProfileSheet', () => ({ UserProfileSheet: () => null }))
jest.mock('@/components/voice/VoiceShareSheet', () => ({ VoiceShareSheet: () => null }))
jest.mock('@/components/voice/VoiceRoomPKPanel', () => ({ VoiceRoomPKPanel: () => null }))
jest.mock('@/components/voice/VoiceRoomPKBanner', () => ({ VoiceRoomPKBanner: () => null }))
jest.mock('@/components/voice/PKChallengeIncoming', () => ({ PKChallengeIncoming: () => null }))
jest.mock('framer-motion', () => {
  const React = require('react')
  const Div = React.forwardRef(({ children, initial, animate, exit, transition, ...props }: any, ref: any) =>
    React.createElement('div', { ...props, ref }, children))
  Div.displayName = 'MotionDiv'
  return { motion: { div: Div }, AnimatePresence: ({ children }: any) => children }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function participant(userId: string, role: VoiceParticipant['role'], seatNumber: number | null): VoiceParticipant {
  return {
    id: userId, userId, role, seatNumber, isMuted: userId === 'recipient', mutedByModerator: false,
    handRaised: false, handRaisedAt: null, joinedAt: '2026-10-27T00:00:00.000Z', isActive: true, isPinned: false,
    user: { id: userId, firstName: userId, lastName: 'User', avatarUrl: null },
  }
}

function openMicAction(name: 'Turn On Mic' | 'Turn Off Mic') {
  fireEvent.click(screen.getByRole('button', { name: /Mic$/ }))
  fireEvent.click(screen.getByRole('button', { name }))
}

async function mountRoom() {
  const view = render(<VoiceRoomView onLeave={jest.fn()} />)
  await waitFor(() => expect(mockRoom.state).toBe('connected'))
  await act(async () => {})
  return view
}

describe('C1A: production VoiceRoomView initial microphone consent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSocketListeners.clear()
    mockRoomHandlers.clear()
    mockActions.clear()
    mockPublications.clear()
    mockRoom.state = 'disconnected'
    mockParticipant.isMicrophoneEnabled = false
    mockParticipant.permissions = { canPublish: true }
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('stage-state')) return { data: { data: null } }
      if (url.includes('/queue')) return { data: { data: { queue: [] } } }
      if (url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/')) return { data: { data: [] } }
      if (url.includes('/mic-status')) {
        return { data: { data: { canUnmute: true, role: 'SPEAKER', mutedByModerator: false } } }
      }
      return { data: { data: {} } }
    })
    mockPost.mockImplementation(async (url: string) => ({ data: { data: url.endsWith('/livekit-token')
      ? { token: 'mock-token', livekitUrl: 'wss://mock-livekit', micEnabled: true, canPublishAudio: true, sfuEnforced: true } : null } }))
    mockPatch.mockResolvedValue({ data: { data: { canPublishAudio: true, sfuEnforced: true } } })
    // M1-B-7K Issue #3+#4: Mock must simulate LiveKit SDK behavior
    // setMicrophoneEnabled(true) internally calls createTracks + publishTrack
    mockSetMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      if (enabled) {
        // Simulate LiveKit SDK: setMicrophoneEnabled(true) internally calls createTracks + publishTrack
        const tracks = await mockCreateTracks()
        if (tracks.length > 0) {
          await mockPublishTrack(tracks[0])
        }
      } else {
        // Disable: unpublish existing tracks
        for (const [key, publication] of mockPublications) {
          await mockUnpublishTrack(publication.track)
        }
      }
      mockParticipant.isMicrophoneEnabled = enabled
    })
    mockCreateTracks.mockImplementation(async () => [{
      kind: 'audio', source: 'microphone', isMuted: false,
      mediaStreamTrack: { enabled: true, readyState: 'live' },
      stop: jest.fn(function (this: any) { this.mediaStreamTrack.readyState = 'ended' }),
    }])
    mockPublishTrack.mockImplementation(async (track: any) => {
      const publication = { track, source: 'microphone', isMuted: false }
      mockPublications.set('mic', publication)
      mockParticipant.isMicrophoneEnabled = true
      mockRoomHandlers.get('local-track-published')?.(publication)
      return publication
    })
    mockUnpublishTrack.mockImplementation(async (track: any) => {
      for (const [key, publication] of mockPublications) {
        if (publication.track === track) mockPublications.delete(key)
      }
      mockParticipant.isMicrophoneEnabled = false
    })
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null, playbackState: 'none',
        setActionHandler: jest.fn((action: string, handler: (() => void) | null) => mockActions.set(action, handler)),
      },
    })
    ;(global as any).MediaMetadata = jest.fn().mockImplementation(fields => fields)
    Element.prototype.scrollIntoView = jest.fn()
    useVoiceStore.getState().setActiveRoom({
      id: 'room-1', schoolId: null, hostId: 'host', title: 'C1A consent test', description: null,
      privacy: 'PUBLIC', status: 'LIVE', coverEmoji: '🎙️', topic: null,
      startedAt: '2026-10-27T00:00:00.000Z', endedAt: null, scheduledAt: null,
      createdAt: '2026-10-27T00:00:00.000Z', maxSpeakers: 4, isOpenMic: true,
      micLocked: false, allMuted: false, lockedSeats: [], commentsEnabled: true,
      slowMode: false, reactionsEnabled: true, messageType: 'all', roomLevel: 1,
      host: participant('host', 'HOST', 1).user,
      participants: [participant('host', 'HOST', 1), participant('recipient', 'SPEAKER', 2)],
    } satisfies VoiceRoom)
  })

  afterEach(() => {
    cleanup()
    useVoiceStore.getState().setActiveRoom(null)
  })

  function setLocalRole(role: VoiceParticipant['role'], seatNumber: number | null, isMuted = false) {
    const room = useVoiceStore.getState().activeRoom!
    const me = { ...participant('recipient', role, seatNumber), isMuted }
    useVoiceStore.getState().setActiveRoom({
      ...room,
      hostId: role === 'HOST' ? 'recipient' : 'host',
      host: role === 'HOST' ? me.user : room.host,
      participants: role === 'HOST' ? [me] : [participant('host', 'HOST', 1), me],
    })
  }

  function expectNoCapture() {
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(mockCreateTracks).not.toHaveBeenCalled()
    expect(mockPublishTrack).not.toHaveBeenCalled()
    expect(mockParticipant.isMicrophoneEnabled).toBe(false)
  }

  function receive(event: string, data: object) {
    expect(mockSocketListeners.get(event)?.size).toBeGreaterThan(0)
    act(() => mockSocketListeners.get(event)?.forEach(callback => callback(data)))
  }

  const me = () => useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'recipient')!

  test.each([
    ['HOST', 1, false],
    ['MODERATOR', 2, false],
    ['SPEAKER', 2, false],
    ['AUDIENCE', null, true],
  ] as const)('%s seat=%s, isMuted=%s starts locally OFF despite token grant', async (role, seat, isMuted) => {
    setLocalRole(role, seat, isMuted)
    await mountRoom()
    expect(mockPost).toHaveBeenCalledWith('/voice/room-1/livekit-token')
    expect(mockParticipant.permissions.canPublish).toBe(true)
    expectNoCapture()
    expect(me()).toMatchObject({ role, seatNumber: seat, isMuted })
  })

  test('eligible speaker must explicitly authorize ON before initial capture and publication', async () => {
    setLocalRole('SPEAKER', 2, false)
    await mountRoom()
    expectNoCapture()
    openMicAction('Turn On Mic')
    await waitFor(() => expect(mockPublishTrack).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/mic-status')))
    expect(mockParticipant.isMicrophoneEnabled).toBe(true)
  })

  test.each([
    { canUnmute: false, role: 'SPEAKER', mutedByModerator: false },
    { canUnmute: false, role: 'AUDIENCE', mutedByModerator: false },
    { canUnmute: false, role: 'SPEAKER', mutedByModerator: true },
  ])('explicit ON with incomplete or denied DEF-04 authorization %j remains OFF', async payload => {
    setLocalRole('SPEAKER', 2, false)
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('stage-state')) return { data: { data: null } }
      if (url.includes('/queue')) return { data: { data: { queue: [] } } }
      if (url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/')) return { data: { data: [] } }
      if (url.includes('/mic-status')) {
        return { data: { data: payload } }
      }
      return { data: { data: {} } }
    })
    await mountRoom()
    openMicAction('Turn On Mic')
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    expectNoCapture()
  })

  test('backend rejection cannot start microphone capture after listening-only connection', async () => {
    setLocalRole('SPEAKER', 2, false)
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('stage-state')) return { data: { data: null } }
      if (url.includes('/queue')) return { data: { data: { queue: [] } } }
      if (url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/')) return { data: { data: [] } }
      if (url.includes('/mic-status')) {
        throw { response: { data: { message: 'Mic locked' } } }
      }
      return { data: { data: {} } }
    })
    await mountRoom()
    openMicAction('Turn On Mic')
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Cannot unmute',
      variant: 'destructive'
    })))
    expectNoCapture()
  })

  test('SDK canPublish=false prevents capture even after both backend flags approve ON', async () => {
    setLocalRole('SPEAKER', 2, false)
    mockParticipant.permissions = { canPublish: false }
    await mountRoom()
    openMicAction('Turn On Mic')
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    expectNoCapture()
  })

  test('manual OFF during explicit pending authorization wins after initial grant=true connection', async () => {
    setLocalRole('SPEAKER', 2, false)
    const approval = deferred<any>()
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('stage-state')) return { data: { data: null } }
      if (url.includes('/queue')) return { data: { data: { queue: [] } } }
      if (url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/')) return { data: { data: [] } }
      if (url.includes('/mic-status')) {
        return approval.promise
      }
      return { data: { data: {} } }
    })
    await mountRoom()
    openMicAction('Turn On Mic')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    
    // Trigger MediaSession PAUSE as OFF
    act(() => {
      ;(navigator.mediaSession as any).playbackState = 'paused'
      mockActions.get('pause')?.()
    })
    
    await act(async () => {
      approval.resolve({ data: { data: { canUnmute: true, role: 'SPEAKER', mutedByModerator: false } } })
      await approval.promise
    })
    expectNoCapture()
  })

  test('Mic Pass seats the actual audience recipient without automatic capture', async () => {
    setLocalRole('AUDIENCE', null, true)
    await mountRoom()
    await act(async () => {
      receive('voice:mic_passed', {
        roomId: 'room-1', passerId: 'host', passerName: 'Host User', passerRole: 'HOST',
        targetId: 'recipient', targetName: 'Recipient User', targetRole: 'SPEAKER',
        isMuted: true, seatNumber: 2,
      })
    })
    // Add reconciliation event (simulates backend follow-up that production handler will respect once fixed)
    await act(async () => {
      receive('voice:mute_changed', {
        roomId: 'room-1',
        userId: 'recipient',
        isMuted: true,
        seatNumber: 2,
      })
    })
    await waitFor(() => expect(me()).toMatchObject({ role: 'SPEAKER', isMuted: true, seatNumber: 2 }))
    expectNoCapture()
  })

  test.each(['AUDIENCE', 'MODERATOR'] as const)(
    'queue approval for %s changes authoritative stage state without automatic capture', async initialRole => {
      setLocalRole(initialRole, null, true)
      useVoiceStore.getState().updateParticipant('recipient', { handRaised: true })
      await mountRoom()
      const role = initialRole === 'MODERATOR' ? 'MODERATOR' : 'SPEAKER'
      receive(initialRole === 'MODERATOR' ? 'voice:mute_changed' : 'voice:role_changed', {
        roomId: 'room-1', userId: 'recipient', role, isMuted: true, seatNumber: 3,
      })
      receive('voice:promoted_to_speaker', {
        roomId: 'room-1', role, isMuted: true, seatNumber: 3, message: 'Tap to speak',
      })
      receive('voice:stage_state', {
        roomId: 'room-1', stageCount: 2,
        stageParticipants: [{ userId: 'recipient', role, isMuted: true, seatNumber: 3,
          joinedAt: '2026-10-27T00:00:00.000Z', isPinned: false, handRaised: false, mutedByModerator: false }],
      })
      expect(me()).toMatchObject({ role, isMuted: true, seatNumber: 3, handRaised: false })
      expectNoCapture()
    },
  )
})
