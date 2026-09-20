'use strict';
/**
 * live-class-delegated-host.test.js
 *
 * Tests for the HALQA Delegated Hosting feature on SCHOOL Live Classes.
 *
 * Architecture invariants tested:
 *   - Only the creator (hostUserId) can assign / revoke a delegated host
 *   - Only SCHOOL streams support delegation (PUBLIC streams are blocked)
 *   - Target must be active TEACHER or SCHOOL_ADMIN in the same school
 *   - STUDENT, GUARDIAN, REPRESENTATIVE, SUPER_ADMIN are ineligible targets
 *   - Self-assignment normalises to NULL (clears delegation)
 *   - Atomic assignment rejects ended/cancelled classes
 *   - Revoke derives fallback role from SchoolMembership (not hardcoded MODERATOR)
 *   - Revoke does NOT create a participant record when none exists
 *   - Revoke does NOT alter kicked participants
 *   - joinLiveClass: creator → HOST, delegated → HOST, staff → MODERATOR, student → STUDENT
 *   - Delegated host triggers auto-start on SCHEDULED class (same as creator)
 *   - isMuted: creator and delegated host start unmuted
 *   - assertHostOrDelegate: operational host operations pass; assertOwner remains for structural ops
 *   - SUPER_ADMIN cannot be assigned as delegated host
 *   - PUBLIC class delegation rejected
 *   - Non-creator (teacher, admin, delegated host) cannot assign/revoke
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

beforeAll(() => {
  ctrl = require('../controllers/live-class.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: auditLog.create is a no-op
  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});
  // Default: schoolMembership
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}
const next = jest.fn();

/** Returns a raw-SQL result row for findLiveClass (SCHOOL stream) */
function makeSchoolLc(overrides = {}) {
  return [{
    id:                  'lc-1',
    stream_type:         'SCHOOL',
    streamType:          'SCHOOL',
    schoolId:            'school-a',
    classId:             'cls-1',
    teacherId:           'teacher-rec-1',
    host_user_id:        'creator-1',
    hostUserId:          'creator-1',
    delegated_host_id:   null,
    delegatedHostId:     null,
    title:               'Test Class',
    description:         null,
    status:              'SCHEDULED',
    livekitRoomName:     null,
    duration:            null,
    chatEnabled:         1,
    handRaiseEnabled:    1,
    whiteboardEnabled:   1,
    quranPanelEnabled:   0,
    isOpenMic:           0,
    screenShareEnabled:  1,
    maxSpeakers:         20,
    isRecorded:          0,
    recordingStartedAt:  null,
    startedAt:           null,
    endedAt:             null,
    deletedAt:           null,
    createdAt:           new Date(),
    updatedAt:           new Date(),
    ...overrides,
  }];
}

function makePublicLc(overrides = {}) {
  return [{
    id:                  'lc-pub-1',
    stream_type:         'PUBLIC',
    streamType:          'PUBLIC',
    schoolId:            null,
    classId:             null,
    teacherId:           null,
    host_user_id:        'creator-1',
    hostUserId:          'creator-1',
    delegated_host_id:   null,
    delegatedHostId:     null,
    title:               'Public Stream',
    description:         null,
    status:              'LIVE',
    livekitRoomName:     'liveclass-lc-pub-1',
    duration:            null,
    chatEnabled:         1,
    handRaiseEnabled:    1,
    whiteboardEnabled:   1,
    quranPanelEnabled:   0,
    isOpenMic:           1,
    screenShareEnabled:  1,
    maxSpeakers:         20,
    isRecorded:          0,
    recordingStartedAt:  null,
    startedAt:           new Date(),
    endedAt:             null,
    deletedAt:           null,
    createdAt:           new Date(),
    updatedAt:           new Date(),
    ...overrides,
  }];
}

function creatorReq(overrides = {}) {
  return {
    params:          { id: 'lc-1' },
    body:            { userId: 'teacher-user-2' },
    user:            { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'C', lastName: 'R' },
    schoolId:        'school-a',
    schoolMembership: { role: 'TEACHER' },
    ...overrides,
  };
}

// ─── Source-code audit helpers ────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const CTRL = path.join(__dirname, '../controllers/live-class.controller.js');
const src  = fs.readFileSync(CTRL, 'utf8');

function sliceFn(name) {
  const idx = src.indexOf(`async function ${name}`);
  if (idx === -1) throw new Error(`Function ${name} not found`);
  return src.slice(idx, idx + 5000);
}

