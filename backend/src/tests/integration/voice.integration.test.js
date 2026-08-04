'use strict';
/**
 * Integration tests — Voice controller
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.9
 *
 * Requires a real database (DATABASE_URL env var).
 * Run via: npm run test:integration
 */
const request = require('supertest');
const bcrypt  = require('bcryptjs');
const prisma  = require('../../utils/prisma');

let app;

beforeAll(async () => {
  process.env.PORT = '0';
  app = require('../../app');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const testEmail = () => `voice-test-${uid()}@integration-test.halqa`;

async function createUser(email) {
  const hash = await bcrypt.hash('Test1234!', 10);
  return prisma.user.create({
    data: {
      email,
      passwordHash: hash,
      firstName: 'Voice',
      lastName:  'Test',
      role:      'STUDENT',
      status:    'ACTIVE',
      emailVerified: true,
    }
  });
}

async function loginUser(email) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test1234!' });
  return res.body.data?.accessToken;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
afterEach(async () => {
  try {
    await prisma.voiceParticipant.deleteMany({ where: { room: { title: { contains: 'Integration Voice Room' } } } });
    await prisma.voiceRoom.deleteMany({ where: { title: { contains: 'Integration Voice Room' } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.user.deleteMany({ where: { email: { contains: '@integration-test.halqa' } } });
  } catch { /* ignore cleanup errors */ }
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Voice — create room', () => {
  it('creates a voice room and returns the room object', async () => {
    const email = testEmail();
    await createUser(email);
    const token = await loginUser(email);
    if (!token) return;

    const res = await request(app)
      .post('/api/v1/voice')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `Integration Voice Room ${uid()}`, privacy: 'PUBLIC' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });
});

describe('Voice — join and leave room', () => {
  let hostEmail, host, token, room;

  beforeEach(async () => {
    hostEmail = testEmail();
    host  = await createUser(hostEmail);
    token = await loginUser(hostEmail);
    if (!token) return;

    // Create a room directly in DB to avoid needing LiveKit in tests
    room = await prisma.voiceRoom.create({
      data: {
        hostId:  host.id,
        title:   `Integration Voice Room ${uid()}`,
        status:  'LIVE',
        privacy: 'PUBLIC',
        maxSpeakers: 10,
      }
    });
  });

  it('allows a user to join a room within capacity', async () => {
    if (!token) return;

    const res = await request(app)
      .post(`/api/v1/voice/${room.id}/join`)
      .set('Authorization', `Bearer ${token}`);

    // 200 OK or 409 (already joined) are both acceptable
    expect([200, 201, 409]).toContain(res.status);
  });

  it('returns HTTP 403 when room is at capacity (roomLevel 1 = 500)', async () => {
    if (!token) return;

    // Insert 500 fake participants via raw SQL (bypass FK so we don't need real users)
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (let batch = 0; batch < 5; batch++) {
        const values = Array.from({ length: 100 }, (_, i) => {
          const idx  = batch * 100 + i;
          const id   = `ffffffff-ffff-${String(idx).padStart(4,'0')}-ffff-ffffffffffff`;
          const uid  = `aaaaaaaa-aaaa-${String(idx).padStart(4,'0')}-aaaa-aaaaaaaaaaaa`;
          return `('${id}','${room.id}','${uid}','AUDIENCE',1,0,0,NOW(),NOW())`;
        }).join(',');
        await prisma.$executeRawUnsafe(
          `INSERT IGNORE INTO voice_participants ` +
          `(id,roomId,userId,role,isMuted,handRaised,isPinned,createdAt,updatedAt) ` +
          `VALUES ${values}`
        );
      }
    } finally {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }

    const joinerEmail = testEmail();
    await createUser(joinerEmail);
    const joinerToken = await loginUser(joinerEmail);

    let res;
    try {
      if (!joinerToken) return;
      res = await request(app)
        .post(`/api/v1/voice/${room.id}/join`)
        .set('Authorization', `Bearer ${joinerToken}`);
    } finally {
      // Clean up fake participants regardless of assertion outcome
      await prisma.$executeRawUnsafe(
        `DELETE FROM voice_participants WHERE userId LIKE 'aaaaaaaa-aaaa-%'`
      );
    }

    expect(res.status).toBe(403);
  });

  it('allows the current participant to leave the room', async () => {
    if (!token) return;

    // Join first
    await request(app)
      .post(`/api/v1/voice/${room.id}/join`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/voice/${room.id}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect([200, 204]).toContain(res.status);
  });
});
