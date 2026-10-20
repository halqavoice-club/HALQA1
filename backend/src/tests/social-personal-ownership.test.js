'use strict';
/**
 * Social & Personal Data Ownership Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces the platform rule:
 *
 *   All personal and social content belongs exclusively to the user.
 *   No admin role (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER) may edit, mutate,
 *   or act on behalf of another user's profile, posts, comments, stories,
 *   followers/following, friend relationships, or privacy settings.
 *
 * COVERAGE:
 *   1. SOURCE AUDIT — middleware and controller ownership checks exist
 *   2. PROFILE MUTATIONS — only req.user.id is targeted (no :id param bypass)
 *   3. POST MUTATIONS — SCHOOL_ADMIN/TEACHER/SA cannot PATCH/DELETE another's post
 *   4. STORY MUTATIONS — SCHOOL_ADMIN/TEACHER cannot react/delete another's story
 *   5. USER STATUS — SCHOOL_ADMIN cannot change status of out-of-school user
 *   6. SOCIAL ACTIONS — follow/block/friend all hardcoded to req.user.id as actor
 *
 * All tests use mocked DB — no real database required.
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
const fs   = require('fs');
const path = require('path');

// ─── Test app builders ────────────────────────────────────────────────────────

function buildUserApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/users', require('../routes/user.routes'));
  app.use((err, req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(id) { return `Bearer t-${id}`; }

function asUser(id, role, schoolId = null, status = 'ACTIVE') {
  const u = { id, role, status, schoolId, firstName: 'T', lastName: 'U', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role, schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

function asSchoolAdmin(id, schoolId = 'school-a') {
  // Use legacy global role SCHOOL_ADMIN so req.user.role is 'SCHOOL_ADMIN'
  // This is what blockEducationRolesFromSocialMutation checks.
  const u = { id, role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId, firstName: 'SA', lastName: 'User', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'SCHOOL_ADMIN', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-${id}`, userId: id, schoolId, role: 'SCHOOL_ADMIN', status: 'ACTIVE',
  });
  return u;
}

function asTeacher(id, schoolId = 'school-a') {
  // Use legacy global role TEACHER so req.user.role is 'TEACHER'
  const u = { id, role: 'TEACHER', status: 'ACTIVE', schoolId, firstName: 'TCH', lastName: 'User', avatarUrl: null, deletedAt: null };
  verifyAccessToken.mockReturnValue({ userId: id, role: 'TEACHER', schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue({
    id: `mem-t-${id}`, userId: id, schoolId, role: 'TEACHER', status: 'ACTIVE',
  });
  return u;
}

function asSuperAdmin(id) {
  const u = asUser(id, 'SUPER_ADMIN', null);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  return u;
}

function asMember(id, schoolId = null) {
  const u = asUser(id, 'MEMBER', schoolId);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst) prisma.schoolMembership.findFirst = jest.fn();
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  return u;
}

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);
  require('../utils/redis').getCache.mockResolvedValue(null);
  if (!prisma.schoolMembership) prisma.schoolMembership = {};
  if (!prisma.schoolMembership.findFirst)  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  if (!prisma.schoolMembership.findUnique) prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);
  if (!prisma.auditLog) prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. SOURCE AUDIT — middleware exists and is applied
// ═════════════════════════════════════════════════════════════════════════════

describe('SOURCE AUDIT: socialOwnership.middleware.js', () => {
  test('middleware file exports blockEducationRolesFromSocialMutation', () => {
    const mw = require('../middleware/socialOwnership.middleware');
    expect(typeof mw.blockEducationRolesFromSocialMutation).toBe('function');
  });
  test('middleware file exports blockSuperAdminFromSocialEdit', () => {
    const mw = require('../middleware/socialOwnership.middleware');
    expect(typeof mw.blockSuperAdminFromSocialEdit).toBe('function');
  });
  test('middleware file exports requireSocialSelf', () => {
    const mw = require('../middleware/socialOwnership.middleware');
    expect(typeof mw.requireSocialSelf).toBe('function');
  });
});

describe('SOURCE AUDIT: post.routes.js uses social ownership middleware', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/post.routes.js'), 'utf8');
  test('imports socialOwnership.middleware', () => {
    expect(src).toMatch(/socialOwnership\.middleware/);
  });
  test('PATCH /:id uses blockSuperAdminFromSocialEdit', () => {
    expect(src).toMatch(/blockSuperAdminFromSocialEdit/);
  });
  test('PATCH /:id uses blockEducationRolesFromSocialMutation', () => {
    expect(src).toMatch(/blockEducationRolesFromSocialMutation/);
  });
  test('deletePost controller checks authorId ownership', () => {
    const ctrl = fs.readFileSync(path.join(__dirname, '../controllers/post.controller.js'), 'utf8');
    expect(ctrl).toMatch(/authorId.*req\.user\.id|req\.user\.id.*authorId/);
    expect(ctrl).toMatch(/Not your post|Not authorized/i);
  });
});

describe('SOURCE AUDIT: story.routes.js uses social ownership middleware', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/story.routes.js'), 'utf8');
  test('imports socialOwnership.middleware', () => {
    expect(src).toMatch(/socialOwnership\.middleware/);
  });
  test('react route uses denyIfSuperAdmin', () => {
    expect(src).toMatch(/denyIfSuperAdmin/);
  });
  test('delete route uses blockEducationRolesFromSocialMutation', () => {
    expect(src).toMatch(/blockEducationRolesFromSocialMutation/);
  });
  test('story controller deleteStory checks authorId ownership', () => {
    const ctrl = fs.readFileSync(path.join(__dirname, '../controllers/story.controller.js'), 'utf8');
    expect(ctrl).toMatch(/authorId.*req\.user\.id|Not authorized/i);
  });
});

describe('SOURCE AUDIT: user.routes.js PUT /:id/status has school-scope check', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
  test('status endpoint verifies targetUser.schoolId matches admin schoolId', () => {
    expect(src).toMatch(/targetUser\.schoolId.*schoolId|schoolId.*targetUser\.schoolId/);
  });
  test('status endpoint returns 403 for cross-school access', () => {
    expect(src).toMatch(/own school/i);
  });
});

describe('SOURCE AUDIT: profile routes are self-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
  test('PUT /profile writes only to req.user.id', () => {
    const profileBlock = src.slice(src.indexOf("router.put('/profile'"), src.indexOf("router.put('/username'"));
    expect(profileBlock).toMatch(/req\.user\.id/);
    expect(profileBlock).not.toMatch(/req\.params\.id/);
  });
  test('PUT /username writes only to req.user.id', () => {
    const usernameBlock = src.slice(src.indexOf("router.put('/username'"), src.indexOf("router.get('/'"));
    expect(usernameBlock).toMatch(/req\.user\.id/);
    expect(usernameBlock).not.toMatch(/req\.params\.id/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. RUNTIME: POST mutations — education roles blocked
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: PATCH /posts/:id — social edit ownership', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('SCHOOL_ADMIN cannot PATCH (edit) another user\'s post → 403', async () => {
    asSchoolAdmin('admin-1', 'school-a');
    const res = await request(app)
      .patch('/api/v1/posts/post-123')
      .set('Authorization', tok('admin-1'))
      .send({ body: 'hacked content' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/school admin|social|personal/i);
  });

  test('TEACHER cannot PATCH another user\'s post → 403', async () => {
    asTeacher('teacher-1', 'school-a');
    const res = await request(app)
      .patch('/api/v1/posts/post-123')
      .set('Authorization', tok('teacher-1'))
      .send({ body: 'hacked content' });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN cannot PATCH (edit) another user\'s post → 403', async () => {
    asSuperAdmin('sa-1');
    const res = await request(app)
      .patch('/api/v1/posts/post-123')
      .set('Authorization', tok('sa-1'))
      .send({ body: 'hacked content' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/edit.*social|admin.*panel/i);
  });

  test('Post author can PATCH their own post → proceeds past middleware (200 or 404 from DB mock)', async () => {
    asMember('author-1');
    // Mock the post lookup to return a post owned by this user
    if (!prisma.post) prisma.post = {};
    prisma.post.findFirst = jest.fn().mockResolvedValue({
      id: 'post-123', authorId: 'author-1', deletedAt: null, body: 'original'
    });
    prisma.post.update = jest.fn().mockResolvedValue({ id: 'post-123' });
    // Mock postHashtag for syncHashtags
    if (!prisma.postHashtag) prisma.postHashtag = {};
    prisma.postHashtag.deleteMany = jest.fn().mockResolvedValue({});
    prisma.postHashtag.create = jest.fn().mockResolvedValue({});
    if (!prisma.hashtag) prisma.hashtag = {};
    prisma.hashtag.upsert = jest.fn().mockResolvedValue({});

    const res = await request(app)
      .patch('/api/v1/posts/post-123')
      .set('Authorization', tok('author-1'))
      .send({ body: 'updated content' });
    // Should pass through middleware (not 403)
    expect(res.status).not.toBe(403);
  });
});

describe('RUNTIME: DELETE /posts/:id — education roles blocked from deleting others\' posts', () => {
  let app;
  beforeAll(() => { app = buildPostApp(); });

  test('SCHOOL_ADMIN cannot DELETE another user\'s post → 403', async () => {
    asSchoolAdmin('admin-del', 'school-a');
    if (!prisma.post) prisma.post = {};
    prisma.post.findFirst = jest.fn().mockResolvedValue({
      id: 'post-999', authorId: 'victim-user', deletedAt: null
    });
    if (!prisma.auditLog) prisma.auditLog = { create: jest.fn() };

    const res = await request(app)
      .delete('/api/v1/posts/post-999')
      .set('Authorization', tok('admin-del'));
    expect(res.status).toBe(403);
  });

  test('TEACHER cannot DELETE another user\'s post → 403', async () => {
    asTeacher('teacher-del', 'school-a');
    const res = await request(app)
      .delete('/api/v1/posts/post-999')
      .set('Authorization', tok('teacher-del'));
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. RUNTIME: STORY mutations — education roles blocked
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: POST /stories/:id/react — education roles blocked', () => {
  let app;
  beforeAll(() => { app = buildStoryApp(); });

  test('SCHOOL_ADMIN cannot react to another user\'s story → 403', async () => {
    asSchoolAdmin('admin-react', 'school-a');
    const res = await request(app)
      .post('/api/v1/stories/story-123/react')
      .set('Authorization', tok('admin-react'))
      .send({ type: '❤️' });
    expect(res.status).toBe(403);
  });

  test('TEACHER cannot react to another user\'s story → 403', async () => {
    asTeacher('teacher-react', 'school-a');
    const res = await request(app)
      .post('/api/v1/stories/story-123/react')
      .set('Authorization', tok('teacher-react'))
      .send({ type: '❤️' });
    expect(res.status).toBe(403);
  });

  test('SUPER_ADMIN cannot react to a story → 403', async () => {
    asSuperAdmin('sa-react');
    const res = await request(app)
      .post('/api/v1/stories/story-123/react')
      .set('Authorization', tok('sa-react'))
      .send({ type: '❤️' });
    expect(res.status).toBe(403);
  });
});

describe('RUNTIME: DELETE /stories/:id — education roles blocked', () => {
  let app;
  beforeAll(() => { app = buildStoryApp(); });

  test('SCHOOL_ADMIN cannot delete another user\'s story → 403', async () => {
    asSchoolAdmin('admin-sdel', 'school-a');
    const res = await request(app)
      .delete('/api/v1/stories/story-456')
      .set('Authorization', tok('admin-sdel'));
    expect(res.status).toBe(403);
  });

  test('TEACHER cannot delete another user\'s story → 403', async () => {
    asTeacher('teacher-sdel', 'school-a');
    const res = await request(app)
      .delete('/api/v1/stories/story-456')
      .set('Authorization', tok('teacher-sdel'));
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. RUNTIME: User status — cannot change status of out-of-school user
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: PUT /users/:id/status — cross-school IDOR prevention', () => {
  let app;
  beforeAll(() => { app = buildUserApp(); });

  test('SCHOOL_ADMIN cannot change status of user in a different school → 403', async () => {
    const adminId = 'admin-status';
    const u = { id: adminId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', firstName: 'A', lastName: 'B', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: adminId, role: 'SCHOOL_ADMIN', schoolId: 'school-a' });
    prisma.schoolMembership.findFirst.mockResolvedValue({
      id: `mem-${adminId}`, userId: adminId, schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE',
    });

    // Mock sequence: authenticate lookup → school membership cache → target user lookup
    prisma.user.findUnique
      .mockResolvedValueOnce(u)                                                         // authenticate
      .mockResolvedValueOnce({ id: 'victim-user', schoolId: 'school-b', status: 'ACTIVE' }); // target check inside handler

    const res = await request(app)
      .put('/api/v1/users/victim-user/status')
      .set('Authorization', tok(adminId))
      .set('x-school-id', 'school-a')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own school/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('SCHOOL_ADMIN can change status of user in their own school → 200', async () => {
    const adminId = 'admin-ok';
    const u = { id: adminId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', firstName: 'A', lastName: 'B', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: adminId, role: 'SCHOOL_ADMIN', schoolId: 'school-a' });
    prisma.schoolMembership.findFirst.mockResolvedValue({
      id: `mem-${adminId}`, userId: adminId, schoolId: 'school-a', role: 'SCHOOL_ADMIN', status: 'ACTIVE',
    });

    prisma.user.findUnique
      .mockResolvedValueOnce(u)                                                         // authenticate
      .mockResolvedValueOnce({ id: 'target-user', schoolId: 'school-a', status: 'ACTIVE' }); // target check

    prisma.user.update = jest.fn().mockResolvedValue({ id: 'target-user', status: 'SUSPENDED' });

    const res = await request(app)
      .put('/api/v1/users/target-user/status')
      .set('Authorization', tok(adminId))
      .set('x-school-id', 'school-a')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
  });

  test('Unauthenticated → 401', async () => {
    const res = await request(app)
      .put('/api/v1/users/any-user/status')
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. RUNTIME: Profile mutations — self-only confirmed
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: PUT /users/profile — self-only, no admin bypass', () => {
  let app;
  beforeAll(() => { app = buildUserApp(); });

  test('User can update their own profile → 200', async () => {
    const userId = 'self-user';
    asMember(userId);
    prisma.user.update = jest.fn().mockResolvedValue({
      id: userId, firstName: 'New', lastName: 'Name',
      email: 'u@test.com', phone: null, avatarUrl: null, bio: null, username: null,
    });

    const res = await request(app)
      .put('/api/v1/users/profile')
      .set('Authorization', tok(userId))
      .send({ firstName: 'New', lastName: 'Name' });

    expect(res.status).toBe(200);
    // Confirm the update targeted req.user.id, not any other user
    expect(prisma.user.update.mock.calls[0][0].where.id).toBe(userId);
  });

  test('SCHOOL_ADMIN calling PUT /profile updates only their own profile', async () => {
    const adminId = 'admin-profile';
    const u = { id: adminId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', schoolId: 'school-a', firstName: 'Admin', lastName: 'User', avatarUrl: null, deletedAt: null };
    verifyAccessToken.mockReturnValue({ userId: adminId, role: 'SCHOOL_ADMIN', schoolId: 'school-a' });
    prisma.user.findUnique.mockResolvedValue(u);
    prisma.user.update = jest.fn().mockResolvedValue({
      id: adminId, firstName: 'Admin', lastName: 'User',
      email: 'admin@test.com', phone: null, avatarUrl: null, bio: null, username: null,
    });

    const res = await request(app)
      .put('/api/v1/users/profile')
      .set('Authorization', tok(adminId))
      .send({ firstName: 'Admin', bio: 'my bio' });

    expect(res.status).toBe(200);
    // Must write to own ID only
    expect(prisma.user.update.mock.calls[0][0].where.id).toBe(adminId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. RUNTIME: Social actions — always scoped to req.user.id as actor
// ═════════════════════════════════════════════════════════════════════════════

describe('RUNTIME: Social actions — actor is always the authenticated user', () => {
  let app;
  beforeAll(() => { app = buildSocialApp(); });

  test('POST /social/follow/:userId uses req.user.id as followerId', async () => {
    asMember('follower-1');
    if (!prisma.user) prisma.user = {};
    prisma.user.findUnique = jest.fn()
      .mockResolvedValueOnce({ id: 'follower-1', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'F', lastName: 'L', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce({ id: 'target-user', firstName: 'T', lastName: 'U', role: 'MEMBER', schoolId: null, bio: null, avatarUrl: null });
    if (!prisma.follow) prisma.follow = {};
    prisma.follow.findUnique = jest.fn().mockResolvedValue(null);
    prisma.follow.create = jest.fn().mockResolvedValue({ id: 'follow-1' });

    const res = await request(app)
      .post('/api/v1/social/follow/target-user')
      .set('Authorization', tok('follower-1'));

    expect(res.status).toBe(200);
    // followerId in the follow.create call must be the authenticated user
    const createCall = prisma.follow.create.mock.calls[0][0].data;
    expect(createCall.followerId).toBe('follower-1');
    expect(createCall.followerId).not.toBe('target-user');
  });

  test('DELETE /social/follow/:userId removes only own follows', async () => {
    asMember('unfollower-1');
    if (!prisma.follow) prisma.follow = {};
    prisma.follow.deleteMany = jest.fn().mockResolvedValue({ count: 1 });

    const res = await request(app)
      .delete('/api/v1/social/follow/target-user')
      .set('Authorization', tok('unfollower-1'));

    expect(res.status).toBe(200);
    const deleteCall = prisma.follow.deleteMany.mock.calls[0][0].where;
    expect(deleteCall.followerId).toBe('unfollower-1');
  });

  test('POST /social/friends/request/:userId sends request from authenticated user only', async () => {
    asMember('sender-1');
    prisma.user.findUnique = jest.fn()
      .mockResolvedValueOnce({ id: 'sender-1', role: 'MEMBER', status: 'ACTIVE', schoolId: null, firstName: 'S', lastName: 'D', avatarUrl: null, deletedAt: null })
      .mockResolvedValueOnce({ id: 'receiver-1', firstName: 'R', lastName: 'V', role: 'MEMBER', schoolId: null, bio: null, avatarUrl: null });
    if (!prisma.friendRequest) prisma.friendRequest = {};
    prisma.friendRequest.findFirst = jest.fn().mockResolvedValue(null);
    prisma.friendRequest.create = jest.fn().mockResolvedValue({ id: 'fr-1', status: 'PENDING' });

    const res = await request(app)
      .post('/api/v1/social/friends/request/receiver-1')
      .set('Authorization', tok('sender-1'));

    expect(res.status).toBe(200);
    const createCall = prisma.friendRequest.create.mock.calls[0][0].data;
    expect(createCall.senderId).toBe('sender-1');
    expect(createCall.senderId).not.toBe('receiver-1');
  });
});
