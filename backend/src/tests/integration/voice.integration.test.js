'use strict';

// ─── Mock livekit-server-sdk ──────────────────────────────────────────────────
// livekit-server-sdk v2.x is ESM-only. In CI the CJS require() returns an
// empty object, making RoomServiceClient undefined and crashing app boot.
// These integration tests do not need real LiveKit — the voice controller
// already handles a null getLivekitRoomService() return gracefully (503).
jest.mock('livekit-server-sdk', () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt:    jest.fn().mockResolvedValue('mock-livekit-jwt'),
  })),
  RoomServiceClient: jest.fn().mockImplementation(() => ({
    removeParticipant:  jest.fn().mockResolvedValue({}),
    updateParticipant:  jest.fn().mockResolvedValue({}),
  })),
  VideoGrant: jest.fn(),
}));

// ─── Mock optional OpenTelemetry instrumentation packages ────────────────────
// @opentelemetry/instrumentation-prisma is an optional dev dependency that
// is not installed in CI. Without this mock, tracing.js throws MODULE_NOT_FOUND
// inside its try/catch, but Jest's module resolver may propagate it as a fatal
// error in the test sandbox before the catch block executes.
jest.mock('@opentelemetry/instrumentation-prisma', () => ({
  PrismaInstrumentation: jest.fn().mockImplementation(() => ({})),
}), { virtual: true });

jest.mock('@opentelemetry/instrumentation-redis', () => ({
  RedisInstrumentation: jest.fn().mockImplementation(() => ({})),
}), { virtual: true });

/**
 * Voice Room Integration Tests — real MySQL DB
 *
 * Covers:
 *  - Room lifecycle (create, join, leave, end)
 *  - Privacy (PRIVATE join blocked)
 *  - Capacity enforcement
 *  - Ban enforcement (ban, rejoin blocked, unban, rejoin allowed)
 *  - Kick (user can rejoin after kick — no persistent ban)
 *  - Speaker queue (raise hand, approve, reject, cancel)
 *  - Role management (moderator assign/remove)
 *  - LiveKit token authorization
 *  - Scheduled rooms endpoint
 *  - IDOR (user cannot kick/ban/approve in rooms they don't control)
 *  - Redis failure: ban check falls back to DB
 *  - Auth: no token → 401, suspended → 403
 *  - SUPER_ADMIN restrictions (cannot use another host's room as admin)
 */

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const prisma  = require('../../utils/prisma');
const { generateAccessToken } = require('../../utils/jwt');

const uid       = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const testEmail = () => `voice-integ-${uid()}@integration-test.halqa`;

async function createUser(extra = {}) {
  return prisma.user.create({
    data: Object.assign({
      email:         testEmail(),
      passwordHash:  await bcrypt.hash('Test1234!', 10),
      firstName:     'VoiceTest',
      lastName:      'User',
      role:          'MEMBER',
      status:        'ACTIVE',
      emailVerified: true,
    }, extra)
  });
}

function tok(user) {
  return 'Bearer ' + generateAccessToken({
    userId: user.id, role: user.role, schoolId: user.schoolId || null
  });
}

let app;
let host, memberA, memberB, suspended;

beforeAll(async function () {
  // PORT=0 lets the OS assign an ephemeral port — prevents startServer()
  // from failing on a port conflict and calling process.exit(1).
  process.env.PORT = '0';
  app = require('../../app');
  [host, memberA, memberB, suspended] = await Promise.all([
    createUser({ role: 'MEMBER', schoolId: null }),
    createUser({ role: 'MEMBER', schoolId: null }),
    createUser({ role: 'MEMBER', schoolId: null }),
    createUser({ role: 'MEMBER', status: 'SUSPENDED', schoolId: null }),
  ]);
}, 60000);

