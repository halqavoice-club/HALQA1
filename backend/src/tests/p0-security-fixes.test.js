'use strict';
/**
 * P0 Security Fix Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * SEC-CRIT-001: Backup routes require SUPER_ADMIN
 * SEC-CRIT-002: GET /users/:id does not leak PII to other users
 * SEC-CRIT-003: LiveKit generic token checks voice room participant
 *
 * All tests use mocked DB — no real database required.
 * Run via: npm run test:unit
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
  deleteCache:  jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt',     () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets',       () => ({ getIo: jest.fn(() => null) }));
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock.livekit.token'),
  })),
}));

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asUser(id, role, status, schoolId) {
  status   = status   || 'ACTIVE';
  schoolId = schoolId || null;
  const u = { id, role, status, schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function tok(id) { return `Bearer t-${id}`; }

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-CRIT-001: Backup routes require SUPER_ADMIN
// Every backup endpoint must reject non-SUPER_ADMIN users with 403.
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-CRIT-001: Backup routes require SUPER_ADMIN', () => {
  let backupApp;

  beforeAll(() => {
    backupApp = express();
    backupApp.use(express.json());
    backupApp.use(cookieParser());
    backupApp.use('/api/v1/backups', require('../routes/backup.routes'));
    backupApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  test('SUPER_ADMIN can GET /backups (200 or 500, not 401/403)', async () => {
    asUser('sa-bk', 'SUPER_ADMIN', 'ACTIVE');
    // backupMetadata may not be in the shared prisma mock — that causes 500, not 401/403.
    // The key assertion is that auth passes (no 401 or 403).
    if (!prisma.backupMetadata) prisma.backupMetadata = {};
    if (!prisma.backupMetadata.findMany) prisma.backupMetadata.findMany = jest.fn().mockResolvedValue([]);
    const res = await request(backupApp).get('/api/v1/backups').set('Authorization', tok('sa-bk'));
    // Auth passed: must not be 401 (unauthenticated) or 403 (unauthorized)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('MEMBER gets 403 on GET /backups', async () => {
    asUser('mb-bk', 'MEMBER', 'ACTIVE');
    const res = await request(backupApp).get('/api/v1/backups').set('Authorization', tok('mb-bk'));
    expect(res.status).toBe(403);
  });

  test('SCHOOL_ADMIN gets 403 on GET /backups', async () => {
    asUser('sca-bk', 'SCHOOL_ADMIN', 'ACTIVE', 'sch');
    const res = await request(backupApp).get('/api/v1/backups').set('Authorization', tok('sca-bk'));
    expect(res.status).toBe(403);
  });

  test('TEACHER gets 403 on GET /backups', async () => {
    asUser('tch-bk', 'TEACHER', 'ACTIVE', 'sch');
    const res = await request(backupApp).get('/api/v1/backups').set('Authorization', tok('tch-bk'));
    expect(res.status).toBe(403);
  });

  test('STUDENT gets 403 on GET /backups', async () => {
    asUser('std-bk', 'STUDENT', 'ACTIVE', 'sch');
    const res = await request(backupApp).get('/api/v1/backups').set('Authorization', tok('std-bk'));
    expect(res.status).toBe(403);
  });

  test('Unauthenticated gets 401 on GET /backups', async () => {
    const res = await request(backupApp).get('/api/v1/backups');
    expect(res.status).toBe(401);
  });

  test('MEMBER gets 403 on POST /backups', async () => {
    asUser('mb-bk2', 'MEMBER', 'ACTIVE');
    const res = await request(backupApp).post('/api/v1/backups').set('Authorization', tok('mb-bk2')).send({});
    expect(res.status).toBe(403);
  });

  test('MEMBER gets 403 on DELETE /backups/:id', async () => {
    asUser('mb-bk3', 'MEMBER', 'ACTIVE');
    const res = await request(backupApp).delete('/api/v1/backups/some-id').set('Authorization', tok('mb-bk3'));
    expect(res.status).toBe(403);
  });

  test('MEMBER gets 403 on POST /backups/prune', async () => {
    asUser('mb-bk4', 'MEMBER', 'ACTIVE');
    const res = await request(backupApp).post('/api/v1/backups/prune').set('Authorization', tok('mb-bk4')).send({});
    expect(res.status).toBe(403);
  });

  test('MEMBER gets 403 on GET /backups/stats', async () => {
    asUser('mb-bk5', 'MEMBER', 'ACTIVE');
    const res = await request(backupApp).get('/api/v1/backups/stats').set('Authorization', tok('mb-bk5'));
    expect(res.status).toBe(403);
  });

  // Source-level verification
  test('backup.routes.js source contains authorize("SUPER_ADMIN")', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/backup.routes.js'), 'utf8');
    expect(src).toMatch(/authorize\s*\(\s*['"]SUPER_ADMIN['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-CRIT-002: GET /users/:id does not leak PII to other users
// Cross-user requests must not expose email, phone, address, dateOfBirth.
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-CRIT-002: GET /users/:id PII protection', () => {
  let userApp;

  beforeAll(() => {
    userApp = express();
    userApp.use(express.json());
    userApp.use(cookieParser());
    userApp.use('/api/v1/users', require('../routes/user.routes'));
    userApp.use((err, req, res, _next) => {
      res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
    });
  });

  const TARGET_ID = 'target-pii-user';
  const FULL_TARGET = {
    id: TARGET_ID, firstName: 'Jane', lastName: 'Smith',
    email: 'jane@example.com', phone: '+15551234567',
    dateOfBirth: '1990-01-01', gender: 'F', address: '123 Main St',
    avatarUrl: null, bio: 'hello', username: 'jane_s',
    role: 'MEMBER', status: 'ACTIVE', schoolId: 'school-x',
    createdAt: new Date().toISOString(), emailVerified: true,
    lastLoginAt: null, deletedAt: null,
  };

  test('MEMBER gets own full profile including email and phone', async () => {
    asUser(TARGET_ID, 'MEMBER', 'ACTIVE', 'school-x');
    // authenticate mock resolves user, then route fetches target
    prisma.user.findUnique
      .mockResolvedValueOnce({ ...FULL_TARGET })  // authenticate
      .mockResolvedValueOnce({ ...FULL_TARGET });  // route handler
    const res = await request(userApp)
      .get(`/api/v1/users/${TARGET_ID}`)
      .set('Authorization', tok(TARGET_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('jane@example.com');
    expect(res.body.data.phone).toBe('+15551234567');
  });

  test('MEMBER viewing ANOTHER user does NOT get email or phone', async () => {
    const requesterId = 'other-user-id';
    asUser(requesterId, 'MEMBER', 'ACTIVE', 'school-y');
    const requesterRecord = { id: requesterId, role: 'MEMBER', status: 'ACTIVE', schoolId: 'school-y', firstName: 'R', lastName: 'Q', avatarUrl: null, deletedAt: null };
    // authenticate call returns requester; route call returns target (PUBLIC fields only in real DB)
    prisma.user.findUnique
      .mockResolvedValueOnce(requesterRecord)  // authenticate
      .mockResolvedValueOnce({ ...FULL_TARGET }); // route handler (mock doesn't filter select)
    const res = await request(userApp)
      .get(`/api/v1/users/${TARGET_ID}`)
      .set('Authorization', tok(requesterId));
    expect(res.status).toBe(200);

    // The security guarantee is in the SELECT argument, not in what the mock returns.
    // Verify that findUnique was called with PUBLIC_PROFILE_SELECT (no email key):
    const calls = prisma.user.findUnique.mock.calls;
    // Second call is the route handler lookup (first is authenticate)
    const routeCall = calls[1];
    if (routeCall && routeCall[0] && routeCall[0].select) {
      const selectedFields = routeCall[0].select;
      expect(selectedFields.email).toBeUndefined();   // email NOT in public select
      expect(selectedFields.phone).toBeUndefined();   // phone NOT in public select
      expect(selectedFields.firstName).toBe(true);    // firstName IS in public select
    } else {
      // If select is not used, the route must rely on other means — fail explicitly
      fail('Expected route handler to use a select argument that excludes email');
    }
  });

  test('SUPER_ADMIN gets full profile of another user', async () => {
    const adminId = 'sa-pii';
    asUser(adminId, 'SUPER_ADMIN', 'ACTIVE', null);
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: adminId, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null, firstName: 'A', lastName: 'S', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce({ ...FULL_TARGET });
    const res = await request(userApp)
      .get(`/api/v1/users/${TARGET_ID}`)
      .set('Authorization', tok(adminId));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('jane@example.com');
    expect(res.body.data.phone).toBe('+15551234567');
  });

  test('Unauthenticated GET /users/:id returns 401', async () => {
    const res = await request(userApp).get(`/api/v1/users/${TARGET_ID}`);
    expect(res.status).toBe(401);
  });

  test('Non-existent user returns 404', async () => {
    const reqId = 'req-404-sec';
    asUser(reqId, 'MEMBER', 'ACTIVE', null);
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: reqId, role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'R', lastName: 'Q', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(null);
    const res = await request(userApp)
      .get('/api/v1/users/nonexistent-user-id')
      .set('Authorization', tok(reqId));
    expect(res.status).toBe(404);
  });

  // Source-level verification
  test('user.routes.js defines PUBLIC_PROFILE_SELECT without email', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
    expect(src).toMatch(/PUBLIC_PROFILE_SELECT/);
    expect(src).toMatch(/FULL_PROFILE_SELECT/);
    // PUBLIC_PROFILE_SELECT must not include email
    const match = src.match(/const PUBLIC_PROFILE_SELECT\s*=\s*\{([^}]+)\}/);
    if (match) {
      expect(match[1]).not.toMatch(/\bemail\b/);
      expect(match[1]).not.toMatch(/\bphone\b/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-CRIT-003: LiveKit generic token checks voice room participant
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-CRIT-003: LiveKit generic token voice room guard', () => {
  let livekitCtrl;

  beforeAll(() => {
    livekitCtrl = require('../controllers/livekit.controller');
  });

  function makeReq(overrides = {}) {
    return {
      params: {},
      query:  {},
      body:   { roomId: 'voice-room-123' },
      user:   { id: 'u1', role: 'MEMBER', schoolId: null, firstName: 'T', lastName: 'T' },
      ...overrides,
    };
  }
  function makeRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  }
  const next = jest.fn();

  const VOICE_ROOM_ID = 'voice-room-test-uuid';

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure schoolMembership exists (required by livekit controller for liveclass rooms)
    if (!prisma.schoolMembership) prisma.schoolMembership = {};
    if (!prisma.schoolMembership.findUnique) prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
    if (!prisma.schoolMembership.findFirst)  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
    // VULN-LIVE-005 FIX: Default to ACTIVE membership so positive-path tests pass.
    // Tests that specifically verify denial override this per-test.
    prisma.schoolMembership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    prisma.schoolMembership.findFirst.mockResolvedValue({ status: 'ACTIVE' });
  });

  test('active voice room participant gets token successfully', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: VOICE_ROOM_ID, status: 'LIVE', deletedAt: null });
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: true });
    const req = makeReq({ body: { roomId: VOICE_ROOM_ID }, user: { id: 'active-user', role: 'MEMBER', schoolId: null, firstName: 'T', lastName: 'T' } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('non-participant of voice room gets 403', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: VOICE_ROOM_ID, status: 'LIVE', deletedAt: null });
    prisma.voiceParticipant.findUnique.mockResolvedValue(null);
    const req = makeReq({ body: { roomId: VOICE_ROOM_ID }, user: { id: 'outsider', role: 'MEMBER', schoolId: null, firstName: 'O', lastName: 'O' } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('inactive participant (kicked) gets 403', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: VOICE_ROOM_ID, status: 'LIVE', deletedAt: null });
    prisma.voiceParticipant.findUnique.mockResolvedValue({ isActive: false });
    const req = makeReq({ body: { roomId: VOICE_ROOM_ID }, user: { id: 'kicked', role: 'MEMBER', schoolId: null, firstName: 'K', lastName: 'K' } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ended voice room returns 400', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: VOICE_ROOM_ID, status: 'ENDED', deletedAt: null });
    const req = makeReq({ body: { roomId: VOICE_ROOM_ID } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('deleted voice room returns 404', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue({ id: VOICE_ROOM_ID, status: 'LIVE', deletedAt: new Date() });
    const req = makeReq({ body: { roomId: VOICE_ROOM_ID } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('room ID not in voice_rooms (PK/custom) passes without participant check', async () => {
    prisma.voiceRoom.findUnique.mockResolvedValue(null); // not a voice room
    const req = makeReq({ body: { roomId: 'pk-battle-room-custom' } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(prisma.voiceParticipant.findUnique).not.toHaveBeenCalled();
  });

  test('liveclass-* rooms use liveclass check, not voice check', async () => {
    prisma.liveClass.findFirst.mockResolvedValue({ id: 'cls-1', schoolId: 'school-a', status: 'LIVE', deletedAt: null });
    prisma.liveClassParticipant.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.voiceRoom.findUnique.mockResolvedValue(null); // should not be called
    const req = makeReq({ body: { roomId: 'liveclass-cls-1' }, user: { id: 'u1', role: 'TEACHER', schoolId: 'school-a', firstName: 'T', lastName: 'T' } });
    const res = makeRes();
    await livekitCtrl.generateToken(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(prisma.voiceRoom.findUnique).not.toHaveBeenCalled();
  });

  // Source-level verification
  test('livekit.controller.js source contains voice room participant guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/livekit.controller.js'), 'utf8');
    expect(src).toMatch(/voiceRoom[\s\S]{0,100}findUnique/);
    expect(src).toMatch(/voiceParticipant[\s\S]{0,100}findUnique/);
    expect(src).toMatch(/not an active participant in this voice room/);
  });
});
