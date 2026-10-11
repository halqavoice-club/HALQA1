'use strict';
/**
 * Social Friends & Follow Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers GAP-003 (Follow state machine) and GAP-005 (Friend Request state machine)
 * in social.controller.js.
 *
 * All tests use mocked Prisma — no real DB required.
 */

jest.mock('../utils/prisma');
jest.mock('../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../utils/storage', () => ({
  saveFile:   jest.fn().mockResolvedValue({ url: '/uploads/test.jpg' }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/notification.service', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/contentFilter', () => ({
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
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }

function asUser(id, role) {
  role = role || 'MEMBER';
  const u = {
    id, role, status: 'ACTIVE', schoolId: null,
    firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId: null });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function makeUser(id, firstName) {
  firstName = firstName || 'Other';
  return {
    id, firstName, lastName: 'User', email: `${id}@test.com`,
    avatarUrl: null, role: 'MEMBER', schoolId: null, bio: null,
  };
}

// ─── beforeEach ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);

  // Ensure optional prisma sub-objects are initialised (Jest auto-mock does not
  // create models that aren't accessed at module load time)
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  if (!prisma.friendRequest) prisma.friendRequest = {};
  prisma.friendRequest.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.friendRequest.findMany   = jest.fn().mockResolvedValue([]);
  prisma.friendRequest.create     = jest.fn().mockResolvedValue({});
  prisma.friendRequest.update     = jest.fn().mockResolvedValue({});
  prisma.friendRequest.delete     = jest.fn().mockResolvedValue({});
  prisma.friendRequest.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  prisma.friendRequest.count      = jest.fn().mockResolvedValue(0);

  if (!prisma.follow) prisma.follow = {};
  prisma.follow.findUnique  = jest.fn().mockResolvedValue(null);
  prisma.follow.findMany    = jest.fn().mockResolvedValue([]);
  prisma.follow.create      = jest.fn().mockResolvedValue({});
  prisma.follow.deleteMany  = jest.fn().mockResolvedValue({ count: 0 });
  prisma.follow.upsert      = jest.fn().mockResolvedValue({});
  prisma.follow.count       = jest.fn().mockResolvedValue(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FOLLOW
// ═══════════════════════════════════════════════════════════════════════════════

describe('Follow', () => {
  let app;
  beforeAll(() => { app = buildSocialApp(); });

  test('followUser — happy path returns { following: true }', async () => {
    asUser('user-a');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-a', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('user-b'));
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.follow.create.mockResolvedValue({ id: 'fol-1' });

    const res = await request(app)
      .post('/api/v1/social/follow/user-b')
      .set('Authorization', tok('user-a'));

    expect(res.status).toBe(200);
    expect(res.body.data.following).toBe(true);
    expect(prisma.follow.create).toHaveBeenCalledTimes(1);
    const createData = prisma.follow.create.mock.calls[0][0].data;
    expect(createData.followerId).toBe('user-a');
    expect(createData.followingId).toBe('user-b');
  });

  test('followUser — self-follow returns 400', async () => {
    asUser('self-user');

    const res = await request(app)
      .post('/api/v1/social/follow/self-user')
      .set('Authorization', tok('self-user'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  test('followUser — already following returns 200 idempotent (no new record)', async () => {
    asUser('user-c');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-c', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('user-d'));
    prisma.follow.findUnique.mockResolvedValue({ id: 'fol-existing' });

    const res = await request(app)
      .post('/api/v1/social/follow/user-d')
      .set('Authorization', tok('user-c'));

    expect(res.status).toBe(200);
    expect(res.body.data.following).toBe(true);
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  test('unfollowUser — returns { following: false } (idempotent)', async () => {
    asUser('user-e');
    prisma.follow.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete('/api/v1/social/follow/user-f')
      .set('Authorization', tok('user-e'));

    expect(res.status).toBe(200);
    expect(res.body.data.following).toBe(false);
    const deleteWhere = prisma.follow.deleteMany.mock.calls[0][0].where;
    expect(deleteWhere.followerId).toBe('user-e');
    expect(deleteWhere.followingId).toBe('user-f');
  });

  test('getFollowers — returns follower list with iFollowThem field', async () => {
    asUser('viewer-1');
    prisma.follow.findMany
      .mockResolvedValueOnce([
        { followerId: 'follower-a', createdAt: new Date(), follower: makeUser('follower-a', 'Alice') },
      ])
      .mockResolvedValueOnce([]); // viewer's following set

    const res = await request(app)
      .get('/api/v1/social/followers/target-user')
      .set('Authorization', tok('viewer-1'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('iFollowThem');
    expect(res.body.data[0].id).toBe('follower-a');
  });

  test('getFollowing — returns following list', async () => {
    asUser('viewer-2');
    prisma.follow.findMany.mockResolvedValue([
      { followingId: 'other-user', createdAt: new Date(), following: makeUser('other-user', 'Bob') },
    ]);

    const res = await request(app)
      .get('/api/v1/social/following/viewer-2')
      .set('Authorization', tok('viewer-2'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe('other-user');
    expect(res.body.data[0]).toHaveProperty('followedAt');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FRIEND REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Friend Requests', () => {
  let app;
  beforeAll(() => { app = buildSocialApp(); });

  // ── sendFriendRequest ─────────────────────────────────────────────────────

  test('sendFriendRequest — happy path creates PENDING request', async () => {
    asUser('sender-1');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-1', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-1'));
    prisma.friendRequest.findFirst.mockResolvedValue(null);
    prisma.friendRequest.create.mockResolvedValue({ id: 'fr-1', status: 'PENDING', senderId: 'sender-1', receiverId: 'receiver-1' });

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-1')
      .set('Authorization', tok('sender-1'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    const createData = prisma.friendRequest.create.mock.calls[0][0].data;
    expect(createData.senderId).toBe('sender-1');
    expect(createData.receiverId).toBe('receiver-1');
  });

  test('sendFriendRequest — self-request returns 400', async () => {
    asUser('self-fr');

    const res = await request(app)
      .post('/api/v1/social/friends/request/self-fr')
      .set('Authorization', tok('self-fr'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/yourself/i);
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  test('sendFriendRequest — user not found returns 404', async () => {
    asUser('sender-2');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-2', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(null); // target user not found

    const res = await request(app)
      .post('/api/v1/social/friends/request/nonexistent-user')
      .set('Authorization', tok('sender-2'));

    expect(res.status).toBe(404);
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  });

  test('sendFriendRequest — already friends returns 400', async () => {
    asUser('sender-3');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-3', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-3'));
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-existing', status: 'ACCEPTED', senderId: 'sender-3', receiverId: 'receiver-3',
    });

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-3')
      .set('Authorization', tok('sender-3'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already friends/i);
  });

  test('sendFriendRequest — already sent (PENDING) returns 400', async () => {
    asUser('sender-4');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-4', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-4'));
    // Existing PENDING where sender-4 is the sender — already sent
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-pending', status: 'PENDING', senderId: 'sender-4', receiverId: 'receiver-4',
    });

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-4')
      .set('Authorization', tok('sender-4'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already sent/i);
  });

  test('sendFriendRequest — re-send after rejection updates existing record', async () => {
    asUser('sender-5');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-5', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-5'));
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-rejected', status: 'REJECTED', senderId: 'sender-5', receiverId: 'receiver-5',
    });
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-rejected', status: 'PENDING' });

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-5')
      .set('Authorization', tok('sender-5'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    // Must update rather than create a new record
    expect(prisma.friendRequest.update).toHaveBeenCalledTimes(1);
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    const updateData = prisma.friendRequest.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('PENDING');
  });

  test('sendFriendRequest — auto-accepts when receiver already sent a request', async () => {
    asUser('sender-6');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'sender-6', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce(makeUser('receiver-6'));
    // Existing PENDING where receiver-6 is the sender (they sent to us first)
    prisma.friendRequest.findFirst
      .mockResolvedValueOnce({
        id: 'fr-theirs', status: 'PENDING', senderId: 'receiver-6', receiverId: 'sender-6',
      })
      // acceptFriendRequest re-queries for the pending request with flipped roles
      .mockResolvedValueOnce({
        id: 'fr-theirs', status: 'PENDING', senderId: 'receiver-6', receiverId: 'sender-6',
      });
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-theirs', status: 'ACCEPTED' });
    prisma.follow.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-6')
      .set('Authorization', tok('sender-6'));

    // Auto-accept path: should return accepted status
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');
  });

  // ── acceptFriendRequest ───────────────────────────────────────────────────

  test('acceptFriendRequest — only receiver can accept (non-receiver gets 404)', async () => {
    asUser('wrong-user');
    // No pending request where wrong-user is the receiver
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/social/friends/accept/sender-x')
      .set('Authorization', tok('wrong-user'));

    expect(res.status).toBe(404);
  });

  test('acceptFriendRequest — success sets ACCEPTED and auto-follows both users', async () => {
    asUser('receiver-acc');
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-accept', status: 'PENDING', senderId: 'sender-acc', receiverId: 'receiver-acc',
    });
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-accept', status: 'ACCEPTED' });
    prisma.follow.upsert.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/social/friends/accept/sender-acc')
      .set('Authorization', tok('receiver-acc'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');
    // Both users should now follow each other
    expect(prisma.follow.upsert).toHaveBeenCalledTimes(2);
    const upsertCalls = prisma.follow.upsert.mock.calls.map(c => c[0].create);
    const followerIds = upsertCalls.map(d => d.followerId).sort();
    expect(followerIds).toContain('receiver-acc');
    expect(followerIds).toContain('sender-acc');
  });

  // ── rejectFriendRequest ───────────────────────────────────────────────────

  test('rejectFriendRequest — non-receiver gets 404', async () => {
    asUser('not-receiver');
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/social/friends/reject/some-sender')
      .set('Authorization', tok('not-receiver'));

    expect(res.status).toBe(404);
  });

  test('rejectFriendRequest — success sets REJECTED status', async () => {
    asUser('receiver-rej');
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-rej', status: 'PENDING', senderId: 'sender-rej', receiverId: 'receiver-rej',
    });
    prisma.friendRequest.update.mockResolvedValue({ id: 'fr-rej', status: 'REJECTED' });

    const res = await request(app)
      .post('/api/v1/social/friends/reject/sender-rej')
      .set('Authorization', tok('receiver-rej'));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    const updateData = prisma.friendRequest.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('REJECTED');
  });

  // ── cancelFriendRequest ───────────────────────────────────────────────────

  test('cancelFriendRequest — non-sender gets 404', async () => {
    asUser('not-sender');
    prisma.friendRequest.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/social/friends/request/some-receiver')
      .set('Authorization', tok('not-sender'));

    expect(res.status).toBe(404);
  });

  test('cancelFriendRequest — sender can cancel their own PENDING request', async () => {
    asUser('sender-cancel');
    prisma.friendRequest.findFirst.mockResolvedValue({
      id: 'fr-cancel', status: 'PENDING', senderId: 'sender-cancel', receiverId: 'recv-cancel',
    });
    prisma.friendRequest.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/social/friends/request/recv-cancel')
      .set('Authorization', tok('sender-cancel'));

    expect(res.status).toBe(200);
    expect(prisma.friendRequest.delete).toHaveBeenCalledTimes(1);
    const deleteWhere = prisma.friendRequest.delete.mock.calls[0][0].where;
    expect(deleteWhere.id).toBe('fr-cancel');
  });

  // ── removeFriend ──────────────────────────────────────────────────────────

  test('removeFriend — deletes ACCEPTED friend request record', async () => {
    asUser('me-remove');
    prisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete('/api/v1/social/friends/other-remove')
      .set('Authorization', tok('me-remove'));

    expect(res.status).toBe(200);
    const deleteWhere = prisma.friendRequest.deleteMany.mock.calls[0][0].where;
    expect(deleteWhere.status).toBe('ACCEPTED');
    expect(deleteWhere.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ senderId: 'me-remove', receiverId: 'other-remove' }),
      expect.objectContaining({ senderId: 'other-remove', receiverId: 'me-remove' }),
    ]));
  });

  // ── getFriends ────────────────────────────────────────────────────────────

  test('getFriends — returns accepted friends list', async () => {
    asUser('me-friends');
    const sender = makeUser('friend-a', 'Alice');
    const receiver = makeUser('friend-b', 'Bob');
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-a1', status: 'ACCEPTED', senderId: 'me-friends', receiverId: 'friend-b', updatedAt: new Date(), sender: makeUser('me-friends', 'Me'), receiver },
      { id: 'fr-a2', status: 'ACCEPTED', senderId: 'friend-a', receiverId: 'me-friends', updatedAt: new Date(), sender, receiver: makeUser('me-friends', 'Me') },
    ]);

    const res = await request(app)
      .get('/api/v1/social/friends')
      .set('Authorization', tok('me-friends'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    // For senderId === me, return receiver; otherwise return sender
    const ids = res.body.data.map(f => f.id).sort();
    expect(ids).toContain('friend-a');
    expect(ids).toContain('friend-b');
  });

  // ── getIncomingRequests ───────────────────────────────────────────────────

  test('getIncomingRequests — returns shape { requestId, user, sentAt }', async () => {
    asUser('me-incoming');
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-inc-1', status: 'PENDING', receiverId: 'me-incoming', senderId: 'stranger-1', createdAt: new Date(), sender: makeUser('stranger-1', 'Stranger') },
    ]);

    const res = await request(app)
      .get('/api/v1/social/friends/requests')
      .set('Authorization', tok('me-incoming'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const item = res.body.data[0];
    expect(item).toHaveProperty('requestId', 'fr-inc-1');
    expect(item).toHaveProperty('user');
    expect(item).toHaveProperty('sentAt');
    expect(item.user.id).toBe('stranger-1');
  });

  // ── getSentRequests ───────────────────────────────────────────────────────

  test('getSentRequests — returns shape { requestId, user, sentAt }', async () => {
    asUser('me-sent');
    prisma.friendRequest.findMany.mockResolvedValue([
      { id: 'fr-sent-1', status: 'PENDING', senderId: 'me-sent', receiverId: 'target-sent', createdAt: new Date(), receiver: makeUser('target-sent', 'Target') },
    ]);

    const res = await request(app)
      .get('/api/v1/social/friends/requests/sent')
      .set('Authorization', tok('me-sent'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const item = res.body.data[0];
    expect(item).toHaveProperty('requestId', 'fr-sent-1');
    expect(item).toHaveProperty('user');
    expect(item.user.id).toBe('target-sent');
  });

  // ── getSocialCounts — friendStatus field ──────────────────────────────────

  test('getSocialCounts — returns friendStatus "friends" when ACCEPTED', async () => {
    asUser('counter-1');
    prisma.follow.count.mockResolvedValue(5);
    prisma.friendRequest.count.mockResolvedValue(3);
    prisma.follow.findUnique.mockResolvedValue({ id: 'fol-x' });
    prisma.friendRequest.findFirst
      .mockResolvedValueOnce({ id: 'fr-x', status: 'ACCEPTED', senderId: 'counter-1', receiverId: 'target-cnt' })
      .mockResolvedValueOnce([]) // myFR
      .mockResolvedValueOnce([]); // theirFR
    prisma.friendRequest.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/social/counts/target-cnt')
      .set('Authorization', tok('counter-1'));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('friendStatus', 'friends');
    expect(res.body.data).toHaveProperty('followers');
    expect(res.body.data).toHaveProperty('following');
    expect(res.body.data).toHaveProperty('isFollowing');
  });

  test('getSocialCounts — returns friendStatus "pending_sent" when I sent request', async () => {
    asUser('counter-2');
    prisma.follow.count.mockResolvedValue(0);
    prisma.friendRequest.count.mockResolvedValue(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.friendRequest.findFirst.mockResolvedValueOnce({
      id: 'fr-pending', status: 'PENDING', senderId: 'counter-2', receiverId: 'target-2',
    });
    prisma.friendRequest.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/social/counts/target-2')
      .set('Authorization', tok('counter-2'));

    expect(res.status).toBe(200);
    expect(res.body.data.friendStatus).toBe('pending_sent');
  });

  test('getSocialCounts — returns friendStatus "pending_received" when they sent request', async () => {
    asUser('counter-3');
    prisma.follow.count.mockResolvedValue(0);
    prisma.friendRequest.count.mockResolvedValue(0);
    prisma.follow.findUnique.mockResolvedValue(null);
    prisma.friendRequest.findFirst.mockResolvedValueOnce({
      id: 'fr-theirpend', status: 'PENDING', senderId: 'target-3', receiverId: 'counter-3',
    });
    prisma.friendRequest.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/social/counts/target-3')
      .set('Authorization', tok('counter-3'));

    expect(res.status).toBe(200);
    expect(res.body.data.friendStatus).toBe('pending_received');
  });
});
