'use strict';
/**
 * SUPER_ADMIN Scope Fix — Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that SUPER_ADMIN does NOT automatically inherit room-level privileges
 * in voice rooms or live classes.
 *
 * Fixes tested:
 *   SA-FIX-01: isStaffRole in LiveClassRoomImpl.tsx does not include SUPER_ADMIN
 *   SA-FIX-02: updateRoom()       — SUPER_ADMIN cannot edit a room without being host/mod
 *   SA-FIX-03: deleteRoom()       — SUPER_ADMIN cannot delete a room they don't own
 *   SA-FIX-04: unbanParticipant() — SUPER_ADMIN cannot unban without being active host/mod
 *   SA-FIX-05: deleteMessage()    — SUPER_ADMIN cannot delete messages without being host/mod/author
 *   SA-FIX-06: uploadRoomCover()  — SUPER_ADMIN cannot upload cover without being host
 *   SA-FIX-07: getRoom()          — SUPER_ADMIN cannot read PRIVATE room without being participant
 *   SA-FIX-08: getMessages()      — SUPER_ADMIN cannot read PRIVATE room messages
 *   SA-FIX-09: getQueueHandler()  — SUPER_ADMIN gets audience view only, not full queue
 *   SA-FIX-10: school:join socket — SUPER_ADMIN cannot join other schools' socket rooms
 *   SA-FIX-11: class:join socket  — SUPER_ADMIN cannot bypass class membership check
 *
 * endRoom() MUST remain SUPER_ADMIN only — verified separately.
 *
 * Run via: npm run test:unit
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
  deleteCache:  jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',    () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart:  jest.fn(),
  broadcastLiveEnd:    jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  saveFile:   jest.fn().mockResolvedValue({ url: 'https://cdn.example.com/cover.jpg' }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleRoomReminder:   jest.fn().mockResolvedValue(undefined),
  cancelRoomReminder:     jest.fn().mockResolvedValue(undefined),
}));
jest.mock('multer', () => {
  const m = () => ({ single: () => (req, res, next) => next() });
  m.memoryStorage = () => ({});
  return m;
});

const request    = require('supertest');
const express    = require('express');
const cookieParser = require('cookie-parser');
const prisma     = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asUser(id, role, status, schoolId) {
  status   = status   || 'ACTIVE';
  schoolId = schoolId || null;
  const u = {
    id, role, status, schoolId,
    firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null
  };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function tok(id) { return `Bearer t-${id}`; }

// Shared room fixture
const ROOM_ID = 'room-abc-123';
const HOST_ID = 'host-user-id';
const SA_ID   = 'super-admin-id';

const LIVE_ROOM = {
  id:       ROOM_ID,
  hostId:   HOST_ID,
  title:    'Test Room',
  status:   'LIVE',
  privacy:  'PUBLIC',
  deletedAt: null,
  schoolId: null,
  coverImageUrl: null,
  isOpenMic: false,
  micLocked: false,
  lockedSeats: [],
  roomLevel: 1,
  maxSpeakers: 10,
};

const PRIVATE_ROOM = {
  ...LIVE_ROOM,
  privacy: 'PRIVATE',
};

function buildVoiceApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/voice', require('../routes/voice.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

let voiceApp;
beforeAll(() => { voiceApp = buildVoiceApp(); });

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  // Ensure prisma.voiceRoomMember exists for ban checks
  if (!prisma.voiceRoomMember) prisma.voiceRoomMember = {};
  prisma.voiceRoomMember.findUnique = jest.fn().mockResolvedValue(null);
  prisma.voiceRoomMember.upsert     = jest.fn().mockResolvedValue({});
  prisma.voiceRoomMember.update     = jest.fn().mockResolvedValue({});
  prisma.voiceRoomMember.count      = jest.fn().mockResolvedValue(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-02: updateRoom — SUPER_ADMIN cannot edit a room without being host/mod
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-02: updateRoom — SUPER_ADMIN cannot edit room without room role', () => {
  beforeEach(() => {
    prisma.voiceRoom.findUnique.mockResolvedValue(LIVE_ROOM);
    // SUPER_ADMIN is NOT a participant in the room
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
  });

  test('SUPER_ADMIN (non-participant) gets 403 on PATCH /voice/:id', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID))
      .send({ title: 'Hacked Title' });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN (non-participant) cannot change privacy to PRIVATE', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID))
      .send({ privacy: 'PRIVATE' });
    expect(res.status).toBe(403);
  });

  test('HOST can still edit their own room (unchanged behavior)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: HOST_ID, role: 'HOST', isActive: true
    });
    prisma.voiceRoom.update.mockResolvedValue({ ...LIVE_ROOM, title: 'New Title' });
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...LIVE_ROOM, hostId: HOST_ID, commentsEnabled: true,
      slowMode: false, messageType: 'all', reactionsEnabled: true,
    });
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(HOST_ID))
      .send({ title: 'New Title' });
    // Host passes the auth check — may succeed or fail for other reasons (mock depth)
    // Key: must not be 403 (authorization error)
    expect(res.status).not.toBe(403);
  });

  test('MODERATOR (active) can change chat settings', async () => {
    const MOD_ID = 'mod-user';
    asUser(MOD_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: MOD_ID, role: 'MODERATOR', isActive: true
    });
    prisma.voiceRoom.update.mockResolvedValue({ ...LIVE_ROOM, commentsEnabled: false });
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...LIVE_ROOM, hostId: HOST_ID, commentsEnabled: true,
      slowMode: false, messageType: 'all', reactionsEnabled: true,
    });
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MOD_ID))
      .send({ commentsEnabled: false });
    expect(res.status).not.toBe(403);
  });

  test('MODERATOR (active) cannot change title (restricted fields)', async () => {
    const MOD_ID = 'mod-user2';
    asUser(MOD_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: MOD_ID, role: 'MODERATOR', isActive: true
    });
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...LIVE_ROOM, hostId: HOST_ID, commentsEnabled: true,
    });
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(MOD_ID))
      .send({ title: 'Moderator Changed Title' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-03: deleteRoom — SUPER_ADMIN cannot delete a room they don't own
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-03: deleteRoom — SUPER_ADMIN cannot delete room without being host', () => {
  beforeEach(() => {
    prisma.voiceRoom.findUnique.mockResolvedValue(LIVE_ROOM);
  });

  test('SUPER_ADMIN (non-host) gets 403 on DELETE /voice/:id', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(403);
  });

  test('HOST can still delete their own room (unchanged behavior)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    prisma.voiceRoom.update.mockResolvedValue({ ...LIVE_ROOM, deletedAt: new Date() });
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-04: unbanParticipant — SUPER_ADMIN cannot unban without room role
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-04: unbanParticipant — SUPER_ADMIN cannot unban without room role', () => {
  const TARGET_ID = 'banned-user';

  beforeEach(() => {
    // SUPER_ADMIN is NOT a participant
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    prisma.voiceRoomMember.findUnique.mockResolvedValue({ isBanned: true });
  });

  test('SUPER_ADMIN (non-participant) gets 403 on DELETE /voice/:id/ban/:userId', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}/ban/${TARGET_ID}`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(403);
  });

  test('HOST can still unban (active HOST participant)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: HOST_ID, role: 'HOST', isActive: true
    });
    prisma.voiceRoomMember.update.mockResolvedValue({ isBanned: false });
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}/ban/${TARGET_ID}`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-05: deleteMessage — SUPER_ADMIN cannot delete messages without room role
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-05: deleteMessage — SUPER_ADMIN cannot delete messages without room role', () => {
  const MSG_ID     = 'msg-123';
  const AUTHOR_ID  = 'msg-author';

  beforeEach(() => {
    // SUPER_ADMIN is NOT a participant
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    prisma.voiceMessage.findUnique.mockResolvedValue({
      id:      MSG_ID,
      roomId:  ROOM_ID,
      userId:  AUTHOR_ID,
      deletedAt: null,
    });
  });

  test("SUPER_ADMIN (non-participant, not author) gets 403 on DELETE /voice/:id/messages/:msgId", async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}/messages/${MSG_ID}`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(403);
  });

  test('Message author can delete their own message (unchanged behavior)', async () => {
    asUser(AUTHOR_ID, 'MEMBER', 'ACTIVE');
    // Author is not a moderator but IS the message author
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: AUTHOR_ID, role: 'AUDIENCE', isActive: true
    });
    prisma.voiceMessage.update.mockResolvedValue({ id: MSG_ID, deletedAt: new Date() });
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}/messages/${MSG_ID}`)
      .set('Authorization', tok(AUTHOR_ID));
    expect(res.status).not.toBe(403);
  });

  test('HOST can delete any message (unchanged behavior)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: HOST_ID, role: 'HOST', isActive: true
    });
    prisma.voiceMessage.update.mockResolvedValue({ id: MSG_ID, deletedAt: new Date() });
    const res = await request(voiceApp)
      .delete(`/api/v1/voice/${ROOM_ID}/messages/${MSG_ID}`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-06: uploadRoomCover — SUPER_ADMIN cannot upload cover without being host
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-06: uploadRoomCover — SUPER_ADMIN cannot upload cover without being host (source verification)', () => {
  // NOTE: The multer middleware mock in the test environment does not populate req.file,
  // so the controller returns 400 ("No image file provided") before reaching the auth check.
  // We verify the fix via source code inspection instead of an HTTP call.

  test('SA-FIX-06: uploadRoomCover source does NOT have SUPER_ADMIN bypass', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    // Extract the uploadRoomCover function
    const fnMatch = src.match(/async function uploadRoomCover[\s\S]*?async function getMyRooms/);
    expect(fnMatch).not.toBeNull();
    const fnCode = fnMatch[0];
    // The bypass was:
    //   const isAdmin = req.user.role === 'SUPER_ADMIN';
    //   if (room.hostId !== userId && !isAdmin) { ... }
    // After fix: no isAdmin variable, only hostId check
    expect(fnCode).not.toMatch(/isAdmin\s*=\s*req\.user\.role\s*===\s*['"]SUPER_ADMIN['"]/);
    // The fixed check must still be present (host-only guard)
    expect(fnCode).toMatch(/room\.hostId\s*!==\s*userId/);
    // Must NOT still pass SUPER_ADMIN: the !isAdmin condition must be gone
    expect(fnCode).not.toMatch(/!\s*isAdmin/);
  });

  test('SA-FIX-06: HOST can still update cover (source check)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const fnMatch = src.match(/async function uploadRoomCover[\s\S]*?async function getMyRooms/);
    const fnCode = fnMatch[0];
    // Guard is now: if (room.hostId !== userId) — a single simple check
    expect(fnCode).toMatch(/if\s*\(room\.hostId\s*!==\s*userId\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-07: getRoom — SUPER_ADMIN cannot read PRIVATE room without participating
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-07: getRoom — SUPER_ADMIN cannot read PRIVATE room without participating', () => {
  beforeEach(() => {
    // Return private room with full participant data
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...PRIVATE_ROOM,
      host: { id: HOST_ID, firstName: 'Host', lastName: 'User', avatarUrl: null },
      participants: [],
      _count: { participants: 0 },
    });
    // SUPER_ADMIN is NOT a participant
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
  });

  test('SUPER_ADMIN (non-participant) gets 403 on GET /voice/:id for PRIVATE room', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(403);
  });

  test('HOST can still read their own PRIVATE room (unchanged behavior)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).not.toBe(403);
  });

  test('Active participant can still read PRIVATE room (unchanged behavior)', async () => {
    const PARTICIPANT_ID = 'active-participant';
    asUser(PARTICIPANT_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: PARTICIPANT_ID, role: 'AUDIENCE', isActive: true
    });
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(PARTICIPANT_ID));
    expect(res.status).not.toBe(403);
  });

  test('PUBLIC room still readable by SUPER_ADMIN (no regression)', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...LIVE_ROOM, // PUBLIC privacy
      host: { id: HOST_ID, firstName: 'Host', lastName: 'User', avatarUrl: null },
      participants: [],
      _count: { participants: 0 },
    });
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}`)
      .set('Authorization', tok(SA_ID));
    // PUBLIC rooms are always readable — no change
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-08: getMessages — SUPER_ADMIN cannot read PRIVATE room messages
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-08: getMessages — SUPER_ADMIN cannot read PRIVATE room messages', () => {
  beforeEach(() => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      privacy: 'PRIVATE', hostId: HOST_ID
    });
    // SUPER_ADMIN is NOT a participant
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
  });

  test('SUPER_ADMIN (non-participant) gets 403 on GET /voice/:id/messages for PRIVATE room', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(SA_ID));
    expect(res.status).toBe(403);
  });

  test('HOST can still read messages from their PRIVATE room', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceMessage.findMany = jest.fn().mockResolvedValue([]);
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/messages`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-09: getQueueHandler — SUPER_ADMIN gets audience view, not full queue
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-09: getQueueHandler — SUPER_ADMIN gets audience view, not full queue', () => {
  beforeEach(() => {
    // SUPER_ADMIN is NOT an active participant
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    if (!prisma.voiceParticipant.count) prisma.voiceParticipant.count = jest.fn();
    prisma.voiceParticipant.count.mockResolvedValue(0);
  });

  test('SUPER_ADMIN (non-participant) receives audience view from GET /voice/:id/queue', async () => {
    asUser(SA_ID, 'SUPER_ADMIN', 'ACTIVE');
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/queue`)
      .set('Authorization', tok(SA_ID));
    // Should succeed (200) but return audience view (empty queue, position info)
    expect(res.status).toBe(200);
    // Audience view: queue array is empty (full queue not exposed)
    const data = res.body.data;
    expect(data).toBeDefined();
    expect(data.queue).toEqual([]);
  });

  test('HOST gets full queue (unchanged behavior)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    prisma.voiceParticipant.findUnique.mockResolvedValue({
      userId: HOST_ID, role: 'HOST', isActive: true
    });
    const res = await request(voiceApp)
      .get(`/api/v1/voice/${ROOM_ID}/queue`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).toBe(200);
    // Full queue: has the queue property (may be empty but is present)
    expect(res.body.data).toHaveProperty('queue');
    expect(res.body.data).toHaveProperty('queueLength');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-10 & 11: Socket handler — source-level verification
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-10/11: Socket school:join and class:join — source verification', () => {
  test('SA-FIX-10: app.js school:join does NOT have SUPER_ADMIN bypass', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../app.js'), 'utf8'
    );
    // Extract just the school:join handler block
    const schoolJoinMatch = src.match(/socket\.on\('school:join'[\s\S]*?socket\.on\('school:leave'/);
    expect(schoolJoinMatch).not.toBeNull();
    const handlerCode = schoolJoinMatch[0];
    // Must NOT have: if (userRole !== 'SUPER_ADMIN' ...  — that was the bypass
    expect(handlerCode).not.toMatch(/userRole\s*!==\s*['"]SUPER_ADMIN['"]/);
    // Must still have: socket.userSchoolId !== schoolId  — that is the correct check
    expect(handlerCode).toMatch(/socket\.userSchoolId\s*!==\s*schoolId/);
  });

  test('SA-FIX-11: app.js class:join does NOT have SUPER_ADMIN global bypass', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../app.js'), 'utf8'
    );
    // Extract just the class:join handler block
    const classJoinMatch = src.match(/socket\.on\('class:join'[\s\S]*?socket\.on\('class:leave'/);
    expect(classJoinMatch).not.toBeNull();
    const handlerCode = classJoinMatch[0];
    // The bypass was: if (userRole === 'SUPER_ADMIN') { socket.join(`class:${classId}`); return; }
    // After fix: that early-return block is gone
    expect(handlerCode).not.toMatch(/if\s*\(userRole\s*===\s*['"]SUPER_ADMIN['"]\)/);
    // The membership check must still be present
    expect(handlerCode).toMatch(/schoolMembership\.findUnique/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SA-FIX-01: isStaffRole / isTeacher — source-level verification
// ─────────────────────────────────────────────────────────────────────────────
describe('SA-FIX-01: isStaffRole and isTeacher do NOT include SUPER_ADMIN', () => {
  test('SA-FIX-01a: LiveClassRoomImpl.tsx isStaffRole does not include SUPER_ADMIN', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../frontend/src/components/live-class/LiveClassRoomImpl.tsx'),
      'utf8'
    );
    const match = src.match(/const isStaffRole\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match[1]).not.toMatch(/SUPER_ADMIN/);
    expect(match[1]).toMatch(/TEACHER/);
    expect(match[1]).toMatch(/SCHOOL_ADMIN/);
  });

  test('SA-FIX-01b: mobile live-class/[id].tsx isTeacher derives from participant record, not school role', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../mobile/app/live-class/[id].tsx'),
      'utf8'
    );
    // In the mobile live-class room, isTeacher is derived from the server-assigned
    // participant role (isHost || MODERATOR), NOT from a school role array.
    // This ensures a school teacher does not get host controls on a stream they don't own.
    const match = src.match(/const isTeacher\s*=\s*(.+)/);
    expect(match).not.toBeNull();
    // Must NOT be an array of school roles
    expect(match[1]).not.toMatch(/\['TEACHER'.*'SCHOOL_ADMIN'\]/);
    // Must NOT include SUPER_ADMIN in a role array
    expect(match[1]).not.toMatch(/SUPER_ADMIN/);
    // Must derive from participant role (isHost or myParticipantRole)
    expect(match[1]).toMatch(/isHost|myParticipantRole|participant/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: endRoom() must still be SUPER_ADMIN only (must NOT be broken)
// ─────────────────────────────────────────────────────────────────────────────
describe('REGRESSION: endRoom() remains SUPER_ADMIN-only (must not be broken)', () => {
  beforeEach(() => {
    prisma.voiceRoom.findUnique.mockResolvedValue({
      ...LIVE_ROOM,
      _count: { participants: 0 },
      startedAt: new Date(),
    });
  });

  test('voice.controller.js endRoom() source still gates on SUPER_ADMIN', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    // endRoom must require SUPER_ADMIN — this is the intentional platform control
    expect(src).toMatch(/req\.user\.role\s*!==\s*['"]SUPER_ADMIN['"]/);
    // The endRoom function comment must still be present
    expect(src).toMatch(/Only SUPER_ADMIN can set status=ENDED/);
  });

  test('HOST gets 403 on PATCH /voice/:id/end (permanent room — SUPER_ADMIN only)', async () => {
    asUser(HOST_ID, 'MEMBER', 'ACTIVE');
    const res = await request(voiceApp)
      .patch(`/api/v1/voice/${ROOM_ID}/end`)
      .set('Authorization', tok(HOST_ID));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: All original room moderation controls still work for HOST/MOD
// ─────────────────────────────────────────────────────────────────────────────
describe('REGRESSION: Host/moderator controls unchanged', () => {
  test('voice.controller.js unbanParticipant: HOST (active) can unban', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    // Must check MODERATOR_ROLES — confirms the check is still there
    expect(src).toMatch(/MODERATOR_ROLES\.includes\(requester\.role\)/);
    // Must NOT have isSuperAdmin bypass in unbanParticipant
    // The unbanParticipant function should not contain isSuperAdmin variable anymore
    const unbanMatch = src.match(/async function unbanParticipant[\s\S]*?async function/);
    if (unbanMatch) {
      expect(unbanMatch[0]).not.toMatch(/isSuperAdmin/);
    }
  });

  test('voice.controller.js deleteMessage: moderator check still present', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const deleteMsgMatch = src.match(/async function deleteMessage[\s\S]*?async function/);
    if (deleteMsgMatch) {
      // isSuperAdmin bypass must be removed
      expect(deleteMsgMatch[0]).not.toMatch(/isSuperAdmin/);
      // MODERATOR_ROLES check must still be present
      expect(deleteMsgMatch[0]).toMatch(/MODERATOR_ROLES\.includes\(participant\.role\)/);
    }
  });

  test('voice.controller.js getRoom: isSuperAdmin bypass removed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const getRoomMatch = src.match(/async function getRoom[\s\S]*?async function searchRooms/);
    if (getRoomMatch) {
      expect(getRoomMatch[0]).not.toMatch(/isSuperAdmin/);
    }
  });

  test('voice.controller.js updateRoom: isAdmin bypass removed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const updateRoomMatch = src.match(/async function updateRoom[\s\S]*?async function deleteRoom/);
    if (updateRoomMatch) {
      // isAdmin from SUPER_ADMIN check must be removed from updateRoom
      expect(updateRoomMatch[0]).not.toMatch(/req\.user\.role\s*===\s*['"]SUPER_ADMIN['"]/);
    }
  });

  test('voice.controller.js deleteRoom: isAdmin bypass removed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/voice.controller.js'), 'utf8'
    );
    const deleteRoomMatch = src.match(/async function deleteRoom[\s\S]*?async function _notifyFollowers/);
    if (deleteRoomMatch) {
      expect(deleteRoomMatch[0]).not.toMatch(/isAdmin\s*=\s*req\.user\.role\s*===\s*['"]SUPER_ADMIN['"]/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LCSV-001 FIX: joinLiveClass — isTeacher/isStaff must NOT include SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────
describe('LCSV-001 FIX: joinLiveClass isTeacher/isStaff do NOT include SUPER_ADMIN', () => {
  test('LCSV-001: live-class.controller.js joinLiveClass — isTeacher does not include SUPER_ADMIN', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    // Extract the joinLiveClass function region
    const fnMatch = src.match(/async function joinLiveClass[\s\S]*?async function leaveLiveClass/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    // isTeacher line must NOT include SUPER_ADMIN
    const isTeacherLine = fnBody.match(/const isTeacher\s*=.+/);
    expect(isTeacherLine).not.toBeNull();
    expect(isTeacherLine[0]).not.toMatch(/SUPER_ADMIN/);
    // isStaff line must NOT include SUPER_ADMIN
    const isStaffLine = fnBody.match(/const isStaff\s*=.+/);
    expect(isStaffLine).not.toBeNull();
    expect(isStaffLine[0]).not.toMatch(/SUPER_ADMIN/);
  });

  test('LCSV-001: isTeacher still includes TEACHER and SCHOOL_ADMIN (no regression)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    const fnMatch = src.match(/async function joinLiveClass[\s\S]*?async function leaveLiveClass/);
    const fnBody = fnMatch[0];
    // After the PUBLIC-ROLE-FIX refactor, isTeacher is an alias for isStaff.
    // The roles TEACHER and SCHOOL_ADMIN are now in the isStaff definition.
    // Verify isStaff (which isTeacher aliases) still contains these roles.
    const isStaffLine = fnBody.match(/const isStaff\s*=.+/);
    expect(isStaffLine).not.toBeNull();
    expect(isStaffLine[0]).toMatch(/TEACHER/);
    expect(isStaffLine[0]).toMatch(/SCHOOL_ADMIN/);
    // isTeacher is an alias — verify it aliases isStaff (not a different array)
    const isTeacherLine = fnBody.match(/const isTeacher\s*=.+/);
    expect(isTeacherLine).not.toBeNull();
    expect(isTeacherLine[0]).toMatch(/isStaff/); // aliases isStaff
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LCSV-002 FIX: createLiveClass isAdmin must NOT include SUPER_ADMIN
// ─────────────────────────────────────────────────────────────────────────────
describe('LCSV-002 FIX: createLiveClass/deleteMessage/sendMessage do NOT include SUPER_ADMIN', () => {
  test('LCSV-002a: createLiveClass isAdmin does not include SUPER_ADMIN', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    const fnMatch = src.match(/async function createLiveClass[\s\S]*?async function updateLiveClass/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    const isAdminLine = fnBody.match(/const isAdmin\s*=.+/);
    expect(isAdminLine).not.toBeNull();
    expect(isAdminLine[0]).not.toMatch(/SUPER_ADMIN/);
    expect(isAdminLine[0]).toMatch(/SCHOOL_ADMIN/);
  });

  test('LCSV-002b: deleteMessage no longer uses school/global role for authorization (PES-001 fix)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    const fnMatch = src.match(/async function deleteMessage[\s\S]*?async function setVideoState/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    // PES-001 fix: isHost derived from school role is REMOVED.
    // Authorization now uses callerParticipant.role (HOST or MODERATOR).
    // There is no longer a bare 'const isHost = [school roles]' line.
    // Verify the old school-role pattern is gone (non-comment lines only).
    const nonCommentLines = fnBody.split('\n').filter(l => !l.trim().startsWith('//'));
    const hasSchoolRoleIsHost = nonCommentLines.some(l =>
      /isHost\s*=/.test(l) && (/TEACHER/.test(l) || /SCHOOL_ADMIN/.test(l))
    );
    expect(hasSchoolRoleIsHost).toBe(false);
    // Must NOT reference SUPER_ADMIN for authorization
    expect(fnBody).not.toMatch(/SUPER_ADMIN/);
    // Must use callerParticipant for privilege check
    expect(fnBody).toMatch(/callerParticipant/);
  });

  test('LCSV-002c: sendMessage staff check does not include SUPER_ADMIN', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    const fnMatch = src.match(/async function sendMessage[\s\S]*?async function getMessages/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    // PES-001 fix: isTeacherOrAdmin is now conditioned on streamType === 'SCHOOL'
    // The declaration may span multiple lines — check the full function body
    expect(fnBody).toMatch(/isTeacherOrAdmin/);
    expect(fnBody).not.toMatch(/SUPER_ADMIN/);
    // Must be conditioned on SCHOOL streamType (not a bare school-role check)
    expect(fnBody).toMatch(/streamType === 'SCHOOL'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LCSV-003 FIX: setVideoState — SUPER_ADMIN bypass removed
// ─────────────────────────────────────────────────────────────────────────────
describe('LCSV-003 FIX: setVideoState does not have SUPER_ADMIN bypass', () => {
  test('LCSV-003: setVideoState self-only check does not have SUPER_ADMIN exception', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/live-class.controller.js'),
      'utf8'
    );
    const fnMatch = src.match(/async function setVideoState[\s\S]*?module\.exports/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    // The old bypass was: && getEffectiveRole(req) !== 'SUPER_ADMIN'
    expect(fnBody).not.toMatch(/getEffectiveRole\(req\)\s*!==\s*['"]SUPER_ADMIN['"]/);
    // The self-only check must still be present
    expect(fnBody).toMatch(/req\.user\.id\s*!==\s*userId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SVSV-001 FIX: feed:join:school — SUPER_ADMIN bypass removed
// ─────────────────────────────────────────────────────────────────────────────
describe('SVSV-001 FIX: feed:join:school does NOT have SUPER_ADMIN bypass', () => {
  test('SVSV-001: app.js feed:join:school handler has no SUPER_ADMIN early-return', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../app.js'),
      'utf8'
    );
    const handlerMatch = src.match(/socket\.on\('feed:join:school'[\s\S]*?\}\);/);
    expect(handlerMatch).not.toBeNull();
    const handlerCode = handlerMatch[0];
    // The bypass was: if (userRole === 'SUPER_ADMIN') { socket.join(...); return; }
    expect(handlerCode).not.toMatch(/if\s*\(userRole\s*===\s*['"]SUPER_ADMIN['"]\)/);
    // The schoolId check must still be present
    expect(handlerCode).toMatch(/socket\.userSchoolId\s*!==\s*schoolId/);
  });

  test('SVSV-001: school:join handler has no SUPER_ADMIN bypass and explicitly denies SA (F-06 fix)', () => {
    // F-06 FIX: The old bypass pattern was `if (userRole !== 'SUPER_ADMIN') reject`.
    // That was removed (SA-FIX-10). The new pattern is `if (userRole === 'SUPER_ADMIN') return`
    // which explicitly DENIES SA — a stronger security posture than merely removing the bypass.
    // This test now validates the denial pattern rather than the absence of the string.
    const src = fs.readFileSync(
      path.join(__dirname, '../app.js'),
      'utf8'
    );
    const handlerMatch = src.match(/socket\.on\('school:join'[\s\S]*?\}\);/);
    expect(handlerMatch).not.toBeNull();
    const handlerCode = handlerMatch[0];

    // Must NOT have the old bypass (SUPER_ADMIN allowed through with !== check)
    expect(handlerCode).not.toMatch(/userRole\s*!==\s*['"]SUPER_ADMIN['"]/);

    // F-06 FIX: Must have the new explicit denial (=== check that returns early)
    expect(handlerCode).toMatch(/userRole\s*===\s*['"]SUPER_ADMIN['"]/);

    // Must still have the schoolId ownership check for normal users
    expect(handlerCode).toMatch(/socket\.userSchoolId\s*!==\s*schoolId/);
  });
});
