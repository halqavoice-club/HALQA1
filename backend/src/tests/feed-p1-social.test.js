'use strict';
/**
 * CF-10 — Email not exposed in follower/following list responses
 *
 * Verifies that:
 * 1. getFollowers calls prisma with a select that excludes email
 * 2. getFollowing calls prisma with a select that excludes email
 * 3. The returned items contain the expected public fields (id, firstName, etc.)
 * 4. sendFriendRequest still uses USER_SELECT (email included) — regression guard
 */

jest.mock('../utils/prisma', () => ({
  follow: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({}),
  },
  friendRequest: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany:  jest.fn().mockResolvedValue([]),
    create:    jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
}));

jest.mock('../sockets', () => ({ getIo: () => null }));

const prisma = require('../utils/prisma');

// ─── req/res helpers ──────────────────────────────────────────────────────────
const makeRes = () => {
  const captured = {};
  const res = {};
  res.status = jest.fn(code => { captured.status = code; return res; });
  res.json   = jest.fn(body => { captured.body = body; return res; });
  res._get   = () => captured;
  return res;
};

const makeReq = (userId, queryParams = {}) => ({
  user:   { id: 'requester-1', firstName: 'Req', lastName: 'User', avatarUrl: null },
  params: { userId },
  query:  queryParams,
});

// Rows that the DB would return — the follower/following objects have email
// because that's what's in the DB row; the controller's select determines
// whether Prisma actually fetches it. We verify the select, not the spread.
const FOLLOWER_ROWS = [
  {
    id: 'follow-1',
    followerId: 'user-a',
    followingId: 'user-b',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    follower: {
      id: 'user-a',
      firstName: 'Alice',
      lastName: 'Smith',
      avatarUrl: null,
      role: 'STUDENT',
      schoolId: 'school-1',
      bio: 'Hello',
      // email intentionally absent — simulates what PUBLIC_USER_SELECT returns
    },
  },
];

const FOLLOWING_ROWS = [
  {
    id: 'follow-2',
    followerId: 'user-b',
    followingId: 'user-c',
    createdAt: new Date('2024-01-02T00:00:00Z'),
    following: {
      id: 'user-c',
      firstName: 'Bob',
      lastName: 'Jones',
      avatarUrl: null,
      role: 'TEACHER',
      schoolId: 'school-1',
      bio: null,
      // email intentionally absent
    },
  },
];

let getFollowers, getFollowing, sendFriendRequest;
beforeAll(() => {
  const ctrl = require('../controllers/social.controller');
  getFollowers      = ctrl.getFollowers;
  getFollowing      = ctrl.getFollowing;
  sendFriendRequest = ctrl.sendFriendRequest;
});

