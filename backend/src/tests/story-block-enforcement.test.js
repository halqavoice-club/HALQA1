'use strict';
/**
 * Story Block Enforcement Tests
 * ---------------------------------------------------------------------------
 * Fix 2 — getStoriesFeed: bilateral block enforcement added.
 *   Previously no UserBlock lookup was performed; blocked/blocking followed
 *   users' stories appeared in the story bar regardless of block status.
 *
 * Fix 3 — getUserStories: bilateral block enforcement added.
 *   Previously any authenticated user could fetch another user's stories
 *   regardless of block relationships.
 *
 * Tests:
 *
 *   getStoriesFeed:
 *     1. Viewer blocks a followed story author → that author excluded from feed.
 *     2. Followed story author blocks the viewer → that author excluded from feed.
 *     3. Unblocked followed authors remain included.
 *     4. The viewer's own stories always remain available.
 *     5. Empty follow list → only own stories returned.
 *     6. All blocks, no follows → only own stories returned.
 *     7. Story.findMany is called with correct active/expiry where clause (expiry preserved).
 *
 *   getUserStories:
 *     8. Viewer blocks story owner → 404.
 *     9. Story owner blocks viewer → 404.
 *    10. Unblocked viewer can retrieve non-owner stories → 200.
 *    11. Owner can always retrieve their own stories → 200, no block check.
 *    12. Non-existent / all-expired stories return 200 with empty array.
 *
 * All tests use the manual Prisma mock — no real DB required.
 * NOTE: Socket-room authorisation is NOT verified by these tests — they test
 * HTTP endpoint behaviour via mocked Prisma only.
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

const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const prisma       = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ---------------------------------------------------------------------------
// App builder — matches view-count-dedup.test.js and social-personal-ownership
// ---------------------------------------------------------------------------
function buildStoryApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/stories', require('../routes/story.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tok(id) { return `Bearer t-${id}`; }

/** Set up verifyAccessToken mock and user findUnique stub */
function asUser(id, opts) {
  opts = opts || {};
  const role = opts.role || 'MEMBER';
  const schoolId = opts.schoolId || null;
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue({
    id, role, status: 'ACTIVE', schoolId,
    firstName: 'Test', lastName: 'User', avatarUrl: null, deletedAt: null,
  });
}

/** Minimal active story stub */
function makeStory(id, authorId) {
  return {
    id,
    authorId,
    type: 'IMAGE',
    mediaUrl: 'https://cdn.example.com/story.jpg',
    deletedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    viewCount: 0, reactionCount: 0,
    createdAt: new Date(),
    author: { id: authorId, firstName: 'A', lastName: 'U', avatarUrl: null },
    views:  [],
    _count: { views: 0, reactions: 0 },
  };
}

// ---------------------------------------------------------------------------
// beforeEach — safe defaults for all prisma sub-objects
// ---------------------------------------------------------------------------
let app;
beforeAll(() => { app = buildStoryApp(); });

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);

  if (!prisma.userBlock)   prisma.userBlock   = {};
  if (!prisma.follow)      prisma.follow      = {};
  if (!prisma.story)       prisma.story       = {};
  if (!prisma.storyView)   prisma.storyView   = {};
  if (!prisma.auditLog)    prisma.auditLog    = {};

  prisma.userBlock.findMany  = jest.fn().mockResolvedValue([]);
  prisma.userBlock.findFirst = jest.fn().mockResolvedValue(null);
  prisma.follow.findMany     = jest.fn().mockResolvedValue([]);
  prisma.story.findMany      = jest.fn().mockResolvedValue([]);
  prisma.story.findFirst     = jest.fn().mockResolvedValue(null);
  prisma.storyView.create    = jest.fn().mockResolvedValue({});
  prisma.auditLog.create     = jest.fn().mockResolvedValue({});
});