// ─── SECTION 1: Source-code audit ─────────────────────────────────────────────
describe('DEL-SRC-01 assignDelegatedHost source audit', () => {
  const fn = sliceFn('assignDelegatedHost');

  test('function exists', () => {
    expect(src.indexOf('async function assignDelegatedHost')).toBeGreaterThan(-1);
  });

  test('rejects PUBLIC streams', () => {
    expect(fn).toMatch(/streamType.*!==.*'SCHOOL'|streamType.*SCHOOL/);
  });

  test('enforces creator-only with hostUserId check', () => {
    expect(fn).toMatch(/hostUserId.*req\.user\.id|req\.user\.id.*hostUserId/);
    expect(fn).toMatch(/403/);
  });

  test('rejects SUPER_ADMIN target', () => {
    expect(fn).toMatch(/SUPER_ADMIN/);
  });

  test('checks SchoolMembership for eligible roles', () => {
    expect(fn).toMatch(/schoolMembership\.findFirst/);
    expect(fn).toMatch(/TEACHER.*SCHOOL_ADMIN|eligibleRoles/);
  });

  test('self-assignment normalises to NULL', () => {
    expect(fn).toMatch(/targetUserId === lc\.hostUserId/);
    expect(fn).toMatch(/NULL/i);
  });

  test('uses parameterized raw SQL (no interpolation)', () => {
    // Values are bound via ?, never concatenated into the SQL string
    expect(fn).toMatch(/\$executeRawUnsafe/);
    expect(fn).toMatch(/delegated_host_id = \?/);
  });

  test('emits liveclass:host_assigned socket event', () => {
    expect(fn).toMatch(/liveclass:host_assigned/);
  });

  test('records audit log', () => {
    expect(fn).toMatch(/auditLog\.create/);
    expect(fn).toMatch(/live_class_host_assignment/);
  });
});

describe('DEL-SRC-02 revokeDelegatedHost source audit', () => {
  const fn = sliceFn('revokeDelegatedHost');

  test('function exists', () => {
    expect(src.indexOf('async function revokeDelegatedHost')).toBeGreaterThan(-1);
  });

  test('enforces creator-only', () => {
    expect(fn).toMatch(/hostUserId.*req\.user\.id/);
    expect(fn).toMatch(/403/);
  });

  test('derives fallback role from SchoolMembership (not hardcoded MODERATOR)', () => {
    // Must consult SchoolMembership, not blindly set MODERATOR
    expect(fn).toMatch(/schoolMembership\.findFirst/);
    expect(fn).toMatch(/fallbackRole/);
    expect(fn).toMatch(/MODERATOR/);
    expect(fn).toMatch(/STUDENT/);
  });

  test('does not create participant record', () => {
    // Should NOT call liveClassParticipant.create or upsert in revoke path
    expect(fn).not.toMatch(/liveClassParticipant\.create/);
    expect(fn).not.toMatch(/liveClassParticipant\.upsert/);
  });

  test('does not alter kicked participants', () => {
    expect(fn).toMatch(/wasKicked/);
  });

  test('emits liveclass:host_revoked and liveclass:your_host_revoked', () => {
    expect(fn).toMatch(/liveclass:host_revoked/);
    expect(fn).toMatch(/liveclass:your_host_revoked/);
  });

  test('records audit log with DELETE action', () => {
    expect(fn).toMatch(/auditLog\.create/);
    expect(fn).toMatch(/DELETE/);
    expect(fn).toMatch(/live_class_host_assignment/);
  });
});

describe('DEL-SRC-03 assertHostOrDelegate source audit', () => {
  const fnIdx = src.indexOf('function assertHostOrDelegate');
  const fn = src.slice(fnIdx, fnIdx + 600);

  test('function exists', () => {
    expect(fnIdx).toBeGreaterThan(-1);
  });

  test('allows creator (hostUserId === user.id)', () => {
    expect(fn).toMatch(/hostUserId.*user\.id/);
  });

  test('gates delegated host on SCHOOL stream type', () => {
    expect(fn).toMatch(/streamType.*===.*'SCHOOL'/);
    expect(fn).toMatch(/delegatedHostId/);
  });

  test('throws 403 for non-creator non-delegated', () => {
    expect(fn).toMatch(/403/);
  });
});

describe('DEL-SRC-04 joinLiveClass delegated host', () => {
  const joinIdx = src.indexOf('async function joinLiveClass');
  const fn = src.slice(joinIdx, joinIdx + 8000);

  test('isDelegatedHost computed with SCHOOL gate', () => {
    expect(fn).toMatch(/isDelegatedHost/);
    expect(fn).toMatch(/streamType === 'SCHOOL'/);
    expect(fn).toMatch(/delegatedHostId/);
  });

  test('delegated host gets HOST role', () => {
    expect(fn).toMatch(/isDelegatedHost/);
    expect(fn).toMatch(/HOST/);
  });

  test('isHost for auto-start includes isDelegatedHost', () => {
    expect(fn).toMatch(/const isHost = isCreator \|\| isDelegatedHost/);
  });

  test('isMuted respects isDelegatedHost (starts unmuted)', () => {
    expect(fn).toMatch(/isCreator \|\| isDelegatedHost/);
  });
});

