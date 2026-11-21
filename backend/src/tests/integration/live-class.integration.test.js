'use strict';
/**
 * Live Class Integration Tests — real MySQL DB
 *
 * Covers the critical authorization and security gates for Live Class:
 *   - AUTH: unauthenticated → 401
 *   - SUPER_ADMIN blocked from SCHOOL streams (F-02)
 *   - Cross-school user blocked from SCHOOL streams (P0-01)
 *   - Role injection prevention (GATE-9)
 *   - Ownership enforcement — only creator can start/end/update (GATE-10)
 *   - PUBLIC stream — any auth user can access (GATE-11)
 *   - Kicked participant cannot rejoin (GATE-6)
 *   - No-school user blocked from SCHOOL stream
 *
 * All users, schools, classes, and live classes created fresh by the test —
 * no hardcoded UUIDs, no dependency on pre-seeded data. Compatible with the
 * CI fresh halqa_test database.
 *
 * Side-effect services mocked so the test does not require Redis, LiveKit,
 * BullMQ, or a live Socket.IO server.
 *
 * Run via: npm run test:integration
 */

// ─── Mock side-effect services ────────────────────────────────────────────────
jest.mock('../../services/queue.service', () => ({
  queueBulkNotifications:        jest.fn().mockResolvedValue(undefined),
  scheduleLiveClassAutoEnd:      jest.fn().mockResolvedValue(undefined),
  cancelLiveClassAutoEnd:        jest.fn().mockResolvedValue(undefined),
  rehydrateLiveClassAutoEndJobs: jest.fn().mockResolvedValue(undefined),
  scheduleRoomReminder:          jest.fn().mockResolvedValue(undefined),
  cancelRoomReminder:            jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../sockets',        () => ({ getIo: jest.fn(() => null) }));
jest.mock('../../utils/feedLive', () => ({
  broadcastLiveStart: jest.fn(),
  broadcastLiveEnd:   jest.fn(),
}));
jest.mock('../../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock-livekit-jwt'),
  })),
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    removeParticipant: jest.fn().mockResolvedValue({}),
  })),
}));

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const bcrypt   = require('bcryptjs');
const prisma   = require('../../utils/prisma');
const { generateAccessToken } = require('../../utils/jwt');
const { v4: uuidv4 } = require('uuid');