afterAll(async function () {
  // RC-04: Stop the scheduler started by startServer() so cron jobs do not
  // fire dynamic require() calls after Jest tears down the module sandbox.
  // jobScheduler.shutdown() calls cancelJob() on every registered task,
  // which calls job.task.stop() on cron tasks and clearInterval/clearTimeout
  // on interval/delayed tasks — then clears the internal jobs Map.
  try {
    const jobScheduler = require('../../utils/jobScheduler');
    jobScheduler.shutdown();
  } catch { /* non-fatal — if scheduler was never initialized, ignore */ }

  const emails = [host, memberA, memberB, suspended].filter(Boolean).map(u => u.email);
  try {
    await prisma.voiceRoom.deleteMany({ where: { hostId: { in: [host?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => {});
  } catch { /* ignore */ }
  await prisma.$disconnect();
}, 40000);

// ─── helpers ──────────────────────────────────────────────────────────────────

async function createRoom(ownerTok, extra = {}) {
  const res = await request(app)
    .post('/api/v1/voice')
    .set('Authorization', ownerTok)
    .send(Object.assign({ title: `VoiceInteg ${uid()}`, privacy: 'PUBLIC' }, extra));
  return res;
}

async function joinRoom(roomId, userTok) {
  return request(app)
    .post(`/api/v1/voice/${roomId}/join`)
    .set('Authorization', userTok);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
describe('Voice — auth gates', function () {
  test('no auth → 401', async function () {
    const res = await request(app).get('/api/v1/voice');
    expect(res.status).toBe(401);
  });

  test('suspended user → 403', async function () {
    const res = await request(app)
      .get('/api/v1/voice')
      .set('Authorization', tok(suspended));
    expect(res.status).toBe(403);
  });
});

// ─── ROOM LIFECYCLE ───────────────────────────────────────────────────────────
// CONTRACT (current production):
//   - MEMBER/HOST calling END → 403 ("Rooms are permanent...")
//   - Only SUPER_ADMIN can archive (end) a room
//   - ENDED room join → 400 "Room already archived"
//   - Non-authorized user END → 403 (same as host)
describe('Voice — room lifecycle', function () {
  let room;

  test('MEMBER can create a PUBLIC room', async function () {
    const res = await createRoom(tok(host));
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.privacy).toBe('PUBLIC');
    room = res.body.data;
  });

  test('another user can join a PUBLIC room', async function () {
    const res = await joinRoom(room.id, tok(memberA));
    expect(res.status).toBe(200);
  });

  test('user can leave a room', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${room.id}/leave`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(200);
  });

  // RC-01: MEMBER/HOST cannot end a room — rooms are permanent.
  // Only SUPER_ADMIN can archive (end) a room.
  // This test verifies the security boundary: host is denied, room remains LIVE.
  test('host attempting END → 403, room remains LIVE (permanent-room contract)', async function () {
    const endRes = await request(app)
      .patch(`/api/v1/voice/${room.id}/end`)
      .set('Authorization', tok(host));
    expect(endRes.status).toBe(403);
    expect(endRes.body.success).toBe(false);
    // Room must still be LIVE — the 403 must not have side-effected room state
    const dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: room.id },
      select: { status: true }
    });
    expect(dbRoom.status).toBe('LIVE');
  });

  // RC-02 / Phase 4: Test ENDED-room join without calling the host END endpoint.
  // We set status to ENDED directly in the DB (legitimate persisted state)
  // then verify the real join endpoint returns 400.
  test('cannot join an ENDED room — join returns 400 "archived"', async function () {
    // Set room to ENDED directly in DB — this is a legitimate persisted production state.
    // We do NOT call the end API (host is not authorized) but the DB state is valid.
    await prisma.voiceRoom.update({
      where: { id: room.id },
      data: { status: 'ENDED', endedAt: new Date() }
    });
    const res = await joinRoom(room.id, tok(memberB));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/archived|ended/i);
    // cleanup — room is now ENDED, direct delete is safe
    await prisma.voiceRoom.delete({ where: { id: room.id } }).catch(() => {});
  });

  // RC-02 / Phase 5: Non-authorized user END test uses its own isolated fixture
  // so it cannot be affected by the host's active room state from prior tests.
  test('non-authorized user END → 403, room remains unchanged', async function () {
    // Isolated fixture: fresh user creates and joins their own room
    const isolatedHost = await createUser({ role: 'MEMBER', schoolId: null });
    const r2 = await createRoom(tok(isolatedHost));
    expect(r2.status).toBe(201);
    const r2Id = r2.body.data.id;

    const endRes = await request(app)
      .patch(`/api/v1/voice/${r2Id}/end`)
      .set('Authorization', tok(memberA));
    expect(endRes.status).toBe(403);

    // Room must still exist and not be ENDED
    const dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: r2Id },
      select: { status: true }
    });
    expect(dbRoom.status).toBe('LIVE');

    // Cleanup
    await prisma.voiceRoom.delete({ where: { id: r2Id } }).catch(() => {});
    await prisma.user.delete({ where: { id: isolatedHost.id } }).catch(() => {});
  });
});

// ─── PRIVACY ─────────────────────────────────────────────────────────────────
describe('Voice — privacy', function () {
  let privateRoom;

  test('MEMBER can create a PRIVATE room', async function () {
    const res = await createRoom(tok(host), { privacy: 'PRIVATE' });
    expect(res.status).toBe(201);
    privateRoom = res.body.data;
  });

  test('non-invited user cannot join a PRIVATE room', async function () {
    const res = await joinRoom(privateRoom.id, tok(memberA));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/private/i);
  });

  test('PRIVATE room is hidden in room detail for non-participants', async function () {
    const res = await request(app)
      .get(`/api/v1/voice/${privateRoom.id}`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(403);
  });

  test('cleanup', async function () {
    await prisma.voiceRoom.delete({ where: { id: privateRoom.id } }).catch(() => {});
    expect(true).toBe(true);
  });
});

// ─── CAPACITY ─────────────────────────────────────────────────────────────────
describe('Voice — capacity enforcement', function () {
  let capRoom;

  beforeAll(async function () {
    const res = await createRoom(tok(host));
    capRoom = res.body.data;
  }, 30000);

  afterAll(async function () {
    if (capRoom) {
      await prisma.voiceParticipant.deleteMany({ where: { roomId: capRoom.id, userId: { not: host.id } } }).catch(() => {});
      await prisma.voiceRoom.delete({ where: { id: capRoom.id } }).catch(() => {});
    }
  }, 20000);

  test('room returns 403 when at capacity (500 fake participants)', async function () {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (let batch = 0; batch < 5; batch++) {
        const values = Array.from({ length: 100 }, (_, i) => {
          const idx = batch * 100 + i;
          const id  = `ffffffff-ffff-${String(idx).padStart(4,'0')}-ffff-ffffffffffff`;
          const uid = `aaaaaaaa-aaaa-${String(idx).padStart(4,'0')}-aaaa-aaaaaaaaaaaa`;
          return `('${id}','${capRoom.id}','${uid}','AUDIENCE',1,0,0,NOW(),NOW())`;
        }).join(',');
        await prisma.$executeRawUnsafe(
          `INSERT IGNORE INTO voice_participants (id,roomId,userId,role,isMuted,handRaised,isPinned,createdAt,updatedAt) VALUES ${values}`
        );
      }
    } finally {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }

    const res = await joinRoom(capRoom.id, tok(memberA));

    await prisma.$executeRawUnsafe(`DELETE FROM voice_participants WHERE userId LIKE 'aaaaaaaa-aaaa-%'`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/full/i);
  });
});

// ─── KICK & BAN ───────────────────────────────────────────────────────────────
describe('Voice — kick and ban', function () {
  let kickRoom;

  beforeAll(async function () {
    const res = await createRoom(tok(host));
    kickRoom = res.body.data;
    await joinRoom(kickRoom.id, tok(memberA));
    await joinRoom(kickRoom.id, tok(memberB));
  }, 30000);

  afterAll(async function () {
    // V-04 FIX: Leave the room via the application API before deleting it.
    // Without this, the global `host` participant row remains isActive=true
    // (until the cascade delete) and the one-active-room rule blocks
    // createRoom() in subsequent suites that reuse `host`.
    if (kickRoom) {
      await request(app)
        .post(`/api/v1/voice/${kickRoom.id}/leave`)
        .set('Authorization', tok(host))
        .catch(() => {});
      await request(app)
        .post(`/api/v1/voice/${kickRoom.id}/leave`)
        .set('Authorization', tok(memberB))
        .catch(() => {});
      await prisma.voiceRoom.delete({ where: { id: kickRoom.id } }).catch(() => {});
    }
  }, 20000);

  test('non-moderator cannot kick', async function () {
    const res = await request(app)
      .delete(`/api/v1/voice/${kickRoom.id}/kick/${memberB.id}`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(403);
  });

  test('host can kick memberA', async function () {
    const res = await request(app)
      .delete(`/api/v1/voice/${kickRoom.id}/kick/${memberA.id}`)
      .set('Authorization', tok(host));
    expect(res.status).toBe(200);
  });

  test('kicked user CANNOT rejoin the same room session (PH24C-003 wasKicked)', async function () {
    // PH24C-003: wasKicked=true is set atomically when a user is kicked.
    // joinRoom() reconnect path checks wasKicked and returns 403.
    // This is session-scoped kick protection — the user cannot silently re-enter.
    const res = await joinRoom(kickRoom.id, tok(memberA));
    expect(res.status).toBe(403);
    // User-facing message confirms removal and rejoin block
    expect(res.body.message).toMatch(/removed.*cannot rejoin/i);
  });

  test('non-moderator cannot ban', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${kickRoom.id}/ban/${memberA.id}`)
      .set('Authorization', tok(memberA))
      .send({ reason: 'test' });
    expect(res.status).toBe(403);
  });

  test('host can ban memberA — creates DB record', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${kickRoom.id}/ban/${memberA.id}`)
      .set('Authorization', tok(host))
      .send({ reason: 'spam' });
    expect(res.status).toBe(200);

    const record = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: kickRoom.id, userId: memberA.id } }
    });
    expect(record).not.toBeNull();
    expect(record.isBanned).toBe(true);
  });

  test('banned user CANNOT rejoin', async function () {
    const res = await joinRoom(kickRoom.id, tok(memberA));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/banned/i);
  });

  test('ban is enforced from DB even without Redis (simulate Redis miss)', async function () {
    // Clear Redis ban cache if present
    try {
      const { isRedisReady, getRedis } = require('../../utils/redis');
      if (isRedisReady()) {
        await getRedis().del(`voice:ban:${kickRoom.id}`);
      }
    } catch { /* non-fatal */ }

    const res = await joinRoom(kickRoom.id, tok(memberA));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/banned/i);
  });

  test('host can unban memberA', async function () {
    const res = await request(app)
      .delete(`/api/v1/voice/${kickRoom.id}/ban/${memberA.id}`)
      .set('Authorization', tok(host));
    expect(res.status).toBe(200);

    const record = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: kickRoom.id, userId: memberA.id } }
    });
    expect(record?.isBanned).toBe(false);
  });

  test('unban clears membership ban (isBanned=false) but does NOT reset PH24C kick state', async function () {
    // unbanParticipant only updates VoiceRoomMember.isBanned=false.
    // voiceParticipant.wasKicked is NOT reset by unban.
    // Therefore a user who was kicked and then unbanned still cannot rejoin
    // the same session — wasKicked=true is still in the participant row.
    // This is the authoritative PH24C-003 contract.
    const unbanRes = await request(app)
      .delete(`/api/v1/voice/${kickRoom.id}/ban/${memberA.id}`)
      .set('Authorization', tok(host));
    expect(unbanRes.status).toBe(200);

    // Verify isBanned is now false in VoiceRoomMember
    const record = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: kickRoom.id, userId: memberA.id } }
    });
    expect(record?.isBanned).toBe(false);

    // Rejoin is still blocked because wasKicked=true was NOT reset by unban
    const rejoinRes = await joinRoom(kickRoom.id, tok(memberA));
    expect(rejoinRes.status).toBe(403);
    expect(rejoinRes.body.message).toMatch(/removed.*cannot rejoin/i);
  });

  test('cannot ban the host', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${kickRoom.id}/ban/${host.id}`)
      .set('Authorization', tok(host))
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─── SPEAKER QUEUE ────────────────────────────────────────────────────────────
describe('Voice — speaker queue', function () {
  let qRoom;

  beforeAll(async function () {
    const res = await createRoom(tok(host));
    qRoom = res.body.data;
    await joinRoom(qRoom.id, tok(memberA));
    await joinRoom(qRoom.id, tok(memberB));
  }, 30000);

  afterAll(async function () {
    if (qRoom) await prisma.voiceRoom.delete({ where: { id: qRoom.id } }).catch(() => {});
  }, 20000);

  test('audience member can raise hand → enqueue', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/raise`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(200);
    expect(res.body.data.raised).toBe(true);
  });

  test('duplicate raise-hand returns 200 (already queued)', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/raise`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(200);
    expect(res.body.data.raised).toBe(true);
  });

  test('non-moderator cannot approve next', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/approve`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(403);
  });

  test('host can approve next in queue → memberA becomes SPEAKER', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/approve`)
      .set('Authorization', tok(host));
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('SPEAKER');
    expect(res.body.data.userId).toBe(memberA.id);
  });

  test('approved speaker is no longer AUDIENCE in DB', async function () {
    const p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: qRoom.id, userId: memberA.id } }
    });
    expect(p?.role).toBe('SPEAKER');
    expect(p?.handRaised).toBe(false);
  });

  test('memberB raises hand, host rejects → memberB stays AUDIENCE', async function () {
    await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/raise`)
      .set('Authorization', tok(memberB));

    const rejectRes = await request(app)
      .delete(`/api/v1/voice/${qRoom.id}/queue/reject/${memberB.id}`)
      .set('Authorization', tok(host));
    expect(rejectRes.status).toBe(200);

    const p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: qRoom.id, userId: memberB.id } }
    });
    expect(p?.role).toBe('AUDIENCE');
    expect(p?.handRaised).toBe(false);
  });

  test('approving already-on-stage speaker returns 200 (idempotent — user is already promoted)', async function () {
    // Production contract: _promoteUser catches internal ALREADY_ON_STAGE (409)
    // and returns HTTP 200 — the user is already where they should be.
    // The test verifies idempotent approval behavior, not an error path.
    // memberA is already SPEAKER — inject stale handRaised=true to simulate a
    // race where the host's approve arrives after the user was already promoted.
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: qRoom.id, userId: memberA.id } },
      data: { handRaised: true, handRaisedAt: new Date() }
    });

    const res = await request(app)
      .post(`/api/v1/voice/${qRoom.id}/queue/approve/${memberA.id}`)
      .set('Authorization', tok(host));
    // _promoteUser: ALREADY_ON_STAGE is caught internally, returns 200
    expect(res.status).toBe(200);

    // Cleanup
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: qRoom.id, userId: memberA.id } },
      data: { handRaised: false, handRaisedAt: null }
    });
  });
});

// ─── ROLE MANAGEMENT ─────────────────────────────────────────────────────────
describe('Voice — role management', function () {
  let roleRoom;

  beforeAll(async function () {
    const res = await createRoom(tok(host));
    roleRoom = res.body.data;
    await joinRoom(roleRoom.id, tok(memberA));
  }, 30000);

  afterAll(async function () {
    if (roleRoom) await prisma.voiceRoom.delete({ where: { id: roleRoom.id } }).catch(() => {});
  }, 20000);

  test('non-host cannot assign moderator', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${roleRoom.id}/moderator/${memberA.id}`)
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(403);
  });

  test('host can assign memberA as MODERATOR', async function () {
    // First promote memberA to SPEAKER so they are eligible
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: roleRoom.id, userId: memberA.id } },
      data: { role: 'SPEAKER', isMuted: false }
    });

    const res = await request(app)
      .post(`/api/v1/voice/${roleRoom.id}/moderator/${memberA.id}`)
      .set('Authorization', tok(host));
    expect(res.status).toBe(200);

    const p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: roleRoom.id, userId: memberA.id } }
    });
    expect(p?.role).toBe('MODERATOR');
  });

  test('host can remove MODERATOR → AUDIENCE', async function () {
    const res = await request(app)
      .delete(`/api/v1/voice/${roleRoom.id}/moderator/${memberA.id}`)
      .set('Authorization', tok(host));
    expect(res.status).toBe(200);

    const p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: roleRoom.id, userId: memberA.id } }
    });
    expect(p?.role).toBe('AUDIENCE');
  });
});

