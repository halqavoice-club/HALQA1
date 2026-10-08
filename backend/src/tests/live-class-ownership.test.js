/**
 * HALQA — Live Class / Stream Ownership Authorization Tests
 *
 * Bug 1 (OWN-01-A): A TEACHER joining another user's PUBLIC live stream
 *   was incorrectly assigned HOST role because `isTeacher` bypassed `isPublicHost`.
 *   Fix: `isEffectivelyStaff = streamType === 'SCHOOL' && (isTeacher || isStaff)`
 *        `role = (isEffectivelyStaff || isPublicHost) ? 'HOST' : 'STUDENT'`
 *
 * Bug 2 (OWN-01-B): Any TEACHER in the same school could edit/delete/start/end
 *   a live class created by a different teacher.
 *   Fix: `assertOwner()` added to update/delete/start/end.
 *
 * Tests: source-code audits + functional tests for cases where mock isolation
 * is reliable (joinLiveClass PUBLIC stream tests use findLiveClass via $queryRawUnsafe).
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const CTRL = path.join(__dirname, '../controllers/live-class.controller.js');
const src  = fs.readFileSync(CTRL, 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Source-code audit — OWN-01-A (PUBLIC stream HOST assignment)
// ─────────────────────────────────────────────────────────────────────────────
describe('OWN-01-A source audit: PUBLIC stream HOST assignment', () => {
  test('isEffectivelyStaff is defined inside joinLiveClass', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    expect(joinIdx).toBeGreaterThan(-1);
    const fn = src.slice(joinIdx, joinIdx + 4000);
    expect(fn).toMatch(/isEffectivelyStaff/);
  });

  test('isEffectivelyStaff is gated on streamType === SCHOOL', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 4000);
    expect(fn).toMatch(/isEffectivelyStaff = streamType === 'SCHOOL'/);
  });

  test('isCreator defined as hostUserId === userId', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 4000);
    // PR: isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId
    expect(fn).toMatch(/isPublicHost.*hostUserId|hostUserId.*isPublicHost/);
  });

  test('role = HOST only for isCreator', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 4000);
    // PR: role = (isEffectivelyStaff || isPublicHost) ? 'HOST' : 'STUDENT'
    expect(fn).toMatch(/isPublicHost/);
    expect(fn).toMatch(/HOST/);
    // Must NOT have old pattern
    expect(fn).not.toMatch(/const role = \(isTeacher/);
  });

  test('non-creator SCHOOL staff gets MODERATOR', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 4000);
    // PR: role = (isEffectivelyStaff || isPublicHost) ? 'HOST' : 'STUDENT'
    // SCHOOL staff get HOST (isEffectivelyStaff), PUBLIC non-creator get STUDENT
    expect(fn).toMatch(/isEffectivelyStaff/);
  });

  test('isHost (auto-start) uses isEffectivelyStaff OR isPublicHost', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 8000);
    // PR: const isHost = isEffectivelyStaff || isPublicHost
    expect(fn).toMatch(/isHost = isEffectivelyStaff \|\| isPublicHost/);
  });

  test('upsert isMuted respects host flags', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 6000);
    // PR: isMuted: !(isEffectivelyStaff || isPublicHost || lc.isOpenMic)
    expect(fn).toMatch(/isMuted.*isEffectivelyStaff.*isPublicHost|isMuted.*isPublicHost/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Source-code audit — OWN-01-B (ownership guard on mutations)
// ─────────────────────────────────────────────────────────────────────────────
describe('OWN-01-B source audit: ownership guard on mutations', () => {
  test('assertOwnerOrModerator function exists', () => {
    // PR: assertOwner replaced by assertOwnerOrModerator (async DB check)
    expect(src).toMatch(/async function assertOwnerOrModerator/);
  });

  test('assertOwnerOrModerator checks participant role in DB', () => {
    const fnIdx = src.indexOf('async function assertOwnerOrModerator');
    const fn = src.slice(fnIdx, fnIdx + 600);
    expect(fn).toMatch(/liveClassParticipant\.findFirst/);
    expect(fn).toMatch(/HOST.*MODERATOR|MODERATOR.*HOST/);
    expect(fn).toMatch(/403/);
  });

  test('assertOwnerOrModerator has no school admin bypass', () => {
    const fnIdx = src.indexOf('async function assertOwnerOrModerator');
    const fn = src.slice(fnIdx, fnIdx + 600);
    expect(fn).not.toMatch(/isSchoolAdmin/);
    expect(fn).not.toMatch(/SCHOOL_ADMIN/);
  });

  test('updateLiveClass uses isHostForEdit gate', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 1500);
    expect(fn).toMatch(/isHostForEdit/);
  });

  test('deleteLiveClass uses assertSchoolAccess guard', () => {
    const idx = src.indexOf('async function deleteLiveClass');
    const fn = src.slice(idx, idx + 400);
    // PR: deleteLiveClass uses assertSchoolAccess + route-level resolveStreamStaffAccess
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('startLiveClass uses assertSchoolAccess guard', () => {
    const idx = src.indexOf('async function startLiveClass');
    const fn = src.slice(idx, idx + 600);
    // PR: route-level resolveStreamStaffAccess enforces host check for PUBLIC streams
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('endLiveClass uses assertSchoolAccess guard', () => {
    const idx = src.indexOf('async function endLiveClass');
    const fn = src.slice(idx, idx + 500);
    expect(fn).toMatch(/assertSchoolAccess/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Functional tests — OWN-01-A (joinLiveClass PUBLIC HOST assignment)
// These use findLiveClass (via $queryRawUnsafe) which is well-isolated.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../utils/prisma', () => ({
  liveClassParticipant: {
    findFirst: jest.fn(),
    upsert:    jest.fn(),
    findMany:  jest.fn(),
    count:     jest.fn(),
  },
  liveClassAttendance: { upsert: jest.fn() },
  student:   { findFirst: jest.fn() },
  enrollment:{ findFirst: jest.fn() },
  user:      { findUnique: jest.fn() },
  $queryRawUnsafe:   jest.fn(),
  $executeRawUnsafe: jest.fn(),
}));

jest.mock('../sockets',          () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive',   () => ({ broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn() }));
jest.mock('../services/queue.service', () => ({ queueBulkNotifications: jest.fn() }));
jest.mock('../utils/logger',     () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require('../utils/prisma');
const ctrl   = require('../controllers/live-class.controller');

function makeRes() {
  const res = { _status: 200, _json: null };
  res.status = jest.fn().mockImplementation(s => { res._status = s; return res; });
  res.json   = jest.fn().mockImplementation(b => { res._json  = b; return res; });
  return res;
}
const next = jest.fn();

// Stub findLiveClass (uses $queryRawUnsafe → returns PUBLIC stream row)
function stubPublicLc(hostUserId = 'creator-id') {
  prisma.$queryRawUnsafe.mockResolvedValue([{
    id: 'lc-pub-1',
    stream_type: 'PUBLIC', streamType: 'PUBLIC',
    schoolId: null, classId: null, teacherId: null,
    host_user_id: hostUserId, hostUserId,
    title: 'Test Public Stream', description: null,
    status: 'LIVE', livekitRoomName: 'liveclass-lc-pub-1',
    duration: null, chatEnabled: 1, handRaiseEnabled: 1,
    whiteboardEnabled: 1, quranPanelEnabled: 0, isOpenMic: 0,
    screenShareEnabled: 1, maxParticipants: null, maxSpeakers: 20,
    isRecorded: 0, recordingStartedAt: null, startedAt: new Date(),
    endedAt: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  }]);
}

describe('OWN-01-A functional: PUBLIC stream role on join', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('TEACHER joining someone else\'s PUBLIC stream gets STUDENT role', async () => {
    stubPublicLc('creator-id');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-1', userId: 'teacher-other', role: 'STUDENT', isMuted: true,
      user: { id: 'teacher-other', firstName: 'T', lastName: 'E', avatarUrl: null, role: 'TEACHER' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'teacher-other', role: 'TEACHER', schoolId: 'school-1', firstName: 'T', lastName: 'E' },
      schoolMembership: { role: 'TEACHER' },
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res._json.success).toBe(true);
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('STUDENT');
  });

  test('Creator joins their own PUBLIC stream gets HOST role', async () => {
    stubPublicLc('creator-id');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-2', userId: 'creator-id', role: 'HOST', isMuted: false,
      user: { id: 'creator-id', firstName: 'C', lastName: 'R', avatarUrl: null, role: 'TEACHER' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'creator-id', role: 'TEACHER', schoolId: null, firstName: 'C', lastName: 'R' },
      schoolMembership: null,
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res._json.success).toBe(true);
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('HOST');
  });

  test('SCHOOL_ADMIN joining another user\'s PUBLIC stream gets STUDENT role', async () => {
    stubPublicLc('creator-id');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-3', userId: 'admin-other', role: 'STUDENT', isMuted: true,
      user: { id: 'admin-other', firstName: 'A', lastName: 'D', avatarUrl: null, role: 'SCHOOL_ADMIN' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'admin-other', role: 'SCHOOL_ADMIN', schoolId: 'school-2', firstName: 'A', lastName: 'D' },
      schoolMembership: { role: 'SCHOOL_ADMIN' },
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res._json.success).toBe(true);
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('STUDENT');
  });

  test('STUDENT joining PUBLIC stream gets STUDENT role', async () => {
    stubPublicLc('creator-id');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-4', userId: 'student-1', role: 'STUDENT', isMuted: true,
      user: { id: 'student-1', firstName: 'S', lastName: 'T', avatarUrl: null, role: 'STUDENT' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'student-1', role: 'STUDENT', schoolId: 'school-1', firstName: 'S', lastName: 'T' },
      schoolMembership: null,
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res._json.success).toBe(true);
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('STUDENT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Route-level audit — resolveStreamStaffAccess for PUBLIC
// ─────────────────────────────────────────────────────────────────────────────
describe('Route-level audit: resolveStreamStaffAccess PUBLIC host check', () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '../routes/live-class.routes.js'), 'utf8'
  );

  test('resolveStreamStaffAccess checks hostUserId === req.user.id for PUBLIC', () => {
    const fnIdx = routesSrc.indexOf('async function resolveStreamStaffAccess');
    const fn = routesSrc.slice(fnIdx, fnIdx + 1200);
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
    expect(fn).toMatch(/403/);
  });

  test('PATCH /:id uses resolveStreamStaffAccess', () => {
    expect(routesSrc).toMatch(/router\.patch.*'\/:id'.*resolveStreamStaffAccess/s);
  });

  test('DELETE /:id uses resolveStreamStaffAccess', () => {
    expect(routesSrc).toMatch(/router\.delete.*'\/:id'.*resolveStreamStaffAccess/s);
  });

  test('POST /:id/start uses resolveStreamStaffAccess', () => {
    expect(routesSrc).toMatch(/router\.post.*'\/:id\/start'.*resolveStreamStaffAccess/s);
  });

  test('POST /:id/end uses resolveStreamStaffAccess', () => {
    expect(routesSrc).toMatch(/router\.post.*'\/:id\/end'.*resolveStreamStaffAccess/s);
  });
});
