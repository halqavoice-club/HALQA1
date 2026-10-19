'use strict';
/**
 * DEF-005 Integration Tests — Voice Club Individual Moderator Mute (REAL DB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses REAL MySQL. No Prisma mocks. No manual setup required.
 *
 * The test suite:
 *   1. Creates a voice room (HOST = SCHOOL_ADMIN / admin@halqa-academy.com)
 *   2. Joins a MODERATOR (TEACHER / teacher@halqa-academy.com) and promotes them
 *   3. Joins a SPEAKER   (STUDENT / student1@halqa.com) and promotes them
 *   4. Runs all 6 DEF-005 assertions
 *   5. Cleans up all created DB rows in afterAll
 *
 * Seed identities (from backend/src/prisma/seed.js):
 *   HOST      admin@halqa-academy.com   role=SCHOOL_ADMIN
 *   MODERATOR teacher@halqa-academy.com role=TEACHER
 *   SPEAKER   student1@halqa.com        role=STUDENT
 *
 * Actual IDs from local DB (queried 2026-10-19):
 *   HOST_ID      c6924c89-0fbf-409b-a995-36d75a208654  (admin@halqa-academy.com)
 *   MOD_ID       ee4cdadd-a17d-4bb2-98a2-de53344842bb  (teacher@halqa-academy.com)
 *   SPEAKER_ID   7ceab69a-7214-4547-bb68-10ca4faf3492  (student1@halqa.com)
 *
 * IMPORTANT: These tests exercise the real mute endpoint, DB, and socket
 * emission path. They do NOT exercise the LiveKit SFU — sfuRevokePublish()
 * calls a real LiveKit server which is not expected to be running locally.
 * The sfuEnforced flag will be false in dev (no LiveKit), which is correct
 * behavior and is explicitly asserted.
 */

// ─── NO PRISMA MOCK ───────────────────────────────────────────────────────────
const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { generateAccessToken } = require('../utils/jwt');

// ─── Seed identities ──────────────────────────────────────────────────────────
const HOST_ID      = 'c6924c89-0fbf-409b-a995-36d75a208654'; // admin@halqa-academy.com
const MOD_ID       = 'ee4cdadd-a17d-4bb2-98a2-de53344842bb'; // teacher@halqa-academy.com
const SPEAKER_ID   = '7ceab69a-7214-4547-bb68-10ca4faf3492'; // student1@halqa.com
const OUTSIDER_ID  = '01145c64-1f48-489c-b800-5246be6a216e'; // no-school user — not in room

// ─── JWT tokens (bypass login endpoint entirely) ──────────────────────────────
const HOST_TOKEN     = 'Bearer ' + generateAccessToken({ userId: HOST_ID,     role: 'SCHOOL_ADMIN' });
const MOD_TOKEN      = 'Bearer ' + generateAccessToken({ userId: MOD_ID,      role: 'TEACHER'      });
const SPEAKER_TOKEN  = 'Bearer ' + generateAccessToken({ userId: SPEAKER_ID,  role: 'STUDENT'      });
const OUTSIDER_TOKEN = 'Bearer ' + generateAccessToken({ userId: OUTSIDER_ID, role: 'MEMBER'       });

// ─── App builder (real routes, no Socket.IO server) ───────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const ipAllowlist = require('../middleware/ipAllowlist');
  app.use(ipAllowlist);
  app.use('/api/v1/voice', require('../routes/voice.routes'));
  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      success: false, message: err.message
    });
  });
  return app;
}

// ─── State shared across tests ────────────────────────────────────────────────
let app;
let roomId;

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function joinRoom(token) {
  const res = await request(app)
    .post(`/api/v1/voice/${roomId}/join`)
    .set('Authorization', token);
  return res;
}

