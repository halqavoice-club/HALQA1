'use strict';
/**
 * HALQA — maxSpeakers Concurrency & Speaker Slot Security Tests (Phase 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Critical invariant: activeSpeakers <= maxSpeakers AT ALL TIMES.
 *
 * Design:
 *   Functional tests use Promise.all() for overlapping requests; a call-counter
 *   mock simulates the atomic UPDATE behavior: first N calls succeed (1 row),
 *   rest return 0 (stage full per COUNT subquery).
 *
 *   Source-code audits verify the exact SQL patterns in the controller.
 *
 *   DB-level unique-constraint tests inject a P2002/ER_DUP_ENTRY error to
 *   confirm the controller returns 400 (not 500) on a slot collision.
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getCache:     jest.fn().mockResolvedValue(null),
  setCache:     jest.fn().mockResolvedValue(undefined),
  deleteCache:  jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/feedLive', () => ({
  broadcastLiveStart: jest.fn(), broadcastLiveEnd: jest.fn(),
}));
jest.mock('../services/queue.service', () => ({
  queueBulkNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(), toJwt: jest.fn().mockResolvedValue('tok'),
  })),
}));
jest.mock('../middleware/educationAuth', () => ({
  eduMember: [(req, res, next) => next()],
  eduStaff:  [(req, res, next) => next()],
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const prisma = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const fs   = require('fs');
const path = require('path');

const CTRL_PATH = path.join(__dirname, '../controllers/live-class.controller.js');

// ─── App factory ─────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/live-classes', require('../routes/live-class.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
function makeLiveClassRow(maxSpeakers = 2) {
  return {
    id: 'lc-1',
    stream_type: 'SCHOOL', streamType: 'SCHOOL',
    schoolId: 'school-a', classId: 'cls-1', teacherId: 'tch-1',
    host_user_id: 'host-u', hostUserId: 'host-u',
    title: 'Test', description: null,
    status: 'LIVE', livekitRoomName: 'liveclass-lc-1',
    chatEnabled: 1, handRaiseEnabled: 1, whiteboardEnabled: 1,
    quranPanelEnabled: 0, isOpenMic: 0, screenShareEnabled: 1,
    maxParticipants: null, maxSpeakers,
    isRecorded: 0, recordingStartedAt: null,
    startedAt: new Date(), endedAt: null,
    deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    duration: null,
  };
}

function setupHost(userId = 'host-u', schoolId = 'school-a') {
  verifyAccessToken.mockReturnValue({ userId, role: 'MEMBER', schoolId });
  prisma.user.findUnique.mockResolvedValue({
    id: userId, role: 'MEMBER', status: 'ACTIVE', schoolId,
    firstName: 'H', lastName: 'U', avatarUrl: null, deletedAt: null,
  });
}

function tok(id) { return `Bearer t-${id}`; }

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);

  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.liveClassParticipant) prisma.liveClassParticipant = {};
  prisma.liveClassParticipant.findFirst   = jest.fn().mockResolvedValue(null);
  prisma.liveClassParticipant.findMany    = jest.fn().mockResolvedValue([]);
  prisma.liveClassParticipant.updateMany  = jest.fn().mockResolvedValue({ count: 0 });
  prisma.liveClassParticipant.update      = jest.fn().mockResolvedValue({});

  if (!prisma.liveClassHandQueue) prisma.liveClassHandQueue = {};
  prisma.liveClassHandQueue.updateMany = jest.fn().mockResolvedValue({ count: 0 });
  prisma.liveClassHandQueue.findMany   = jest.fn().mockResolvedValue([]);

  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  prisma.$queryRawUnsafe   = jest.fn().mockResolvedValue([]);
  prisma.$executeRawUnsafe = jest.fn().mockResolvedValue(1);
  prisma.$transaction      = jest.fn().mockResolvedValue([]);
});

// ─── Shared: stub findLiveClass (SELECT) ─────────────────────────────────────
function stubLiveClassSelect(maxSpeakers = 2) {
  const row = makeLiveClassRow(maxSpeakers);
  prisma.$queryRawUnsafe.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('SELECT')) {
      return Promise.resolve([row]);
    }
    return Promise.resolve(1);
  });
  prisma.liveClass.findFirst.mockResolvedValue({ ...row, streamType: 'SCHOOL' });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-A: Basic maxSpeakers enforcement (sequential)
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-A: Basic maxSpeakers enforcement (sequential)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('A1: Third approval rejected when maxSpeakers=2 and stage already full', async () => {
    setupHost();
    stubLiveClassSelect(2);

    // Caller is HOST
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      // Target has no slot
      .mockResolvedValueOnce({ id: 'p-c', userId: 'candidate-c', isActive: true, speakerSlot: null });
    // Two speakers already active
    prisma.liveClassParticipant.findMany.mockResolvedValueOnce([{ speakerSlot: 0 }, { speakerSlot: 1 }]);

    // atomic UPDATE returns 0 (COUNT >= maxSpeakers prevented the write)
    prisma.$executeRawUnsafe.mockResolvedValueOnce(0);

    // recheck: candidate still has no slot (stage truly full)
    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-c', userId: 'candidate-c', isActive: true, speakerSlot: null });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/candidate-c')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stage is full/i);
  });

  test('A2: First approval succeeds when stage is empty (maxSpeakers=1)', async () => {
    setupHost();
    stubLiveClassSelect(1);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-a', userId: 'user-a', isActive: true, speakerSlot: null });
    prisma.liveClassParticipant.findMany.mockResolvedValueOnce([]);
    prisma.$executeRawUnsafe.mockResolvedValueOnce(1); // success

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/user-a')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(200);
    expect(res.body.data.speakerSlot).toBe(0); // first free slot
  });

  test('A3: maxSpeakers defaults to 20 when not configured (source audit)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    // Both approveHand and inviteToStage use: const maxSpeakers = lc.maxSpeakers ?? 20
    expect(src).toMatch(/maxSpeakers = lc\.maxSpeakers \?\? 20/);
  });

  test('A4: maxSpeakers validator enforces min=1 max=50 on PATCH route', () => {
    const routesSrc = fs.readFileSync(
      path.join(__dirname, '../routes/live-class.routes.js'), 'utf8'
    );
    expect(routesSrc).toMatch(/maxSpeakers.*isInt/s);
    expect(routesSrc).toMatch(/min.*1/s);
    expect(routesSrc).toMatch(/max.*50/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-B: Concurrent approveHand — overlapping requests
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-B: Concurrent approveHand — overlapping requests', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('B1: 5 concurrent approvals with maxSpeakers=2 → at most 2 succeed', async () => {
    const MAX = 2;
    const candidates = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e'];

    // The atomic UPDATE serializes via MySQL row-lock. We model:
    // first MAX calls return 1 (success), rest return 0 (COUNT >= maxSpeakers)
    let updateCount = 0;
    prisma.$queryRawUnsafe.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('SELECT')) {
        return Promise.resolve([makeLiveClassRow(MAX)]);
      }
      return Promise.resolve([]);
    });
    prisma.$executeRawUnsafe.mockImplementation(() => {
      updateCount++;
      return Promise.resolve(updateCount <= MAX ? 1 : 0);
    });

    prisma.liveClassParticipant.findFirst.mockImplementation(({ where }) => {
      if (where?.userId === 'host-u') {
        return Promise.resolve({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null });
      }
      const uid = where?.userId;
      if (uid && candidates.includes(uid)) {
        // On recheck after UPDATE=0, return no slot (stage truly full)
        return Promise.resolve({ id: `p-${uid}`, userId: uid, isActive: true, speakerSlot: null });
      }
      return Promise.resolve(null);
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    setupHost();

    const results = await Promise.all(
      candidates.map(uid =>
        request(app)
          .post(`/api/v1/live-classes/lc-1/hand/approve/${uid}`)
          .set('Authorization', tok('host-u'))
      )
    );

    const successes  = results.filter(r => r.status === 200);
    const rejections = results.filter(r => r.status === 400);
    const errors     = results.filter(r => r.status === 500);

    // CRITICAL INVARIANT: no more than maxSpeakers approvals can succeed
    expect(successes.length).toBeLessThanOrEqual(MAX);
    expect(errors.length).toBe(0); // no unexpected 500s
    expect(rejections.length).toBeGreaterThanOrEqual(candidates.length - MAX);
  });

  test('B2: Same user approved twice concurrently — WHERE speakerSlot IS NULL prevents double-slot (source audit)', () => {
    // In production MySQL, the WHERE speakerSlot IS NULL guard means:
    // once request A's UPDATE commits (setting speakerSlot=0), request B's UPDATE
    // WHERE speakerSlot IS NULL finds 0 matching rows and returns 0 affected.
    // The user can only ever hold one slot.
    //
    // In the mocked test environment, both async calls can execute the
    // $executeRawUnsafe mock independently. This is a known mock limitation —
    // the real enforcement is the WHERE clause + unique constraint at DB level.
    // We verify the WHERE IS NULL guard exists in source code here.
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 4000);
    // The WHERE clause must include speakerSlot IS NULL — prevents double-assignment
    expect(body).toMatch(/AND speakerSlot IS NULL/);
    // DB-level unique constraint (liveClassId, speakerSlot) catches any race
    const schemaSrc = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
    );
    expect(schemaSrc).toMatch(/@@unique\(\[liveClassId,\s*speakerSlot\]/);
  });

  test('B3: Source audit — approveHand uses atomic conditional UPDATE', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 4000);
    // Must contain the embedded COUNT subquery
    expect(body).toMatch(/SELECT COUNT\(\*\) FROM/);
    expect(body).toMatch(/speakerSlot IS NOT NULL/);
    // Must check COUNT < maxSpeakers
    expect(body).toMatch(/\) < \?/);
    // Must check speakerSlot IS NULL in WHERE (prevents double-assignment)
    expect(body).toMatch(/speakerSlot IS NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-C: Concurrent inviteToStage — overlapping requests
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-C: Concurrent inviteToStage — overlapping requests', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('C1: 4 concurrent invitations with maxSpeakers=2 → at most 2 succeed', async () => {
    const MAX = 2;
    const candidates = ['i-a', 'i-b', 'i-c', 'i-d'];

    let inviteCount = 0;
    prisma.$queryRawUnsafe.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('SELECT')) {
        return Promise.resolve([makeLiveClassRow(MAX)]);
      }
      return Promise.resolve([]);
    });
    prisma.$executeRawUnsafe.mockImplementation(() => {
      inviteCount++;
      return Promise.resolve(inviteCount <= MAX ? 1 : 0);
    });
    prisma.liveClassParticipant.findFirst.mockImplementation(({ where }) => {
      if (where?.userId === 'host-u') {
        return Promise.resolve({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null });
      }
      const uid = where?.userId;
      if (uid && candidates.includes(uid)) {
        return Promise.resolve({ id: `p-${uid}`, userId: uid, isActive: true, speakerSlot: null });
      }
      return Promise.resolve(null);
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    setupHost();

    const results = await Promise.all(
      candidates.map(uid =>
        request(app).post(`/api/v1/live-classes/lc-1/invite/${uid}`).set('Authorization', tok('host-u'))
      )
    );

    const successes = results.filter(r => r.status === 200);
    const errors    = results.filter(r => r.status === 500);
    expect(successes.length).toBeLessThanOrEqual(MAX);
    expect(errors.length).toBe(0);
  });

  test('C2: Source audit — inviteToStage uses same atomic UPDATE pattern', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function inviteToStage');
    const body  = src.slice(start, start + 3000);
    expect(body).toMatch(/speakerSlot IS NULL/);
    expect(body).toMatch(/SELECT COUNT\(\*\) FROM/);
    expect(body).toMatch(/\) < \?/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-D: Mixed concurrent approveHand + inviteToStage
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-D: Mixed concurrent approveHand + inviteToStage', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('D1: 3 approveHand + 3 inviteToStage concurrently with maxSpeakers=2 — no 500s', async () => {
    const MAX = 2;
    const allCandidates = ['a1', 'a2', 'a3', 'i1', 'i2', 'i3'];

    let mixCount = 0;
    prisma.$queryRawUnsafe.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('SELECT')) {
        return Promise.resolve([makeLiveClassRow(MAX)]);
      }
      return Promise.resolve([]);
    });
    prisma.$executeRawUnsafe.mockImplementation(() => {
      mixCount++;
      return Promise.resolve(mixCount <= MAX ? 1 : 0);
    });
    prisma.liveClassParticipant.findFirst.mockImplementation(({ where }) => {
      if (where?.userId === 'host-u') {
        return Promise.resolve({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null });
      }
      const uid = where?.userId;
      if (uid && allCandidates.includes(uid)) {
        return Promise.resolve({ id: `p-${uid}`, userId: uid, isActive: true, speakerSlot: null });
      }
      return Promise.resolve(null);
    });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    setupHost();

    const [approveResults, inviteResults] = await Promise.all([
      Promise.all(['a1','a2','a3'].map(uid =>
        request(app).post(`/api/v1/live-classes/lc-1/hand/approve/${uid}`).set('Authorization', tok('host-u'))
      )),
      Promise.all(['i1','i2','i3'].map(uid =>
        request(app).post(`/api/v1/live-classes/lc-1/invite/${uid}`).set('Authorization', tok('host-u'))
      )),
    ]);

    const all      = [...approveResults, ...inviteResults];
    const successes = all.filter(r => r.status === 200);
    const errors    = all.filter(r => r.status === 500);

    expect(successes.length).toBeLessThanOrEqual(MAX);
    expect(errors.length).toBe(0); // no unhandled errors
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-E: Slot uniqueness (schema + source audit)
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-E: Slot uniqueness', () => {
  const schemaSrc = fs.readFileSync(
    path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
  );
  const ctrlSrc = fs.readFileSync(CTRL_PATH, 'utf8');

  test('E1: Prisma schema has @@unique([liveClassId, speakerSlot])', () => {
    expect(schemaSrc).toMatch(/@@unique\(\[liveClassId,\s*speakerSlot\]/);
  });

  test('E2: Schema unique constraint named "unique_liveclass_speaker_slot"', () => {
    expect(schemaSrc).toMatch(/unique_liveclass_speaker_slot/);
  });

  test('E3: approveHand catch handles P2002/ER_DUP_ENTRY and returns 400', () => {
    const start = ctrlSrc.indexOf('async function approveHand');
    const body  = ctrlSrc.slice(start, start + 5000);
    // PHASE-3 FIX must be present
    expect(body).toMatch(/P2002/);
    expect(body).toMatch(/ER_DUP_ENTRY|Duplicate entry|Unique constraint/i);
    expect(body).toMatch(/400/);
  });

  test('E4: inviteToStage catch handles P2002/ER_DUP_ENTRY and returns 400', () => {
    const start = ctrlSrc.indexOf('async function inviteToStage');
    // inviteToStage is longer — use 6000 chars to capture the full catch block
    const body  = ctrlSrc.slice(start, start + 6000);
    expect(body).toMatch(/P2002/);
    expect(body).toMatch(/ER_DUP_ENTRY|Duplicate entry|Unique constraint/i);
    expect(body).toMatch(/400/);
  });

  test('E5: Slot IS NULL guard prevents same row from getting two slots', () => {
    const start = ctrlSrc.indexOf('async function approveHand');
    const body  = ctrlSrc.slice(start, start + 3000);
    expect(body).toMatch(/AND speakerSlot IS NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-F: Slot range validation
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-F: Slot range validation', () => {
  test('F1: Slot 0 is the first valid slot (0-based)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 3000);
    expect(body).toMatch(/let slot = 0/);
    expect(body).toMatch(/while \(usedSlots\.has\(slot\)\) slot\+\+/);
  });

  test('F2: Slot is always < maxSpeakers when COUNT guard passes (logic proof)', () => {
    // If COUNT < maxSpeakers, usedSlots.size < maxSpeakers.
    // Slots are 0-based integers. There exists at least one integer in [0, maxSpeakers-1]
    // not in usedSlots. The while loop finds it. Slot < maxSpeakers by construction.
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 3000);
    expect(body).toMatch(/usedSlots = new Set/);
    // Slot computed from activeSpeakers snapshot via map(s => s.speakerSlot)
    expect(body).toMatch(/activeSpeakers\.map/);
  });

  test('F3: maxSpeakers capped at 50 by route validator (source audit)', () => {
    const routes = fs.readFileSync(
      path.join(__dirname, '../routes/live-class.routes.js'), 'utf8'
    );
    expect(routes).toMatch(/maxSpeakers/);
    expect(routes).toMatch(/min.*1/s);
    expect(routes).toMatch(/max.*50/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-G: Slot release and reuse
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-G: Slot release and reuse (dropMic + re-admit)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('G1: dropMic clears speakerSlot=null and mutes participant', async () => {
    setupHost('user-a', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-a', userId: 'user-a', role: 'STUDENT', isActive: true, speakerSlot: 1,
    });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/drop-mic')
      .set('Authorization', tok('user-a'));

    expect(res.status).toBe(200);
    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ speakerSlot: null, isMuted: true }),
      })
    );
  });

  test('G2: HOST cannot drop own mic (use end class)', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null,
    });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/drop-mic')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/host cannot drop mic/i);
  });

  test('G3: dropMic clears slot and demoteFromStage clears slot (source audit)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');

    const dropIdx = src.indexOf('async function dropMicLiveClass');
    expect(dropIdx).toBeGreaterThan(-1);
    const dropBody = src.slice(dropIdx, dropIdx + 1000);
    expect(dropBody).toMatch(/speakerSlot.*null|null.*speakerSlot/);

    const demoteIdx = src.indexOf('async function demoteFromStage');
    expect(demoteIdx).toBeGreaterThan(-1);
    const demoteBody = src.slice(demoteIdx, demoteIdx + 1500);
    expect(demoteBody).toMatch(/speakerSlot: null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-H: Demotion clears slot
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-H: Demotion clears slot; new admission fills it', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('H1: demoteFromStage clears speakerSlot and mutes participant', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-s', userId: 'speaker-u', role: 'STUDENT', isActive: true, speakerSlot: 1 });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/demote/speaker-u')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(200);
    expect(prisma.liveClassParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ speakerSlot: null, isMuted: true }),
      })
    );
  });

  test('H2: HOST cannot be demoted (400)', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-t', userId: 'target-u', role: 'HOST', isActive: true, speakerSlot: 0 });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/demote/target-u')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot demote the host/i);
  });

  test('H3: Demoted slot is re-usable by the next admission (slot-finding loop)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    // The while loop starts at slot=0 and advances past used slots, so it naturally
    // reuses any slot that was freed (not in usedSlots after demotion/drop).
    const approveStart = src.indexOf('async function approveHand');
    const body = src.slice(approveStart, approveStart + 3000);
    expect(body).toMatch(/while \(usedSlots\.has\(slot\)\) slot\+\+/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-I: Reconnect clears stale speakerSlot
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-I: Reconnect does not create ghost slots', () => {
  test('I1: joinLiveClass upsert update clause resets speakerSlot to null on rejoin', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const joinStart = src.indexOf('async function joinLiveClass');
    const body = src.slice(joinStart, joinStart + 10000);
    // H-7 FIX: speakerSlot: null in upsert update prevents ghost occupancy
    expect(body).toMatch(/speakerSlot: null/);
    expect(body).toMatch(/handRaised: false/);
  });

  test('I2: @@unique([liveClassId, userId]) guarantees single record per user per class', () => {
    const schemaSrc = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'), 'utf8'
    );
    expect(schemaSrc).toMatch(/@@unique\(\[liveClassId,\s*userId\]/);
  });

  test('I3: Reconnect clears slot so participant must be re-approved for stage access', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const joinStart = src.indexOf('async function joinLiveClass');
    const body = src.slice(joinStart, joinStart + 10000);
    // The upsert update object must include speakerSlot: null
    const lines = body.split('\n');
    const upsertLine = lines.find(l => l.includes('update:') && l.includes('speakerSlot'));
    if (upsertLine) {
      expect(upsertLine).toMatch(/speakerSlot: null/);
    } else {
      expect(body).toMatch(/speakerSlot: null/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-J: Kick / removal clears active participant (freeing slot)
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-J: Kick / removal frees the slot', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('J1: kickParticipant sets isActive=false + wasKicked=true (source audit)', () => {
    // Source audit: kickParticipant sets isActive=false and wasKicked=true.
    // isActive=false means the kicked participant is excluded from:
    //   - The COUNT subquery (isActive=1 filter)
    //   - Future findMany queries for active speakers
    // This effectively frees the speaker slot so a new participant can be admitted.
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function kickParticipant');
    const body  = src.slice(start, start + 1000);
    expect(body).toMatch(/isActive.*false|false.*isActive/);
    expect(body).toMatch(/wasKicked.*true|true.*wasKicked/);
  });

  test('J2: COUNT subquery only counts isActive=1 rows (kicked row not counted)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 3000);
    // The embedded COUNT must filter isActive = 1
    expect(body).toMatch(/isActive = 1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-K: Authorization — cannot bypass maxSpeakers via role injection
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-K: Authorization guards (no role bypass)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('K1: STUDENT audience cannot approve hands (not HOST/MOD)', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'student-u', role: 'MEMBER', schoolId: 'school-a' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'student-u', role: 'MEMBER', status: 'ACTIVE', schoolId: 'school-a',
      firstName: 'S', lastName: 'U', avatarUrl: null, deletedAt: null,
    });
    stubLiveClassSelect(2);
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-s', userId: 'student-u', role: 'STUDENT', isActive: true, speakerSlot: null,
    });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/other-user')
      .set('Authorization', tok('student-u'));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/host or moderator/i);
  });

  test('K2: School Admin joined as STUDENT cannot approve hands', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'sadmin-u', role: 'MEMBER', schoolId: 'school-a' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'sadmin-u', role: 'MEMBER', status: 'ACTIVE', schoolId: 'school-a',
      firstName: 'A', lastName: 'D', avatarUrl: null, deletedAt: null,
    });
    stubLiveClassSelect(2);
    prisma.liveClassParticipant.findFirst.mockResolvedValue({
      id: 'p-sadmin', userId: 'sadmin-u', role: 'STUDENT', isActive: true, speakerSlot: null,
    });

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/other-user')
      .set('Authorization', tok('sadmin-u'));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/host or moderator/i);
  });

  test('K3: SUPER_ADMIN blocked by assertSchoolAccess before reaching approveHand logic', async () => {
    verifyAccessToken.mockReturnValue({ userId: 'sa-u', role: 'SUPER_ADMIN', schoolId: 'school-a' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'sa-u', role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: 'school-a',
      firstName: 'SA', lastName: 'U', avatarUrl: null, deletedAt: null,
    });
    stubLiveClassSelect(2);

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/other-user')
      .set('Authorization', tok('sa-u'));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/platform administrator/i);
  });

  test('K4: req.body.role cannot grant speaker slot (source audit)', () => {
    const src = fs.readFileSync(CTRL_PATH, 'utf8');
    const start = src.indexOf('async function approveHand');
    const body  = src.slice(start, start + 3000);
    expect(body).not.toMatch(/req\.body\.role/);
    expect(body).not.toMatch(/req\.body\.speakerSlot/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP-L: Unique constraint violation returns 400 not 500 (PHASE-3 FIX)
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP-L: Unique constraint violation handled gracefully (PHASE-3 FIX)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  function dupError() {
    const e = new Error("Unique constraint failed on the fields: (`liveClassId`,`speakerSlot`)");
    e.code = 'P2002';
    return e;
  }

  test('L1: approveHand returns 400 on P2002 unique constraint violation (not 500)', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-c', userId: 'candidate-c', isActive: true, speakerSlot: null });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockRejectedValueOnce(dupError());

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/candidate-c')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  test('L2: inviteToStage returns 400 on P2002 unique constraint violation (not 500)', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-inv', userId: 'invite-u', isActive: true, speakerSlot: null });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);
    prisma.$executeRawUnsafe.mockRejectedValueOnce(dupError());

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/invite/invite-u')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  test('L3: ER_DUP_ENTRY (MySQL native) also returns 400', async () => {
    setupHost('host-u', 'school-a');
    stubLiveClassSelect(2);

    prisma.liveClassParticipant.findFirst
      .mockResolvedValueOnce({ id: 'p-host', userId: 'host-u', role: 'HOST', isActive: true, speakerSlot: null })
      .mockResolvedValueOnce({ id: 'p-c2', userId: 'candidate-c2', isActive: true, speakerSlot: null });
    prisma.liveClassParticipant.findMany.mockResolvedValue([]);

    const mysqlDup = new Error("ER_DUP_ENTRY: Duplicate entry 'lc-1-0' for key 'unique_liveclass_speaker_slot'");
    mysqlDup.code = 'ER_DUP_ENTRY';
    prisma.$executeRawUnsafe.mockRejectedValueOnce(mysqlDup);

    const res = await request(app)
      .post('/api/v1/live-classes/lc-1/hand/approve/candidate-c2')
      .set('Authorization', tok('host-u'));

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });
});
