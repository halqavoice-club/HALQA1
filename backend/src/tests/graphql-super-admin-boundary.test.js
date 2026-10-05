'use strict';
/**
 * GraphQL SUPER_ADMIN Boundary — Phase 24F Remediation Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that the GraphQL resolvers enforce the same SUPER_ADMIN boundary
 * as the REST API after the Phase 24F fixes.
 *
 * Tests:
 *   P0-001: createUser with role: 'SUPER_ADMIN' is blocked by roleGuard
 *   P0-002: updateUser with role: 'SUPER_ADMIN' is blocked by roleGuard
 *   P0-002b: SCHOOL_ADMIN cannot update users outside their school
 *   P1-001: SUPER_ADMIN cannot updateSchool without membership
 *   P1-002: deleteUser soft-deletes instead of hard-deleting
 *   P1-003: SUPER_ADMIN cannot edit another user's post (updatePost)
 *   P1-004: SCHOOL_ADMIN Query.users is scoped to their school
 *
 * Run via: npx jest --testPathPattern=graphql-super-admin-boundary
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('../utils/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  post: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  school: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  session: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  schoolMembership: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const prisma = require('../utils/prisma');
const resolvers = require('../graphql/resolvers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(userId, role, schoolId) {
  return {
    user: { id: userId, role, schoolId: schoolId || null },
    pubsub: { asyncIterator: jest.fn() },
    req: {},
  };
}

// ─── P0-001: createUser blocks SUPER_ADMIN role ─────────────────────────────

describe('P0-001: createUser blocks SUPER_ADMIN role via roleGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SCHOOL_ADMIN cannot create a user with role: SUPER_ADMIN', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-1');
    await expect(
      resolvers.Mutation.createUser(
        null,
        { input: { email: 'hack@halqa.com', firstName: 'H', lastName: 'A', role: 'SUPER_ADMIN', password: 'x' } },
        ctx
      )
    ).rejects.toThrow(/SUPER_ADMIN role cannot be assigned/);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN cannot create a user with role: SUPER_ADMIN via GraphQL', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    await expect(
      resolvers.Mutation.createUser(
        null,
        { input: { email: 'hack2@halqa.com', firstName: 'H', lastName: 'A', role: 'SUPER_ADMIN', password: 'x' } },
        ctx
      )
    ).rejects.toThrow(/SUPER_ADMIN role cannot be assigned/);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN can create a user with a valid role (e.g. STUDENT)', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-1');
    prisma.user.create.mockResolvedValue({ id: 'new-user', email: 'new@halqa.com', role: 'STUDENT' });

    const result = await resolvers.Mutation.createUser(
      null,
      { input: { email: 'new@halqa.com', firstName: 'N', lastName: 'U', role: 'STUDENT', password: 'x' } },
      ctx
    );

    expect(prisma.user.create).toHaveBeenCalled();
    expect(result.role).toBe('STUDENT');
  });
});

// ─── P0-002: updateUser blocks SUPER_ADMIN role ──────────────────────────────

describe('P0-002: updateUser blocks SUPER_ADMIN role via roleGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SCHOOL_ADMIN cannot escalate own role to SUPER_ADMIN', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-1');
    await expect(
      resolvers.Mutation.updateUser(
        null,
        { id: 'admin-1', input: { role: 'SUPER_ADMIN' } },
        ctx
      )
    ).rejects.toThrow(/SUPER_ADMIN role cannot be assigned/);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN cannot set another user role to SUPER_ADMIN', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-1');
    await expect(
      resolvers.Mutation.updateUser(
        null,
        { id: 'target-1', input: { role: 'SUPER_ADMIN' } },
        ctx
      )
    ).rejects.toThrow(/SUPER_ADMIN role cannot be assigned/);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('User can update self with a valid role', async () => {
    const ctx = makeContext('user-1', 'MEMBER', null);
    prisma.user.update.mockResolvedValue({ id: 'user-1', role: 'MEMBER', firstName: 'Updated' });

    const result = await resolvers.Mutation.updateUser(
      null,
      { id: 'user-1', input: { firstName: 'Updated' } },
      ctx
    );

    expect(prisma.user.update).toHaveBeenCalled();
    expect(result.firstName).toBe('Updated');
  });
});

// ─── P0-002b: updateUser scopes SCHOOL_ADMIN to own school ───────────────────

describe('P0-002b: SCHOOL_ADMIN updateUser scoped to own school', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SCHOOL_ADMIN cannot update user from another school', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-A');
    prisma.user.findUnique.mockResolvedValue({ schoolId: 'school-B' });

    await expect(
      resolvers.Mutation.updateUser(
        null,
        { id: 'user-B', input: { firstName: 'Hack' } },
        ctx
      )
    ).rejects.toThrow(/Unauthorized — can only update users in your school/);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN can update user from own school', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-A');
    prisma.user.findUnique.mockResolvedValue({ schoolId: 'school-A' });
    prisma.user.update.mockResolvedValue({ id: 'user-A', firstName: 'Updated' });

    const result = await resolvers.Mutation.updateUser(
      null,
      { id: 'user-A', input: { firstName: 'Updated' } },
      ctx
    );

    expect(prisma.user.update).toHaveBeenCalled();
  });
});

// ─── P1-001: updateSchool requires SUPER_ADMIN membership ────────────────────

describe('P1-001: updateSchool requires membership for SUPER_ADMIN', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SUPER_ADMIN without membership is blocked from updating a school', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.schoolMembership.findUnique.mockResolvedValue(null);

    await expect(
      resolvers.Mutation.updateSchool(
        null,
        { id: 'school-1', input: { name: 'Hacked School' } },
        ctx
      )
    ).rejects.toThrow(/active school membership/);

    expect(prisma.school.update).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN with ACTIVE SCHOOL_ADMIN membership can update school', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.schoolMembership.findUnique.mockResolvedValue({ role: 'SCHOOL_ADMIN', status: 'ACTIVE' });
    prisma.school.update.mockResolvedValue({ id: 'school-1', name: 'Updated' });

    const result = await resolvers.Mutation.updateSchool(
      null,
      { id: 'school-1', input: { name: 'Updated' } },
      ctx
    );

    expect(prisma.school.update).toHaveBeenCalled();
  });

  test('SUPER_ADMIN with SUSPENDED membership is blocked', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.schoolMembership.findUnique.mockResolvedValue({ role: 'SCHOOL_ADMIN', status: 'SUSPENDED' });

    await expect(
      resolvers.Mutation.updateSchool(
        null,
        { id: 'school-1', input: { name: 'Hacked' } },
        ctx
      )
    ).rejects.toThrow(/active school membership/);

    expect(prisma.school.update).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN cannot update another school', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-A');

    await expect(
      resolvers.Mutation.updateSchool(
        null,
        { id: 'school-B', input: { name: 'Hacked' } },
        ctx
      )
    ).rejects.toThrow(/own school/);

    expect(prisma.school.update).not.toHaveBeenCalled();
  });
});

// ─── P1-002: deleteUser soft-deletes ─────────────────────────────────────────

describe('P1-002: deleteUser soft-deletes instead of hard-deleting', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deleteUser calls update with deletedAt, not delete', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.user.update.mockResolvedValue({ id: 'target-1' });

    await resolvers.Mutation.deleteUser(null, { id: 'target-1' }, ctx);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'target-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          status: 'INACTIVE',
        }),
      })
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});

// ─── P1-003: updatePost blocks SUPER_ADMIN from editing ──────────────────────

describe('P1-003: updatePost blocks SUPER_ADMIN from editing others posts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SUPER_ADMIN cannot edit another user post', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.post.findUnique.mockResolvedValue({ authorId: 'other-user' });

    await expect(
      resolvers.Mutation.updatePost(
        null,
        { id: 'post-1', input: { title: 'Hacked Title' } },
        ctx
      )
    ).rejects.toThrow(/cannot edit another user's social content/);

    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  test('Post author can edit own post', async () => {
    const ctx = makeContext('author-1', 'MEMBER', null);
    prisma.post.findUnique.mockResolvedValue({ authorId: 'author-1' });
    prisma.post.update.mockResolvedValue({ id: 'post-1', title: 'New Title' });

    const result = await resolvers.Mutation.updatePost(
      null,
      { id: 'post-1', input: { title: 'New Title' } },
      ctx
    );

    expect(prisma.post.update).toHaveBeenCalled();
    expect(result.title).toBe('New Title');
  });

  test('SUPER_ADMIN can still delete posts (moderation)', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.post.findUnique.mockResolvedValue({ authorId: 'other-user' });
    prisma.post.delete.mockResolvedValue({ id: 'post-1' });

    const result = await resolvers.Mutation.deletePost(null, { id: 'post-1' }, ctx);

    expect(prisma.post.delete).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});

// ─── P1-004: Query.users scopes SCHOOL_ADMIN ─────────────────────────────────

describe('P1-004: Query.users scopes SCHOOL_ADMIN to own school', () => {
  beforeEach(() => jest.clearAllMocks());

  test('SCHOOL_ADMIN is scoped to own school even when schoolId is omitted', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-A');
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', schoolId: 'school-A' }]);
    prisma.user.count.mockResolvedValue(1);

    await resolvers.Query.users(null, { page: 1, pageSize: 20 }, ctx);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: 'school-A' },
      })
    );
  });

  test('SCHOOL_ADMIN cannot list all users by supplying a different schoolId', async () => {
    const ctx = makeContext('admin-1', 'SCHOOL_ADMIN', 'school-A');
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await resolvers.Query.users(null, { page: 1, pageSize: 20, schoolId: 'school-B' }, ctx);

    // SCHOOL_ADMIN should be scoped to their own school, ignoring the supplied schoolId
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: 'school-A' },
      })
    );
  });

  test('SUPER_ADMIN can list users from any school via schoolId variable', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await resolvers.Query.users(null, { page: 1, pageSize: 20, schoolId: 'school-B' }, ctx);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { schoolId: 'school-B' },
      })
    );
  });

  test('SUPER_ADMIN can list all users when schoolId is omitted', async () => {
    const ctx = makeContext('sa-1', 'SUPER_ADMIN', null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await resolvers.Query.users(null, { page: 1, pageSize: 20 }, ctx);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  test('MEMBER is rejected from Query.users', async () => {
    const ctx = makeContext('member-1', 'MEMBER', null);

    await expect(
      resolvers.Query.users(null, { page: 1, pageSize: 20 }, ctx)
    ).rejects.toThrow('Unauthorized');
  });
});