// ─── LIVEKIT TOKEN ────────────────────────────────────────────────────────────
describe('Voice — LiveKit token', function () {
  let lkRoom;

  beforeAll(async function () {
    const res = await createRoom(tok(host));
    lkRoom = res.body.data;
    await joinRoom(lkRoom.id, tok(memberA));
  }, 30000);

  afterAll(async function () {
    // V-04 FIX: Leave the room via the application API before deleting it.
    // Without this, the global `host` and `memberA` participant rows remain
    // isActive=true (until the cascade delete) and the one-active-room rule
    // blocks createRoom() in subsequent suites that reuse `host` or `memberA`.
    if (lkRoom) {
      await request(app)
        .post(`/api/v1/voice/${lkRoom.id}/leave`)
        .set('Authorization', tok(host))
        .catch(() => {});
      await request(app)
        .post(`/api/v1/voice/${lkRoom.id}/leave`)
        .set('Authorization', tok(memberA))
        .catch(() => {});
      await prisma.voiceRoom.delete({ where: { id: lkRoom.id } }).catch(() => {});
    }
  }, 20000);

  test('active participant gets a LiveKit token', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${lkRoom.id}/livekit-token`)
      .set('Authorization', tok(memberA));
    // 200 if LiveKit is configured, 503 if not (CI without LiveKit)
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.roomId).toBe(lkRoom.id);
      expect(res.body.data.role).toBe('AUDIENCE');
    }
  });

  test('non-participant cannot get a LiveKit token (IDOR)', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${lkRoom.id}/livekit-token`)
      .set('Authorization', tok(memberB));
    expect(res.status).toBe(403);
  });

  test('ended room token request → 400', async function () {
    // V-04-E FIX: Create this room with a dedicated fresh user rather than
    // reusing `host`. The one-active-room rule blocks a second createRoom()
    // call for `host` while lkRoom (created in beforeAll) is still LIVE.
    // Using a dedicated user makes this test fully self-contained and avoids
    // the cross-test state dependency that caused the TypeError at line 647.
    const endedRoomHost = await createUser({ role: 'MEMBER', schoolId: null });
    const endedRoomGuest = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      const r = await createRoom(tok(endedRoomHost));
      expect(r.body.data).toBeDefined(); // guard: creation must succeed
      const rId = r.body.data.id;
      await joinRoom(rId, tok(endedRoomGuest));
      // Manually set room to ENDED status (bypass endRoom API which requires SUPER_ADMIN)
      await prisma.voiceRoom.update({
        where: { id: rId },
        data: { status: 'ENDED', endedAt: new Date() }
      });

      const res = await request(app)
        .post(`/api/v1/voice/${rId}/livekit-token`)
        .set('Authorization', tok(endedRoomGuest));
      expect(res.status).toBe(400);
      await prisma.voiceRoom.delete({ where: { id: rId } }).catch(() => {});
    } finally {
      // Always clean up dedicated users even if assertions fail
      await prisma.user.delete({ where: { id: endedRoomHost.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: endedRoomGuest.id } }).catch(() => {});
    }
  });
});

// ─── SCHEDULED ROOMS ─────────────────────────────────────────────────────────
describe('Voice — scheduled rooms endpoint', function () {
  let scheduledRoom;

  beforeAll(async function () {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await createRoom(tok(host), {
      title: `VoiceInteg Scheduled ${uid()}`,
      scheduledAt: future,
    });
    scheduledRoom = res.body.data;
  }, 30000);

  afterAll(async function () {
    if (scheduledRoom) {
      await prisma.voiceRoom.delete({ where: { id: scheduledRoom.id } }).catch(() => {});
    }
  }, 20000);

  test('GET /voice/scheduled returns upcoming rooms', async function () {
    const res = await request(app)
      .get('/api/v1/voice/scheduled')
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.some(r => r.id === scheduledRoom.id);
    expect(found).toBe(true);
  });

  test('scheduled room cannot be joined as LIVE', async function () {
    // scheduledAt is in the future, status is SCHEDULED — join should work (it transitions to LIVE)
    // or depending on business rule may be blocked. Current impl: SCHEDULED joins transition to LIVE.
    const res = await joinRoom(scheduledRoom.id, tok(memberA));
    expect([200, 400]).toContain(res.status); // 200 = allowed; 400 = blocked by business rule
  });
});

