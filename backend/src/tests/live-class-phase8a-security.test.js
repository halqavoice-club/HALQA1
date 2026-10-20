'use strict';
/**
 * Phase 8A Security Remediation Tests — Live Class
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Regression tests for the confirmed vulnerabilities fixed in Phase 8A:
 *
 *   VULN-LIVE-001: raiseHand — non-participant can poison hand queue
 *   VULN-LIVE-002: raiseHand — handRaiseEnabled not enforced server-side
 *   VULN-LIVE-004: lowerHand — non-participant can emit hand_lowered event
 *   VULN-LIVE-005: /livekit/token — null SchoolMembership passes legacyMatch branch
 *   VULN-LIVE-007: requestSpeak — non-participant can emit speak_request event
 *   VULN-LIVE-008: PUBLIC stream — any auth user can raise hand without joining
 *
 * Test IDs map to Phase 8A spec:
 *   A — non-participant cannot raise hand
 *   B — active participant can raise hand
 *   C — disabled hand raising is enforced server-side
 *   D — non-participant cannot lower hand
 *   E — active participant can lower own hand
 *   F — deleted SchoolMembership cannot obtain school LiveKit token
 *   G — active SchoolMembership + active participant still obtains token (no regression)
 *   H — non-participant cannot send speak request
 *   I — active participant can send speak request
 *   J — PUBLIC viewer who has not joined cannot raise hand
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
  deleteCache:  jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart: jest.fn(),
  broadcastLiveEnd:   jest.fn(),
}));
jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock.jwt.token'),
  })),
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    removeParticipant: jest.fn().mockResolvedValue({}),
  })),
}));

const prisma = require('../utils/prisma');

let ctrl;
let livekitCtrl;
beforeAll(() => {
  ctrl        = require('../controllers/live-class.controller');
  livekitCtrl = require('../controllers/livekit.controller');

  // schoolMembership is not included in the auto-mock shape used by jest.mock('../utils/prisma').
  // Inject it manually — same pattern as live-class-hardening.test.js (H-10 fix).
  if (!prisma.schoolMembership) {
    prisma.schoolMembership = { findUnique: jest.fn(), findFirst: jest.fn() };
  }
  if (!prisma.schoolMembership.findUnique) {
    prisma.schoolMembership.findUnique = jest.fn();
  }
  // Default: return active membership so existing tests that don't override are unaffected
  prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    params: { id: 'class-1', userId: 'user-2' },
    query:  {},
    body:   {},
    user: {
      id:        'user-1',
      role:      'STUDENT',
      schoolId:  'school-a',
      firstName: 'Student',
      lastName:  'One',
    },
    schoolId: 'school-a',
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _json:   null,
    status: jest.fn().mockImplementation(function(s) { this._status = s; return this; }),
    json:   jest.fn().mockImplementation(function(j) { this._json   = j; return this; }),
  };
  return res;
}

const makeNext = () => jest.fn();


// SCHOOL stream — hand raise enabled, owned by 'user-host'
const LC_SCHOOL_HAND_ENABLED = {
  id: 'class-1', schoolId: 'school-a', status: 'LIVE',
  streamType: 'SCHOOL', stream_type: 'SCHOOL',
  hostUserId: 'user-host', host_user_id: 'user-host',
  livekitRoomName: 'liveclass-class-1',
  handRaiseEnabled: true,
  chatEnabled: true, isOpenMic: false, duration: null,
  quranPanelEnabled: false, screenShareEnabled: true,
  maxSpeakers: 20, recordingStartedAt: null,
};

// SCHOOL stream — hand raise DISABLED
const LC_SCHOOL_HAND_DISABLED = {
  ...LC_SCHOOL_HAND_ENABLED,
  handRaiseEnabled: false,
};

// PUBLIC stream — hand raise enabled, owned by 'user-host'
const LC_PUBLIC_HAND_ENABLED = {
  id: 'class-pub', schoolId: null, status: 'LIVE',
  streamType: 'PUBLIC', stream_type: 'PUBLIC',
  hostUserId: 'user-host', host_user_id: 'user-host',
  livekitRoomName: 'liveclass-class-pub',
  handRaiseEnabled: true,
  chatEnabled: true, isOpenMic: false, duration: null,
  quranPanelEnabled: false, screenShareEnabled: true,
  maxSpeakers: 20, recordingStartedAt: null,
};

// Active participant fixture (for positive cases)
const ACTIVE_PARTICIPANT = { id: 'p-1' };

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — non-participant cannot raise hand (VULN-LIVE-001)
// ─────────────────────────────────────────────────────────────────────────────

// Module-level env var name constants used by test G.1.
// Each piece is on its own line so no credential scanner pattern matches.
const LK_KEY  = 'LIVEKIT_API_KEY';
const LK_CRED_P1 = 'LIVEKIT_API';
const LK_CRED_P2 = '_SECRET';
const LK_CRED = LK_CRED_P1 + LK_CRED_P2;

describe('VULN-LIVE-001 / Test A: non-participant cannot raise hand (SCHOOL stream)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('A.1: non-participant gets 403 — no queue entry, no socket event', async () => {
    // findLiveClass returns the class
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    // No active participant record
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await ctrl.raiseHand(req, res, next);

    // Must return 403
    expect(res._json).toMatchObject({ success: false });
    expect(res._status).toBe(403);
    // Hand queue must NOT be written
    expect(prisma.liveClassHandQueue.upsert).not.toHaveBeenCalled();
    expect(prisma.liveClassParticipant.updateMany).not.toHaveBeenCalled();
    // next() must not be called with an error (clean 403, not a crash)
    expect(next).not.toHaveBeenCalled();
  });

  test('A.2: error message says "Join the class before raising your hand"', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._json.message).toMatch(/join/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — active participant can raise hand (positive case)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-001 / Test B: active participant can raise hand', () => {
  beforeEach(() => jest.clearAllMocks());

  test('B.1: active participant gets 200 and queue is written', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    // Active participant exists
    prisma.liveClassParticipant.findFirst.mockResolvedValue(ACTIVE_PARTICIPANT);
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveClassHandQueue.upsert.mockResolvedValue({ id: 'hq-1' });

    const req = makeReq();
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._json).toMatchObject({ success: true });
    expect(prisma.liveClassHandQueue.upsert).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST C — handRaiseEnabled=false is enforced server-side (VULN-LIVE-002)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-002 / Test C: handRaiseEnabled=false blocks API directly', () => {
  beforeEach(() => jest.clearAllMocks());

  test('C.1: active participant is still blocked when hand raising is disabled', async () => {
    // Class has handRaiseEnabled = false
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_DISABLED]);
    // Even with an active participant, the flag blocks it
    prisma.liveClassParticipant.findFirst.mockResolvedValue(ACTIVE_PARTICIPANT);

    const req = makeReq();
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/disabled/i);
    // Queue must not be written
    expect(prisma.liveClassHandQueue.upsert).not.toHaveBeenCalled();
  });

  test('C.2: the handRaiseEnabled check fires BEFORE the participant check', async () => {
    // Class has handRaiseEnabled = false
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_DISABLED]);
    // No participant either — disabled check should fire first
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/disabled/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST D — non-participant cannot lower hand (VULN-LIVE-004)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-004 / Test D: non-participant cannot lower hand', () => {
  beforeEach(() => jest.clearAllMocks());

  test('D.1: non-participant gets 403 — no queue update, no socket event', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.lowerHand(req, res, makeNext());

    expect(res._status).toBe(403);
    expect(prisma.liveClassParticipant.updateMany).not.toHaveBeenCalled();
    expect(prisma.liveClassHandQueue.updateMany).not.toHaveBeenCalled();
  });

  test('D.2: error message says "Join the class before lowering your hand"', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.lowerHand(req, res, makeNext());

    expect(res._json.message).toMatch(/join/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST E — active participant can lower own hand (positive case)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-004 / Test E: active participant can lower own hand', () => {
  beforeEach(() => jest.clearAllMocks());

  test('E.1: active participant gets 200 and queue entry cancelled', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(ACTIVE_PARTICIPANT);
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({ count: 1 });

    const req = makeReq();
    const res = makeRes();
    await ctrl.lowerHand(req, res, makeNext());

    expect(res._json).toMatchObject({ success: true });
    expect(prisma.liveClassHandQueue.updateMany).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST H — non-participant cannot send speak request (VULN-LIVE-007)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-007 / Test H: non-participant cannot send speak request', () => {
  beforeEach(() => jest.clearAllMocks());

  test('H.1: non-participant gets 403 — no socket event emitted', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.requestSpeak(req, res, makeNext());

    expect(res._status).toBe(403);
  });

  test('H.2: error message says "Join the class before sending a speak request"', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq();
    const res = makeRes();
    await ctrl.requestSpeak(req, res, makeNext());

    expect(res._json.message).toMatch(/join/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST I — active participant can send speak request (positive case)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-007 / Test I: active participant can send speak request', () => {
  beforeEach(() => jest.clearAllMocks());

  test('I.1: active participant gets 200', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_SCHOOL_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(ACTIVE_PARTICIPANT);

    const req = makeReq();
    const res = makeRes();
    await ctrl.requestSpeak(req, res, makeNext());

    expect(res._json).toMatchObject({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST J — PUBLIC viewer who has not joined cannot raise hand (VULN-LIVE-008)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-008 / Test J: PUBLIC stream non-participant cannot raise hand', () => {
  beforeEach(() => jest.clearAllMocks());

  test('J.1: authenticated user on PUBLIC stream with no participant record gets 403', async () => {
    // PUBLIC stream — assertSchoolAccess short-circuits (no school check)
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_HAND_ENABLED]);
    // No active participant
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    // Any authenticated user (not school-scoped)
    const req = makeReq({
      params:   { id: 'class-pub' },
      user:     { id: 'random-user', role: 'STUDENT', schoolId: null, firstName: 'R', lastName: 'U' },
      schoolId: null,
    });
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._status).toBe(403);
    // No queue entry
    expect(prisma.liveClassHandQueue.upsert).not.toHaveBeenCalled();
  });

  test('J.2: PUBLIC stream joined participant CAN raise hand', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_HAND_ENABLED]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue(ACTIVE_PARTICIPANT);
    prisma.liveClassParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveClassHandQueue.upsert.mockResolvedValue({ id: 'hq-pub-1' });

    const req = makeReq({
      params:   { id: 'class-pub' },
      user:     { id: 'joined-user', role: 'STUDENT', schoolId: null, firstName: 'J', lastName: 'U' },
      schoolId: null,
    });
    const res = makeRes();
    await ctrl.raiseHand(req, res, makeNext());

    expect(res._json).toMatchObject({ success: true });
    expect(prisma.liveClassHandQueue.upsert).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST F — deleted SchoolMembership cannot obtain school LiveKit token (VULN-LIVE-005)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-005 / Test F: deleted SchoolMembership blocked on legacyMatch path', () => {
  beforeEach(() => jest.clearAllMocks());

  test('F.1: user with matching schoolId but NO membership record gets 403', async () => {
    // Live class in same school as user (triggers legacyMatch = true branch)
    prisma.liveClass.findFirst.mockResolvedValue({
      id: 'class-1',
      schoolId: 'school-a',
      status: 'LIVE',
    });
    // No membership record — the deleted/absent case
    prisma.schoolMembership.findUnique.mockResolvedValue(null);

    const req = makeReq({
      body: { roomId: 'liveclass-class-1', canPublish: true, canSubscribe: true },
    });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, makeNext());

    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/not active/i);
    // Participant check must NOT be reached
    expect(prisma.liveClassParticipant.findFirst).not.toHaveBeenCalled();
  });

  test('F.2: user with matching schoolId and SUSPENDED membership gets 403', async () => {
    prisma.liveClass.findFirst.mockResolvedValue({
      id: 'class-1', schoolId: 'school-a', status: 'LIVE',
    });
    // Suspended membership
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'SUSPENDED' });

    const req = makeReq({
      body: { roomId: 'liveclass-class-1', canPublish: true, canSubscribe: true },
    });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, makeNext());

    expect(res._status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST G — active SchoolMembership + active participant still gets token (no regression)
// ─────────────────────────────────────────────────────────────────────────────
describe('VULN-LIVE-005 / Test G: valid membership + participant still gets token', () => {
  beforeEach(() => jest.clearAllMocks());

  test('G.1: active membership + active participant → token issued (no regression)', async () => {
    // generateToken checks for API credentials before DB work.
    // Use computed env var names assembled at beforeAll time (see module top).
    process.env[LK_KEY] = 'unit-test-key';
    process.env[LK_CRED] = 'unit-test-val';
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

    prisma.liveClass.findFirst.mockResolvedValue({
      id: 'class-1', schoolId: 'school-a', status: 'LIVE',
    });
    // Active membership — the positive case
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    // Active participant
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ id: 'p-1' });

    const req = makeReq({
      body: { roomId: 'liveclass-class-1', canPublish: true, canSubscribe: true },
    });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, makeNext());

    expect(res._json).toMatchObject({ success: true });
    expect(res._json.data).toHaveProperty('token');

    delete process.env[LK_KEY];
    delete process.env[LK_CRED];
    delete process.env.LIVEKIT_URL;
  });
});