describe('DEL-SRC-05 endLiveClass clears delegatedHostId', () => {
  test('explicit end clears delegated_host_id', () => {
    const endIdx = src.indexOf('async function endLiveClass');
    const fn = src.slice(endIdx, endIdx + 2000);
    expect(fn).toMatch(/delegated_host_id.*NULL|NULL.*delegated_host_id/i);
  });

  test('_endLiveClassById clears delegated_host_id (auto-end path)', () => {
    const autoIdx = src.indexOf('async function _endLiveClassById');
    const fn = src.slice(autoIdx, autoIdx + 1500);
    expect(fn).toMatch(/delegated_host_id.*NULL|NULL.*delegated_host_id/i);
  });
});

describe('DEL-SRC-06 updateLiveClass field-level authorization', () => {
  const fn = sliceFn('updateLiveClass');

  test('isDelegatedHostForEdit computed', () => {
    expect(fn).toMatch(/isDelegatedHostForEdit/);
  });

  test('maxSpeakers rejected for delegated host', () => {
    expect(fn).toMatch(/maxSpeakers/);
    expect(fn).toMatch(/isCreatorForEdit/);
  });

  test('isRecorded rejected for delegated host', () => {
    expect(fn).toMatch(/isRecorded/);
    expect(fn).toMatch(/isCreatorForEdit/);
  });

  test('scheduledAt rejected while LIVE', () => {
    expect(fn).toMatch(/scheduledAt/);
    expect(fn).toMatch(/LIVE/);
  });
});

describe('DEL-SRC-07 PUBLIC stream protection', () => {
  test('resolveStreamStaffAccess checks hostUserId (not delegatedHostId) for PUBLIC', () => {
    const routesSrc = fs.readFileSync(
      path.join(__dirname, '../routes/live-class.routes.js'), 'utf8'
    );
    const fnIdx = routesSrc.indexOf('async function resolveStreamStaffAccess');
    const fn = routesSrc.slice(fnIdx, fnIdx + 1000);
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
    // Must NOT reference delegatedHostId
    expect(fn).not.toMatch(/delegatedHostId/);
  });

  test('assertSchoolAccess blocks SUPER_ADMIN on SCHOOL streams', () => {
    const fnIdx = src.indexOf('function assertSchoolAccess');
    const fn = src.slice(fnIdx, fnIdx + 600);
    expect(fn).toMatch(/SUPER_ADMIN/);
    expect(fn).toMatch(/403/);
  });
});

describe('DEL-SRC-08 assertOwner still guards structural ops', () => {
  test('deleteLiveClass uses assertOwner', () => {
    const fn = sliceFn('deleteLiveClass');
    expect(fn).toMatch(/assertOwner\(lc,\s*req\.user\)/);
  });

  test('assignDelegatedHost uses hostUserId check (not assertHostOrDelegate)', () => {
    const fn = sliceFn('assignDelegatedHost');
    // Must check hostUserId !== req.user.id directly
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
    // Must NOT use assertOwner (which throws) — should use errorResponse instead
    // Note: we only check it's NOT using assertHostOrDelegate for the creator gate
    expect(fn).not.toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });

  test('revokeDelegatedHost uses hostUserId check (not assertHostOrDelegate)', () => {
    const fn = sliceFn('revokeDelegatedHost');
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
    expect(fn).not.toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
  });
});

