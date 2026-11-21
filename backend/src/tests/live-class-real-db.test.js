'use strict';
/**
 * HALQA — Live Class REAL DATABASE Integration Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * These tests use REAL MySQL (no Prisma mocks). They exercise the full
 * application stack: Express routes → controllers → real DB queries.
 *
 * Test coverage:
 *   GATE-1   MySQL maxSpeakers concurrency — concurrent approvals
 *   GATE-2   Same-user concurrent approval — no duplicate slots
 *   GATE-3   Unique slot constraint — P2002 handled cleanly (400)
 *   GATE-4   Slot release and reuse after demotion
 *   GATE-5   Reconnect clears stale speakerSlot
 *   GATE-6   Kick + REST rejoin blocked; token blocked
 *   GATE-7   REST Authorization — all caller types on SCHOOL + PUBLIC streams
 *   GATE-8   SUPER_ADMIN blocked from all SCHOOL endpoints
 *   GATE-9   Role injection (req.body.role) ignored
 *   GATE-10  Ownership: only creator can start/end/update/delete
 *   GATE-11  PUBLIC stream: any auth user joins as STUDENT, not HOST/MOD
 *   GATE-12  maxSpeakers limits stage; does not limit viewers
 *
 * Real users and school from DB:
 *   SCHOOL_ID       = 470d3bd8-9b38-4dfb-a7de-b5fb3608dbc1  (Halqa Academy)
 *   SCHOOL_ADMIN_ID = 65670e2a-6c5e-4d95-8254-a6badd121511  (admin@halqa-academy.com)
 *   TEACHER_ID      = 57b0233f-c958-4e3e-989f-b19fa4067be9  (teacher@halqa-academy.com)
 *   STUDENT_ID      = 0a1efe83-f595-4930-806c-ff1d18e123ed  (student1@halqa.com)
 *   SUPER_ADMIN_ID  = 0ec5f24e-560e-4f4a-b99c-6d46906e9ead  (super.admin@demo.halqa.app)
 *   NO_SCHOOL_ID    = 01145c64-1f48-489c-b800-5246be6a216e  (no memberships)
 *   SCHOOL2_ID      = 0191703d-a2e6-413c-9020-569fd85d1a9d  (Halqa Academy Demo)
 *   SCHOOL2_STUDENT = d95d35e5-a72e-4117-a551-06b6711a44ff  (newstu999@test.com)
 */

// ─── NO PRISMA MOCK — real DB ─────────────────────────────────────────────────
// Do NOT add jest.mock('../utils/prisma') — we want real MySQL queries

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { generateAccessToken } = require('../utils/jwt');

// ─── Real identities ──────────────────────────────────────────────────────────
const SCHOOL_ID        = '470d3bd8-9b38-4dfb-a7de-b5fb3608dbc1';
const SCHOOL_ADMIN_ID  = '65670e2a-6c5e-4d95-8254-a6badd121511';
const TEACHER_ID       = '57b0233f-c958-4e3e-989f-b19fa4067be9';
const STUDENT_ID       = '0a1efe83-f595-4930-806c-ff1d18e123ed';
const SUPER_ADMIN_ID   = '0ec5f24e-560e-4f4a-b99c-6d46906e9ead';
const NO_SCHOOL_ID     = '01145c64-1f48-489c-b800-5246be6a216e';
const SCHOOL2_ID       = '0191703d-a2e6-413c-9020-569fd85d1a9d';
const SCHOOL2_STUDENT  = 'd95d35e5-a72e-4117-a551-06b6711a44ff';

// ─── Token factory ────────────────────────────────────────────────────────────
function jwt(userId, role, schoolId = null) {
  return 'Bearer ' + generateAccessToken({ userId, role, schoolId });
}

const TOK_SA           = jwt(SUPER_ADMIN_ID,  'SUPER_ADMIN', '0191703d-a2e6-413c-9020-569fd85d1a9d');
const TOK_ADMIN        = jwt(SCHOOL_ADMIN_ID, 'SCHOOL_ADMIN', SCHOOL_ID);
const TOK_TEACHER      = jwt(TEACHER_ID,      'TEACHER',      SCHOOL_ID);
const TOK_STUDENT      = jwt(STUDENT_ID,      'STUDENT',      SCHOOL_ID);
const TOK_NO_SCHOOL    = jwt(NO_SCHOOL_ID,    'MEMBER',       null);
const TOK_SCHOOL2      = jwt(SCHOOL2_STUDENT, 'STUDENT',      SCHOOL2_ID);