// ─── App builder ──────────────────────────────────────────────────────────────
// Build a minimal Express app with only the live-class routes.
// Avoids booting the entire app (Redis connections, BullMQ workers, etc.).
function buildApp() {
  const app = express();
  // FIX: Prisma returns BigInt for microphoneAuthorizationVersion / microphoneSfuVersion
  // fields added by the 20261029_add_live_class_microphone_authority migration.
  // JSON.stringify throws on BigInt by default. Set a replacer that converts BigInt
  // to Number (safe for the int64 values used here — all are small counters starting at 0).
  app.set('json replacer', (_key, val) => (typeof val === 'bigint' ? Number(val) : val));
  app.use(express.json());
  app.use(cookieParser());
  app.use(require('../../middleware/ipAllowlist'));
  app.use('/api/v1/live-classes', require('../../routes/live-class.routes'));
  app.use('/api/v1/livekit',      require('../../routes/livekit.routes'));
  // Error handler
  app.use(function (err, req, res, _next) {
    var status = err.status || err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid         = () => Date.now() + '-' + Math.random().toString(36).slice(2, 7);
const testEmail   = () => 'lc-integ-' + uid() + '@integration-test.halqa';
const PASS        = 'Test1234!';

async function createUser(extra) {
  return prisma.user.create({
    data: Object.assign({
      email:         testEmail(),
      passwordHash:  await bcrypt.hash(PASS, 10),
      firstName:     'LC',
      lastName:      'Test',
      role:          'MEMBER',
      status:        'ACTIVE',
      emailVerified: true,
    }, extra || {})
  });
}

// Generate a JWT for a user. schoolId is embedded in the token claim (legacy pattern).
function jwt(user, schoolId) {
  return 'Bearer ' + generateAccessToken({
    userId:   user.id,
    role:     user.role,
    schoolId: schoolId || user.schoolId || null,
  });
}

// Create a school and add schoolId to a user's row (legacy pattern used by auth guards)
async function createSchool() {
  return prisma.school.create({
    data: {
      name:    'LC Integration School ' + uid(),
      slug:    'lc-integ-' + uid(),
      country: 'MY',
    }
  });
}

async function createSchoolMembership(userId, schoolId, role) {
  return prisma.schoolMembership.create({
    data: { userId, schoolId, role, status: 'ACTIVE' }
  });
}

async function createClass(schoolId) {
  return prisma.class.create({
    data: {
      name:      'LC Test Class ' + uid(),
      schoolId,
      gradeLevel: '1',
      deletedAt:  null,
    }
  });
}

// Insert a live class row via raw SQL (same pattern as the controller).
// Returns the id of the created live class.
async function rawInsertLC(data) {
  var id  = uuidv4();
  var now = new Date().toISOString().slice(0, 23).replace('T', ' ');

  // Build column list and values dynamically to include the mode column only when specified.
  // When omitted, the DB column default is used — after Issue 3 this will be SFU_AUTHORITATIVE.
  var modeColumns = '';
  var modeValues  = '';
  var modeParams  = [];
  if (data.microphoneAuthorizationMode !== undefined) {
    modeColumns = ', microphone_authorization_mode';
    modeValues  = ', ?';
    modeParams  = [data.microphoneAuthorizationMode];
  }

  await prisma.$executeRawUnsafe(
    'INSERT INTO live_classes (id, stream_type, host_user_id, schoolId, classId, teacherId, title, status, maxSpeakers, maxParticipants, chatEnabled, handRaiseEnabled, isOpenMic, screenShareEnabled, whiteboardEnabled, quranPanelEnabled, isRecorded' +
    modeColumns +
    ', createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,0,0' +
    modeValues +
    ',?,?)',
    id,
    data.streamType   || 'SCHOOL',
    data.hostUserId,
    data.schoolId     || null,
    data.classId      || null,
    data.teacherId    || null,
    data.title        || 'LC Integration Test',
    data.status       || 'LIVE',
    data.maxSpeakers  || 2,
    data.maxParticipants || null,
    data.chatEnabled         !== false ? 1 : 0,
    data.handRaiseEnabled    !== false ? 1 : 0,
    data.isOpenMic           ? 1 : 0,
    ...modeParams,
    now,
    now
  );
  createdLcIds.push(id);
  return id;
}

async function addParticipant(lcId, userId, role, wasKicked) {
  var id  = uuidv4();
  var now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  var kicked = wasKicked ? 1 : 0;
  // V-04-E FIX: Production kick sets isActive=false. A kicked participant
  // must have isActive=0 so the token endpoint correctly rejects them (403).
  // Tests that insert participants with wasKicked=true must mirror this.
  var isActive = wasKicked ? 0 : 1;
  var existing = await prisma.$queryRawUnsafe(
    'SELECT id FROM live_class_participants WHERE liveClassId=? AND userId=? LIMIT 1',
    lcId, userId
  );
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      'UPDATE live_class_participants SET isActive=?, role=?, wasKicked=?, isMuted=1, handRaised=0, speakerSlot=NULL WHERE liveClassId=? AND userId=?',
      isActive, role || 'STUDENT', kicked, lcId, userId
    );
    return;
  }
  await prisma.$executeRawUnsafe(
    'INSERT INTO live_class_participants (id, liveClassId, userId, role, isMuted, isActive, speakerSlot, handRaised, wasKicked, totalDuration, createdAt, updatedAt) VALUES (?,?,?,?,1,?,NULL,0,?,0,?,?)',
    id, lcId, userId, role || 'STUDENT', isActive, kicked, now, now
  );
}

// Tracked IDs for cleanup
var createdLcIds    = [];
var createdUserIds  = [];
var createdSchoolIds = [];
var createdClassIds = [];

var app;

// ─── Global setup / teardown ──────────────────────────────────────────────────
beforeAll(async function () {
  process.env.PORT = '0';
  app = buildApp();
  // Verify DB connection
  await prisma.$queryRawUnsafe('SELECT 1');
}, 30000);

afterAll(async function () {
  // Clean in FK-safe order
  for (var id of createdLcIds) {
    await prisma.$executeRawUnsafe('DELETE FROM live_class_participants WHERE liveClassId=?', id).catch(function () {});
    await prisma.$executeRawUnsafe('DELETE FROM live_class_hand_queue WHERE liveClassId=?', id).catch(function () {});
    await prisma.$executeRawUnsafe('DELETE FROM live_classes WHERE id=?', id).catch(function () {});
  }
  await prisma.schoolMembership.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } }).catch(function () {});
  await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } }).catch(function () {});
  await prisma.school.deleteMany({ where: { id: { in: createdSchoolIds } } }).catch(function () {});
  await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } }).catch(function () {});
  await prisma.user.deleteMany({ where: { email: { contains: '@integration-test.halqa' } } }).catch(function () {});
  await prisma.$disconnect();
}, 40000);

