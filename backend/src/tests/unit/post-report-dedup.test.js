'use strict';
/**
 * CF-03: PostReport race-condition deduplication tests
 * ---------------------------------------------------------------------------
 * Verifies that the serializable transaction in reportPost() prevents duplicate
 * PENDING rows from the same reporter for the same post, including under
 * concurrent request scenarios.
 *
 * Tests:
 *   1. Single report → 201 and DB row created.
 *   2. Sequential duplicate PENDING report → 409 (second call blocked).
 *   3. Concurrent duplicate reports (Promise.all) → only one row created.
 *   4. Report after previous RESOLVED report → 201 (new PENDING allowed).
 *   5. Different user reports same post → 201.
 *
 * All tests mock prisma.$transaction to control serialization behaviour.
 * No real DB required.
 */

jest.mock('../../utils/prisma');
jest.mock('../../utils/redis', () => ({
  isRedisReady:       jest.fn(() => false),
  getCache:           jest.fn().mockResolvedValue(null),
  setCache:           jest.fn().mockResolvedValue(undefined),
  deleteCache:        jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/jwt', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../../middleware/ipAllowlist', () => (req, res, next) => next());
jest.mock('../../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../../utils/storage', () => ({
  saveFile:   jest.fn().mockResolvedValue({ url: '/uploads/test.jpg' }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/notification.service', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/contentFilter', () => ({
  filterMiddleware: () => (req, res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const prisma = require('../../utils/prisma');
const { verifyAccessToken } = require('../../utils/jwt');

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/posts', require('../../routes/post.routes'));
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

/**
 * Wire up prisma.$transaction to run the callback with a tx proxy that
 * delegates findFirst/create to the provided stub functions.
 *
 * @param {object} opts
 * @param {function} opts.findFirst  - resolves with the stub value for tx.postReport.findFirst
 * @param {function} opts.create     - resolves with the stub value for tx.postReport.create
 */
function mockTransaction(opts) {
  prisma.$transaction.mockImplementation(async (fn) => {
    const tx = {
      postReport: {
        findFirst: jest.fn().mockResolvedValue(opts.findFirst),
        create:    jest.fn().mockResolvedValue(opts.create),
      },
    };
    return fn(tx);
  });
}

var app;
beforeAll(function() { app = buildApp(); });

beforeEach(function() {
  jest.clearAllMocks();
  require('../../utils/redis').isRedisReady.mockReturnValue(false);
  require('../../utils/redis').getCache.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
  prisma.userBlock.findMany.mockResolvedValue([]);
  prisma.follow.findMany.mockResolvedValue([]);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.creatorProfile.findMany.mockResolvedValue([]);
});

// ===========================================================================
// 1. Single report → 201
// ===========================================================================
test('1: single report returns 201 and creates DB row', async function() {
  var reporterId = 'reporter-d1';
  var postId     = 'post-d1';
  var reportId   = 'report-d1';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author'));

  var created = makeReport(reportId, reporterId, postId);
  mockTransaction({ findFirst: null, create: created });

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam' });

  expect(res.status).toBe(201);
  expect(res.body.success).toBe(true);
  expect(res.body.data.reportId).toBe(reportId);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});

// ===========================================================================
// 2. Sequential duplicate PENDING report → 409
// ===========================================================================
test('2: sequential duplicate PENDING report returns 409', async function() {
  var reporterId = 'reporter-d2';
  var postId     = 'post-d2';
  var reportId   = 'report-d2';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-2'));

  // First call: no existing, create succeeds
  var created = makeReport(reportId, reporterId, postId);
  mockTransaction({ findFirst: null, create: created });

  var res1 = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam' });
  expect(res1.status).toBe(201);

  // Second call: existing PENDING found inside transaction → duplicate error
  mockTransaction({ findFirst: { id: reportId }, create: null });

  var res2 = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'spam' });

  expect(res2.status).toBe(409);
  // create must NOT have been called on the second transaction
  // (the tx.postReport.create mock is never reached when findFirst returns a row)
  expect(res2.body.success).toBe(false);
});

// ===========================================================================
// 3. Concurrent duplicate reports → only one row created
// ===========================================================================
test('3: concurrent duplicate reports result in only one created row', async function() {
  var reporterId = 'reporter-d3';
  var postId     = 'post-d3';
  var reportId   = 'report-d3';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-3'));

  // Simulate serialization: first transaction sees no existing row and creates;
  // second transaction sees the row created by the first and throws DUPLICATE_REPORT.
  var callCount = 0;
  prisma.$transaction.mockImplementation(async (fn) => {
    callCount++;
    var isFirst = callCount === 1;
    var tx = {
      postReport: {
        findFirst: jest.fn().mockResolvedValue(isFirst ? null : { id: reportId }),
        create:    jest.fn().mockResolvedValue(makeReport(reportId, reporterId, postId)),
      },
    };
    return fn(tx);
  });

  var [res1, res2] = await Promise.all([
    request(app)
      .post('/api/v1/posts/' + postId + '/report')
      .set('Authorization', tok(reporterId))
      .send({ reason: 'spam' }),
    request(app)
      .post('/api/v1/posts/' + postId + '/report')
      .set('Authorization', tok(reporterId))
      .send({ reason: 'spam' }),
  ]);

  var statuses = [res1.status, res2.status].sort();
  // Exactly one 201 and one 409
  expect(statuses).toEqual([201, 409]);
  // $transaction was called twice (once per request)
  expect(prisma.$transaction).toHaveBeenCalledTimes(2);
});

// ===========================================================================
// 4. Report after previous RESOLVED report → 201 (new PENDING allowed)
// ===========================================================================
test('4: report after previous RESOLVED report returns 201', async function() {
  var reporterId = 'reporter-d4';
  var postId     = 'post-d4';
  var reportId   = 'report-d4-new';
  asUser(reporterId);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-4'));

  // Transaction finds no PENDING row (old one has status RESOLVED), so create succeeds
  var created = makeReport(reportId, reporterId, postId);
  mockTransaction({ findFirst: null, create: created });

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporterId))
    .send({ reason: 'harassment' });

  expect(res.status).toBe(201);
  expect(res.body.data.reportId).toBe(reportId);
});

// ===========================================================================
// 5. Different user reports same post → 201
// ===========================================================================
test('5: different user reporting same post returns 201', async function() {
  var reporter2Id = 'reporter-d5-b';
  var postId      = 'post-d5';
  var reportId    = 'report-d5-b';
  asUser(reporter2Id);

  prisma.post.findFirst.mockResolvedValue(makePost(postId, 'other-author-5'));

  // No PENDING report for this reporter (different user)
  var created = makeReport(reportId, reporter2Id, postId);
  mockTransaction({ findFirst: null, create: created });

  var res = await request(app)
    .post('/api/v1/posts/' + postId + '/report')
    .set('Authorization', tok(reporter2Id))
    .send({ reason: 'scam' });

  expect(res.status).toBe(201);
  expect(res.body.data.reportId).toBe(reportId);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
