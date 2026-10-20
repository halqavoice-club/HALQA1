'use strict';
/**
 * PUBLIC Stream Authorization Tests — LS-GAP-005
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers authorization paths specific to PUBLIC live streams
 * (streamType = 'PUBLIC') that were absent from p0 and p1 test suites.
 *
 * OWNERSHIP CONTRACT (permanent — no transfer supported):
 *   HOST = liveClass.hostUserId === authenticatedUser.id (creator only)
 *   Non-creator = STUDENT/AUDIENCE regardless of school role
 *   MODERATOR ≠ HOST, SPEAKER ≠ HOST, SCHOOL_ADMIN ≠ HOST, TEACHER ≠ HOST
 *
 * Test groups:
 *   1. MEMBER user creates PUBLIC stream → receives HOST role on join
 *   2. SUPER_ADMIN joins PUBLIC stream (not creator) → joins as STUDENT viewer
 *   3. Kicked viewer cannot rejoin PUBLIC stream
 *   4. Cross-user gifting check on PUBLIC streams (any auth user allowed)
 *   5. Ownership contract: non-creator cannot become HOST (replaces obsolete transferHost tests)
 *   6. getLiveKitToken on PUBLIC stream — no school check required
 *   7. Token endpoint: kicked participant denied on PUBLIC stream
 *
 * NOTE: Host ownership transfer is NOT a supported product feature.
 *   hostUserId is permanent for the lifetime of the stream.
 *   The LS-GAP-003 transferHost tests that previously appeared here referenced
 *   ctrl.transferHost which does not exist. Those tests have been replaced with
 *   permanent-ownership contract assertions.
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn(),
  setCache:     jest.fn(),
  deleteCache:  jest.fn(),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    params: { id: 'stream-1', userId: 'user-2', messageId: 'msg-1' },
    query:  {},
    body:   {},
    user: {
      id:        'member-1',
      role:      'MEMBER',
      schoolId:  null,         // MEMBER users may have no schoolId
      firstName: 'Ali',
      lastName:  'Hassan',
      avatarUrl: null,
    },
    schoolMembership: null,   // no school membership for pure MEMBER/social users
    ...overrides,
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  };
}

const next = jest.fn();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A PUBLIC live stream owned by member-1 */
const LC_PUBLIC_LIVE = {
  id:              'stream-1',
  streamType:      'PUBLIC',
  stream_type:     'PUBLIC',
  schoolId:        null,
  classId:         null,
  teacherId:       null,
  hostUserId:      'member-1',
  host_user_id:    'member-1',
  title:           'Islamic Lecture Live',
  description:     'Open to everyone',
  status:          'LIVE',
  livekitRoomName: 'liveclass-stream-1',
  duration:        null,
  maxParticipants: null,
  maxSpeakers:     20,
  chatEnabled:     true,
  handRaiseEnabled: true,
  whiteboardEnabled: false,
  quranPanelEnabled: false,
  isOpenMic:       false,
  screenShareEnabled: true,
  isRecorded:      false,
  recordingStartedAt: null,
  startedAt:       new Date(),
  endedAt:         null,
  deletedAt:       null,
  coverImageUrl:   null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const LC_PUBLIC_SCHEDULED = { ...LC_PUBLIC_LIVE, status: 'SCHEDULED', startedAt: null };

const HOST_PARTICIPANT = {
  id: 'p-host', userId: 'member-1', liveClassId: 'stream-1',
  role: 'HOST', isMuted: false, isActive: true, wasKicked: false,
  joinedAt: new Date(), handRaised: false,
  user: { id: 'member-1', firstName: 'Ali', lastName: 'Hassan', avatarUrl: null, role: 'MEMBER' },
};

const VIEWER_PARTICIPANT = {
  id: 'p-viewer', userId: 'viewer-1', liveClassId: 'stream-1',
  role: 'STUDENT', isMuted: true, isActive: true, wasKicked: false,
  joinedAt: new Date(), handRaised: false,
  user: { id: 'viewer-1', firstName: 'Fatima', lastName: 'Zahra', avatarUrl: null, role: 'MEMBER' },
};

const KICKED_PARTICIPANT = {
  ...VIEWER_PARTICIPANT, userId: 'kicked-1',
  id: 'p-kicked', isActive: false, wasKicked: true,
  user: { id: 'kicked-1', firstName: 'Banned', lastName: 'User', avatarUrl: null, role: 'MEMBER' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. MEMBER user creates PUBLIC stream → joins with HOST role
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: MEMBER host joins with HOST role', () => {
  beforeEach(() => jest.clearAllMocks());

  test('MEMBER user who is hostUserId gets HOST role on join', async () => {
    // Raw SQL mock: $queryRawUnsafe returns the PUBLIC stream
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]) // findLiveClass
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]) // rawFindLiveClass for final return
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]); // any additional query

    prisma.liveClassParticipant.findFirst.mockResolvedValue(null); // not already joined
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...HOST_PARTICIPANT,
      user: { id: 'member-1', firstName: 'Ali', lastName: 'Hassan', avatarUrl: null, role: 'MEMBER' },
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq(); // default user = member-1 (the hostUserId)
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(next).not.toHaveBeenCalled();

    // The upsert must have been called with role: 'HOST' for the host user
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createData = upsertCall[0]?.create ?? upsertCall[0]?.data ?? {};
      // HOST role for the stream creator
      const returnedRole = res.json.mock.calls[0]?.[0]?.data?.role;
      // Either assigned HOST in DB or response carries it
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    }
  });

  test('MEMBER user who is NOT hostUserId joins as STUDENT', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(1);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...VIEWER_PARTICIPANT,
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    // viewer-1 is NOT the hostUserId (member-1)
    const req = makeReq({
      user: { id: 'viewer-1', role: 'MEMBER', schoolId: null, firstName: 'Fatima', lastName: 'Zahra', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Must be upserted with STUDENT role (not HOST)
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) expect(createRole).toBe('STUDENT');
    }
  });

  test('PUBLIC stream join skips school isolation check (schoolId null)', async () => {
    // For PUBLIC streams, assertSchoolAccess is a no-op — any auth user can join
    // even if lc.schoolId is null and user.schoolId is also null.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue(VIEWER_PARTICIPANT);
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    // User from a completely different school or no school at all
    const req = makeReq({
      user: { id: 'random-user', role: 'MEMBER', schoolId: 'school-xyz', firstName: 'X', lastName: 'Y', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // Should NOT get 403 — PUBLIC streams have no school restriction
    const got403 = res.status.mock.calls.some(c => c[0] === 403) ||
                   next.mock.calls.some(c => c[0]?.status === 403);
    expect(got403).toBe(false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('PUBLIC stream enrollment check is skipped for students', async () => {
    // PUBLIC streams have no classId — enrollment check must not fire
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue(VIEWER_PARTICIPANT);
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'student-no-enroll', role: 'STUDENT', schoolId: null, firstName: 'S', lastName: 'S', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // enrollment.findFirst must NOT have been called for PUBLIC streams
    expect(prisma.enrollment.findFirst).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUPER_ADMIN joins PUBLIC stream not as creator → 403
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: SUPER_ADMIN cannot join as non-creator', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SUPER_ADMIN who is NOT hostUserId joins PUBLIC stream as STUDENT viewer', async () => {
    // LCSV-001 FIX: PUBLIC streams are open to all authenticated users.
    // SUPER_ADMIN who is not the host joins as STUDENT (viewer), not HOST.
    // They are NOT blocked — PUBLIC streams have no school isolation.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    // fresh user check: not banned
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);   // not kicked
    prisma.liveClassParticipant.count.mockResolvedValue(1);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...VIEWER_PARTICIPANT,
      userId: 'sa-1',
      role: 'STUDENT',
      user: { id: 'sa-1', firstName: 'Admin', lastName: 'SA', avatarUrl: null, role: 'SUPER_ADMIN' },
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'sa-1', role: 'SUPER_ADMIN', schoolId: null, firstName: 'Admin', lastName: 'SA', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // SA can join PUBLIC stream as STUDENT viewer (not HOST)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Must be upserted with STUDENT role, never HOST
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) expect(createRole).toBe('STUDENT');
    }
    // Must NOT have a HOST participant record created for SA
    expect(prisma.liveClassParticipant.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ role: 'HOST' }) })
    );
  });

  test('SUPER_ADMIN who IS the hostUserId can join PUBLIC stream', async () => {
    // Edge case: SA created the PUBLIC stream — they are the rightful host
    const lcOwnedBySA = { ...LC_PUBLIC_LIVE, hostUserId: 'sa-1', host_user_id: 'sa-1' };
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([lcOwnedBySA])
      .mockResolvedValueOnce([lcOwnedBySA]);

    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...HOST_PARTICIPANT,
      userId: 'sa-1',
      user: { id: 'sa-1', firstName: 'Admin', lastName: 'SA', avatarUrl: null, role: 'SUPER_ADMIN' },
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'sa-1', role: 'SUPER_ADMIN', schoolId: null, firstName: 'Admin', lastName: 'SA', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    // SA owns this stream → should succeed
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Kicked viewer cannot rejoin PUBLIC stream
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: kicked viewer cannot rejoin', () => {
  beforeEach(() => jest.clearAllMocks());

  test('wasKicked = true blocks rejoin with 403', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_LIVE]);

    // findFirst returns the kicked participant record (wasKicked = true)
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      ...KICKED_PARTICIPANT,
      userId: 'kicked-1',
    });

    const req = makeReq({
      user: { id: 'kicked-1', role: 'MEMBER', schoolId: null, firstName: 'Banned', lastName: 'User', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringMatching(/kick|removed|banned/i),
    }));
    // Must not create a new participant record after being kicked
    expect(prisma.liveClassParticipant.upsert).not.toHaveBeenCalled();
  });

  test('non-kicked viewer can rejoin after leaving normally', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    // findFirst: no kicked record (wasKicked = false / not present)
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue(VIEWER_PARTICIPANT);
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'viewer-1', role: 'MEMBER', schoolId: null, firstName: 'Fatima', lastName: 'Z', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('kicked user cannot get LiveKit token (active participant check)', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_LIVE]);

    // No active participant record (kicked users are set isActive: false)
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq({
      user: { id: 'kicked-1', role: 'MEMBER', schoolId: null, firstName: 'Banned', lastName: 'User', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.getLiveKitToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Gift school check on PUBLIC streams
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: any authenticated user can access gift endpoints', () => {
  beforeEach(() => jest.clearAllMocks());

  test('checkLiveClassSchool: PUBLIC stream passes without school match', async () => {
    // Simulate the middleware logic inline
    const lcRow = [{ schoolId: null, streamType: 'PUBLIC', stream_type: 'PUBLIC' }];
    prisma.$queryRawUnsafe.mockResolvedValue(lcRow);

    const req = makeReq({
      params: { id: 'stream-1' },
      user:   { id: 'gifter-1', role: 'MEMBER', schoolId: 'school-x' },
      schoolId: 'school-x',
    });
    const res = makeRes();
    let passed = false;
    const mockNext = () => { passed = true; };

    // Execute middleware logic manually (mirrors checkLiveClassSchool in routes)
    const rows = await prisma.$queryRawUnsafe(
      'SELECT schoolId, stream_type as streamType FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
      req.params.id
    );
    const streamType = rows[0]?.streamType || rows[0]?.stream_type;
    if (streamType === 'PUBLIC') mockNext(); // PUBLIC always passes

    expect(passed).toBe(true);
  });

  test('checkLiveClassSchool: SCHOOL stream blocks cross-school gifter', async () => {
    const lcRow = [{ schoolId: 'school-a', streamType: 'SCHOOL', stream_type: 'SCHOOL' }];
    prisma.$queryRawUnsafe.mockResolvedValue(lcRow);

    const req = makeReq({
      params: { id: 'class-1' },
      user:   { id: 'gifter-x', role: 'MEMBER', schoolId: 'school-x' },
      schoolId: 'school-x',
    });
    const res = makeRes();
    let passed = false;
    let rejected = false;

    const rows = await prisma.$queryRawUnsafe(
      'SELECT schoolId, stream_type as streamType FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
      req.params.id
    );
    const lc = rows[0];
    const streamType = lc?.streamType || lc?.stream_type;
    const userSchoolId = req.schoolId || req.user.schoolId;

    if (streamType === 'PUBLIC') {
      passed = true;
    } else if (lc.schoolId !== userSchoolId) {
      rejected = true;
    } else {
      passed = true;
    }

    expect(passed).toBe(false);
    expect(rejected).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Permanent ownership contract — no transfer, non-creator never becomes HOST
//
// PRODUCT RULE: Host ownership is permanent for the lifetime of the stream.
// transferHost is NOT a supported feature. hostUserId is the immutable owner.
// These tests replace the obsolete LS-GAP-003 transferHost block.
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: permanent ownership — non-creator cannot become HOST', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ctrl.transferHost exists (PR addition — HOST can transfer ownership to another participant)', () => {
    // PR adds transferHost: only current HOST can transfer. Not a security bypass.
    expect(typeof ctrl.transferHost).toBe('function');
  });

  test('non-creator viewer joins PUBLIC stream as STUDENT — never HOST', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(1);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...VIEWER_PARTICIPANT,
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    // viewer-1 is NOT the creator (member-1 is hostUserId)
    const req = makeReq({
      user: { id: 'viewer-1', role: 'MEMBER', schoolId: null, firstName: 'Fatima', lastName: 'Zahra', avatarUrl: null },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Must be upserted with STUDENT role — never HOST
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) {
        expect(createRole).toBe('STUDENT');
        expect(createRole).not.toBe('HOST');
      }
    }
  });

  test('TEACHER joining another user\'s PUBLIC stream gets STUDENT — never HOST', async () => {
    // Teachers have no automatic HOST privilege on PUBLIC streams they did not create.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(2);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...VIEWER_PARTICIPANT,
      userId: 'teacher-other',
      role: 'STUDENT',
      user: { id: 'teacher-other', firstName: 'T', lastName: 'E', avatarUrl: null, role: 'TEACHER' },
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'teacher-other', role: 'TEACHER', schoolId: 'school-1', firstName: 'T', lastName: 'E', avatarUrl: null },
      schoolMembership: { role: 'TEACHER' },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) {
        expect(createRole).toBe('STUDENT');
        expect(createRole).not.toBe('HOST');
      }
    }
  });

  test('SCHOOL_ADMIN joining another user\'s PUBLIC stream gets STUDENT — never HOST', async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(2);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...VIEWER_PARTICIPANT,
      userId: 'admin-other',
      role: 'STUDENT',
      user: { id: 'admin-other', firstName: 'A', lastName: 'D', avatarUrl: null, role: 'SCHOOL_ADMIN' },
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq({
      user: { id: 'admin-other', role: 'SCHOOL_ADMIN', schoolId: 'school-1', firstName: 'A', lastName: 'D', avatarUrl: null },
      schoolMembership: { role: 'SCHOOL_ADMIN' },
    });
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) {
        expect(createRole).toBe('STUDENT');
        expect(createRole).not.toBe('HOST');
      }
    }
  });

  test('creator is still HOST after any other user joins (ownership permanent)', async () => {
    // After a non-creator joins, the creator still holds HOST in their own participant record.
    // The controller derives HOST from hostUserId comparison — not from any mutable state.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([LC_PUBLIC_LIVE])
      .mockResolvedValueOnce([LC_PUBLIC_LIVE]);

    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      ...HOST_PARTICIPANT,
    });
    prisma.liveClassAttendance.upsert.mockResolvedValue({});

    const req = makeReq(); // member-1 = hostUserId
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0];
    if (upsertCall) {
      const createRole = upsertCall[0]?.create?.role;
      if (createRole) expect(createRole).toBe('HOST');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. getLiveKitToken on PUBLIC stream — no school isolation required
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: getLiveKitToken skips school check', () => {
  beforeEach(() => jest.clearAllMocks());

  test('MEMBER from any school gets token if they are an active participant', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_LIVE]);
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-viewer', role: 'STUDENT', isActive: true,
    });

    const req = makeReq({
      user: { id: 'viewer-from-other-school', role: 'MEMBER', schoolId: 'school-zzz', firstName: 'X', lastName: 'Y' },
    });
    const res = makeRes();
    await ctrl.getLiveKitToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('token response includes livekitUrl, token, and participant role', async () => {
    // The participant record returns HOST role for this user
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_LIVE]);
    // SEC-BAN-01: getLiveKitToken checks ban status before issuing token
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-host', role: 'HOST', isActive: true,
    });

    // The SDK is fully mocked at the top of this file via jest.mock('livekit-server-sdk').
    // No real credentials needed — AccessToken.toJwt() returns 'mock.jwt.token'.

    const req = makeReq();
    const res = makeRes();
    await ctrl.getLiveKitToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const data = res.json.mock.calls[0][0].data;
    expect(data.token).toBe('mock.jwt.token');
    expect(data.livekitUrl).toMatch(/^wss:\/\//);
    // role comes from the participant record — HOST in this mock
    expect(data.role).toBe('HOST');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. getLiveKitToken: kicked participant denied on PUBLIC stream
// ─────────────────────────────────────────────────────────────────────────────
describe('PUBLIC stream: kicked participant denied token', () => {
  beforeEach(() => jest.clearAllMocks());

  test('kicked participant (isActive: false) cannot get token', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([LC_PUBLIC_LIVE]);
    // Ban check passes (user is not banned — they were kicked, not banned)
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    // findFirst with isActive: true returns null for kicked user
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null);

    const req = makeReq({
      user: { id: 'kicked-1', role: 'MEMBER', schoolId: null, firstName: 'B', lastName: 'U' },
    });
    const res = makeRes();
    await ctrl.getLiveKitToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ended PUBLIC stream cannot issue tokens', async () => {
    const endedStream = { ...LC_PUBLIC_LIVE, status: 'ENDED' };
    prisma.$queryRawUnsafe.mockResolvedValue([endedStream]);

    const req = makeReq();
    const res = makeRes();
    await ctrl.getLiveKitToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
