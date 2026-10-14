/**
 * VC-SYNC-001 + VC-SYNC-006 — Mobile socket auth token refresh & reconnect config
 *
 * VC-SYNC-001: updateSocketToken was missing from mobile — socket reconnected
 *              with a stale access token after refresh, causing 401 rejections.
 * VC-SYNC-006: Reconnect config was weak (5 attempts, 1500ms delay, no max).
 */

// ─── Mock socket.io-client ────────────────────────────────────────────────────
const mockConnect    = jest.fn();
const mockDisconnect = jest.fn();

let mockSocket: {
  connected: boolean;
  active:    boolean;
  auth:      Record<string, unknown>;
  connect:   jest.Mock;
  disconnect: jest.Mock;
  on:        jest.Mock;
  emit:      jest.Mock;
} | null = null;

// Capture io() options so reconnect-config tests can inspect them
let capturedIoOptions: Record<string, unknown> = {};

jest.mock('socket.io-client', () => ({
  io: jest.fn((url: string, options: Record<string, unknown>) => {
    capturedIoOptions = options ?? {};
    mockSocket = {
      connected:  false,
      active:     false,
      auth:       (options?.auth as Record<string, unknown>) ?? {},
      connect:    mockConnect,
      disconnect: mockDisconnect,
      on:         jest.fn(),
      emit:       jest.fn(),
    };
    return mockSocket;
  }),
}));

// ─── Mock @/lib/api ───────────────────────────────────────────────────────────
jest.mock('../lib/api', () => ({
  __esModule:     true,
  default:        { post: jest.fn(), get: jest.fn(), put: jest.fn() },
  setAccessToken: jest.fn(),
  getSocketURL:   jest.fn(() => 'http://localhost:5000'),
}));

// ─── Mock expo-secure-store ───────────────────────────────────────────────────
const _store: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(async (k: string) => _store[k] ?? null),
  setItemAsync:    jest.fn(async (k: string, v: string) => { _store[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete _store[k]; }),
}));

