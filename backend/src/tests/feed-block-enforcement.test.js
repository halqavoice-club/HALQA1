'use strict';
/**
 * Feed Block Enforcement Tests
 * ---------------------------------------------------------------------------
 * Verifies that the UserBlock table is correctly consulted when building
 * feed, reel, and explore queries so that:
 *
 *   1. Posts by a user the viewer blocked are excluded from the feed.
 *   2. Posts by a user who blocked the viewer are also excluded (reciprocal).
 *   3. Posts from unrelated, unblocked authors remain visible.
 *   4. FOLLOWERS-only visibility rules still work alongside block exclusion.
 *   5. Explore trending posts and suggested people exclude blocked users.
 *   6. Empty block list -> no NOT clause is injected.
 *   7. A DB error on the block query degrades safely (feed still returns 200).
 *   8. Blocked users PRIVATE posts (already excluded by visibility) remain excluded.
 *   9. Block direction is correct: both directions are excluded; viewer ID is not in the list.
 *
 * All tests use the manual Prisma mock -- no real DB required.
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

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const prisma  = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

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

function buildExploreApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/explore', require('../routes/explore.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tok(id) { return "Bearer t-" + id; }

function asUser(id, role, schoolId) {
  role = role || 'MEMBER';
  schoolId = schoolId || null;
  const u = {
    id, role, status: 'ACTIVE', schoolId,
    firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

/** Minimal post stub that passes feed includes */
function makePost(id, authorId, visibility) {
  visibility = visibility || 'PUBLIC';
  return {
    id, authorId, visibility, deletedAt: null, isDraft: false,
    isExclusive: false, type: 'TEXT', body: 'hello', schoolId: null,
    likeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0, bookmarkCount: 0,
    isPinned: false, scheduledAt: null,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    author: { id: authorId, firstName: 'A', lastName: 'B', avatarUrl: null, role: 'MEMBER', schoolId: null },
    media: [], hashtags: [], community: null, reactions: [], bookmarks: [],
    _count: { reactions: 0, comments: 0 },
    originalPost: null,
  };
}

/** Sets up the standard mocks needed by visibilityFilter */
function setupBaseFilterMocks(viewerId, opts) {
  opts = opts || {};
  var blocks    = opts.blocks    || [];
  var following = opts.following || [];
  var schoolId  = opts.schoolId  || null;

  prisma.user.findUnique.mockImplementation(function(args) {
    if (args && args.where && args.where.id === viewerId) {
      return Promise.resolve({
        id: viewerId, schoolId: schoolId, role: 'MEMBER', status: 'ACTIVE',
        firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
      });
    }
    return Promise.resolve(null);
  });
  prisma.follow.findMany.mockResolvedValue(following);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.userBlock.findMany.mockResolvedValue(blocks);
}

beforeEach(function() {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  // schoolMembership is now in the mock; set a safe default
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.userBlock.findMany.mockResolvedValue([]);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.creatorProfile.findMany.mockResolvedValue([]);
  prisma.follow.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.hashtag.findMany.mockResolvedValue([]);
});

// ===========================================================================
// 1-4, 6-9: getFeed block enforcement
// ===========================================================================

