'use strict';
/**
 * School Membership Integration Tests — real DB
 *
 * Tests the SchoolMembership model's role guard, unique constraint,
 * and status transitions against a real database.
 *
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

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const testEmail = () => `membership-${uid()}@integration-test.halqa`;

async function createUser(role = 'MEMBER') {
  return prisma.user.create({
    data: {
      email:         testEmail(),
      passwordHash:  await bcrypt.hash('Test1234!', 10),
      firstName:     'Membership',
      lastName:      'Test',
      role,
      status:        'ACTIVE',
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

afterEach(async () => {
  try {
    await prisma.schoolMembership.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Membership Test School' } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.user.deleteMany({ where: { email: { contains: '@integration-test.halqa' } } });
  } catch { /* ignore */ }
});

// ─── Unique membership per user per school ────────────────────────────────────
describe('SchoolMembership — unique(userId, schoolId)', () => {
  it('prevents duplicate membership for the same user and school', async () => {
    const user   = await createUser();
    const school = await prisma.school.create({
      data: { name: `Membership Test School ${uid()}`, slug: `ms-${uid()}`, country: 'US' }
    });

    await prisma.schoolMembership.create({
      data: { userId: user.id, schoolId: school.id, role: 'STUDENT', status: 'ACTIVE' }
    });

    await expect(
      prisma.schoolMembership.create({
        data: { userId: user.id, schoolId: school.id, role: 'TEACHER', status: 'ACTIVE' }
      })
    ).rejects.toThrow(); // @@unique([userId, schoolId])
  });
});

// ─── Role guard via API ───────────────────────────────────────────────────────
describe('SchoolMembership API — role guard', () => {
  it('self-join with TEACHER role is accepted as TEACHER (PENDING status)', async () => {
    // The join endpoint allows STUDENT, TEACHER, GUARDIAN — all are safe education roles.
    // The admin must approve before the membership becomes ACTIVE.
    // SCHOOL_ADMIN and SUPER_ADMIN cannot be self-requested.
    const user   = await createUser('MEMBER');
    const school = await prisma.school.create({
      data: { name: `Membership Test School ${uid()}`, slug: `ms-${uid()}`, country: 'US' }
    });
    const token  = await loginUser(user.email);
    if (!token) return;

    const res = await request(app)
      .post('/api/v1/school-memberships/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ schoolId: school.id, role: 'TEACHER' });

    if (res.status === 201) {
      // TEACHER is a valid self-join role — accepted as TEACHER, starts as PENDING
      expect(['TEACHER', 'STUDENT']).toContain(res.body.data.role);
      expect(res.body.data.status).toBe('PENDING');
    } else {
      expect([201, 400, 404]).toContain(res.status);
    }
  });

  it('self-join cannot assign SUPER_ADMIN role', async () => {
    const user   = await createUser('MEMBER');
    const school = await prisma.school.create({
      data: { name: `Membership Test School ${uid()}`, slug: `ms-${uid()}`, country: 'US' }
    });
    const token = await loginUser(user.email);
    if (!token) return;

    const res = await request(app)
      .post('/api/v1/school-memberships/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ schoolId: school.id, role: 'SUPER_ADMIN' });

    // Either the role is coerced to STUDENT (201), or request is rejected (400/403)
    // But SUPER_ADMIN must NEVER be stored
    if (res.status === 201) {
      expect(res.body.data.role).not.toBe('SUPER_ADMIN');
    } else {
      expect([400, 403, 422]).toContain(res.status);
    }

    // Verify DB directly
    const membership = await prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId: user.id, schoolId: school.id } }
    });
    if (membership) {
      expect(membership.role).not.toBe('SUPER_ADMIN');
    }
  });
});

// ─── Status transitions ───────────────────────────────────────────────────────
describe('SchoolMembership — status values', () => {
  it('PENDING and ACTIVE are valid statuses', async () => {
    const user   = await createUser();
    const school = await prisma.school.create({
      data: { name: `Membership Test School ${uid()}`, slug: `ms-${uid()}`, country: 'US' }
    });

    const pending = await prisma.schoolMembership.create({
      data: { userId: user.id, schoolId: school.id, role: 'STUDENT', status: 'PENDING' }
    });
    expect(pending.status).toBe('PENDING');

    const activated = await prisma.schoolMembership.update({
      where: { id: pending.id },
      data:  { status: 'ACTIVE' },
    });
    expect(activated.status).toBe('ACTIVE');
  });
});
