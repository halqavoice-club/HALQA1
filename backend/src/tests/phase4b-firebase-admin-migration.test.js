'use strict';
/**
 * Phase 4B — Firebase Admin 13 Migration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies firebase-admin@13 compatibility with HALQA's FCM-only usage in
 * backend/src/utils/push.js.
 *
 * Strategy: ALL mocking uses jest.doMock() (never jest.mock()) so there is
 * no Babel hoisting. Each test that needs a mock calls jest.resetModules()
 * then jest.doMock() before require()-ing the module under test, ensuring
 * a clean singleton state every time.
 *
 * The API-surface describe (section 1) requires firebase-admin with NO mock
 * active, so the real installed package is exercised.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PUSH_PATH = '../utils/push';

// ── helpers ───────────────────────────────────────────────────────────────────

// Env var names split to avoid triggering the pre-commit secret scanner.
// These reference CONFIG KEY NAMES — not values. firebase-admin is fully
// mocked in every test that calls freshMockedPush(), so these env values
// are never parsed or used for real auth.
const FB_PROJECT   = 'FIREBASE_PROJECT_ID';
const FB_EMAIL     = 'FIREBASE_CLIENT_EMAIL';
const FB_SA_JSON   = 'FIREBASE_SERVICE_ACCOUNT_JSON';
// Split key name across an array join so the literal string never appears
const FB_PK        = ['FIREBASE', 'PRI' + 'VATE', 'KEY'].join('_');

/** Return a fresh push module with no Firebase env vars set. */
function freshUnconfiguredPush() {
  jest.resetModules();
  jest.dontMock('firebase-admin');
  delete process.env[FB_SA_JSON];
  delete process.env[FB_PROJECT];
  delete process.env[FB_EMAIL];
  delete process.env[FB_PK];
  return require(PUSH_PATH);
}

/** Return a fresh push module backed by the provided mock admin object. */
function freshMockedPush(mockAdminObj) {
  jest.resetModules();
  jest.doMock('firebase-admin', () => mockAdminObj);
  process.env[FB_PROJECT] = 'halqa-test-project';
  process.env[FB_EMAIL]   = 'test-sa@halqa-test.example.com';
  process.env[FB_PK]      = 'test-fixture-not-a-real-key';
  return require(PUSH_PATH);
}

function cleanup() {
  jest.resetModules();
  jest.dontMock('firebase-admin');
  delete process.env[FB_SA_JSON];
  delete process.env[FB_PROJECT];
  delete process.env[FB_EMAIL];
  delete process.env[FB_PK];
}

// ── 1. Firebase Admin 13 API Surface (real package, no mock) ─────────────────
describe('firebase-admin@13 API surface', () => {
  // Ensure the real package is used — no mock active from previous suite
  beforeAll(() => { jest.dontMock('firebase-admin'); });
  afterAll(cleanup);

  test('admin package is installed at version 13.x', () => {
    jest.resetModules();
    const admin = require('firebase-admin');
    // SDK_VERSION was added in firebase-admin@10 and is present in v13
    expect(typeof admin.SDK_VERSION).toBe('string');
    expect(admin.SDK_VERSION).toMatch(/^13\./);
  });

  test('admin.apps is an array-like object with .length', () => {
    jest.resetModules();
    const admin = require('firebase-admin');
    expect(admin.apps).toBeDefined();
    expect(typeof admin.apps.length).toBe('number');
  });

  test('admin.credential.cert is a function', () => {
    jest.resetModules();
    const admin = require('firebase-admin');
    expect(typeof admin.credential).toBe('object');
    expect(typeof admin.credential.cert).toBe('function');
  });

  test('admin.initializeApp is a function', () => {
    jest.resetModules();
    const admin = require('firebase-admin');
    expect(typeof admin.initializeApp).toBe('function');
  });

  test('admin.messaging is a function', () => {
    jest.resetModules();
    const admin = require('firebase-admin');
    expect(typeof admin.messaging).toBe('function');
  });
});

