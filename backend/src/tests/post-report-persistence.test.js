'use strict';
/**
 * Post Report Persistence Tests
 * ---------------------------------------------------------------------------
 * Verifies that POST /posts/:id/report now persists the report to the DB
 * (via prisma.postReport.create) before emitting the socket event, and that
 * the response returns the created reportId.
 *
 * Previously reportPost() only emitted a socket event -- reports were lost
 * if no admin was online at submission time.
 *
 * Tests:
 *   1. Valid report is persisted to DB and response contains reportId.
 *   2. Report still persists even when socket io is null (no admin online).
 *   3. Duplicate PENDING report returns 409 without creating a second DB row.
 *   4. Reporter cannot report their own post (400).
 *   5. Unauthenticated request is rejected with 401.
 *   6. Report on non-existent post returns 404.
 *   7. Invalid reason returns 400 with list of valid reasons.
 *   8. Missing reason field returns 400.
 *   9. School admin is notified when post belongs to a school.
 *  10. DB create failure propagates as 500 (no silent swallow for write path).
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

const request  = require('supertest');
const express  = require('express');
const cookieParser = require('cookie-parser');
const prisma   = require('../utils/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const { getIo } = require('../sockets');
const { notify } = require('../services/notification.service');

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/posts', require('../routes/post.routes'));
  app.use(function(err, req, res, _next) {
    res.status(err.status || err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tok(id) { return 'Bearer t-' + id; }

function asUser(id, opts) {
  opts = opts || {};
  var role = opts.role || 'MEMBER';
  var schoolId = opts.schoolId || null;
  verifyAccessToken.mockReturnValue({ userId: id, role: role, schoolId: schoolId });
  prisma.user.findUnique.mockResolvedValue({
    id: id, role: role, status: 'ACTIVE', schoolId: schoolId,
    firstName: 'Reporter', lastName: 'User', avatarUrl: null, deletedAt: null,
  });
}

function makePost(id, authorId, schoolId) {
  return {
    id: id, authorId: authorId, deletedAt: null,
    schoolId: schoolId || null,
    visibility: 'PUBLIC', type: 'TEXT', body: 'test post',
  };
}

function makeReport(id, reporterId, postId) {
  return {
    id: id, reporterId: reporterId, postId: postId,
    reason: 'spam', description: null, status: 'PENDING',
    createdAt: new Date(), updatedAt: new Date(),
  };
}

var app;
beforeAll(function() { app = buildApp(); });

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
  getIo.mockReturnValue(null); // default: no admin online
  notify.mockResolvedValue(undefined);
});

// ===========================================================================
// 1. Valid report is persisted and reportId returned
// ===========================================================================
test('1: valid report creates DB row and returns reportId in response', async function() {
  var reporterId = 'reporter-1';
  var postId     = 'post-1';
  var reportId   = 'report-uuid-1';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author'));
  prisma.postReport.findFirst.mockResolvedValue(null); // no pending duplicate
  prisma.postReport.create.mockResolvedValue(makeReport(reportId, reporterId, postId));

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam' });

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data.reportId).toBe(reportId);

  // DB create must have been called with correct data
  expect(prisma.postReport.create).toHaveBeenCalledTimes(1);
  expect(prisma.postReport.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        reporterId: reporterId,
        postId:     postId,
        reason:     'spam',
        status:     'PENDING',
      }),
    })
  );
});

// ===========================================================================
// 2. Report persists even when no admin socket is online (io === null)
// ===========================================================================
test('2: report persists even when socket io is null (no admin online)', async function() {
  var reporterId = 'reporter-2';
  var postId     = 'post-2';
  var reportId   = 'report-uuid-2';
  asUser(reporterId);

  getIo.mockReturnValue(null); // explicitly no admin socket

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-2'));
  prisma.postReport.findFirst.mockResolvedValue(null);
  prisma.postReport.create.mockResolvedValue(makeReport(reportId, reporterId, postId));

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'harassment' });

  expect(res.status).toBe(201);
  // DB row still created even without socket
  expect(prisma.postReport.create).toHaveBeenCalledTimes(1);
  expect(res.body.data.reportId).toBe(reportId);
});

// ===========================================================================
// 3. Duplicate PENDING report returns 409 without creating a second row
// ===========================================================================
test('3: duplicate PENDING report returns 409 and does not create another DB row', async function() {
  var reporterId = 'reporter-3';
  var postId     = 'post-3';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-3'));
  // Simulate existing PENDING report
  prisma.postReport.findFirst.mockResolvedValue({ id: 'existing-report' });

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam' });

  expect(res.status).toBe(409);
  // create must NOT have been called
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 4. Reporter cannot report their own post
// ===========================================================================
test('4: reporter cannot report their own post (400)', async function() {
  var authorId = 'author-reporter-4';
  var postId   = 'post-4';
  asUser(authorId);

  // Post authored by the same user making the request
  prisma.post.findFirst.mockResolvedValue(makePost(postId, authorId));

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(authorId))
    .send({ reason: 'spam' });

  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/own post/i);
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 5. Unauthenticated request returns 401
// ===========================================================================
test('5: unauthenticated request returns 401', async function() {
  verifyAccessToken.mockImplementation(function() { throw new Error('No token'); });

  var res = await request(app)
    .post('/api/v1/posts/some-post/report')
    .send({ reason: 'spam' });

  expect(res.status).toBe(401);
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 6. Non-existent post returns 404
// ===========================================================================
test('6: report on non-existent post returns 404', async function() {
  asUser('reporter-6');
  prisma.post.findFirst.mockResolvedValue(null); // post not found

  var res = await request(app)
    .post('/api/v1/posts/ghost-post/report')
    .set('Authorization', tok('reporter-6'))
    .send({ reason: 'spam' });

  expect(res.status).toBe(404);
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 7. Invalid reason returns 400
// ===========================================================================
test('7: invalid reason returns 400 with valid reasons list', async function() {
  asUser('reporter-7');
  prisma.post.findFirst.mockResolvedValue(makePost('post-7', 'other-author-7'));

  var res = await request(app)
    .post('/api/v1/posts/post-7/report')
    .set('Authorization', tok('reporter-7'))
    .send({ reason: 'not_a_valid_reason' });

  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/reason must be one of/i);
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 8. Missing reason field returns 400
// ===========================================================================
test('8: missing reason field returns 400', async function() {
  asUser('reporter-8');
  prisma.post.findFirst.mockResolvedValue(makePost('post-8', 'other-author-8'));

  var res = await request(app)
    .post('/api/v1/posts/post-8/report')
    .set('Authorization', tok('reporter-8'))
    .send({});

  expect(res.status).toBe(400);
  expect(prisma.postReport.create).not.toHaveBeenCalled();
});

// ===========================================================================
// 9. School admin notified when post belongs to a school
// ===========================================================================
test('9: school admin is notified when reported post belongs to a school', async function() {
  var reporterId   = 'reporter-9';
  var postId       = 'post-9';
  var schoolId     = 'school-9';
  var schoolAdminId = 'school-admin-9';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-9', schoolId));
  prisma.postReport.findFirst.mockResolvedValue(null);
  prisma.postReport.create.mockResolvedValue(makeReport('report-9', reporterId, postId));
  // School admin lookup
  prisma.user.findFirst.mockResolvedValue({ id: schoolAdminId });

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam', description: 'test description' });

  expect(res.status).toBe(201);
  // notify must have been called with the school admin's ID
  expect(notify).toHaveBeenCalledWith(
    schoolAdminId,
    expect.objectContaining({ type: 'SYSTEM' })
  );
});

// ===========================================================================
// 10. DB create failure propagates as 500
// ===========================================================================
test('10: DB create failure propagates as 500 (reports are not silently dropped)', async function() {
  asUser('reporter-10');
  prisma.post.findFirst.mockResolvedValue(makePost('post-10', 'other-author-10'));
  prisma.postReport.findFirst.mockResolvedValue(null);
  prisma.postReport.create.mockRejectedValue(new Error('DB write failed'));

  var res = await request(app)
    .post('/api/v1/posts/post-10/report')
    .set('Authorization', tok('reporter-10'))
    .send({ reason: 'spam' });

  // Must not silently succeed -- the error must surface
  expect(res.status).toBe(500);
});