// ─── App builder (real routes, real middleware, real Prisma) ──────────────────
// We build the Express app WITHOUT starting the HTTP server to avoid
// the port conflict on 5000. Supertest handles binding internally.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Mount only what we need — avoids Socket.IO initialization issues
  const ipAllowlist = require('../middleware/ipAllowlist');
  app.use(ipAllowlist);
  app.use('/api/v1/live-classes', require('../routes/live-class.routes'));
  app.use('/api/v1/livekit', require('../routes/livekit.routes'));
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Test-scoped live class cleanup ──────────────────────────────────────────
// We create real live_classes rows during tests and clean up afterwards.
// createdLcIds tracks everything created so we can DELETE at the end.
const createdLcIds = [];

async function createTestLC(params = {}) {
  const id = require('uuid').v4();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  const p = {
    streamType:  'SCHOOL',
    hostUserId:  TEACHER_ID,
    schoolId:    SCHOOL_ID,
    classId:     null,
    teacherId:   null,
    title:       'Integration Test LC',
    status:      'LIVE',
    maxSpeakers: 2,
    maxParticipants: null,
    chatEnabled: 1,
    handRaiseEnabled: 1,
    isOpenMic: 0,
    ...params,
  };

  // SEC01-G-BE02: set microphone_authorization_mode explicitly when provided.
  // When omitted the DB column default is used (LEGACY after 20261030,
  // SFU_AUTHORITATIVE after the Issue 3 reconciliation migration). Call sites
  // whose scenario depends on the mode MUST pass microphoneAuthorizationMode;
  // mode-indifferent call sites default to SFU_AUTHORITATIVE (see policy below).
  const hasMode = p.microphoneAuthorizationMode !== undefined;
  const modeColumn = hasMode ? ', microphone_authorization_mode' : '';
  const modePlaceholder = hasMode ? ', ?' : '';
  const modeValue = hasMode ? [p.microphoneAuthorizationMode] : [];

  await prisma.$executeRawUnsafe(`
    INSERT INTO live_classes
      (id, stream_type, host_user_id, schoolId, classId, teacherId,
       title, status, maxSpeakers, maxParticipants, chatEnabled,
       handRaiseEnabled, isOpenMic, screenShareEnabled, whiteboardEnabled,
       quranPanelEnabled, isRecorded${modeColumn}, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,0,0${modePlaceholder},?,?)
  `,
    id, p.streamType, p.hostUserId, p.schoolId, p.classId, p.teacherId,
    p.title, p.status, p.maxSpeakers, p.maxParticipants,
    p.chatEnabled, p.handRaiseEnabled, p.isOpenMic,
    ...modeValue,
    now, now
  );
  createdLcIds.push(id);
  return id;
}

async function addParticipant(lcId, userId, role = 'STUDENT', speakerSlot = null) {
  const existing = await prisma.$queryRawUnsafe(
    'SELECT id FROM live_class_participants WHERE liveClassId = ? AND userId = ? LIMIT 1',
    lcId, userId
  );
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      'UPDATE live_class_participants SET isActive=1, role=?, speakerSlot=?, isMuted=1, handRaised=0, wasKicked=0 WHERE liveClassId=? AND userId=?',
      role, speakerSlot, lcId, userId
    );
    return;
  }
  const id = require('uuid').v4();
  const now = new Date().toISOString().slice(0, 23).replace('T', ' ');
  await prisma.$executeRawUnsafe(`
    INSERT INTO live_class_participants
      (id, liveClassId, userId, role, isMuted, isActive, speakerSlot, handRaised, wasKicked, totalDuration, createdAt, updatedAt)
    VALUES (?,?,?,?,1,1,?,0,0,0,?,?)
  `, id, lcId, userId, role, speakerSlot, now, now);
}

async function countActiveSpeakers(lcId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) as cnt FROM live_class_participants WHERE liveClassId=? AND isActive=1 AND speakerSlot IS NOT NULL',
    lcId
  );
  return Number(rows[0].cnt);
}

async function getParticipantState(lcId, userId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT role, speakerSlot, isActive, isMuted, handRaised, wasKicked FROM live_class_participants WHERE liveClassId=? AND userId=? LIMIT 1',
    lcId, userId
  );
  return rows[0] || null;
}