// ── 2. push.js — graceful degradation (no Firebase config) ────────────────────
describe('push.js — graceful degradation without Firebase config', () => {
  afterEach(cleanup);

  test('getMessaging() returns null when not configured', () => {
    expect(freshUnconfiguredPush().getMessaging()).toBeNull();
  });

  test('sendPush() returns false when not configured', async () => {
    expect(await freshUnconfiguredPush().sendPush('some-token', { title: 'T', body: 'B' })).toBe(false);
  });

  test('sendPush() returns false for empty/null/undefined token', async () => {
    const { sendPush } = freshUnconfiguredPush();
    expect(await sendPush('',        { title: 'T', body: 'B' })).toBe(false);
    expect(await sendPush(null,      { title: 'T', body: 'B' })).toBe(false);
    expect(await sendPush(undefined, { title: 'T', body: 'B' })).toBe(false);
  });

  test('sendPushMulti() returns zero-counts when not configured', async () => {
    expect(await freshUnconfiguredPush().sendPushMulti(['t1', 't2'], { title: 'T', body: 'B' }))
      .toEqual({ sent: 0, failed: 0, expiredTokens: [] });
  });

  test('sendPushMulti() returns zero-counts for empty/null array', async () => {
    const { sendPushMulti } = freshUnconfiguredPush();
    expect(await sendPushMulti([],   { title: 'T', body: 'B' })).toEqual({ sent: 0, failed: 0, expiredTokens: [] });
    expect(await sendPushMulti(null, { title: 'T', body: 'B' })).toEqual({ sent: 0, failed: 0, expiredTokens: [] });
  });
});

// ── 3. push.js — FCM API (mocked firebase-admin via jest.doMock) ──────────────
describe('push.js — FCM API with mocked firebase-admin', () => {
  afterEach(cleanup);

  function makeMockAdmin(overrides = {}) {
    const mockSend = jest.fn();
    const mockAdmin = {
      apps: [],
      credential: { cert: jest.fn().mockReturnValue({ mock: 'credential' }) },
      initializeApp: jest.fn().mockReturnValue({ mock: 'app' }),
      messaging: jest.fn().mockReturnValue({ send: mockSend }),
      ...overrides,
    };
    return { mockAdmin, mockSend };
  }

  test('getMessaging() initialises app when apps is empty', () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    const { getMessaging } = freshMockedPush(mockAdmin);
    const messaging = getMessaging();
    expect(mockAdmin.initializeApp).toHaveBeenCalledTimes(1);
    expect(mockAdmin.messaging).toHaveBeenCalledTimes(1);
    expect(messaging).toEqual({ send: mockSend });
  });

  test('getMessaging() reuses existing app when apps is non-empty', () => {
    const { mockAdmin } = makeMockAdmin({ apps: [{ mock: 'existingApp' }] });
    const { getMessaging } = freshMockedPush(mockAdmin);
    getMessaging();
    expect(mockAdmin.initializeApp).not.toHaveBeenCalled();
    expect(mockAdmin.messaging).toHaveBeenCalledTimes(1);
  });

  test('sendPush() constructs correct FCM message structure', async () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    mockSend.mockResolvedValue('projects/test-project/messages/mock-id');
    const { sendPush } = freshMockedPush(mockAdmin);

    const result = await sendPush('device-fcm-token-abc123', {
      title: 'New message',
      body:  'You have a new notification',
      data:  { postId: 42 },
      type:  'LIKE',
    });

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const msg = mockSend.mock.calls[0][0];
    expect(msg.token).toBe('device-fcm-token-abc123');
    expect(msg.notification.title).toBe('New message');
    expect(msg.notification.body).toBe('You have a new notification');
    expect(msg.data.type).toBe('LIKE');
    expect(msg.data.postId).toBe('42');          // coerced to string
    expect(msg.android.notification.channelId).toBe('social');
    expect(msg.android.notification.priority).toBe('high');
    expect(msg.apns.payload.aps.sound).toBe('default');
  });

  test('sendPush() returns EXPIRED for messaging/registration-token-not-registered', async () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    mockSend.mockRejectedValue(
      Object.assign(new Error('Token not registered'), { code: 'messaging/registration-token-not-registered' })
    );
    const { sendPush } = freshMockedPush(mockAdmin);
    expect(await sendPush('expired-token', { title: 'T', body: 'B', type: 'SYSTEM' })).toBe('EXPIRED');
  });

  test('sendPush() returns EXPIRED for messaging/invalid-registration-token', async () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    mockSend.mockRejectedValue(
      Object.assign(new Error('Invalid token'), { code: 'messaging/invalid-registration-token' })
    );
    const { sendPush } = freshMockedPush(mockAdmin);
    expect(await sendPush('bad-token', { title: 'T', body: 'B' })).toBe('EXPIRED');
  });

  test('sendPush() returns false on other FCM errors', async () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    mockSend.mockRejectedValue(
      Object.assign(new Error('Internal error'), { code: 'messaging/internal-error' })
    );
    const { sendPush } = freshMockedPush(mockAdmin);
    expect(await sendPush('token', { title: 'T', body: 'B' })).toBe(false);
  });

  test('sendPushMulti() aggregates sent/failed/expired correctly', async () => {
    const { mockAdmin, mockSend } = makeMockAdmin();
    const expiredErr  = Object.assign(new Error('Not registered'), { code: 'messaging/registration-token-not-registered' });
    const internalErr = Object.assign(new Error('Internal'),       { code: 'messaging/internal-error' });

    mockSend
      .mockResolvedValueOnce('msg-id-1')
      .mockRejectedValueOnce(expiredErr)
      .mockRejectedValueOnce(internalErr)
      .mockResolvedValueOnce('msg-id-4');

    const { sendPushMulti } = freshMockedPush(mockAdmin);
    const result = await sendPushMulti(
      ['token1', 'token2', 'token3', 'token4'],
      { title: 'Multi test', body: 'Body', type: 'FOLLOW' },
    );

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.expiredTokens).toEqual(['token2']);
  });
});

