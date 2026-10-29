/**
 * PHASE 3A-3C3A-FIX: Mobile Reconnection Consent Tests
 * 
 * Verifies FIX-02 (mobile always starts muted on reconnect).
 */
import { renderHook, act, waitFor } from '@testing-library/react-native'
import { useLiveKitAudio } from '../useLiveKitAudio'
import { AppState } from 'react-native'

jest.mock('react-native-flash-message', () => ({
  showMessage: jest.fn(),
}))

jest.mock('@/lib/socket', () => ({
  getSocket: jest.fn(() => null),
}))

// Mock @livekit/react-native
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
  localParticipant: mockLocalParticipant,
  on: mockOn,
  removeAllListeners: mockRemoveAllListeners,
  disconnect: mockDisconnect,
  connect: mockConnect,
  state: 'connected',
}

let eventHandlers: Record<string, Function> = {}

jest.mock('@livekit/react-native', () => ({
  Room: jest.fn(() => mockRoom),
  RoomEvent: {
    Connected: 'connected',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
  },
}))

// Mock useNetworkQuality hook
jest.mock('../useNetworkQuality', () => ({
  useNetworkQuality: jest.fn(() => ({ quality: 'good', isOffline: false })),
  qualityToAudioBitrate: jest.fn(() => 64000),
}))

describe('useLiveKitAudio — FIX-02: Always Start Muted on Reconnect', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    eventHandlers = {}
    mockOn.mockImplementation((event: string, handler: Function) => {
      eventHandlers[event] = handler
      return mockRoom
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('Initial connection honors startMuted parameter', async () => {
    const { result } = await renderHook(() => useLiveKitAudio())

    // Connect with startMuted: false (user has permission to speak)
    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Should enable mic (startMuted=false + canPublish=true)
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true, expect.any(Object))
    expect(result.current.micEnabled).toBe(true)
  })

  test('Auto-reconnect after disconnect starts muted', async () => {
    const { result } = await renderHook(() => useLiveKitAudio())

    // Initial connect (startMuted: false, canPublish: true)
    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Verify mic was enabled initially
    expect(mockSetMicrophoneEnabled).toHaveBeenCalledWith(true, expect.any(Object))

    // Enable mic explicitly
    await act(async () => {
      await result.current.enableMic()
    })

    // Clear mock calls
    mockSetMicrophoneEnabled.mockClear()
    mockConnect.mockClear()

    // Simulate disconnect (network error — not user-initiated)
    await act(async () => {
      eventHandlers['disconnected']?.('NetworkError')
    })

    // Wait for auto-reconnect timer (1 second base delay)
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    // Verify connect was called again (reconnection attempt)
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    // Trigger Connected event for reconnection
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Verify reconnect set mic to FALSE (startMuted=true)
    // The second call should be with false (muted)
    await waitFor(() => {
      const lastCall = mockSetMicrophoneEnabled.mock.calls[mockSetMicrophoneEnabled.mock.calls.length - 1]
      expect(lastCall?.[0]).toBe(false)
    })
  })

  test('Background recovery starts muted', async () => {
    const { result } = await renderHook(() => useLiveKitAudio())

    // Initial connect with mic enabled
    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // Enable mic
    await act(async () => {
      await result.current.enableMic()
    })

    // Clear mock
    mockSetMicrophoneEnabled.mockClear()
    mockConnect.mockClear()

    // Simulate app going to background
    await act(async () => {
      const listeners = (AppState.addEventListener as jest.Mock).mock.calls[0]
      const changeHandler = listeners?.[1]
      changeHandler?.('background')
    })

    // Simulate disconnect
    await act(async () => {
      eventHandlers['disconnected']?.('BackgroundTimeout')
    })

    // Simulate app coming to foreground
    await act(async () => {
      const listeners = (AppState.addEventListener as jest.Mock).mock.calls[0]
      const changeHandler = listeners?.[1]
      changeHandler?.('active')
    })

    // Wait for reconnection
    await act(async () => {
      jest.advanceTimersByTime(500)
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Should have reconnected with startMuted=true
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
      const lastMicCall = mockSetMicrophoneEnabled.mock.calls[mockSetMicrophoneEnabled.mock.calls.length - 1]
      expect(lastMicCall?.[0]).toBe(false)
    })
  })

  test('Connection error retry starts muted', async () => {
    // Force connect to throw an error on first call
    mockConnect.mockRejectedValueOnce(new Error('Connection timeout'))

    const { result } = await renderHook(() => useLiveKitAudio())

    // Attempt initial connect
    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // Clear mocks
    mockConnect.mockResolvedValue(undefined)
    mockSetMicrophoneEnabled.mockClear()
    mockConnect.mockClear()

    // Wait for retry timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    // Should retry connection
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Should start muted on retry (startMuted=true)
    await waitFor(() => {
      const lastCall = mockSetMicrophoneEnabled.mock.calls[mockSetMicrophoneEnabled.mock.calls.length - 1]
      expect(lastCall?.[0]).toBe(false)
    })
  })

  test('Force reconnect after explicit mic OFF stays muted', async () => {
    const { result } = await renderHook(() => useLiveKitAudio())

    // Initial connect
    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // User explicitly disables mic
    await act(async () => {
      await result.current.disableMic()
    })

    // Clear mock
    mockSetMicrophoneEnabled.mockClear()
    mockConnect.mockClear()

    // Force reconnect
    await act(async () => {
      await result.current.reconnect()
    })

    // Trigger Connected event
    await act(async () => {
      eventHandlers['connected']?.()
    })

    // Should reconnect with startMuted=true
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
      const lastMicCall = mockSetMicrophoneEnabled.mock.calls[mockSetMicrophoneEnabled.mock.calls.length - 1]
      expect(lastMicCall?.[0]).toBe(false)
    })
  })

  test('Mic cannot be enabled without canPublish permission', async () => {
    // Remove canPublish permission
    mockLocalParticipant.permissions.canPublish = false

    const { result } = await renderHook(() => useLiveKitAudio())

    await act(async () => {
      await result.current.connect('wss://test', 'token', false, 'room-1')
    })

    // Attempt to enable mic
    let enableResult = false
    await act(async () => {
      enableResult = await result.current.enableMic()
    })

    // Should return false (permission denied)
    expect(enableResult).toBe(false)
    expect(result.current.micEnabled).toBe(false)

    // Restore permission for other tests
    mockLocalParticipant.permissions.canPublish = true
  })

  test('explicit OFF invalidates a pending ON and late SDK completion stays OFF', async () => {
    let resolveEnable!: () => void
    mockSetMicrophoneEnabled.mockImplementationOnce(() => new Promise<void>(resolve => { resolveEnable = resolve }))

    const { result } = await renderHook(() => useLiveKitAudio())
    await act(async () => {
      await result.current.connect('wss://test', 'token', true, 'room-1')
    })
    mockSetMicrophoneEnabled.mockClear()
    mockSetMicrophoneEnabled.mockImplementationOnce(() => new Promise<void>(resolve => { resolveEnable = resolve }))

    let enabled = true
    let pendingEnable!: Promise<void>
    await act(async () => {
      pendingEnable = result.current.enableMic().then((value: boolean) => { enabled = value })
    })
    await act(async () => {
      await result.current.disableMic()
    })
    await act(async () => {
      resolveEnable()
      await pendingEnable
    })

    expect(enabled).toBe(false)
    expect(result.current.micEnabled).toBe(false)
    expect(mockSetMicrophoneEnabled.mock.calls.map(call => call[0])).toEqual([true, false, false])
  })
})
