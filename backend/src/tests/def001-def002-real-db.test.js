'use strict';
/**
 * DEF-001 + DEF-002 Integration Tests — Room-Wide Mute Policy (REAL DB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses REAL MySQL (halqa_db via Prisma). No mock DB.
 *
 * This suite verifies the full end-to-end data path:
 *   R1 — muteAll() via HTTP endpoint → VoiceRoom.allMuted=true in DB
 *   R2 — promoteParticipant() when allMuted=true → new SPEAKER.isMuted=true in DB
 *   R3 — unmuteAll() → allMuted=false; individually-muted speaker stays muted
 *   R4 — Full cycle: muteAll → promote → verify → unmuteAll → verify preservation
 *
 * Seed identities (from backend/src/prisma/seed.js, confirmed in DB 2026-10-19):
 *   HOST    admin@halqa-academy.com    c6924c89-0fbf-409b-a995-36d75a208654  (SCHOOL_ADMIN)
 *   MOD     teacher@halqa-academy.com  ee4cdadd-a17d-4bb2-98a2-de53344842bb  (TEACHER)
 *   SPEAKER student1@halqa.com         7ceab69a-7214-4547-bb68-10ca4faf3492  (STUDENT)
 *
 * IMPORTANT: These tests do NOT call the LiveKit SFU. sfuRevokePublish() will
 * attempt the call and fail gracefully (sfuEnforced=false) in dev without a
 * real LiveKit server — this is expected and is NOT a test failure.
 *
 * These tests are excluded from CI unit runs by the `real-db` path pattern
 * in package.json:test:unit (--testPathIgnorePatterns=real-db).
 * Run manually when a DB is available:
 *   node --experimental-vm-modules node_modules/.bin/jest def001-def002-real-db
 */

// ─── NO PRISMA MOCK ───────────────────────────────────────────────────────────
const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { generateAccessToken } = require('../utils/jwt');

// ─── Seed identities (verified in DB 2026-10-19) ──────────────────────────────
const HOST_ID    = 'c6924c89-0fbf-409b-a995-36d75a208654'; // admin@halqa-academy.com
const MOD_ID     = 'ee4cdadd-a17d-4bb2-98a2-de53344842bb'; // teacher@halqa-academy.com
const SPEAKER_ID = '7ceab69a-7214-4547-bb68-10ca4faf3492'; // student1@halqa.com

// ─── JWT tokens (bypass login — same pattern as def005-mute-real-db.test.js) ──
const HOST_TOKEN    = 'Bearer ' + generateAccessToken({ userId: HOST_ID,    role: 'SCHOOL_ADMIN' });
const MOD_TOKEN     = 'Bearer ' + generateAccessToken({ userId: MOD_ID,     role: 'TEACHER'      });
const SPEAKER_TOKEN = 'Bearer ' + generateAccessToken({ userId: SPEAKER_ID, role: 'STUDENT'      });

// ─── App builder (real routes, no external Socket.IO server needed) ───────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function joinRoom(token) {
  return request(app)
    .post(`/api/v1/voice/${roomId}/join`)
    .set('Authorization', token);
}

/**
 * Directly set participant role/mute state in DB, bypassing stage machinery
 * that would need a real SFU seat grant. Used only for test setup.
 */
async function setParticipantState(userId, data) {
  await prisma.voiceParticipant.update({
    where: { roomId_userId: { roomId, userId } },
    data: { ...data, isActive: true },
  });
}

/** Read a fresh copy of the VoiceRoom row from DB. */
async function freshRoom() {
  return prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { allMuted: true, status: true },
  });
}

