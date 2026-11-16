'use strict';
/**
 * P1 Privacy Fixes Regression Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-A: getFeed cursor pagination preserves block predicates (where.NOT merge)
 * P1-C: getUserPosts enforces bilateral block policy
 * P1-B: getPost enforces visibility and block policy
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

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ─── App builder (same pattern as post-reactions-comments.test.js) ────────────

function buildPostApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/posts', require('../routes/post.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }

/**
 * asUser — set up verifyAccessToken mock and user findUnique stub.
 * extra: optional extra fields to merge into the user object (e.g. schoolId).
 */
function asUser(id, role, extra) {
  role = role || 'MEMBER';
  extra = extra || {};
  const u = Object.assign({
    id, role, status: 'ACTIVE', schoolId: null,
    firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null,
  }, extra);
  verifyAccessToken.mockReturnValue(Object.assign({ userId: id, role, schoolId: null }, extra));
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

/** Minimal post stub matching POST_INCLUDE shape */
function makePost(id, authorId, opts) {
  opts = opts || {};
  return {
    id,
    authorId: authorId || 'author-default',
    visibility: opts.visibility || 'PUBLIC',
    deletedAt: null,
    isDraft: false,
    isExclusive: opts.isExclusive || false,
    type: 'TEXT',
    body: 'Post body',
    schoolId: opts.schoolId || null,
    likeCount: 0, commentCount: 0, viewCount: 0,
    shareCount: 0, bookmarkCount: 0,
    isPinned: false, scheduledAt: null,
    createdAt: new Date('2024-01-15T12:00:00Z'),
    updatedAt: new Date('2024-01-15T12:00:00Z'),
    author: {
      id: authorId || 'author-default',
      firstName: 'Author', lastName: 'User',
      avatarUrl: null, role: 'MEMBER',
      schoolId: opts.authorSchoolId || null,
    },
    media: [], hashtags: [], community: null,
    reactions: [], bookmarks: [],
    _count: { reactions: 0, comments: 0 },
    originalPost: null,
  };
}

/** Sets up the standard mocks needed by visibilityFilter() in getFeed */
function setupFeedMocks(viewerId, opts) {
  opts = opts || {};
  const blocks    = opts.blocks    || [];
  const following = opts.following || [];
  const schoolId  = opts.schoolId  || null;

  prisma.user.findUnique.mockImplementation((args) => {
    if (args && args.where && args.where.id === viewerId) {
      return Promise.resolve({
        id: viewerId, schoolId, role: 'MEMBER', status: 'ACTIVE',
        firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
      });
    }
    return Promise.resolve(null);
  });
  prisma.follow.findMany.mockResolvedValue(following);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.userBlock.findMany.mockResolvedValue(blocks);
  prisma.creatorProfile.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);

  // Safe defaults for optional prisma sub-objects
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.auditLog) prisma.auditLog = {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});

  if (!prisma.userBlock) prisma.userBlock = {};
  prisma.userBlock.findMany  = jest.fn().mockResolvedValue([]);
  prisma.userBlock.findFirst = jest.fn().mockResolvedValue(null);

  if (!prisma.creatorSubscription) prisma.creatorSubscription = {};
  prisma.creatorSubscription.findMany  = jest.fn().mockResolvedValue([]);
  prisma.creatorSubscription.findFirst = jest.fn().mockResolvedValue(null);

  if (!prisma.creatorProfile) prisma.creatorProfile = {};
  prisma.creatorProfile.findMany  = jest.fn().mockResolvedValue([]);
  prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.follow) prisma.follow = {};
  prisma.follow.findMany  = jest.fn().mockResolvedValue([]);
  prisma.follow.findFirst = jest.fn().mockResolvedValue(null);

  if (!prisma.postMention) prisma.postMention = {};
  prisma.postMention.deleteMany = jest.fn().mockResolvedValue({});
  prisma.postMention.createMany = jest.fn().mockResolvedValue({});
  prisma.postMention.upsert     = jest.fn().mockResolvedValue({});

  if (!prisma.postView) prisma.postView = {};
  prisma.postView.create = jest.fn().mockResolvedValue({});

  if (!prisma.post) prisma.post = {};
  prisma.post.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.post.findMany   = jest.fn().mockResolvedValue([]);
  prisma.post.update     = jest.fn().mockResolvedValue({});

  if (!prisma.postBookmark) prisma.postBookmark = {};
  prisma.postBookmark.findMany = jest.fn().mockResolvedValue([]);

  // CF-20: stubs for new community queries added to visibilityFilter
  if (!prisma.communityMember) prisma.communityMember = {};
  prisma.communityMember.findMany  = jest.fn().mockResolvedValue([]);
  prisma.communityMember.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.community) prisma.community = {};
  prisma.community.findMany  = jest.fn().mockResolvedValue([]);
  prisma.community.findUnique = jest.fn().mockResolvedValue(null);

  if (!prisma.communityBan) prisma.communityBan = {};
  prisma.communityBan.findMany  = jest.fn().mockResolvedValue([]);
  prisma.communityBan.findFirst = jest.fn().mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-A: getFeed cursor pagination preserves block predicates