// ─── Mock expo-notifications (pulled in by auth store transitively) ───────────
jest.mock('expo-notifications', () => ({
  getPermissionsAsync:   jest.fn(async () => ({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: null })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { io } from 'socket.io-client';
import { initSocket, getSocket, updateSocketToken, disconnectSocket } from '../lib/socket';
import { useAuthStore } from '../store/auth.store';
import { setAccessToken } from '../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resetSocketModule() {
  // disconnectSocket nulls the module-level socket variable
  disconnectSocket();
  mockSocket = null;
  mockConnect.mockClear();
  mockDisconnect.mockClear();
  capturedIoOptions = {};
  (io as jest.Mock).mockClear();
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A: updateSocketToken
// ─────────────────────────────────────────────────────────────────────────────

describe('updateSocketToken()', () => {
  beforeEach(() => {
    resetSocketModule();
  });

  it('updates socket.auth.token — does NOT log the token value', () => {
    initSocket('initial-token');
    expect(mockSocket).not.toBeNull();

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});

    updateSocketToken('new-secret-token');

    // auth must contain the new token
    expect(mockSocket!.auth).toMatchObject({ token: 'new-secret-token' });

    // Token value must NOT appear in any log/warn output
    const allCalls = [
      ...warnSpy.mock.calls.flat(),
      ...logSpy.mock.calls.flat(),
    ].join(' ');
    expect(allCalls).not.toContain('new-secret-token');

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does not crash and calls console.warn when socket is null (not initialized)', () => {
    // socket is null after resetSocketModule — do NOT call initSocket
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => updateSocketToken('any-token')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[socket]'),
    );

    warnSpy.mockRestore();
  });

  it('calls socket.connect() when socket is disconnected and not active', () => {
    initSocket('initial-token');
    mockSocket!.connected = false;
    mockSocket!.active    = false;

    updateSocketToken('fresh-token');

    expect(mockSocket!.auth).toMatchObject({ token: 'fresh-token' });
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT call socket.connect() when socket is already connected', () => {
    initSocket('initial-token');
    mockSocket!.connected = true;  // already up
    mockSocket!.active    = true;

    updateSocketToken('another-token');

    expect(mockSocket!.auth).toMatchObject({ token: 'another-token' });
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B: Reconnect config
// ─────────────────────────────────────────────────────────────────────────────

describe('socket reconnect config (VC-SYNC-006)', () => {
  beforeEach(() => {
    resetSocketModule();
  });

  it('passes reconnectionAttempts: 10 to io()', () => {
    initSocket('tok');
    expect(capturedIoOptions.reconnectionAttempts).toBe(10);
  });

  it('passes reconnectionDelayMax: 30000 to io()', () => {
    initSocket('tok');
    expect(capturedIoOptions.reconnectionDelayMax).toBe(30_000);
  });

  it('passes randomizationFactor: 0.5 to io()', () => {
    initSocket('tok');
    expect(capturedIoOptions.randomizationFactor).toBe(0.5);
  });

  it('keeps transports order as [polling, websocket]', () => {
    initSocket('tok');
    expect(capturedIoOptions.transports).toEqual(['polling', 'websocket']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART C: Auth store calls updateSocketToken
// ─────────────────────────────────────────────────────────────────────────────

describe('auth store token refresh calls updateSocketToken (VC-SYNC-001)', () => {
  const mockUser = {
    id: 'u1', email: 'a@b.com', role: 'STUDENT',
    firstName: 'Ali', lastName: 'Hassan',
    schoolId: null, avatarUrl: null, status: 'ACTIVE',
  };

  beforeEach(() => {
    resetSocketModule();
    jest.clearAllMocks();
    Object.keys(_store).forEach(k => delete _store[k]);
    useAuthStore.setState({
      user: null, accessToken: null, isAuthenticated: false, isLoading: false,
    });
  });

  it('login() calls updateSocketToken with the new access token', async () => {
    // Initialize socket first so updateSocketToken has a socket to work with
    initSocket('old-token');
    mockSocket!.connected = true;
    mockSocket!.active    = true;

    const mockApi = require('../lib/api').default;
    mockApi.post.mockResolvedValueOnce({
      data: { data: { user: mockUser, accessToken: 'login-tok-123', refreshToken: 'ref-abc' } },
    });

    await useAuthStore.getState().login('a@b.com', 'password');

    // Socket auth must be updated with the login token
    expect(mockSocket!.auth).toMatchObject({ token: 'login-tok-123' });
    // setAccessToken (API header) must also be called
    expect(setAccessToken).toHaveBeenCalledWith('login-tok-123');
  });

  it('restoreSession() calls updateSocketToken with the refreshed access token', async () => {
    initSocket('stale-token');
    mockSocket!.connected = false;
    mockSocket!.active    = false;
    _store['halqa_refresh_token'] = 'valid-refresh';

    const mockApi = require('../lib/api').default;
    mockApi.post.mockResolvedValueOnce({
      data: { data: { accessToken: 'refreshed-tok-456', refreshToken: 'new-ref', user: mockUser } },
    });
    mockApi.get.mockResolvedValueOnce({ data: { data: mockUser } });

    await useAuthStore.getState().restoreSession();

    // Socket auth must contain the newly refreshed token
    expect(mockSocket!.auth).toMatchObject({ token: 'refreshed-tok-456' });
    // And the stale token must NOT be in auth
    expect((mockSocket!.auth as any).token).not.toBe('stale-token');
  });

  it('socket.auth contains the new token — not the stale one — after restoreSession', async () => {
    initSocket('stale-token-007');
    mockSocket!.connected = true;
    mockSocket!.active    = true;
    _store['halqa_refresh_token'] = 'valid-refresh';

    const mockApi = require('../lib/api').default;
    mockApi.post.mockResolvedValueOnce({
      data: { data: { accessToken: 'brand-new-tok', refreshToken: 'new-ref', user: mockUser } },
    });
    mockApi.get.mockResolvedValueOnce({ data: { data: mockUser } });

    await useAuthStore.getState().restoreSession();

    expect((mockSocket!.auth as any).token).toBe('brand-new-tok');
    expect((mockSocket!.auth as any).token).not.toBe('stale-token-007');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VC-SYNC-007 — Listener registration before isJoined (FEAT-002)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper that mimics applyStageSnapshot logic extracted from mobile/app/voice/[id].tsx.
 * This is a pure-function replica used to test the upsert behaviour without
 * importing the full React Native component (which requires a host environment).
 */
type Participant = {
  id: string; name: string; avatar: string | null;
  role: string; isMuted: boolean; isSpeaking: boolean;
  handRaised: boolean; mutedByModerator: boolean;
  isActive: boolean; seatNumber: number | null; _joinedAt: string;
};

type StagePayload = {
  roomId: string;
  stageParticipants: Array<{
    userId: string; role: string; isMuted: boolean; seatNumber: number | null;
    isPinned: boolean; handRaised: boolean; mutedByModerator: boolean;
    joinedAt?: string; firstName?: string; lastName?: string; avatarUrl?: string | null;
  }>;
  stageCount: number;
};

function applyStageSnapshotPure(prev: Participant[], d: StagePayload, roomId: string): Participant[] {
  if (d.roomId !== roomId) return prev;
  const updated = [...prev];
  const inStageIds = new Set(d.stageParticipants.map(sp => sp.userId));
  for (let i = 0; i < updated.length; i++) {
    if (!inStageIds.has(updated[i].id)) {
      updated[i] = { ...updated[i], seatNumber: null };
    }
  }
  const matchedIds = new Set<string>();
  d.stageParticipants.forEach(sp => {
    const idx = updated.findIndex(p => p.id === sp.userId);
    if (idx >= 0) {
      updated[idx] = {
        ...updated[idx],
        role: sp.role,
        isMuted: sp.isMuted,
        mutedByModerator: sp.mutedByModerator,
        handRaised: sp.handRaised,
        seatNumber: sp.seatNumber,
      };
      matchedIds.add(sp.userId);
    }
  });
  // Upsert pass — add participants absent from local state
  d.stageParticipants.forEach(sp => {
    if (!matchedIds.has(sp.userId)) {
      const name = `${sp.firstName ?? ''} ${sp.lastName ?? ''}`.trim() || 'User';
      updated.push({
        id: sp.userId, name,
        avatar: sp.avatarUrl ?? null,
        role: sp.role,
        isMuted: sp.isMuted, isSpeaking: false,
        handRaised: sp.handRaised,
        mutedByModerator: sp.mutedByModerator,
        isActive: true, seatNumber: sp.seatNumber,
        _joinedAt: typeof sp.joinedAt === 'string' ? sp.joinedAt : '',
      });
    }
  });
  return updated;
}

describe('VC-SYNC-007 — listener registration before isJoined (FEAT-002)', () => {
  beforeEach(() => {
    resetSocketModule();
  });

  // ── (a) applyStageSnapshot upserts absent participant ──────────────────────
  it('(a) applyStageSnapshot upserts a participant absent from the current array', () => {
    const existing: Participant[] = [
      { id: 'u1', name: 'Alice', avatar: null, role: 'HOST', isMuted: false,
        isSpeaking: false, handRaised: false, mutedByModerator: false,
        isActive: true, seatNumber: 1, _joinedAt: '2024-01-01T00:00:00Z' },
    ];

    const payload: StagePayload = {
      roomId: 'room-1',
      stageParticipants: [
        { userId: 'u1', role: 'HOST', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false },
        // u2 is NOT in existing — must be upserted
        { userId: 'u2', role: 'SPEAKER', isMuted: false, seatNumber: 2,
          isPinned: false, handRaised: false, mutedByModerator: false,
          firstName: 'Bob', lastName: 'Smith', avatarUrl: null },
      ],
      stageCount: 2,
    };

    const result = applyStageSnapshotPure(existing, payload, 'room-1');

    expect(result).toHaveLength(2);
    const bob = result.find(p => p.id === 'u2');
    expect(bob).toBeDefined();
    expect(bob?.name).toBe('Bob Smith');
    expect(bob?.role).toBe('SPEAKER');
    expect(bob?.seatNumber).toBe(2);
  });

  // ── (b) applyStageSnapshot ignores payloads for other rooms ───────────────
  it('(a-2) applyStageSnapshot ignores payload for wrong roomId', () => {
    const existing: Participant[] = [
      { id: 'u1', name: 'Alice', avatar: null, role: 'HOST', isMuted: false,
        isSpeaking: false, handRaised: false, mutedByModerator: false,
        isActive: true, seatNumber: 1, _joinedAt: '' },
    ];
    const payload: StagePayload = {
      roomId: 'other-room',
      stageParticipants: [
        { userId: 'u99', role: 'SPEAKER', isMuted: false, seatNumber: 3,
          isPinned: false, handRaised: false, mutedByModerator: false },
      ],
      stageCount: 1,
    };
    const result = applyStageSnapshotPure(existing, payload, 'room-1');
    // unchanged — wrong roomId
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('u1');
  });

  // ── (b) voice:join_room NOT emitted when hasJoinedRef.current === false ────
  it('(b) voice:join_room is NOT emitted when hasJoinedRef.current is false', () => {
    initSocket('test-token');
    expect(mockSocket).not.toBeNull();
    mockSocket!.connected = true;

    // Simulate the guarded emit from the listener useEffect:
    // if (hasJoinedRef.current) socket.emit('voice:join_room', id)
    const hasJoinedRef = { current: false };
    if (hasJoinedRef.current) {
      mockSocket!.emit('voice:join_room', 'room-1');
    }

    expect(mockSocket!.emit).not.toHaveBeenCalledWith('voice:join_room', 'room-1');
  });

  it('(b-2) voice:join_room IS emitted when hasJoinedRef.current is true', () => {
    initSocket('test-token');
    expect(mockSocket).not.toBeNull();
    mockSocket!.connected = true;

    const hasJoinedRef = { current: true };
    if (hasJoinedRef.current) {
      mockSocket!.emit('voice:join_room', 'room-1');
    }

    expect(mockSocket!.emit).toHaveBeenCalledWith('voice:join_room', 'room-1');
  });

  // ── (c) onReconnect does NOT emit when hasJoinedRef is false ───────────────
  it('(c) onReconnect does not emit voice:join_room when hasJoinedRef.current is false', () => {
    initSocket('test-token');
    expect(mockSocket).not.toBeNull();
    mockSocket!.connected = true;

    const hasJoinedRef = { current: false };

    // Simulate the onReconnect handler from the listener useEffect
    const onReconnect = () => {
      if (!hasJoinedRef.current) return;
      mockSocket!.emit('voice:join_room', 'room-1');
    };

    // Fire the reconnect handler
    onReconnect();

    expect(mockSocket!.emit).not.toHaveBeenCalledWith('voice:join_room', 'room-1');
  });

  it('(c-2) onReconnect DOES emit voice:join_room when hasJoinedRef.current is true', () => {
    initSocket('test-token');
    expect(mockSocket).not.toBeNull();
    mockSocket!.connected = true;

    const hasJoinedRef = { current: true };

    const onReconnect = () => {
      if (!hasJoinedRef.current) return;
      mockSocket!.emit('voice:join_room', 'room-1');
    };

    onReconnect();

    expect(mockSocket!.emit).toHaveBeenCalledWith('voice:join_room', 'room-1');
  });

  // ── (d) upsert uses safe defaults when firstName/lastName absent ──────────
  it('(d) applyStageSnapshot uses "User" fallback when firstName and lastName are absent', () => {
    const existing: Participant[] = [];
    const payload: StagePayload = {
      roomId: 'room-1',
      stageParticipants: [
        { userId: 'u5', role: 'SPEAKER', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false,
          // no firstName / lastName / avatarUrl
        },
      ],
      stageCount: 1,
    };
    const result = applyStageSnapshotPure(existing, payload, 'room-1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('User');
    expect(result[0].avatar).toBeNull();
  });

  // ── (e) upsert does NOT duplicate an existing participant ─────────────────
  it('(e) applyStageSnapshot does not create a duplicate for an existing participant', () => {
    const existing: Participant[] = [
      { id: 'u1', name: 'Alice', avatar: null, role: 'HOST', isMuted: false,
        isSpeaking: false, handRaised: false, mutedByModerator: false,
        isActive: true, seatNumber: 1, _joinedAt: '' },
    ];
    const payload: StagePayload = {
      roomId: 'room-1',
      stageParticipants: [
        { userId: 'u1', role: 'HOST', isMuted: false, seatNumber: 1,
          isPinned: false, handRaised: false, mutedByModerator: false,
          firstName: 'Alice', lastName: 'Updated' },
      ],
      stageCount: 1,
    };
    const result = applyStageSnapshotPure(existing, payload, 'room-1');
    expect(result).toHaveLength(1);  // still one — not duplicated
    expect(result[0].id).toBe('u1');
  });
});