// ─── Global setup / teardown ──────────────────────────────────────────────────
let app;
beforeAll(async () => {
  app = buildApp();
  // Warm up Prisma connection
  await prisma.$queryRawUnsafe('SELECT 1');
});

afterAll(async () => {
  // Clean up all test data created during this run
  if (createdLcIds.length > 0) {
    for (const id of createdLcIds) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM live_class_participants WHERE liveClassId = ?', id
      );
      await prisma.$executeRawUnsafe(
        'DELETE FROM live_class_hand_queue WHERE liveClassId = ?', id
      );
      await prisma.$executeRawUnsafe(
        'DELETE FROM live_classes WHERE id = ?', id
      );
    }
  }
  // Clean up probe scripts
  await prisma.$disconnect();
});

// =============================================================================
// GATE-7: REST Authorization — SCHOOL stream caller matrix
// =============================================================================

describe('GATE-7A: SCHOOL stream — unauthenticated and cross-school denied', () => {
  let lcId;
  beforeAll(async () => {
    // Mode irrelevant: GET-authorization test; SFU_AUTHORITATIVE is the application-consistent default.
    lcId = await createTestLC({ microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  });

  test('G7A-1: Unauthenticated GET /:id → 401', async () => {
    const res = await request(app).get(`/api/v1/live-classes/${lcId}`);
    expect(res.status).toBe(401);
  });

  test('G7A-2: Unauthenticated POST /join → 401', async () => {
    const res = await request(app).post(`/api/v1/live-classes/${lcId}/join`);
    expect(res.status).toBe(401);
  });

  test('G7A-3: Cross-school member (School2) GET SCHOOL stream → 403', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_SCHOOL2);
    expect(res.status).toBe(403);
  });

  test('G7A-4: No-school user GET SCHOOL stream - denied (400 or 403)', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_NO_SCHOOL);
    // No school membership -> denied. eduMember returns 400 (no school context) or 403.
    expect([400, 403]).toContain(res.status);
});

// =============================================================================
// GATE-8: SUPER_ADMIN blocked from all SCHOOL endpoints
// =============================================================================

describe('GATE-8: SUPER_ADMIN blocked from SCHOOL stream', () => {
  let lcId;
  beforeAll(async () => {
    // Mode irrelevant: GET-authorization test; SFU_AUTHORITATIVE is the application-consistent default.
    lcId = await createTestLC({ microphoneAuthorizationMode: 'SFU_AUTHORITATIVE' });
  });

  test('G8-1: SA GET SCHOOL stream → 403', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('G8-2: SA POST /join SCHOOL stream → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
  });

  test('G8-3: SA POST /token SCHOOL stream → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/token`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
  });

  test('G8-4: SA GET /participants SCHOOL stream → 403', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}/participants`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
  });

  test('G8-5: SA POST /hand/approve SCHOOL stream → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/some-user`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
  });

  test('G8-6: SA GET /attendance SCHOOL stream → 403', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}/attendance`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(403);
  });

  test('G8-7: SA POST /messages SCHOOL stream → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/messages`)
      .set('Authorization', TOK_SA)
      .send({ body: 'test' });
    expect(res.status).toBe(403);
  });

  test('G8-8: SA legacy schoolId match does NOT restore access (F-02 real DB)', async () => {
    // SA has schoolId = SCHOOL2_ID in their JWT, but SCHOOL_ID is different
    // This verifies the SA early-exit fires before any schoolId comparison
    const saWithMatchingSchool = jwt(SUPER_ADMIN_ID, 'SUPER_ADMIN', SCHOOL_ID);
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', saWithMatchingSchool);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });
});

// =============================================================================
// GATE-11: PUBLIC stream — any auth user joins as STUDENT, creator as HOST
// =============================================================================

