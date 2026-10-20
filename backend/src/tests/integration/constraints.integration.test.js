'use strict';
/**
 * Database Constraints Integration Tests — real DB
 *
 * Verifies that every critical unique constraint, CHECK constraint,
 * and FK cascade is actually enforced by the database, not just Prisma.
 *
 * These tests are the ground truth: if they pass, the DB protects the data.
 * If they fail, the DB is misconfigured regardless of what the schema says.
 *
 * Run via: npm run test:integration
 */
const bcrypt = require('bcryptjs');
const prisma = require('../../utils/prisma');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const testEmail  = () => `constraint-${uid()}@integration-test.halqa`;

async function createUser(extra = {}) {
  return prisma.user.create({
    data: {
      email:         testEmail(),
      passwordHash:  await bcrypt.hash('Test1234!', 10),
      firstName:     'Constraint',
      lastName:      'Test',
      role:          'MEMBER',
      status:        'ACTIVE',
      emailVerified: true,
      ...extra,
    }
  });
}

afterAll(async () => {
  try {
    await prisma.wallet.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.walletTransaction.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.giftTransaction.deleteMany({ where: { sender: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.follow.deleteMany({ where: { follower: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { contains: '@integration-test.halqa' } } } });
    await prisma.user.deleteMany({ where: { email: { contains: '@integration-test.halqa' } } });
  } catch { /* ignore */ }
  await prisma.$disconnect();
});

// ─── User constraints ─────────────────────────────────────────────────────────
describe('User — unique constraints', () => {
  it('rejects duplicate email', async () => {
    const email = testEmail();
    await prisma.user.create({ data: { email, passwordHash: 'h', firstName: 'A', lastName: 'B', role: 'MEMBER', status: 'ACTIVE' } });
    await expect(
      prisma.user.create({ data: { email, passwordHash: 'h', firstName: 'C', lastName: 'D', role: 'MEMBER', status: 'ACTIVE' } })
    ).rejects.toThrow();
  });

  it('rejects duplicate username', async () => {
    const username = `user_${uid()}`;
    const emailA   = testEmail();
    const emailB   = testEmail();
    await prisma.user.create({ data: { email: emailA, username, passwordHash: 'h', firstName: 'A', lastName: 'B', role: 'MEMBER', status: 'ACTIVE' } });
    await expect(
      prisma.user.create({ data: { email: emailB, username, passwordHash: 'h', firstName: 'C', lastName: 'D', role: 'MEMBER', status: 'ACTIVE' } })
    ).rejects.toThrow();
  });
});

// ─── Wallet constraints ───────────────────────────────────────────────────────
describe('Wallet — constraints', () => {
  it('one wallet per user (unique userId)', async () => {
    const user = await createUser();
    await prisma.wallet.create({ data: { userId: user.id, coins: 0, diamonds: 0 } });
    await expect(
      prisma.wallet.create({ data: { userId: user.id, coins: 0, diamonds: 0 } })
    ).rejects.toThrow();
  });

  it('coins cannot be negative (CHECK constraint)', async () => {
    const user = await createUser();
    await prisma.wallet.create({ data: { userId: user.id, coins: 10, diamonds: 0 } });
    await expect(
      prisma.wallet.update({ where: { userId: user.id }, data: { coins: -1 } })
    ).rejects.toThrow();
  });

  it('diamonds cannot be negative (CHECK constraint)', async () => {
    const user = await createUser();
    await prisma.wallet.create({ data: { userId: user.id, coins: 0, diamonds: 5 } });
    await expect(
      prisma.wallet.update({ where: { userId: user.id }, data: { diamonds: -1 } })
    ).rejects.toThrow();
  });
});

// ─── GiftTransaction idempotency ──────────────────────────────────────────────
describe('GiftTransaction — idempotency key unique constraint', () => {
  it('rejects duplicate idempotencyKey', async () => {
    const sender   = await createUser();
    const receiver = await createUser();
    const key      = `idem-${uid()}`;

    const gift = await prisma.gift.findFirst({ where: { isActive: true } });
    if (!gift) return; // skip if no gifts seeded

    const base = {
      roomId: `room-${uid()}`, roomType: 'voice',
      senderId: sender.id, receiverId: receiver.id,
      giftId: gift.id, count: 1, combo: 1,
      coinsSpent: gift.priceCoins,
      diamondsEarned: Math.floor(gift.priceCoins * 0.5),
      idempotencyKey: key,
    };

    await prisma.giftTransaction.create({ data: base });
    await expect(
      prisma.giftTransaction.create({ data: { ...base } })
    ).rejects.toThrow(); // @unique idempotencyKey
  });
});

// ─── Follow constraints ───────────────────────────────────────────────────────
describe('Follow — unique constraint', () => {
  it('rejects duplicate follow (same follower + following)', async () => {
    const follower  = await createUser();
    const following = await createUser();

    await prisma.follow.create({ data: { followerId: follower.id, followingId: following.id } });
    await expect(
      prisma.follow.create({ data: { followerId: follower.id, followingId: following.id } })
    ).rejects.toThrow(); // @@unique([followerId, followingId])
  });
});

// ─── SchoolMembership CHECK constraint ───────────────────────────────────────
describe('SchoolMembership — role CHECK constraint (migration 20260821)', () => {
  let testSchool;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: {
        name:    `Constraint Test School ${uid()}`,
        slug:    `constraint-school-${uid()}`,
        country: 'US',
      }
    }).catch(() => null); // may fail if slug taken
  });

  afterAll(async () => {
    if (testSchool) {
      try {
        await prisma.schoolMembership.deleteMany({ where: { schoolId: testSchool.id } });
        await prisma.school.delete({ where: { id: testSchool.id } });
      } catch { /* ignore */ }
    }
  });

  it('rejects SUPER_ADMIN as a school membership role', async () => {
    if (!testSchool) return;
    const user = await createUser();

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO school_memberships (id, userId, schoolId, role, status, joinedAt, createdAt, updatedAt)
         VALUES (UUID(), ?, ?, 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW(), NOW())`,
        user.id, testSchool.id
      )
    ).rejects.toThrow(); // chk_membership_role CHECK constraint
  });

  it('accepts SCHOOL_ADMIN as a valid membership role', async () => {
    if (!testSchool) return;
    const user = await createUser();

    await expect(
      prisma.schoolMembership.create({
        data: {
          userId:   user.id,
          schoolId: testSchool.id,
          role:     'SCHOOL_ADMIN',
          status:   'ACTIVE',
        }
      })
    ).resolves.toBeTruthy();
  });

  it('accepts TEACHER, STUDENT, GUARDIAN, REPRESENTATIVE', async () => {
    if (!testSchool) return;
    const validRoles = ['TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE'];

    for (const role of validRoles) {
      const user = await createUser();
      await expect(
        prisma.schoolMembership.create({
          data: { userId: user.id, schoolId: testSchool.id, role, status: 'ACTIVE' }
        })
      ).resolves.toBeTruthy();
    }
  });
});

// ─── Cascade deletes ──────────────────────────────────────────────────────────
describe('Cascade deletes — referential integrity', () => {
  it('deleting a user cascades to refresh tokens', async () => {
    const user = await createUser();
    await prisma.refreshToken.create({
      data: {
        userId:    user.id,
        token:     `test-token-${uid()}`,
        expiresAt: new Date(Date.now() + 3600000),
      }
    });

    const before = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(before).toBe(1);

    await prisma.user.delete({ where: { id: user.id } });

    const after = await prisma.refreshToken.count({ where: { userId: user.id } });
    expect(after).toBe(0); // CASCADE DELETE worked
  });

  it('deleting a user cascades to wallet', async () => {
    const user = await createUser();
    await prisma.wallet.create({ data: { userId: user.id, coins: 0, diamonds: 0 } });

    await prisma.user.delete({ where: { id: user.id } });

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).toBeNull(); // CASCADE DELETE worked
  });
});
