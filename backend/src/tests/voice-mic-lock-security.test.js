'use strict';
/**
 * Voice Club Mic-Lock Security Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the two-layer mic-lock enforcement added in this sprint:
 *
 * Layer 1 — toggleMicLock + LiveKit updateParticipant (current-session)
 *   LOCK:   active SPEAKER → canPublish:false via RoomServiceClient
 *           HOST excluded, MODERATOR excluded, AUDIENCE excluded, inactive excluded
 *   UNLOCK: current DB state used (not lock-time snapshot)
 *           seated SPEAKER + HOST + MODERATOR → canPublish:true
 *           unseated SPEAKER, AUDIENCE, isActive=false → not restored
 *   FAILURE: LiveKit error is logged with structured context;
 *            HTTP response still returns correct micLocked state
 *
 * Layer 2 — getLiveKitToken canPublish gate (reconnect enforcement)
 *   locked + SPEAKER  → canPublish:false in JWT
 *   locked + AUDIENCE → canPublish:false in JWT
 *   locked + HOST     → canPublish:true  in JWT (privileged)
 *   locked + MODERATOR→ canPublish:true  in JWT (privileged)
 *   unlocked          → canPublish:true  for all roles (existing contract)
 *
 * Architecture note (C2/C3 UNKNOWN):
 *   Whether updateParticipant immediately removes an already-published audio
 *   track has not been confirmed by WebRTC runtime test. These tests verify the
 *   API call pattern only. The token gate closes the reconnect gap regardless
 *   of C2/C3 outcome.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../utils/prisma', () => {
  const m = {
    voiceRoom:        { findUnique: jest.fn(), update: jest.fn() },
    voiceParticipant: { findMany: jest.fn(), findUnique: jest.fn() },
    // SEC-BAN-01: getLiveKitToken now queries prisma.user.findUnique to check
    // User.status before issuing a token. Default to ACTIVE so existing tests
    // that do not override this mock continue to receive a token as expected.
    user:             { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    auditLog:         { create: jest.fn() },
    $queryRaw:        jest.fn().mockResolvedValue([]),
    $executeRaw:      jest.fn().mockResolvedValue(0),
    $transaction:     jest.fn(async (fns, _opts) =>
      Array.isArray(fns) ? Promise.all(fns) : fns(m)
    ),
  };
  return m;
});

jest.mock('../utils/redis', () => ({
  setCache:           jest.fn(),
  getCache:           jest.fn().mockResolvedValue(null),
  deleteCache:        jest.fn(),
  deleteCachePattern: jest.fn(),
  isRedisReady:       jest.fn().mockReturnValue(false),
}));

jest.mock('../sockets', () => ({ getIo: jest.fn().mockReturnValue(null) }));

jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));

jest.mock('../services/queue.service', () => ({
  scheduleRoomReminder:   jest.fn(),
  cancelRoomReminder:     jest.fn(),
  queueBulkNotifications: jest.fn(),
}));

jest.mock('../utils/autoPromote', () => ({ autoPromoteNext: jest.fn() }));

jest.mock('../utils/voiceQueue', () => ({
  clearQueue: jest.fn(), enqueue: jest.fn(), getQueue: jest.fn().mockResolvedValue([]),
  isInQueue: jest.fn().mockResolvedValue(false), dequeue: jest.fn(),
}));

jest.mock('../utils/search', () => ({ searchVoiceRooms: jest.fn().mockResolvedValue([]) }));

// ── LiveKit SDK mock ──────────────────────────────────────────────────────────
const mockUpdateParticipant = jest.fn().mockResolvedValue({});
const mockAddGrant = jest.fn();
const mockToJwt    = jest.fn().mockResolvedValue('mock-jwt-token');
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: mockAddGrant,
    toJwt:    mockToJwt,
  })),
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    updateParticipant: mockUpdateParticipant,
  })),
}));

// ── livekitService mock — returns a real mock RoomServiceClient ───────────────
// The actual livekitService reads env vars; in tests we inject a fake svc.
const mockSvc = { updateParticipant: mockUpdateParticipant };
jest.mock('../utils/livekitService', () => ({
  getLivekitRoomService: jest.fn(() => mockSvc),
  // PH17-002/003 FIX: sfuEvict and sfuRevokePublish added in Phase 24A.
  // Provide no-op mocks so voice controller imports resolve cleanly in this
  // test suite, which focuses on toggleMicLock / token-gate behavior only.
  sfuEvict:         jest.fn().mockResolvedValue(undefined),
  sfuRevokePublish: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────

const prisma  = require('../utils/prisma');
const logger  = require('../utils/logger');
const { getLivekitRoomService, sfuRevokePublish } = require('../utils/livekitService');

// Load controllers under test
const { toggleMicLock } = require('../controllers/voice.controller');
const { getLiveKitToken } = require('../controllers/livekit.controller');

// ── Helper: minimal req/res ───────────────────────────────────────────────────
function makeRes() {
  return {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b; return this; },
  };
}

function makeLockReq(roomId, userId, locked) {
  return {
    params: { id: roomId },
    user:   { id: userId, role: 'HOST', firstName: 'T', lastName: 'H' },
    body:   { locked },
  };
}

function makeTokenReq(roomId, userId) {
  return {
    params: { id: roomId },
    user:   { id: userId, firstName: 'T', lastName: 'U', role: 'MEMBER' },
  };
}

// ─── LAYER 1: toggleMicLock ───────────────────────────────────────────────────

describe('toggleMicLock — Layer 1: LiveKit SFU enforcement', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: env vars present so livekitService returns the mock svc
    getLivekitRoomService.mockReturnValue(mockSvc);
    mockUpdateParticipant.mockResolvedValue({});
    // Phase F2-A: sfuRevokePublish must return a valid enforcement result object
    sfuRevokePublish.mockResolvedValue({ enforced: true, reason: 'UPDATED' });
  });

  // ── LOCK tests ────────────────────────────────────────────────────────────

  test('LOCK: calls updateParticipant(canPublish:false) for each active SPEAKER', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // Two active SPEAKERs (Phase F2-A: sfuRevokePublish used instead of direct updateParticipant)
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'spk-1', role: 'SPEAKER', isActive: true, seatNumber: null, isMuted: false, mutedByModerator: false },
      { userId: 'spk-2', role: 'SPEAKER', isActive: true, seatNumber: null, isMuted: false, mutedByModerator: false },
    ]);

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(res._body.data.micLocked).toBe(true);
    // Phase F2-A: toggleMicLock delegates to sfuRevokePublish, not direct updateParticipant
    expect(sfuRevokePublish).toHaveBeenCalledTimes(2);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'spk-1', false, '[voice:mic-lock]');
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'spk-2', false, '[voice:mic-lock]');
  });

  test('LOCK: HOST participants are excluded from revocation', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // Only SPEAKERs queried — HOST is never in the lock query by design
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());
    await new Promise(r => setTimeout(r, 20));

    // No SPEAKERs to revoke
    expect(mockUpdateParticipant).not.toHaveBeenCalled();
    expect(res._body.data.micLocked).toBe(true);
  });

  test('LOCK: MODERATOR participants are excluded from revocation', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // Query returns only SPEAKERs (role: 'SPEAKER' filter)
    // Simulate only a MODERATOR present — findMany returns [] for SPEAKER filter
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());
    await new Promise(r => setTimeout(r, 20));

    expect(mockUpdateParticipant).not.toHaveBeenCalled();
  });

  test('LOCK: AUDIENCE participants are excluded (not queried at all)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([]); // no SPEAKERs

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());
    await new Promise(r => setTimeout(r, 20));

    expect(mockUpdateParticipant).not.toHaveBeenCalled();
  });

  test('LOCK: inactive SPEAKER is excluded (isActive:false filtered by DB query)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // Inactive participant would not be returned by isActive:true filter
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());
    await new Promise(r => setTimeout(r, 20));

    expect(mockUpdateParticipant).not.toHaveBeenCalled();
  });

  // ── UNLOCK tests ──────────────────────────────────────────────────────────

  test('UNLOCK: active seated SPEAKER gets canPublish:true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // Phase F2-A: full participant fields needed for voiceAudioPermission evaluation
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'spk-1', role: 'SPEAKER', isActive: true, seatNumber: 3, isMuted: false, mutedByModerator: false },
    ]);

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(res._body.data.micLocked).toBe(false);
    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'spk-1', true, '[voice:mic-unlock]');
  });

  test('UNLOCK: active HOST gets canPublish:true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'host-1', role: 'HOST', isActive: true, seatNumber: 1, isMuted: false, mutedByModerator: false },
    ]);

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'host-1', true, '[voice:mic-unlock]');
  });

  test('UNLOCK: active MODERATOR gets canPublish:true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'mod-1', role: 'MODERATOR', isActive: true, seatNumber: 2, isMuted: false, mutedByModerator: false },
    ]);

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(sfuRevokePublish).toHaveBeenCalledWith('room-1', 'mod-1', true, '[voice:mic-unlock]');
  });

  test('UNLOCK: unseated SPEAKER (seatNumber=null) does NOT get canPublish:true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // The unlock query uses seatNumber: { not: null } — unseated SPEAKERs not returned
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  test('UNLOCK: inactive participants are not restored', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    // isActive:true filter excludes inactive — findMany returns []
    prisma.voiceParticipant.findMany.mockResolvedValue([]);

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── FAILURE tests ─────────────────────────────────────────────────────────
  // Phase F2-A: toggleMicLock delegates to sfuRevokePublish, which returns
  // { enforced: boolean, reason: string }. Failures are surfaced via the
  // return value (not exceptions), so the HTTP response always succeeds.

  test('LOCK FAILURE: LiveKit error is logged with structured context; HTTP still returns micLocked:true', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'spk-1', role: 'SPEAKER', isActive: true, seatNumber: null, isMuted: false, mutedByModerator: false },
    ]);
    // Simulate SFU enforcement failure (Phase F2-A sfuRevokePublish returns enforced:false)
    sfuRevokePublish.mockResolvedValue({ enforced: false, reason: 'UPDATE_FAILED' });

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    // HTTP response must succeed with correct DB state
    expect(res._status).toBe(200);
    expect(res._body.data.micLocked).toBe(true);

    // Failure logged via logger.warn (togglMicLock logs incomplete enforcement)
    expect(logger.warn).toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('mic-lock')
    );
    expect(warnCall).toBeDefined();
  });

  test('LOCK FAILURE: LiveKit not configured — no error thrown, micLocked persisted correctly', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'spk-1', role: 'SPEAKER', isActive: true, seatNumber: null, isMuted: false, mutedByModerator: false },
    ]);
    // Phase F2-A: NOT_CONFIGURED is enforced:true — no warning logged
    sfuRevokePublish.mockResolvedValue({ enforced: true, reason: 'NOT_CONFIGURED' });

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(res._status).toBe(200);
    expect(res._body.data.micLocked).toBe(true);
    // sfuRevokePublish was called; direct updateParticipant was not
    expect(sfuRevokePublish).toHaveBeenCalled();
    expect(mockUpdateParticipant).not.toHaveBeenCalled();
  });

  test('UNLOCK FAILURE: per-participant LiveKit error is logged; other participants still processed', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: true, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'host-1', role: 'HOST',    isActive: true, seatNumber: 1, isMuted: false, mutedByModerator: false },
      { userId: 'spk-1',  role: 'SPEAKER', isActive: true, seatNumber: 3, isMuted: false, mutedByModerator: false },
    ]);
    // First call fails (not_found), second succeeds
    sfuRevokePublish
      .mockResolvedValueOnce({ enforced: false, reason: 'NOT_FOUND' })
      .mockResolvedValueOnce({ enforced: true,  reason: 'UPDATED' });

    const req = makeLockReq('room-1', 'host-1', false);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());

    expect(res._status).toBe(200);
    expect(res._body.data.micLocked).toBe(false);
    // Both participants were attempted via sfuRevokePublish
    expect(sfuRevokePublish).toHaveBeenCalledTimes(2);
    // Failure for first participant logged
    expect(logger.warn).toHaveBeenCalled();
  });

  test('DB state is consistent even when LiveKit fails: micLocked persisted before SFU call', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ micLocked: false, allMuted: false });
    prisma.voiceRoom.update.mockResolvedValue({});
    prisma.voiceParticipant.findMany.mockResolvedValue([
      { userId: 'spk-1', role: 'SPEAKER', isActive: true, seatNumber: null, isMuted: false, mutedByModerator: false },
    ]);
    sfuRevokePublish.mockResolvedValue({ enforced: false, reason: 'TIMEOUT' });

    const req = makeLockReq('room-1', 'host-1', true);
    const res = makeRes();
    await toggleMicLock(req, res, jest.fn());
    await new Promise(r => setTimeout(r, 40));

    // DB update was called before the SFU call
    expect(prisma.voiceRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ micLocked: true }) })
    );
    // Response reflects DB truth
    expect(res._body.data.micLocked).toBe(true);
  });
});

// ─── LAYER 2: getLiveKitToken canPublish gate ─────────────────────────────────

describe('getLiveKitToken — Layer 2: canPublish token gate', () => {

  beforeEach(() => jest.clearAllMocks());

  // Helper: decode the addGrant call from the module-level mockAddGrant spy
  function getCapturedGrant() {
    const calls = mockAddGrant.mock.calls;
    if (!calls.length) return null;
    return calls[calls.length - 1][0] ?? null;
  }

  function setupRoom(micLocked) {
    // Phase 16c: voiceAudioPermission strict validator requires micLocked and allMuted as booleans
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id: 'room-1', status: 'LIVE', deletedAt: null, micLocked, allMuted: false,
    });
  }

  function setupParticipant(role) {
    // Phase 16c: voiceAudioPermission strict validator requires isMuted and
    // mutedByModerator as booleans. seatNumber=1 gives HOST/MOD/SPEAKER stage presence.
    const isAudience = role === 'AUDIENCE';
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      roomId: 'room-1', userId: 'user-1', role, isActive: true,
      seatNumber: isAudience ? null : 1,
      isMuted: false,
      mutedByModerator: false,
    });
  }

  // ── Locked room tests ─────────────────────────────────────────────────────

  test('TOKEN locked + SPEAKER → canPublish:false', async () => {
    setupRoom(true);
    setupParticipant('SPEAKER');
    process.env.LIVEKIT_API_KEY    = 'test-key';
    process.env.LIVEKIT_API_SECRET = 'test-secret';
    process.env.LIVEKIT_URL        = 'wss://test.livekit.cloud';

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant).not.toBeNull();
    expect(grant.canPublish).toBe(false);
  });

  test('TOKEN locked + AUDIENCE → canPublish:false', async () => {
    setupRoom(true);
    setupParticipant('AUDIENCE');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(false);
  });

  test('TOKEN locked + HOST → canPublish:true (privileged)', async () => {
    setupRoom(true);
    setupParticipant('HOST');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(true);
  });

  test('TOKEN locked + MODERATOR → canPublish:true (privileged)', async () => {
    setupRoom(true);
    setupParticipant('MODERATOR');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(true);
  });

  // ── Unlocked room tests ───────────────────────────────────────────────────

  test('TOKEN unlocked + SPEAKER → canPublish:true (existing contract)', async () => {
    setupRoom(false);
    setupParticipant('SPEAKER');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(true);
  });

  test('TOKEN unlocked + AUDIENCE → canPublish:false (Phase 16c: AUDIENCE not eligible to publish)', async () => {
    setupRoom(false);
    setupParticipant('AUDIENCE');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    // Phase 16c hardening: AUDIENCE role is not eligible to publish audio (ROLE_NOT_ELIGIBLE)
    expect(grant.canPublish).toBe(false);
  });

  test('TOKEN unlocked + HOST → canPublish:true', async () => {
    setupRoom(false);
    setupParticipant('HOST');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(true);
  });

  test('TOKEN unlocked + MODERATOR → canPublish:true', async () => {
    setupRoom(false);
    setupParticipant('MODERATOR');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(200);
    const grant = getCapturedGrant();
    expect(grant.canPublish).toBe(true);
  });

  // ── Existing token contract ───────────────────────────────────────────────

  test('TOKEN: canSubscribe and canPublishData remain true regardless of lock state', async () => {
    setupRoom(true); // locked
    setupParticipant('SPEAKER');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    const grant = getCapturedGrant();
    expect(grant.canSubscribe).toBe(true);
    expect(grant.canPublishData).toBe(true);
  });

  test('TOKEN: response still includes role and micEnabled hint', async () => {
    setupRoom(false);
    setupParticipant('HOST');

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._body.data.role).toBe('HOST');
    // micEnabled is UI hint — HOST on unlocked room has mic capability
    expect(res._body.data.micEnabled).toBe(true);
    expect(res._body.data.token).toBe('mock-jwt-token');
  });

  test('TOKEN: non-active participant still gets 403', async () => {
    setupRoom(true);
    prisma.voiceParticipant.findUnique.mockResolvedValue({ role: 'SPEAKER', isActive: false });

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(403);
  });

  test('TOKEN: ENDED room still gets 400 regardless of lock state', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      id: 'room-1', status: 'ENDED', deletedAt: null, micLocked: true,
    });

    const req = makeTokenReq('room-1', 'user-1');
    const res = makeRes();
    await getLiveKitToken(req, res, jest.fn());

    expect(res._status).toBe(400);
  });
});