// ═══════════════════════════════════════════════════════════════════════════════
describe('P1-A: getFeed cursor pagination preserves block predicates', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('first page (no cursor) — block NOT clause present, no cursor exclusion', async () => {
    const viewerId  = 'viewer-a1';
    const blockedId = 'blocked-author-1';
    asUser(viewerId);
    setupFeedMocks(viewerId, {
      blocks: [{ blockerId: viewerId, blockedId: blockedId }]
    });
    prisma.post.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    // findMany should have been called with NOT containing block exclusion
    const callArgs = prisma.post.findMany.mock.calls[0][0];
    expect(callArgs.where.NOT).toBeDefined();
    // For a single blocked author, NOT is a plain object { authorId: { in: [...] } }
    expect(callArgs.where.NOT).toMatchObject({ authorId: { in: [blockedId] } });
  });

  test('cursor with 1 blocked author — where.NOT becomes array containing both predicates', async () => {
    const viewerId  = 'viewer-a2';
    const blockedId = 'blocked-author-2';
    const cursorPostId = 'post-cursor-1';
    const cursorTime   = new Date('2024-01-15T10:00:00Z').toISOString();
    const cursor       = `${cursorTime}_${cursorPostId}`;

    asUser(viewerId);
    setupFeedMocks(viewerId, {
      blocks: [{ blockerId: viewerId, blockedId: blockedId }]
    });
    prisma.post.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/posts/feed?cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const callArgs = prisma.post.findMany.mock.calls[0][0];

    // With a blocked author AND a cursor, where.NOT must be an array
    expect(Array.isArray(callArgs.where.NOT)).toBe(true);
    expect(callArgs.where.NOT).toHaveLength(2);

    // One element must contain the block exclusion
    const blockNot = callArgs.where.NOT.find(n => n.authorId);
    expect(blockNot).toBeDefined();
    expect(blockNot.authorId.in).toContain(blockedId);

    // The other element must contain the cursor id exclusion
    const cursorNot = callArgs.where.NOT.find(n => n.id);
    expect(cursorNot).toBeDefined();
    expect(cursorNot.id).toBe(cursorPostId);
  });

  test('cursor with no blocked authors — where.NOT is scalar { id: cursorId }', async () => {
    const viewerId     = 'viewer-a3';
    const cursorPostId = 'post-cursor-2';
    const cursorTime   = new Date('2024-01-15T10:00:00Z').toISOString();
    const cursor       = `${cursorTime}_${cursorPostId}`;

    asUser(viewerId);
    setupFeedMocks(viewerId, { blocks: [] });
    prisma.post.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/posts/feed?cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const callArgs = prisma.post.findMany.mock.calls[0][0];

    // No blocks → NOT must be scalar { id: cursorPostId }
    expect(Array.isArray(callArgs.where.NOT)).toBe(false);
    expect(callArgs.where.NOT).toEqual({ id: cursorPostId });
  });

  test('cursor with 2 blocked authors — both blocked IDs survive in NOT array', async () => {
    const viewerId   = 'viewer-a4';
    const blocked1   = 'blocked-author-a';
    const blocked2   = 'blocked-author-b';
    const cursorPostId = 'post-cursor-3';
    const cursorTime   = new Date('2024-01-15T10:00:00Z').toISOString();
    const cursor       = `${cursorTime}_${cursorPostId}`;

    asUser(viewerId);
    setupFeedMocks(viewerId, {
      blocks: [
        { blockerId: viewerId, blockedId: blocked1 },
        { blockerId: blocked2, blockedId: viewerId },
      ]
    });
    prisma.post.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/posts/feed?cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const callArgs = prisma.post.findMany.mock.calls[0][0];

    expect(Array.isArray(callArgs.where.NOT)).toBe(true);
    const blockNot = callArgs.where.NOT.find(n => n.authorId);
    expect(blockNot).toBeDefined();
    // Both blocked authors must appear in the exclusion list
    expect(blockNot.authorId.in).toContain(blocked1);
    expect(blockNot.authorId.in).toContain(blocked2);

    const cursorNot = callArgs.where.NOT.find(n => n.id);
    expect(cursorNot).toBeDefined();
    expect(cursorNot.id).toBe(cursorPostId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-C: getUserPosts enforces bilateral block policy
// ═══════════════════════════════════════════════════════════════════════════════
describe('P1-C: getUserPosts enforces bilateral block policy', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('viewer blocked profile owner → 404', async () => {
    const viewerId  = 'viewer-c1';
    const profileId = 'profile-c1';
    asUser(viewerId);
    // Viewer blocked the owner
    prisma.userBlock.findFirst.mockResolvedValue({
      id: 'block-1', blockerId: viewerId, blockedId: profileId
    });

    const res = await request(app)
      .get(`/api/v1/posts/user/${profileId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
    // Must not query posts when blocked
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  test('profile owner blocked viewer → 404', async () => {
    const viewerId  = 'viewer-c2';
    const profileId = 'profile-c2';
    asUser(viewerId);
    // Owner blocked the viewer (reverse direction)
    prisma.userBlock.findFirst.mockResolvedValue({
      id: 'block-2', blockerId: profileId, blockedId: viewerId
    });

    const res = await request(app)
      .get(`/api/v1/posts/user/${profileId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  test('no block, non-owner → 200 with non-private posts', async () => {
    const viewerId  = 'viewer-c3';
    const profileId = 'profile-c3';
    asUser(viewerId);
    prisma.userBlock.findFirst.mockResolvedValue(null); // no block
    const posts = [
      makePost('post-c1', profileId, { visibility: 'PUBLIC' }),
    ];
    prisma.post.findMany.mockResolvedValue(posts);
    prisma.follow.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/posts/user/${profileId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Block check was called
    expect(prisma.userBlock.findFirst).toHaveBeenCalledTimes(1);
    const blockCall = prisma.userBlock.findFirst.mock.calls[0][0];
    // Must check both directions
    const orConds = blockCall.where.OR;
    expect(orConds).toHaveLength(2);
    expect(orConds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerId: viewerId, blockedId: profileId }),
        expect.objectContaining({ blockerId: profileId, blockedId: viewerId }),
      ])
    );
  });

  test('owner viewing own posts (userId=me) → 200, block check skipped', async () => {
    const ownerId = 'owner-c4';
    asUser(ownerId);
    const posts = [
      makePost('post-c2', ownerId, { visibility: 'PRIVATE' }),
      makePost('post-c3', ownerId, { visibility: 'PUBLIC' }),
    ];
    prisma.post.findMany.mockResolvedValue(posts);
    prisma.follow.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/posts/user/me')
      .set('Authorization', tok(ownerId));

    expect(res.status).toBe(200);
    // Block check must NOT be called for the owner
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
    expect(res.body.data.items).toHaveLength(2);
  });

  test('owner viewing own posts by explicit userId → 200, block check skipped', async () => {
    const ownerId = 'owner-c5';
    asUser(ownerId);
    const posts = [makePost('post-c4', ownerId, { visibility: 'PUBLIC' })];
    prisma.post.findMany.mockResolvedValue(posts);
    prisma.follow.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/posts/user/${ownerId}`)
      .set('Authorization', tok(ownerId));

    expect(res.status).toBe(200);
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-B: getPost enforces visibility and block policy
// ═══════════════════════════════════════════════════════════════════════════════
describe('P1-B: getPost enforces visibility and block policy', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('nonexistent / deleted post → 404 (existing behavior preserved)', async () => {
    asUser('viewer-b0');
    prisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/nonexistent-post')
      .set('Authorization', tok('viewer-b0'));

    expect(res.status).toBe(404);
  });

  test('PUBLIC post, no blocks, no restrictions → 200', async () => {
    const viewerId = 'viewer-b1';
    const authorId = 'author-b1';
    asUser(viewerId);
    const post = makePost('post-b1', authorId, { visibility: 'PUBLIC' });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b1')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
  });

  test('PRIVATE post, non-owner → 404', async () => {
    const viewerId = 'viewer-b2';
    const authorId = 'author-b2';
    asUser(viewerId);
    const post = makePost('post-b2', authorId, { visibility: 'PRIVATE' });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b2')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('PRIVATE post, owner → 200', async () => {
    const ownerId = 'owner-b3';
    asUser(ownerId);
    const post = makePost('post-b3', ownerId, { visibility: 'PRIVATE' });
    prisma.post.findFirst.mockResolvedValue(post);

    const res = await request(app)
      .get('/api/v1/posts/post-b3')
      .set('Authorization', tok(ownerId));

    expect(res.status).toBe(200);
    // Owner path: block check must NOT be called
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
  });

  test('FOLLOWERS post, viewer is not a follower → 404', async () => {
    const viewerId = 'viewer-b4';
    const authorId = 'author-b4';
    asUser(viewerId);
    const post = makePost('post-b4', authorId, { visibility: 'FOLLOWERS' });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.follow.findFirst.mockResolvedValue(null); // not following

    const res = await request(app)
      .get('/api/v1/posts/post-b4')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('FOLLOWERS post, viewer follows the author → 200', async () => {
    const viewerId = 'viewer-b5';
    const authorId = 'author-b5';
    asUser(viewerId);
    const post = makePost('post-b5', authorId, { visibility: 'FOLLOWERS' });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.follow.findFirst.mockResolvedValue({ followerId: viewerId, followingId: authorId });

    const res = await request(app)
      .get('/api/v1/posts/post-b5')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
  });

  test('SCHOOL_ONLY post, viewer same school as author → 200', async () => {
    const viewerId  = 'viewer-b6';
    const authorId  = 'author-b6';
    const schoolId  = 'school-x';
    asUser(viewerId, 'MEMBER', { schoolId });
    const post = makePost('post-b6', authorId, {
      visibility: 'SCHOOL_ONLY', authorSchoolId: schoolId
    });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b6')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
  });

  test('SCHOOL_ONLY post, viewer different school from author → 404', async () => {
    const viewerId = 'viewer-b7';
    const authorId = 'author-b7';
    asUser(viewerId, 'MEMBER', { schoolId: 'school-y' });
    const post = makePost('post-b7', authorId, {
      visibility: 'SCHOOL_ONLY', authorSchoolId: 'school-z'
    });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b7')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('SCHOOL_ONLY post, viewer has no school → 404', async () => {
    const viewerId = 'viewer-b7b';
    const authorId = 'author-b7b';
    asUser(viewerId, 'MEMBER', { schoolId: null });
    const post = makePost('post-b7b', authorId, {
      visibility: 'SCHOOL_ONLY', authorSchoolId: 'school-z'
    });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    // No school membership either
    prisma.schoolMembership.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b7b')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('PUBLIC post, viewer blocked by author → 404', async () => {
    const viewerId = 'viewer-b8';
    const authorId = 'author-b8';
    asUser(viewerId);
    const post = makePost('post-b8', authorId, { visibility: 'PUBLIC' });
    prisma.post.findFirst.mockResolvedValue(post);
    // Author blocked the viewer
    prisma.userBlock.findFirst.mockResolvedValue({
      id: 'blk-1', blockerId: authorId, blockedId: viewerId
    });

    const res = await request(app)
      .get('/api/v1/posts/post-b8')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('PUBLIC post, viewer blocked author → 404', async () => {
    const viewerId = 'viewer-b9';
    const authorId = 'author-b9';
    asUser(viewerId);
    const post = makePost('post-b9', authorId, { visibility: 'PUBLIC' });
    prisma.post.findFirst.mockResolvedValue(post);
    // Viewer blocked the author
    prisma.userBlock.findFirst.mockResolvedValue({
      id: 'blk-2', blockerId: viewerId, blockedId: authorId
    });

    const res = await request(app)
      .get('/api/v1/posts/post-b9')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('block check queries both directions', async () => {
    const viewerId = 'viewer-b9b';
    const authorId = 'author-b9b';
    asUser(viewerId);
    const post = makePost('post-b9b', authorId, { visibility: 'PUBLIC' });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);

    await request(app)
      .get('/api/v1/posts/post-b9b')
      .set('Authorization', tok(viewerId));

    expect(prisma.userBlock.findFirst).toHaveBeenCalledTimes(1);
    const orConds = prisma.userBlock.findFirst.mock.calls[0][0].where.OR;
    expect(orConds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerId: viewerId, blockedId: authorId }),
        expect.objectContaining({ blockerId: authorId, blockedId: viewerId }),
      ])
    );
  });

  test('isExclusive post, viewer has no subscription → 404', async () => {
    const viewerId = 'viewer-b10';
    const authorId = 'author-b10';
    asUser(viewerId);
    const post = makePost('post-b10', authorId, { visibility: 'PUBLIC', isExclusive: true });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    // Author has a creator profile but viewer has no subscription
    prisma.creatorProfile.findUnique.mockResolvedValue({ id: 'cp-b10' });
    prisma.creatorSubscription.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b10')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('isExclusive post, viewer has active subscription → 200', async () => {
    const viewerId = 'viewer-b11';
    const authorId = 'author-b11';
    asUser(viewerId);
    const post = makePost('post-b11', authorId, { visibility: 'PUBLIC', isExclusive: true });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    // Author has a creator profile and viewer has an active subscription
    prisma.creatorProfile.findUnique.mockResolvedValue({ id: 'cp-b11' });
    prisma.creatorSubscription.findFirst.mockResolvedValue({
      id: 'sub-1', subscriberId: viewerId, creatorId: 'cp-b11',
      status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000)
    });

    const res = await request(app)
      .get('/api/v1/posts/post-b11')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
  });

  test('isExclusive post, author has no creator profile → 404 (no profile = no subscription possible)', async () => {
    const viewerId = 'viewer-b12';
    const authorId = 'author-b12';
    asUser(viewerId);
    const post = makePost('post-b12', authorId, { visibility: 'PUBLIC', isExclusive: true });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.userBlock.findFirst.mockResolvedValue(null);
    // No creator profile at all
    prisma.creatorProfile.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/posts/post-b12')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
  });

  test('isExclusive post, owner always gets access → 200', async () => {
    const ownerId = 'owner-b13';
    asUser(ownerId);
    const post = makePost('post-b13', ownerId, { visibility: 'PUBLIC', isExclusive: true });
    prisma.post.findFirst.mockResolvedValue(post);

    const res = await request(app)
      .get('/api/v1/posts/post-b13')
      .set('Authorization', tok(ownerId));

    expect(res.status).toBe(200);
    // Owner path: no subscription check
    expect(prisma.creatorProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.creatorSubscription.findFirst).not.toHaveBeenCalled();
  });
});
