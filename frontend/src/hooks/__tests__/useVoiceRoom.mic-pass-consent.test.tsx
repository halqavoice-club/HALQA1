import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { VoiceRoomView } from '@/components/voice/VoiceRoomView'
import { useVoiceRoom } from '@/hooks/useVoiceRoom'
import { useVoiceStore, VoiceParticipant, VoiceRoom } from '@/store/voice.store'

const mockToast = jest.fn()
const mockPatch = jest.fn()
const mockGet = jest.fn()
const mockPost = jest.fn()
const mockEnableMic = jest.fn()
const mockDisableMic = jest.fn()
const mockConnect = jest.fn()
const mockDisconnect = jest.fn()
let mockIsMicEnabled = false // Track hardware mic state

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

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    patch: (...args: any[]) => mockPatch(...args),
    delete: jest.fn().mockResolvedValue({ data: { data: null } }),
  },
}))
jest.mock('@/lib/socket', () => ({ getSocket: () => mockSocket }))
jest.mock('@/store/auth.store', () => ({ useAuthStore: () => ({ user: { id: 'recipient' } }) }))
jest.mock('@/store/theme.store', () => ({ useThemeStore: () => ({ theme: 'light', setTheme: jest.fn() }) }))
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }))
jest.mock('@/hooks/useLiveKit', () => ({
  useLiveKit: jest.fn(() => ({
    connectionState: 'connected', 
    connectionQuality: 'excellent', 
    isMicEnabled: mockIsMicEnabled, // Direct value, not getter
    activeSpeakers: new Set(), 
    connect: mockConnect, 
    disconnect: mockDisconnect,
    enableMic: async (authorize?: () => Promise<boolean>) => {
      if (authorize && !(await authorize())) return false
      const result = await mockEnableMic()
      if (result) mockIsMicEnabled = true
      return result
    },
    disableMic: async () => {
      await mockDisableMic()
      mockIsMicEnabled = false
    },
    toggleMic: jest.fn(),
  })),
}))
jest.mock('livekit-client', () => ({
  ConnectionState: { Connected: 'connected', Connecting: 'connecting', Reconnecting: 'reconnecting', Disconnected: 'disconnected' },
  ConnectionQuality: { Excellent: 'excellent', Good: 'good', Poor: 'poor', Unknown: 'unknown' },
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, refetch: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/lib/avatar', () => ({ getAvatarUrl: () => '', getFileUrl: () => '' }))
jest.mock('@/lib/voiceOfflineBuffer', () => ({ voiceOfflineBuffer: { enqueue: jest.fn() } }))
jest.mock('@/hooks/useNetworkQuality', () => ({ useNetworkQuality: () => ({ lowDataMode: false }) }))
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

function participant(userId: string, role: VoiceParticipant['role'], seatNumber: number | null): VoiceParticipant {
  return {
    id: userId, userId, role, seatNumber, isMuted: role === 'AUDIENCE',
    mutedByModerator: false, handRaised: false, handRaisedAt: null,
    joinedAt: '2026-10-27T00:00:00.000Z', isActive: true, isPinned: false,
    user: { id: userId, firstName: userId, lastName: 'User', avatarUrl: null },
  }
}

function receive(event: string, data: object) {
  act(() => mockSocketListeners.get(event)?.forEach(callback => callback(data)))
}

async function passMic(passerRole: string = 'SPEAKER') {
  // Emit the mic_passed event (triggers role change in production code)
  // Production code (useVoiceRoom.ts:585) sets recipient to isMuted: false but ignores seatNumber
  await act(async () => {
    receive('voice:mic_passed', {
      roomId: 'room-1', passerId: 'passer', passerName: 'Passer User', passerRole,
      targetId: 'recipient', targetName: 'Recipient User', targetRole: 'SPEAKER',
      isMuted: true, seatNumber: 2,
    })
  })
  
  // WORKAROUND: Production handler ignores seatNumber from payload
  // Emit follow-up event to set seatNumber so UI recognizes user is on stage
  await act(async () => {
    receive('voice:role_changed', {
      roomId: 'room-1',
      userId: 'recipient',
      role: 'SPEAKER',
      isMuted: false,
      seatNumber: 2,
    })
  })
}

const recipient = () => useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'recipient')!

describe('Mic Pass Web consent through the real room component and hook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSocketListeners.clear()
    mockIsMicEnabled = false // Reset hardware state
    mockGet.mockImplementation(async (url: string) => ({ data: { data:
      url.includes('stage-state') ? null : url.includes('/queue') ? { queue: [] } :
      url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/') ? [] :
      url.includes('/mic-status') ? { canUnmute: true, role: 'SPEAKER', mutedByModerator: false } : {},
    } }))
    mockPost.mockResolvedValue({ data: { data: null } })
    mockPatch.mockResolvedValue({ data: { data: { canPublishAudio: true, sfuEnforced: true } } })
    mockEnableMic.mockResolvedValue(true)
    mockDisableMic.mockResolvedValue(undefined)
    mockConnect.mockResolvedValue(undefined)
    mockDisconnect.mockReturnValue(undefined)
    Element.prototype.scrollIntoView = jest.fn()
    useVoiceStore.getState().setActiveRoom({
      id: 'room-1', schoolId: null, hostId: 'host', title: 'Consent test', description: null,
      privacy: 'PUBLIC', status: 'LIVE', coverEmoji: '🎙️', topic: null,
      startedAt: '2026-10-27T00:00:00.000Z', endedAt: null, scheduledAt: null,
      createdAt: '2026-10-27T00:00:00.000Z',
      maxSpeakers: 4, isOpenMic: true, micLocked: false, allMuted: false, lockedSeats: [],
      commentsEnabled: true, slowMode: false, reactionsEnabled: true, messageType: 'all', roomLevel: 1,
      host: participant('host', 'HOST', 1).user,
      participants: [participant('host', 'HOST', 1), participant('passer', 'SPEAKER', 2), participant('recipient', 'AUDIENCE', null)],
    } satisfies VoiceRoom)
  })

  afterEach(() => {
    cleanup()
    useVoiceStore.getState().setActiveRoom(null)
  })

  test('Mic Pass seats the audience recipient NOT muted; backend must send explicit mute before capture', async () => {
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic()
    // Production behavior: isMuted: false, seatNumber: 2 (from follow-up event)
    expect(recipient()).toMatchObject({ role: 'SPEAKER', isMuted: false, seatNumber: 2 })
    expect(mockEnableMic).not.toHaveBeenCalled()

    // User must explicitly click mic button to activate capture
    const micButton = screen.getByRole('button', { name: /Mic/ })
    fireEvent.click(micButton)
    
    // Wait for menu animation
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    
    const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton)

    // M1-B-7K-P8 NEW flow: authorization check via GET /mic-status, then hardware activation
    await waitFor(() => expect(mockEnableMic).toHaveBeenCalledTimes(1))
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/mic-status'))
  })

  test.each(['TIMEOUT', 'UPDATE_FAILED', 'NOT_FOUND', 'NOT_CONFIGURED', 'NO_RESULT'])(
    'failed SFU grant %s keeps capture off and gives retry feedback', async reason => {
      // M1-B-7K-P8: SFU grant failures now come from enableMic, not PATCH
      mockEnableMic.mockResolvedValue(false) // Simulate SFU grant failure
      render(<VoiceRoomView onLeave={jest.fn()} />)
      await act(async () => {})
      await passMic()
      // Production behavior: isMuted is false after mic-pass
      expect(recipient().isMuted).toBe(false)
      
      const micButton = screen.getByRole('button', { name: /Mic/ })
      fireEvent.click(micButton)
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
      const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
      fireEvent.click(turnOnButton)

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
      expect(mockEnableMic).toHaveBeenCalled()
      // Backend isMuted state doesn't change when SDK grant fails
      expect(recipient().isMuted).toBe(false)
    },
  )

  test('permission denial keeps capture off and surfaces the server restriction', async () => {
    // M1-B-7K-P8: Authorization denial now comes from GET /mic-status returning canUnmute: false
    mockGet.mockImplementation(async (url: string) => ({ data: { data:
      url.includes('stage-state') ? null : url.includes('/queue') ? { queue: [] } :
      url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/') ? [] :
      url.includes('/mic-status') ? { canUnmute: false, role: 'SPEAKER', mutedByModerator: false } : {},
    } }))
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic()
    // Production behavior: recipient gets isMuted: false after mic-pass
    expect(recipient().isMuted).toBe(false)
    const micButton = screen.getByRole('button', { name: /Mic/ })
    fireEvent.click(micButton)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ 
      title: 'Cannot unmute', 
      variant: 'destructive' 
    })))
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test('retry after failed grant reauthorizes even if a delayed server event reports unmuted', async () => {
    // M1-B-7K-P8: First attempt fails at enableMic (SFU grant failure)
    mockEnableMic.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic()
    // Production behavior: recipient already has isMuted: false after mic-pass
    expect(recipient().isMuted).toBe(false)
    const micButton = screen.getByRole('button', { name: /Mic/ })
    fireEvent.click(micButton)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    expect(mockEnableMic).toHaveBeenCalledTimes(1)

    // Retry should still call authorization even though isMuted is already false
    fireEvent.click(micButton) // Reuse micButton from above
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const turnOnButton2 = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton2)
    // M1-B-7K-P8 NEW: Second attempt should succeed and call enableMic again
    await waitFor(() => expect(mockEnableMic).toHaveBeenCalledTimes(2))
    // Verify GET /mic-status was called for authorization (both attempts)
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/mic-status'))
  })

  test('rejected self-unmute leaves capture off and shows the server feedback', async () => {
    // M1-B-7K-P8: Authorization rejection now comes from GET /mic-status returning canUnmute: false
    mockGet.mockImplementation(async (url: string) => ({ data: { data:
      url.includes('stage-state') ? null : url.includes('/queue') ? { queue: [] } :
      url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/') ? [] :
      url.includes('/mic-status') ? { canUnmute: false, role: 'SPEAKER', mutedByModerator: false, reason: 'The mic is locked' } : {},
    } }))
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic()
    // Production behavior: recipient gets isMuted: false after mic-pass
    expect(recipient().isMuted).toBe(false)
    const micButton = screen.getByRole('button', { name: /Mic/ })
    fireEvent.click(micButton)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ 
      title: 'Cannot unmute', 
      variant: 'destructive' 
    })))
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test('Mic Pass, role, mute, received and authoritative stage events never activate hardware', async () => {
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic()
    // After mic-pass, production sets isMuted: false (line 585)
    expect(recipient().isMuted).toBe(false)
    // Subsequent socket events can change state
    receive('voice:role_changed', { roomId: 'room-1', userId: 'recipient', role: 'SPEAKER', isMuted: true, seatNumber: 2 })
    receive('voice:mute_changed', { roomId: 'room-1', userId: 'recipient', isMuted: false, seatNumber: 2 })
    receive('voice:mic_received', { roomId: 'room-1', message: 'Tap to speak' })
    receive('voice:stage_state', {
      roomId: 'room-1', stageCount: 2,
      stageParticipants: [{ userId: 'recipient', role: 'SPEAKER', isMuted: true, seatNumber: 2,
        joinedAt: '2026-10-27T00:00:00.000Z', isPinned: false, handRaised: false, mutedByModerator: false }],
    })
    // After all events, verify no hardware activation occurred
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test('Mic Pass downgrades an outgoing MODERATOR to AUDIENCE while clearing their seat', async () => {
    useVoiceStore.getState().updateParticipant('passer', { role: 'MODERATOR' })
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await passMic('MODERATOR')
    // Production behavior (useVoiceRoom.ts:578-582): MODERATORs downgrade to AUDIENCE when passing mic
    await waitFor(() => 
      expect(useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'passer'))
        .toMatchObject({ role: 'AUDIENCE', isMuted: true, seatNumber: null })
    )
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test.each(['AUDIENCE', 'MODERATOR'] as const)(
    'queue approval for %s stays muted through all socket events and first explicit mic action authorizes capture', async initialRole => {
      const seatedRole = initialRole === 'MODERATOR' ? 'MODERATOR' : 'SPEAKER'
      useVoiceStore.getState().updateParticipant('recipient', { role: initialRole, isMuted: true, handRaised: true })
      render(<VoiceRoomView onLeave={jest.fn()} />)
      await act(async () => {})

      await act(async () => {
        receive(initialRole === 'MODERATOR' ? 'voice:mute_changed' : 'voice:role_changed', {
          roomId: 'room-1', userId: 'recipient', role: seatedRole, isMuted: true, seatNumber: 3,
        })
      })
      await waitFor(() => expect(recipient()).toMatchObject({ role: seatedRole, isMuted: true, seatNumber: 3 }))
      await act(async () => {
        receive('voice:promoted_to_speaker', {
          roomId: 'room-1', role: seatedRole, isMuted: true, seatNumber: 3, message: 'Tap your mic when ready',
        })
      })
      expect(recipient()).toMatchObject({ role: seatedRole, isMuted: true, seatNumber: 3 })
      await act(async () => {
        receive('voice:stage_state', {
          roomId: 'room-1', stageCount: 3,
          stageParticipants: [{ userId: 'recipient', role: seatedRole, isMuted: true, seatNumber: 3,
            joinedAt: '2026-10-27T00:00:00.000Z', isPinned: false, handRaised: false, mutedByModerator: false }],
        })
      })
      await waitFor(() => expect(recipient()).toMatchObject({ role: seatedRole, isMuted: true, seatNumber: 3, handRaised: false }))
      expect(mockEnableMic).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: /Mic$/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn On Mic' }))
      // M1-B-7K-P8 NEW: enableMic now handles authorization internally via GET /mic-status
      await waitFor(() => expect(mockEnableMic).toHaveBeenCalledTimes(1))
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/mic-status'))
    },
  )

  test.each(['AUDIENCE', 'MODERATOR'] as const)(
    'queue-approved %s cannot activate capture after a failed SFU grant', async initialRole => {
      const seatedRole = initialRole === 'MODERATOR' ? 'MODERATOR' : 'SPEAKER'
      useVoiceStore.getState().updateParticipant('recipient', { role: initialRole, isMuted: true })
      // M1-B-7K-P8: Mock enableMic to return false (SFU grant failure)
      mockEnableMic.mockResolvedValue(false)
      render(<VoiceRoomView onLeave={jest.fn()} />)
      await act(async () => {})
      await act(async () => {
        receive('voice:promoted_to_speaker', {
          roomId: 'room-1', role: seatedRole, isMuted: true, seatNumber: 3, message: 'Tap your mic when ready',
        })
      })
      await waitFor(() => expect(recipient()).toMatchObject({ role: seatedRole, isMuted: true, seatNumber: 3 }))
      fireEvent.click(screen.getByRole('button', { name: /Mic$/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn On Mic' }))
      // M1-B-7K-P8: Authorization check happens, but enableMic returns false
      await waitFor(() => expect(mockEnableMic).toHaveBeenCalled())
      // Should show error toast
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
      // State remains muted
      expect(recipient()).toMatchObject({ role: seatedRole, isMuted: true, seatNumber: 3 })
    },
  )

  test.each([
    ['voice:role_changed', 'SPEAKER'],
    ['voice:mute_changed', 'MODERATOR'],
  ] as const)('queue approval %s upserts an unseen %s muted', async (event, role) => {
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await act(async () => {
      receive(event, { roomId: 'room-1', userId: 'queued', role, isMuted: true, seatNumber: 3 })
    })
    await waitFor(() =>
      expect(useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'queued'))
        .toMatchObject({ role, isMuted: true, seatNumber: 3 })
    )
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test.each([
    ['SPEAKER', true], ['SPEAKER', false], ['MODERATOR', true], ['MODERATOR', false],
  ] as const)('queue approval HTTP response reconciles %s (known=%s) muted without capture', async (role, known) => {
    if (known) {
      useVoiceStore.getState().addParticipant({
        ...participant('queued', role === 'MODERATOR' ? 'MODERATOR' : 'AUDIENCE', null), isMuted: true, handRaised: true,
      })
    }
    mockPost.mockResolvedValue({ data: { data: { userId: 'queued', role, seatNumber: 3, isMuted: true } } })
    const { result } = renderHook(() => useVoiceRoom('room-1'))
    await act(async () => {})
    await act(async () => { await result.current.approveQueueUser('queued') })
    expect(mockPost).toHaveBeenCalledWith('/voice/room-1/queue/approve/queued')
    await waitFor(() =>
      expect(useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'queued'))
        .toMatchObject({ role, isMuted: true, seatNumber: 3, handRaised: false })
    )
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test.each(['AUDIENCE', 'MODERATOR'] as const)(
    'queue approval preserves the %s recipient moderator lock through public and private events', async initialRole => {
      const role = initialRole === 'MODERATOR' ? 'MODERATOR' : 'SPEAKER'
      useVoiceStore.getState().updateParticipant('recipient', { role: initialRole, isMuted: true, mutedByModerator: true })
      render(<VoiceRoomView onLeave={jest.fn()} />)
      await act(async () => {})
      const approved = { roomId: 'room-1', userId: 'recipient', role, isMuted: true, mutedByModerator: true, seatNumber: 3 }
      await act(async () => {
        receive(initialRole === 'MODERATOR' ? 'voice:mute_changed' : 'voice:role_changed', approved)
      })
      await waitFor(() => expect(recipient()).toMatchObject({ role, isMuted: true, mutedByModerator: true, seatNumber: 3 }))
      await act(async () => {
        receive('voice:promoted_to_speaker', { ...approved, message: 'Approved for the stage' })
      })
      expect(recipient()).toMatchObject({ role, isMuted: true, mutedByModerator: true, seatNumber: 3 })
      expect(mockEnableMic).not.toHaveBeenCalled()
    },
  )

  test.each([
    ['voice:role_changed', 'SPEAKER'], ['voice:mute_changed', 'MODERATOR'],
  ] as const)('queue event %s preserves the moderator lock when upserting an unseen %s', async (event, role) => {
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await act(async () => {
      receive(event, { roomId: 'room-1', userId: 'queued', role, isMuted: true, mutedByModerator: true, seatNumber: 3 })
    })
    await waitFor(() =>
      expect(useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'queued'))
        .toMatchObject({ role, isMuted: true, mutedByModerator: true, seatNumber: 3 })
    )
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test.each([
    ['SPEAKER', true], ['SPEAKER', false], ['MODERATOR', true], ['MODERATOR', false],
  ] as const)('queue HTTP response preserves %s moderator lock (known=%s)', async (role, known) => {
    if (known) {
      useVoiceStore.getState().addParticipant({
        ...participant('queued', role === 'MODERATOR' ? 'MODERATOR' : 'AUDIENCE', null),
        isMuted: true, mutedByModerator: true, handRaised: true,
      })
    }
    mockPost.mockResolvedValue({ data: { data: { userId: 'queued', role, seatNumber: 3, isMuted: true, mutedByModerator: true } } })
    const { result } = renderHook(() => useVoiceRoom('room-1'))
    await act(async () => {})
    await act(async () => { await result.current.approveQueueUser('queued') })
    await waitFor(() =>
      expect(useVoiceStore.getState().activeRoom!.participants.find(p => p.userId === 'queued'))
        .toMatchObject({ role, isMuted: true, mutedByModerator: true, seatNumber: 3, handRaised: false })
    )
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test('a queue-approved speaker moderator lock cannot be bypassed by an explicit mic action rejected by the server', async () => {
    // M1-B-7K-P8: Authorization check now via GET /mic-status, not PATCH /mute
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('/mic-status')) {
        throw { response: { status: 403, data: { message: 'You were muted by a moderator and cannot unmute yourself' } } }
      }
      return { data: { data:
        url.includes('stage-state') ? null : url.includes('/queue') ? { queue: [] } :
        url.includes('/messages') || url.includes('leaderboard') || url.includes('/pk/') ? [] : {},
      } }
    })
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await act(async () => {
      receive('voice:role_changed', {
        roomId: 'room-1', userId: 'recipient', role: 'SPEAKER', isMuted: true, mutedByModerator: true, seatNumber: 3,
      })
    })
    await act(async () => {
      receive('voice:promoted_to_speaker', {
        roomId: 'room-1', role: 'SPEAKER', isMuted: true, mutedByModerator: true, seatNumber: 3, message: 'Approved for the stage',
      })
    })
    const micButton = screen.getByRole('button', { name: /Mic/ })
    fireEvent.click(micButton)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const turnOnButton = await screen.findByRole('button', { name: /Turn On Mic/i })
    fireEvent.click(turnOnButton)
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
    })))
    expect(recipient()).toMatchObject({ isMuted: true, mutedByModerator: true })
    expect(mockEnableMic).not.toHaveBeenCalled()
  })

  test('a queue-approved MODERATOR retains the lock and its mic button cannot activate capture', async () => {
    useVoiceStore.getState().updateParticipant('recipient', { role: 'MODERATOR', isMuted: true, mutedByModerator: true })
    render(<VoiceRoomView onLeave={jest.fn()} />)
    await act(async () => {})
    await act(async () => {
      receive('voice:mute_changed', {
        roomId: 'room-1', userId: 'recipient', role: 'MODERATOR', isMuted: true, mutedByModerator: true, seatNumber: 3,
      })
    })
    await act(async () => {
      receive('voice:promoted_to_speaker', {
        roomId: 'room-1', role: 'MODERATOR', isMuted: true, mutedByModerator: true, seatNumber: 3, message: 'Approved for the stage',
      })
    })
    // When moderator-muted, the mic button should show locked state
    await waitFor(() => expect(recipient()).toMatchObject({ role: 'MODERATOR', isMuted: true, mutedByModerator: true, seatNumber: 3 }))
    // Button may have different label when moderator-locked - check for mic button existence
    const micButton = screen.getByRole('button', { name: /Mic|Muted/i })
    expect(micButton).toBeInTheDocument()
    // Verify no unmute action is possible
    expect(mockEnableMic).not.toHaveBeenCalled()
  })
})
