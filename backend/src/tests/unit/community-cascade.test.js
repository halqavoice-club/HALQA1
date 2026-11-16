'use strict';
/**
 * CF-08: Community cascade / soft-delete tests
 * ---------------------------------------------------------------------------
 * Verifies the invariant that community deletion is always soft-delete only.
 * The Post.community relation uses onDelete: SetNull — a hard delete would null
 * out post.communityId, leaking private/invite-only community posts into feeds.
 *
 * Tests:
 *   1. Soft-delete of a community (update with deletedAt) does not affect posts
 *      (communityId remains unchanged on posts after the soft-delete).
 *   2. deleteCommunity() controller uses the soft-delete path
 *      (calls community.update with deletedAt, not community.delete).
 *   3. No production hard-delete path exists in the community controller
 *      (source-code inspection: prisma.community.delete( not present).
 *
 * Tests 2–3 use mock-based inspection of the controller function body.
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
const { getIo } = require('../../sockets');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/communities', require('../../routes/community.routes'));
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
  verifyAccessToken.mockReturnValue({ userId: id, role: role, schoolId: null });
  prisma.user.findUnique.mockResolvedValue({
    id: id, role: role, status: 'ACTIVE', schoolId: null,
    firstName: 'Owner', lastName: 'User', avatarUrl: null, deletedAt: null,
  });
}

function makeCommunity(id, ownerId) {
  return {
    id: id, slug: 'test-community', name: 'Test Community',
    ownerId: ownerId, privacy: 'PUBLIC', deletedAt: null,
    memberCount: 1, postCount: 0, isVerified: false,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

var app;
beforeAll(function() { app = buildApp(); });

beforeEach(function() {
  jest.clearAllMocks();
  require('../../utils/redis').isRedisReady.mockReturnValue(false);
  require('../../utils/redis').getCache.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
  getIo.mockReturnValue(null);
});

// ===========================================================================
// 1. Soft-delete does NOT affect posts — communityId unchanged
// ===========================================================================
test('1: soft-delete of community does not affect post communityId', async function() {
  // This test verifies the application-level behavior:
  // After community.update({ data: { deletedAt } }), no posts are touched.
  // The DB-level SetNull only fires on hard delete, which is never called.

  var communityId = 'comm-c1';
  var postId      = 'post-c1';
  var ownerId     = 'owner-c1';
  asUser(ownerId);

  var community = makeCommunity(communityId, ownerId);
  prisma.community.findFirst.mockResolvedValue(community);

  // getMemberRole() uses communityMember.findUnique with composite key
  prisma.communityMember.findUnique.mockResolvedValue({ role: 'OWNER' });

  // Soft-delete update resolves successfully
  var softDeleted = Object.assign({}, community, { deletedAt: new Date() });
  prisma.community.update.mockResolvedValue(softDeleted);

  var res = await request(app)
    .delete('/api/v1/communities/' + communityId)
    .set('Authorization', tok(ownerId));

  expect(res.status).toBe(200);

  // community.update must have been called with deletedAt
  expect(prisma.community.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: communityId },
      data:  expect.objectContaining({ deletedAt: expect.any(Date) }),
    })
  );

  // community.delete must NOT have been called (would trigger SetNull cascade)
  expect(prisma.community.delete).not.toHaveBeenCalled();

  // No post mutation calls were made
  expect(prisma.post.update).not.toHaveBeenCalled();
  expect(prisma.post.updateMany).not.toHaveBeenCalled();
  expect(prisma.post.delete).not.toHaveBeenCalled();
  expect(prisma.post.deleteMany).not.toHaveBeenCalled();
});

// ===========================================================================
// 2. deleteCommunity() uses soft-delete path (update with deletedAt)
// ===========================================================================
test('2: deleteCommunity controller calls community.update with deletedAt, not community.delete', async function() {
  var communityId = 'comm-c2';
  var ownerId     = 'owner-c2';
  asUser(ownerId);

  var community = makeCommunity(communityId, ownerId);
  prisma.community.findFirst.mockResolvedValue(community);
  prisma.communityMember.findFirst.mockResolvedValue({ role: 'OWNER' });
  prisma.community.update.mockResolvedValue(Object.assign({}, community, { deletedAt: new Date() }));

  var res = await request(app)
    .delete('/api/v1/communities/' + communityId)
    .set('Authorization', tok(ownerId));

  expect(res.status).toBe(200);

  // Soft-delete update called exactly once
  expect(prisma.community.update).toHaveBeenCalledTimes(1);
  var updateCall = prisma.community.update.mock.calls[0][0];
  expect(updateCall.data).toHaveProperty('deletedAt');
  expect(updateCall.data.deletedAt).toBeInstanceOf(Date);

  // Hard delete must never be called
  expect(prisma.community.delete).not.toHaveBeenCalled();
});

// ===========================================================================
// 3. No production hard-delete path in community controller (source inspection)
// ===========================================================================
test('3: community controller source contains no prisma.community.delete() call', function() {
  var controllerPath = path.resolve(__dirname, '../../controllers/community.controller.js');
  var source = fs.readFileSync(controllerPath, 'utf8');

  // Strip single-line and block comments before scanning so the CF-08 invariant
  // comment (which intentionally mentions the forbidden call) does not false-positive.
  var noLineComments  = source.replace(/\/\/[^\n]*/g, '');
  var noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');

  // Check that prisma.community.delete( does not appear in executable code.
  var hardDeletePattern = /prisma\.community\.delete\s*\(/g;
  var matches = noBlockComments.match(hardDeletePattern);

  expect(matches).toBeNull();
});