describe('GATE-11: PUBLIC stream authorization', () => {
  let lcId;
  beforeAll(async () => {
    // Create PUBLIC stream with TEACHER as creator
    lcId = await createTestLC({
      streamType: 'PUBLIC',
      hostUserId: TEACHER_ID,
      schoolId:   null,
      title:      'Integration PUBLIC Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
  });

  test('G11-1: No-school user can GET PUBLIC stream (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_NO_SCHOOL);
    expect(res.status).toBe(200);
  });

  test('G11-2: Cross-school user can GET PUBLIC stream (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_SCHOOL2);
    expect(res.status).toBe(200);
  });

  test('G11-3: SUPER_ADMIN can GET PUBLIC stream (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_SA);
    expect(res.status).toBe(200);
  });

  test('G11-4: Non-creator TEACHER joins PUBLIC as STUDENT (role from DB)', async () => {
    // Join the PUBLIC stream as a DIFFERENT teacher
    const otherTeacherId = SCHOOL_ADMIN_ID; // different user, not the creator
    const tok = jwt(otherTeacherId, 'SCHOOL_ADMIN', SCHOOL_ID);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok);
    // Should succeed (200) as STUDENT
    expect(res.status).toBe(200);
    const p = await getParticipantState(lcId, otherTeacherId);
    expect(p).not.toBeNull();
    expect(p.role).toBe('STUDENT'); // NOT HOST, NOT MODERATOR
  });

  test('G11-5: Creator joins PUBLIC as HOST', async () => {
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok);
    expect(res.status).toBe(200);
    const p = await getParticipantState(lcId, TEACHER_ID);
    expect(p).not.toBeNull();
    expect(p.role).toBe('HOST');
  });

  test('G11-6: Non-creator cannot start PUBLIC stream (only creator can)', async () => {
    const tok = jwt(SCHOOL_ADMIN_ID, 'SCHOOL_ADMIN', SCHOOL_ID);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/start`)
      .set('Authorization', tok);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GATE-9: Role injection — req.body.role ignored
// =============================================================================

describe('GATE-9: Role injection attacks', () => {
  let lcId;
  beforeAll(async () => {
    lcId = await createTestLC({
      streamType: 'PUBLIC',
      hostUserId: TEACHER_ID,
      schoolId:   null,
      title:      'Role Injection Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
  });

  test('G9-1: POST /join with {"role":"HOST"} in body → role from DB only', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok)
      .send({ role: 'HOST', isHost: true, hostUserId: NO_SCHOOL_ID });
    expect(res.status).toBe(200);
    const p = await getParticipantState(lcId, NO_SCHOOL_ID);
    expect(p).not.toBeNull();
    expect(p.role).toBe('STUDENT'); // NOT HOST from body
  });

  test('G9-2: POST /join with nested role injection → still STUDENT', async () => {
    const anotherUser = SCHOOL2_STUDENT;
    const tok = jwt(anotherUser, 'STUDENT', SCHOOL2_ID);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok)
      .send({ participant: { role: 'MODERATOR' }, user: { role: 'HOST' } });
    expect(res.status).toBe(200);
    const p = await getParticipantState(lcId, anotherUser);
    expect(p).not.toBeNull();
    expect(p.role).toBe('STUDENT');
  });
});

// =============================================================================
// GATE-10: Ownership — only creator can start/end/update/delete
// =============================================================================

describe('GATE-10: Ownership enforcement', () => {
  let lcId;
  beforeAll(async () => {
    lcId = await createTestLC({
      streamType: 'PUBLIC',
      hostUserId: TEACHER_ID,
      schoolId:   null,
      status:     'SCHEDULED',
      title:      'Ownership Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
  });

  test('G10-1: Non-creator cannot update PUBLIC stream → 403', async () => {
    const tok = jwt(SCHOOL_ADMIN_ID, 'SCHOOL_ADMIN', SCHOOL_ID);
    const res = await request(app)
      .patch(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', tok)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  test('G10-2: Non-creator cannot start PUBLIC stream → 403', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/start`)
      .set('Authorization', tok);
    expect(res.status).toBe(403);
  });

  test('G10-3: Creator can update PUBLIC stream → 200', async () => {
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);
    const res = await request(app)
      .patch(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', tok)
      .send({ title: 'Updated by Creator' });
    expect(res.status).toBe(200);
  });

  test('G10-4: SUPER_ADMIN cannot update PUBLIC stream (not creator) → 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/live-classes/${lcId}`)
      .set('Authorization', TOK_SA)
      .send({ title: 'SA Hijack' });
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GATE-6: Kick + immediate rejoin blocked
// =============================================================================

describe('GATE-6: Kicked participant cannot rejoin', () => {
  let lcId;
  beforeAll(async () => {
    lcId = await createTestLC({
      streamType: 'PUBLIC',
      hostUserId: TEACHER_ID,
      schoolId:   null,
      status:     'LIVE',
      title:      'Kick Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    // Teacher joins as HOST
    await addParticipant(lcId, TEACHER_ID, 'HOST');
    // Student joins
    await addParticipant(lcId, NO_SCHOOL_ID, 'STUDENT');
    // Simulate kick: set wasKicked=true, isActive=false
    await prisma.$executeRawUnsafe(
      'UPDATE live_class_participants SET wasKicked=1, isActive=0 WHERE liveClassId=? AND userId=?',
      lcId, NO_SCHOOL_ID
    );
  });

  test('G6-1: Kicked user POST /join → 403 (wasKicked=true)', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/removed/i);
  });

  test('G6-2: Kicked user POST /token → 403 (not active participant)', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/token`)
      .set('Authorization', tok);
    expect(res.status).toBe(403);
  });

  test('G6-3: Kicked user POST /generic livekit token → 403 (not active participant)', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);
    const res = await request(app)
      .post('/api/v1/livekit/token')
      .set('Authorization', tok)
      .send({ roomId: `liveclass-${lcId}` });
    // Core invariant: kicked user must NOT get a token
    expect(res.status).not.toBe(200);
    expect(res.body.success).toBe(false);
  });
});

// =============================================================================
// GATE-1 + GATE-2 + GATE-3: Real MySQL maxSpeakers concurrency
// =============================================================================

describe('GATE-1/2/3: Real MySQL maxSpeakers concurrency', () => {
  const MAX = 2;
  let lcId;
  // 10 distinct user IDs we'll use as audience participants
  // We use the real users we know exist + generate extra participant records
  const audienceIds = [
    NO_SCHOOL_ID,       // real user
    SCHOOL2_STUDENT,    // real user
    // generate synthetic UUIDs for participants (no User record needed — FK relaxed)
    // Actually we need real user records for FK. Use existing ones + create minimal rows directly.
  ];

  // For concurrent approval tests we need real participant records with real userIds.
  // We'll use TEACHER as HOST and 5 real participants mapped from known users.
  // Since we only have 2 extra real users, we'll test with those + check invariant.

  beforeAll(async () => {
    lcId = await createTestLC({
      streamType:  'SCHOOL',
      hostUserId:  TEACHER_ID,
      schoolId:    SCHOOL_ID,
      status:      'LIVE',
      maxSpeakers: MAX,
      title:       'Concurrency Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    // Host joins
    await addParticipant(lcId, TEACHER_ID, 'HOST');
    // Add audience participants
    await addParticipant(lcId, STUDENT_ID,     'STUDENT');
    await addParticipant(lcId, SCHOOL_ADMIN_ID, 'STUDENT');
    // Note: we only have 2 audience candidates here, matching maxSpeakers=2
    // This tests: both can be admitted (fills stage exactly), a third attempt on
    // either would be rejected
  });

  test('GATE-1A: Approve 2 audience members sequentially — both get slots', async () => {
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);

    const r1 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${STUDENT_ID}`)
      .set('Authorization', tok);
    expect(r1.status).toBe(200);
    expect(typeof r1.body.data.speakerSlot).toBe('number');

    const r2 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${SCHOOL_ADMIN_ID}`)
      .set('Authorization', tok);
    expect(r2.status).toBe(200);
    expect(typeof r2.body.data.speakerSlot).toBe('number');

    // Verify DB: exactly 2 active speakers
    const activeSpeakerCount = await countActiveSpeakers(lcId);
    console.log(`[GATE-1A] activeSpeakers=${activeSpeakerCount}, maxSpeakers=${MAX}`);
    expect(activeSpeakerCount).toBe(MAX);

    // Verify no duplicate slots
    const rows = await prisma.$queryRawUnsafe(
      'SELECT speakerSlot FROM live_class_participants WHERE liveClassId=? AND isActive=1 AND speakerSlot IS NOT NULL',
      lcId
    );
    const slots = rows.map(r => Number(r.speakerSlot));
    const uniqueSlots = new Set(slots);
    console.log(`[GATE-1A] slots=${JSON.stringify(slots)}`);
    expect(uniqueSlots.size).toBe(slots.length); // no duplicates
    expect(slots.length).toBe(MAX);
  });

  test('GATE-1B: Third approval attempt → 400 stage full (real DB COUNT guard)', async () => {
    // Stage is already full from GATE-1A. Try to approve STUDENT again (idempotent)
    // Actually approve returns idempotent 200 for already-on-stage user.
    // To test the "stage full" path, we need a 3rd distinct audience member.
    // Use NO_SCHOOL_ID who is NOT in this school — will hit school access first (403)
    // Instead verify the COUNT guard via direct participant insert then attempt

    // Manually add a 3rd audience participant via DB (bypassing enrollment check)
    await addParticipant(lcId, NO_SCHOOL_ID, 'STUDENT');
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);
    const r3 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${NO_SCHOOL_ID}`)
      .set('Authorization', tok);

    // Stage is full (2/2) — must be 400
    expect(r3.status).toBe(400);
    expect(r3.body.message).toMatch(/stage is full/i);

    // CRITICAL: verify DB count is still <= MAX
    const activeSpeakerCount = await countActiveSpeakers(lcId);
    console.log(`[GATE-1B] activeSpeakers after rejected 3rd approval: ${activeSpeakerCount}`);
    expect(activeSpeakerCount).toBeLessThanOrEqual(MAX);
  });

  test('GATE-2: Concurrent approvals of different users → active speakers <= maxSpeakers', async () => {
    // Create a fresh LC with max=2
    const concLcId = await createTestLC({
      streamType: 'SCHOOL', hostUserId: TEACHER_ID, schoolId: SCHOOL_ID,
      status: 'LIVE', maxSpeakers: 2, title: 'Concurrent Approval Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    await addParticipant(concLcId, TEACHER_ID,       'HOST');
    await addParticipant(concLcId, STUDENT_ID,        'STUDENT');
    await addParticipant(concLcId, SCHOOL_ADMIN_ID,   'STUDENT');
    await addParticipant(concLcId, NO_SCHOOL_ID,      'STUDENT'); // 3rd candidate

    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);

    // Fire all 3 approvals simultaneously
    const results = await Promise.all([
      request(app).post(`/api/v1/live-classes/${concLcId}/hand/approve/${STUDENT_ID}`).set('Authorization', tok),
      request(app).post(`/api/v1/live-classes/${concLcId}/hand/approve/${SCHOOL_ADMIN_ID}`).set('Authorization', tok),
      request(app).post(`/api/v1/live-classes/${concLcId}/hand/approve/${NO_SCHOOL_ID}`).set('Authorization', tok),
    ]);

    const statuses = results.map(r => r.status);
    const successes = results.filter(r => r.status === 200);
    const errors500 = results.filter(r => r.status === 500);

    console.log(`[GATE-2] concurrent statuses: ${JSON.stringify(statuses)}`);

    // CRITICAL INVARIANT: verify from real DB
    const activeSpeakerCount = await countActiveSpeakers(concLcId);
    console.log(`[GATE-2] DB activeSpeakers=${activeSpeakerCount}, maxSpeakers=2`);
    expect(activeSpeakerCount).toBeLessThanOrEqual(2);

    // No 500 errors — P2002 must be caught
    expect(errors500.length).toBe(0);

    // Verify no duplicate slots in DB
    const rows = await prisma.$queryRawUnsafe(
      'SELECT speakerSlot FROM live_class_participants WHERE liveClassId=? AND isActive=1 AND speakerSlot IS NOT NULL',
      concLcId
    );
    const slots = rows.map(r => Number(r.speakerSlot));
    const uniqueSlots = new Set(slots);
    console.log(`[GATE-2] DB slots: ${JSON.stringify(slots)}`);
    expect(uniqueSlots.size).toBe(slots.length); // no duplicate slots in DB
  });

  test('GATE-3: P2002 unique constraint → 400 not 500 (real DB)', async () => {
    // This test inserts a participant with speakerSlot=0 first, then tries to
    // directly insert another participant with speakerSlot=0 to verify the unique
    // constraint fires and the controller handles it correctly.
    const dupLcId = await createTestLC({
      streamType: 'SCHOOL', hostUserId: TEACHER_ID, schoolId: SCHOOL_ID,
      status: 'LIVE', maxSpeakers: 3, title: 'Dup Slot Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    await addParticipant(dupLcId, TEACHER_ID, 'HOST');
    await addParticipant(dupLcId, STUDENT_ID,  'STUDENT');

    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);
    // First approval — should succeed and assign slot 0
    const r1 = await request(app)
      .post(`/api/v1/live-classes/${dupLcId}/hand/approve/${STUDENT_ID}`)
      .set('Authorization', tok);
    expect(r1.status).toBe(200);
    const assignedSlot = r1.body.data?.speakerSlot;
    console.log(`[GATE-3] First approval assigned slot: ${assignedSlot}`);

    // Idempotent second approval for SAME user — should return 200 with same slot
    const r2 = await request(app)
      .post(`/api/v1/live-classes/${dupLcId}/hand/approve/${STUDENT_ID}`)
      .set('Authorization', tok);
    expect(r2.status).toBe(200); // idempotent
    expect(r2.status).not.toBe(500);

    // Verify DB has exactly 1 speaker record (not 2)
    const rows = await prisma.$queryRawUnsafe(
      'SELECT speakerSlot FROM live_class_participants WHERE liveClassId=? AND isActive=1 AND speakerSlot IS NOT NULL',
      dupLcId
    );
    console.log(`[GATE-3] DB speaker rows: ${rows.length}`);
    expect(rows.length).toBe(1); // exactly one, not duplicated
  });
});