// ─── SECTION 2: Functional tests — assignDelegatedHost ────────────────────────
describe('assignDelegatedHost functional tests', () => {
  function stubSchoolLc(overrides = {}) {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc(overrides));
  }

  test('creator → TEACHER: assigns successfully', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    prisma.user.findFirst = jest.fn().mockResolvedValue({ id: 'teacher-user-2', role: 'TEACHER' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassParticipant = { findFirst: jest.fn().mockResolvedValue(null) };

    const req = creatorReq();
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('creator → SCHOOL_ADMIN: assigns successfully', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'SCHOOL_ADMIN', status: 'ACTIVE' });
    prisma.user.findFirst = jest.fn().mockResolvedValue({ id: 'admin-user-2', role: 'SCHOOL_ADMIN' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassParticipant = { findFirst: jest.fn().mockResolvedValue(null) };

    const req = creatorReq({ body: { userId: 'admin-user-2' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('non-creator teacher cannot assign', async () => {
    stubSchoolLc();
    const req = creatorReq({
      user: { id: 'other-teacher', role: 'TEACHER', schoolId: 'school-a', firstName: 'O', lastName: 'T' },
    });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('delegated host cannot assign further', async () => {
    stubSchoolLc({ delegated_host_id: 'delegate-1', delegatedHostId: 'delegate-1' });
    const req = creatorReq({
      user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'D', lastName: 'H' },
    });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('STUDENT target rejected (ineligible role)', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE' });

    const req = creatorReq({ body: { userId: 'student-user-2' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/TEACHER.*SCHOOL_ADMIN|only.*TEACHER/i),
    }));
  });

  test('GUARDIAN target rejected', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'GUARDIAN', status: 'ACTIVE' });

    const req = creatorReq({ body: { userId: 'guardian-user-1' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('REPRESENTATIVE target rejected', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'REPRESENTATIVE', status: 'ACTIVE' });

    const req = creatorReq({ body: { userId: 'rep-user-1' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('SUPER_ADMIN target rejected (even with TEACHER membership)', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    prisma.user.findFirst = jest.fn().mockResolvedValue({ id: 'sa-user', role: 'SUPER_ADMIN' });

    const req = creatorReq({ body: { userId: 'sa-user' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/SUPER_ADMIN/),
    }));
  });

  test('cross-school target rejected (no membership)', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue(null);

    const req = creatorReq({ body: { userId: 'cross-school-user' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('PUBLIC class rejected', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue(makePublicLc());
    const req = creatorReq({ params: { id: 'lc-pub-1' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/school live/i),
    }));
  });

  test('ENDED class rejected', async () => {
    stubSchoolLc({ status: 'ENDED' });
    const req = creatorReq();
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('CANCELLED class rejected', async () => {
    stubSchoolLc({ status: 'CANCELLED' });
    const req = creatorReq();
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('self-assignment normalises to NULL when delegation exists', async () => {
    stubSchoolLc({ delegated_host_id: 'old-delegate', delegatedHostId: 'old-delegate' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);

    const req = creatorReq({ body: { userId: 'creator-1' } }); // self
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ delegatedHostId: null }),
    }));
  });

  test('self-assignment is no-op when no delegation exists', async () => {
    stubSchoolLc();
    const req = creatorReq({ body: { userId: 'creator-1' } });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    // Should NOT have called $executeRawUnsafe for the UPDATE
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('if target is active participant, updates role to HOST', async () => {
    stubSchoolLc();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    prisma.user.findFirst = jest.fn().mockResolvedValue({ id: 'teacher-user-2', role: 'TEACHER' });
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const existingP = { id: 'p-existing', role: 'MODERATOR' };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(existingP),
      update:    jest.fn().mockResolvedValue({ ...existingP, role: 'HOST' }),
    };

    const req = creatorReq();
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'HOST', isMuted: false }),
    }));
  });

  test('missing userId returns 400', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc());
    const req = creatorReq({ body: {} });
    const res = makeRes();
    await ctrl.assignDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── SECTION 3: Functional tests — revokeDelegatedHost ────────────────────────
describe('revokeDelegatedHost functional tests', () => {
  function stubSchoolLcWithDelegate(delegateId = 'delegate-1') {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc({
      delegated_host_id: delegateId,
      delegatedHostId:   delegateId,
      status:            'LIVE',
    }));
  }

  test('creator can revoke active delegation', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassParticipant = { findFirst: jest.fn().mockResolvedValue(null) };

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.json.mock.calls[0][0].data).toMatchObject({ revokedUserId: 'delegate-1' });
  });

  test('non-creator teacher cannot revoke', async () => {
    stubSchoolLcWithDelegate();
    const req = { params: { id: 'lc-1' }, user: { id: 'other-teacher', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('delegated host cannot revoke their own delegation', async () => {
    stubSchoolLcWithDelegate('delegate-1');
    const req = { params: { id: 'lc-1' }, user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('no active delegation returns 400', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc({ status: 'LIVE' }));
    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('TEACHER fallback role → MODERATOR on revoke', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const existingP = { id: 'p-1', wasKicked: false };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(existingP),
      update:    jest.fn().mockResolvedValue({}),
    };
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER' });

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'MODERATOR' }),
    }));
  });

  test('SCHOOL_ADMIN fallback role → MODERATOR on revoke', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const existingP = { id: 'p-1', wasKicked: false };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(existingP),
      update:    jest.fn().mockResolvedValue({}),
    };
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'SCHOOL_ADMIN' });

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'MODERATOR' }),
    }));
  });

  test('STUDENT membership fallback role → STUDENT on revoke', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const existingP = { id: 'p-1', wasKicked: false };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(existingP),
      update:    jest.fn().mockResolvedValue({}),
    };
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'STUDENT' }),
    }));
  });

  test('GUARDIAN fallback role → STUDENT on revoke', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const existingP = { id: 'p-1', wasKicked: false };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(existingP),
      update:    jest.fn().mockResolvedValue({}),
    };
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'GUARDIAN' });

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'STUDENT' }),
    }));
  });

  test('no participant record — no participant created or updated', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(null),
      update:    jest.fn(),
      create:    jest.fn(),
    };

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).not.toHaveBeenCalled();
    expect(prisma.liveClassParticipant.create).not.toHaveBeenCalled();
  });

  test('kicked participant — not altered', async () => {
    stubSchoolLcWithDelegate();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const kickedP = { id: 'p-kicked', wasKicked: true };
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(kickedP),
      update:    jest.fn(),
    };

    const req = { params: { id: 'lc-1' }, user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a' }, schoolId: 'school-a' };
    const res = makeRes();
    await ctrl.revokeDelegatedHost(req, res, next);

    expect(prisma.liveClassParticipant.update).not.toHaveBeenCalled();
  });
});

