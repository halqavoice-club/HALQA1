/**
 * M1-B-7F: isMicPending State Transitions Test Suite
 *
 * Verifies that isMicPending transitions correctly across all `enableMic()` paths:
 * - Set true at operation start (after operation ID creation)
 * - Set false on authorization failure/error (with operation-ID check)
 * - Set false on abort detection during authorization (with operation-ID check)
 * - Set false on SFU permission failure (with operation-ID check)
 * - Set false on SDK failure (with operation-ID check)
 * - Set false on post-SDK abort detection (with operation-ID check)
 * - Set false on success (with operation-ID check)
 *
 * All clearances check operation ID to prevent races (newer operation supersedes older).
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'
import { Room, ConnectionState } from 'livekit-client'

// Mock dependencies
jest.mock('@/lib/api')
jest.mock('@/store/voice.store', () => ({
  useVoiceStore: () => ({ setSpeaking: jest.fn() }),
}))
jest.mock('@/lib/socket', () => ({
  getSocket: () => null,
}))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'excellent' }),
  qualityToAudioBitrate: () => 96_000,
}))

// Module-scope mockRoom - must be declared before jest.mock factory
let mockRoom: any

// Mock LiveKit Room constructor
jest.mock('livekit-client', () => {
  const actual = jest.requireActual('livekit-client')
  return {
    ...actual,
    Room: jest.fn().mockImplementation(() => mockRoom),
  }
})

// Deferred promise utility for controlled async resolution
function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useLiveKit - isMicPending state transitions (M1-B-7F)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Create mock room that will be used by the Room constructor
    mockRoom = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
      state: ConnectionState.Connected,
      localParticipant: {
        identity: 'test-user',
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
        permissions: { canPublish: true },
        audioTrackPublications: new Map(),
      },
      remoteParticipants: new Map(),
    }

    // Mock API token response
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
    jest.restoreAllMocks()
  })

  // ─── Case A: Authorization denies (returns false) ────────────────────────────
  it('[A] sets isMicPending=false when authorization denies (returns false)', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    // Connect first
    await act(async () => {
      await result.current.connect()
    })

    // Clear mock history from connect()'s initial micEnabled hint
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

    // enableMic with authorization returning false
    const authorizeFn = jest.fn().mockResolvedValue(false)

    await act(async () => {
      const success = await result.current.enableMic(authorizeFn)
      expect(success).toBe(false)
    })

    // Verify pending state was set true, then cleared to false
    expect(authorizeFn).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  // ─── Case B: Authorization throws error ───────────────────────────────────────
  it('[B] sets isMicPending=false when authorization throws error', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    // Clear mock history from connect()'s initial micEnabled hint
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

    const authorizeFn = jest.fn().mockRejectedValue(new Error('Backend error'))

    await act(async () => {
      const success = await result.current.enableMic(authorizeFn)
      expect(success).toBe(false)
    })

    expect(authorizeFn).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  // ─── Case C: Operation aborted during authorization (disableMic() called mid-flight) ─────
  it('[C] sets isMicPending=false when operation is aborted during authorization', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: authPromise, resolve: resolveAuth } = createDeferredPromise<boolean>()
    const authorizeFn = jest.fn().mockReturnValue(authPromise)

    // Start enableMic (authorization is pending)
    let enableMicPromise: Promise<boolean>
    act(() => {
      enableMicPromise = result.current.enableMic(authorizeFn)
    })

    // While authorization is pending, call disableMic() to abort
    await act(async () => {
      await result.current.disableMic()
    })

    // Now resolve authorization
    act(() => {
      resolveAuth(true)
    })

    // enableMic should return false (aborted)
    await act(async () => {
      const success = await enableMicPromise!
      expect(success).toBe(false)
    })

    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  // ─── Case D: Operation superseded by newer operation during authorization ────────────────
  it('[D] sets isMicPending=false when operation is superseded by newer operation', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: auth1Promise, resolve: resolveAuth1 } = createDeferredPromise<boolean>()
    const { promise: auth2Promise, resolve: resolveAuth2 } = createDeferredPromise<boolean>()

    const authorize1 = jest.fn().mockReturnValue(auth1Promise)
    const authorize2 = jest.fn().mockReturnValue(auth2Promise)

    // Start operation 1 (authorization pending)
    let enableMic1Promise: Promise<boolean>
    act(() => {
      enableMic1Promise = result.current.enableMic(authorize1)
    })

    // Start operation 2 immediately (supersedes operation 1)
    let enableMic2Promise: Promise<boolean>
    act(() => {
      enableMic2Promise = result.current.enableMic(authorize2)
    })

    // Resolve both authorizations
    act(() => {
      resolveAuth1(true)
      resolveAuth2(true)
    })

    // Operation 1 should return false (superseded)
    await act(async () => {
      const success1 = await enableMic1Promise!
      expect(success1).toBe(false)
    })

    // Operation 2 should succeed
    await act(async () => {
      const success2 = await enableMic2Promise!
      expect(success2).toBe(true)
    })

    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(true)
  })

  // ─── Case E: SFU permission denied (canPublish !== true) ─────────────────────────────────
  it('[E] sets isMicPending=false when SFU permission denied', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    // Clear mock history from connect()'s initial micEnabled hint
    mockRoom.localParticipant.setMicrophoneEnabled.mockClear()

    // Remove SFU publish permission
    mockRoom.localParticipant.permissions = { canPublish: false }

    const authorizeFn = jest.fn().mockResolvedValue(true)

    await act(async () => {
      const success = await result.current.enableMic(authorizeFn)
      expect(success).toBe(false)
    })

    expect(authorizeFn).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  // ─── Case F: SDK call fails (setMicrophoneEnabled throws) ────────────────────────────────
  it('[F] sets isMicPending=false when SDK call fails', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    mockRoom.localParticipant.setMicrophoneEnabled = jest.fn().mockRejectedValue(new Error('SDK error'))

    const authorizeFn = jest.fn().mockResolvedValue(true)

    await act(async () => {
      try {
        await result.current.enableMic(authorizeFn)
      } catch (err: any) {
        expect(err.message).toBe('SDK error')
      }
    })

    expect(authorizeFn).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  // ─── Case G: Operation aborted after SDK call (disableMic() called after setMicrophoneEnabled) ─
  it('[G] sets isMicPending=false when operation aborted after SDK call', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: sdkPromise, resolve: resolveSdk } = createDeferredPromise<void>()
    // Mock returns deferred promise for enableMic's call (true), resolves immediately for disableMic's call (false)
    mockRoom.localParticipant.setMicrophoneEnabled = jest.fn().mockImplementation((enabled) => {
      if (enabled === true) return sdkPromise
      return Promise.resolve()
    })

    const authorizeFn = jest.fn().mockResolvedValue(true)

    // Start enableMic (SDK call is pending)
    let enableMicPromise: Promise<boolean>
    act(() => {
      enableMicPromise = result.current.enableMic(authorizeFn)
    })

    // Wait for authorization to complete
    await waitFor(() => {
      expect(authorizeFn).toHaveBeenCalledTimes(1)
    })

    // While SDK call is pending, call disableMic() to abort
    await act(async () => {
      await result.current.disableMic()
    })

    // Now resolve SDK call
    act(() => {
      resolveSdk()
    })

    // enableMic should return false (aborted after SDK)
    await act(async () => {
      const success = await enableMicPromise!
      expect(success).toBe(false)
    })

    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  // ─── Case H: Successful enable (happy path) ──────────────────────────────────────────────
  it('[H] sets isMicPending=false on successful enable', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const authorizeFn = jest.fn().mockResolvedValue(true)

    await act(async () => {
      const success = await result.current.enableMic(authorizeFn)
      expect(success).toBe(true)
    })

    expect(authorizeFn).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(true)
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
  })

  // ─── Case I: isMicPending is true during authorization phase ─────────────────────────────
  it('[I] isMicPending is true during authorization phase', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: authPromise, resolve: resolveAuth } = createDeferredPromise<boolean>()
    const authorizeFn = jest.fn().mockReturnValue(authPromise)

    // Start enableMic (authorization is pending)
    let enableMicPromise: Promise<boolean>
    act(() => {
      enableMicPromise = result.current.enableMic(authorizeFn)
    })

    // During authorization, isMicPending should be true
    await waitFor(() => {
      expect(result.current.isMicPending).toBe(true)
    })

    // Resolve authorization
    act(() => {
      resolveAuth(true)
    })

    // After completion, isMicPending should be false
    await act(async () => {
      await enableMicPromise!
    })

    expect(result.current.isMicPending).toBe(false)
  })

  // ─── Case J: isMicPending is true during SDK call phase ──────────────────────────────────
  it('[J] isMicPending is true during SDK call phase', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: sdkPromise, resolve: resolveSdk } = createDeferredPromise<void>()
    mockRoom.localParticipant.setMicrophoneEnabled = jest.fn().mockReturnValue(sdkPromise)

    const authorizeFn = jest.fn().mockResolvedValue(true)

    // Start enableMic
    let enableMicPromise: Promise<boolean>
    act(() => {
      enableMicPromise = result.current.enableMic(authorizeFn)
    })

    // During SDK call, isMicPending should still be true
    await waitFor(() => {
      expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
      expect(result.current.isMicPending).toBe(true)
    })

    // Resolve SDK call
    act(() => {
      resolveSdk()
    })

    // After completion, isMicPending should be false
    await act(async () => {
      await enableMicPromise!
    })

    expect(result.current.isMicPending).toBe(false)
  })

  // ─── Case K: Room not connected returns false without setting pending ────────────────────
  it('[K] returns false immediately when room not connected (no pending state change)', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    // Don't connect

    const authorizeFn = jest.fn()

    await act(async () => {
      const success = await result.current.enableMic(authorizeFn)
      expect(success).toBe(false)
    })

    // Authorization should not have been called
    expect(authorizeFn).not.toHaveBeenCalled()
    // isMicPending should remain false (early return)
    expect(result.current.isMicPending).toBe(false)
  })

  // ─── Case L: Operation-ID check prevents race (old operation clears wrong pending state) ─
  it('[L] operation-ID check prevents race: old operation does not clear pending state of newer operation', async () => {
    const { result } = renderHook(() => useLiveKit('test-room'))

    await act(async () => {
      await result.current.connect()
    })

    const { promise: auth1Promise, resolve: resolveAuth1 } = createDeferredPromise<boolean>()
    const { promise: auth2Promise, resolve: resolveAuth2 } = createDeferredPromise<boolean>()

    const authorize1 = jest.fn().mockReturnValue(auth1Promise)
    const authorize2 = jest.fn().mockReturnValue(auth2Promise)

    // Start operation 1 (slow authorization)
    let enableMic1Promise: Promise<boolean>
    act(() => {
      enableMic1Promise = result.current.enableMic(authorize1)
    })

    // Verify operation 1 set pending=true
    await waitFor(() => {
      expect(result.current.isMicPending).toBe(true)
    })

    // Start operation 2 immediately (supersedes operation 1)
    let enableMic2Promise: Promise<boolean>
    act(() => {
      enableMic2Promise = result.current.enableMic(authorize2)
    })

    // Pending should still be true (operation 2 is now active)
    expect(result.current.isMicPending).toBe(true)

    // Resolve operation 1 authorization (returns false because superseded)
    act(() => {
      resolveAuth1(true)
    })

    await act(async () => {
      const success1 = await enableMic1Promise!
      expect(success1).toBe(false)
    })

    // Operation 1's cleanup should NOT have cleared pending (operation-ID check prevents it)
    expect(result.current.isMicPending).toBe(true)

    // Resolve operation 2
    act(() => {
      resolveAuth2(true)
    })

    await act(async () => {
      const success2 = await enableMic2Promise!
      expect(success2).toBe(true)
    })

    // Now pending should be false (operation 2 completed)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(true)
  })
})
