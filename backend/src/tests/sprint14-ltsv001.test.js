'use strict';
/**
 * Sprint 14 — LTSV-001 LiveKit Token School Check Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * LTSV-001 FIX: SUPER_ADMIN no longer bypasses school isolation in generateToken()
 * for liveclass-* rooms. School check now applies to ALL roles uniformly.
 *
 * The mitigation (participant check still blocks SA) was already in place,
 * but removing the explicit bypass (`if (req.user.role !== 'SUPER_ADMIN')`)
 * adds defence-in-depth and makes the code consistent with INVARIANT-003.
 *
 * Tests verify:
 *   1. SA with mismatched school gets 403 on liveclass-* token request
 *   2. SA with no school membership gets 403
 *   3. Regular user with matching school + active participant gets token
 *   4. Regular user with mismatched school gets 403
 *   5. Source code no longer contains the SA bypass condition
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',   () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../sockets',     () => ({ getIo: jest.fn(() => null) }));
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock.livekit.token'),
  })),
}));

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

  // Mount authenticate middleware + livekit route
  const { authenticate } = require('../middleware/auth.middleware');
  const { generateToken } = require('../controllers/livekit.controller');
  app.post('/livekit/token', authenticate, generateToken);

  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function asUser(id, role, schoolId = null) {
  const u = { id, role, status: 'ACTIVE', schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}
function tok(id) { return `Bearer t-${id}`; }

const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const LC_ID    = 'live-class-uuid-001';
const ROOM_ID  = `liveclass-${LC_ID}`;

const LIVE_CLASS_A = { id: LC_ID, schoolId: SCHOOL_A, status: 'LIVE', deletedAt: null };

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  if (!prisma.liveClass)             prisma.liveClass             = {};
  if (!prisma.schoolMembership)      prisma.schoolMembership      = {};
  if (!prisma.liveClassParticipant)  prisma.liveClassParticipant  = {};
  if (!prisma.voiceRoom)             prisma.voiceRoom             = {};

  prisma.liveClass.findFirst            = jest.fn().mockResolvedValue(LIVE_CLASS_A);
  prisma.schoolMembership.findUnique    = jest.fn().mockResolvedValue(null); // no membership by default
  prisma.liveClassParticipant.findFirst = jest.fn().mockResolvedValue({ id: 'p-1' });
  prisma.voiceRoom.findUnique           = jest.fn().mockResolvedValue(null); // not a voice room
});

// ─────────────────────────────────────────────────────────────────────────────
// LTSV-001: SA bypass removed — school check applies to ALL roles
// ─────────────────────────────────────────────────────────────────────────────
describe('LTSV-001: SA school isolation enforced on liveclass-* token', () => {

  test('SUPER_ADMIN with no school membership gets 403', async () => {
    asUser('sa-1', 'SUPER_ADMIN', null); // SA has no schoolId
    prisma.schoolMembership.findUnique.mockResolvedValue(null); // no membership

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('sa-1'))
      .send({ roomId: ROOM_ID });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
  });

  test('SUPER_ADMIN with mismatched school gets 403', async () => {
    asUser('sa-1', 'SUPER_ADMIN', SCHOOL_B); // SA belongs to school B
    prisma.schoolMembership.findUnique.mockResolvedValue(null); // no membership in school A
    // Live class is in school A

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('sa-1'))
      .send({ roomId: ROOM_ID });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN with matching school but suspended membership gets 403', async () => {
    asUser('sa-1', 'SUPER_ADMIN', SCHOOL_A); // schoolId matches
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'SUSPENDED' }); // but suspended

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('sa-1'))
      .send({ roomId: ROOM_ID });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/membership is not active/i);
  });

  test('SUPER_ADMIN with matching school (legacy path) and no participant gets 403', async () => {
    asUser('sa-1', 'SUPER_ADMIN', SCHOOL_A);
    prisma.schoolMembership.findUnique.mockResolvedValue(null); // no membership record (legacy)
    prisma.liveClassParticipant.findFirst.mockResolvedValue(null); // SA is not a participant

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('sa-1'))
      .send({ roomId: ROOM_ID });
    // Participant check should block SA
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirm normal users still work correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('LTSV-001: Normal user school isolation unchanged', () => {

  test('TEACHER from correct school with active participant gets token', async () => {
    asUser('teacher-1', 'MEMBER', SCHOOL_A);
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ id: 'p-1' });

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('teacher-1'))
      .send({ roomId: ROOM_ID });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('mock.livekit.token');
  });

  test('MEMBER from wrong school gets 403', async () => {
    asUser('user-1', 'MEMBER', SCHOOL_B); // schoolId = school B, class is school A
    prisma.schoolMembership.findUnique.mockResolvedValue(null); // no membership in school A

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('user-1'))
      .send({ roomId: ROOM_ID });
    expect(res.status).toBe(403);
  });

  test('Non-liveclass room is not affected by school check', async () => {
    asUser('user-1', 'MEMBER', SCHOOL_B);
    prisma.voiceRoom.findUnique.mockResolvedValue(null); // not a voice room either

    const res = await request(app)
      .post('/livekit/token')
      .set('Authorization', tok('user-1'))
      .send({ roomId: 'pk-battle-room-custom-id' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('mock.livekit.token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source verification
// ─────────────────────────────────────────────────────────────────────────────
describe('LTSV-001: Source verification', () => {
  test('livekit.controller.js no longer has SA bypass condition for school check', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8'
    );
    // Remove comments before checking for the bypass pattern
    // Strip single-line comments (//) and multi-line comments (/* */)
    const noComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/\/\/[^\n]*/g, '');        // line comments

    // The bypass was: if (req.user.role !== 'SUPER_ADMIN') { ... school check ... }
    // It must no longer exist in executable code
    expect(noComments).not.toMatch(/if\s*\(\s*req\.user\.role\s*!==\s*['"]SUPER_ADMIN['"]/);
    // School check must still be present
    expect(noComments).toMatch(/schoolMembership\.findUnique/);
  });

  test('livekit.controller.js still has participant check for all roles', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8'
    );
    expect(src).toMatch(/liveClassParticipant\.findFirst/);
    expect(src).toMatch(/not an active participant/i);
  });
});