// ===========================================================================
// getStoriesFeed — block enforcement
// ===========================================================================
describe('getStoriesFeed — bilateral block enforcement', () => {

  test('1: viewer blocks a followed author → that author excluded from Story.findMany authorIds', async () => {
    const viewerId  = 'viewer-sf1';
    const blockedId = 'author-blocked-1';
    asUser(viewerId);

    // Viewer follows the blocked author
    prisma.follow.findMany.mockResolvedValue([{ followingId: blockedId }]);
    // Viewer has blocked that author
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: viewerId, blockedId: blockedId }
    ]);
    prisma.story.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    // Story.findMany must have been called with authorIds that do NOT contain the blocked user
    const callArgs = prisma.story.findMany.mock.calls[0][0];
    expect(callArgs.where.authorId.in).not.toContain(blockedId);
    // Viewer's own ID must always be present
    expect(callArgs.where.authorId.in).toContain(viewerId);
  });

  test('2: followed author blocks viewer → that author excluded from Story.findMany authorIds', async () => {
    const viewerId   = 'viewer-sf2';
    const blockerId  = 'author-blocker-2';
    asUser(viewerId);

    prisma.follow.findMany.mockResolvedValue([{ followingId: blockerId }]);
    // Author blocked the viewer (reverse direction)
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: blockerId, blockedId: viewerId }
    ]);
    prisma.story.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    const callArgs = prisma.story.findMany.mock.calls[0][0];
    expect(callArgs.where.authorId.in).not.toContain(blockerId);
    expect(callArgs.where.authorId.in).toContain(viewerId);
  });

  test('3: unblocked followed authors remain included in Story.findMany authorIds', async () => {
    const viewerId  = 'viewer-sf3';
    const authorId1 = 'author-ok-1';
    const authorId2 = 'author-ok-2';
    asUser(viewerId);

    prisma.follow.findMany.mockResolvedValue([
      { followingId: authorId1 },
      { followingId: authorId2 },
    ]);
    prisma.userBlock.findMany.mockResolvedValue([]); // no blocks
    prisma.story.findMany.mockResolvedValue([
      makeStory('s1', authorId1),
      makeStory('s2', authorId2),
    ]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    const callArgs = prisma.story.findMany.mock.calls[0][0];
    expect(callArgs.where.authorId.in).toContain(authorId1);
    expect(callArgs.where.authorId.in).toContain(authorId2);
    expect(callArgs.where.authorId.in).toContain(viewerId);
  });

  test('4: viewer\'s own stories always remain — viewerId always in authorIds regardless of blocks', async () => {
    const viewerId   = 'viewer-sf4';
    const blockedId  = 'some-blocked-user';
    asUser(viewerId);

    // Viewer follows and blocks one person
    prisma.follow.findMany.mockResolvedValue([{ followingId: blockedId }]);
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: viewerId, blockedId: blockedId }
    ]);
    prisma.story.findMany.mockResolvedValue([makeStory('own-story', viewerId)]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const callArgs = prisma.story.findMany.mock.calls[0][0];
    // viewerId must be in authorIds even when there are blocks
    expect(callArgs.where.authorId.in).toContain(viewerId);
    expect(callArgs.where.authorId.in).not.toContain(blockedId);
  });

  test('5: empty follow list → Story.findMany called with only viewerId in authorIds', async () => {
    const viewerId = 'viewer-sf5';
    asUser(viewerId);

    prisma.follow.findMany.mockResolvedValue([]);    // follows nobody
    prisma.userBlock.findMany.mockResolvedValue([]); // no blocks
    prisma.story.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const callArgs = prisma.story.findMany.mock.calls[0][0];
    expect(callArgs.where.authorId.in).toEqual([viewerId]);
  });

  test('6: expiry condition is preserved — activeWhere() fields present in Story.findMany where clause', async () => {
    const viewerId = 'viewer-sf6';
    asUser(viewerId);

    prisma.follow.findMany.mockResolvedValue([]);
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.story.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    const callArgs = prisma.story.findMany.mock.calls[0][0];
    // activeWhere() injects deletedAt: null and expiresAt: { gt: <Date> }
    expect(callArgs.where.deletedAt).toBeNull();
    expect(callArgs.where.expiresAt).toBeDefined();
    expect(callArgs.where.expiresAt.gt).toBeInstanceOf(Date);
  });

  test('7: userBlock query failure degrades safely — feed still returns 200', async () => {
    const viewerId = 'viewer-sf7';
    asUser(viewerId);

    prisma.follow.findMany.mockResolvedValue([{ followingId: 'some-author' }]);
    // Block query fails — should fall back to [] via .catch(() => [])
    prisma.userBlock.findMany.mockRejectedValue(new Error('DB unavailable'));
    prisma.story.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/stories/feed')
      .set('Authorization', tok(viewerId));

    // Must degrade gracefully — 200, not 500
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// getUserStories — block enforcement
// ===========================================================================
describe('getUserStories — bilateral block enforcement', () => {

  test('8: viewer blocks story owner → 404', async () => {
    const viewerId = 'viewer-us8';
    const ownerId  = 'owner-us8';
    asUser(viewerId);

    // Viewer has blocked the owner
    prisma.userBlock.findFirst.mockResolvedValue(
      { blockerId: viewerId, blockedId: ownerId }
    );

    const res = await request(app)
      .get(`/api/v1/stories/user/${ownerId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
    // Story.findMany must NOT have been called (access denied before query)
    expect(prisma.story.findMany).not.toHaveBeenCalled();
  });

  test('9: story owner blocks viewer → 404', async () => {
    const viewerId = 'viewer-us9';
    const ownerId  = 'owner-us9';
    asUser(viewerId);

    // Owner has blocked the viewer (reverse direction)
    prisma.userBlock.findFirst.mockResolvedValue(
      { blockerId: ownerId, blockedId: viewerId }
    );

    const res = await request(app)
      .get(`/api/v1/stories/user/${ownerId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(404);
    expect(prisma.story.findMany).not.toHaveBeenCalled();
  });

  test('10: unblocked viewer can retrieve non-owner stories → 200', async () => {
    const viewerId = 'viewer-us10';
    const ownerId  = 'owner-us10';
    asUser(viewerId);

    prisma.userBlock.findFirst.mockResolvedValue(null); // no block
    prisma.story.findMany.mockResolvedValue([makeStory('s10', ownerId)]);

    const res = await request(app)
      .get(`/api/v1/stories/user/${ownerId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
  });

  test('11: owner retrieves their own stories → 200, block check skipped entirely', async () => {
    const ownerId = 'owner-us11';
    asUser(ownerId);

    prisma.story.findMany.mockResolvedValue([makeStory('s11', ownerId)]);

    const res = await request(app)
      .get(`/api/v1/stories/user/${ownerId}`)
      .set('Authorization', tok(ownerId));

    expect(res.status).toBe(200);
    // Block query must NOT be called when viewer === owner
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
    expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
  });

  test('12: no stories (empty result or all expired) → 200 with empty array', async () => {
    const viewerId = 'viewer-us12';
    const ownerId  = 'owner-us12';
    asUser(viewerId);

    prisma.userBlock.findFirst.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]); // no active stories

    const res = await request(app)
      .get(`/api/v1/stories/user/${ownerId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