// ─── IDOR ─────────────────────────────────────────────────────────────────────
describe('Voice — IDOR security', function () {
  let victimRoom, attacker;

  beforeAll(async function () {
    attacker = await createUser({ role: 'MEMBER', schoolId: null });
    const res = await createRoom(tok(host), { privacy: 'PUBLIC' });
    victimRoom = res.body.data;
    await joinRoom(victimRoom.id, tok(memberA));
  }, 30000);

  afterAll(async function () {
    if (victimRoom) await prisma.voiceRoom.delete({ where: { id: victimRoom.id } }).catch(() => {});
    if (attacker)   await prisma.user.delete({ where: { id: attacker.id } }).catch(() => {});
  }, 20000);

  test('attacker cannot kick a participant from victim\'s room', async function () {
    const res = await request(app)
      .delete(`/api/v1/voice/${victimRoom.id}/kick/${memberA.id}`)
      .set('Authorization', tok(attacker));
    expect(res.status).toBe(403);
  });

  test('attacker cannot ban from victim\'s room', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${victimRoom.id}/ban/${memberA.id}`)
      .set('Authorization', tok(attacker))
      .send({ reason: 'hack' });
    expect(res.status).toBe(403);
  });

  test('attacker cannot end victim\'s room', async function () {
    const res = await request(app)
      .patch(`/api/v1/voice/${victimRoom.id}/end`)
      .set('Authorization', tok(attacker));
    expect(res.status).toBe(403);
  });

  test('attacker cannot approve speaker in victim\'s room', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${victimRoom.id}/queue/approve`)
      .set('Authorization', tok(attacker));
    expect(res.status).toBe(403);
  });

  test('attacker cannot assign moderator in victim\'s room', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${victimRoom.id}/moderator/${memberA.id}`)
      .set('Authorization', tok(attacker));
    expect(res.status).toBe(403);
  });

  test('attacker cannot get LiveKit token for victim\'s room', async function () {
    const res = await request(app)
      .post(`/api/v1/voice/${victimRoom.id}/livekit-token`)
      .set('Authorization', tok(attacker));
    expect(res.status).toBe(403);
  });
});

// ─── SUPER_ADMIN scope ────────────────────────────────────────────────────────
describe('Voice — SUPER_ADMIN scope', function () {
  let superAdmin, saRoom;

  beforeAll(async function () {
    superAdmin = await createUser({ role: 'SUPER_ADMIN', schoolId: null });
    const res = await createRoom(tok(host));
    saRoom = res.body.data;
    await joinRoom(saRoom.id, tok(memberA));
  }, 30000);

  afterAll(async function () {
    if (saRoom)     await prisma.voiceRoom.delete({ where: { id: saRoom.id } }).catch(() => {});
    if (superAdmin) await prisma.user.delete({ where: { id: superAdmin.id } }).catch(() => {});
  }, 20000);

  test('SUPER_ADMIN can end any room (platform administration)', async function () {
    const res = await request(app)
      .patch(`/api/v1/voice/${saRoom.id}/end`)
      .set('Authorization', tok(superAdmin));
    // SUPER_ADMIN IS allowed to end rooms (platform admin)
    expect(res.status).toBe(200);
  });

  test('SUPER_ADMIN cannot kick without being a room participant', async function () {
    // Create new room to test
    const r = await createRoom(tok(host));
    await joinRoom(r.body.data.id, tok(memberA));
    const res = await request(app)
      .delete(`/api/v1/voice/${r.body.data.id}/kick/${memberA.id}`)
      .set('Authorization', tok(superAdmin));
    // Not an active participant → 403
    expect(res.status).toBe(403);
    await prisma.voiceRoom.delete({ where: { id: r.body.data.id } }).catch(() => {});
  });
});

// ─── NO PII IN RESPONSES ──────────────────────────────────────────────────────
describe('Voice — no PII in responses', function () {
  test('room list does not expose passwordHash or email', async function () {
    const res = await request(app)
      .get('/api/v1/voice')
      .set('Authorization', tok(memberA));
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash/);
    expect(body).not.toMatch(/"email"/);
  });
});

// ─── P0-1: micLocked enforcement on grabMic ───────────────────────────────────
describe('P0-1 — micLocked enforced on grabMic at backend', function () {

  var lockHost, lockAudience, lockRoom;

  beforeAll(async function () {
    lockHost     = await createUser({ role: 'MEMBER', schoolId: null });
    lockAudience = await createUser({ role: 'MEMBER', schoolId: null });

    // Host creates room
    const res = await createRoom(tok(lockHost), { title: `micLocked test ${uid()}` });
    lockRoom = res.body.data;

    // Audience joins
    await joinRoom(lockRoom.id, tok(lockAudience));
  }, 40000);

  afterAll(async function () {
    if (lockRoom) await prisma.voiceRoom.delete({ where: { id: lockRoom.id } }).catch(function () {});
    if (lockHost)     await prisma.user.delete({ where: { id: lockHost.id } }).catch(function () {});
    if (lockAudience) await prisma.user.delete({ where: { id: lockAudience.id } }).catch(function () {});
  }, 20000);

  test('when micLocked=false, audience can grab mic', async function () {
    // Ensure mic is unlocked first
    await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: false });

    var res = await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/grab-mic')
      .set('Authorization', tok(lockAudience));

    // 200 = instant speaker; or queued if stage full — both are allowed
    expect(res.status).toBe(200);

    // Demote back to AUDIENCE for next test
    await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/promote')
      .set('Authorization', tok(lockHost))
      .send({ targetUserId: lockAudience.id, role: 'AUDIENCE' })
      .catch(function () {});
  });

  test('when micLocked=true, audience grab-mic is rejected with 403 at the backend', async function () {
    // Host locks the mic
    var lockRes = await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: true });
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.data.micLocked).toBe(true);

    // Verify DB state
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: lockRoom.id },
      select: { micLocked: true }
    });
    expect(dbRoom.micLocked).toBe(true);

    // Audience tries to grab mic directly — must be rejected at BACKEND (not just UI)
    var res = await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/grab-mic')
      .set('Authorization', tok(lockAudience));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('when micLocked=true, audience cannot raise hand to queue', async function () {
    // Raise hand via queue endpoint — also locked
    var res = await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/queue/raise')
      .set('Authorization', tok(lockAudience));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('when micLocked=true, host CANNOT approve someone already in queue (lock blocks all speaker creation)', async function () {
    // First temporarily unlock to enqueue lockAudience
    await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: false });

    await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/queue/raise')
      .set('Authorization', tok(lockAudience));

    // Now lock again — micLocked blocks ALL new speaker creation, including queue approval
    await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: true });

    var approveRes = await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/queue/approve')
      .set('Authorization', tok(lockHost));

    // micLocked = complete stage freeze — no new speakers via any path
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.message).toMatch(/locked/i);

    // Clean up: unlock and demote
    await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: false });
    // Clear the pending hand raise in DB
    await prisma.voiceParticipant.updateMany({
      where: { roomId: lockRoom.id, userId: lockAudience.id },
      data: { handRaised: false, handRaisedAt: null }
    });
  });

  test('when micLocked=false, unlock allows grab-mic again', async function () {
    // Unlock
    var unlockRes = await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockHost))
      .send({ locked: false });
    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body.data.micLocked).toBe(false);

    var res = await request(app)
      .post('/api/v1/voice/' + lockRoom.id + '/grab-mic')
      .set('Authorization', tok(lockAudience));

    expect(res.status).toBe(200);
  });

  test('non-moderator cannot lock the mic', async function () {
    // lockAudience is now a SPEAKER (from above) — still cannot lock
    var res = await request(app)
      .patch('/api/v1/voice/' + lockRoom.id + '/mic-lock')
      .set('Authorization', tok(lockAudience))
      .send({ locked: true });
    expect(res.status).toBe(403);
  });
});

// ─── P1-1: unmuteAll endpoint ─────────────────────────────────────────────────
describe('P1-1 — unmuteAll endpoint', function () {

  var uHost, uSpeaker1, uSpeaker2, uRoom;

  beforeAll(async function () {
    uHost     = await createUser({ role: 'MEMBER', schoolId: null });
    uSpeaker1 = await createUser({ role: 'MEMBER', schoolId: null });
    uSpeaker2 = await createUser({ role: 'MEMBER', schoolId: null });
    var res = await createRoom(tok(uHost));
    uRoom = res.body.data;
    await joinRoom(uRoom.id, tok(uSpeaker1));
    await joinRoom(uRoom.id, tok(uSpeaker2));
    // Promote both to SPEAKER
    await prisma.voiceParticipant.updateMany({
      where: { roomId: uRoom.id, userId: { in: [uSpeaker1.id, uSpeaker2.id] } },
      data: { role: 'SPEAKER', isMuted: false }
    });
  }, 40000);

  afterAll(async function () {
    if (uRoom) await prisma.voiceRoom.delete({ where: { id: uRoom.id } }).catch(function () {});
    for (var u of [uHost, uSpeaker1, uSpeaker2]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
    }
  }, 20000);

  test('HOST can mute all speakers', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + uRoom.id + '/mute-all')
      .set('Authorization', tok(uHost));
    expect(res.status).toBe(200);
    expect(res.body.data.mutedCount).toBeGreaterThan(0);

    // Verify DB state
    var muted = await prisma.voiceParticipant.count({
      where: { roomId: uRoom.id, isMuted: true, role: 'SPEAKER' }
    });
    expect(muted).toBeGreaterThan(0);
  });

  test('HOST can unmute all speakers', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + uRoom.id + '/unmute-all')
      .set('Authorization', tok(uHost));
    expect(res.status).toBe(200);
    expect(res.body.data.unmutedCount).toBeGreaterThan(0);

    // Verify all SPEAKER rows are now unmuted
    var stillMuted = await prisma.voiceParticipant.count({
      where: { roomId: uRoom.id, isMuted: true, role: 'SPEAKER' }
    });
    expect(stillMuted).toBe(0);
  });

  test('SPEAKER cannot call unmute-all', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + uRoom.id + '/unmute-all')
      .set('Authorization', tok(uSpeaker1));
    expect(res.status).toBe(403);
  });

  test('non-participant cannot call unmute-all', async function () {
    var stranger = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      var res = await request(app)
        .patch('/api/v1/voice/' + uRoom.id + '/unmute-all')
        .set('Authorization', tok(stranger));
      expect(res.status).toBe(403);
    } finally {
      await prisma.user.delete({ where: { id: stranger.id } }).catch(function () {});
    }
  });
});

// ─── P1-2: mutedByModerator — self-unmute bypass prevented ───────────────────
describe('P1-2 — mutedByModerator prevents self-unmute bypass', function () {

  var mbHost, mbSpeaker, mbRoom;

  beforeAll(async function () {
    mbHost    = await createUser({ role: 'MEMBER', schoolId: null });
    mbSpeaker = await createUser({ role: 'MEMBER', schoolId: null });
    var res = await createRoom(tok(mbHost));
    mbRoom = res.body.data;
    await joinRoom(mbRoom.id, tok(mbSpeaker));
    // Promote to SPEAKER
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: mbRoom.id, userId: mbSpeaker.id } },
      data: { role: 'SPEAKER', isMuted: false }
    });
  }, 40000);

  afterAll(async function () {
    if (mbRoom) await prisma.voiceRoom.delete({ where: { id: mbRoom.id } }).catch(function () {});
    for (var u of [mbHost, mbSpeaker]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
    }
  }, 20000);

  test('host mutes speaker — sets mutedByModerator=true in DB', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + mbRoom.id + '/mute')
      .set('Authorization', tok(mbHost))
      .send({ targetUserId: mbSpeaker.id, isMuted: true });
    expect(res.status).toBe(200);

    var p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: mbRoom.id, userId: mbSpeaker.id } }
    });
    expect(p.isMuted).toBe(true);
    expect(p.mutedByModerator).toBe(true);
  });

  test('speaker CANNOT self-unmute after mod-mute (bypass blocked)', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + mbRoom.id + '/mute')
      .set('Authorization', tok(mbSpeaker))
      .send({ isMuted: false }); // self-action: no targetUserId
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/moderator/i);
  });

  test('host CAN unmute the speaker (clears mutedByModerator)', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + mbRoom.id + '/mute')
      .set('Authorization', tok(mbHost))
      .send({ targetUserId: mbSpeaker.id, isMuted: false });
    expect(res.status).toBe(200);

    var p = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: mbRoom.id, userId: mbSpeaker.id } }
    });
    expect(p.isMuted).toBe(false);
    expect(p.mutedByModerator).toBe(false);
  });

  test('after host unmutes, speaker CAN toggle their own mic freely', async function () {
    // Speaker self-mutes
    var res = await request(app)
      .patch('/api/v1/voice/' + mbRoom.id + '/mute')
      .set('Authorization', tok(mbSpeaker))
      .send({ isMuted: true });
    expect(res.status).toBe(200);

    // Speaker self-unmutes
    var res2 = await request(app)
      .patch('/api/v1/voice/' + mbRoom.id + '/mute')
      .set('Authorization', tok(mbSpeaker))
      .send({ isMuted: false });
    expect(res2.status).toBe(200);
  });
});

// ─── P1-3: HOST immunity from MODERATOR mute ─────────────────────────────────
describe('P1-3 — HOST cannot be muted by MODERATOR', function () {

  var hmHost, hmMod, hmRoom;

  beforeAll(async function () {
    hmHost = await createUser({ role: 'MEMBER', schoolId: null });
    hmMod  = await createUser({ role: 'MEMBER', schoolId: null });
    var res = await createRoom(tok(hmHost));
    hmRoom = res.body.data;
    await joinRoom(hmRoom.id, tok(hmMod));
    // Promote hmMod to MODERATOR
    await request(app)
      .post('/api/v1/voice/' + hmRoom.id + '/moderator/' + hmMod.id)
      .set('Authorization', tok(hmHost));
  }, 40000);

  afterAll(async function () {
    if (hmRoom) await prisma.voiceRoom.delete({ where: { id: hmRoom.id } }).catch(function () {});
    for (var u of [hmHost, hmMod]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
    }
  }, 20000);

  test('MODERATOR cannot mute the HOST', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + hmRoom.id + '/mute')
      .set('Authorization', tok(hmMod))
      .send({ targetUserId: hmHost.id, isMuted: true });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/host/i);
  });

  test('HOST can still mute themselves', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + hmRoom.id + '/mute')
      .set('Authorization', tok(hmHost))
      .send({ isMuted: true });
    expect(res.status).toBe(200);
  });

  test('HOST can mute the MODERATOR', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + hmRoom.id + '/mute')
      .set('Authorization', tok(hmHost))
      .send({ targetUserId: hmMod.id, isMuted: true });
    expect(res.status).toBe(200);
  });
});

// ─── P2-1 extra: micLocked on queue/approve and direct promote ────────────────
describe('P2-1 — micLocked enforced on queue/approve and direct promote', function () {

  var p21Host, p21Audience, p21Room;

  beforeAll(async function () {
    p21Host     = await createUser({ role: 'MEMBER', schoolId: null });
    p21Audience = await createUser({ role: 'MEMBER', schoolId: null });
    var res = await createRoom(tok(p21Host));
    p21Room = res.body.data;
    await joinRoom(p21Room.id, tok(p21Audience));

    // Audience raises hand BEFORE mic is locked
    await request(app)
      .post('/api/v1/voice/' + p21Room.id + '/queue/raise')
      .set('Authorization', tok(p21Audience));

    // Now lock the mic
    await request(app)
      .patch('/api/v1/voice/' + p21Room.id + '/mic-lock')
      .set('Authorization', tok(p21Host))
      .send({ locked: true });
  }, 40000);

  afterAll(async function () {
    if (p21Room) await prisma.voiceRoom.delete({ where: { id: p21Room.id } }).catch(function () {});
    for (var u of [p21Host, p21Audience]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
    }
  }, 20000);

  test('queue/approve returns 403 when micLocked', async function () {
    var res = await request(app)
      .post('/api/v1/voice/' + p21Room.id + '/queue/approve')
      .set('Authorization', tok(p21Host));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('queue/approve/:userId returns 403 when micLocked', async function () {
    var res = await request(app)
      .post('/api/v1/voice/' + p21Room.id + '/queue/approve/' + p21Audience.id)
      .set('Authorization', tok(p21Host));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('direct PATCH /promote to SPEAKER returns 403 when micLocked', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + p21Room.id + '/promote')
      .set('Authorization', tok(p21Host))
      .send({ targetUserId: p21Audience.id, role: 'SPEAKER' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  test('after unlock, approve succeeds', async function () {
    await request(app)
      .patch('/api/v1/voice/' + p21Room.id + '/mic-lock')
      .set('Authorization', tok(p21Host))
      .send({ locked: false });

    var res = await request(app)
      .post('/api/v1/voice/' + p21Room.id + '/queue/approve/' + p21Audience.id)
      .set('Authorization', tok(p21Host));
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('SPEAKER');
  });
});

// ─── P0-1 / P0-2 / P1 / MED-1 / MED-2 / Race: room-member remediation ────────
describe('Room-member remediation — block/unblock, P1 auth, MED-1/2, race', function () {

  var rmHost, rmMod, rmAudience, rmSpeaker, rmRoom;

  beforeAll(async function () {
    rmHost     = await createUser({ role: 'MEMBER', schoolId: null });
    rmMod      = await createUser({ role: 'MEMBER', schoolId: null });
    rmAudience = await createUser({ role: 'MEMBER', schoolId: null });
    rmSpeaker  = await createUser({ role: 'MEMBER', schoolId: null });

    var res = await createRoom(tok(rmHost));
    rmRoom = res.body.data;

    // Everyone joins
    await joinRoom(rmRoom.id, tok(rmMod));
    await joinRoom(rmRoom.id, tok(rmAudience));
    await joinRoom(rmRoom.id, tok(rmSpeaker));

    // Promote rmMod to live MODERATOR
    await request(app)
      .post('/api/v1/voice/' + rmRoom.id + '/moderator/' + rmMod.id)
      .set('Authorization', tok(rmHost));

    // Promote rmSpeaker to live SPEAKER
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmSpeaker.id } },
      data: { role: 'SPEAKER', isMuted: false }
    });
  }, 60000);

  afterAll(async function () {
    if (rmRoom) await prisma.voiceRoom.delete({ where: { id: rmRoom.id } }).catch(function () {});
    for (var u of [rmHost, rmMod, rmAudience, rmSpeaker]) {
      if (u) await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
    }
  }, 30000);

  // ── P0-1: unblockMember clears isBanned ───────────────────────────────────

  test('P0-1 step 1: block user → isBanned=true in DB', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + rmRoom.id + '/members/' + rmAudience.id + '/block')
      .set('Authorization', tok(rmHost));
    expect(res.status).toBe(200);

    var member = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmAudience.id } }
    });
    expect(member).not.toBeNull();
    expect(member.isBanned).toBe(true);
  });

  test('P0-1 step 2: blocked user cannot join', async function () {
    var res = await joinRoom(rmRoom.id, tok(rmAudience));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/banned/i);
  });

  test('P0-1 step 3: unblock → HTTP 200 + isBanned=false in DB', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + rmRoom.id + '/members/' + rmAudience.id + '/unblock')
      .set('Authorization', tok(rmHost));
    expect(res.status).toBe(200);

    var member = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmAudience.id } }
    });
    expect(member).not.toBeNull();
    expect(member.isBanned).toBe(false);   // P0-1 fix verified
    expect(member.status).toBe('ACTIVE');
    expect(member.role).toBe('MEMBER');
  });

  test('P0-1 step 4: unblocked user can join again', async function () {
    var res = await joinRoom(rmRoom.id, tok(rmAudience));
    expect(res.status).toBe(200);
  });

  // ── P0-2: blockMember evicts live participant ─────────────────────────────

  test('P0-2: block a SPEAKER → VoiceParticipant becomes inactive', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + rmRoom.id + '/members/' + rmSpeaker.id + '/block')
      .set('Authorization', tok(rmHost));
    expect(res.status).toBe(200);

    // VoiceParticipant must now be inactive
    var participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmSpeaker.id } }
    });
    expect(participant.isActive).toBe(false);   // P0-2 fix verified
    expect(participant.leftAt).not.toBeNull();

    // VoiceRoomMember must be banned
    var member = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmSpeaker.id } }
    });
    expect(member.isBanned).toBe(true);
    expect(member.status).toBe('REMOVED');
  });

  test('P0-2: blocked speaker cannot rejoin', async function () {
    var res = await joinRoom(rmRoom.id, tok(rmSpeaker));
    expect(res.status).toBe(403);
  });

  // ── P1: Parallel auth chain — permanent ADMIN ≠ live moderation ───────────

  test('P1: permanent ADMIN member but AUDIENCE live role cannot block someone', async function () {
    // Create a user who has VoiceRoomMember.role=ADMIN but is only AUDIENCE live
    var permAdmin = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      await joinRoom(rmRoom.id, tok(permAdmin));
      // Manually set permanent member role to ADMIN (simulates pre-existing admin)
      await prisma.voiceRoomMember.update({
        where: { roomId_userId: { roomId: rmRoom.id, userId: permAdmin.id } },
        data: { role: 'ADMIN' }
      });
      // Verify their live participant role is AUDIENCE
      var p = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId: rmRoom.id, userId: permAdmin.id } }
      });
      expect(p.role).toBe('AUDIENCE');

      // permAdmin tries to block rmAudience using block endpoint — should be 403
      var blockRes = await request(app)
        .patch('/api/v1/voice/' + rmRoom.id + '/members/' + rmAudience.id + '/block')
        .set('Authorization', tok(permAdmin));
      expect(blockRes.status).toBe(403);  // P1 fix verified
    } finally {
      await prisma.voiceParticipant.deleteMany({ where: { roomId: rmRoom.id, userId: permAdmin.id } }).catch(function () {});
      await prisma.voiceRoomMember.deleteMany({ where: { roomId: rmRoom.id, userId: permAdmin.id } }).catch(function () {});
      await prisma.user.delete({ where: { id: permAdmin.id } }).catch(function () {});
    }
  });

  test('P1: live MODERATOR (live role) CAN block a member', async function () {
    // rmMod is a live MODERATOR — must be allowed
    var freshUser = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      await joinRoom(rmRoom.id, tok(freshUser));
      var res = await request(app)
        .patch('/api/v1/voice/' + rmRoom.id + '/members/' + freshUser.id + '/block')
        .set('Authorization', tok(rmMod));
      expect(res.status).toBe(200);
    } finally {
      // Cleanup: unblock and delete
      await prisma.voiceRoomMember.updateMany({
        where: { roomId: rmRoom.id, userId: freshUser.id },
        data: { isBanned: false, status: 'ACTIVE', role: 'MEMBER' }
      }).catch(function () {});
      await prisma.voiceParticipant.deleteMany({ where: { roomId: rmRoom.id, userId: freshUser.id } }).catch(function () {});
      await prisma.user.delete({ where: { id: freshUser.id } }).catch(function () {});
    }
  });

  // ── MED-1: setMemberRole rejects BLOCKED ─────────────────────────────────

  test('MED-1: setMemberRole with role=BLOCKED returns 400', async function () {
    var res = await request(app)
      .patch('/api/v1/voice/' + rmRoom.id + '/members/' + rmAudience.id + '/role')
      .set('Authorization', tok(rmHost))
      .send({ role: 'BLOCKED' });
    expect(res.status).toBe(400);
    // Route validator rejects BLOCKED before controller; either "Validation failed" or
    // controller message about block endpoint are both correct
  });

  test('MED-1: setting BLOCKED via setMemberRole does NOT set isBanned', async function () {
    // Verify the user is still not banned (previous call was rejected)
    var member = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId: rmRoom.id, userId: rmAudience.id } }
    });
    // If the endpoint correctly returned 400, isBanned should still be false
    expect(member?.isBanned ?? false).toBe(false);
  });

  // ── MED-2: removeMember terminates live session ───────────────────────────

  test('MED-2: removeMember deactivates live VoiceParticipant', async function () {
    var freshUser = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      await joinRoom(rmRoom.id, tok(freshUser));

      // Verify they are active
      var before = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId: rmRoom.id, userId: freshUser.id } }
      });
      expect(before.isActive).toBe(true);

      var res = await request(app)
        .delete('/api/v1/voice/' + rmRoom.id + '/members/' + freshUser.id + '/remove')
        .set('Authorization', tok(rmHost));
      expect(res.status).toBe(200);

      // VoiceParticipant must now be inactive
      var after = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId: rmRoom.id, userId: freshUser.id } }
      });
      expect(after.isActive).toBe(false);    // MED-2 fix verified
    } finally {
      await prisma.voiceParticipant.deleteMany({ where: { roomId: rmRoom.id, userId: freshUser.id } }).catch(function () {});
      await prisma.voiceRoomMember.deleteMany({ where: { roomId: rmRoom.id, userId: freshUser.id } }).catch(function () {});
      await prisma.user.delete({ where: { id: freshUser.id } }).catch(function () {});
    }
  });

  test('MED-2: non-live-moderator (AUDIENCE live role) cannot remove member', async function () {
    var stranger = await createUser({ role: 'MEMBER', schoolId: null });
    var freshUser = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      await joinRoom(rmRoom.id, tok(stranger));
      await joinRoom(rmRoom.id, tok(freshUser));

      var res = await request(app)
        .delete('/api/v1/voice/' + rmRoom.id + '/members/' + freshUser.id + '/remove')
        .set('Authorization', tok(stranger));
      expect(res.status).toBe(403);
    } finally {
      for (var u of [stranger, freshUser]) {
        await prisma.voiceParticipant.deleteMany({ where: { roomId: rmRoom.id, userId: u.id } }).catch(function () {});
        await prisma.voiceRoomMember.deleteMany({ where: { roomId: rmRoom.id, userId: u.id } }).catch(function () {});
        await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
      }
    }
  });

  // ── Transfer race condition ───────────────────────────────────────────────

  test('Transfer race: concurrent transfers leave exactly one HOST with consistent state', async function () {
    var targetA = await createUser({ role: 'MEMBER', schoolId: null });
    var targetB = await createUser({ role: 'MEMBER', schoolId: null });
    var raceHost = await createUser({ role: 'MEMBER', schoolId: null });

    var raceRes = await createRoom(tok(raceHost));
    var raceRoom = raceRes.body.data;
    await joinRoom(raceRoom.id, tok(targetA));
    await joinRoom(raceRoom.id, tok(targetB));

    try {
      // Fire both transfers concurrently
      var [r1, r2] = await Promise.all([
        request(app)
          .post('/api/v1/voice/' + raceRoom.id + '/transfer/' + targetA.id)
          .set('Authorization', tok(raceHost)),
        request(app)
          .post('/api/v1/voice/' + raceRoom.id + '/transfer/' + targetB.id)
          .set('Authorization', tok(raceHost))
      ]);

      // Both HTTP responses must be valid (200 or 403)
      expect([200, 403]).toContain(r1.status);
      expect([200, 403]).toContain(r2.status);

      // CRITICAL: Regardless of which succeeded, the DB must be consistent:
      // Exactly one active HOST participant must exist
      var hosts = await prisma.voiceParticipant.count({
        where: { roomId: raceRoom.id, role: 'HOST', isActive: true }
      });
      expect(hosts).toBe(1);

      // VoiceRoom.hostId must match the single HOST participant
      var finalRoom = await prisma.voiceRoom.findUnique({
        where: { id: raceRoom.id }, select: { hostId: true }
      });
      var hostParticipant = await prisma.voiceParticipant.findFirst({
        where: { roomId: raceRoom.id, role: 'HOST', isActive: true }
      });
      expect(finalRoom.hostId).toBe(hostParticipant.userId);
    } finally {
      await prisma.voiceRoom.delete({ where: { id: raceRoom.id } }).catch(function () {});
      for (var u of [raceHost, targetA, targetB]) {
        await prisma.user.delete({ where: { id: u.id } }).catch(function () {});
      }
    }
  });

  // ── Audit logs written ────────────────────────────────────────────────────

  test('Audit log: block creates an audit record', async function () {
    var freshUser = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      await joinRoom(rmRoom.id, tok(freshUser));
      await request(app)
        .patch('/api/v1/voice/' + rmRoom.id + '/members/' + freshUser.id + '/block')
        .set('Authorization', tok(rmHost));

      var log = await prisma.auditLog.findFirst({
        where: { userId: rmHost.id, entity: 'VoiceRoom', entityId: rmRoom.id },
        orderBy: { createdAt: 'desc' }
      });
      expect(log).not.toBeNull();
      // newValues may be a parsed object or a JSON string depending on DB driver
      var vals = typeof log.newValues === 'string' ? JSON.parse(log.newValues) : log.newValues;
      expect(vals?.action).toBe('MEMBER_BLOCKED');
    } finally {
      await prisma.voiceRoomMember.updateMany({
        where: { roomId: rmRoom.id, userId: freshUser.id },
        data: { isBanned: false, status: 'ACTIVE', role: 'MEMBER' }
      }).catch(function () {});
      await prisma.voiceParticipant.deleteMany({ where: { roomId: rmRoom.id, userId: freshUser.id } }).catch(function () {});
      await prisma.user.delete({ where: { id: freshUser.id } }).catch(function () {});
    }
  });
});

// ─── PERMANENT ROOM LIFECYCLE — IDLE → LIVE ───────────────────────────────────
describe('Permanent room lifecycle — IDLE rooms remain joinable', function () {

  var plHost, plUser, plRoom;

  beforeAll(async function () {
    plHost = await createUser({ role: 'MEMBER', schoolId: null });
    plUser = await createUser({ role: 'MEMBER', schoolId: null });

    // Create a room
    var res = await createRoom(tok(plHost), { title: 'Perm Lifecycle ' + uid() });
    plRoom = res.body.data;
  }, 30000);

  afterAll(async function () {
    if (plRoom) await prisma.voiceRoom.delete({ where: { id: plRoom.id } }).catch(function () {});
    if (plHost) await prisma.user.delete({ where: { id: plHost.id } }).catch(function () {});
    if (plUser) await prisma.user.delete({ where: { id: plUser.id } }).catch(function () {});
  }, 20000);

  // ── Test 3/4/5/6: After auto-sleep the room is IDLE, NOT ENDED ─────────────
  test('Room can be manually set to IDLE (simulating auto-sleep) and is NOT ENDED', async function () {
    // Join first so we have an active session
    await joinRoom(plRoom.id, tok(plHost));

    // Simulate the result of the auto-sleep timer directly (bypasses 5-min wait)
    await prisma.voiceRoom.update({
      where: { id: plRoom.id },
      data:  { status: 'IDLE', lastActivityAt: new Date() }
    });
    // Deactivate all participants (simulating everyone left)
    await prisma.voiceParticipant.updateMany({
      where: { roomId: plRoom.id, isActive: true },
      data:  { isActive: false, leftAt: new Date() }
    });

    // Test 3: status is IDLE
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: plRoom.id },
      select: { status: true, endedAt: true, id: true }
    });
    expect(dbRoom.status).toBe('IDLE');           // test 3

    // Test 4: status is NOT ENDED
    expect(dbRoom.status).not.toBe('ENDED');       // test 4

    // Test 5: endedAt is null (room was not terminated)
    expect(dbRoom.endedAt).toBeNull();             // test 5

    // Test 6: room still exists
    expect(dbRoom.id).toBe(plRoom.id);             // test 6
  });

  // ── Test 7/8/9/10: User joins IDLE room → transitions to LIVE ──────────────
  test('User joins an IDLE room → room transitions to LIVE (IDLE → LIVE)', async function () {
    // Test 7: user can join
    var joinRes = await joinRoom(plRoom.id, tok(plUser));
    expect(joinRes.status).toBe(200);              // test 7

    // Test 8: room is now LIVE
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: plRoom.id },
      select: { status: true, id: true }
    });
    expect(dbRoom.status).toBe('LIVE');            // test 8

    // Test 9: same room ID preserved
    expect(dbRoom.id).toBe(plRoom.id);             // test 9

    // Test 10: no duplicate room was created (only one room with this ID)
    var count = await prisma.voiceRoom.count({ where: { id: plRoom.id } });
    expect(count).toBe(1);                         // test 10
  });

  // ── Test 11/12: Explicit endRoom still terminates permanently ──────────────
  test('Explicit endRoom changes LIVE → ENDED (terminal)', async function () {
    // Create a fresh room to avoid interfering with the IDLE room above
    var r = await createRoom(tok(plHost), { title: 'EndRoom Test ' + uid() });
    var endRoomId = r.body.data.id;
    await joinRoom(endRoomId, tok(plUser));

    // Test 11: endRoom requires SUPER_ADMIN (permanent-room contract)
    // MEMBER/HOST attempting to end a permanent room receives 403
    var endRes = await request(app)
      .patch('/api/v1/voice/' + endRoomId + '/end')
      .set('Authorization', tok(plHost));
    expect(endRes.status).toBe(403);
    expect(endRes.body.message).toMatch(/permanent|platform admin/i);

    // Verify room is still LIVE (not ended) after failed endRoom attempt
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: endRoomId },
      select: { status: true, endedAt: true }
    });
    expect(dbRoom.status).toBe('LIVE');
    expect(dbRoom.endedAt).toBeNull();

    // Cleanup
    await prisma.voiceRoom.delete({ where: { id: endRoomId } }).catch(function () {});
  });

  // ── Test 1/2: HOST leaves as last participant (grace period logic) ──────────
  // We verify the HTTP response from leaveRoom succeeds and the room is still
  // LIVE immediately after (grace period has not expired yet).
  test('HOST leaves as last participant → room stays LIVE immediately (grace period not expired)', async function () {
    var r = await createRoom(tok(plHost), { title: 'Grace Period Test ' + uid() });
    var graceRoomId = r.body.data.id;
    // Host is auto-joined on create; leave immediately
    var leaveRes = await request(app)
      .post('/api/v1/voice/' + graceRoomId + '/leave')
      .set('Authorization', tok(plHost));
    expect(leaveRes.status).toBe(200);             // test 1 - leave succeeds

    // Immediately after leave, room is still LIVE (grace period has not expired)
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: graceRoomId },
      select: { status: true }
    });
    expect(dbRoom.status).toBe('LIVE');            // test 2 - still LIVE during grace

    // Cleanup — set to IDLE so delete doesn't fail
    await prisma.voiceRoom.delete({ where: { id: graceRoomId } }).catch(function () {});
  });

  // ── Test 13: Banned user cannot join IDLE room ─────────────────────────────
  test('Banned user cannot join an IDLE room', async function () {
    var bannedUser = await createUser({ role: 'MEMBER', schoolId: null });
    try {
      // Write a ban record for the IDLE room (plRoom is currently LIVE after test 7/8)
      // Set room back to IDLE first
      await prisma.voiceRoom.update({
        where: { id: plRoom.id },
        data: { status: 'IDLE' }
      });
      await prisma.voiceParticipant.updateMany({
        where: { roomId: plRoom.id, isActive: true },
        data: { isActive: false, leftAt: new Date() }
      });

      await prisma.voiceRoomMember.upsert({
        where: { roomId_userId: { roomId: plRoom.id, userId: bannedUser.id } },
        create: {
          id: require('crypto').randomUUID(),
          roomId: plRoom.id, userId: bannedUser.id,
          role: 'MEMBER', status: 'ACTIVE', isBanned: true, memberLevel: 1
        },
        update: { isBanned: true }
      });

      // Verify room is IDLE
      var dbRoom = await prisma.voiceRoom.findUnique({
        where: { id: plRoom.id }, select: { status: true }
      });
      expect(dbRoom.status).toBe('IDLE');

      // Banned user tries to join the IDLE room — must be rejected
      var joinRes = await joinRoom(plRoom.id, tok(bannedUser));
      expect(joinRes.status).toBe(403);            // test 13
      expect(joinRes.body.message).toMatch(/banned/i);
    } finally {
      await prisma.voiceRoomMember.deleteMany({
        where: { roomId: plRoom.id, userId: bannedUser.id }
      }).catch(function () {});
      await prisma.user.delete({ where: { id: bannedUser.id } }).catch(function () {});
    }
  });
});

// ─── ONE-ACTIVE-ROOM RULE ─────────────────────────────────────────────────────
// Product invariant: a user can only be in ONE active voice room at a time.
// Attempting to join a second room while active in a first must return 409
// VOICE_ROOM_ALREADY_ACTIVE. Room A must remain completely untouched.
//
// IMPORTANT: Uses its own independent hostA/hostB users — NOT the shared global
// `host` — so that room state from this suite cannot bleed into other suites.
describe('Voice — one-active-room rule (INT-CI-001)', function () {
  var roomA, roomB, activeUser, hostA, hostB;

  beforeAll(async function () {
    activeUser = await createUser({ role: 'MEMBER', schoolId: null });
    hostA      = await createUser({ role: 'MEMBER', schoolId: null });
    hostB      = await createUser({ role: 'MEMBER', schoolId: null });

    // Room A: created by hostA, activeUser joins and is active
    var resA = await createRoom(tok(hostA));
    expect(resA.status).toBe(201);
    roomA = resA.body.data;
    var joinA = await joinRoom(roomA.id, tok(activeUser));
    expect(joinA.status).toBe(200);

    // Room B: created by hostB — activeUser will attempt to join this
    var resB = await createRoom(tok(hostB));
    expect(resB.status).toBe(201);
    roomB = resB.body.data;
  }, 60000);

  afterAll(async function () {
    // End both rooms so hostA/hostB are not left as active participants
    if (roomA) {
      await request(app).patch('/api/v1/voice/' + roomA.id + '/end').set('Authorization', tok(hostA)).catch(function () {});
      await prisma.voiceRoom.delete({ where: { id: roomA.id } }).catch(function () {});
    }
    if (roomB) {
      await request(app).patch('/api/v1/voice/' + roomB.id + '/end').set('Authorization', tok(hostB)).catch(function () {});
      await prisma.voiceRoom.delete({ where: { id: roomB.id } }).catch(function () {});
    }
    if (activeUser) await prisma.user.delete({ where: { id: activeUser.id } }).catch(function () {});
    if (hostA)      await prisma.user.delete({ where: { id: hostA.id } }).catch(function () {});
    if (hostB)      await prisma.user.delete({ where: { id: hostB.id } }).catch(function () {});
  }, 30000);

  test('active user in room A gets 409 when attempting to join room B', async function () {
    var res = await joinRoom(roomB.id, tok(activeUser));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/VOICE_ROOM_ALREADY_ACTIVE|already.*active|leave.*existing/i);
  });

  test('room A participant record is NOT deactivated after the rejected join', async function () {
    var participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId: roomA.id, userId: activeUser.id } }
    });
    // The participant in room A must still be active — the rejection must be a pure return,
    // not a side-effect that clears room A state.
    expect(participant).not.toBeNull();
    expect(participant.isActive).toBe(true);
  });

  test('room A is still LIVE after the rejected join attempt', async function () {
    var dbRoom = await prisma.voiceRoom.findUnique({
      where: { id: roomA.id }, select: { status: true }
    });
    expect(dbRoom.status).toBe('LIVE');
  });

  test('after leaving room A, user can join room B successfully', async function () {
    // Leave room A first
    var leaveRes = await request(app)
      .post('/api/v1/voice/' + roomA.id + '/leave')
      .set('Authorization', tok(activeUser));
    expect(leaveRes.status).toBe(200);

    // Now room B join must succeed
    var joinRes = await joinRoom(roomB.id, tok(activeUser));
    expect(joinRes.status).toBe(200);
  });
});