/** Read a fresh copy of a VoiceParticipant row from DB. */
async function freshParticipant(userId) {
  return prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, isMuted: true, mutedByModerator: true, isActive: true, seatNumber: true },
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  app = buildApp();

  // 0. Clean up any stale test rooms and active participants from prior runs.
  //    Stale LIVE rooms block the one-active-room-per-user rule.
  const staleRooms = await prisma.voiceRoom.findMany({
    where: {
      OR: [
        { hostId: HOST_ID, status: 'LIVE', title: { contains: 'def001-def002-test' } },
        { hostId: HOST_ID, status: 'LIVE' },
      ]
    },
    select: { id: true },
  });
  for (const r of staleRooms) {
    await prisma.voiceParticipant.updateMany({
      where: { roomId: r.id, isActive: true },
      data:  { isActive: false, leftAt: new Date() },
    });
    await prisma.voiceRoom.update({
      where: { id: r.id },
      data:  { status: 'ENDED', endedAt: new Date() },
    });
  }
  // Deactivate any lingering active participants for test users in any room
  for (const uid of [HOST_ID, MOD_ID, SPEAKER_ID]) {
    await prisma.voiceParticipant.updateMany({
      where: { userId: uid, isActive: true },
      data:  { isActive: false, leftAt: new Date() },
    });
  }

  // 1. Create the test room as HOST
  const createRes = await request(app)
    .post('/api/v1/voice')
    .set('Authorization', HOST_TOKEN)
    .send({
      title:       'def001-def002-test room',
      privacy:     'PUBLIC',
      maxSpeakers: 6,
    });

  expect(createRes.status).toBe(201);
  roomId = createRes.body.data?.id ?? createRes.body.data?.room?.id;
  expect(roomId).toBeTruthy();

  // 2. Join MOD and SPEAKER into the room
  const modJoin = await joinRoom(MOD_TOKEN);
  expect([200, 201]).toContain(modJoin.status);

  const spkJoin = await joinRoom(SPEAKER_TOKEN);
  expect([200, 201]).toContain(spkJoin.status);

  // 3. Set roles directly (avoids needing real LiveKit seat grant machinery)
  await setParticipantState(MOD_ID,     { role: 'MODERATOR', seatNumber: 2, isMuted: false, mutedByModerator: false });
  await setParticipantState(SPEAKER_ID, { role: 'SPEAKER',   seatNumber: 3, isMuted: false, mutedByModerator: false });
}, 30000);

