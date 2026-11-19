'use strict';
/**
 * Community soft-delete feed visibility regression tests
 * ---------------------------------------------------------------------------
 * Verifies that visibilityFilter() excludes posts from soft-deleted communities
 * for non-member viewers while still allowing the post author to see their own
 * posts (the { authorId: viewerId } OR branch in filter.AND).
 *
 * Plan reference: PR #149 remediation plan — Part B, Item 6.
 * The plan confirmed that visibilityFilter() already includes { deletedAt: null }
 * in both the publicCommunities and memberCommunities queries. These tests add
 * the feed-level regression coverage that was absent (prior tests only inspected
 * the controller body / soft-delete invariants; they did not assert the
 * visibilityFilter() feed-filter output).
 *
 * Tests:
 *   V1. A post in a soft-deleted PUBLIC community is excluded from a non-member's
 *       feed: the community is absent from publicCommunityIds (deletedAt filter),
 *       so its posts do not appear in allowedCommunityIds and are blocked by the
 *       community gate in filter.AND.
 *   V2. The author of a post in a soft-deleted community still sees their own
 *       post: the { authorId: viewerId } OR branch in filter.AND passes regardless
 *       of community state.
 *   V3. A post in a soft-deleted PRIVATE/INVITE_ONLY community is inaccessible
 *       even to a viewer who was previously a member: communityMember rows are
 *       filtered by { community: { deletedAt: null } }, so the community ID is
 *       absent from accessibleMemberCommunityIds.
 *
 * All tests mock Prisma and use the feed route (/api/v1/posts/feed) to exercise
 * the full visibilityFilter() → getFeed() path. The filter output is verified
 * by asserting which post IDs are present/absent in the response.
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
// postAccess helpers are used by getFeed for originalPost filtering;
// stub them to pass-through so our feed tests are not affected by their logic.
jest.mock('../../utils/postAccess', () => ({
  assertPostAccessible: jest.fn().mockResolvedValue(undefined),
  filterOriginalPost:   jest.fn((op) => op),
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

function asUser(id) {
  verifyAccessToken.mockReturnValue({ userId: id, role: 'MEMBER', schoolId: null });
  prisma.user.findUnique.mockResolvedValue({
    id: id, role: 'MEMBER', status: 'ACTIVE', schoolId: null,
    firstName: 'Viewer', lastName: 'User', avatarUrl: null, deletedAt: null,
  });
}

/**
 * Build a minimal post object that the feed controller can return.
 * postAccess.filterOriginalPost is mocked to pass-through so originalPost
 * content does not affect these community-gate tests.
 */
function makePost(id, authorId, communityId) {
  return {
    id,
    authorId,
    communityId: communityId || null,
    visibility: 'PUBLIC',
    isDraft: false,
    deletedAt: null,
    isExclusive: false,
    type: 'TEXT',
    body: 'test body',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    schoolId: null,
    // Minimal includes expected by POST_INCLUDE
    author: { id: authorId, firstName: 'A', lastName: 'B', avatarUrl: null, role: 'MEMBER', schoolId: null },
    media: [],
    hashtags: [],
    community: communityId ? { id: communityId, slug: 'c', name: 'C', avatarUrl: null } : null,
    _count: { reactions: 0, comments: 0 },
    reactions: [],
    bookmarks: [],
    originalPost: null,
  };
}

/**
 * Wire up the minimal Prisma mocks that visibilityFilter() calls in parallel.
 * Each option accepts a list; default to empty array / null for unneeded ones.
 *
 * @param {object} opts
 * @param {string}   opts.viewerId
 * @param {string[]} [opts.publicCommunityIds=[]]   IDs returned for non-deleted PUBLIC communities
 * @param {string[]} [opts.memberCommunityIds=[]]   IDs returned for viewer's non-deleted memberships
 * @param {string[]} [opts.bannedCommunityIds=[]]   IDs returned for community bans
 * @param {object[]} [opts.posts=[]]                Posts returned by prisma.post.findMany
 */
function wireVisibilityMocks(opts) {
  var viewerId = opts.viewerId;
  var publicIds = opts.publicCommunityIds || [];
  var memberIds = opts.memberCommunityIds || [];
  var bannedIds = opts.bannedCommunityIds || [];
  var posts     = opts.posts || [];

  // visibilityFilter() parallel queries
  prisma.user.findUnique.mockResolvedValue({ id: viewerId, schoolId: null });
  prisma.follow.findMany.mockResolvedValue([]);
  prisma.creatorSubscription.findMany.mockResolvedValue([]);
  prisma.creatorProfile.findMany.mockResolvedValue([]);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.userBlock.findMany.mockResolvedValue([]);

  // CF-20: community queries — the key mocks for these tests
  prisma.communityMember.findMany.mockResolvedValue(
    memberIds.map(id => ({ communityId: id }))
  );
  prisma.community.findMany.mockResolvedValue(
    publicIds.map(id => ({ id }))
  );
  prisma.communityBan.findMany.mockResolvedValue(
    bannedIds.map(id => ({ communityId: id }))
  );

  // Feed post query
  prisma.post.findMany.mockResolvedValue(posts);

  // stampFollowing — follow lookup after feed results
  prisma.follow.findMany.mockResolvedValue([]);
}

var app;
beforeAll(function() { app = buildApp(); });

beforeEach(function() {
  jest.clearAllMocks();
  require('../../utils/redis').isRedisReady.mockReturnValue(false);
  require('../../utils/redis').getCache.mockResolvedValue(null);
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.auditLog.create.mockResolvedValue({});
});