beforeEach(() => {
  jest.resetAllMocks();
  prisma.friendRequest.findFirst.mockResolvedValue(null);
  prisma.friendRequest.findMany.mockResolvedValue([]);
  prisma.follow.deleteMany.mockResolvedValue({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CF-10 — getFollowers — email omitted from select', () => {
  it('calls prisma.follow.findMany with a select that excludes email', async () => {
    prisma.follow.findMany
      .mockResolvedValueOnce(FOLLOWER_ROWS)   // main query
      .mockResolvedValueOnce([]);             // myFollowing check

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowers(req, res, jest.fn());

    // The first findMany call must include the follower select
    const [firstCall] = prisma.follow.findMany.mock.calls;
    const includeArg = firstCall[0].include;
    expect(includeArg).toBeDefined();
    expect(includeArg.follower).toBeDefined();
    expect(includeArg.follower.select).toBeDefined();
    // email must NOT be in the select object
    expect(includeArg.follower.select).not.toHaveProperty('email');
    expect(includeArg.follower.select.email).toBeUndefined();
  });

  it('follower select includes expected public fields', async () => {
    prisma.follow.findMany
      .mockResolvedValueOnce(FOLLOWER_ROWS)
      .mockResolvedValueOnce([]);

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowers(req, res, jest.fn());

    const [firstCall] = prisma.follow.findMany.mock.calls;
    const select = firstCall[0].include.follower.select;
    expect(select.id).toBe(true);
    expect(select.firstName).toBe(true);
    expect(select.lastName).toBe(true);
    expect(select.avatarUrl).toBe(true);
    expect(select.role).toBe(true);
    expect(select.bio).toBe(true);
  });

  it('returns items with public fields populated', async () => {
    prisma.follow.findMany
      .mockResolvedValueOnce(FOLLOWER_ROWS)
      .mockResolvedValueOnce([]);

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowers(req, res, jest.fn());

    expect(res.json).toHaveBeenCalled();
    const body = res._get().body;
    expect(body.success).toBe(true);
    const items = body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('id', 'user-a');
    expect(items[0]).toHaveProperty('firstName', 'Alice');
    expect(items[0]).toHaveProperty('lastName', 'Smith');
    expect(items[0]).toHaveProperty('role', 'STUDENT');
    expect(items[0]).toHaveProperty('bio', 'Hello');
    // email must NOT appear in the response items (not in mock data, not in select)
    expect(items[0]).not.toHaveProperty('email');
  });
});

describe('CF-10 — getFollowing — email omitted from select', () => {
  it('calls prisma.follow.findMany with a select that excludes email', async () => {
    prisma.follow.findMany.mockResolvedValueOnce(FOLLOWING_ROWS);

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowing(req, res, jest.fn());

    const [firstCall] = prisma.follow.findMany.mock.calls;
    const includeArg = firstCall[0].include;
    expect(includeArg).toBeDefined();
    expect(includeArg.following).toBeDefined();
    expect(includeArg.following.select).toBeDefined();
    // email must NOT be in the select object
    expect(includeArg.following.select).not.toHaveProperty('email');
    expect(includeArg.following.select.email).toBeUndefined();
  });

  it('following select includes expected public fields', async () => {
    prisma.follow.findMany.mockResolvedValueOnce(FOLLOWING_ROWS);

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowing(req, res, jest.fn());

    const [firstCall] = prisma.follow.findMany.mock.calls;
    const select = firstCall[0].include.following.select;
    expect(select.id).toBe(true);
    expect(select.firstName).toBe(true);
    expect(select.lastName).toBe(true);
    expect(select.avatarUrl).toBe(true);
    expect(select.role).toBe(true);
    expect(select.bio).toBe(true);
  });

  it('returns items with public fields populated', async () => {
    prisma.follow.findMany.mockResolvedValueOnce(FOLLOWING_ROWS);

    const req = makeReq('user-b');
    const res = makeRes();

    await getFollowing(req, res, jest.fn());

    const body = res._get().body;
    expect(body.success).toBe(true);
    const items = body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('id', 'user-c');
    expect(items[0]).toHaveProperty('firstName', 'Bob');
    // email must NOT appear (not in mock data, not in select)
    expect(items[0]).not.toHaveProperty('email');
  });
});

describe('CF-10 — Friend request endpoints retain email (regression)', () => {
  it('sendFriendRequest calls user.findUnique with select including email:true', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'receiver-1',
      firstName: 'Carol',
      lastName: 'Doe',
      email: 'carol@example.com',
      avatarUrl: null,
      role: 'STUDENT',
      schoolId: 'school-1',
      bio: null,
    });
    prisma.friendRequest.findFirst.mockResolvedValueOnce(null);
    prisma.friendRequest.create = jest.fn().mockResolvedValueOnce({ id: 'fr-1' });

    const req = {
      user:   { id: 'sender-1', firstName: 'Eve', lastName: 'Test', avatarUrl: null },
      params: { userId: 'receiver-1' },
      body:   {},
    };
    const res = makeRes();

    await sendFriendRequest(req, res, jest.fn());

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'receiver-1' },
        select: expect.objectContaining({ email: true }),
      })
    );
  });
});
