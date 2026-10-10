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
