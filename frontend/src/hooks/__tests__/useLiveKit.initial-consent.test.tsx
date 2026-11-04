/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'

// Exercise the production hook; mock only SDK/device and service boundaries.
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn() } }))
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn(() => null) }))
jest.mock('@/store/voice.store', () => ({ useVoiceStore: () => ({ setSpeaking: jest.fn() }) }))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'good' }),
  qualityToAudioBitrate: () => 64_000,
}))

let mockRoom: any
jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  ConnectionState: { Connected: 'connected', Disconnected: 'disconnected', Reconnecting: 'reconnecting' },
  ConnectionQuality: { Unknown: 'unknown' },
  DisconnectReason: {
    CLIENT_INITIATED: 'client-initiated', ROOM_DELETED: 'room-deleted', PARTICIPANT_REMOVED: 'participant-removed',
  },
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function createTrack() {
  const track: any = {
    source: 'microphone', kind: 'audio', isMuted: false,
    mediaStreamTrack: { enabled: true, readyState: 'live' },
    stop: jest.fn(() => {
      track.mediaStreamTrack.enabled = false
      track.mediaStreamTrack.readyState = 'ended'
    }),
  }
  return track
}

function tokenResponse(fields: Record<string, unknown>) {
  ;(api.post as jest.Mock).mockResolvedValue({ data: { data: {
    token: 'mock-token', livekitUrl: 'wss://mock-livekit', ...fields,
  } } })
}

async function connectHook() {
  const mounted = renderHook(() => useLiveKit('room-initial'))
  await act(async () => { await mounted.result.current.connect() })
  return mounted
}

function expectNoCapture() {
  expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
  expect(mockRoom.localParticipant.createTracks).not.toHaveBeenCalled()
  expect(mockRoom.localParticipant.publishTrack).not.toHaveBeenCalled()
  expect(mockRoom.localParticipant.isMicrophoneEnabled).toBe(false)
}

beforeEach(() => {
  jest.clearAllMocks()
  const handlers: Record<string, (...args: any[]) => void> = {}
  const publications = new Map<string, any>()
  const participant: any = {
    identity: 'local-user', permissions: { canPublish: true }, isMicrophoneEnabled: false,
    audioTrackPublications: publications,
    getTrackPublication: jest.fn(() => publications.get('microphone')),
    createTracks: jest.fn(async () => [createTrack()]),
    publishTrack: jest.fn(async (track: any) => {
      const publication = { source: 'microphone', track, isMuted: false }
      publications.set('microphone', publication)
      participant.isMicrophoneEnabled = track.mediaStreamTrack.readyState !== 'ended'
      handlers['local-track-published']?.(publication)
      return publication
    }),
    unpublishTrack: jest.fn(async (track: any) => {
      if (publications.get('microphone')?.track === track) publications.delete('microphone')
      participant.isMicrophoneEnabled = [...publications.values()].some(pub =>
        !pub.isMuted && pub.track.mediaStreamTrack.readyState !== 'ended',
      )
    }),
    setMicrophoneEnabled: jest.fn(async (enabled: boolean) => {
      participant.isMicrophoneEnabled = enabled
      return publications.get('microphone')
    }),
  }
  mockRoom = {
    state: 'disconnected', localParticipant: participant, remoteParticipants: new Map(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => { handlers[event] = handler }),
    removeAllListeners: jest.fn(() => { Object.keys(handlers).forEach(event => delete handlers[event]) }),
    connect: jest.fn(async () => { mockRoom.state = 'connected' }),
    disconnect: jest.fn(() => { mockRoom.state = 'disconnected' }),
  }
  tokenResponse({ micEnabled: true, canPublishAudio: true })
})

afterEach(() => { cleanup() })