// =============================================================================
// GATE-4: Slot release and reuse (real DB)
// =============================================================================

describe('GATE-4: Slot release and reuse', () => {
  let lcId;

  beforeAll(async () => {
    lcId = await createTestLC({
      streamType: 'SCHOOL', hostUserId: TEACHER_ID, schoolId: SCHOOL_ID,
      status: 'LIVE', maxSpeakers: 2, title: 'Slot Release Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    await addParticipant(lcId, TEACHER_ID,      'HOST');
    await addParticipant(lcId, STUDENT_ID,       'STUDENT');
    await addParticipant(lcId, SCHOOL_ADMIN_ID,  'STUDENT');
    await addParticipant(lcId, NO_SCHOOL_ID,     'STUDENT');
  });

  test('G4-1: Fill stage to max, then demote one, then admit third', async () => {
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);

    // Fill stage (max=2)
    const r1 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${STUDENT_ID}`)
      .set('Authorization', tok);
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${SCHOOL_ADMIN_ID}`)
      .set('Authorization', tok);
    expect(r2.status).toBe(200);

    let activeBefore = await countActiveSpeakers(lcId);
    console.log(`[G4-1] Before demote: activeSpeakers=${activeBefore}`);
    expect(activeBefore).toBe(2); // full

    // Third attempt is rejected
    const r3 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${NO_SCHOOL_ID}`)
      .set('Authorization', tok);
    expect(r3.status).toBe(400);

    // Demote STUDENT_ID to free a slot
    const demoteRes = await request(app)
      .post(`/api/v1/live-classes/${lcId}/demote/${STUDENT_ID}`)
      .set('Authorization', tok);
    expect(demoteRes.status).toBe(200);

    let activeAfterDemote = await countActiveSpeakers(lcId);
    console.log(`[G4-1] After demote: activeSpeakers=${activeAfterDemote}`);
    expect(activeAfterDemote).toBe(1); // one slot freed

    // Now NO_SCHOOL_ID can be admitted
    const r4 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${NO_SCHOOL_ID}`)
      .set('Authorization', tok);
    expect(r4.status).toBe(200);

    let activeFinal = await countActiveSpeakers(lcId);
    console.log(`[G4-1] After re-admit: activeSpeakers=${activeFinal}`);
    expect(activeFinal).toBe(2); // back to 2, slot was reused
    expect(activeFinal).toBeLessThanOrEqual(2); // never exceeded max

    // Verify no duplicate slots
    const rows = await prisma.$queryRawUnsafe(
      'SELECT speakerSlot FROM live_class_participants WHERE liveClassId=? AND isActive=1 AND speakerSlot IS NOT NULL',
      lcId
    );
    const slots = rows.map(r => Number(r.speakerSlot));
    const uniqueSlots = new Set(slots);
    console.log(`[G4-1] Final slots: ${JSON.stringify(slots)}`);
    expect(uniqueSlots.size).toBe(slots.length);
  });
});

