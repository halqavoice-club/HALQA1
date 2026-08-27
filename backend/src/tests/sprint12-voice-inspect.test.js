'use strict';
/**
 * Sprint 12 — Admin Voice Room Inspection Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * VC-GAP-003: GET /api/v1/admin/actions/voice/:id/inspect
 *
 * - SUPER_ADMIN gets full room details + participant list + banned users
 * - Admin does NOT appear in participant list (no VoiceParticipant created)
 * - Non-existent / soft-deleted room returns 404
 * - MEMBER gets 403 (SA-only + IP allowlist)
 * - Unauthenticated gets 401
 * - Inspection is audit logged
 * - Response shape: room, stats, participants, bannedUsers
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',    () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',      () => ({ getIo: jest.fn(() => null) }));

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── App setup ────────────────────────────────────────────────────────────────
let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/actions', require('../routes/admin-actions.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asSuperAdmin(id = 'sa-1') {
  const u = { id, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'SUPER_ADMIN', schoolId: null });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function asMember(id = 'mb-1') {
  const u = { id, role: 'MEMBER', status: 'ACTIVE', schoolId: 'sch-1', firstName: 'M', lastName: 'B', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'MEMBER', schoolId: 'sch-1' });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const ROOM_ID = 'voice-room-inspect-001';
const HOST    = { id: 'host-1', firstName: 'Alice', lastName: 'Host', email: 'alice@test.com', avatarUrl: null };
const SCHOOL  = { id: 'sch-1', name: 'Test School' };

const ACTIVE_ROOM = {
  id: ROOM_ID,
  title: 'Test Voice Room',
  description: 'A test room',
  privacy: 'PRIVATE',
  status: 'LIVE',
  schoolId: 'sch-1',
  hostId: 'host-1',
  maxSpeakers: 10,
  micLocked: false,
  createdAt: new Date(),
  startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
  endedAt: null,
  scheduledAt: null,
  deletedAt: null,
  host: HOST,
  school: SCHOOL,
  participants: [
    {
      userId: 'p-1',
      role: 'SPEAKER',
      isMuted: false,
      isSpeaker: true,
      joinedAt: new Date(),
      user: { id: 'p-1', firstName: 'Bob', lastName: 'Speaker', avatarUrl: null, email: 'bob@test.com' }
    },
    {
      userId: 'p-2',
      role: 'LISTENER',
      isMuted: true,
      isSpeaker: false,
      joinedAt: new Date(),
      user: { id: 'p-2', firstName: 'Carol', lastName: 'Listener', avatarUrl: null, email: 'carol@test.com' }
    },
  ],
  _count: { participants: 5, messages: 23 },
};

const BANNED_MEMBERS = [
  {
    userId: 'banned-1',
    user: { id: 'banned-1', firstName: 'Dave', lastName: 'Banned', avatarUrl: null, email: 'dave@test.com' }
  }
];

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  if (!prisma.voiceRoom)       prisma.voiceRoom       = {};
  if (!prisma.voiceRoomMember) prisma.voiceRoomMember = {};
  if (!prisma.auditLog)        prisma.auditLog        = {};

  prisma.voiceRoom.findUnique     = jest.fn().mockResolvedValue(ACTIVE_ROOM);
  prisma.voiceRoomMember.findMany = jest.fn().mockResolvedValue(BANNED_MEMBERS);
  prisma.auditLog.create          = jest.fn().mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// Access control
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-003: Voice inspect access control', () => {
  test('Unauthenticated returns 401', async () => {
    const res = await request(app).get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`);
    expect(res.status).toBe(401);
  });

  test('MEMBER returns 403', async () => {
    asMember();
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('mb-1'));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-003: Voice inspect error handling', () => {
  test('Non-existent room returns 404', async () => {
    asSuperAdmin();
    prisma.voiceRoom.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/v1/admin/actions/voice/does-not-exist/inspect')
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(404);
  });

  test('Soft-deleted room returns 404', async () => {
    asSuperAdmin();
    prisma.voiceRoom.findUnique.mockResolvedValue({ ...ACTIVE_ROOM, deletedAt: new Date() });
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-003: Voice inspect happy path', () => {
  beforeEach(() => asSuperAdmin());

  test('Returns 200 with room, stats, participants, bannedUsers', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('room');
    expect(res.body.data).toHaveProperty('stats');
    expect(res.body.data).toHaveProperty('participants');
    expect(res.body.data).toHaveProperty('bannedUsers');
  });

  test('Room data contains privacy, status, host details', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    const { room } = res.body.data;
    expect(room.privacy).toBe('PRIVATE');
    expect(room.status).toBe('LIVE');
    expect(room.host.firstName).toBe('Alice');
    expect(room.school.name).toBe('Test School');
  });

  test('Stats contain active participant count, total joins, message count', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    const { stats } = res.body.data;
    expect(stats.activeParticipants).toBe(2);
    expect(stats.totalJoinsEver).toBe(5);
    expect(stats.totalMessages).toBe(23);
  });

  test('Duration is calculated for LIVE rooms', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    const { stats } = res.body.data;
    expect(stats.durationMinutes).not.toBeNull();
    expect(typeof stats.durationMinutes).toBe('number');
  });

  test('Participants include user info, role, isMuted', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    const { participants } = res.body.data;
    expect(participants).toHaveLength(2);
    expect(participants[0].user.firstName).toBe('Bob');
    expect(participants[0].isSpeaker).toBe(true);
    expect(participants[1].isMuted).toBe(true);
  });

  test('Banned users are included in response', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    const { bannedUsers } = res.body.data;
    expect(bannedUsers).toHaveLength(1);
    expect(bannedUsers[0].user.firstName).toBe('Dave');
  });

  test('Admin SA does NOT appear in participants list', async () => {
    // Set up voiceParticipant mock to track calls
    if (!prisma.voiceParticipant) prisma.voiceParticipant = {};
    prisma.voiceParticipant.create = jest.fn();

    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    const { participants } = res.body.data;
    // SA user id is 'sa-1' — must not be in participant list
    const saInList = participants.some(p => p.userId === 'sa-1');
    expect(saInList).toBe(false);
    // voiceParticipant.create must NEVER be called (SA is not joining the room)
    expect(prisma.voiceParticipant.create).not.toHaveBeenCalled();
  });

  test('Audit log is written for every inspection', async () => {
    await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: 'VoiceRoom',
          entityId: ROOM_ID,
        })
      })
    );
  });

  test('PRIVATE room is accessible to SA (privacy bypass)', async () => {
    // Normal users cannot access PRIVATE rooms without being participants.
    // SA can inspect via this endpoint without joining.
    prisma.voiceRoom.findUnique.mockResolvedValue({ ...ACTIVE_ROOM, privacy: 'PRIVATE' });
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.room.privacy).toBe('PRIVATE');
  });

  test('INVITE_ONLY room is accessible to SA', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ ...ACTIVE_ROOM, privacy: 'INVITE_ONLY' });
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.room.privacy).toBe('INVITE_ONLY');
  });

  test('Empty participant list returns empty array', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ ...ACTIVE_ROOM, participants: [] });
    const res = await request(app)
      .get(`/api/v1/admin/actions/voice/${ROOM_ID}/inspect`)
      .set('Authorization', tok('sa-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.participants).toEqual([]);
    expect(res.body.data.stats.activeParticipants).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source verification
// ─────────────────────────────────────────────────────────────────────────────
describe('VC-GAP-003: Source verification', () => {
  test('admin-actions.routes.js has GET /voice/:id/inspect endpoint', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../routes/admin-actions.routes.js'), 'utf8'
    );
    expect(src).toMatch(/router\.get\(['"]\/voice\/:id\/inspect['"]/);
    expect(src).toMatch(/VC-GAP-003/);
    expect(src).toMatch(/ADMIN_INSPECT_VOICE_ROOM/);
    // Must NOT create a VoiceParticipant record (admin is not joining)
    expect(src).not.toMatch(/voiceParticipant\.create/);
  });
});