// ─── SECTION 4: joinLiveClass role derivation ─────────────────────────────────
describe('joinLiveClass role derivation with delegation', () => {
  function stubSchoolLcForJoin(overrides = {}) {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc({
      status:   'LIVE',
      ...overrides,
    }));
  }

  function stubJoin(role) {
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-1', role, userId: 'u-1', isMuted: role !== 'HOST', isActive: true,
      joinedAt: new Date(),
      user: { id: 'u-1', firstName: 'T', lastName: 'T', avatarUrl: null, role: 'TEACHER' },
    });
    prisma.liveClassParticipant.findMany = jest.fn().mockResolvedValue([]);
  }

  beforeEach(() => {
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert:    jest.fn(),
      findMany:  jest.fn().mockResolvedValue([]),
      count:     jest.fn().mockResolvedValue(0),
    };
    prisma.liveClassAttendance = { upsert: jest.fn().mockResolvedValue({}) };
    prisma.student    = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.enrollment = { findFirst: jest.fn().mockResolvedValue(null) };
  });

  test('creator joins → HOST role', async () => {
    stubSchoolLcForJoin();
    stubJoin('HOST');

    const req = {
      params: { id: 'lc-1' },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'C', lastName: 'R', avatarUrl: null },
      schoolMembership: { role: 'TEACHER' },
      schoolId: 'school-a',
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('HOST');
  });

  test('delegated host joins → HOST role', async () => {
    stubSchoolLcForJoin({ delegated_host_id: 'delegate-1', delegatedHostId: 'delegate-1' });
    // GAP-2 FIX: schoolMembership.findFirst must return ACTIVE TEACHER for delegated host
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    stubJoin('HOST');

    const req = {
      params: { id: 'lc-1' },
      user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'D', lastName: 'H', avatarUrl: null },
      schoolMembership: { role: 'TEACHER' },
      schoolId: 'school-a',
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('HOST');
  });

  test('delegated host starts unmuted (isMuted=false)', async () => {
    stubSchoolLcForJoin({ delegated_host_id: 'delegate-1', delegatedHostId: 'delegate-1' });
    // GAP-2 FIX: schoolMembership.findFirst must return ACTIVE TEACHER for delegated host
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    stubJoin('HOST');

    const req = {
      params: { id: 'lc-1' },
      user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'D', lastName: 'H', avatarUrl: null },
      schoolMembership: { role: 'TEACHER' },
      schoolId: 'school-a',
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.isMuted).toBe(false);
  });

  test('non-delegated TEACHER joins → MODERATOR role', async () => {
    stubSchoolLcForJoin();
    stubJoin('MODERATOR');

    const req = {
      params: { id: 'lc-1' },
      user: { id: 'other-teacher', role: 'TEACHER', schoolId: 'school-a', firstName: 'T', lastName: 'T', avatarUrl: null },
      schoolMembership: { role: 'TEACHER' },
      schoolId: 'school-a',
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('MODERATOR');
  });

  test('PUBLIC stream: creator → HOST, non-creator → STUDENT (delegation not in play)', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue(makePublicLc());
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) };
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    stubJoin('STUDENT');

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'random-user', role: 'TEACHER', schoolId: 'school-a', firstName: 'T', lastName: 'T', avatarUrl: null },
      schoolMembership: null,
      schoolId: null,
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('STUDENT');
  });
});

// ─── SECTION 5: Operational host operations ───────────────────────────────────
describe('DEL-OP: assertHostOrDelegate guards operational operations', () => {
  // Source-level: these functions must call assertHostOrDelegate not assertOwner
  const ops = [
    'muteParticipant',
    'kickParticipant',
    'lowerAllHands',
    'startRecording',
    'stopRecording',
    'broadcastDraw',
    'broadcastQuranPosition',
    'uploadCoverImage',
    'toggleOpenMic',
  ];

  ops.forEach(op => {
    test(`${op} uses assertHostOrDelegate`, () => {
      const fn = sliceFn(op);
      expect(fn).toMatch(/assertHostOrDelegate\(lc,\s*req\.user\)/);
    });
  });
});

describe('DEL-OWNER-ONLY: owner-only ops still use assertOwner', () => {
  test('deleteLiveClass still uses assertOwner', () => {
    const fn = sliceFn('deleteLiveClass');
    expect(fn).toMatch(/assertOwner\(lc,\s*req\.user\)/);
  });

  test('assignDelegatedHost does NOT use assertHostOrDelegate (uses direct check)', () => {
    const fn = sliceFn('assignDelegatedHost');
    expect(fn).not.toMatch(/assertHostOrDelegate/);
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
  });

  test('revokeDelegatedHost does NOT use assertHostOrDelegate', () => {
    const fn = sliceFn('revokeDelegatedHost');
    expect(fn).not.toMatch(/assertHostOrDelegate/);
  });
});

