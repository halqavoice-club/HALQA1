/**
 * HALQA — Live Class Stage Lifecycle Tests
 * Covers: H-1 through H-8 fixes
 *   - maxSpeakers cap enforcement
 *   - Concurrency safety (H-5)
 *   - Idempotency (H-6)
 *   - Rejoin stale speakerSlot cleared (H-7)
 *   - approveHand authorization (H-8)
 *   - Socket event emission (H-1)
 *   - drop-mic route (H-2)
 *   - Demotion events (H-4)
 */
'use strict';

const ctrl = require('../controllers/live-class.controller');

// ── Minimal mock factory ────────────────────────────────────────────────────
function makeRes() {
  const res = {
    _status: null, _json: null,
    status: jest.fn().mockImplementation(function (s) { this._status = s; return this; }),
    json:   jest.fn().mockImplementation(function (b) { this._json = b;   return this; }),
  };
  return res;
}
function makeNext() { return jest.fn(); }

// ── Prisma mock ─────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => {
  const mockPrisma = {
    liveClassParticipant: {
      findMany:    jest.fn(),
      findFirst:   jest.fn(),
      update:      jest.fn(),
      updateMany:  jest.fn(),
      upsert:      jest.fn(),
    },
    liveClassHandQueue: {
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    $queryRawUnsafe:   jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };
  return mockPrisma;
});

jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive', () => ({ broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn() }));
jest.mock('../services/queue.service', () => ({ queueBulkNotifications: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require('../utils/prisma');
const { getIo } = require('../sockets');

// ── Shared lc builder ────────────────────────────────────────────────────────
function makeLc(overrides = {}) {
  return {
    id: 'lc-1', streamType: 'SCHOOL', schoolId: 'school-1',
    status: 'LIVE', chatEnabled: true, handRaiseEnabled: true,
    maxSpeakers: 4, maxParticipants: null, isOpenMic: false,
    classId: 'class-1', teacherId: 'teacher-1', hostUserId: 'host-u',
    ...overrides,
  };
}

// ── findLiveClass stub helper ────────────────────────────────────────────────
// The real findLiveClass calls $queryRawUnsafe. We mock it to return our test lc.
function stubFindLiveClass(lc) {
  prisma.$queryRawUnsafe.mockImplementation(async (sql) => {
    // Any SELECT on live_classes returns our test lc
    if (typeof sql === 'string' && sql.includes('FROM live_classes')) return [lc];
    return [];
  });
}

// ── req builder ─────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    params: {},
    body:   {},
    user:   { id: 'caller-id', role: 'TEACHER', schoolId: 'school-1', firstName: 'T', lastName: 'E' },
    schoolMembership: { role: 'TEACHER' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: approveHand authorization (H-8)
// ─────────────────────────────────────────────────────────────────────────────
describe('H-8 approveHand authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubFindLiveClass(makeLc());
  });

  test('HOST caller is allowed', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })     // caller check
      .mockResolvedValueOnce({ id: 'p-target', speakerSlot: null, isActive: true }); // idempotency check
    prisma.liveClassParticipant.findMany.mockResolvedValue([]); // 0 active speakers
    prisma.$executeRawUnsafe.mockResolvedValue(1); // update succeeds
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-1' } });
    const res = makeRes(); const next = makeNext();
    await ctrl.approveHand(req, res, next);
    expect(res._json.success).toBe(true);
  });

  test('MODERATOR caller is allowed', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'MODERATOR', isActive: true })
      .mockResolvedValueOnce({ id: 'p-target', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-1' } });
    const res = makeRes(); const next = makeNext();
    await ctrl.approveHand(req, res, next);
    expect(res._json.success).toBe(true);
  });

  test('STUDENT caller is denied 403', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'STUDENT', isActive: true });
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-1' } });
    const res = makeRes(); const next = makeNext();
    await ctrl.approveHand(req, res, next);
    expect(res._status).toBe(403);
  });

  test('AUDIENCE caller (no participant record) is denied 403', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValueOnce(null);
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-1' } });
    const res = makeRes(); const next = makeNext();
    await ctrl.approveHand(req, res, next);
    expect(res._status).toBe(403);
  });

  test('Non-existent target participant returns 404', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true }) // caller
      .mockResolvedValueOnce(null); // target not found
    const req = makeReq({ params: { id: 'lc-1', userId: 'ghost-user' } });
    const res = makeRes(); const next = makeNext();
    await ctrl.approveHand(req, res, next);
    expect(res._status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: maxSpeakers cap enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('maxSpeakers cap — approveHand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maxSpeakers=1: first approval succeeds', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 1 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]); // 0 active
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'u1' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(res._json.data.speakerSlot).toBe(0);
  });

  test('maxSpeakers=1: second approval returns 400 stage full', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 1 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([{ speakerSlot: 0 }]); // 1 active = full
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/full/i);
  });

  test('maxSpeakers=4: fills slots 0,1,2,3 in order', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 4 }));
    // Slots 0,1,2 occupied — next available is 3
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([
      { speakerSlot: 0 }, { speakerSlot: 1 }, { speakerSlot: 2 }
    ]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'u4' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._json.data.speakerSlot).toBe(3);
  });

  test('maxSpeakers=4: 4th slot occupied returns 400', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 4 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([
      { speakerSlot: 0 }, { speakerSlot: 1 }, { speakerSlot: 2 }, { speakerSlot: 3 }
    ]);
    const req = makeReq({ params: { id: 'lc-1', userId: 'u5' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._status).toBe(400);
  });

  test('Freed slot (gap at 1) is reused: [0,2] → next slot is 1', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 4 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([
      { speakerSlot: 0 }, { speakerSlot: 2 } // gap at 1
    ]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'u3' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._json.data.speakerSlot).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Idempotency (H-6)
// ─────────────────────────────────────────────────────────────────────────────
describe('H-6 approveHand idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubFindLiveClass(makeLc());
  });

  test('Already-on-stage user returns existing speakerSlot without DB write', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: 2, isActive: true }); // already on stage
    const req = makeReq({ params: { id: 'lc-1', userId: 'u1' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(res._json.data.speakerSlot).toBe(2);
    // No $executeRawUnsafe for UPDATE should have been called
    const updateCalls = prisma.$executeRawUnsafe.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE live_class_participants')
    );
    expect(updateCalls.length).toBe(0);
  });

  test('inviteToStage: already-on-stage returns existing slot idempotently', async () => {
    stubFindLiveClass(makeLc());
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: 3, isActive: true }); // already on stage
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(res._json.data.speakerSlot).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Concurrency safety — atomic UPDATE returns 0 rows (H-5)
// ─────────────────────────────────────────────────────────────────────────────
describe('H-5 Concurrency — race detection via 0-row UPDATE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubFindLiveClass(makeLc({ maxSpeakers: 1 }));
  });

  test('approveHand: UPDATE returns 0 → recheck shows stage full → 400', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true }) // initial: not on stage
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true }); // recheck after 0-row: still null → full
    prisma.liveClassParticipant.findMany.mockResolvedValue([]); // looked empty…
    prisma.$executeRawUnsafe.mockResolvedValue(0); // …but UPDATE matched 0 rows (race)
    const req = makeReq({ params: { id: 'lc-1', userId: 'u-race' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/full/i);
  });

  test('approveHand: UPDATE returns 0 but recheck shows another request assigned → idempotent 200', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true })   // initial: not on stage
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: 0, isActive: true });     // recheck: concurrent request promoted them
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(0); // lost the race
    const req = makeReq({ params: { id: 'lc-1', userId: 'u-race' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(res._json.data.speakerSlot).toBe(0);
  });

  test('inviteToStage: UPDATE returns 0 → 400 stage full', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 1 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true })  // idempotency: not on stage
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true }); // recheck after 0-row
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(0);
    const req = makeReq({ params: { id: 'lc-1', userId: 'u-race' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: inviteToStage authorization + cap
// ─────────────────────────────────────────────────────────────────────────────
describe('inviteToStage authorization', () => {
  beforeEach(() => { jest.clearAllMocks(); stubFindLiveClass(makeLc()); });

  test('SPEAKER caller is denied 403', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'STUDENT', isActive: true });
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._status).toBe(403);
  });

  test('HOST caller can invite', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._json.success).toBe(true);
  });

  test('MODERATOR caller can invite', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'MODERATOR', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._json.success).toBe(true);
  });

  test('inviteToStage stage full returns 400', async () => {
    stubFindLiveClass(makeLc({ maxSpeakers: 2 }));
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'p-t', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([{ speakerSlot: 0 }, { speakerSlot: 1 }]);
    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/full/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: demoteFromStage
// ─────────────────────────────────────────────────────────────────────────────
describe('demoteFromStage', () => {
  beforeEach(() => { jest.clearAllMocks(); stubFindLiveClass(makeLc()); });

  test('HOST can demote a STUDENT speaker', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST',    isActive: true })
      .mockResolvedValueOnce({ id: 'target', role: 'STUDENT', isActive: true, speakerSlot: 1 });
    prisma.liveClassParticipant.update.mockResolvedValue({});
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    getIo.mockReturnValue(io);
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-x' } });
    const res = makeRes();
    await ctrl.demoteFromStage(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ speakerSlot: null, isMuted: true }) })
    );
  });

  test('Cannot demote HOST', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'target', role: 'HOST', isActive: true });
    const req = makeReq({ params: { id: 'lc-1', userId: 'host-user' } });
    const res = makeRes();
    await ctrl.demoteFromStage(req, res, makeNext());
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/cannot demote.*host/i);
  });

  test('STUDENT caller is denied 403', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'STUDENT', isActive: true });
    const req = makeReq({ params: { id: 'lc-1', userId: 'someone' } });
    const res = makeRes();
    await ctrl.demoteFromStage(req, res, makeNext());
    expect(res._status).toBe(403);
  });

  test('Demotion emits speaker_removed, speaker_demoted, revoke_mic, you_were_demoted', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST',    isActive: true })
      .mockResolvedValueOnce({ id: 'target', role: 'STUDENT', isActive: true, speakerSlot: 0 });
    prisma.liveClassParticipant.update.mockResolvedValue({});
    const emitSpy = jest.fn();
    const toSpy = jest.fn().mockReturnValue({ emit: emitSpy });
    getIo.mockReturnValue({ to: toSpy });
    const req = makeReq({ params: { id: 'lc-1', userId: 'student-x' } });
    const res = makeRes();
    await ctrl.demoteFromStage(req, res, makeNext());
    const allEmits = emitSpy.mock.calls.map(c => c[0]);
    expect(allEmits).toContain('liveclass:speaker_removed');
    expect(allEmits).toContain('liveclass:speaker_demoted');
    expect(allEmits).toContain('liveclass:revoke_mic');
    expect(allEmits).toContain('liveclass:you_were_demoted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: drop-mic (H-2)
// ─────────────────────────────────────────────────────────────────────────────
describe('dropMicLiveClass (H-2)', () => {
  beforeEach(() => { jest.clearAllMocks(); stubFindLiveClass(makeLc()); });

  test('Active speaker can drop mic', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-me', role: 'STUDENT', speakerSlot: 1, isActive: true
    });
    prisma.liveClassParticipant.update.mockResolvedValue({});
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    getIo.mockReturnValue(io);
    const req = makeReq({ params: { id: 'lc-1' }, user: { id: 'student-x', role: 'STUDENT', schoolId: 'school-1' } });
    const res = makeRes();
    await ctrl.dropMicLiveClass(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ speakerSlot: null, isMuted: true }) })
    );
  });

  test('Audience user drop-mic returns idempotent 200', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-me', role: 'STUDENT', speakerSlot: null, isActive: true
    });
    const req = makeReq({ params: { id: 'lc-1' }, user: { id: 'student-x', role: 'STUDENT', schoolId: 'school-1' } });
    const res = makeRes();
    await ctrl.dropMicLiveClass(req, res, makeNext());
    expect(res._json.success).toBe(true);
    expect(res._json.message).toMatch(/already/i);
  });

  test('HOST cannot drop-mic via this endpoint', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-host', role: 'HOST', speakerSlot: null, isActive: true
    });
    const req = makeReq({ params: { id: 'lc-1' }, user: { id: 'host-u', role: 'TEACHER', schoolId: 'school-1' } });
    const res = makeRes();
    await ctrl.dropMicLiveClass(req, res, makeNext());
    expect(res._status).toBe(400);
  });

  test('drop-mic emits speaker_removed and revoke_mic', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-me', role: 'STUDENT', speakerSlot: 0, isActive: true
    });
    prisma.liveClassParticipant.update.mockResolvedValue({});
    const emitSpy = jest.fn();
    const toSpy = jest.fn().mockReturnValue({ emit: emitSpy });
    getIo.mockReturnValue({ to: toSpy });
    const req = makeReq({ params: { id: 'lc-1' }, user: { id: 'student-x', role: 'STUDENT', schoolId: 'school-1' } });
    const res = makeRes();
    await ctrl.dropMicLiveClass(req, res, makeNext());
    const allEmits = emitSpy.mock.calls.map(c => c[0]);
    expect(allEmits).toContain('liveclass:speaker_removed');
    expect(allEmits).toContain('liveclass:revoke_mic');
  });

  test('Non-participant gets 404', async () => {
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'lc-1' }, user: { id: 'outsider', role: 'STUDENT', schoolId: 'school-1' } });
    const res = makeRes();
    await ctrl.dropMicLiveClass(req, res, makeNext());
    expect(res._status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Socket event emission on promotion (H-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('H-1 Socket events emitted on promotion', () => {
  beforeEach(() => { jest.clearAllMocks(); stubFindLiveClass(makeLc()); });

  test('approveHand emits: hand_approved, speaker_added to room; grant_mic to user', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'target', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});

    const roomEmits = [];
    const userEmits = [];
    const io = {
      to: jest.fn().mockImplementation((room) => ({
        emit: jest.fn().mockImplementation((event, data) => {
          if (room.startsWith('liveclass:')) roomEmits.push(event);
          if (room.startsWith('user:'))      userEmits.push(event);
        }),
      })),
    };
    getIo.mockReturnValue(io);

    const req = makeReq({ params: { id: 'lc-1', userId: 'u1' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());

    expect(roomEmits).toContain('liveclass:hand_approved');
    expect(roomEmits).toContain('liveclass:speaker_added');
    expect(userEmits).toContain('liveclass:grant_mic');
  });

  test('inviteToStage emits: speaker_added to room; grant_mic to user (not hand_approved)', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'target', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);

    const roomEmits = [];
    const userEmits = [];
    const io = {
      to: jest.fn().mockImplementation((room) => ({
        emit: jest.fn().mockImplementation((event) => {
          if (room.startsWith('liveclass:')) roomEmits.push(event);
          if (room.startsWith('user:'))      userEmits.push(event);
        }),
      })),
    };
    getIo.mockReturnValue(io);

    const req = makeReq({ params: { id: 'lc-1', userId: 'u1' } });
    const res = makeRes();
    await ctrl.inviteToStage(req, res, makeNext());

    expect(roomEmits).toContain('liveclass:speaker_added');
    expect(userEmits).toContain('liveclass:grant_mic');
    // inviteToStage should NOT emit hand_approved (avoid conflating invite with queue approval)
    expect(roomEmits).not.toContain('liveclass:hand_approved');
  });

  test('speaker_added payload contains speakerSlot', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'target', speakerSlot: null, isActive: true });
    prisma.liveClassParticipant.findMany.mockResolvedValue([{ speakerSlot: 0 }]); // slot 0 taken
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});

    let capturedPayload = null;
    const io = {
      to: jest.fn().mockImplementation((room) => ({
        emit: jest.fn().mockImplementation((event, data) => {
          if (event === 'liveclass:speaker_added') capturedPayload = data;
        }),
      })),
    };
    getIo.mockReturnValue(io);

    const req = makeReq({ params: { id: 'lc-1', userId: 'u2' } });
    const res = makeRes();
    await ctrl.approveHand(req, res, makeNext());

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.speakerSlot).toBe(1); // slot 0 taken → assigns slot 1
    expect(capturedPayload.userId).toBe('u2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Rejoin clears stale speakerSlot (H-7) — source code audit
// ─────────────────────────────────────────────────────────────────────────────
describe('H-7 joinLiveClass rejoin clears stale speakerSlot', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function joinLiveClass');
  const fnEnd   = src.indexOf('async function leaveLiveClass');
  const fn      = src.slice(fnStart, fnEnd);

  test('joinLiveClass upsert update clause includes speakerSlot: null', () => {
    // The upsert update must reset speakerSlot so rejoining users start as audience
    expect(fn).toMatch(/speakerSlot\s*:\s*null/);
  });

  test('joinLiveClass upsert update clause resets handRaised', () => {
    expect(fn).toMatch(/handRaised\s*:\s*false/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: drop-mic route registration (H-2) — source code audit
// ─────────────────────────────────────────────────────────────────────────────
describe('H-2 drop-mic route registered in live-class.routes.js', () => {
  const fs   = require('fs');
  const path = require('path');
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '../routes/live-class.routes.js'), 'utf8'
  );

  test('POST /:id/drop-mic route exists', () => {
    expect(routesSrc).toMatch(/router\.post\s*\(\s*['"`]\/:id\/drop-mic['"`]/);
  });

  test('drop-mic uses ctrl.dropMicLiveClass', () => {
    expect(routesSrc).toMatch(/dropMicLiveClass/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Schema unique constraint audit (DB safety net)
// ─────────────────────────────────────────────────────────────────────────────
describe('DB safety net: unique speakerSlot constraint', () => {
  const fs   = require('fs');
  const path = require('path');

  test('schema.prisma has @@unique on [liveClassId, speakerSlot]', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
    );
    expect(schema).toMatch(/@@unique\(\[liveClassId,\s*speakerSlot\]/);
  });

  test('migration SQL file adds unique key', () => {
    const migPath = path.join(
      __dirname, '../../prisma/migrations/20260913_live_class_stage_lifecycle/migration.sql'
    );
    const migration = fs.readFileSync(migPath, 'utf8');
    expect(migration).toMatch(/ADD UNIQUE KEY/i);
    expect(migration).toMatch(/unique_liveclass_speaker_slot/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: Regression — existing functionality unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('Regression: rejectHand, getHandQueue unaffected', () => {
  beforeEach(() => { jest.clearAllMocks(); stubFindLiveClass(makeLc()); });

  test('rejectHand still works (lowers hand, no stage change)', async () => {
    prisma.liveClassHandQueue.updateMany.mockResolvedValue({});
    prisma.liveClassParticipant.updateMany.mockResolvedValue({});
    const req = makeReq({ params: { id: 'lc-1', userId: 'u1' } });
    const res = makeRes();
    await ctrl.rejectHand(req, res, makeNext());
    expect(res._json.success).toBe(true);
  });

  test('demoteFromStage: non-existent participant returns 404', async () => {
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller', role: 'HOST', isActive: true })
      .mockResolvedValueOnce(null);
    const req = makeReq({ params: { id: 'lc-1', userId: 'ghost' } });
    const res = makeRes();
    await ctrl.demoteFromStage(req, res, makeNext());
    expect(res._status).toBe(404);
  });
});