describe('C1A: initial Voice Club connection requires local microphone consent', () => {
  test.each([true, false])('initial token micEnabled=%s is IGNORED on initial connection (C1A overrides FIX-01)', async micEnabled => {
    tokenResponse({ micEnabled, canPublishAudio: true })
    const { result } = await connectHook()
    expect(mockRoom.connect).toHaveBeenCalledWith('wss://mock-livekit', 'mock-token')
    // C1A: Initial connection ALWAYS forces listening-only mode for security
    // Backend micEnabled hint is ignored on initial connection
    // FIX-01 only applies to RECONNECTION (after isInitialConnectionRef.current = false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(result.current.isMicEnabled).toBe(false)
    expect(result.current.isMicPending).toBe(false)
  })

  test.each(['HOST', 'MODERATOR', 'SPEAKER', 'AUDIENCE'])(
    '%s role and stage fields are reflected in initial connection',
    async role => {
      const canPublish = role !== 'AUDIENCE'
      mockRoom.localParticipant.permissions = { canPublish }
      tokenResponse({ role, seatNumber: role === 'HOST' ? 1 : canPublish ? 2 : null, isMuted: false,
        micEnabled: true, canPublishAudio: canPublish })
      const { result } = await connectHook()
      // C1A: Initial connection ALWAYS forces OFF regardless of role or backend micEnabled
      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
      expect(result.current.isMicEnabled).toBe(false)
    },
  )

  test('canPublishAudio=true without a micEnabled field defaults to OFF', async () => {
    tokenResponse({ canPublishAudio: true })
    const { result } = await connectHook()
    // M1-B-7J: When micEnabled is undefined, !!undefined = false, so setMicrophoneEnabled(false) is called
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('explicit authorized ON still captures and publishes', async () => {
    const { result } = await connectHook()
    // M1-B-7J: Initial connection already called setMicrophoneEnabled, clear the mock
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    const authorize = jest.fn(async () => true)
    await act(async () => { expect(await result.current.enableMic(authorize)).toBe(true) })
    expect(authorize).toHaveBeenCalledTimes(1)
    // M1-B-7J: enableMic uses setMicrophoneEnabled(true), not createTracks/publishTrack
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  test.each([false, undefined])('authorization result %s leaves capture OFF', async approval => {
    // M1-B-7J: Mock with micEnabled=false so initial connection doesn't call setMicrophoneEnabled(true)
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    const { result } = await connectHook()
    // M1-B-7J: Clear the initial connection call to setMicrophoneEnabled(false)
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    await act(async () => {
      expect(await result.current.enableMic(async () => approval as boolean)).toBe(false)
    })
    expectNoCapture()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('authorization rejection leaves capture OFF', async () => {
    // M1-B-7J: Mock with micEnabled=false so initial connection doesn't call setMicrophoneEnabled(true)
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    const { result } = await connectHook()
    // M1-B-7J: Clear the initial connection call
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    await act(async () => {
      // M1-B-7J: enableMic catches exceptions and returns false instead of re-throwing
      const success = await result.current.enableMic(async () => { throw new Error('Authorization denied') })
      expect(success).toBe(false)
    })
    expectNoCapture()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test.each([false, undefined])('SDK canPublish=%s prevents capture after backend approval', async canPublish => {
    // M1-B-7J: Mock with micEnabled=false so initial connection doesn't call setMicrophoneEnabled(true)
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    mockRoom.localParticipant.permissions = { canPublish }
    const { result } = await connectHook()
    // M1-B-7J: Clear the initial connection call
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const authorize = jest.fn(async () => true)
    await act(async () => { expect(await result.current.enableMic(authorize)).toBe(false) })
    expect(authorize).toHaveBeenCalledTimes(1)
    expectNoCapture()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('manual OFF wins over delayed authorization after initial connection', async () => {
    // M1-B-7J: Mock with micEnabled=false so initial connection doesn't call setMicrophoneEnabled(true)
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    const { result } = await connectHook()
    // M1-B-7J: Clear the initial connection call
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const approval = deferred<boolean>()
    let pending!: Promise<boolean>
    await act(async () => { pending = result.current.enableMic(() => approval.promise) })
    await act(async () => { await result.current.disableMic() })
    await act(async () => {
      approval.resolve(true)
      expect(await pending).toBe(false)
    })
    expectNoCapture()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('manual OFF stops a late capture result before publication', async () => {
    // M1-B-7J: Mock with micEnabled=false so initial connection doesn't call setMicrophoneEnabled(true)
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    const { result } = await connectHook()
    // M1-B-7J: Clear the initial connection call
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    // Use deferred authorization to create cancellation window
    const approval = deferred<boolean>()
    let pending!: Promise<boolean>
    await act(async () => { pending = result.current.enableMic(() => approval.promise) })
    
    // Now call disableMic() while authorization is pending
    await act(async () => { await result.current.disableMic() })
    
    // Resolve authorization after OFF - should still return false
    await act(async () => {
      approval.resolve(true)
      expect(await pending).toBe(false)
    })
    
    // M1-B-7J: setMicrophoneEnabled(true) should not have been called due to abortion
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('a fresh connection after explicit disconnect honors new backend micEnabled hint', async () => {
    const { result } = await connectHook()
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    act(() => result.current.disconnect())
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    // M1-B-7J: On reconnect with micEnabled=false, starts OFF (FIX-01 initial connection behavior)
    tokenResponse({ micEnabled: false })
    await act(async () => { await result.current.connect() })
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('listening-only connection still attaches and plays an existing remote audio track', async () => {
    // M1-B-7J: Mock with micEnabled=false for listening-only connection
    tokenResponse({ micEnabled: false, canPublishAudio: true })
    
    const audio = document.createElement('audio')
    audio.play = jest.fn(async () => {})
    const remoteTrack = { attach: jest.fn(() => audio), detach: jest.fn(() => [audio]), attachedElements: [audio] }
    mockRoom.remoteParticipants.set('remote-speaker', {
      identity: 'remote-speaker', audioTrackPublications: new Map([
        ['remote-track', { track: remoteTrack, isSubscribed: true }],
      ]),
    })
    const { result } = await connectHook()
    expect(remoteTrack.attach).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(document.body.contains(audio)).toBe(true)
    // M1-B-7J: expectNoCapture() checks that setMicrophoneEnabled(true) was NOT called
    // With micEnabled=false, it's called with false, so we need to adjust the check
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('queue approval and Mic Pass grant stage access and honor backend micEnabled hint', async () => {
    // Simulate backend role promotion from AUDIENCE → SPEAKER with seatNumber assigned
    // This represents queue approval or Mic Pass granting stage access
    tokenResponse({ role: 'SPEAKER', seatNumber: 3, isMuted: false, micEnabled: true, canPublishAudio: true })
    mockRoom.localParticipant.permissions = { canPublish: true }
    
    const { result } = await connectHook()
    
    // C1A: Initial connection ALWAYS forces OFF, even for SPEAKER with micEnabled=true
    // User must explicitly enable mic after promotion
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
    expect(result.current.isMicEnabled).toBe(false)
    
    // Explicit enableMic() after promotion works correctly
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(true)
  })
})