// ─── SECTION 6: Gap 1 — Delegated PATCH field authorization ─────────────────
// These are source-code audits verifying the field matrix specified in Gap 1.

describe('GAP-1 PATCH: updateLiveClass source audit', () => {
  test('updateLiveClass: no assertOwner early gate (Gap 1 fix)', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 300);
    // assertOwner must NOT be called at the top (before isHostForEdit check)
    expect(fn).not.toMatch(/assertOwner\(lc,\s*req\.user\)/);
  });

  test('updateLiveClass: isHostForEdit gates access', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 1500);
    expect(fn).toMatch(/isHostForEdit/);
    expect(fn).toMatch(/isCreatorForEdit/);
    expect(fn).toMatch(/isDelegatedHostForEdit/);
  });

  test('updateLiveClass: isOpenMic NOT in allowed list', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 2000);
    // isOpenMic must not appear in the allowed array
    expect(fn).not.toMatch(/allowed\.push.*isOpenMic|'isOpenMic'/);
    // The allowed array definition should not include isOpenMic
    const allowedIdx = fn.indexOf("const allowed = [");
    const allowedEnd = fn.indexOf('];', allowedIdx);
    const allowedList = fn.slice(allowedIdx, allowedEnd);
    expect(allowedList).not.toContain('isOpenMic');
  });

  test('updateLiveClass: maxSpeakers is creator-only', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 2700);
    // maxSpeakers rejection for non-creator must exist
    expect(fn).toMatch(/maxSpeakers.*403|Only the creator can change maxSpeakers/);
    // maxSpeakers only added to allowed when isCreatorForEdit
    expect(fn).toMatch(/isCreatorForEdit[\s\S]*?allowed\.push/);
  });

  test('updateLiveClass: isRecorded is creator-only', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 2500);
    expect(fn).toMatch(/Only the creator can change recording settings/);
  });

  test('updateLiveClass: scheduledAt while LIVE is rejected', () => {
    const idx = src.indexOf('async function updateLiveClass');
    const fn = src.slice(idx, idx + 2500);
    expect(fn).toMatch(/Cannot change scheduled time while class is live/);
    expect(fn).toMatch(/400/);
  });

  test('deleteLiveClass still uses assertOwner (structural op)', () => {
    const fn = sliceFn('deleteLiveClass');
    expect(fn).toMatch(/assertOwner\(lc,\s*req\.user\)/);
  });
});