async function promoteToRole(token, targetUserId, role) {
  // Directly update the participant record — bypasses the seat/queue
  // machinery that requires a real LiveKit token grant. We only need the
  // role and isMuted values for the mute authorization tests.
  await prisma.voiceParticipant.update({
    where: { roomId_userId: { roomId, userId: targetUserId } },
    data: { role, isMuted: false, isActive: true }
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
beforeAll(async () => {
  app = buildApp();

  // 0. Clean up stale state from previous test runs.
  //    The one-room-per-user rule fires on active VoiceParticipant records,
  //    not room status — so we must deactivate participants AND end rooms.
  const staleRooms = await prisma.voiceRoom.findMany({
    where:  { hostId: HOST_ID, status: 'LIVE' },
    select: { id: true }
  });
  for (const r of staleRooms) {
    await prisma.voiceParticipant.updateMany({
      where: { roomId: r.id, isActive: true },
      data:  { isActive: false, leftAt: new Date() }
    });
    await prisma.voiceRoom.update({
      where: { id: r.id },
      data:  { status: 'ENDED', endedAt: new Date() }
    });
  }
  // Also deactivate any lingering active participants for test users across all rooms
  for (const uid of [HOST_ID, MOD_ID, SPEAKER_ID]) {
    await prisma.voiceParticipant.updateMany({
      where: { userId: uid, isActive: true },
      data:  { isActive: false, leftAt: new Date() }
    });
  }

  // 1. Create a voice room as HOST
  const createRes = await request(app)
    .post('/api/v1/voice')
    .set('Authorization', HOST_TOKEN)
    .send({
      title: 'DEF-005 Integration Test Room',
      privacy: 'PUBLIC',
      maxSpeakers: 6,
    });

  expect(createRes.status).toBe(201);
  roomId = createRes.body.data?.id ?? createRes.body.data?.room?.id;
  expect(roomId).toBeTruthy();

  // 2. Join moderator and speaker
  const modJoin = await joinRoom(MOD_TOKEN);
  expect([200, 201]).toContain(modJoin.status);

  const spkJoin = await joinRoom(SPEAKER_TOKEN);
  expect([200, 201]).toContain(spkJoin.status);

  // 3. Promote mod → MODERATOR, speaker → SPEAKER via direct DB write
  //    (avoids LiveKit token grant path which needs a real SFU)
  await promoteToRole(MOD_TOKEN, MOD_ID, 'MODERATOR');
  await promoteToRole(SPEAKER_TOKEN, SPEAKER_ID, 'SPEAKER');
}, 30000);

afterAll(async () => {
  if (roomId) {
    // Clean up: remove participants, then the room
    await prisma.voiceParticipant.deleteMany({ where: { roomId } }).catch(() => {});
    await prisma.voiceRoom.delete({ where: { id: roomId } }).catch(() => {});
  }
  await prisma.$disconnect();
}, 15000);

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('DEF-005 — Individual Moderator Mute (REAL DB)', () => {

  // ── T1: Moderator mutes Speaker ────────────────────────────────────────────
  test('T1 — HOST can individually mute SPEAKER: 200, isMuted=true, sfuEnforced present', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', HOST_TOKEN)
      .send({ isMuted: true, targetUserId: SPEAKER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isMuted).toBe(true);
    // sfuEnforced must be present (DEF-005 fix)
    expect(res.body.data).toHaveProperty('sfuEnforced');
    expect(typeof res.body.data.sfuEnforced).toBe('boolean');
    // sfuEnforced=false is expected in dev without LiveKit — not a test failure
    if (res.body.data.sfuEnforced === false) {
      console.log('  ℹ️  sfuEnforced=false — LiveKit not configured in dev (expected)');
    }

    // Verify DB was updated
    const row = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } }
    });
    expect(row.isMuted).toBe(true);
    expect(row.mutedByModerator).toBe(true);
  });

  // ── T2: Mod-muted Speaker cannot self-unmute ───────────────────────────────
  test('T2 — mod-muted SPEAKER cannot self-unmute: 403', async () => {
    // Precondition: SPEAKER is mutedByModerator=true from T1
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', SPEAKER_TOKEN)
      .send({ isMuted: false }); // no targetUserId = self-action

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    // Verify DB unchanged
    const row = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } }
    });
    expect(row.isMuted).toBe(true);
    expect(row.mutedByModerator).toBe(true);
  });

  // ── T3: HOST unmutes Speaker ───────────────────────────────────────────────
  test('T3 — HOST can individually unmute SPEAKER: 200, isMuted=false, sfuEnforced present', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', HOST_TOKEN)
      .send({ isMuted: false, targetUserId: SPEAKER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.isMuted).toBe(false);
    expect(res.body.data).toHaveProperty('sfuEnforced');
    expect(typeof res.body.data.sfuEnforced).toBe('boolean');

    // Verify DB: restriction cleared
    const row = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } }
    });
    expect(row.isMuted).toBe(false);
    expect(row.mutedByModerator).toBe(false);
  });

  // ── T4: MODERATOR mutes SPEAKER ────────────────────────────────────────────
  test('T4 — MODERATOR can individually mute SPEAKER: 200, sfuEnforced present', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', MOD_TOKEN)
      .send({ isMuted: true, targetUserId: SPEAKER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.isMuted).toBe(true);
    expect(res.body.data).toHaveProperty('sfuEnforced');

    // Cleanup: unmute for subsequent tests
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } },
      data: { isMuted: false, mutedByModerator: false }
    });
  });

  // ── T5: MODERATOR cannot mute HOST ─────────────────────────────────────────
  test('T5 — MODERATOR cannot mute HOST: 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', MOD_TOKEN)
      .send({ isMuted: true, targetUserId: HOST_ID });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    // Verify HOST DB record unchanged
    const row = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: HOST_ID } }
    });
    // HOST should not have been muted
    expect(row?.mutedByModerator ?? false).toBe(false);
  });

  // ── T6: SPEAKER cannot mute another participant ────────────────────────────
  test('T6 — SPEAKER cannot mute another participant: 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', SPEAKER_TOKEN)
      .send({ isMuted: true, targetUserId: MOD_ID });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── T7: Self-mute returns no sfuEnforced field ─────────────────────────────
  test('T7 — self-mute (no targetUserId): 200, sfuEnforced absent', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', SPEAKER_TOKEN)
      .send({ isMuted: true }); // no targetUserId = self-mute

    expect(res.status).toBe(200);
    expect(res.body.data.isMuted).toBe(true);
    // Self-mute must NOT include sfuEnforced (SFU not called for self-mute)
    expect(res.body.data.sfuEnforced).toBeUndefined();
  });

  // ── T8: Unauthenticated request rejected ──────────────────────────────────
  test('T8 — unauthenticated mute attempt: 401', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .send({ isMuted: true, targetUserId: SPEAKER_ID });
    // No Authorization header
    expect(res.status).toBe(401);
  });

  // ── T9: Participant not in room cannot be targeted ─────────────────────────
  test('T9 — mute target not in room: 403 or 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', HOST_TOKEN)
      .send({ isMuted: true, targetUserId: OUTSIDER_ID });

    // Either 403 (not active) or 404 — both are correct
    expect([403, 404]).toContain(res.status);
  });

  // ── T10: DB state is authoritative after mute/unmute cycle ────────────────
  test('T10 — DB is authoritative: full mute→block-self-unmute→mod-unmute cycle', async () => {
    // Ensure speaker is unmuted to start
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } },
      data: { isMuted: false, mutedByModerator: false }
    });

    // Step 1: Host mutes speaker
    const muteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', HOST_TOKEN)
      .send({ isMuted: true, targetUserId: SPEAKER_ID });
    expect(muteRes.status).toBe(200);

    // Step 2: Speaker tries to self-unmute — must be blocked
    const selfUnmuteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', SPEAKER_TOKEN)
      .send({ isMuted: false });
    expect(selfUnmuteRes.status).toBe(403);

    // DB still muted
    const midRow = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } }
    });
    expect(midRow.isMuted).toBe(true);
    expect(midRow.mutedByModerator).toBe(true);

    // Step 3: Host unmutes — clears the restriction
    const unmuteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute`)
      .set('Authorization', HOST_TOKEN)
      .send({ isMuted: false, targetUserId: SPEAKER_ID });
    expect(unmuteRes.status).toBe(200);

    // DB cleared
    const finalRow = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: SPEAKER_ID } }
    });
    expect(finalRow.isMuted).toBe(false);
    expect(finalRow.mutedByModerator).toBe(false);
  });
});