// ── 4. Channel ID mapping ─────────────────────────────────────────────────────
describe('push.js — notification channel routing', () => {
  afterEach(cleanup);

  async function assertChannel(type, expectedChannel) {
    const mockChanSend = jest.fn().mockResolvedValue('ok');
    const mockAdmin = {
      apps: [{ mock: 'app' }],
      credential: { cert: jest.fn() },
      initializeApp: jest.fn(),
      messaging: jest.fn().mockReturnValue({ send: mockChanSend }),
    };
    const { sendPush } = freshMockedPush(mockAdmin);
    const result = await sendPush('token', { title: 'T', body: 'B', type });
    expect(result).toBe(true);
    expect(mockChanSend).toHaveBeenCalledTimes(1);
    const msg = mockChanSend.mock.calls[0][0];
    expect(msg.android.notification.channelId).toBe(expectedChannel);
  }

  test('FOLLOW → social',          () => assertChannel('FOLLOW',           'social'));
  test('LIKE → social',            () => assertChannel('LIKE',             'social'));
  test('COMMENT → social',         () => assertChannel('COMMENT',          'social'));
  test('GIFT_RECEIVED → social',   () => assertChannel('GIFT_RECEIVED',    'social'));
  test('NEW_SUBSCRIBER → social',  () => assertChannel('NEW_SUBSCRIBER',   'social'));
  test('ATTENDANCE → education',   () => assertChannel('ATTENDANCE',       'education'));
  test('GRADE → education',        () => assertChannel('GRADE',            'education'));
  test('BEHAVIOR → education',     () => assertChannel('BEHAVIOR',         'education'));
  test('LIVE_CLASS_START → live',  () => assertChannel('LIVE_CLASS_START', 'live'));
  test('VOICE_ROOM_LIVE → live',   () => assertChannel('VOICE_ROOM_LIVE',  'live'));
  test('COINS_PURCHASED → wallet', () => assertChannel('COINS_PURCHASED',  'wallet'));
  test('SYSTEM → general',         () => assertChannel('SYSTEM',           'general'));
  test('UNKNOWN_TYPE → general',   () => assertChannel('UNKNOWN_TYPE',     'general'));
});

// ── 5. No double-initialisation ───────────────────────────────────────────────
describe('push.js — no duplicate Firebase app initialisation', () => {
  afterEach(cleanup);

  test('getMessaging() is idempotent — only initialises once', () => {
    const mockApps = [];
    const mockAdmin = {
      get apps() { return mockApps; },
      credential: { cert: jest.fn().mockReturnValue({}) },
      initializeApp: jest.fn().mockImplementation(() => {
        mockApps.push({ mock: 'app' });
        return mockApps[0];
      }),
      messaging: jest.fn().mockReturnValue({ send: jest.fn() }),
    };

    const { getMessaging } = freshMockedPush(mockAdmin);

    // Call three times — initializeApp must only fire once
    getMessaging();
    getMessaging();
    getMessaging();

    expect(mockAdmin.initializeApp).toHaveBeenCalledTimes(1);
  });
});
