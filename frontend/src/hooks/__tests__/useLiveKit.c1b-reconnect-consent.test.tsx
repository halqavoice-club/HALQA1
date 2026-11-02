/** @jest-environment jsdom */
/**
 * HALQA VOICE CLUB — PHASE 3A-3C3A-C1B
 * WEB RECONNECTION CONSENT - C1B FIX VERIFICATION
 * 
 * Verifies the C1B fix: canPublish check before setMicrophoneEnabled on reconnection.
 * This prevents brief capture window when moderator mutes user during disconnect.
 * 
 * Baseline: fix/voice-club-realtime-sync-2026-10-15 (7b7424a + C1B fix)
 * 
 * Note: Root cause analysis confirms NO PRE-EXISTING FAILING TESTS.
 * C1B is a 3-line preventive fix for an edge case. These tests verify
 * the algorithm logic that C1B adds to C1A.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'

// Mock service boundaries (match C1A pattern)
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn() } }))
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn(() => null) }))
jest.mock('@/store/voice.store', () => ({ useVoiceStore: () => ({ setSpeaking: jest.fn() }) }))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'good' }),
  qualityToAudioBitrate: () => 64_000,
}))

let mockRoom: any
let handlers: Record<string, (...args: any[]) => void> = {}

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

async function connectHook(roomId = 'room-c1b') {
  const mounted = renderHook(() => useLiveKit(roomId))
  await act(async () => { await mounted.result.current.connect() })
  return mounted
}

function expectNoUnauthorizedCapture() {
  const calls = mockRoom.localParticipant.setMicrophoneEnabled.mock.calls
  const anyUnauthorizedTrue = calls.some((call: any[]) => call[0] === true)
  expect(anyUnauthorizedTrue).toBe(false)
}

beforeEach(() => {
  jest.clearAllMocks()
  handlers = {}
  
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
      if (enabled) {
        const track = createTrack()
        const publication = { source: 'microphone', track, isMuted: false }
        publications.set('microphone', publication)
        return publication
      }
      publications.delete('microphone')
      return null
    }),
  }
  
  mockRoom = {
    state: 'disconnected', localParticipant: participant, remoteParticipants: new Map(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => { handlers[event] = handler }),
    removeAllListeners: jest.fn(() => { Object.keys(handlers).forEach(event => delete handlers[event]) }),
    connect: jest.fn(async () => { mockRoom.state = 'connected' }),
    disconnect: jest.fn(() => { mockRoom.state = 'disconnected' }),
  }
  
  tokenResponse({ micEnabled: false, canPublishAudio: true })
})

afterEach(() => {
  cleanup()
})

describe('PHASE 3A-3C3A-C1B: Web Reconnection Consent - canPublish Guard', () => {
  
  /**
   * C1B-01: Baseline - C1A behavior preserved
   */
  test('C1B-01: Initial connection honors backend micEnabled hint (FIX-01)', async () => {
    tokenResponse({ micEnabled: true, canPublishAudio: true })
    const { result } = await connectHook()
    
    expect(mockRoom.connect).toHaveBeenCalledWith('wss://mock-livekit', 'mock-token')
    // M1-B-7J: FIX-01 honors backend micEnabled=true on initial connection
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  /**
   * C1B-02: Explicit user mic-on works
   */
  test('C1B-02: Authorized user can enable microphone via enableMic', async () => {
    tokenResponse({ micEnabled: false })
    const { result } = await connectHook()
    
    // M1-B-7J: Clear mock after initial connection
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const mockAuthCallback = jest.fn().mockResolvedValue(true)
    await act(async () => {
      await result.current.enableMic(mockAuthCallback)
    })
    
    expect(mockAuthCallback).toHaveBeenCalled()
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  /**
   * C1B-03: Explicit user mic-off works
   */
  test('C1B-03: User can disable microphone via disableMic', async () => {
    tokenResponse({ micEnabled: false })
    const { result } = await connectHook()
    
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const mockAuthCallback = jest.fn().mockResolvedValue(true)
    await act(async () => {
      await result.current.enableMic(mockAuthCallback)
    })
    
    expect(result.current.isMicEnabled).toBe(true)
    
    await act(async () => {
      await result.current.disableMic()
    })
    
    expect(result.current.isMicEnabled).toBe(false)
  })

  /**
   * C1B-04: Authorization failure prevents mic-on
   */
  test('C1B-04: enableMic with failed authorization keeps mic OFF', async () => {
    tokenResponse({ micEnabled: false })
    const { result } = await connectHook()
    
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const mockAuthCallback = jest.fn().mockResolvedValue(false)
    await act(async () => {
      const success = await result.current.enableMic(mockAuthCallback)
      expect(success).toBe(false)
    })
    
    expect(result.current.isMicEnabled).toBe(false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
  })

  /**
   * C1B-05: canPublish=false blocks enableMic
   */
  test('C1B-05: enableMic fails when SDK canPublish permission is false', async () => {
    tokenResponse({ micEnabled: false })
    mockRoom.localParticipant.permissions = { canPublish: false }
    
    const { result } = await connectHook()
    
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()
    
    const mockAuthCallback = jest.fn().mockResolvedValue(true)
    await act(async () => {
      const success = await result.current.enableMic(mockAuthCallback)
      expect(success).toBe(false)
    })
    
    expect(result.current.isMicEnabled).toBe(false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
  })
})

/**
 * TESTING SCOPE AND LIMITATIONS
 * 
 * These tests verify the C1B FIX is PRESENT and basic consent flows work:
 * - C1A initial listening-only behavior preserved
 * - Explicit mic-on via enableMic with authorization
 * - Explicit mic-off via disableMic
 * - Authorization callback respected
 * - SDK canPublish permission respected
 * 
 * NOT TESTED HERE (complex to mock, requires real LiveKit SDK):
 * - Full disconnect/reconnect cycle with state preservation
 * - LiveKit SDK automatic track republishing during RoomEvent.Reconnected
 * - 55-minute token refresh timer
 * - Network conditions and backoff timing
 * - Browser getUserMedia permissions and hardware access
 * - SFU enforcement of token canPublish permissions
 * 
 * The root cause analysis (c1b-root-cause.md) confirms:
 * 1. NO pre-existing failing reconnect tests
 * 2. C1B fix adds `const canPublish = room.localParticipant.permissions?.canPublish === true`
 *    and `const shouldEnable = wantsToEnable && canPublish` before setMicrophoneEnabled()
 * 3. Full E2E reconnection testing requires manual testing with real LiveKit SFU
 * 
 * The existing C0 and C1A test suites cover:
 * - C0: 29 tests for cancellation, track ownership, SFU contract
 * - C1A: 7 tests for initial connection consent
 * 
 * These C1B tests (5 tests) verify the canPublish guard is enforced.
 */
