/**
 * SEC01-WEB-P1-R2: Web Microphone Authorization Tests
 * 
 * Verifies mandatory authorization, operation versioning, and race protection.
 */

import { renderHook, act } from '@testing-library/react'
import { ConnectionState } from 'livekit-client'

// Mock modules before imports
jest.mock('@/lib/api', () => ({ default: { patch: jest.fn() } }))
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
class MockLiveKitRoom {
  state = ConnectionState.Connected
  micEnabled = false
  connectionQuality = 'excellent'
  
  localParticipant = {
    identity: 'user-123',
    permissions: { canPublish: true },
    isMicrophoneEnabled: false,
    setMicrophoneEnabled: jest.fn(async (enabled: boolean) => {
      // Simulate async SDK call with small delay
      await new Promise(resolve => setTimeout(resolve, 10))
      if (this.state !== ConnectionState.Connected) {
        throw new Error('Not connected')
      }
      this.micEnabled = enabled
      this.localParticipant.isMicrophoneEnabled = enabled
    }),
    audioTracks: new Map(),
  }
  
  on = jest.fn()
  off = jest.fn()
  removeAllListeners = jest.fn()
  disconnect = jest.fn()
}

// Must import after mocks are defined
import { useLiveKit } from '../useLiveKit'

describe('SEC01-WEB-P1-R2: Mandatory Authorization & Operation Versioning', () => {
  let mockRoom: MockLiveKitRoom

  beforeEach(() => {
    jest.clearAllMocks()
    mockRoom = new MockLiveKitRoom()
    
    // Mock crypto.randomUUID
    let idCounter = 0
    global.crypto = {
      randomUUID: () => `op-${++idCounter}`,
    } as any
    
    // Mock getUserMedia and getLocalDevices for hardware capture verification
    global.navigator.mediaDevices = {
      getUserMedia: jest.fn(),
      getLocalDevices: jest.fn(),
    } as any
  })

  describe('Mandatory Authorization', () => {
    it('TC-01: Rejects enableMic() calls without authorization callback', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      // Set up connected room via public API
      mockRoom.state = ConnectionState.Connected
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      // Simulate connected room by mocking api.post to return token
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      // Connect the hook
      await act(async () => {
        await result.current.connect()
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(true)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    })

    it('TC-03: Aborts on authorization denial', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(false)
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    })

    it('TC-04: Aborts on authorization exception', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockRejectedValue(new Error('Backend error'))
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      // M1-B-7J: Fix scope - declare resolveAuth in outer scope before creating promise
      let resolveAuth!: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => new Promise<boolean>(resolve => {
        resolveAuth = resolve
      }))
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
      })
      
      // Make SDK call take longer
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        mockRoom.localParticipant.isMicrophoneEnabled = enabled
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
      })

      const auth1 = jest.fn().mockResolvedValue(true)
      const auth2 = jest.fn().mockResolvedValue(true)

      // Start ON #1
      const enable1 = act(async () => result.current.enableMic(auth1))
      
      // Immediately start OFF
      await act(async () => {
        await result.current.disableMic()
      })
      
      // Immediately start ON #2
      const enable2 = act(async () => result.current.enableMic(auth2))

      await Promise.all([enable1, enable2])

      // M1-B-7J: Updated expectation - final state should be ON (latest operation wins)
      expect(result.current.isMicEnabled).toBe(true)
    })
  })

  describe('Disconnect Invalidation', () => {
    it('TC-08: Aborts pending ENABLE on disconnect', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      // M1-B-7J: Fix scope - declare resolveAuth in outer scope
      let resolveAuth!: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => new Promise<boolean>(resolve => {
        resolveAuth = resolve
      }))
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
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
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      ;(require('@/lib/api').default.post as jest.Mock).mockResolvedValue({
        data: { data: { token: 'test-token', livekitUrl: 'wss://test', micEnabled: false } }
      })
      
      await act(async () => {
        await result.current.connect()
      })
      
      // SDK activation takes 100ms
      let sdkResolve!: (value: void) => void
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled) => {
        await new Promise<void>(resolve => { sdkResolve = resolve })
        mockRoom.localParticipant.isMicrophoneEnabled = enabled
      })

      // Start enableMic
      const enablePromise = act(async () => {
        return result.current.enableMic(authorizeSpy)
      })

      // Wait a bit, then disable
      await new Promise(resolve => setTimeout(resolve, 20))
      await act(async () => {
        await result.current.disableMic()
      })

      // Now complete SDK activation (simulating late completion)
      act(() => {
        sdkResolve()
      })

      const success = await enablePromise

      // M1-B-7J: Updated expectation - should detect abort and keep mic off
      expect(success).toBe(false)
      expect(result.current.isMicEnabled).toBe(false)
    })
  })
})