describe('getFeed -- block enforcement', function() {
  var app;
  beforeAll(function() { app = buildPostApp(); });

  test('1: blocked authors PUBLIC post is excluded from feed WHERE clause', async function() {
    var viewerId  = 'viewer-1';
    var blockedId = 'blocked-author-1';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, {
      blocks: [{ blockerId: viewerId, blockedId: blockedId }],
    });

    var unrelatedPost = makePost('post-unrelated', 'unrelated-author');
    prisma.post.findMany.mockResolvedValue([unrelatedPost]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    // userBlock.findMany must be called with both directions
    var blockCall = prisma.userBlock.findMany.mock.calls[0][0];
    expect(blockCall.where.OR).toEqual(
      expect.arrayContaining([
        { blockerId: viewerId },
        { blockedId: viewerId },
      ])
    );

    // post.findMany WHERE clause must contain NOT authorId exclusion
    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toEqual({ authorId: { in: [blockedId] } });

    // Response must not include the blocked author
    var ids = res.body.data.items.map(function(p) { return p.authorId; });
    expect(ids).not.toContain(blockedId);
  });

  test('2: reciprocal block -- user who blocked the viewer is also excluded', async function() {
    var viewerId  = 'viewer-2';
    var blockerId = 'user-who-blocked-viewer';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, {
      blocks: [{ blockerId: blockerId, blockedId: viewerId }],
    });
    prisma.post.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toEqual({ authorId: { in: [blockerId] } });
  });

  test('3: unrelated authors post is visible when no block relationship exists', async function() {
    var viewerId        = 'viewer-3';
    var unrelatedAuthor = 'unrelated-author-3';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, { blocks: [] });

    var unrelatedPost = makePost('post-3', unrelatedAuthor);
    prisma.post.findMany.mockResolvedValue([unrelatedPost]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    // No NOT clause when block list is empty
    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toBeUndefined();

    var ids = res.body.data.items.map(function(p) { return p.id; });
    expect(ids).toContain('post-3');
  });

  test('4: FOLLOWERS-only visibility still works alongside block exclusion', async function() {
    var viewerId   = 'viewer-4';
    var followedId = 'followed-author-4';
    var blockedId  = 'blocked-author-4';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, {
      following: [{ followingId: followedId }],
      blocks:    [{ blockerId: viewerId, blockedId: blockedId }],
    });

    var followersPost = makePost('post-followers', followedId, 'FOLLOWERS');
    prisma.post.findMany.mockResolvedValue([followersPost]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    var postCall = prisma.post.findMany.mock.calls[0][0];

    // FOLLOWERS clause must include the followed author
    var followersClause = postCall.where.OR.find(function(c) { return c.visibility === 'FOLLOWERS'; });
    expect(followersClause).toBeDefined();
    expect(followersClause.authorId.in).toContain(followedId);

    // Block exclusion must still be present
    expect(postCall.where.NOT).toEqual({ authorId: { in: [blockedId] } });
  });

  test('6: empty block list results in no NOT clause being injected', async function() {
    var viewerId = 'viewer-6';
    asUser(viewerId);
    setupBaseFilterMocks(viewerId, { blocks: [] });
    prisma.post.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toBeUndefined();
  });

  test('7: userBlock query failure degrades safely -- feed still returns 200', async function() {
    var viewerId = 'viewer-7';
    asUser(viewerId);

    // Simulate DB failure for the block query
    prisma.userBlock.findMany.mockRejectedValue(new Error('DB connection lost'));

    // visibilityFilter also calls user.findUnique, follow.findMany, etc.
    prisma.user.findUnique.mockResolvedValue({
      id: viewerId, schoolId: null, role: 'MEMBER', status: 'ACTIVE',
      firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
    });
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.creatorSubscription.findMany.mockResolvedValue([]);
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    prisma.post.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    // Must still succeed -- block failure is non-fatal (.catch(() => []) fallback)
    expect(res.status).toBe(200);

    // With the catch fallback, block list is empty so NOT clause is omitted
    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toBeUndefined();
  });

  test('8: blocked users PRIVATE posts remain excluded (no double-filter bug)', async function() {
    var viewerId  = 'viewer-8';
    var blockedId = 'blocked-private-author';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, {
      blocks: [{ blockerId: viewerId, blockedId: blockedId }],
    });
    prisma.post.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    var postCall = prisma.post.findMany.mock.calls[0][0];
    var orClause = postCall.where.OR;

    // The OR still contains the standard visibility entries
    expect(orClause.some(function(c) { return c.visibility === 'PUBLIC'; })).toBe(true);
    expect(orClause.some(function(c) { return c.authorId === viewerId; })).toBe(true);

    // The NOT clause targets blocked author at top-level (not nested inside OR)
    expect(postCall.where.NOT).toEqual({ authorId: { in: [blockedId] } });

    // Must not be an array (no double-NOT)
    expect(Array.isArray(postCall.where.NOT)).toBe(false);
  });
});

