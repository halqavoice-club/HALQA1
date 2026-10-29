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
  })

  describe('Mandatory Authorization', () => {
    it('TC-01: Rejects enableMic() calls without authorization callback', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      // Manually inject room since we can't call connect()
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      // TypeScript should prevent this, but verify runtime behavior
      await act(async () => {
        // @ts-expect-error Testing mandatory parameter
        const success = await result.current.enableMic()
        expect(success).toBe(false)
      })

      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    })

    it('TC-02: Invokes mandatory authorization callback before hardware', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(true)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.micEnabled).toBe(true)
    })

    it('TC-03: Aborts on authorization denial', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(false)
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.micEnabled).toBe(false)
    })

    it('TC-04: Aborts on authorization exception', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockRejectedValue(new Error('Backend error'))
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(mockRoom.micEnabled).toBe(false)
    })
  })

  describe('Operation Versioning - OFF Wins', () => {
    it('TC-05: Aborts when disableMic called during authorization', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      let resolveAuth: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => new Promise<boolean>(resolve => {
        resolveAuth = resolve
      }))
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
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
        resolveAuth!(true)
      })

      await enablePromise

      // Microphone should remain OFF
      expect(mockRoom.micEnabled).toBe(false)
    })

    it('TC-06: Aborts when disableMic called during SDK activation', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      // Make SDK call take longer
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        mockRoom.micEnabled = enabled
      })
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
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
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
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

      // Final state should be ON (latest operation)
      expect(mockRoom.micEnabled).toBe(true)
    })
  })

  describe('Disconnect Invalidation', () => {
    it('TC-08: Aborts pending ENABLE on disconnect', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      let resolveAuth: (value: boolean) => void
      
      const authorizeSpy = jest.fn(() => new Promise<boolean>(resolve => {
        resolveAuth = resolve
      }))
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
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
        resolveAuth!(true)
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
      
      mockRoom.localParticipant.permissions = { canPublish: false }
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      expect(mockRoom.micEnabled).toBe(false)
    })

    it('TC-10: Aborts when not connected', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      mockRoom.state = ConnectionState.Disconnected
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      await act(async () => {
        const success = await result.current.enableMic(authorizeSpy)
        expect(success).toBe(false)
      })

      // Authorization should not be called if room not connected
      expect(authorizeSpy).not.toHaveBeenCalled()
      expect(mockRoom.micEnabled).toBe(false)
    })
  })

  describe('Stateful Publication Evidence', () => {
    it('TC-11: Hardware state matches final intent after races', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
      })

      // Multiple rapid ON/OFF cycles
      await act(async () => {
        await result.current.enableMic(() => Promise.resolve(true))
      })
      expect(mockRoom.micEnabled).toBe(true)

      await act(async () => {
        await result.current.disableMic()
      })
      expect(mockRoom.micEnabled).toBe(false)

      await act(async () => {
        await result.current.enableMic(() => Promise.resolve(true))
      })
      expect(mockRoom.micEnabled).toBe(true)

      // Final state should be consistent
      expect(mockRoom.micEnabled).toBe(true)
      expect(result.current.isMicEnabled).toBe(true)
    })

    it('TC-12: Late SDK completion after abort forces disable', async () => {
      const { result } = renderHook(() => useLiveKit('room-123'))
      const authorizeSpy = jest.fn().mockResolvedValue(true)
      
      // SDK activation takes 100ms
      let sdkResolve: (value: void) => void
      mockRoom.localParticipant.setMicrophoneEnabled = jest.fn(async (enabled) => {
        await new Promise<void>(resolve => { sdkResolve = resolve })
        mockRoom.micEnabled = enabled
      })
      
      act(() => {
        (result.current as any).roomRef = { current: mockRoom }
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
        sdkResolve!()
      })

      const success = await enablePromise

      // Should detect abort and force mic off
      expect(success).toBe(false)
      expect(mockRoom.micEnabled).toBe(false)
    })
  })
})
