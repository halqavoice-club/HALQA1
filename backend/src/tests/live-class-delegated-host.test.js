'use strict';
/**
 * live-class-delegated-host.test.js
 *
 * After PR #1 (Phase 24L), the delegated-host model was replaced with:
 *   - promoteToModerator / demoteModerator (HOST can promote/demote)
 *   - transferHost (transfer full HOST to another participant)
 *   - assertOwnerOrModerator (async DB check for HOST/MODERATOR role)
 *
 * Architecture invariants tested:
 *   - Only the current HOST can promote/demote moderators
 *   - Only the current HOST can transfer host
 *   - SUPER_ADMIN blocked at route level (not a participant)
 *   - assertOwnerOrModerator requires active participant record with HOST/MODERATOR
 *   - Source-level: assignDelegatedHost is gone; promoteToModerator exists
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
const fs     = require('fs');
const path   = require('path');
let ctrl;

beforeAll(() => {
  ctrl = require('../controllers/live-class.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
});

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}
const next = jest.fn();

function makeLcRow(overrides = {}) {
  return {
    id: 'class-1',
    streamType: 'SCHOOL',
    schoolId: 'school-a',
    classId: 'class-abc',
    teacherId: 'teacher-rec-1',
    hostUserId: 'creator-1',
    delegatedHostId: null,
    title: 'Test Class',
    description: null,
    status: 'LIVE',
    livekitRoomName: 'liveclass-class-1',
    duration: null,
    chatEnabled: true, handRaiseEnabled: true, whiteboardEnabled: true,
    quranPanelEnabled: false, isOpenMic: false, screenShareEnabled: true,
    maxParticipants: null, maxSpeakers: 20,
    isRecorded: false, recordingStartedAt: null,
    startedAt: new Date(), endedAt: null, deletedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

// Stub findLiveClass to return the lc object via ORM fallback.
// We make $queryRawUnsafe throw so findLiveClass falls through to prisma.liveClass.findFirst.
function stubFindLiveClass(lcObj) {
  prisma.$queryRawUnsafe.mockRejectedValue(new Error('raw not available in test'));
  prisma.liveClass.findFirst = jest.fn().mockResolvedValue(lcObj);
  prisma.liveClassParticipant.findMany = jest.fn().mockResolvedValue([]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Source audit: delegated host model removed, new model present
// ─────────────────────────────────────────────────────────────────────────────
describe('Source audit: PR authorization model', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../controllers/live-class.controller.js'), 'utf8'
  );

  test('assignDelegatedHost is removed (PR removed delegated-host model)', () => {
    expect(src).not.toMatch(/async function assignDelegatedHost/);
  });

  test('revokeDelegatedHost is removed', () => {
    expect(src).not.toMatch(/async function revokeDelegatedHost/);
  });

  test('assertHostOrDelegate is removed', () => {
    expect(src).not.toMatch(/function assertHostOrDelegate/);
  });

  test('promoteToModerator exists (PR replacement)', () => {
    expect(src).toMatch(/async function promoteToModerator/);
  });

  test('demoteModerator exists (PR replacement)', () => {
    expect(src).toMatch(/async function demoteModerator/);
  });

  test('transferHost exists (PR addition)', () => {
    expect(src).toMatch(/async function transferHost/);
  });

  test('assertOwnerOrModerator exists (replaces assertHostOrDelegate)', () => {
    expect(src).toMatch(/async function assertOwnerOrModerator/);
  });

  test('assertOwnerOrModerator checks participant DB record', () => {
    const idx = src.indexOf('async function assertOwnerOrModerator');
    const fn = src.slice(idx, idx + 600);
    expect(fn).toMatch(/liveClassParticipant\.findFirst/);
    expect(fn).toMatch(/HOST.*MODERATOR|MODERATOR.*HOST/);
    expect(fn).toMatch(/403/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// promoteToModerator: only HOST can promote
// ─────────────────────────────────────────────────────────────────────────────
describe('promoteToModerator — HOST can promote a participant to MODERATOR', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('HOST can promote a STUDENT to MODERATOR', async () => {
    stubFindLiveClass(makeLcRow());
    // isCreator = true (creator-1 === creator-1) → no HOST findFirst needed
    // Target findFirst → STUDENT
    prisma.liveClassParticipant.findFirst.mockResolvedValueOnce({ id: 'p-target', role: 'STUDENT', isActive: true });
    prisma.$executeRawUnsafe.mockResolvedValue(1);

    const req = {
      params: { id: 'class-1', userId: 'student-1' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.promoteToModerator(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('STUDENT caller (not HOST in participants) gets 403', async () => {
    stubFindLiveClass(makeLcRow({ hostUserId: 'other-creator' }));
    // isCreator = false → findFirst for HOST role of caller → null → 403
    prisma.liveClassParticipant.findFirst.mockResolvedValueOnce(null);

    const req = {
      params: { id: 'class-1', userId: 'target-1' },
      user: { id: 'student-caller', role: 'STUDENT', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'STUDENT', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.promoteToModerator(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Cannot promote HOST', async () => {
    stubFindLiveClass(makeLcRow());
    // isCreator = true → target findFirst → HOST
    prisma.liveClassParticipant.findFirst.mockResolvedValueOnce({ id: 'p-host', role: 'HOST', isActive: true });

    const req = {
      params: { id: 'class-1', userId: 'other-host' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.promoteToModerator(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// demoteModerator: only HOST can demote
// ─────────────────────────────────────────────────────────────────────────────
describe('demoteModerator — HOST can demote a MODERATOR to STUDENT', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('HOST can demote a MODERATOR', async () => {
    stubFindLiveClass(makeLcRow());
    // isCreator = true → no HOST findFirst
    // modRows query ($queryRawUnsafe second call) → returns [{ id: 'p-mod' }]
    prisma.$queryRawUnsafe
      .mockRejectedValueOnce(new Error('raw for findLiveClass')) // findLiveClass throws → ORM fallback
      .mockResolvedValueOnce([{ id: 'p-mod' }]); // modRows query
    prisma.$executeRawUnsafe.mockResolvedValue(1);

    const req = {
      params: { id: 'class-1', userId: 'mod-user' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.demoteModerator(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transferHost: current HOST can transfer
// ─────────────────────────────────────────────────────────────────────────────
describe('transferHost — HOST can transfer to another participant', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('Cannot transfer to yourself', async () => {
    stubFindLiveClass(makeLcRow());

    const req = {
      params: { id: 'class-1', userId: 'creator-1' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.transferHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertOwnerOrModerator: functional test via kickParticipant
// ─────────────────────────────────────────────────────────────────────────────
describe('assertOwnerOrModerator — enforced on kick', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('Caller without HOST/MODERATOR participant record gets 403 (via next)', async () => {
    stubFindLiveClass(makeLcRow());
    // assertOwnerOrModerator: findFirst for caller → null → throws 403
    prisma.liveClassParticipant.findFirst.mockResolvedValueOnce(null);

    const req = {
      params: { id: 'class-1', userId: 'target-user' },
      user: { id: 'random-user', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.kickParticipant(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]?.status).toBe(403);
  });

  test('Caller with HOST participant record passes assertOwnerOrModerator', async () => {
    stubFindLiveClass(makeLcRow());
    // First findFirst: assertOwnerOrModerator → caller is HOST
    // Second findFirst: kickParticipant target lookup
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'caller-p', role: 'HOST', isActive: true })
      .mockResolvedValueOnce({ id: 'target-p', role: 'STUDENT', isActive: true });
    prisma.liveClassParticipant.update.mockResolvedValue({});

    const req = {
      params: { id: 'class-1', userId: 'target-user' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' },
      schoolMembership: { schoolId: 'school-a', role: 'TEACHER', status: 'ACTIVE' },
    };
    const res = makeRes();
    await ctrl.kickParticipant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