// ===========================================================================
// Block direction correctness
// ===========================================================================

describe('Block direction semantics', function() {
  var app;
  beforeAll(function() { app = buildPostApp(); });

  test('9: both viewer-blocked-them AND they-blocked-viewer are excluded; viewer ID is not in the list', async function() {
    var viewerId          = 'viewer-dir';
    var blockedByViewer   = 'user-viewer-blocked';
    var blockedViewer     = 'user-who-blocked-viewer';
    asUser(viewerId);

    setupBaseFilterMocks(viewerId, {
      blocks: [
        { blockerId: viewerId,       blockedId: blockedByViewer },
        { blockerId: blockedViewer,  blockedId: viewerId },
      ],
    });
    prisma.post.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/feed')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    var postCall = prisma.post.findMany.mock.calls[0][0];
    var excluded = postCall.where.NOT.authorId.in;
    expect(excluded).toContain(blockedByViewer);
    expect(excluded).toContain(blockedViewer);
    // Viewer own ID must never appear in the exclusion list
    expect(excluded).not.toContain(viewerId);
  });
});

// ===========================================================================
// 5: getExploreFeed / suggested people excludes blocked users
// ===========================================================================

describe('getExploreFeed -- block enforcement', function() {
  var app;
  beforeAll(function() { app = buildExploreApp(); });

  function setupExploreMocks(viewerId, blocks) {
    asUser(viewerId);
    prisma.userBlock.findMany.mockResolvedValue(blocks || []);
    prisma.follow.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: viewerId, schoolId: null, role: 'MEMBER', status: 'ACTIVE',
      firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
    });
    prisma.post.findMany.mockResolvedValue([]);
    prisma.hashtag.findMany.mockResolvedValue([]);
    prisma.community.findMany.mockResolvedValue([]);
    prisma.voiceRoom.findMany.mockResolvedValue([]);
    prisma.liveClass.findMany.mockResolvedValue([]);
    prisma.teacher.findMany.mockResolvedValue([]);
  }

  test('5a: trending posts exclude blocked author', async function() {
    var viewerId  = 'explorer-1';
    var blockedId = 'blocked-author-explore';
    setupExploreMocks(viewerId, [{ blockerId: viewerId, blockedId: blockedId }]);

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    // The trending posts query must contain NOT authorId for the blocked user
    var postCall = prisma.post.findMany.mock.calls[0][0];
    expect(postCall.where.NOT).toEqual({ authorId: { in: [blockedId] } });
  });

  test('5b: suggested people excludes blocked user', async function() {
    var viewerId  = 'explorer-2';
    var blockedId = 'blocked-person-explore';
    setupExploreMocks(viewerId, [{ blockerId: viewerId, blockedId: blockedId }]);

    prisma.user.findMany = jest.fn().mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    // user.findMany must be called and blockedId must be in the notIn list
    var userCalls = prisma.user.findMany.mock.calls;
    expect(userCalls.length).toBeGreaterThan(0);
    var notInList = userCalls[0][0].where.id.notIn;
    expect(notInList).toContain(blockedId);
    expect(notInList).toContain(viewerId);
  });

  test('5c: no blocks -- suggested people only excludes the viewer themselves', async function() {
    var viewerId = 'explorer-3';
    setupExploreMocks(viewerId, []);

    prisma.user.findMany = jest.fn().mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/explore')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);

    var userCalls = prisma.user.findMany.mock.calls;
    expect(userCalls.length).toBeGreaterThan(0);
    var notInList = userCalls[0][0].where.id.notIn;
    // Only viewerId excluded; no extra blocked users
    expect(notInList).toContain(viewerId);
    expect(notInList).toHaveLength(1);
  });
});
