'use strict';
/**
 * View Count Deduplication Tests
 * ---------------------------------------------------------------------------
 * Verifies that post and story viewCount is incremented ONLY on the first
 * view from a given user, not on subsequent repeat visits.
 *
 * Fix: replaced upsert+then (always increments) with create/catch(P2002)
 * (increments only when the create succeeds = first view).
 *
 * Tests:
 *   Post:
 *     1. First view increments viewCount.
 *     2. Repeat view (P2002) does NOT increment viewCount.
 *     3. Different user increments viewCount independently.
 *     4. Author viewing own post does NOT increment viewCount (getPost path).
 *     5. DB error other than P2002 is swallowed (fire-and-forget contract).
 *   Story:
 *     6. First story view increments viewCount.
 *     7. Repeat story view (P2002) does NOT increment viewCount.
 *     8. Author viewing own story does NOT increment viewCount.
 *     9. Different user increments story viewCount independently.
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
const prisma = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');

// ---------------------------------------------------------------------------
// Prisma error factory
// ---------------------------------------------------------------------------
function prismaUniqueError() {
  const err = new Error('Unique constraint failed');
  err.code = 'P2002';
  return err;
}

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------
function buildPostApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/posts', require('../routes/post.routes'));
  app.use(function(err, req, res, _next) {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function buildStoryApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/stories', require('../routes/story.routes'));
  app.use(function(err, req, res, _next) {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tok(id) { return 'Bearer t-' + id; }

function asUser(id, role) {
  role = role || 'MEMBER';
  verifyAccessToken.mockReturnValue({ userId: id, role: role, schoolId: null });
  prisma.user.findUnique.mockResolvedValue({
    id: id, role: role, status: 'ACTIVE', schoolId: null,
    firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null,
  });
}

function makePostStub(id, authorId) {
  return {
    id: id, authorId: authorId, visibility: 'PUBLIC', deletedAt: null, isDraft: false,
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

function makeStoryStub(id, authorId) {
  return {
    id: id, authorId: authorId, mediaUrl: 'https://example.com/story.jpg',
    mediaType: 'IMAGE', deletedAt: null, viewCount: 0,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // not expired
    createdAt: new Date('2024-01-01T12:00:00Z'),
    author: { id: authorId, firstName: 'A', lastName: 'B', avatarUrl: null },
    views: [], reactions: [],
    _count: { views: 0, reactions: 0 },
  };
}

beforeEach(function() {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.userBlock.findMany.mockResolvedValue([]);
  prisma.follow.findMany.mockResolvedValue([]);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.creatorProfile.findMany.mockResolvedValue([]);
});

// ===========================================================================
// POST view count deduplication (recordView endpoint: POST /posts/:id/view)
// ===========================================================================

describe('Post recordView -- view count deduplication', function() {
  var app;
  beforeAll(function() { app = buildPostApp(); });

  test('1: first view -- postView.create succeeds, viewCount incremented', async function() {
    var viewerId = 'viewer-post-1';
    var postId   = 'post-1';
    asUser(viewerId);

    // Post exists
    prisma.post.findFirst.mockResolvedValue({ id: postId, deletedAt: null });
    // First view: create succeeds
    prisma.postView.create.mockResolvedValue({ id: 'pv-1', postId: postId, userId: viewerId });
    // Update resolves
    prisma.post.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/posts/' + postId + '/view')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(204);

    // Allow the fire-and-forget promise chain to settle
    await new Promise(function(r) { setTimeout(r, 50); });

    expect(prisma.postView.create).toHaveBeenCalledTimes(1);
    expect(prisma.postView.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ postId: postId, userId: viewerId }) })
    );
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { viewCount: { increment: 1 } } })
    );
  });

  test('2: repeat view -- postView.create throws P2002, viewCount NOT incremented', async function() {
    var viewerId = 'viewer-post-2';
    var postId   = 'post-2';
    asUser(viewerId);

    prisma.post.findFirst.mockResolvedValue({ id: postId, deletedAt: null });
    // Repeat view: unique constraint violation
    prisma.postView.create.mockRejectedValue(prismaUniqueError());
    prisma.post.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/posts/' + postId + '/view')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(204);
    await new Promise(function(r) { setTimeout(r, 50); });

    expect(prisma.postView.create).toHaveBeenCalledTimes(1);
    // P2002 caught -- update must NOT have been called
    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  test('3: different user increments viewCount independently', async function() {
    var viewerA = 'viewer-a';
    var viewerB = 'viewer-b';
    var postId  = 'post-3';

    // Simulate two sequential first-time views from different users
    for (var i = 0; i < 2; i++) {
      jest.clearAllMocks();
      var userId = i === 0 ? viewerA : viewerB;
      asUser(userId);
      prisma.post.findFirst.mockResolvedValue({ id: postId, deletedAt: null });
      prisma.postView.create.mockResolvedValue({ id: 'pv-' + i, postId: postId, userId: userId });
      prisma.post.update.mockResolvedValue({});

      var res = await request(app)
        .post('/api/v1/posts/' + postId + '/view')
        .set('Authorization', tok(userId));

      expect(res.status).toBe(204);
      await new Promise(function(r) { setTimeout(r, 50); });
      expect(prisma.post.update).toHaveBeenCalledTimes(1);
    }
  });

  test('5: non-P2002 DB error is swallowed -- request still returns 204', async function() {
    var viewerId = 'viewer-post-5';
    var postId   = 'post-5';
    asUser(viewerId);

    prisma.post.findFirst.mockResolvedValue({ id: postId, deletedAt: null });
    // Unexpected DB error (not P2002)
    prisma.postView.create.mockRejectedValue(new Error('Connection lost'));
    prisma.post.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/posts/' + postId + '/view')
      .set('Authorization', tok(viewerId));

    // Fire-and-forget: must still return 204
    expect(res.status).toBe(204);
    await new Promise(function(r) { setTimeout(r, 50); });
    // The catch swallows the error -- update not called since create rejected
    expect(prisma.post.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POST getPost -- inline view tracking (author exclusion)
// ===========================================================================

describe('Post getPost -- inline view tracking', function() {
  var app;
  beforeAll(function() { app = buildPostApp(); });

  test('4: author viewing own post does NOT trigger postView.create', async function() {
    var authorId = 'author-getpost';
    var postId   = 'post-getpost';
    asUser(authorId);

    var postStub = makePostStub(postId, authorId);
    prisma.post.findFirst.mockResolvedValue(postStub);
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.follow.findMany.mockResolvedValue([]);

    var res = await request(app)
      .get('/api/v1/posts/' + postId)
      .set('Authorization', tok(authorId));

    expect(res.status).toBe(200);
    await new Promise(function(r) { setTimeout(r, 50); });

    // postView.create must NOT be called for author
    expect(prisma.postView.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { viewCount: { increment: 1 } } })
    );
  });
});

// ===========================================================================
// STORY view count deduplication
// ===========================================================================

describe('Story viewStory -- view count deduplication', function() {
  var app;
  beforeAll(function() { app = buildStoryApp(); });

  test('6: first story view increments viewCount', async function() {
    var viewerId = 'viewer-story-6';
    var storyId  = 'story-6';
    var authorId = 'author-story-6';
    asUser(viewerId);

    var storyStub = makeStoryStub(storyId, authorId);
    prisma.story.findFirst.mockResolvedValue(storyStub);
    prisma.storyView.create.mockResolvedValue({ id: 'sv-6', storyId: storyId, viewerId: viewerId });
    prisma.story.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/stories/' + storyId + '/view')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    await new Promise(function(r) { setTimeout(r, 50); });

    expect(prisma.storyView.create).toHaveBeenCalledTimes(1);
    expect(prisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { viewCount: { increment: 1 } } })
    );
  });

  test('7: repeat story view (P2002) does NOT increment viewCount', async function() {
    var viewerId = 'viewer-story-7';
    var storyId  = 'story-7';
    var authorId = 'author-story-7';
    asUser(viewerId);

    prisma.story.findFirst.mockResolvedValue(makeStoryStub(storyId, authorId));
    // Repeat view: P2002
    prisma.storyView.create.mockRejectedValue(prismaUniqueError());
    prisma.story.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/stories/' + storyId + '/view')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    await new Promise(function(r) { setTimeout(r, 50); });

    expect(prisma.storyView.create).toHaveBeenCalledTimes(1);
    // P2002 caught -- story update must NOT have been called
    expect(prisma.story.update).not.toHaveBeenCalled();
  });

  test('8: author viewing own story does NOT increment viewCount', async function() {
    var authorId = 'author-story-8';
    var storyId  = 'story-8';
    asUser(authorId);

    prisma.story.findFirst.mockResolvedValue(makeStoryStub(storyId, authorId));
    // Author path: create for viewer-list only (no update chained)
    prisma.storyView.create.mockResolvedValue({ id: 'sv-8', storyId: storyId, viewerId: authorId });
    prisma.story.update.mockResolvedValue({});

    var res = await request(app)
      .post('/api/v1/stories/' + storyId + '/view')
      .set('Authorization', tok(authorId));

    expect(res.status).toBe(200);
    await new Promise(function(r) { setTimeout(r, 50); });

    // story.update with viewCount increment must NOT be called for author
    expect(prisma.story.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { viewCount: { increment: 1 } } })
    );
  });

  test('9: different users increment story viewCount independently', async function() {
    var authorId = 'author-story-9';
    var storyId  = 'story-9';

    for (var i = 0; i < 2; i++) {
      jest.clearAllMocks();
      var viewerId = 'viewer-story-9-' + i;
      asUser(viewerId);
      prisma.story.findFirst.mockResolvedValue(makeStoryStub(storyId, authorId));
      prisma.storyView.create.mockResolvedValue({ id: 'sv-9-' + i, storyId: storyId, viewerId: viewerId });
      prisma.story.update.mockResolvedValue({});

      var res = await request(app)
        .post('/api/v1/stories/' + storyId + '/view')
        .set('Authorization', tok(viewerId));

      expect(res.status).toBe(200);
      await new Promise(function(r) { setTimeout(r, 50); });
      expect(prisma.story.update).toHaveBeenCalledTimes(1);
    }
  });
});
