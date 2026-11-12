/**
 * SEC01-WEB-P1-R2: Web Microphone Authorization Tests
 * 
 * Verifies mandatory authorization, operation versioning, and race protection.
 */

import { renderHook, act } from '@testing-library/react'
import { ConnectionState } from 'livekit-client'

// Mock modules before imports
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn(), patch: jest.fn() } }))
jest.mock('@/lib/socket', () => ({
  getSocket: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  })),
}))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'excellent' }),
  qualityToAudioBitrate: () => 96000,
}))

// Stateful mock for LiveKit Room  
let mockRoom: any

// Mock livekit-client before imports
jest.mock('livekit-client', () => {
  const actual = jest.requireActual('livekit-client')
  return {
    ...actual,
    Room: jest.fn().mockImplementation(() => mockRoom),
  }
})

// Must import after mocks are defined
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'

describe('SEC01-WEB-P1-R2: Mandatory Authorization & Operation Versioning', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Initialize mockRoom with proper structure BEFORE Room constructor is called
    // M1-B-7J: Set state to 'connected' - connect() method doesn't change state, it fires events
    mockRoom = {
      state: ConnectionState.Connected,
      micEnabled: false,
      localParticipant: {
        identity: 'user-123',
        permissions: { canPublish: true },
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: jest.fn(async (enabled: boolean) => {
          // Instant SDK resolution (deterministic — no real-timer races).
          // Tests that need a pending SDK window override this mock with their
          // own deferred/timer implementation (see TC-06, TC-12).
          if (mockRoom.state !== ConnectionState.Connected) {
            throw new Error('Not connected')
          }
          mockRoom.micEnabled = enabled
          mockRoom.localParticipant.isMicrophoneEnabled = enabled
        }),
        audioTracks: new Map(),
        audioTrackPublications: new Map(),
      },
      on: jest.fn((event: string, handler: Function) => {
        // Store handlers for manual triggering if needed
        return mockRoom
      }),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(async () => {
        mockRoom.state = ConnectionState.Disconnected
      }),
      connect: jest.fn(async () => {
        // M1-B-7J: connect() fires events but doesn't directly set state
        // State is already set to Connected in beforeEach
        mockRoom.state = ConnectionState.Connected
      }),
      remoteParticipants: new Map(),
    }
    
    // Mock crypto.randomUUID
    let idCounter = 0
    global.crypto = {
      randomUUID: () => `op-${++idCounter}`,
    } as any
    
    // Mock getUserMedia and getLocalDevices for hardware capture verification
    // M1-B-7K Issue #1: Use Object.defineProperty to override readonly property
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn(),
        getLocalDevices: jest.fn(),
      },
      writable: true,
      configurable: true
    })
  })

  describe('Mandatory Authorization', () => {
    it('TC-01: Rejects enableMic() calls without authorization callback', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      // M1-B-7J: Don't connect - room should not be connected for this test
      mockRoom.state = ConnectionState.Disconnected
      
      await act(async () => {
        // Wait for component to be ready - room won't exist without connect() but we can't connect without API mock
        // Instead: verify that enableMic() without authorize callback fails safely
        // @ts-expect-error Testing mandatory parameter enforcement
        const success = await result.current.enableMic()
        expect(success).toBe(false)
      })

      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    })

    it('TC-02: Invokes mandatory authorization callback before hardware', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      // Connect the hook
      await act(async () => {
        await result.current.connect()
      })
      
      // M1-B-7J: Clear mock after initial connection (hook sets mic to false for listening-only start)
      mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(true)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    })

    it('TC-03: Aborts on authorization denial', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(false)
      
      await act(async () => {
        await result.current.connect()
      })
      
      // M1-B-7J: Clear the setMicrophoneEnabled call from initial connection (FIX-01 behavior)
      mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    })

    it('TC-04: Aborts on authorization exception', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockRejectedValue(new Error('Backend error'))
      
      await act(async () => {
        await result.current.connect()
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    })
  })

  describe('Operation Versioning - OFF Wins', () => {
    it('TC-05: Aborts when disableMic called during authorization', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      await act(async () => {
        await result.current.connect()
      })
      
      // M1-B-7J: Clear initial connection call
      mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

      // M1-B-7J: Fix scope - declare resolveAuth in outer scope BEFORE creating the promise
      let resolveAuth!: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => {
        return new Promise<boolean>(resolve => {
          resolveAuth = resolve
        })
      })

      // Start enableMic (authorization pending)
      const enablePromise = act(async () => {
        return result.current.enableMic(authorizeSpy)
      })

      // Call disableMic while authorization is pending
      await act(async () => {
        await result.current.disableMic()
      })

      // Resolve authorization (but operation should be aborted)
      act(() => {
        resolveAuth(true)
      })

      const success = await enablePromise

      // Microphone should remain OFF
      expect(success).toBe(false)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    })

    it('TC-06: Aborts when disableMic called during SDK activation', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      await act(async () => {
        await result.current.connect()
      })
      
      // Make SDK call take longer
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        mockRoom.localParticipant.isMicrophoneEnabled = enabled
        mockRoom.micEnabled = enabled
      })

      // Start enableMic
      const enablePromise = act(async () => {
        return result.current.enableMic(authorizeSpy)
      })

      // Wait for authorization to complete, then call disableMic during SDK call
      await new Promise(resolve => setTimeout(resolve, 20))
      
      await act(async () => {
        await result.current.disableMic()
      })

      const success = await enablePromise

      // EnableMic should detect abort and force disable
      expect(success).toBe(false)
      expect(mockRoom.micEnabled).toBe(false)
    })

    it('TC-07: ON/OFF/ON concurrent operations - latest wins', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })

      const { result } = renderHook(() => useLiveKit('room-123'))

      await act(async () => {
        await result.current.connect()
      })

      // Deferred authorizations so each ON stays pending at the auth check,
      // giving the OFF a deterministic window to abort ON #1. Everything runs
      // inside a single act() to avoid overlapping act() scopes (which would
      // corrupt the act scope for subsequent tests).
      let resolveAuth1!: (v: boolean) => void
      let resolveAuth2!: (v: boolean) => void
      const auth1 = jest.fn(() => new Promise<boolean>((r) => { resolveAuth1 = r }))
      const auth2 = jest.fn(() => new Promise<boolean>((r) => { resolveAuth2 = r }))

      let r1: boolean | undefined
      let r2: boolean | undefined
      await act(async () => {
        // ON #1 — pending at the authorization check
        const p1 = result.current.enableMic(auth1)
        // OFF — aborts the pending ON #1 (operation-ID abort)
        await result.current.disableMic()
        // ON #2 — pending at the authorization check
        const p2 = result.current.enableMic(auth2)
        // Resolve both authorizations: ON #1 is already aborted; ON #2 is active
        resolveAuth1(true)
        resolveAuth2(true)
        ;[r1, r2] = await Promise.all([p1, p2])
      })

      // ON #1 was aborted by OFF; ON #2 (the latest) wins
      expect(r1).toBe(false)
      expect(r2).toBe(true)
      expect(result.current.isMicEnabled).toBe(true)
    })
  })

  describe('Disconnect Invalidation', () => {
    it('TC-08: Aborts pending ENABLE on disconnect', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      await act(async () => {
        await result.current.connect()
      })

      // M1-B-7J: Fix scope - declare resolveAuth in outer scope BEFORE creating promise
      let resolveAuth!: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => {
        return new Promise<boolean>(resolve => {
          resolveAuth = resolve
        })
      })

      // Start enableMic
      const enablePromise = act(async () => {
        return result.current.enableMic(authorizeSpy)
      })

      // Disconnect while authorization pending
      act(() => {
        result.current.disconnect()
      })

      // Resolve authorization
      act(() => {
        resolveAuth(true)
      })

      const success = await enablePromise

      // Should be aborted
      expect(success).toBe(false)
    })
  })

  describe('SFU Permission Checks', () => {
    it('TC-09: Aborts when SFU canPublish is false', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      await act(async () => {
        await result.current.connect()
      })
      
      // Change SFU permission after connect
      mockRoom.localParticipant.permissions = { canPublish: false }

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    })

    it('TC-10: Aborts when not connected', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      // Don't call connect() - room stays disconnected

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      // Authorization should not be called if room not connected
      expect(authorizeSpy).not.toHaveBeenCalled()
      expect(result.current.connectionState).toBe(ConnectionState.Disconnected)
    })
  })

  describe('Stateful Publication Evidence', () => {
    it('TC-11: Hardware state matches final intent after races', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      await act(async () => {
        await result.current.connect()
      })

      // Multiple rapid ON/OFF cycles
      await act(async () => {
        await result.current.enableMic(() => Promise.resolve(true))
      })
      expect(result.current.isMicEnabled).toBe(true)

      await act(async () => {
        await result.current.disableMic()
      })
      expect(result.current.isMicEnabled).toBe(false)

      await act(async () => {
        await result.current.enableMic(() => Promise.resolve(true))
      })
      expect(result.current.isMicEnabled).toBe(true)

      // M1-B-7J: Updated expectation - final state should be consistent
      expect(result.current.isMicEnabled).toBe(true)
    })

    it('TC-12: Late SDK completion after abort forces disable', async () => {
      // M1-B-7J: Mock API before rendering hook
      ;(api.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })

      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)

      await act(async () => {
        await result.current.connect()
      })

      // SDK enable is slow (deferred); SDK disable is instant. Only the enable
      // call blocks on sdkResolve so disableMic does not hang on the same gate.
      let sdkResolve!: () => void
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled: boolean) => {
        if (enabled) {
          await new Promise<void>((r) => { sdkResolve = r })
        }
        mockRoom.localParticipant.isMicrophoneEnabled = enabled
      })

      let success: boolean | undefined
      await act(async () => {
        // ON — pending at the deferred SDK enable
        const p = result.current.enableMic(authorizeSpy)
        // Let enableMic progress past the (instant) authorization and the
        // pre-SDK abort check to the deferred setMicrophoneEnabled(true) call,
        // so the abort below happens during the SDK stage, not the auth stage.
        await Promise.resolve()
        // OFF — aborts the pending ON (disable is instant)
        await result.current.disableMic()
        // Late SDK enable completion → enableMic detects the abort and forces disable
        sdkResolve()
        success = await p
      })

      // The late SDK completion is detected as aborted → mic forced off
      expect(success).toBe(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })
})