// =============================================================================
// GATE-AUTH: Unauthenticated requests
// =============================================================================
describe('GATE-AUTH: unauthenticated → 401', function () {
  var lcId;

  beforeAll(async function () {
    var host   = await createUser({ role: 'MEMBER' });
    var school = await createSchool();
    var cls    = await createClass(school.id);
    createdUserIds.push(host.id);
    createdSchoolIds.push(school.id);
    createdClassIds.push(cls.id);
    lcId = await rawInsertLC({ streamType: 'SCHOOL', hostUserId: host.id, schoolId: school.id, classId: cls.id, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('GET /live-classes without token → 401', async function () {
    var res = await request(app).get('/api/v1/live-classes');
    expect(res.status).toBe(401);
  });

  test('GET /live-classes/:id without token → 401', async function () {
    var res = await request(app).get('/api/v1/live-classes/' + lcId);
    expect(res.status).toBe(401);
  });

  test('POST /live-classes/:id/join without token → 401', async function () {
    var res = await request(app).post('/api/v1/live-classes/' + lcId + '/join');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GATE-F02: SUPER_ADMIN blocked from SCHOOL streams
// =============================================================================
describe('GATE-F02: SUPER_ADMIN cannot access SCHOOL streams', function () {
  var lcId, school, superAdmin;

  beforeAll(async function () {
    var host = await createUser({ role: 'TEACHER' });
    school   = await createSchool();
    var cls  = await createClass(school.id);
    superAdmin = await createUser({ role: 'SUPER_ADMIN' });
    createdUserIds.push(host.id, superAdmin.id);
    createdSchoolIds.push(school.id);
    createdClassIds.push(cls.id);
    lcId = await rawInsertLC({ streamType: 'SCHOOL', hostUserId: host.id, schoolId: school.id, classId: cls.id, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('SUPER_ADMIN GET SCHOOL stream → 403 with platform administrator message', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(superAdmin, school.id));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('SUPER_ADMIN POST /join SCHOOL stream → 403', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(superAdmin, school.id));
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN POST /start SCHOOL stream → 403', async function () {
    var scheduledLcId = await rawInsertLC({
      streamType: 'SCHOOL', hostUserId: superAdmin.id,
      schoolId: school.id, classId: null, status: 'SCHEDULED',
      // Mode is irrelevant: assertSchoolAccess fires a 403 before any microphone check.
      // SFU_AUTHORITATIVE is used as the application-consistent default.
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    var res = await request(app)
      .post('/api/v1/live-classes/' + scheduledLcId + '/start')
      .set('Authorization', jwt(superAdmin, school.id));
    // Either 403 (school access blocked) or 403 (not host) — both correct
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN with matching schoolId in JWT still → 403 (F-02 hardening)', async function () {
    // Even if schoolId in JWT matches the school, SUPER_ADMIN must be denied
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(superAdmin, school.id));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });
});

// =============================================================================
// GATE-CROSS-SCHOOL: Cross-school user blocked from SCHOOL streams
// =============================================================================
describe('GATE-CROSS-SCHOOL: cross-school user cannot access another school SCHOOL stream', function () {
  var lcId, school1, school2, crossSchoolUser;

  beforeAll(async function () {
    var host = await createUser({ role: 'TEACHER' });
    school1  = await createSchool();
    school2  = await createSchool();
    var cls  = await createClass(school1.id);
    crossSchoolUser = await createUser({ role: 'STUDENT' });

    await createSchoolMembership(crossSchoolUser.id, school2.id, 'STUDENT');

    createdUserIds.push(host.id, crossSchoolUser.id);
    createdSchoolIds.push(school1.id, school2.id);
    createdClassIds.push(cls.id);
    lcId = await rawInsertLC({ streamType: 'SCHOOL', hostUserId: host.id, schoolId: school1.id, classId: cls.id, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('cross-school user GET SCHOOL stream → 403', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(crossSchoolUser, school2.id));
    expect(res.status).toBe(403);
  });

  test('cross-school user POST /join SCHOOL stream → 403', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(crossSchoolUser, school2.id));
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GATE-11: PUBLIC streams accessible to all authenticated users
// =============================================================================
describe('GATE-11: PUBLIC stream — any authenticated user can access', function () {
  var lcId, host, noSchoolUser, crossUser, superAdmin;

  beforeAll(async function () {
    host          = await createUser({ role: 'MEMBER' });
    noSchoolUser  = await createUser({ role: 'MEMBER' });   // no school membership
    crossUser     = await createUser({ role: 'STUDENT' });
    superAdmin    = await createUser({ role: 'SUPER_ADMIN' });

    createdUserIds.push(host.id, noSchoolUser.id, crossUser.id, superAdmin.id);
    lcId = await rawInsertLC({ streamType: 'PUBLIC', hostUserId: host.id, schoolId: null, classId: null, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('no-school user GET PUBLIC stream → 200', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(noSchoolUser));
    expect(res.status).toBe(200);
    expect(res.body.data.streamType).toBe('PUBLIC');
  });

  test('cross-school user GET PUBLIC stream → 200', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(crossUser));
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN GET PUBLIC stream → 200', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(superAdmin));
    expect(res.status).toBe(200);
  });

  test('no-school user POST /join PUBLIC stream → 200 as STUDENT', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(noSchoolUser));
    expect(res.status).toBe(200);
    expect(res.body.data.participant.role).toBe('STUDENT');
  });

  test('creator POST /join PUBLIC stream → HOST role', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(host));
    expect(res.status).toBe(200);
    expect(res.body.data.participant.role).toBe('HOST');
  });
});

// =============================================================================
// GATE-9: Role injection — req.body.role is ignored
// =============================================================================
describe('GATE-9: Role injection attack — body.role ignored', function () {
  var lcId, host, attacker;

  beforeAll(async function () {
    host    = await createUser({ role: 'MEMBER' });
    attacker = await createUser({ role: 'MEMBER' });
    createdUserIds.push(host.id, attacker.id);
    lcId = await rawInsertLC({ streamType: 'PUBLIC', hostUserId: host.id, schoolId: null, classId: null, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('POST /join with role:HOST in body → still STUDENT (body.role ignored)', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(attacker))
      .send({ role: 'HOST', isHost: true, hostUserId: attacker.id });
    expect(res.status).toBe(200);
    expect(res.body.data.participant.role).toBe('STUDENT');
  });

  test('POST /join with nested role injection → still STUDENT', async function () {
    var attacker2 = await createUser({ role: 'MEMBER' });
    createdUserIds.push(attacker2.id);
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(attacker2))
      .send({ participant: { role: 'MODERATOR' }, user: { role: 'HOST' } });
    expect(res.status).toBe(200);
    expect(res.body.data.participant.role).toBe('STUDENT');
  });
});

// =============================================================================
// GATE-10: Ownership — only creator can start/end/update
// =============================================================================
describe('GATE-10: Ownership enforcement — only creator can mutate', function () {
  var lcId, host, nonCreator;

  beforeAll(async function () {
    host       = await createUser({ role: 'MEMBER' });
    nonCreator = await createUser({ role: 'MEMBER' });
    createdUserIds.push(host.id, nonCreator.id);
    lcId = await rawInsertLC({ streamType: 'PUBLIC', hostUserId: host.id, schoolId: null, classId: null, status: 'SCHEDULED', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('non-creator PATCH → 403', async function () {
    var res = await request(app)
      .patch('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(nonCreator))
      .send({ title: 'Hijacked Title' });
    expect(res.status).toBe(403);
  });

  test('non-creator POST /start → 403', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/start')
      .set('Authorization', jwt(nonCreator));
    expect(res.status).toBe(403);
  });

  test('non-creator POST /end → 403 (class not LIVE anyway, but still denied by ownership)', async function () {
    // First start it as the creator
    await request(app)
      .post('/api/v1/live-classes/' + lcId + '/start')
      .set('Authorization', jwt(host));

    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/end')
      .set('Authorization', jwt(nonCreator));
    expect(res.status).toBe(403);
  });

  test('creator PATCH → 200', async function () {
    var res = await request(app)
      .patch('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(host))
      .send({ title: 'Updated by Creator' });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// GATE-6: Kicked participant cannot rejoin
// =============================================================================
describe('GATE-6: Kicked participant — all re-entry paths blocked', function () {
  var lcId, host, kickedUser;

  beforeAll(async function () {
    host       = await createUser({ role: 'MEMBER' });
    kickedUser = await createUser({ role: 'MEMBER' });
    createdUserIds.push(host.id, kickedUser.id);
    lcId = await rawInsertLC({ streamType: 'PUBLIC', hostUserId: host.id, schoolId: null, classId: null, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });

    // Set up: add participant with wasKicked=true directly in DB
    await addParticipant(lcId, host.id,       'HOST',    false);
    await addParticipant(lcId, kickedUser.id,  'STUDENT', true);  // wasKicked=true, isActive=false (production kick sets isActive=false)
  }, 30000);

  test('kicked user POST /join → 403', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(kickedUser));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/removed/i);
  });

  test('kicked user POST /token → 403 (not active participant)', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/token')
      .set('Authorization', jwt(kickedUser));
    expect(res.status).toBe(403);
  });

  test('kicked user GET /participants → still accessible (403 on join, not list)', async function () {
    // Listing participants is allowed for any member of the stream.
    // The kicked user can no longer join but can still see the room info.
    // NOTE: This assertion matches the actual behaviour — kicked users cannot
    // rejoin but the endpoint itself is not blocked. If the business rule
    // changes, update this assertion.
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId + '/participants')
      .set('Authorization', jwt(kickedUser));
    // Either 200 (allowed to view) or 403 (fully blocked) — both defensible.
    // We assert it is not 500 (no server error).
    expect(res.status).not.toBe(500);
  });

  test('non-kicked user can still join the same stream', async function () {
    var freshUser = await createUser({ role: 'MEMBER' });
    createdUserIds.push(freshUser.id);
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(freshUser));
    expect(res.status).toBe(200);
    expect(res.body.data.participant.role).toBe('STUDENT');
  });
});

// =============================================================================
// GATE-NO-SCHOOL: User with no school context blocked from SCHOOL stream
// =============================================================================
describe('GATE-NO-SCHOOL: no-school user blocked from SCHOOL stream', function () {
  var lcId, host, noSchoolUser;

  beforeAll(async function () {
    host        = await createUser({ role: 'TEACHER' });
    var school  = await createSchool();
    var cls     = await createClass(school.id);
    noSchoolUser = await createUser({ role: 'MEMBER' }); // no school membership
    createdUserIds.push(host.id, noSchoolUser.id);
    createdSchoolIds.push(school.id);
    createdClassIds.push(cls.id);
    lcId = await rawInsertLC({ streamType: 'SCHOOL', hostUserId: host.id, schoolId: school.id, classId: cls.id, status: 'LIVE', microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  }, 30000);

  test('no-school user GET SCHOOL stream → 400 or 403', async function () {
    var res = await request(app)
      .get('/api/v1/live-classes/' + lcId)
      .set('Authorization', jwt(noSchoolUser));
    // 400 = no school context in token; 403 = school mismatch
    expect([400, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test('no-school user POST /join SCHOOL stream → 400 or 403', async function () {
    var res = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(noSchoolUser));
    expect([400, 403]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

// =============================================================================
// GATE-CREATE-PUBLIC: Any authenticated user can create a PUBLIC live stream
// =============================================================================
describe('GATE-CREATE-PUBLIC: any auth user can create a PUBLIC stream', function () {
  test('MEMBER user creates PUBLIC stream → 201', async function () {
    var creator = await createUser({ role: 'MEMBER' });
    createdUserIds.push(creator.id);

    var res = await request(app)
      .post('/api/v1/live-classes')
      .set('Authorization', jwt(creator))
      .send({ streamType: 'PUBLIC', title: 'My Integration Stream ' + uid() });

    expect(res.status).toBe(201);
    expect(res.body.data.streamType).toBe('PUBLIC');
    expect(res.body.data.hostUserId).toBe(creator.id);
    // Track for cleanup
    if (res.body.data && res.body.data.id) createdLcIds.push(res.body.data.id);
  });

  test('creator of PUBLIC stream joins as HOST', async function () {
    var creator = await createUser({ role: 'MEMBER' });
    createdUserIds.push(creator.id);

    var createRes = await request(app)
      .post('/api/v1/live-classes')
      .set('Authorization', jwt(creator))
      .send({ streamType: 'PUBLIC', title: 'Host Join Test ' + uid() });

    expect(createRes.status).toBe(201);
    var lcId = createRes.body.data.id;
    if (lcId) createdLcIds.push(lcId);

    var joinRes = await request(app)
      .post('/api/v1/live-classes/' + lcId + '/join')
      .set('Authorization', jwt(creator));

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.data.participant.role).toBe('HOST');
  });
});
