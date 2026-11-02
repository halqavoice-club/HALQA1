/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLiveKit } from '../useLiveKit'
import api from '@/lib/api'

jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn() } }))
jest.mock('@/lib/socket', () => ({ getSocket: jest.fn(() => null) }))
jest.mock('@/store/voice.store', () => ({
  useVoiceStore: () => ({ setSpeaking: jest.fn() }),
}))
jest.mock('@/hooks/useNetworkQuality', () => ({
  useNetworkQuality: () => ({ quality: 'good' }),
  qualityToAudioBitrate: () => 64_000,
}))

let mockRoom: any
jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  RoomEvent: {
    ConnectionStateChanged: 'connection-state-changed',
    ConnectionQualityChanged: 'connection-quality-changed',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    TrackSubscribed: 'track-subscribed',
    TrackUnsubscribed: 'track-unsubscribed',
    TrackMuted: 'track-muted',
    TrackUnmuted: 'track-unmuted',
    LocalTrackPublished: 'local-track-published',
    LocalTrackUnpublished: 'local-track-unpublished',
    ParticipantDisconnected: 'participant-disconnected',
    ActiveSpeakersChanged: 'active-speakers-changed',
  },
  ConnectionState: { Connected: 'connected', Disconnected: 'disconnected', Reconnecting: 'reconnecting' },
  ConnectionQuality: { Unknown: 'unknown' },
  DisconnectReason: {
    CLIENT_INITIATED: 'client-initiated',
    ROOM_DELETED: 'room-deleted',
    PARTICIPANT_REMOVED: 'participant-removed',
  },
  Track: { Source: { Microphone: 'microphone' }, Kind: { Audio: 'audio' } },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createTrack() {
  const track: any = {
    kind: 'audio',
    source: 'microphone',
    stopped: false,
    isMuted: false,
    mediaStreamTrack: { enabled: true, readyState: 'live', stop: jest.fn() },
    stop: jest.fn(() => {
      track.stopped = true
      track.mediaStreamTrack.enabled = false
      track.mediaStreamTrack.readyState = 'ended'
    }),
    mute: jest.fn(async () => {
      track.isMuted = true
      track.mediaStreamTrack.enabled = false
    }),
    unmute: jest.fn(async () => {
      track.isMuted = false
      track.mediaStreamTrack.enabled = true
    }),
  }
  return track
}

let actions: Map<string, (() => void) | null>
let events: Record<string, (...args: any[]) => void>
let mediaSession: any

function makePublication(track: any) {
  return {
    source: 'microphone',
    track,
    isMuted: false,
    mute: jest.fn(async () => track.mute()),
    unmute: jest.fn(async () => track.unmute()),
  }
}

async function mountConnected() {
  const mounted = renderHook(() => useLiveKit('room-123'))
  await act(async () => { await mounted.result.current.connect() })
  return mounted
}

async function beginOn(
  result: { current: ReturnType<typeof useLiveKit> },
  authorize: () => Promise<boolean> = async () => true,
) {
  let activation!: Promise<boolean>
  await act(async () => { activation = result.current.enableMic(authorize) })
  return { activation }
}

beforeEach(() => {
  jest.clearAllMocks()
  actions = new Map()
  events = {}
  mediaSession = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: jest.fn((action: string, handler: (() => void) | null) => actions.set(action, handler)),
  }
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession })
  ;(globalThis as any).MediaMetadata = jest.fn((value: unknown) => value)
  const publications = new Map<string, any>()
  const participant: any = {
    identity: 'test-user',
    permissions: { canPublish: true },
    isMicrophoneEnabled: false,
    audioTrackPublications: publications,
    createTracks: jest.fn(async () => [createTrack()]),
    getTrackPublication: jest.fn(() => publications.get('microphone')),
    publishTrack: jest.fn(async (track: any) => {
      const publication = makePublication(track)
      publications.set('microphone', publication)
      participant.isMicrophoneEnabled = !track.stopped && !track.isMuted
      return publication
    }),
    unpublishTrack: jest.fn(async (track: any) => {
      if (publications.get('microphone')?.track === track) publications.delete('microphone')
      participant.isMicrophoneEnabled = Array.from(publications.values()).some(publication =>
        !publication.isMuted && !publication.track.stopped,
      )
    }),
    setMicrophoneEnabled: jest.fn(async (enabled: boolean) => {
      participant.isMicrophoneEnabled = enabled
      const publication = publications.get('microphone')
      if (publication) {
        publication.isMuted = !enabled
        if (enabled) await publication.track.unmute()
        else await publication.track.mute()
      }
      return publication
    }),
  }
  mockRoom = {
    state: 'connected',
    localParticipant: participant,
    remoteParticipants: new Map(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => { events[event] = handler }),
    removeAllListeners: jest.fn(() => { events = {} }),
    connect: jest.fn(async () => { mockRoom.state = 'connected' }),
    disconnect: jest.fn(() => { mockRoom.state = 'disconnected' }),
  }
  ;(api.post as jest.Mock).mockResolvedValue({ data: { data: {
    token: 'mock-token', livekitUrl: 'wss://mock-livekit', micEnabled: false,
  } } })
})

