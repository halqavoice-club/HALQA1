'use strict';
/**
 * Social Friends & Follow Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers GAP-003 (Follow state machine) and GAP-005 (Friend Request state machine)
 * in social.controller.js.
 *
 * All tests use mocked Prisma — no real DB required.
 */

// @ts-ignore
jest.mock('../utils/prisma');
// @ts-ignore
jest.mock('../utils/redis', () => ({
  // @ts-ignore
  isRedisReady:       jest.fn(() => false),
  // @ts-ignore
  getCache:           jest.fn().mockResolvedValue(null),
  // @ts-ignore
  setCache:           jest.fn().mockResolvedValue(undefined),
  // @ts-ignore
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  // @ts-ignore
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
// @ts-ignore
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
// @ts-ignore
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
// @ts-ignore
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
// @ts-ignore
jest.mock('../utils/storage', () => ({
  // @ts-ignore
  saveFile:   jest.fn().mockResolvedValue({ url: '/uploads/test.jpg' }),
  // @ts-ignore
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
// @ts-ignore
jest.mock('../services/notification.service', () => ({
  // @ts-ignore
  notify: jest.fn().mockResolvedValue(undefined),
}));
// @ts-ignore
jest.mock('../utils/contentFilter', () => ({
  // @ts-ignore
  filterMiddleware: () => (req, res, next) => next(),
}));

const request    = require('supertest');
const express    = require('express');
const cookieParser = require('cookie-parser');
const prisma     = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ─── App builder ─────────────────────────────────────────────────────────────

function buildSocialApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/social', require('../routes/social.routes'));
  // @ts-ignore
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// @ts-ignore
function tok(id) { return `Bearer t-${id}`; }

// @ts-ignore
function asUser(id, role) {
  role = role || 'MEMBER';
  const u = {
    id, role, status: 'ACTIVE', schoolId: null,
    firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null,
  };
  // @ts-ignore
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId: null });
  // @ts-ignore
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

// @ts-ignore
function makeUser(id, firstName) {
  firstName = firstName || 'Other';
  return {
    id, firstName, lastName: 'User', email: `${id}@test.com`,
    avatarUrl: null, role: 'MEMBER', schoolId: null, bio: null,
  };
}

// ─── beforeEach ──────────────────────────────────────────────────────────────

// @ts-ignore
beforeEach(() => {
  // @ts-ignore
  jest.clearAllMocks();
  // @ts-ignore
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  // @ts-ignore
  require('../utils/redis').getCache.mockResolvedValue(null);

  // Ensure optional prisma sub-objects are initialised (Jest auto-mock does not
  // create models that aren't accessed at module load time)
  // @ts-ignore
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  // @ts-ignore
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  // @ts-ignore
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  // @ts-ignore
  if (!prisma.auditLog) prisma.auditLog = {};
  // @ts-ignore
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  // @ts-ignore
  if (!prisma.friendRequest) prisma.friendRequest = {};
  // @ts-ignore
  prisma.friendRequest.findFirst  = jest.fn().mockResolvedValue(null);
  // @ts-ignore
  prisma.friendRequest.findMany   = jest.fn().mockResolvedValue([]);
  // @ts-ignore
  prisma.friendRequest.create     = jest.fn().mockResolvedValue({});
  // @ts-ignore
  prisma.friendRequest.update     = jest.fn().mockResolvedValue({});
  // @ts-ignore
  prisma.friendRequest.delete     = jest.fn().mockResolvedValue({});
  // @ts-ignore
  prisma.friendRequest.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  // @ts-ignore
  prisma.friendRequest.count      = jest.fn().mockResolvedValue(0);

  // @ts-ignore
  if (!prisma.follow) prisma.follow = {};
  // @ts-ignore
  prisma.follow.findUnique  = jest.fn().mockResolvedValue(null);
  // @ts-ignore
  prisma.follow.findMany    = jest.fn().mockResolvedValue([]);
  // @ts-ignore
  prisma.follow.create      = jest.fn().mockResolvedValue({});
  // @ts-ignore
  prisma.follow.deleteMany  = jest.fn().mockResolvedValue({ count: 0 });
  // @ts-ignore
  prisma.follow.upsert      = jest.fn().mockResolvedValue({});
  // @ts-ignore
  prisma.follow.count       = jest.fn().mockResolvedValue(0);

  // @ts-ignore
  if (!prisma.userBlock) prisma.userBlock = {};
  // @ts-ignore
  prisma.userBlock.findMany  = jest.fn().mockResolvedValue([]); // no blocks by default
  // @ts-ignore
  prisma.userBlock.findFirst = jest.fn().mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FOLLOW
// ═══════════════════════════════════════════════════════════════════════════════

// @ts-ignore
describe('Follow', () => {
  // @ts-ignore
  let app;
  // @ts-ignore
  beforeAll(() => { app = buildSocialApp(); });

  // @ts-ignore
  test('followUser — happy path returns { following: true }', async () => {
    asUser('user-a');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'user-a', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('user-b'));
    // @ts-ignore
    prisma.follow.findUnique.mockResolvedValue(null);
    // @ts-ignore
    prisma.follow.create.mockResolvedValue({ id: 'fol-1' });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/follow/user-b')
      .set('Authorization', tok('user-a'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.following).toBe(true);
    // @ts-ignore
    expect(prisma.follow.create).toHaveBeenCalledTimes(1);
    // @ts-ignore
    const createData = prisma.follow.create.mock.calls[0][0].data;
    // @ts-ignore
    expect(createData.followerId).toBe('user-a');
    // @ts-ignore
    expect(createData.followingId).toBe('user-b');
  });

  // @ts-ignore
  test('followUser — self-follow returns 400', async () => {
    asUser('self-user');

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/follow/self-user')
      .set('Authorization', tok('self-user'));

    // @ts-ignore
    expect(res.status).toBe(400);
    // @ts-ignore
    expect(res.body.message).toMatch(/yourself/i);
    // @ts-ignore
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  // @ts-ignore
  test('followUser — already following returns 200 idempotent (no new record)', async () => {
    asUser('user-c');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'user-c', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('user-d'));
    // @ts-ignore
    prisma.follow.findUnique.mockResolvedValue({ id: 'fol-existing' });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/follow/user-d')
      .set('Authorization', tok('user-c'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.following).toBe(true);
    // @ts-ignore
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  // @ts-ignore
  test('unfollowUser — returns { following: false } (idempotent)', async () => {
    asUser('user-e');
    // @ts-ignore
    prisma.follow.deleteMany.mockResolvedValue({ count: 1 });

    // @ts-ignore
    const res = await request(app)
      .delete('/api/v1/social/follow/user-f')
      .set('Authorization', tok('user-e'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.following).toBe(false);
    // @ts-ignore
    const deleteWhere = prisma.follow.deleteMany.mock.calls[0][0].where;
    // @ts-ignore
    expect(deleteWhere.followerId).toBe('user-e');
    // @ts-ignore
    expect(deleteWhere.followingId).toBe('user-f');
  });

  // @ts-ignore
  test('getFollowers — returns paginated follower list with iFollowThem field', async () => {
    asUser('viewer-1');
    prisma.follow.findMany
      // @ts-ignore
      .mockResolvedValueOnce([
        { id: 'follow-1', followerId: 'follower-a', createdAt: new Date(), follower: makeUser('follower-a', 'Alice') },
      ])
      .mockResolvedValueOnce([]); // viewer's following set

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/followers/target-user')
      .set('Authorization', tok('viewer-1'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // Response is now paginated: { items, nextCursor, hasMore }
    // @ts-ignore
    expect(Array.isArray(res.body.data.items)).toBe(true);
    // @ts-ignore
    expect(res.body.data.items[0]).toHaveProperty('iFollowThem');
    // @ts-ignore
    expect(res.body.data.items[0].id).toBe('follower-a');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('nextCursor');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('hasMore');
  });

  // @ts-ignore
  test('getFollowing — returns paginated following list', async () => {
    asUser('viewer-2');
    // @ts-ignore
    prisma.follow.findMany.mockResolvedValue([
      { id: 'follow-2', followingId: 'other-user', createdAt: new Date(), following: makeUser('other-user', 'Bob') },
    ]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/following/viewer-2')
      .set('Authorization', tok('viewer-2'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // Response is now paginated: { items, nextCursor, hasMore }
    // @ts-ignore
    expect(Array.isArray(res.body.data.items)).toBe(true);
    // @ts-ignore
    expect(res.body.data.items[0].id).toBe('other-user');
    // @ts-ignore
    expect(res.body.data.items[0]).toHaveProperty('followedAt');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('nextCursor');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('hasMore');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FRIEND REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

// @ts-ignore
describe('Friend Requests', () => {
  // @ts-ignore
  let app;
  // @ts-ignore
  beforeAll(() => { app = buildSocialApp(); });

  // ── sendFriendRequest ─────────────────────────────────────────────────────

  // @ts-ignore
  test('sendFriendRequest — happy path creates PENDING request', async () => {
    asUser('sender-1');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-1', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-1'));
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue(null);
    // @ts-ignore
    prisma.friendRequest.create.mockResolvedValue({ id: 'fr-1', status: 'PENDING', senderId: 'sender-1', receiverId: 'receiver-1' });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-1')
      .set('Authorization', tok('sender-1'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.status).toBe('pending');
    // @ts-ignore
    const createData = prisma.friendRequest.create.mock.calls[0][0].data;
    // @ts-ignore
    expect(createData.senderId).toBe('sender-1');
    // @ts-ignore
    expect(createData.receiverId).toBe('receiver-1');
  });

  // @ts-ignore
  test('sendFriendRequest — self-request returns 400', async () => {
    asUser('self-fr');

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/self-fr')
      .set('Authorization', tok('self-fr'));

    // @ts-ignore
    expect(res.status).toBe(400);
    // @ts-ignore
    expect(res.body.message).toMatch(/yourself/i);
    // @ts-ignore
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  // @ts-ignore
  test('sendFriendRequest — user not found returns 404', async () => {
    asUser('sender-2');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-2', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(null); // target user not found

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/nonexistent-user')
      .set('Authorization', tok('sender-2'));

    // @ts-ignore
    expect(res.status).toBe(404);
    // @ts-ignore
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  // @ts-ignore
  test('sendFriendRequest — already friends returns 400', async () => {
    asUser('sender-3');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-3', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-3'));
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-existing', status: 'ACCEPTED', senderId: 'sender-3', receiverId: 'receiver-3',
    });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-3')
      .set('Authorization', tok('sender-3'));

    // @ts-ignore
    expect(res.status).toBe(400);
    // @ts-ignore
    expect(res.body.message).toMatch(/already friends/i);
  });

  // @ts-ignore
  test('sendFriendRequest — already sent (PENDING) returns 400', async () => {
    asUser('sender-4');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-4', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-4'));
    // Existing PENDING where sender-4 is the sender — already sent
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-pending', status: 'PENDING', senderId: 'sender-4', receiverId: 'receiver-4',
    });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-4')
      .set('Authorization', tok('sender-4'));

    // @ts-ignore
    expect(res.status).toBe(400);
    // @ts-ignore
    expect(res.body.message).toMatch(/already sent/i);
  });

  // @ts-ignore
  test('sendFriendRequest — re-send after rejection updates existing record', async () => {
    asUser('sender-5');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-5', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-5'));
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-rejected', status: 'REJECTED', senderId: 'sender-5', receiverId: 'receiver-5',
    });
    // @ts-ignore
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-rejected', status: 'PENDING' });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-5')
      .set('Authorization', tok('sender-5'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.status).toBe('pending');
    // Must update rather than create a new record
    // @ts-ignore
    expect(prisma.friendRequest.update).toHaveBeenCalledTimes(1);
    // @ts-ignore
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    // @ts-ignore
    const updateData = prisma.friendRequest.update.mock.calls[0][0].data;
    // @ts-ignore
    expect(updateData.status).toBe('PENDING');
  });

  // @ts-ignore
  test('sendFriendRequest — auto-accepts when receiver already sent a request', async () => {
    asUser('sender-6');
    prisma.user.findUnique
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'sender-6', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-6'));
    // Existing PENDING where receiver-6 is the sender (they sent to us first)
    prisma.friendRequest.findFirst
      // @ts-ignore
      .mockResolvedValueOnce({
        id: 'fr-theirs', status: 'PENDING', senderId: 'receiver-6', receiverId: 'sender-6',
      })
      // acceptFriendRequest re-queries for the pending request with flipped roles
      .mockResolvedValueOnce({
        id: 'fr-theirs', status: 'PENDING', senderId: 'receiver-6', receiverId: 'sender-6',
      });
    // @ts-ignore
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-theirs', status: 'ACCEPTED' });
    // @ts-ignore
    prisma.follow.upsert.mockResolvedValue({});

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-6')
      .set('Authorization', tok('sender-6'));

    // Auto-accept path: should return accepted status
    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.status).toBe('accepted');
  });

  // ── acceptFriendRequest ───────────────────────────────────────────────────

  // @ts-ignore
  test('acceptFriendRequest — only receiver can accept (non-receiver gets 404)', async () => {
    asUser('wrong-user');
    // No pending request where wrong-user is the receiver
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/accept/sender-x')
      .set('Authorization', tok('wrong-user'));

    // @ts-ignore
    expect(res.status).toBe(404);
  });

  // @ts-ignore
  test('acceptFriendRequest — success sets ACCEPTED and auto-follows both users', async () => {
    asUser('receiver-acc');
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-accept', status: 'PENDING', senderId: 'sender-acc', receiverId: 'receiver-acc',
    });
    // @ts-ignore
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-accept', status: 'ACCEPTED' });
    // @ts-ignore
    prisma.follow.upsert.mockResolvedValue({});

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/accept/sender-acc')
      .set('Authorization', tok('receiver-acc'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.status).toBe('accepted');
    // Both users should now follow each other
    // @ts-ignore
    expect(prisma.follow.upsert).toHaveBeenCalledTimes(2);
    // @ts-ignore
    const upsertCalls = prisma.follow.upsert.mock.calls.map(c => c[0].create);
    // @ts-ignore
    const followerIds = upsertCalls.map(d => d.followerId).sort();
    // @ts-ignore
    expect(followerIds).toContain('receiver-acc');
    // @ts-ignore
    expect(followerIds).toContain('sender-acc');
  });

  // ── rejectFriendRequest ───────────────────────────────────────────────────

  // @ts-ignore
  test('rejectFriendRequest — non-receiver gets 404', async () => {
    asUser('not-receiver');
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/reject/some-sender')
      .set('Authorization', tok('not-receiver'));

    // @ts-ignore
    expect(res.status).toBe(404);
  });

  // @ts-ignore
  test('rejectFriendRequest — success sets REJECTED status', async () => {
    asUser('receiver-rej');
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-rej', status: 'PENDING', senderId: 'sender-rej', receiverId: 'receiver-rej',
    });
    // @ts-ignore
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-rej', status: 'REJECTED' });

    // @ts-ignore
    const res = await request(app)
      .post('/api/v1/social/friends/reject/sender-rej')
      .set('Authorization', tok('receiver-rej'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.status).toBe('rejected');
    // @ts-ignore
    const updateData = prisma.friendRequest.update.mock.calls[0][0].data;
    // @ts-ignore
    expect(updateData.status).toBe('REJECTED');
  });

  // ── cancelFriendRequest ───────────────────────────────────────────────────

  // @ts-ignore
  test('cancelFriendRequest — non-sender gets 404', async () => {
    asUser('not-sender');
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    // @ts-ignore
    const res = await request(app)
      .delete('/api/v1/social/friends/request/some-receiver')
      .set('Authorization', tok('not-sender'));

    // @ts-ignore
    expect(res.status).toBe(404);
  });

  // @ts-ignore
  test('cancelFriendRequest — sender can cancel their own PENDING request', async () => {
    asUser('sender-cancel');
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-cancel', status: 'PENDING', senderId: 'sender-cancel', receiverId: 'recv-cancel',
    });
    // @ts-ignore
    prisma.friendRequest.delete.mockResolvedValue({});

    // @ts-ignore
    const res = await request(app)
      .delete('/api/v1/social/friends/request/recv-cancel')
      .set('Authorization', tok('sender-cancel'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(prisma.friendRequest.delete).toHaveBeenCalledTimes(1);
    // @ts-ignore
    const deleteWhere = prisma.friendRequest.delete.mock.calls[0][0].where;
    // @ts-ignore
    expect(deleteWhere.id).toBe('fr-cancel');
  });

  // ── removeFriend ──────────────────────────────────────────────────────────

  // @ts-ignore
  test('removeFriend — deletes ACCEPTED friend request record', async () => {
    asUser('me-remove');
    // @ts-ignore
    prisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });

    // @ts-ignore
    const res = await request(app)
      .delete('/api/v1/social/friends/other-remove')
      .set('Authorization', tok('me-remove'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    const deleteWhere = prisma.friendRequest.deleteMany.mock.calls[0][0].where;
    // @ts-ignore
    expect(deleteWhere.status).toBe('ACCEPTED');
    // @ts-ignore
    expect(deleteWhere.OR).toEqual(expect.arrayContaining([
      // @ts-ignore
      expect.objectContaining({ senderId: 'me-remove', receiverId: 'other-remove' }),
      // @ts-ignore
      expect.objectContaining({ senderId: 'other-remove', receiverId: 'me-remove' }),
    ]));
  });

  // ── getFriends ────────────────────────────────────────────────────────────

  // @ts-ignore
  test('getFriends — returns accepted friends list', async () => {
    asUser('me-friends');
    const sender = makeUser('friend-a', 'Alice');
    const receiver = makeUser('friend-b', 'Bob');
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-a1', status: 'ACCEPTED', senderId: 'me-friends', receiverId: 'friend-b', updatedAt: new Date(), sender: makeUser('me-friends', 'Me'), receiver },
      { id: 'fr-a2', status: 'ACCEPTED', senderId: 'friend-a', receiverId: 'me-friends', updatedAt: new Date(), sender, receiver: makeUser('me-friends', 'Me') },
    ]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/friends')
      .set('Authorization', tok('me-friends'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(Array.isArray(res.body.data)).toBe(true);
    // @ts-ignore
    expect(res.body.data.length).toBe(2);
    // For senderId === me, return receiver; otherwise return sender
    // @ts-ignore
    const ids = res.body.data.map(f => f.id).sort();
    // @ts-ignore
    expect(ids).toContain('friend-a');
    // @ts-ignore
    expect(ids).toContain('friend-b');
  });

  // ── getIncomingRequests ───────────────────────────────────────────────────

  // @ts-ignore
  test('getIncomingRequests — returns shape { requestId, user, sentAt }', async () => {
    asUser('me-incoming');
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-inc-1', status: 'PENDING', receiverId: 'me-incoming', senderId: 'stranger-1', createdAt: new Date(), sender: makeUser('stranger-1', 'Stranger') },
    ]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/friends/requests')
      .set('Authorization', tok('me-incoming'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(Array.isArray(res.body.data)).toBe(true);
    const item = res.body.data[0];
    // @ts-ignore
    expect(item).toHaveProperty('requestId', 'fr-inc-1');
    // @ts-ignore
    expect(item).toHaveProperty('user');
    // @ts-ignore
    expect(item).toHaveProperty('sentAt');
    // @ts-ignore
    expect(item.user.id).toBe('stranger-1');
  });

  // ── getSentRequests ───────────────────────────────────────────────────────

  // @ts-ignore
  test('getSentRequests — returns shape { requestId, user, sentAt }', async () => {
    asUser('me-sent');
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-sent-1', status: 'PENDING', senderId: 'me-sent', receiverId: 'target-sent', createdAt: new Date(), receiver: makeUser('target-sent', 'Target') },
    ]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/friends/requests/sent')
      .set('Authorization', tok('me-sent'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(Array.isArray(res.body.data)).toBe(true);
    const item = res.body.data[0];
    // @ts-ignore
    expect(item).toHaveProperty('requestId', 'fr-sent-1');
    // @ts-ignore
    expect(item).toHaveProperty('user');
    // @ts-ignore
    expect(item.user.id).toBe('target-sent');
  });

  // ── getSocialCounts — friendStatus field ──────────────────────────────────

  // @ts-ignore
  test('getSocialCounts — returns friendStatus "friends" when ACCEPTED', async () => {
    asUser('counter-1');
    // @ts-ignore
    prisma.follow.count.mockResolvedValue(5);
    // @ts-ignore
    prisma.friendRequest.count.mockResolvedValue(3);
    // @ts-ignore
    prisma.follow.findUnique.mockResolvedValue({ id: 'fol-x' });
    prisma.friendRequest.findFirst
      // @ts-ignore
      .mockResolvedValueOnce({ id: 'fr-x', status: 'ACCEPTED', senderId: 'counter-1', receiverId: 'target-cnt' })
      .mockResolvedValueOnce([]) // myFR
      .mockResolvedValueOnce([]); // theirFR
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/counts/target-cnt')
      .set('Authorization', tok('counter-1'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data).toHaveProperty('friendStatus', 'friends');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('followers');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('following');
    // @ts-ignore
    expect(res.body.data).toHaveProperty('isFollowing');
  });

  // @ts-ignore
  test('getSocialCounts — returns friendStatus "pending_sent" when I sent request', async () => {
    asUser('counter-2');
    // @ts-ignore
    prisma.follow.count.mockResolvedValue(0);
    // @ts-ignore
    prisma.friendRequest.count.mockResolvedValue(0);
    // @ts-ignore
    prisma.follow.findUnique.mockResolvedValue(null);
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValueOnce({
      id: 'fr-pending', status: 'PENDING', senderId: 'counter-2', receiverId: 'target-2',
    });
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/counts/target-2')
      .set('Authorization', tok('counter-2'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.friendStatus).toBe('pending_sent');
  });

  // @ts-ignore
  test('getSocialCounts — returns friendStatus "pending_received" when they sent request', async () => {
    asUser('counter-3');
    // @ts-ignore
    prisma.follow.count.mockResolvedValue(0);
    // @ts-ignore
    prisma.friendRequest.count.mockResolvedValue(0);
    // @ts-ignore
    prisma.follow.findUnique.mockResolvedValue(null);
    // @ts-ignore
    prisma.friendRequest.findFirst.mockResolvedValueOnce({
      id: 'fr-theirpend', status: 'PENDING', senderId: 'target-3', receiverId: 'counter-3',
    });
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/counts/target-3')
      .set('Authorization', tok('counter-3'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data.friendStatus).toBe('pending_received');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MF-002 — Block enforcement in searchUsers
// ═══════════════════════════════════════════════════════════════════════════════

// @ts-ignore
describe('Block enforcement — searchUsers', () => {
  // @ts-ignore
  let app;
  // @ts-ignore
  beforeAll(() => { app = buildSocialApp(); });

  // @ts-ignore
  function makeUserResult(id, firstName) {
    return {
      id, firstName, lastName: 'User', email: `${id}@example.com`,
      avatarUrl: null, role: 'MEMBER', schoolId: null, bio: null,
      username: id,
    };
  }

  // @ts-ignore
  test('searchUsers — no blocks: returns matching users', async () => {
    asUser('searcher-1');
    const alice = makeUserResult('alice-id', 'Alice');
    // @ts-ignore
    prisma.user.findMany.mockResolvedValue([alice]);
    // @ts-ignore
    prisma.userBlock.findMany.mockResolvedValue([]); // no blocks
    // @ts-ignore
    prisma.follow.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/search?q=Alice')
      .set('Authorization', tok('searcher-1'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(Array.isArray(res.body.data)).toBe(true);
    // Block query must be called before user search
    // @ts-ignore
    expect(prisma.userBlock.findMany).toHaveBeenCalledWith(
      // @ts-ignore
      expect.objectContaining({
        where: { OR: [{ blockerId: 'searcher-1' }, { blockedId: 'searcher-1' }] }
      })
    );
    // user.findMany is called with the NOT exclusion (empty set → no NOT clause)
    // @ts-ignore
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  // @ts-ignore
  test('searchUsers — requester blocked target: target excluded from results', async () => {
    asUser('searcher-2');
    // Simulate: searcher blocked 'blocked-user-id'
    // @ts-ignore
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'searcher-2', blockedId: 'blocked-user-id' }
    ]);
    // user.findMany returns empty because Prisma respects the NOT clause
    // (In unit tests, the mock receives the full where clause — verify it contains NOT)
    // @ts-ignore
    prisma.user.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.follow.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/search?q=blocked')
      .set('Authorization', tok('searcher-2'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // Verify the NOT exclusion was passed to user.findMany
    // @ts-ignore
    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    // @ts-ignore
    expect(whereArg).toHaveProperty('NOT');
    // @ts-ignore
    expect(whereArg.NOT).toMatchObject({ id: { in: ['blocked-user-id'] } });
  });

  // @ts-ignore
  test('searchUsers — target blocked requester: target excluded from results', async () => {
    asUser('searcher-3');
    // Simulate: 'blocking-user-id' blocked the searcher
    // @ts-ignore
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'blocking-user-id', blockedId: 'searcher-3' }
    ]);
    // @ts-ignore
    prisma.user.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.follow.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/search?q=blocking')
      .set('Authorization', tok('searcher-3'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    // @ts-ignore
    expect(whereArg).toHaveProperty('NOT');
    // @ts-ignore
    expect(whereArg.NOT).toMatchObject({ id: { in: ['blocking-user-id'] } });
  });

  // @ts-ignore
  test('searchUsers — multiple blocks: all excluded', async () => {
    asUser('searcher-4');
    // Two blocks in different directions
    // @ts-ignore
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'searcher-4',  blockedId: 'blocked-a' },
      { blockerId: 'blocking-b',  blockedId: 'searcher-4' },
    ]);
    // @ts-ignore
    prisma.user.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.follow.findMany.mockResolvedValue([]);
    // @ts-ignore
    prisma.friendRequest.findMany.mockResolvedValue([]);

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/search?q=test')
      .set('Authorization', tok('searcher-4'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    const whereArg = prisma.user.findMany.mock.calls[0][0].where;
    // @ts-ignore
    expect(whereArg.NOT.id.in).toEqual(expect.arrayContaining(['blocked-a', 'blocking-b']));
    // @ts-ignore
    expect(whereArg.NOT.id.in).toHaveLength(2);
  });

  // @ts-ignore
  test('searchUsers — short query: returns empty without hitting DB', async () => {
    asUser('searcher-5');

    // @ts-ignore
    const res = await request(app)
      .get('/api/v1/social/search?q=a') // too short (< 2 chars)
      .set('Authorization', tok('searcher-5'));

    // @ts-ignore
    expect(res.status).toBe(200);
    // @ts-ignore
    expect(res.body.data).toEqual([]);
    // @ts-ignore
    expect(prisma.userBlock.findMany).not.toHaveBeenCalled();
    // @ts-ignore
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