// ─── SECTION 7: Gap 1 — Delegated PATCH functional tests ─────────────────────
describe('GAP-1 PATCH: delegated host can modify permitted fields', () => {
  function stubLcForPatch(overrides = {}) {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc({
      status: 'LIVE',
      delegated_host_id: 'delegate-1',
      delegatedHostId:   'delegate-1',
      ...overrides,
    }));
  }

  function makePatchReq(body = {}) {
    return {
      params: { id: 'lc-1' },
      body,
      user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'D', lastName: 'H' },
      schoolId: 'school-a',
      schoolMembership: { role: 'TEACHER' },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    // findLiveClass fallback for the post-update fetch
    prisma.liveClass = prisma.liveClass || {};
    prisma.liveClass.findFirst = jest.fn().mockResolvedValue(null);
  });

  const permittedFields = ['title', 'description', 'duration', 'chatEnabled',
    'handRaiseEnabled', 'whiteboardEnabled', 'quranPanelEnabled', 'screenShareEnabled'];

  permittedFields.forEach(field => {
    test(`delegated TEACHER can PATCH ${field}`, async () => {
      stubLcForPatch();
      const value = field.endsWith('Enabled') ? true : (field === 'duration' ? 60 : 'Test');
      const req = makePatchReq({ [field]: value });
      const res = makeRes();
      await ctrl.updateLiveClass(req, res, next);
      // Should NOT return 403
      const statusCalls = res.status.mock.calls.map(c => c[0]);
      expect(statusCalls).not.toContain(403);
    });
  });

  test('delegated TEACHER can PATCH scheduledAt when class is SCHEDULED', async () => {
    stubLcForPatch({ status: 'SCHEDULED' });
    const req = makePatchReq({ scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    const statusCalls = res.status.mock.calls.map(c => c[0]);
    expect(statusCalls).not.toContain(403);
    expect(statusCalls).not.toContain(400);
  });

  test('delegated TEACHER cannot PATCH maxSpeakers → 403', async () => {
    stubLcForPatch();
    const req = makePatchReq({ maxSpeakers: 10 });
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('delegated TEACHER cannot PATCH isRecorded → 403', async () => {
    stubLcForPatch();
    const req = makePatchReq({ isRecorded: true });
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('delegated TEACHER cannot PATCH isOpenMic (silently excluded from allowed list)', async () => {
    stubLcForPatch();
    const req = makePatchReq({ isOpenMic: true });
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    // isOpenMic is not in allowed list — request succeeds but isOpenMic is ignored
    // (no 403 because the field is simply not processed, not explicitly rejected)
    const statusCalls = res.status.mock.calls.map(c => c[0]);
    expect(statusCalls).not.toContain(403);
    // Verify isOpenMic was NOT included in the SQL update
    const sqlCalls = prisma.$executeRawUnsafe.mock.calls;
    if (sqlCalls.length > 0) {
      const sql = sqlCalls[0][0];
      expect(sql).not.toContain('isOpenMic');
    }
  });

  test('delegated TEACHER cannot PATCH scheduledAt while class is LIVE → 400', async () => {
    stubLcForPatch({ status: 'LIVE' });
    const req = makePatchReq({ scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('non-host (noncreator, nondelegated) cannot PATCH → 403', async () => {
    stubLcForPatch(); // no delegation to 'other-user'
    const req = {
      params: { id: 'lc-1' },
      body: { title: 'Hack' },
      user: { id: 'other-user', role: 'TEACHER', schoolId: 'school-a', firstName: 'O', lastName: 'U' },
      schoolId: 'school-a',
      schoolMembership: { role: 'TEACHER' },
    };
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('creator can PATCH maxSpeakers (creator-only field)', async () => {
    stubLcForPatch({ host_user_id: 'creator-1', hostUserId: 'creator-1' });
    const req = {
      params: { id: 'lc-1' },
      body: { maxSpeakers: 15 },
      user: { id: 'creator-1', role: 'TEACHER', schoolId: 'school-a', firstName: 'C', lastName: 'R' },
      schoolId: 'school-a',
      schoolMembership: { role: 'TEACHER' },
    };
    const res = makeRes();
    await ctrl.updateLiveClass(req, res, next);
    const statusCalls = res.status.mock.calls.map(c => c[0]);
    expect(statusCalls).not.toContain(403);
  });
});

// ─── SECTION 8: Gap 2 — Join-time membership revalidation ────────────────────
describe('GAP-2 JOIN: isDelegatedHost membership revalidation at join time', () => {
  function stubSchoolLcWithDelegate(delegateId = 'delegate-1') {
    prisma.$queryRawUnsafe.mockResolvedValue(makeSchoolLc({
      status: 'LIVE',
      delegated_host_id: delegateId,
      delegatedHostId:   delegateId,
    }));
  }

  function makeJoinReq(userId, roleOverride) {
    return {
      params: { id: 'lc-1' },
      user: { id: userId, role: roleOverride || 'TEACHER', schoolId: 'school-a',
              firstName: 'D', lastName: 'H', avatarUrl: null },
      schoolMembership: { role: roleOverride || 'TEACHER' },
      schoolId: 'school-a',
    };
  }

  function setupJoinMocks(role) {
    prisma.liveClassParticipant = {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert:    jest.fn().mockResolvedValue({
        id: 'p-1', role, userId: 'delegate-1', isMuted: role !== 'HOST', isActive: true,
        joinedAt: new Date(),
        user: { id: 'delegate-1', firstName: 'D', lastName: 'H', avatarUrl: null, role: 'TEACHER' },
      }),
      findMany:  jest.fn().mockResolvedValue([]),
      count:     jest.fn().mockResolvedValue(0),
    };
    prisma.liveClassAttendance = { upsert: jest.fn().mockResolvedValue({}) };
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) };
    prisma.student    = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.enrollment = { findFirst: jest.fn().mockResolvedValue(null) };
  }

  beforeEach(() => jest.clearAllMocks());

  test('valid TEACHER delegated host → HOST (ACTIVE membership)', async () => {
    stubSchoolLcWithDelegate();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    setupJoinMocks('HOST');

    const req = makeJoinReq('delegate-1', 'TEACHER');
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('HOST');
  });

  test('valid SCHOOL_ADMIN delegated host → HOST (ACTIVE membership)', async () => {
    stubSchoolLcWithDelegate();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'SCHOOL_ADMIN', status: 'ACTIVE' });
    setupJoinMocks('HOST');

    const req = makeJoinReq('delegate-1', 'SCHOOL_ADMIN');
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('HOST');
  });

  test('delegated host with SUSPENDED membership → NOT HOST (MODERATOR)', async () => {
    stubSchoolLcWithDelegate();
    // Suspended: status !== 'ACTIVE' → isDelegatedHost = false
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'SUSPENDED' });
    setupJoinMocks('MODERATOR');

    const req = makeJoinReq('delegate-1', 'TEACHER');
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).not.toBe('HOST');
  });

  test('delegated host with deleted membership (null returned) → NOT HOST', async () => {
    stubSchoolLcWithDelegate();
    // deletedAt filter: findFirst returns null when deleted
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    setupJoinMocks('MODERATOR');

    const req = makeJoinReq('delegate-1', 'TEACHER');
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).not.toBe('HOST');
  });

  test('delegated host whose role changed to STUDENT → NOT HOST', async () => {
    stubSchoolLcWithDelegate();
    // Role changed to STUDENT: isDelegatedHost = false. User hits enrollment check
    // (not creator, not effectively staff), student.findFirst → null → 403.
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE' });
    setupJoinMocks('STUDENT');
    prisma.student = { findFirst: jest.fn().mockResolvedValue(null) }; // no student profile

    // With STUDENT membership, isDelegatedHost = false.
    // Controller routes to enrollment check → student profile not found → 403.
    // HOST is definitively not granted.
    const req = makeJoinReq('delegate-1', 'STUDENT');
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // 403 means HOST was not granted (access denied entirely)
    expect(res.status).toHaveBeenCalledWith(403);
    // upsert was not called — confirmed not HOST
    expect(prisma.liveClassParticipant.upsert).not.toHaveBeenCalled();
  });

  test('delegated host whose role changed to GUARDIAN → NOT HOST', async () => {
    stubSchoolLcWithDelegate();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'GUARDIAN', status: 'ACTIVE' });
    setupJoinMocks('STUDENT');
    prisma.student = { findFirst: jest.fn().mockResolvedValue(null) };

    // GUARDIAN: isDelegatedHost = false; not teacher/staff → enrollment path → 403
    const req = makeJoinReq('delegate-1', 'TEACHER'); // JWT still says TEACHER but membership changed
    // Override to use GUARDIAN-level effective role via schoolMembership
    req.schoolMembership = { role: 'GUARDIAN' };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // isDelegatedHost = false confirmed: upsert not called with HOST
    const upsertCalls = prisma.liveClassParticipant.upsert.mock.calls;
    if (upsertCalls.length > 0) {
      expect(upsertCalls[0][0].create.role).not.toBe('HOST');
    } else {
      // 403 path also confirms not HOST
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  test('delegated host whose role changed to REPRESENTATIVE → NOT HOST', async () => {
    stubSchoolLcWithDelegate();
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'REPRESENTATIVE', status: 'ACTIVE' });
    setupJoinMocks('STUDENT');
    prisma.student = { findFirst: jest.fn().mockResolvedValue(null) };

    const req = makeJoinReq('delegate-1', 'TEACHER');
    req.schoolMembership = { role: 'REPRESENTATIVE' };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCalls = prisma.liveClassParticipant.upsert.mock.calls;
    if (upsertCalls.length > 0) {
      expect(upsertCalls[0][0].create.role).not.toBe('HOST');
    } else {
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  test('nondelegated eligible TEACHER (different user) → MODERATOR not HOST', async () => {
    stubSchoolLcWithDelegate('delegate-1'); // delegate is delegate-1, not other-teacher
    prisma.schoolMembership.findFirst.mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    setupJoinMocks('MODERATOR');

    const req = makeJoinReq('other-teacher', 'TEACHER'); // not the delegated user
    req.user.id = 'other-teacher';
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('MODERATOR');
  });

  test('PUBLIC stream: delegatedHostId has no effect (PUBLIC creator unchanged)', async () => {
    // PUBLIC stream with a delegatedHostId set — should not grant HOST to non-creator
    prisma.$queryRawUnsafe.mockResolvedValue(makePublicLc({
      delegated_host_id: 'delegate-1',
      delegatedHostId:   'delegate-1',
    }));
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) };
    setupJoinMocks('STUDENT');
    prisma.liveClassParticipant.findFirst = jest.fn().mockResolvedValue({ wasKicked: false });

    const req = {
      params: { id: 'lc-pub-1' },
      user: { id: 'delegate-1', role: 'TEACHER', schoolId: 'school-a',
              firstName: 'D', lastName: 'H', avatarUrl: null },
      schoolMembership: null,
      schoolId: null,
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    // PUBLIC: only creator gets HOST; delegatedHostId is irrelevant
    expect(upsertCall.create.role).toBe('STUDENT');
  });

  test('GAP-2 source audit: isDelegatedHost uses schoolMembership.findFirst', () => {
    const joinIdx = src.indexOf('async function joinLiveClass');
    const fn = src.slice(joinIdx, joinIdx + 5000);
    // Gap 2 fix: membership query inside the delegatedHostId block
    expect(fn).toMatch(/schoolMembership\.findFirst/);
    expect(fn).toMatch(/ACTIVE/);
    expect(fn).toMatch(/TEACHER.*SCHOOL_ADMIN|SCHOOL_ADMIN.*TEACHER/);
    expect(fn).toMatch(/deletedAt.*null/);
    // Must NOT blindly use: const isDelegatedHost = streamType === 'SCHOOL' && lc.delegatedHostId...
    // The fix uses let + conditional block
    expect(fn).toMatch(/let isDelegatedHost = false/);
  });
});
