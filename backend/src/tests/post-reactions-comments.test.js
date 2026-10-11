'use strict';
/**
 * Post Reactions & Comments Unit Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers GAP-004: reactToPost toggle logic and comments CRUD in post.controller.js.
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
const { notify } = require('../services/notification.service');

// ─── App builder ─────────────────────────────────────────────────────────────

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

function makePost(id, authorId, opts) {
  opts = opts || {};
  return {
    id, authorId: authorId || 'author-default',
    visibility: opts.visibility || 'PUBLIC',
    deletedAt: null, isDraft: false, isExclusive: false,
    type: 'TEXT', body: 'Post body', schoolId: null,
    likeCount: opts.likeCount || 0, commentCount: opts.commentCount || 0,
    viewCount: 0, shareCount: 0, bookmarkCount: 0,
    isPinned: false, scheduledAt: null,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    author: {
      id: authorId || 'author-default',
      firstName: 'Author', lastName: 'User',
      avatarUrl: null, role: 'MEMBER', schoolId: null,
    },
    media: [], hashtags: [], community: null,
    reactions: [], bookmarks: [],
    _count: { reactions: 0, comments: 0 },
    originalPost: null,
  };
}

function makeComment(id, postId, authorId, opts) {
  opts = opts || {};
  return {
    id, postId, authorId,
    parentId: opts.parentId || null,
    body: opts.body || 'A comment',
    deletedAt: null,
    replyCount: opts.replyCount || 0,
    likeCount: opts.likeCount || 0,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    author: {
      id: authorId, firstName: 'Commenter', lastName: 'User',
      avatarUrl: null, role: 'MEMBER', schoolId: null,
    },
    reactions: [],
    _count: { replies: 0, reactions: 0 },
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

  if (!prisma.userBlock) prisma.userBlock = {};
  prisma.userBlock.findMany = jest.fn().mockResolvedValue([]);

  if (!prisma.creatorSubscription) prisma.creatorSubscription = {};
  prisma.creatorSubscription.findMany = jest.fn().mockResolvedValue([]);

  if (!prisma.postReaction) prisma.postReaction = {};
  prisma.postReaction.findUnique = jest.fn().mockResolvedValue(null);
  prisma.postReaction.findMany   = jest.fn().mockResolvedValue([]);
  prisma.postReaction.create     = jest.fn().mockResolvedValue({});
  prisma.postReaction.update     = jest.fn().mockResolvedValue({});
  prisma.postReaction.delete     = jest.fn().mockResolvedValue({});

  if (!prisma.postComment) prisma.postComment = {};
  prisma.postComment.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.postComment.findUnique = jest.fn().mockResolvedValue(null);
  prisma.postComment.findMany   = jest.fn().mockResolvedValue([]);
  prisma.postComment.create     = jest.fn().mockResolvedValue({});
  prisma.postComment.update     = jest.fn().mockResolvedValue({});
  prisma.postComment.delete     = jest.fn().mockResolvedValue({});

  if (!prisma.commentReaction) prisma.commentReaction = {};
  prisma.commentReaction.findUnique = jest.fn().mockResolvedValue(null);
  prisma.commentReaction.create     = jest.fn().mockResolvedValue({});
  prisma.commentReaction.delete     = jest.fn().mockResolvedValue({});

  if (!prisma.postMention) prisma.postMention = {};
  prisma.postMention.deleteMany = jest.fn().mockResolvedValue({});
  prisma.postMention.createMany = jest.fn().mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST REACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Post Reactions', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('new LIKE reaction — creates record and increments likeCount', async () => {
    asUser('user-react-1');
    const post = makePost('post-r1', 'author-r1');
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.postReaction.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .post('/api/v1/posts/post-r1/react')
      .set('Authorization', tok('user-react-1'))
      .send({ type: 'LIKE' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('added');
    expect(res.body.data.type).toBe('LIKE');
    // Transaction must be called (atomic create + increment)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('same reaction type — toggles off (removes record and decrements likeCount)', async () => {
    asUser('user-react-2');
    const post = makePost('post-r2', 'author-r2', { likeCount: 1 });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.postReaction.findUnique.mockResolvedValue({ postId: 'post-r2', userId: 'user-react-2', type: 'LIKE' });
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .post('/api/v1/posts/post-r2/react')
      .set('Authorization', tok('user-react-2'))
      .send({ type: 'LIKE' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('removed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('different reaction type — updates type only (count unchanged, no transaction)', async () => {
    asUser('user-react-3');
    const post = makePost('post-r3', 'author-r3', { likeCount: 1 });
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.postReaction.findUnique.mockResolvedValue({ postId: 'post-r3', userId: 'user-react-3', type: 'LIKE' });
    prisma.postReaction.update.mockResolvedValue({ type: 'LOVE' });

    const res = await request(app)
      .post('/api/v1/posts/post-r3/react')
      .set('Authorization', tok('user-react-3'))
      .send({ type: 'LOVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('updated');
    expect(res.body.data.type).toBe('LOVE');
    // Count should not change — no transaction needed
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.postReaction.update).toHaveBeenCalledTimes(1);
    expect(prisma.postReaction.update.mock.calls[0][0].data.type).toBe('LOVE');
  });

  test('invalid reaction type — returns 400', async () => {
    asUser('user-react-4');

    const res = await request(app)
      .post('/api/v1/posts/post-r4/react')
      .set('Authorization', tok('user-react-4'))
      .send({ type: 'INVALID_TYPE' });

    // Either validation middleware (422) or controller (400) should reject
    expect([400, 422]).toContain(res.status);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('post not found — returns 404', async () => {
    asUser('user-react-5');
    prisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/posts/nonexistent-post/react')
      .set('Authorization', tok('user-react-5'))
      .send({ type: 'LIKE' });

    expect(res.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('new reaction — notifies post author when it is not own post', async () => {
    asUser('user-react-6');
    const post = makePost('post-r6', 'different-author');
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.postReaction.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([{}, {}]);

    await request(app)
      .post('/api/v1/posts/post-r6/react')
      .set('Authorization', tok('user-react-6'))
      .send({ type: 'LIKE' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('different-author');
    expect(notify.mock.calls[0][1].type).toBe('LIKE');
  });

  test('new reaction — does NOT notify when reacting to own post', async () => {
    asUser('user-react-7');
    const post = makePost('post-r7', 'user-react-7'); // same author as reactor
    prisma.post.findFirst.mockResolvedValue(post);
    prisma.postReaction.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([{}, {}]);

    await request(app)
      .post('/api/v1/posts/post-r7/react')
      .set('Authorization', tok('user-react-7'))
      .send({ type: 'LOVE' });

    expect(notify).not.toHaveBeenCalled();
  });

  test('getReactions — returns grouped reactions with total count', async () => {
    asUser('user-read-1');
    prisma.postReaction.findMany.mockResolvedValue([
      { type: 'LIKE', createdAt: new Date(), user: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null, role: 'MEMBER', schoolId: null } },
      { type: 'LIKE', createdAt: new Date(), user: { id: 'u2', firstName: 'C', lastName: 'D', avatarUrl: null, role: 'MEMBER', schoolId: null } },
      { type: 'LOVE', createdAt: new Date(), user: { id: 'u3', firstName: 'E', lastName: 'F', avatarUrl: null, role: 'MEMBER', schoolId: null } },
    ]);

    const res = await request(app)
      .get('/api/v1/posts/post-g1/reactions')
      .set('Authorization', tok('user-read-1'));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.grouped).toHaveProperty('LIKE');
    expect(res.body.data.grouped).toHaveProperty('LOVE');
    expect(res.body.data.grouped.LIKE).toHaveLength(2);
    expect(res.body.data.grouped.LOVE).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. COMMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Comments', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  // ── addComment ────────────────────────────────────────────────────────────

  test('addComment — creates comment and increments commentCount', async () => {
    asUser('user-cmt-1');
    const post = makePost('post-c1', 'author-c1');
    prisma.post.findFirst.mockResolvedValue(post);
    const comment = makeComment('cmt-1', 'post-c1', 'user-cmt-1');
    prisma.postComment.create.mockResolvedValue(comment);
    prisma.post.update.mockResolvedValue({});
    prisma.postMention = prisma.postMention || {};
    prisma.postMention.deleteMany = jest.fn().mockResolvedValue({});
    prisma.postMention.createMany = jest.fn().mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/posts/post-c1/comments')
      .set('Authorization', tok('user-cmt-1'))
      .send({ body: 'Great post!' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('cmt-1');
    // commentCount must be incremented
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commentCount: { increment: 1 } } })
    );
  });

  test('addComment — missing body returns 400', async () => {
    asUser('user-cmt-2');

    const res = await request(app)
      .post('/api/v1/posts/post-c2/comments')
      .set('Authorization', tok('user-cmt-2'))
      .send({ body: '' });

    expect([400, 422]).toContain(res.status);
    expect(prisma.postComment.create).not.toHaveBeenCalled();
  });

  test('addComment — post not found returns 404', async () => {
    asUser('user-cmt-3');
    prisma.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/posts/nonexistent/comments')
      .set('Authorization', tok('user-cmt-3'))
      .send({ body: 'Hello' });

    expect(res.status).toBe(404);
    expect(prisma.postComment.create).not.toHaveBeenCalled();
  });

  test('addComment — parentId not belonging to this post returns 404', async () => {
    asUser('user-cmt-4');
    const post = makePost('post-c4', 'author-c4');
    prisma.post.findFirst.mockResolvedValue(post);
    // Parent comment findFirst returns null (not on this post)
    prisma.postComment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/posts/post-c4/comments')
      .set('Authorization', tok('user-cmt-4'))
      .send({ body: 'Reply attempt', parentId: 'wrong-post-comment' });

    expect(res.status).toBe(404);
    expect(prisma.postComment.create).not.toHaveBeenCalled();
  });

  test('addComment — reply increments parent replyCount', async () => {
    asUser('user-cmt-5');
    const post = makePost('post-c5', 'author-c5');
    prisma.post.findFirst.mockResolvedValue(post);
    const parent = makeComment('parent-cmt', 'post-c5', 'author-c5');
    prisma.postComment.findFirst.mockResolvedValue(parent);
    const replyComment = makeComment('reply-cmt', 'post-c5', 'user-cmt-5', { parentId: 'parent-cmt' });
    prisma.postComment.create.mockResolvedValue(replyComment);
    prisma.post.update.mockResolvedValue({});
    prisma.postComment.update.mockResolvedValue({});
    // For notification: findUnique to get parent authorId
    prisma.postComment.findUnique.mockResolvedValue({ authorId: 'author-c5' });
    prisma.postMention = prisma.postMention || {};
    prisma.postMention.deleteMany = jest.fn().mockResolvedValue({});
    prisma.postMention.createMany = jest.fn().mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/posts/post-c5/comments')
      .set('Authorization', tok('user-cmt-5'))
      .send({ body: 'A reply', parentId: 'parent-cmt' });

    expect(res.status).toBe(201);
    // Parent's replyCount must be incremented
    expect(prisma.postComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'parent-cmt' }, data: { replyCount: { increment: 1 } } })
    );
  });

  // ── getComments ───────────────────────────────────────────────────────────

  test('getComments — returns top-level comments when parentId not set', async () => {
    asUser('user-gc-1');
    prisma.postComment.findMany.mockResolvedValue([
      makeComment('cmt-top-1', 'post-gc1', 'author-gc1'),
      makeComment('cmt-top-2', 'post-gc1', 'author-gc2'),
    ]);

    const res = await request(app)
      .get('/api/v1/posts/post-gc1/comments')
      .set('Authorization', tok('user-gc-1'));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data).toHaveProperty('hasMore');
    expect(res.body.data).toHaveProperty('nextCursor');
  });

  test('getComments — returns replies when parentId is set', async () => {
    asUser('user-gc-2');
    prisma.postComment.findMany.mockResolvedValue([
      makeComment('reply-1', 'post-gc2', 'author-gc3', { parentId: 'parent-cmt-1' }),
    ]);

    const res = await request(app)
      .get('/api/v1/posts/post-gc2/comments?parentId=parent-cmt-1')
      .set('Authorization', tok('user-gc-2'));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    // The query must filter by the provided parentId
    const findManyArgs = prisma.postComment.findMany.mock.calls[0][0];
    expect(findManyArgs.where.parentId).toBe('parent-cmt-1');
  });

  // ── editComment ───────────────────────────────────────────────────────────

  test('editComment — non-author gets 403', async () => {
    asUser('different-user');
    prisma.postComment.findFirst.mockResolvedValue(
      makeComment('cmt-edit-1', 'post-edit', 'actual-author')
    );

    const res = await request(app)
      .patch('/api/v1/posts/post-edit/comments/cmt-edit-1')
      .set('Authorization', tok('different-user'))
      .send({ body: 'Hacked content' });

    // blockSuperAdminFromSocialEdit or controller check fires first
    // MEMBER (non-author) should get 403 from the controller check
    expect([403, 400]).toContain(res.status);
    expect(prisma.postComment.update).not.toHaveBeenCalled();
  });

  test('editComment — comment not found returns 404', async () => {
    asUser('user-edit-1');
    prisma.postComment.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/posts/post-edit/comments/no-such-comment')
      .set('Authorization', tok('user-edit-1'))
      .send({ body: 'New body' });

    expect(res.status).toBe(404);
    expect(prisma.postComment.update).not.toHaveBeenCalled();
  });

  test('editComment — author can update their own comment', async () => {
    asUser('comment-author');
    const comment = makeComment('cmt-mine', 'post-mine', 'comment-author');
    prisma.postComment.findFirst.mockResolvedValue(comment);
    const updated = { ...comment, body: 'Updated body', author: comment.author };
    prisma.postComment.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/posts/post-mine/comments/cmt-mine')
      .set('Authorization', tok('comment-author'))
      .send({ body: 'Updated body' });

    expect(res.status).toBe(200);
    expect(prisma.postComment.update).toHaveBeenCalledTimes(1);
    expect(prisma.postComment.update.mock.calls[0][0].data.body).toBe('Updated body');
  });

  // ── deleteComment ─────────────────────────────────────────────────────────

  test('deleteComment — non-author non-SUPER_ADMIN gets 403', async () => {
    asUser('random-user');
    prisma.postComment.findFirst.mockResolvedValue(
      makeComment('cmt-del-1', 'post-del', 'real-author')
    );

    const res = await request(app)
      .delete('/api/v1/posts/post-del/comments/cmt-del-1')
      .set('Authorization', tok('random-user'));

    expect(res.status).toBe(403);
    expect(prisma.postComment.update).not.toHaveBeenCalled();
  });

  test('deleteComment — SUPER_ADMIN can delete any comment', async () => {
    const adminId = 'sa-del-1';
    verifyAccessToken.mockReturnValue({ userId: adminId, role: 'SUPER_ADMIN', schoolId: null });
    prisma.user.findUnique.mockResolvedValue({
      id: adminId, role: 'SUPER_ADMIN', status: 'ACTIVE', schoolId: null,
      firstName: 'SA', lastName: 'Admin', avatarUrl: null, deletedAt: null,
    });
    const comment = makeComment('cmt-sa-del', 'post-sa', 'some-author');
    prisma.postComment.findFirst.mockResolvedValue(comment);
    prisma.postComment.update.mockResolvedValue({ ...comment, deletedAt: new Date() });
    prisma.post.update.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/posts/post-sa/comments/cmt-sa-del')
      .set('Authorization', tok(adminId));

    expect(res.status).toBe(200);
    // Soft-delete: update with deletedAt
    expect(prisma.postComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
  });

  test('deleteComment — soft-deletes record and decrements commentCount', async () => {
    asUser('comment-author-del');
    const comment = makeComment('cmt-soft', 'post-soft', 'comment-author-del');
    prisma.postComment.findFirst.mockResolvedValue(comment);
    prisma.postComment.update.mockResolvedValue({ ...comment, deletedAt: new Date() });
    prisma.post.update.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/v1/posts/post-soft/comments/cmt-soft')
      .set('Authorization', tok('comment-author-del'));

    expect(res.status).toBe(200);
    // Must soft-delete via update (not hard delete)
    expect(prisma.postComment.update).toHaveBeenCalledTimes(1);
    // Must decrement the post commentCount
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commentCount: { decrement: 1 } } })
    );
  });

  // ── reactToComment ────────────────────────────────────────────────────────

  test('reactToComment — adds reaction when none exists', async () => {
    asUser('user-cr-1');
    prisma.commentReaction.findUnique.mockResolvedValue(null);
    prisma.commentReaction.create.mockResolvedValue({ id: 'cr-1', commentId: 'cmt-cr1', userId: 'user-cr-1', type: 'LIKE' });
    prisma.postComment.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/posts/post-cr1/comments/cmt-cr1/react')
      .set('Authorization', tok('user-cr-1'))
      .send({ type: 'LIKE' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('added');
    expect(prisma.commentReaction.create).toHaveBeenCalledTimes(1);
    // likeCount must be incremented
    expect(prisma.postComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { likeCount: { increment: 1 } } })
    );
  });

  test('reactToComment — toggle-off removes reaction when already exists', async () => {
    asUser('user-cr-2');
    prisma.commentReaction.findUnique.mockResolvedValue({
      commentId: 'cmt-cr2', userId: 'user-cr-2', type: 'LIKE',
    });
    prisma.commentReaction.delete.mockResolvedValue({});
    prisma.postComment.update.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/posts/post-cr2/comments/cmt-cr2/react')
      .set('Authorization', tok('user-cr-2'))
      .send({ type: 'LIKE' });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('removed');
    expect(prisma.commentReaction.delete).toHaveBeenCalledTimes(1);
    // likeCount must be decremented
    expect(prisma.postComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { likeCount: { increment: -1 } } })
    );
  });
});