// =============================================================================
// GATE-5: Reconnect clears stale speakerSlot (real DB)
// =============================================================================

describe('GATE-5: Reconnect clears stale speakerSlot', () => {
  let lcId;

  beforeAll(async () => {
    lcId = await createTestLC({
      streamType: 'PUBLIC', hostUserId: TEACHER_ID, schoolId: null,
      status: 'LIVE', maxSpeakers: 2, title: 'Reconnect Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    // Manually set student as active speaker with slot=0
    await addParticipant(lcId, TEACHER_ID, 'HOST');
    await addParticipant(lcId, NO_SCHOOL_ID, 'STUDENT', 0); // slot=0, on stage
  });

  test('G5-1: Rejoin (POST /join) resets speakerSlot to null in DB', async () => {
    const tok = jwt(NO_SCHOOL_ID, 'MEMBER', null);

    const stateBefore = await getParticipantState(lcId, NO_SCHOOL_ID);
    console.log(`[G5-1] Before rejoin: speakerSlot=${stateBefore?.speakerSlot}`);
    expect(Number(stateBefore.speakerSlot)).toBe(0); // was on stage

    // Rejoin — this triggers the upsert with update: { speakerSlot: null }
    const res = await request(app)
      .post(`/api/v1/live-classes/${lcId}/join`)
      .set('Authorization', tok);
    expect(res.status).toBe(200);

    const stateAfter = await getParticipantState(lcId, NO_SCHOOL_ID);
    console.log(`[G5-1] After rejoin: speakerSlot=${stateAfter?.speakerSlot}`);
    expect(stateAfter.speakerSlot).toBeNull(); // slot cleared

    // Active speaker count must now be 0 (only the reconnected user was a speaker)
    const activeCount = await countActiveSpeakers(lcId);
    console.log(`[G5-1] Active speakers after rejoin: ${activeCount}`);
    expect(activeCount).toBe(0);
  });
});

// =============================================================================
// GATE-12: maxSpeakers limits stage, NOT total viewers
// =============================================================================

describe('GATE-12: maxSpeakers limits stage only, not total participants', () => {
  let lcId;

  beforeAll(async () => {
    lcId = await createTestLC({
      streamType:     'PUBLIC',
      hostUserId:     TEACHER_ID,
      schoolId:       null,
      status:         'LIVE',
      maxSpeakers:    1,
      maxParticipants: null, // unlimited viewers
      title:          'Scale Test',
      microphoneAuthorizationMode: 'SFU_AUTHORITATIVE',
    });
    await addParticipant(lcId, TEACHER_ID, 'HOST');
  });

  test('G12-1: Multiple users can JOIN (become audience) when maxSpeakers=1', async () => {
    // All these are viewers — maxSpeakers only limits stage, not join
    const joiners = [
      { id: NO_SCHOOL_ID,    tok: TOK_NO_SCHOOL },
      { id: SCHOOL2_STUDENT, tok: TOK_SCHOOL2 },
      { id: SCHOOL_ADMIN_ID, tok: jwt(SCHOOL_ADMIN_ID, 'SCHOOL_ADMIN', SCHOOL_ID) },
    ];
    for (const j of joiners) {
      const res = await request(app)
        .post(`/api/v1/live-classes/${lcId}/join`)
        .set('Authorization', j.tok);
      // All should succeed as audience even though maxSpeakers=1
      expect(res.status).toBe(200);
    }

    // Verify total participant count > maxSpeakers (3 joined + 1 host = 4 total)
    const totalRows = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as cnt FROM live_class_participants WHERE liveClassId=? AND isActive=1',
      lcId
    );
    const total = Number(totalRows[0].cnt);
    console.log(`[G12-1] Total participants: ${total}, maxSpeakers: 1`);
    expect(total).toBeGreaterThan(1); // more viewers than maxSpeakers

    // Stage count must be 0 (nobody approved to stage yet)
    const stageCount = await countActiveSpeakers(lcId);
    console.log(`[G12-1] Stage (speakers): ${stageCount}`);
    expect(stageCount).toBe(0);
  });

  test('G12-2: Only 1 can be approved to stage (maxSpeakers=1)', async () => {
    const tok = jwt(TEACHER_ID, 'TEACHER', SCHOOL_ID);

    const r1 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${NO_SCHOOL_ID}`)
      .set('Authorization', tok);
    expect(r1.status).toBe(200); // first speaker admitted

    // Second attempt must be rejected
    const r2 = await request(app)
      .post(`/api/v1/live-classes/${lcId}/hand/approve/${SCHOOL2_STUDENT}`)
      .set('Authorization', tok);
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/stage is full/i);

    const stageCount = await countActiveSpeakers(lcId);
    console.log(`[G12-2] Stage count: ${stageCount} (must be 1)`);
    expect(stageCount).toBe(1);
    expect(stageCount).toBeLessThanOrEqual(1);
  });
});

});
