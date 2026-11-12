/**
 * PHASE 3A-3C3A-FIX: Web Reconnection Consent Tests
 * 
 * Verifies FIX-01 (reconnection preserves local mic intent) and
 * FIX-03 (MediaSession play does not activate mic).
 * 
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'
import { ConnectionState, RoomEvent, Track } from 'livekit-client'

jest.mock('@/lib/api')
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn(() => null) }))
jest.mock('@/store/voice.store', () => ({
  useVoiceStore: jest.fn(() => ({ setSpeaking: jest.fn() })),
}))

// Mock livekit-client Room
const mockSetMicrophoneEnabled = jest.fn().mockResolvedValue(undefined)
const mockConnect = jest.fn().mockResolvedValue(undefined)
const mockDisconnect = jest.fn()
const mockOn = jest.fn()
const mockRemoveAllListeners = jest.fn()

const mockLocalParticipant = {
  identity: 'test-user',
  setMicrophoneEnabled: mockSetMicrophoneEnabled,
  isMicrophoneEnabled: false,
  permissions: { canPublish: true },
}

const mockRoom = {
  state: ConnectionState.Connected,
  localParticipant: mockLocalParticipant,
  remoteParticipants: new Map(),
  on: mockOn,
  removeAllListeners: mockRemoveAllListeners,
  disconnect: mockDisconnect,
  connect: mockConnect,
}

let eventHandlers: Record<string, Function> = {}

jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  RoomEvent: {
    ConnectionStateChanged: 'connection-state-changed',
    Disconnected: 'disconnected',
    Reconnected: 'reconnected',
    Reconnecting: 'reconnecting',
    TrackSubscribed: 'track-subscribed',
    TrackUnsubscribed: 'track-unsubscribed',
    TrackMuted: 'track-muted',
    TrackUnmuted: 'track-unmuted',
    LocalTrackPublished: 'local-track-published',
    LocalTrackUnpublished: 'local-track-unpublished',
    ParticipantDisconnected: 'participant-disconnected',
    ActiveSpeakersChanged: 'active-speakers-changed',
    ConnectionQualityChanged: 'connection-quality-changed',
  },
  ConnectionState: {
    Connected: 'connected',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
  },
  ConnectionQuality: {
    Unknown: 'unknown',
    Excellent: 'excellent',
    Good: 'good',
    Poor: 'poor',
  },
  Track: {
    Source: {
      Microphone: 'microphone',
    },
    Kind: {
      Audio: 'audio',
    },
  },
  DisconnectReason: {
    CLIENT_INITIATED: 'client-initiated',
    ROOM_DELETED: 'room-deleted',
    PARTICIPANT_REMOVED: 'participant-removed',
  },
}))

describe('useLiveKit — FIX-01: Reconnection Consent Preservation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    eventHandlers = {}
    mockOn.mockImplementation((event: string, handler: Function) => {
      eventHandlers[event] = handler
    })
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: false,
        },
      },
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  test('Initial connection ignores backend micEnabled=true hint (C1A policy)', async () => {
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: true,
        },
      },
    })

    const { result } = renderHook(() => useLiveKit('room-123'))

    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => {
      // C1A: Initial connection ALWAYS starts listening-only, ignoring backend hint
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })

  test('Initial connection with backend micEnabled=false also starts OFF', async () => {
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: false,
        },
      },
    })

    const { result } = renderHook(() => useLiveKit('room-123'))

    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => {
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })

  test('Reconnection preserves user explicit OFF intent', async () => {
    const { result } = renderHook(() => useLiveKit('room-123'))

    // Initial connect (micEnabled=false)
    await act(async () => {
      await result.current.connect()
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connection-state-changed']?.(ConnectionState.Connected)
    })

    // User explicitly disables mic
    mockLocalParticipant.isMicrophoneEnabled = false
    await act(async () => {
      await result.current.disableMic()
    })

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)

    // Clear the mock to track next call
    mockSetMicrophoneEnabled.mockClear()

    // Simulate disconnect → auto-reconnect (not user-initiated)
    await act(async () => {
      mockRoom.state = ConnectionState.Disconnected // Update room state to allow reconnection
      eventHandlers['disconnected']?.() // undefined reason = not user-initiated
    })

    // Wait for auto-reconnect timer
    await act(async () => {
      jest.advanceTimersByTime(1500)
    })

    // Reconnect completes
    await act(async () => {
      await result.current.connect()
      mockRoom.state = ConnectionState.Connected // Update room state after reconnection
    })

    // Trigger reconnected event (in addition to connection-state-changed)
    await act(async () => {
      eventHandlers['reconnected']?.()
    })

    // Trigger connection state changed event
    await act(async () => {
      eventHandlers['connection-state-changed']?.(ConnectionState.Connected)
    })

    // Advance timers to let any pending effects run
    await act(async () => {
      jest.advanceTimersByTime(500)
    })

    // Wait for mic state to be set
    await waitFor(() => {
      // Check state first - this causes waitFor to retry until state updates
      expect(result.current.isMicEnabled).toBe(false)
      // Then verify the SDK method was called
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
    }, { timeout: 2000 })
  })

  test('Reconnection preserves user explicit ON intent (active speaker continuity)', async () => {
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: false, // Start muted
        },
      },
    })

    const { result } = renderHook(() => useLiveKit('room-123'))

    // Initial connect
    await act(async () => {
      await result.current.connect()
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connection-state-changed']?.(ConnectionState.Connected)
    })

    // User explicitly enables mic
    mockLocalParticipant.isMicrophoneEnabled = true
    await act(async () => {
      await result.current.enableMic(async () => true)
    })

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true)

    // Clear the mock
    mockSetMicrophoneEnabled.mockClear()

    // Simulate network blip → auto-reconnect
    await act(async () => {
      mockRoom.state = ConnectionState.Disconnected // Update room state to allow reconnection
      eventHandlers['disconnected']?.() // Network error
    })

    // Wait for auto-reconnect
    await act(async () => {
      jest.advanceTimersByTime(1500)
    })

    // Reconnect completes
    await act(async () => {
      await result.current.connect()
      mockRoom.state = ConnectionState.Connected // Update room state after reconnection
    })

    // Trigger reconnected event (in addition to connection-state-changed)
    await act(async () => {
      eventHandlers['reconnected']?.()
    })

    // Trigger connection state changed event
    await act(async () => {
      eventHandlers['connection-state-changed']?.(ConnectionState.Connected)
    })

    // Advance timers to let any pending effects run
    await act(async () => {
      jest.advanceTimersByTime(500)
    })

    // Wait for mic state
    await waitFor(() => {
      // Check state first - this causes waitFor to retry until state updates
      expect(result.current.isMicEnabled).toBe(true)
      // Then verify the SDK method was called
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true)
    }, { timeout: 2000 })
  })

  test('Token refresh reconnection uses new backend hint', async () => {
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: true,
        },
      },
    })

    const { result } = renderHook(() => useLiveKit('room-123'))

    // Initial connect with mic enabled
    await act(async () => {
      await result.current.connect()
    })

    // User was speaking
    mockLocalParticipant.isMicrophoneEnabled = true
    await act(async () => {
      await result.current.enableMic(async () => true)
    })

    // Moderator mutes user in backend (DB isMuted=true)
    // Next token fetch returns micEnabled=false
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'new-token-after-mute',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: false, // Backend now says muted
        },
      },
    })

    mockSetMicrophoneEnabled.mockClear()

    // Token refresh triggers disconnect (simulate 55-minute timer)
    await act(async () => {
      result.current.disconnect() // Explicit disconnect for token refresh
    })

    // Reconnect with fresh token
    await act(async () => {
      await result.current.connect()
    })

    // Should honor the NEW backend hint (micEnabled=false)
    await waitFor(() => {
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })

  test('Explicit disconnect resets isInitialConnectionRef', async () => {
    const { result } = renderHook(() => useLiveKit('room-123'))

    // First connection
    await act(async () => {
      await result.current.connect()
    })

    // Explicit disconnect
    await act(async () => {
      result.current.disconnect()
    })

    // Second connection should be treated as initial
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'new-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: true,
        },
      },
    })

    mockSetMicrophoneEnabled.mockClear()

    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => {
      // C1A: Even after explicit disconnect, initial connection starts listening-only
      expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })
})

describe('useLiveKit — FIX-03: MediaSession Consent Protection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    eventHandlers = {}
    mockOn.mockImplementation((event: string, handler: Function) => {
      eventHandlers[event] = handler
    })
    ;(api.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          token: 'mock-token',
          livekitUrl: 'wss://mock-livekit',
          micEnabled: false,
        },
      },
    })

    // Mock MediaMetadata constructor
    ;(global as any).MediaMetadata = jest.fn().mockImplementation(() => ({}))

    // Mock navigator.mediaSession
    Object.defineProperty(global.navigator, 'mediaSession', {
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: jest.fn(),
      },
      writable: true,
      configurable: true,
    })
  })

  test('MediaSession play handler does not call setMicrophoneEnabled', async () => {
    const { result } = renderHook(() => useLiveKit('room-123'))

    await act(async () => {
      await result.current.connect()
    })

    // Trigger connection state changed to ensure MediaSession is set up
    await act(async () => {
      eventHandlers['connection-state-changed']?.(ConnectionState.Connected)
    })

    // Give React time to run effects
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // Verify MediaSession play handler was registered
    const mediaSession = global.navigator.mediaSession as any
    expect(mediaSession.setActionHandler).toHaveBeenCalledWith('play', expect.any(Function))

    // Get the play handler
    const playHandler = (mediaSession.setActionHandler as jest.Mock).mock.calls.find(
      (call) => call[0] === 'play'
    )?.[1]

    expect(playHandler).toBeDefined()

    // Ensure mic is DISABLED before testing the play handler (production code guards on this)
    mockLocalParticipant.isMicrophoneEnabled = false

    // Mock document.dispatchEvent to capture toast event
    const dispatchEventSpy = jest.spyOn(document, 'dispatchEvent')

    mockSetMicrophoneEnabled.mockClear()

    // Simulate headset play button press
    await act(async () => {
      playHandler?.()
    })

    // Should NOT call setMicrophoneEnabled
    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled()

    // Should dispatch vc:toast event
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vc:toast',
        detail: expect.objectContaining({
          title: '🎧 Headset button pressed',
          description: 'Use the on-screen button to unmute your microphone.',
        }),
      })
    )

    dispatchEventSpy.mockRestore()
  })

  test('MediaSession pause handler only acts when mic is enabled', async () => {
    const { result } = renderHook(() => useLiveKit('room-123'))

    await act(async () => {
      await result.current.connect()
    })

    // Get the pause handler
    const mediaSession = global.navigator.mediaSession as any
    const pauseHandler = (mediaSession.setActionHandler as jest.Mock).mock.calls.find(
      (call) => call[0] === 'pause'
    )?.[1]

    expect(pauseHandler).toBeDefined()

    // Case 1: Mic is disabled — pause should do nothing
    mockLocalParticipant.isMicrophoneEnabled = false
    mockSetMicrophoneEnabled.mockClear()

    await act(async () => {
      pauseHandler?.()
    })

    expect(mockSetMicrophoneEnabled).not.toHaveBeenCalled()

    // Case 2: Mic is enabled — pause should mute
    mockLocalParticipant.isMicrophoneEnabled = true
    await act(async () => {
      await result.current.enableMic(async () => true)
    })

    mockSetMicrophoneEnabled.mockClear()

    await act(async () => {
      pauseHandler?.()
    })

    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(false)
  })
})
