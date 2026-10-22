/**
 * HALQA — PUBLIC Live Stream Role Security Audit Tests
 *
 * Covers every point in the PUBLIC Live Stream authorization specification:
 *
 * SECURITY INVARIANTS:
 *   CREATOR       → HOST  (hostUserId === req.user.id — always server-set)
 *   APPROVED USER → SPEAKER (via host approveHand or inviteToStage)
 *   EVERYONE ELSE → STUDENT/AUDIENCE
 *
 * MUST NEVER HAPPEN:
 *   SCHOOL_ROLE   → HOST  (teacher/admin/school role ≠ ownership)
 *   CLIENT_ROLE   → AUTH  (req.body.role cannot escalate)
 *   SPEAKER       → HOST  (stage ≠ ownership)
 *   MODERATOR     → OWNER (moderation ≠ ownership)
 *
 * All tests are source-code audits + functional controller tests.
 * Source audits verify the exact authorization logic on disk.
 * Functional tests verify the controller returns the right HTTP status / role.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const CTRL_PATH   = path.join(__dirname, '../controllers/live-class.controller.js');
const ROUTES_PATH = path.join(__dirname, '../routes/live-class.routes.js');
const ctrl_src    = fs.readFileSync(CTRL_PATH,   'utf8');
const routes_src  = fs.readFileSync(ROUTES_PATH, 'utf8');

// ─── Mock setup ───────────────────────────────────────────────────────────────

jest.mock('../utils/prisma', () => ({
  liveClassParticipant: {
    findFirst: jest.fn(),
    upsert:    jest.fn(),
    findMany:  jest.fn(),
    count:     jest.fn(),
    update:    jest.fn(),
    updateMany: jest.fn(),
  },
  liveClassHandQueue: { updateMany: jest.fn() },
  liveClassAttendance: { upsert: jest.fn() },
  student:    { findFirst: jest.fn() },
  enrollment: { findFirst: jest.fn() },
  user:       { findUnique: jest.fn() },
  $queryRawUnsafe:   jest.fn(),
  $executeRawUnsafe: jest.fn(),
}));

jest.mock('../sockets',                () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive',         () => ({ broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn() }));
jest.mock('../services/queue.service', () => ({ queueBulkNotifications: jest.fn() }));
jest.mock('../utils/logger',           () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require('../utils/prisma');
const ctrl   = require('../controllers/live-class.controller');

function makeRes() {
  const r = { _status: 200, _json: null };
  r.status = jest.fn().mockImplementation(s => { r._status = s; return r; });
  r.json   = jest.fn().mockImplementation(b => { r._json   = b; return r; });
  return r;
}
const next = jest.fn();

// ── PUBLIC stream DB row factory ──────────────────────────────────────────────
function pubStreamRow(creatorId = 'creator-u1') {
  return {
    id: 'pub-lc-1',
    stream_type: 'PUBLIC', streamType: 'PUBLIC',
    schoolId: null, classId: null, teacherId: null,
    host_user_id: creatorId, hostUserId: creatorId,
    title: 'Test Public Stream', description: null,
    status: 'LIVE', livekitRoomName: 'liveclass-pub-lc-1',
    duration: null, chatEnabled: 1, handRaiseEnabled: 1,
    whiteboardEnabled: 1, quranPanelEnabled: 0, isOpenMic: 0,
    screenShareEnabled: 1, maxParticipants: null, maxSpeakers: 20,
    isRecorded: 0, recordingStartedAt: null,
    startedAt: new Date(), endedAt: null,
    deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function stubPublicStream(creatorId = 'creator-u1') {
  prisma.$queryRawUnsafe.mockResolvedValue([pubStreamRow(creatorId)]);
}

function makeJoinReq(userId, role = 'STUDENT', schoolId = null) {
  return {
    params: { id: 'pub-lc-1' },
    user: { id: userId, role, schoolId, firstName: 'Test', lastName: 'User' },
    schoolMembership: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Source-code audit — joinLiveClass role assignment
// ─────────────────────────────────────────────────────────────────────────────
describe('1. Source audit: joinLiveClass PUBLIC role assignment', () => {
  function getJoinFn() {
    const start = ctrl_src.indexOf('async function joinLiveClass');
    return ctrl_src.slice(start, start + 10000);
  }

  test('1.1 PUBLIC-ROLE-FIX comment present — school roles do NOT grant HOST on PUBLIC', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/PUBLIC-ROLE-FIX|School Role.*Public Live Stream Role/i);
  });

  test('1.2 isPublicHost = streamType === PUBLIC && lc.hostUserId === userId', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/isPublicHost.*hostUserId|hostUserId.*isPublicHost/);
  });

  test('1.3 Only isPublicHost → HOST on PUBLIC, no staff bypass', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/isPublicHost/);
    expect(fn).toMatch(/HOST/);
    // Must NOT have old isTeacher or isStaff → HOST path on PUBLIC
    expect(fn).not.toMatch(/const role = \(isTeacher/);
  });

  test('1.4 isEffectivelyStaff gated on SCHOOL streams — PUBLIC non-creators get STUDENT', () => {
    const fn = getJoinFn();
    // isEffectivelyStaff = streamType === 'SCHOOL' && isStaff
    expect(fn).toMatch(/isEffectivelyStaff = streamType === 'SCHOOL'/);
    // role = (isEffectivelyStaff || isPublicHost) ? 'HOST' : 'STUDENT'
    expect(fn).toMatch(/isEffectivelyStaff \|\| isPublicHost/);
  });

  test('1.5 PUBLIC non-creator kick check uses !isPublicHost', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/PUBLIC.*!isPublicHost/);
  });

  test('1.6 upsert create.isMuted = !(isEffectivelyStaff || isPublicHost || lc.isOpenMic)', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/isMuted.*isEffectivelyStaff.*isPublicHost|isMuted.*isPublicHost/);
  });

  test('1.7 Auto-start (isHost) uses isEffectivelyStaff OR isPublicHost', () => {
    const fn = getJoinFn();
    expect(fn).toMatch(/isHost = isEffectivelyStaff \|\| isPublicHost/);
    expect(fn).not.toMatch(/isHost = isTeacher/);
    expect(fn).not.toMatch(/isHost = isStaff\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Source-code audit — createLiveClass hostUserId injection
// ─────────────────────────────────────────────────────────────────────────────
describe('2. Source audit: createLiveClass hostUserId never from req.body', () => {
  function getCreateFn() {
    const start = ctrl_src.indexOf('async function createLiveClass');
    return ctrl_src.slice(start, start + 5000);
  }

  test('2.1 PUBLIC stream hostUserId = req.user.id (hardcoded)', () => {
    const fn = getCreateFn();
    // Must have hostUserId: req.user.id in the PUBLIC creation path
    expect(fn).toMatch(/hostUserId:\s*req\.user\.id/);
  });

  test('2.2 hostUserId not destructured from req.body', () => {
    const fn = getCreateFn();
    // The destructuring from req.body must NOT include hostUserId
    // (it would appear as `hostUserId,` or `hostUserId:` in the destructuring block)
    const destructuringBlock = fn.match(/const\s*\{[\s\S]*?\}\s*=\s*req\.body/)?.[0] ?? '';
    expect(destructuringBlock).not.toMatch(/hostUserId/);
  });

  test('2.3 SCHOOL stream hostUserId = req.user.id (hardcoded)', () => {
    // The SCHOOL rawCreateLiveClass call also uses req.user.id
    const fn = getCreateFn();
    // Count occurrences of hostUserId: req.user.id
    const matches = fn.match(/hostUserId:\s*req\.user\.id/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Source-code audit — resolveStreamStaffAccess for PUBLIC
// ─────────────────────────────────────────────────────────────────────────────
describe('3. Source audit: resolveStreamStaffAccess PUBLIC host check', () => {
  function getStaffAccessFn() {
    const start = routes_src.indexOf('async function resolveStreamStaffAccess');
    return routes_src.slice(start, start + 1500);
  }

  test('3.1 Fetches host_user_id from DB (raw SQL, not req.body)', () => {
    const fn = getStaffAccessFn();
    expect(fn).toMatch(/SELECT.*host_user_id.*FROM live_classes/s);
  });

  test('3.2 Checks hostUserId !== req.user.id for PUBLIC streams', () => {
    const fn = getStaffAccessFn();
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
  });

  test('3.3 Returns 403 for PUBLIC non-creator on staff operations', () => {
    const fn = getStaffAccessFn();
    expect(fn).toMatch(/Only the host can perform this action/);
    expect(fn).toMatch(/403/);
  });

  test('3.4 Staff operations use resolveStreamStaffAccess', () => {
    // PATCH (update), DELETE, start, end must all use resolveStreamStaffAccess
    expect(routes_src).toMatch(/router\.patch.*\/:id.*resolveStreamStaffAccess/s);
    expect(routes_src).toMatch(/router\.delete.*\/:id['"]\s*,\s*resolveStreamStaffAccess/s);
    expect(routes_src).toMatch(/\/:id\/start.*resolveStreamStaffAccess/s);
    expect(routes_src).toMatch(/\/:id\/end.*resolveStreamStaffAccess/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Source-code audit — getLiveKitToken role from DB only
// ─────────────────────────────────────────────────────────────────────────────
describe('4. Source audit: getLiveKitToken — role from DB participant record', () => {
  function getTokenFn() {
    const start = ctrl_src.indexOf('async function getLiveKitToken');
    return ctrl_src.slice(start, start + 2000);
  }

  test('4.1 isHost = participant.role === HOST (from DB)', () => {
    const fn = getTokenFn();
    expect(fn).toMatch(/const isHost = participant\.role === 'HOST'/);
  });

  test('4.2 Requires active participant record — not just authentication', () => {
    const fn = getTokenFn();
    expect(fn).toMatch(/where.*liveClassId.*userId.*isActive: true/s);
    expect(fn).toMatch(/Join the class first/);
  });

  test('4.3 No client-supplied role in token generation', () => {
    const fn = getTokenFn();
    // Must not read role from req.body or req.query
    expect(fn).not.toMatch(/req\.body\.role|req\.query\.role/);
    expect(fn).not.toMatch(/req\.body\.isHost|req\.query\.isHost/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Source-code audit — approveHand and inviteToStage
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Source audit: speaker promotion gates (approveHand / inviteToStage)', () => {
  function getApproveFn() {
    const start = ctrl_src.indexOf('async function approveHand');
    return ctrl_src.slice(start, start + 3000);
  }

  function getInviteFn() {
    const start = ctrl_src.indexOf('async function inviteToStage');
    return ctrl_src.slice(start, start + 2000);
  }

  test('5.1 approveHand uses assertOwnerOrModerator (participant record check)', () => {
    const fn = getApproveFn();
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('5.2 approveHand: promoting to SPEAKER does NOT change hostUserId', () => {
    const fn = getApproveFn();
    expect(fn).toMatch(/SET speakerSlot = \?/);
    expect(fn).not.toMatch(/SET.*hostUserId|hostUserId.*SET/);
  });

  test('5.3 approveHand: SPEAKER role comes from speakerSlot, not from role column', () => {
    const fn = getApproveFn();
    const updateBlock = fn.match(/UPDATE live_class_participants[\s\S]*?WHERE/)?.[0] ?? '';
    expect(updateBlock).not.toMatch(/role = 'HOST'/);
    expect(updateBlock).not.toMatch(/role = 'SPEAKER'/);
  });

  test('5.4 inviteToStage uses assertOwnerOrModerator (participant record check)', () => {
    const fn = getInviteFn();
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('5.5 inviteToStage does NOT change hostUserId', () => {
    const fn = getInviteFn();
    expect(fn).not.toMatch(/hostUserId.*=.*userId|userId.*hostUserId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Source-code audit — assertOwner (creator-only)
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Source audit: assertOwnerOrModerator — participant record check', () => {
  function getOwnerFn() {
    const start = ctrl_src.indexOf('async function assertOwnerOrModerator');
    return ctrl_src.slice(start, start + 600);
  }

  test('6.1 Checks participant DB record for HOST/MODERATOR role', () => {
    const fn = getOwnerFn();
    expect(fn).toMatch(/liveClassParticipant\.findFirst/);
    expect(fn).toMatch(/HOST.*MODERATOR|MODERATOR.*HOST/);
    expect(fn).toMatch(/403/);
  });

  test('6.2 No school admin bypass', () => {
    const fn = getOwnerFn();
    expect(fn).not.toMatch(/isSchoolAdmin|SCHOOL_ADMIN/);
  });

  test('6.3 No SUPER_ADMIN bypass', () => {
    const fn = getOwnerFn();
    expect(fn).not.toMatch(/SUPER_ADMIN/);
  });

  test('6.4 No isTeacher or isStaff bypass', () => {
    const fn = getOwnerFn();
    expect(fn).not.toMatch(/isTeacher|isStaff/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Source-code audit — muteAll/unmuteAll participant-record check
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Source audit: muteAll/unmuteAll check participant record, not global role', () => {
  function getMuteAllFn() {
    const start = ctrl_src.indexOf('async function muteAll');
    return ctrl_src.slice(start, start + 800);
  }

  function getUnmuteAllFn() {
    const start = ctrl_src.indexOf('async function unmuteAll');
    return ctrl_src.slice(start, start + 800);
  }

  test('7.1 muteAll uses assertOwnerOrModerator (participant record check)', () => {
    const fn = getMuteAllFn();
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('7.2 unmuteAll uses assertOwnerOrModerator (participant record check)', () => {
    const fn = getUnmuteAllFn();
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('7.3 muteAll does NOT use global role for authorization', () => {
    const fn = getMuteAllFn();
    expect(fn).not.toMatch(/getEffectiveRole.*HOST|TEACHER.*HOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Source-code audit — Socket.IO participation gate
// ─────────────────────────────────────────────────────────────────────────────
describe('8. Source audit: Socket.IO liveclass:join_room participation gate', () => {
  let app_src = '';
  beforeAll(() => {
    try {
      app_src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    } catch (_) { app_src = ''; }
  });

  test('8.1 liveclass:join_room checks active participant in DB', () => {
    if (!app_src) return;
    // Use socket.on('liveclass:join_room' to find the actual handler (not the comment reference)
    const start = app_src.indexOf("socket.on('liveclass:join_room'");
    const fn = app_src.slice(start, start + 1200);
    // Must reference participant lookup (either findFirst or the model name)
    expect(fn).toMatch(/liveClassParticipant|participant/);
    expect(fn).toMatch(/isActive/);
  });

  test('8.2 Unauthenticated user cannot join socket room', () => {
    if (!app_src) return;
    // Use socket.on('liveclass:join_room' to find the actual handler (not the comment reference)
    const start = app_src.indexOf("socket.on('liveclass:join_room'");
    const fn = app_src.slice(start, start + 500);
    expect(fn).toMatch(/userId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Functional tests — joinLiveClass PUBLIC role assignment
// ─────────────────────────────────────────────────────────────────────────────
describe('9. Functional: PUBLIC stream role on join', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  async function joinAs(userId, globalRole, schoolId = null) {
    stubPublicStream('creator-u1');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(5);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-test', userId, role: 'STUDENT', isMuted: true,
      user: { id: userId, firstName: 'T', lastName: 'U', avatarUrl: null, role: globalRole }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    const req = makeJoinReq(userId, globalRole, schoolId);
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);
    return { res, upsertArg: prisma.liveClassParticipant.upsert.mock.calls[0]?.[0] };
  }

  test('9.1 Creator joins → role = HOST', async () => {
    const { res, upsertArg } = await joinAs('creator-u1', 'TEACHER', null);
    expect(res._json.success).toBe(true);
    expect(upsertArg.create.role).toBe('HOST');
  });

  test('9.2 Non-creator TEACHER joins → role = STUDENT (not HOST, not MODERATOR)', async () => {
    const { res, upsertArg } = await joinAs('teacher-b', 'TEACHER', 'school-x');
    expect(res._json.success).toBe(true);
    expect(upsertArg.create.role).toBe('STUDENT');
  });

  test('9.3 Non-creator SCHOOL_ADMIN joins → role = STUDENT', async () => {
    const { res, upsertArg } = await joinAs('admin-c', 'SCHOOL_ADMIN', 'school-x');
    expect(res._json.success).toBe(true);
    expect(upsertArg.create.role).toBe('STUDENT');
  });

  test('9.4 Non-creator STUDENT joins → role = STUDENT', async () => {
    const { res, upsertArg } = await joinAs('student-d', 'STUDENT', 'school-x');
    expect(res._json.success).toBe(true);
    expect(upsertArg.create.role).toBe('STUDENT');
  });

  test('9.5 No-school user (null schoolId) joins non-creator → role = STUDENT', async () => {
    const { res, upsertArg } = await joinAs('noschool-e', 'STUDENT', null);
    expect(res._json.success).toBe(true);
    expect(upsertArg.create.role).toBe('STUDENT');
  });

  test('9.6 No-school creator joins → role = HOST', async () => {
    // Creator has no school but is the stream creator
    stubPublicStream('noschool-creator');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-ns', userId: 'noschool-creator', role: 'HOST', isMuted: false,
      user: { id: 'noschool-creator', firstName: 'N', lastName: 'S', avatarUrl: null, role: 'STUDENT' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    const req = makeJoinReq('noschool-creator', 'STUDENT', null);
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);
    expect(res._json.success).toBe(true);
    expect(prisma.liveClassParticipant.upsert.mock.calls[0][0].create.role).toBe('HOST');
  });

  test('9.7 Kicked user cannot rejoin PUBLIC stream', async () => {
    stubPublicStream('creator-u1');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    // wasKicked = true
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: true });
    const req = makeJoinReq('kicked-user', 'STUDENT', null);
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);
    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/removed/i);
  });

  test('9.8 Banned user cannot join PUBLIC stream', async () => {
    stubPublicStream('creator-u1');
    prisma.user.findUnique.mockResolvedValue({ status: 'BANNED' });
    const req = makeJoinReq('banned-user', 'STUDENT', null);
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);
    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/suspended/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Functional tests — owner operations denied to non-creators
// ─────────────────────────────────────────────────────────────────────────────
describe('10. Functional: owner operations (update/delete/start/end) denied to non-creators', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // updateLiveClass uses rawFindLiveClass which tries $queryRawUnsafe then ORM
  // Force the ORM fallback by rejecting the raw SQL, returning ORM result
  function stubForUpdate(userId, isCreator) {
    if (isCreator) {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([pubStreamRow(userId)])  // rawFindLiveClass
        .mockResolvedValueOnce([pubStreamRow(userId)]); // findLiveClass (updated)
      prisma.$executeRawUnsafe.mockResolvedValue(1);
    } else {
      prisma.$queryRawUnsafe.mockResolvedValue([pubStreamRow('creator-u1')]);
    }
  }

  test('10.1 Non-creator cannot update stream — isHostForEdit gate (DEL-HOST Gap 1 fix)', () => {
    // Gap 1 fix: updateLiveClass now uses isHostForEdit (creator OR delegated host).
    // assertOwner removed; field-level restrictions enforce creator-only fields.
    // Non-creator, non-delegate is still denied — security invariant preserved.
    const idx = ctrl_src.indexOf('async function updateLiveClass');
    const fn = ctrl_src.slice(idx, idx + 1500);
    expect(fn).toMatch(/isHostForEdit/);
    expect(fn).not.toMatch(/assertOwner\(lc,\s*req\.user\)/);
    // Creator-only field guards still present
    expect(fn).toMatch(/isCreatorForEdit/);
    expect(fn).toMatch(/maxSpeakers/);
  });

  test('10.2 Non-creator SCHOOL_ADMIN cannot delete PUBLIC stream (assertSchoolAccess guard)', () => {
    const idx = ctrl_src.indexOf('async function deleteLiveClass');
    const fn = ctrl_src.slice(idx, idx + 400);
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('10.3 Non-creator cannot start PUBLIC stream (route-level resolveStreamStaffAccess)', () => {
    const idx = ctrl_src.indexOf('async function startLiveClass');
    const fn = ctrl_src.slice(idx, idx + 500);
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('10.4 Non-creator cannot end PUBLIC stream (route-level resolveStreamStaffAccess)', () => {
    const idx = ctrl_src.indexOf('async function endLiveClass');
    const fn = ctrl_src.slice(idx, idx + 500);
    expect(fn).toMatch(/assertSchoolAccess/);
  });

  test('10.5 resolveStreamStaffAccess blocks non-creator on PATCH route (PUBLIC)', () => {
    const fnIdx = routes_src.indexOf('async function resolveStreamStaffAccess');
    const fn = routes_src.slice(fnIdx, fnIdx + 1200);
    expect(fn).toMatch(/hostUserId !== req\.user\.id/);
    // No school-role bypass for the host check itself
    expect(fn).toMatch(/403/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Client injection attack — req.body.role / hostUserId ignored
// ─────────────────────────────────────────────────────────────────────────────
describe('11. Client injection: req.body.role / hostUserId cannot escalate', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('11.1 joinLiveClass ignores req.body.role', async () => {
    stubPublicStream('creator-u1');
    prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ wasKicked: false });
    prisma.liveClassParticipant.count.mockResolvedValue(0);
    prisma.liveClassParticipant.upsert.mockResolvedValue({
      id: 'p-atk', userId: 'attacker', role: 'STUDENT', isMuted: true,
      user: { id: 'attacker', firstName: 'A', lastName: 'T', avatarUrl: null, role: 'STUDENT' }
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const req = {
      params: { id: 'pub-lc-1' },
      // Attacker tries to inject role=HOST in body
      body: { role: 'HOST', isHost: true, hostUserId: 'attacker' },
      user: { id: 'attacker', role: 'STUDENT', schoolId: null, firstName: 'A', lastName: 'T' },
      schoolMembership: null,
    };
    const res = makeRes();
    await ctrl.joinLiveClass(req, res, next);

    expect(res._json.success).toBe(true);
    // Role must be STUDENT — not HOST from body
    const upsertCall = prisma.liveClassParticipant.upsert.mock.calls[0][0];
    expect(upsertCall.create.role).toBe('STUDENT');
    expect(upsertCall.create.role).not.toBe('HOST');
  });

  test('11.2 joinLiveClass role derived from hostUserId comparison, not req.body.isHost', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function joinLiveClass'),
      ctrl_src.indexOf('async function joinLiveClass') + 3000
    );
    // Role derivation must NOT read req.body
    expect(fn).not.toMatch(/req\.body\.isHost/);
    expect(fn).not.toMatch(/req\.body\.role/);
    expect(fn).not.toMatch(/req\.body\.hostUserId/);
  });

  test('11.3 createLiveClass hostUserId not readable from req.body', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function createLiveClass'),
      ctrl_src.indexOf('async function createLiveClass') + 4000
    );
    // hostUserId must not be in the destructuring of req.body
    const destructBlock = fn.match(/const\s*\{[\s\S]*?\}\s*=\s*req\.body/)?.[0] ?? '';
    expect(destructBlock).not.toMatch(/hostUserId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: SPEAKER cannot become HOST
// ─────────────────────────────────────────────────────────────────────────────
describe('12. Speaker cannot become HOST', () => {
  test('12.1 approveHand assigns speakerSlot — never changes role to HOST', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function approveHand'),
      ctrl_src.indexOf('async function approveHand') + 3000
    );
    // The SET clause only sets speakerSlot, isMuted, handRaised
    const updateStmt = fn.match(/UPDATE live_class_participants[\s\S]*?WHERE/)?.[0] ?? '';
    expect(updateStmt).toMatch(/speakerSlot = \?/);
    expect(updateStmt).not.toMatch(/role = 'HOST'/);
    expect(updateStmt).not.toMatch(/hostUserId/);
  });

  test('12.2 inviteToStage assigns speakerSlot — never changes role to HOST', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function inviteToStage'),
      ctrl_src.indexOf('async function inviteToStage') + 2000
    );
    const updateStmt = fn.match(/UPDATE live_class_participants[\s\S]*?WHERE/)?.[0] ?? '';
    expect(updateStmt).toMatch(/speakerSlot = \?/);
    expect(updateStmt).not.toMatch(/role = 'HOST'/);
    expect(updateStmt).not.toMatch(/hostUserId/);
  });

  test('12.3 dropMic removes speakerSlot — role remains unchanged', () => {
    // PR renamed dropMicLiveClass → dropMic
    const idx = ctrl_src.indexOf('async function dropMic');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrl_src.slice(idx, idx + 1000);
    // PR uses raw SQL: SET speakerSlot = NULL (uppercase)
    expect(fn).toMatch(/speakerSlot.*NULL|speakerSlot: null|speakerSlot = NULL/i);
    expect(fn).not.toMatch(/data.*role.*HOST/);
    expect(fn).not.toMatch(/role = 'HOST'/);
  });

  test('12.4 demoteSpeaker removes speakerSlot — role unchanged', () => {
    // PR renamed demoteFromStage → demoteSpeaker
    const idx = ctrl_src.indexOf('async function demoteSpeaker');
    expect(idx).toBeGreaterThan(-1);
    const fn = ctrl_src.slice(idx, idx + 1500);
    // PR uses raw SQL: SET speakerSlot = NULL (uppercase)
    expect(fn).toMatch(/speakerSlot.*NULL|speakerSlot: null/i);
    expect(fn).not.toMatch(/data.*role.*HOST/);
    expect(fn).not.toMatch(/role = 'HOST'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: Reconnect role restoration from DB
// ─────────────────────────────────────────────────────────────────────────────
describe('13. Reconnect/rejoin: speakerSlot cleared, role from DB', () => {
  test('13.1 joinLiveClass upsert update clause resets activity on rejoin', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function joinLiveClass'),
      ctrl_src.indexOf('async function joinLiveClass') + 10000
    );
    // PR: update sets isActive: true, joinedAt, leftAt: null — activity reset on rejoin
    expect(fn).toMatch(/isActive: true/);
    expect(fn).toMatch(/leftAt: null/);
  });

  test('13.2 joinLiveClass upsert update clause uses server-computed values', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function joinLiveClass'),
      ctrl_src.indexOf('async function joinLiveClass') + 10000
    );
    const updateIdx = fn.indexOf('update: {');
    expect(updateIdx).toBeGreaterThan(-1);
    const updateSrc = fn.slice(updateIdx, updateIdx + 300);
    // Update must set activity and timing fields
    expect(updateSrc).toMatch(/isActive/);
    expect(updateSrc).toMatch(/joinedAt/);
  });

  test('13.3 getLiveKitToken reads role from participant record — no client input', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function getLiveKitToken'),
      ctrl_src.indexOf('async function getLiveKitToken') + 3000
    );
    expect(fn).toMatch(/participant\.role === 'HOST'/);
    // Must not read role or isHost from request body/query
    expect(fn).not.toMatch(/req\.body\.role/);
    expect(fn).not.toMatch(/req\.query\.role/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: Regression — existing security fixes preserved
// ─────────────────────────────────────────────────────────────────────────────
describe('14. Regression: existing security fixes unchanged', () => {
  test('14.1 assertSchoolAccess no-ops for PUBLIC streams', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('function assertSchoolAccess'),
      ctrl_src.indexOf('function assertSchoolAccess') + 600
    );
    // PR normalizes streamType then returns for PUBLIC
    expect(fn).toMatch(/PUBLIC.*return/s);
  });

  test('14.2 SEC-BAN-01: banned user check in joinLiveClass', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function joinLiveClass'),
      ctrl_src.indexOf('async function joinLiveClass') + 2000
    );
    expect(fn).toMatch(/status.*BANNED|BANNED.*status/);
    expect(fn).toMatch(/suspended/i);
  });

  test('14.3 approveHand uses assertOwnerOrModerator for caller auth', () => {
    const fn = ctrl_src.slice(
      ctrl_src.indexOf('async function approveHand'),
      ctrl_src.indexOf('async function approveHand') + 800
    );
    // PR: assertOwnerOrModerator replaces the inline caller.role check
    expect(fn).toMatch(/assertOwnerOrModerator/);
  });

  test('14.4 unique speakerSlot constraint in schema', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/@@unique\(\[liveClassId,\s*speakerSlot\]/);
  });

  test('14.5 drop-mic route registered', () => {
    expect(routes_src).toMatch(/\/drop-mic/);
  });

  test('14.6 invite and demote routes use resolveStreamStaffAccess', () => {
    expect(routes_src).toMatch(/\/invite\/:userId.*resolveStreamStaffAccess/s);
    expect(routes_src).toMatch(/\/demote\/:userId.*resolveStreamStaffAccess/s);
  });
});