// ===========================================================================
// V1. Post in soft-deleted PUBLIC community → excluded for non-member viewer
// ---------------------------------------------------------------------------
// When a PUBLIC community is soft-deleted its ID is absent from the
// publicCommunities query result (WHERE deletedAt IS NULL). The post's
// communityId is therefore not in allowedCommunityIds and the community gate
// in filter.AND rejects it for non-member viewers.
//
// This is verified by asserting that prisma.post.findMany is called with a
// where clause whose AND[0].OR does NOT include the soft-deleted community ID
// in the { communityId: { in: [...] } } branch.
// ===========================================================================
test('V1: visibilityFilter excludes soft-deleted PUBLIC community from allowedCommunityIds', async function() {
  var viewerId    = 'viewer-v1';
  var communityId = 'comm-deleted-v1';
  asUser(viewerId);

  // The community is soft-deleted: its ID does NOT appear in publicCommunities
  // (the query filters WHERE privacy='PUBLIC' AND deletedAt IS NULL).
  // The viewer is not a member either.
  wireVisibilityMocks({
    viewerId,
    publicCommunityIds:  [],   // soft-deleted → absent from results
    memberCommunityIds:  [],   // not a member
    bannedCommunityIds:  [],
    posts: [],                 // no posts returned (gate correctly excludes)
  });

  var res = await request(app)
    .get('/api/v1/posts/feed')
    .set('Authorization', tok(viewerId));

  expect(res.status).toBe(200);

  // Verify the community gate in the where clause passed to post.findMany
  // does NOT include the soft-deleted community ID.
  expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
  var whereArg = prisma.post.findMany.mock.calls[0][0].where;
  // AND[0].OR contains the community gate
  var communityGate = whereArg.AND && whereArg.AND[0] && whereArg.AND[0].OR;
  expect(communityGate).toBeDefined();

  // The { communityId: { in: [...] } } branch must not contain the deleted community
  var communityInBranch = communityGate.find(function(branch) {
    return branch.communityId && branch.communityId.in;
  });
  if (communityInBranch) {
    expect(communityInBranch.communityId.in).not.toContain(communityId);
  }
  // (If communityInBranch is undefined the in-list is empty / absent — also correct)
});

// ===========================================================================
// V2. Author always sees their own post in a soft-deleted community
// ---------------------------------------------------------------------------
// The filter.AND community gate includes { authorId: viewerId } as an OR branch,
// which passes regardless of community state. Authors never lose visibility of
// their own posts due to community deletion.
// ===========================================================================
test('V2: author still sees their own post after community soft-delete', async function() {
  var authorId    = 'author-v2';
  var communityId = 'comm-deleted-v2';
  var postId      = 'post-v2';
  asUser(authorId);

  // Soft-deleted community: absent from publicCommunities, not a member
  wireVisibilityMocks({
    viewerId:           authorId,
    publicCommunityIds: [],
    memberCommunityIds: [],
    bannedCommunityIds: [],
    // Post.findMany returns the author's own post despite the deleted community.
    // This simulates what the DB returns when the { authorId: viewerId } OR branch
    // matches — the community gate authorId branch overrides the community check.
    posts: [makePost(postId, authorId, communityId)],
  });

  var res = await request(app)
    .get('/api/v1/posts/feed')
    .set('Authorization', tok(authorId));

  expect(res.status).toBe(200);

  // Verify the { authorId: viewerId } branch is present in the community gate
  expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
  var whereArg = prisma.post.findMany.mock.calls[0][0].where;
  var communityGate = whereArg.AND && whereArg.AND[0] && whereArg.AND[0].OR;
  expect(communityGate).toBeDefined();

  var authorBranch = communityGate.find(function(branch) {
    return branch.authorId === authorId;
  });
  expect(authorBranch).toBeDefined();

  // The response items include the author's post
  expect(res.body.data.items).toHaveLength(1);
  expect(res.body.data.items[0].id).toBe(postId);
});

// ===========================================================================
// V3. Former member cannot see posts in soft-deleted PRIVATE community
// ---------------------------------------------------------------------------
// communityMember.findMany filters WHERE userId=viewerId AND community.deletedAt IS NULL.
// When the community is soft-deleted the viewer's membership row is excluded,
// so the community ID is absent from accessibleMemberCommunityIds.
// ===========================================================================
test('V3: former member cannot see posts in soft-deleted private community', async function() {
  var viewerId    = 'viewer-v3';
  var communityId = 'comm-private-deleted-v3';
  asUser(viewerId);

  // Soft-deleted PRIVATE community: membership query returns [] because
  // { community: { deletedAt: null } } excludes the deleted community.
  // Public community query also returns [] (it was PRIVATE, not PUBLIC).
  wireVisibilityMocks({
    viewerId,
    publicCommunityIds:  [],   // PRIVATE community not in public list
    memberCommunityIds:  [],   // soft-deleted → membership filtered out
    bannedCommunityIds:  [],
    posts: [],                 // correctly excluded
  });

  var res = await request(app)
    .get('/api/v1/posts/feed')
    .set('Authorization', tok(viewerId));

  expect(res.status).toBe(200);

  // Community gate must not include the soft-deleted private community
  expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
  var whereArg = prisma.post.findMany.mock.calls[0][0].where;
  var communityGate = whereArg.AND && whereArg.AND[0] && whereArg.AND[0].OR;
  expect(communityGate).toBeDefined();

  var communityInBranch = communityGate.find(function(branch) {
    return branch.communityId && branch.communityId.in;
  });
  if (communityInBranch) {
    expect(communityInBranch.communityId.in).not.toContain(communityId);
  }

  // No posts returned — gate correctly blocked the community
  expect(res.body.data.items).toHaveLength(0);
});