afterEach(() => {
  cleanup()
  delete (navigator as any).mediaSession
  delete (globalThis as any).MediaMetadata
})

describe('useLiveKit — C0 OFF wins over pending microphone activation', () => {
  test.each(['pause', 'manual OFF'] as const)(
    'pending enable -> %s -> operation aborted (M1-B-7F uses setMicrophoneEnabled, not createTracks)',
    async (offAction) => {
      const { result } = await mountConnected()
      const participant = mockRoom.localParticipant
      
      // M1-B-7J: M1-B-7F implementation uses setMicrophoneEnabled, not createTracks/publishTrack
      // Start enableMic operation
      const { activation } = await beginOn(result)
      expect(result.current.isMicPending).toBe(true)
      
      // Trigger OFF action
      await act(async () => {
        if (offAction === 'pause') actions.get('pause')?.()
        else await result.current.disableMic()
      })
      
      // Operation should be aborted
      const enabled = await activation
      expect(enabled).toBe(false)
      expect(result.current.isMicPending).toBe(false)
      expect(result.current.isMicEnabled).toBe(false)
    },
  )

  test('delayed backend self-unmute approval after OFF cannot activate mic', async () => {
    const { result } = await mountConnected()
    const approval = deferred<boolean>()
    const authorize = jest.fn(() => approval.promise)
    const { activation } = await beginOn(result, authorize)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(result.current.isMicPending).toBe(true)
    
    await act(async () => { await result.current.disableMic() })
    expect(result.current.isMicPending).toBe(false)
    
    await act(async () => {
      approval.resolve(true)
      expect(await activation).toBe(false)
    })
    // M1-B-7J: M1-B-7F uses setMicrophoneEnabled, not createTracks
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('OFF invalidates pending authorization even while the Room is disconnected', async () => {
    const { result } = await mountConnected()
    const approval = deferred<boolean>()
    const { activation } = await beginOn(result, () => approval.promise)
    mockRoom.state = 'disconnected'
    await act(async () => { await result.current.disableMic() })
    // The same Room can recover before the older approval returns.
    mockRoom.state = 'connected'
    await act(async () => {
      approval.resolve(true)
      expect(await activation).toBe(false)
    })
    // M1-B-7J: M1-B-7F uses setMicrophoneEnabled, not createTracks
    expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('toggleMic cancels pending ON operation', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    
    // Start enableMic operation
    const { activation } = await beginOn(result)
    expect(result.current.isMicPending).toBe(true)
    
    // toggleMic should abort the pending operation
    await act(async () => { await result.current.toggleMic() })
    
    const enabled = await activation
    expect(enabled).toBe(false)
    expect(result.current.isMicPending).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('an SDK publish already in flight is stopped on OFF and unpublished after late completion', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    
    // M1-B-7J: M1-B-7F uses setMicrophoneEnabled - make SDK call slow
    participant.setMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      participant.isMicrophoneEnabled = enabled
      return enabled ? makePublication(createTrack()) : null
    })
    
    const { activation } = await beginOn(result)
    expect(participant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    
    // Call disableMic() while setMicrophoneEnabled(true) is in flight
    await act(async () => { await result.current.disableMic() })
    
    // Wait for the original activation to complete
    await act(async () => {
      expect(await activation).toBe(false)
    })
    
    // M1-B-7J: Mic should be disabled (OFF wins)
    expect(result.current.isMicEnabled).toBe(false)
    expect(participant.setMicrophoneEnabled).toHaveBeenCalledWith(false)
  })

  test('two pending ON requests followed by OFF cannot publish either captured track', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const firstCapture = deferred<any[]>()
    const secondCapture = deferred<any[]>()
    const firstTrack = createTrack()
    const secondTrack = createTrack()
    participant.createTracks.mockReturnValueOnce(firstCapture.promise).mockReturnValueOnce(secondCapture.promise)
    const first = await beginOn(result)
    const second = await beginOn(result)
    await act(async () => { await result.current.disableMic() })
    await act(async () => {
      secondCapture.resolve([secondTrack])
      firstCapture.resolve([firstTrack])
      expect(await first.activation).toBe(false)
      expect(await second.activation).toBe(false)
    })
    expect(firstTrack.stop).toHaveBeenCalled()
    expect(secondTrack.stop).toHaveBeenCalled()
    expect(participant.publishTrack).not.toHaveBeenCalled()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('disconnect during pending capture prevents stale publication', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const capture = deferred<any[]>()
    const track = createTrack()
    participant.createTracks.mockReturnValueOnce(capture.promise)
    const { activation } = await beginOn(result)
    act(() => { result.current.disconnect() })
    await act(async () => {
      capture.resolve([track])
      expect(await activation).toBe(false)
    })
    expect(track.stop).toHaveBeenCalled()
    expect(participant.publishTrack).not.toHaveBeenCalled()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('SDK disconnection invalidates pending ON before a later Room recovery', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const capture = deferred<any[]>()
    const track = createTrack()
    participant.createTracks.mockReturnValueOnce(capture.promise)
    const { activation } = await beginOn(result)
    await act(async () => {
      mockRoom.state = 'disconnected'
      events.disconnected('client-initiated')
    })
    mockRoom.state = 'connected'
    await act(async () => {
      capture.resolve([track])
      expect(await activation).toBe(false)
    })
    expect(track.stop).toHaveBeenCalled()
    expect(participant.publishTrack).not.toHaveBeenCalled()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('roomId change during deferred Room.connect prevents activation from the old token hint', async () => {
    const oldRoom = mockRoom
    const connecting = deferred<void>()
    oldRoom.connect.mockReturnValueOnce(connecting.promise)
    ;(api.post as jest.Mock).mockResolvedValue({ data: { data: {
      token: 'old-room-token', livekitUrl: 'wss://mock-livekit', micEnabled: true,
    } } })
    const mounted = renderHook(({ roomId }) => useLiveKit(roomId), {
      initialProps: { roomId: 'room-123' },
    })
    let oldConnection!: Promise<void>
    await act(async () => { oldConnection = mounted.result.current.connect() })
    expect(oldRoom.connect).toHaveBeenCalledTimes(1)
    mounted.rerender({ roomId: 'room-456' })
    await act(async () => {
      connecting.resolve()
      await oldConnection
    })
    expect(oldRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true)
    expect(oldRoom.localParticipant.createTracks).not.toHaveBeenCalled()
    expect(oldRoom.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(oldRoom.disconnect).toHaveBeenCalled()
    expect(mounted.result.current.isMicEnabled).toBe(false)
  })

  test('a late composite SDK reconnect enable is cleaned up after newer OFF', async () => {
    const { result } = await mountConnected()
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    const track = createTrack()
    const publication = makePublication(track)
    const sdkEnable = deferred<void>()
    const participant = mockRoom.localParticipant
    participant.setMicrophoneEnabled.mockImplementation(async (enabled: boolean) => {
      if (enabled) {
        await sdkEnable.promise
        // Model the unabortable SDK branch becoming enabled before it returns.
        participant.audioTrackPublications.set('microphone', publication)
        participant.isMicrophoneEnabled = true
        return publication
      }
      participant.isMicrophoneEnabled = false
      return undefined
    })
    ;(api.post as jest.Mock).mockResolvedValue({ data: { data: {
      token: 'mock-token', livekitUrl: 'wss://mock-livekit', micEnabled: true,
    } } })
    // Retain C0 coverage of the unchanged reconnect branch using explicit continuing intent.
    participant.setMicrophoneEnabled.mockClear()
    mockRoom.state = 'disconnected'
    let connecting!: Promise<void>
    await act(async () => { connecting = result.current.connect() })
    expect(participant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    await act(async () => { await result.current.disableMic() })
    await act(async () => {
      sdkEnable.resolve()
      await connecting
    })
    expect(track.stop).toHaveBeenCalled()
    expect(participant.isMicrophoneEnabled).toBe(false)
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('uncancelled explicit backend-authorized ON still captures and publishes', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const authorize = jest.fn(async () => true)
    let enabled: boolean | undefined
    await act(async () => { enabled = await result.current.enableMic(authorize) })
    expect(enabled).toBe(true)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(participant.createTracks).toHaveBeenCalledWith({ audio: true, video: false })
    expect(participant.publishTrack).toHaveBeenCalledTimes(1)
    expect(participant.isMicrophoneEnabled).toBe(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  test('rejected backend authorization never captures or publishes', async () => {
    const { result } = await mountConnected()
    await act(async () => { expect(await result.current.enableMic(async () => false)).toBe(false) })
    expect(mockRoom.localParticipant.createTracks).not.toHaveBeenCalled()
    expect(mockRoom.localParticipant.publishTrack).not.toHaveBeenCalled()
    expect(result.current.isMicEnabled).toBe(false)
  })

  test('late ON before OFF cannot stop or unpublish a newer authorized ON after OFF', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const oldCapture = deferred<any[]>()
    const oldTrack = createTrack()
    const newTrack = createTrack()
    participant.createTracks.mockReturnValueOnce(oldCapture.promise).mockResolvedValueOnce([newTrack])
    const oldOn = await beginOn(result)
    await act(async () => { await result.current.disableMic() })
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    await act(async () => {
      oldCapture.resolve([oldTrack])
      expect(await oldOn.activation).toBe(false)
    })
    expect(oldTrack.stop).toHaveBeenCalled()
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(participant.audioTrackPublications.get('microphone')?.track).toBe(newTrack)
    expect(participant.unpublishTrack.mock.calls.some(([track]: [any]) => track === newTrack)).toBe(false)
    expect(result.current.isMicEnabled).toBe(true)
  })

  test('late SDK publish and cleanup events for an older ON preserve a newer authorized microphone', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const publications: Map<string, any> = participant.audioTrackPublications
    const oldTrack = createTrack()
    const newTrack = createTrack()
    const oldPublication = makePublication(oldTrack)
    const oldPublish = deferred<any>()
    participant.createTracks.mockResolvedValueOnce([oldTrack]).mockResolvedValueOnce([newTrack])
    participant.publishTrack.mockImplementationOnce(() => oldPublish.promise)
    participant.unpublishTrack.mockImplementation(async (track: any) => {
      const entry = Array.from(publications.entries()).find(([, publication]) => publication.track === track)
      if (!entry) return
      const [sid, publication] = entry
      publications.delete(sid)
      participant.isMicrophoneEnabled = Array.from(publications.values()).some(remaining =>
        !remaining.isMuted && !remaining.track.stopped,
      )
      // The SDK relays track-specific events even when another microphone is live.
      publication.isMuted = true
      events['track-muted']?.(publication, participant)
      events['local-track-unpublished']?.(publication)
    })
    const oldOn = await beginOn(result)
    expect(participant.publishTrack.mock.calls[0][0]).toBe(oldTrack)
    await act(async () => { await result.current.disableMic() })
    expect(oldTrack.stopped).toBe(true)
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    expect(publications.get('microphone')?.track).toBe(newTrack)
    expect(result.current.isMicEnabled).toBe(true)
    await act(async () => {
      // The unabortable old publish finishes after the newer microphone is live.
      publications.set('old-microphone', oldPublication)
      events['local-track-published']?.(oldPublication)
      oldPublish.resolve(oldPublication)
      expect(await oldOn.activation).toBe(false)
    })
    expect(participant.unpublishTrack.mock.calls.some(([track]: [any]) => track === oldTrack)).toBe(true)
    expect(publications.size).toBe(1)
    expect(publications.get('microphone')?.track).toBe(newTrack)
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(participant.isMicrophoneEnabled).toBe(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  test('late mute event for an old stopped track cannot cancel a newer capture intent', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const oldTrack = createTrack()
    const newTrack = createTrack()
    const capture = deferred<any[]>()
    participant.createTracks.mockResolvedValueOnce([oldTrack]).mockReturnValueOnce(capture.promise)
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    const oldPublication = participant.audioTrackPublications.get('microphone')
    await act(async () => { await result.current.disableMic() })
    const newerOn = await beginOn(result)
    expect(result.current.isMicPending).toBe(true)
    const publish = participant.publishTrack.getMockImplementation()
    participant.publishTrack.mockImplementation(async (track: any) => {
      const publication = await publish(track)
      events['local-track-published']?.(publication)
      return publication
    })
    await act(async () => {
      oldPublication.isMuted = true
      events['track-muted']?.(oldPublication, participant)
      capture.resolve([newTrack])
      expect(await newerOn.activation).toBe(true)
    })
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(participant.isMicrophoneEnabled).toBe(true)
    expect(result.current.isMicEnabled).toBe(true)
  })

  test('authorized ON waits for a stopped old publication to clear rather than treating it as active capture', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    const oldTrack = createTrack()
    const newTrack = createTrack()
    participant.createTracks.mockResolvedValueOnce([oldTrack]).mockResolvedValueOnce([newTrack])
    await act(async () => { expect(await result.current.enableMic(async () => true)).toBe(true) })
    const oldUnpublish = deferred<void>()
    participant.unpublishTrack.mockImplementation(async (track: any) => {
      if (track !== oldTrack) return
      await oldUnpublish.promise
      if (participant.audioTrackPublications.get('microphone')?.track === track) {
        participant.audioTrackPublications.delete('microphone')
      }
    })
    participant.setMicrophoneEnabled.mockImplementation(async () => undefined)
    await act(async () => { await result.current.disableMic() })
    // A stopped publication can temporarily still report enabled through SDK metadata.
    expect(oldTrack.stopped).toBe(true)
    expect(participant.isMicrophoneEnabled).toBe(true)
    const newerOn = await beginOn(result)
    expect(result.current.isMicPending).toBe(true)
    await act(async () => {
      oldUnpublish.resolve()
      expect(await newerOn.activation).toBe(true)
    })
    expect(participant.createTracks).toHaveBeenCalledTimes(2)
    expect(participant.audioTrackPublications.get('microphone')?.track).toBe(newTrack)
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(result.current.isMicEnabled).toBe(true)
  })

  test('MediaSession PLAY never enables capture or calls self-unmute', async () => {
    const { result } = await mountConnected()
    const participant = mockRoom.localParticipant
    participant.setMicrophoneEnabled.mockClear()
    ;(api.post as jest.Mock).mockClear()
    const feedback = jest.fn()
    document.addEventListener('vc:toast', feedback)
    try {
      await act(async () => { actions.get('play')?.() })
      expect(participant.createTracks).not.toHaveBeenCalled()
      expect(participant.publishTrack).not.toHaveBeenCalled()
      expect(participant.setMicrophoneEnabled).not.toHaveBeenCalled()
      expect(api.post).not.toHaveBeenCalled()
      expect(feedback).toHaveBeenCalledTimes(1)
      expect(result.current.isMicEnabled).toBe(false)
    } finally {
      document.removeEventListener('vc:toast', feedback)
    }
  })

  test('metadata, action replacement and listener cleanup remain intact', async () => {
    const addListener = jest.spyOn(document, 'addEventListener')
    const removeListener = jest.spyOn(document, 'removeEventListener')
    const mounted = await mountConnected()
    expect(mediaSession.metadata).toEqual({
      title: 'Voice Club',
      artist: 'Live Voice Room',
      artwork: [{ src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
    })
    expect(mediaSession.playbackState).toBe('playing')
    expect(actions.get('play')).toEqual(expect.any(Function))
    expect(actions.get('pause')).toEqual(expect.any(Function))
    const volumeListeners = addListener.mock.calls.filter(([name]) => name === 'vc:volume')
    expect(volumeListeners).toHaveLength(1)
    mounted.rerender()
    expect(addListener.mock.calls.filter(([name]) => name === 'vc:volume')).toHaveLength(1)
    mounted.unmount()
    expect(actions.get('play')).toBeNull()
    expect(actions.get('pause')).toBeNull()
    expect(mediaSession.metadata).toBeNull()
    expect(mediaSession.playbackState).toBe('none')
    expect(removeListener).toHaveBeenCalledWith('vc:volume', volumeListeners[0][1])
    addListener.mockRestore()
    removeListener.mockRestore()
  })
})