afterAll(async () => {
  if (roomId) {
    await prisma.voiceParticipant.deleteMany({ where: { roomId } }).catch(() => {});
    await prisma.voiceRoom.delete({ where: { id: roomId } }).catch(() => {});
  }
  await prisma.$disconnect();
}, 15000);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DEF-001 + DEF-002 — Room-Wide Mute Policy (REAL DB)', () => {

  // ── R1: muteAll() → DB allMuted=true ──────────────────────────────────────
  test('R1 — muteAll() via HOST endpoint → VoiceRoom.allMuted=true persisted in DB', async () => {
    // Precondition: ensure SPEAKER and MOD are unmuted
    await setParticipantState(MOD_ID,     { isMuted: false, mutedByModerator: false });
    await setParticipantState(SPEAKER_ID, { isMuted: false, mutedByModerator: false });

    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute-all`)
      .set('Authorization', HOST_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.allMuted).toBe(true);

    // Authoritative check: DB must reflect allMuted=true
    const room = await freshRoom();
    expect(room.allMuted).toBe(true);

    // SPEAKER and MOD must be muted in DB
    const spk = await freshParticipant(SPEAKER_ID);
    expect(spk.isMuted).toBe(true);
    expect(spk.mutedByModerator).toBe(true);

    const mod = await freshParticipant(MOD_ID);
    expect(mod.isMuted).toBe(true);
    expect(mod.mutedByModerator).toBe(true);
  });

  // ── R2: promoteParticipant() when allMuted=true → new SPEAKER isMuted=true ─
  test('R2 — promoteParticipant() when allMuted=true → promoted SPEAKER has isMuted=true in DB', async () => {
    // Ensure allMuted=true in DB (carry over from R1, but set explicitly for isolation)
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data:  { allMuted: true },
    });

    // Reset SPEAKER to AUDIENCE so they can be promoted again
    await setParticipantState(SPEAKER_ID, {
      role: 'AUDIENCE', seatNumber: null, isMuted: true, mutedByModerator: false,
    });

    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/promote`)
      .set('Authorization', HOST_TOKEN)
      .send({ targetUserId: SPEAKER_ID, role: 'SPEAKER' });

    // Accept 200 (promotion succeeded) — 400/409 would indicate a seat/state block
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // DEF-002 fix: promoted SPEAKER must have isMuted=true because allMuted=true
    const spk = await freshParticipant(SPEAKER_ID);
    expect(spk.role).toBe('SPEAKER');
    expect(spk.isMuted).toBe(true);
  });

  // ── R3: unmuteAll() → allMuted=false; individually-muted speaker stays muted
  test('R3 — unmuteAll() clears allMuted=false; speaker with mutedByModerator=true stays muted', async () => {
    // Setup: MOD muted by moderator (individual), SPEAKER muted by allMuted only
    await prisma.voiceRoom.update({ where: { id: roomId }, data: { allMuted: true } });
    await setParticipantState(MOD_ID, {
      role: 'MODERATOR', seatNumber: 2, isMuted: true, mutedByModerator: true,
    });
    await setParticipantState(SPEAKER_ID, {
      role: 'SPEAKER', seatNumber: 3, isMuted: true, mutedByModerator: false,
    });

    const res = await request(app)
      .patch(`/api/v1/voice/${roomId}/unmute-all`)
      .set('Authorization', HOST_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.allMuted).toBe(false);

    // DB: allMuted must now be false
    const room = await freshRoom();
    expect(room.allMuted).toBe(false);

    // SPEAKER (mutedByModerator=false) must be unmuted
    const spk = await freshParticipant(SPEAKER_ID);
    expect(spk.isMuted).toBe(false);
    expect(spk.mutedByModerator).toBe(false);

    // MOD (mutedByModerator=true) must REMAIN muted — DEF-003 fix
    const mod = await freshParticipant(MOD_ID);
    expect(mod.isMuted).toBe(true);
    expect(mod.mutedByModerator).toBe(true);
  });

  // ── R4: Full cycle ────────────────────────────────────────────────────────
  test('R4 — Full cycle: muteAll → promote → verify isMuted=true → unmuteAll → verify preservation', async () => {
    // Reset clean state: no allMuted, SPEAKER on stage unmuted
    await prisma.voiceRoom.update({ where: { id: roomId }, data: { allMuted: false } });
    await setParticipantState(MOD_ID, {
      role: 'MODERATOR', seatNumber: 2, isMuted: false, mutedByModerator: false,
    });
    await setParticipantState(SPEAKER_ID, {
      role: 'AUDIENCE', seatNumber: null, isMuted: true, mutedByModerator: false,
    });

    // Step 1: HOST calls muteAll → allMuted=true persisted
    const muteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/mute-all`)
      .set('Authorization', HOST_TOKEN);
    expect(muteRes.status).toBe(200);

    const roomAfterMuteAll = await freshRoom();
    expect(roomAfterMuteAll.allMuted).toBe(true);

    // Step 2: Promote SPEAKER while allMuted=true → must get isMuted=true
    const promoteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/promote`)
      .set('Authorization', HOST_TOKEN)
      .send({ targetUserId: SPEAKER_ID, role: 'SPEAKER' });
    expect(promoteRes.status).toBe(200);

    const spkAfterPromotion = await freshParticipant(SPEAKER_ID);
    expect(spkAfterPromotion.role).toBe('SPEAKER');
    // DEF-002: promotion during allMuted must not silently unmute the new speaker
    expect(spkAfterPromotion.isMuted).toBe(true);

    // Step 3: Individually mute MOD by moderator (separate from allMuted)
    await setParticipantState(MOD_ID, { isMuted: true, mutedByModerator: true });

    // Step 4: HOST calls unmuteAll → allMuted=false, individually-muted MOD preserved
    const unmuteRes = await request(app)
      .patch(`/api/v1/voice/${roomId}/unmute-all`)
      .set('Authorization', HOST_TOKEN);
    expect(unmuteRes.status).toBe(200);

    const roomAfterUnmuteAll = await freshRoom();
    expect(roomAfterUnmuteAll.allMuted).toBe(false);

    // SPEAKER (mutedByModerator=false) should now be unmuted
    const spkFinal = await freshParticipant(SPEAKER_ID);
    expect(spkFinal.isMuted).toBe(false);
    expect(spkFinal.mutedByModerator).toBe(false);

    // MOD (mutedByModerator=true) must remain muted — individual mute survives unmuteAll
    const modFinal = await freshParticipant(MOD_ID);
    expect(modFinal.isMuted).toBe(true);
    expect(modFinal.mutedByModerator).toBe(true);
  });

});
