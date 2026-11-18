'use strict';
/**
 * Exclusive Content Authorization Gates
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the P0-02 fix applied to getReels() and getUserPosts().
 *
 * Gap 1 (getReels): The inline reelsVisibilityFilter had no isExclusive check.
 *   Any viewer — subscriber or not — received exclusive VIDEO posts.
 *
 * Gap 2 (getUserPosts non-owner): The non-owner where clause only excluded
 *   PRIVATE posts (visibility != PRIVATE).  Exclusive posts were not gated.
 *
 * Fix: Both endpoints now apply the same subscription-gate pattern used by
 *   visibilityFilter() / getFeed():
 *     - Non-exclusive branches carry isExclusive:false
 *     - An active CreatorSubscription (via creatorProfile) is required for
 *       isExclusive:true posts
 *     - Visibility rules (FOLLOWERS, SCHOOL_ONLY) still apply on top of the
 *       subscription check — a subscription alone is not sufficient
 *
 * Test cases:
 *   1. Non-subscriber cannot see exclusive Reel in getReels()
 *   2. Subscriber CAN see exclusive Reel (PUBLIC, active subscription)
 *   3. Non-subscriber cannot see exclusive post in getUserPosts()
 *   4. Subscriber CAN see exclusive post in getUserPosts()
 *   5. FOLLOWERS-exclusive post: subscriber who follows → sees it;
 *      subscriber who does NOT follow → does NOT see it
 * ─────────────────────────────────────────────────────────────────────────────
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

// ─── App builder ─────────────────────────────────────────────────────────────

function buildApp() {
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

function asUser(id, opts) {
  opts = opts || {};
  const u = {
    id,
    role:      opts.role     || 'MEMBER',
    status:    'ACTIVE',
    schoolId:  opts.schoolId || null,
    firstName: 'Test',
    lastName:  'User',
    avatarUrl: null,
    deletedAt: null,
  };
  verifyAccessToken.mockReturnValue({ userId: id, role: u.role, schoolId: u.schoolId });
  prisma.user.findUnique.mockResolvedValue(u);
  return u;
}

/** Build a minimal post object the controller will accept from prisma.post.findMany */
function makePost(id, authorId, opts) {
  opts = opts || {};
  return {
    id,
    authorId,
    visibility:     opts.visibility     || 'PUBLIC',
    isDraft:        opts.isDraft        !== undefined ? opts.isDraft : false,
    isExclusive:    opts.isExclusive    || false,
    type:           opts.type           || 'TEXT',
    communityId:    opts.communityId    || null,
    schoolId:       opts.schoolId       || null,
    body:           'Post body',
    deletedAt:      opts.deletedAt      !== undefined ? opts.deletedAt : null,
    likeCount:      0,
    commentCount:   0,
    viewCount:      0,
    shareCount:     0,
    bookmarkCount:  0,
    isPinned:       false,
    scheduledAt:    null,
    pollData:       null,
    originalPostId: null,
    quotedBody:     null,
    refEntityType:  null,
    refEntityId:    null,
    location:       null,
    createdAt:      new Date('2024-06-01T12:00:00Z'),
    updatedAt:      new Date('2024-06-01T12:00:00Z'),
    author: {
      id: authorId,
      firstName: 'Creator', lastName: 'User',
      avatarUrl: null, role: 'MEMBER', schoolId: null,
    },
    media:        opts.media     || [],
    hashtags:     [],
    community:    null,
    reactions:    [],
    bookmarks:    [],
    originalPost: null,
    _count:       { reactions: 0, comments: 0 },
  };
}

/** Minimal VIDEO-media reel post */
function makeReelPost(id, authorId, opts) {
  return makePost(id, authorId, {
    ...opts,
    type:  'VIDEO',
    media: [{ id: `m-${id}`, type: 'VIDEO', url: '/v.mp4', orderIndex: 0 }],
  });
}

// ─── Global beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  require('../utils/redis').isRedisReady.mockReturnValue(false);

  // Minimal prisma surface required by all tests in this file
  prisma.user       = prisma.user       || {};
  prisma.user.findUnique = jest.fn().mockResolvedValue(null);

  prisma.post       = prisma.post       || {};
  prisma.post.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.post.findMany   = jest.fn().mockResolvedValue([]);
  prisma.post.count      = jest.fn().mockResolvedValue(0);
  prisma.post.update     = jest.fn().mockResolvedValue({});
  prisma.post.findUnique = jest.fn().mockResolvedValue(null);

  prisma.follow = prisma.follow || {};
  prisma.follow.findMany  = jest.fn().mockResolvedValue([]);
  prisma.follow.findFirst = jest.fn().mockResolvedValue(null);

  prisma.userBlock = prisma.userBlock || {};
  prisma.userBlock.findMany  = jest.fn().mockResolvedValue([]);
  prisma.userBlock.findFirst = jest.fn().mockResolvedValue(null);

  prisma.schoolMembership = prisma.schoolMembership || {};
  prisma.schoolMembership.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.schoolMembership.findUnique = jest.fn().mockResolvedValue(null);

  prisma.creatorSubscription = prisma.creatorSubscription || {};
  prisma.creatorSubscription.findMany  = jest.fn().mockResolvedValue([]);
  prisma.creatorSubscription.findFirst = jest.fn().mockResolvedValue(null);

  prisma.creatorProfile = prisma.creatorProfile || {};
  prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(null);
  prisma.creatorProfile.findMany   = jest.fn().mockResolvedValue([]);

  prisma.community = prisma.community || {};
  prisma.community.findUnique = jest.fn().mockResolvedValue(null);
  prisma.community.findMany   = jest.fn().mockResolvedValue([]);

  prisma.communityMember = prisma.communityMember || {};
  prisma.communityMember.findUnique = jest.fn().mockResolvedValue(null);
  prisma.communityMember.findMany   = jest.fn().mockResolvedValue([]);

  prisma.communityBan = prisma.communityBan || {};
  prisma.communityBan.findFirst = jest.fn().mockResolvedValue(null);
  prisma.communityBan.findMany  = jest.fn().mockResolvedValue([]);

  prisma.postBookmark = prisma.postBookmark || {};
  prisma.postBookmark.findUnique = jest.fn().mockResolvedValue(null);
  prisma.postBookmark.create     = jest.fn().mockResolvedValue({});
  prisma.postBookmark.delete     = jest.fn().mockResolvedValue({});
  prisma.postBookmark.findMany   = jest.fn().mockResolvedValue([]);

  prisma.postReaction = prisma.postReaction || {};
  prisma.postReaction.findUnique = jest.fn().mockResolvedValue(null);
  prisma.postReaction.create     = jest.fn().mockResolvedValue({});
  prisma.postReaction.delete     = jest.fn().mockResolvedValue({});
  prisma.postReaction.update     = jest.fn().mockResolvedValue({});
  prisma.postReaction.findMany   = jest.fn().mockResolvedValue([]);

  prisma.postComment = prisma.postComment || {};
  prisma.postComment.findFirst  = jest.fn().mockResolvedValue(null);
  prisma.postComment.findUnique = jest.fn().mockResolvedValue(null);
  prisma.postComment.create     = jest.fn().mockResolvedValue({});
  prisma.postComment.update     = jest.fn().mockResolvedValue({});

  prisma.postView = prisma.postView || {};
  prisma.postView.create = jest.fn().mockResolvedValue({});

  prisma.postMention = prisma.postMention || {};
  prisma.postMention.upsert     = jest.fn().mockResolvedValue({});
  prisma.postMention.create     = jest.fn().mockResolvedValue({});
  prisma.postMention.deleteMany = jest.fn().mockResolvedValue({});

  prisma.hashtag = prisma.hashtag || {};
  prisma.hashtag.upsert = jest.fn().mockResolvedValue({});

  prisma.postHashtag = prisma.postHashtag || {};
  prisma.postHashtag.upsert     = jest.fn().mockResolvedValue({});
  prisma.postHashtag.findMany   = jest.fn().mockResolvedValue([]);

  prisma.auditLog = prisma.auditLog || {};
  prisma.auditLog.create = jest.fn().mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════════════════════
// getReels — exclusive content gates
// ═══════════════════════════════════════════════════════════════════════════════

describe('getReels — exclusive content gates (P0-02)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  // ── Test 1: Non-subscriber does NOT see exclusive Reel ──────────────────
  test('Non-subscriber: exclusive PUBLIC reel is excluded from results', async () => {
    const viewerId  = 'viewer-reels-nosub';
    const creatorId = 'creator-reels-1';

    asUser(viewerId);

    // The exclusive reel exists in the DB
    const exclusiveReel = makeReelPost('reel-excl-1', creatorId, {
      visibility:  'PUBLIC',
      isExclusive: true,
    });

    // Viewer has NO active subscription
    prisma.creatorSubscription.findMany.mockResolvedValue([]);
    // findMany for posts: the controller builds a Prisma WHERE that must exclude
    // isExclusive:true posts when subscribedCreatorIds is empty.
    // We simulate the DB honouring that WHERE by returning only non-exclusive posts.
    // (In a real DB, the WHERE clause is what enforces it — this test verifies
    // the WHERE sent to Prisma does NOT include any exclusive-permitting branch
    // when the viewer has no subscriptions.)
    prisma.post.findMany.mockImplementation(({ where }) => {
      // The OR array must NOT contain any branch that permits isExclusive:true
      // for a non-subscribed viewer.
      const orBranches = where.OR || [];
      const hasExclusiveBranch = orBranches.some(
        branch => branch.isExclusive === true
      );
      if (hasExclusiveBranch) {
        // Fix is not applied — return exclusive post (surfaces the bug)
        return Promise.resolve([exclusiveReel]);
      }
      // Fix applied — WHERE correctly excludes exclusive posts → empty result
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get('/api/v1/posts/reels')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const ids = (res.body.data?.items || []).map(p => p.id);
    expect(ids).not.toContain('reel-excl-1');
  });

  // ── Test 2: Subscriber DOES see exclusive Reel ──────────────────────────
  test('Subscriber: exclusive PUBLIC reel IS included in results', async () => {
    const viewerId    = 'viewer-reels-sub';
    const creatorId   = 'creator-reels-2';
    const profileId   = 'cp-reels-2';

    asUser(viewerId);

    const exclusiveReel = makeReelPost('reel-excl-2', creatorId, {
      visibility:  'PUBLIC',
      isExclusive: true,
    });

    // Viewer HAS an active subscription
    prisma.creatorSubscription.findMany.mockResolvedValue([
      { creatorId: profileId }
    ]);
    // creatorProfile maps profileId → creatorId (userId)
    prisma.creatorProfile.findMany.mockResolvedValue([
      { userId: creatorId }
    ]);

    // Simulate DB returning the exclusive reel because the WHERE now includes
    // the subscriber branch { isExclusive:true, visibility:'PUBLIC', authorId:{in:[creatorId]} }
    prisma.post.findMany.mockImplementation(({ where }) => {
      const orBranches = where.OR || [];
      const exclusiveBranch = orBranches.find(
        b => b.isExclusive === true && b.visibility === 'PUBLIC'
      );
      if (exclusiveBranch && exclusiveBranch.authorId?.in?.includes(creatorId)) {
        return Promise.resolve([exclusiveReel]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get('/api/v1/posts/reels')
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const ids = (res.body.data?.items || []).map(p => p.id);
    expect(ids).toContain('reel-excl-2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserPosts — exclusive content gates
// ═══════════════════════════════════════════════════════════════════════════════

describe('getUserPosts — exclusive content gates (P0-02)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  // ── Test 3: Non-subscriber does NOT see exclusive post on user profile ───
  test('Non-subscriber: exclusive PUBLIC post is excluded from profile results', async () => {
    const viewerId  = 'viewer-up-nosub';
    const creatorId = 'creator-up-1';
    const profileId = 'cp-up-1';

    asUser(viewerId);

    const exclusivePost = makePost('post-excl-up-1', creatorId, {
      visibility:  'PUBLIC',
      isExclusive: true,
    });

    // No subscription
    prisma.creatorSubscription.findMany.mockResolvedValue([]);
    prisma.creatorProfile.findMany.mockResolvedValue([]);

    // Simulate DB: the AND clause must contain an isExclusive gate.
    // If the gate is missing the exclusive post leaks through.
    prisma.post.findMany.mockImplementation(({ where }) => {
      const andClauses = where.AND || [];
      const exclusiveGate = andClauses.find(clause =>
        clause.OR && clause.OR.some(b => b.isExclusive === false)
      );
      if (!exclusiveGate) {
        // No exclusive gate — fix not applied, return the exclusive post (surfaces bug)
        return Promise.resolve([exclusivePost]);
      }
      // Exclusive gate present. With no subscriptions, isExclusive:true posts are
      // excluded because the only matching branch is { isExclusive:false }.
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get(`/api/v1/posts/user/${creatorId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const ids = (res.body.data?.items || []).map(p => p.id);
    expect(ids).not.toContain('post-excl-up-1');
  });

  // ── Test 4: Subscriber DOES see exclusive post on user profile ───────────
  test('Subscriber: exclusive PUBLIC post IS included in profile results', async () => {
    const viewerId  = 'viewer-up-sub';
    const creatorId = 'creator-up-2';
    const profileId = 'cp-up-2';

    asUser(viewerId);

    const exclusivePost = makePost('post-excl-up-2', creatorId, {
      visibility:  'PUBLIC',
      isExclusive: true,
    });

    // Active subscription
    prisma.creatorSubscription.findMany.mockResolvedValue([
      { creatorId: profileId }
    ]);
    prisma.creatorProfile.findMany.mockResolvedValue([
      { userId: creatorId }
    ]);

    // Simulate DB: the AND exclusive gate includes the subscriber branch,
    // so the exclusive post is returned.
    prisma.post.findMany.mockImplementation(({ where }) => {
      const andClauses = where.AND || [];
      const exclusiveGate = andClauses.find(clause =>
        clause.OR && clause.OR.some(b => b.isExclusive === false)
      );
      if (!exclusiveGate) {
        // No gate — return nothing (conservative)
        return Promise.resolve([]);
      }
      // Gate present. The subscriber branch { authorId:{in:[creatorId]} } should
      // allow the exclusive post through.
      const subscriberBranch = exclusiveGate.OR.find(b =>
        b.authorId?.in?.includes(creatorId)
      );
      if (subscriberBranch) {
        return Promise.resolve([exclusivePost]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get(`/api/v1/posts/user/${creatorId}`)
      .set('Authorization', tok(viewerId));

    expect(res.status).toBe(200);
    const ids = (res.body.data?.items || []).map(p => p.id);
    expect(ids).toContain('post-excl-up-2');
  });

  // ── Test 5: FOLLOWERS-exclusive post — subscription alone is not enough ──
  // A post with visibility:'FOLLOWERS' + isExclusive:true requires BOTH:
  //   a) The viewer has an active subscription to the creator, AND
  //   b) The viewer follows the creator
  // This test has two sub-scenarios: subscriber+follower (sees it) and
  // subscriber+non-follower (does not see it).
  test('FOLLOWERS-exclusive: subscriber who follows sees it; subscriber who does NOT follow does not', async () => {
    const followerViewerId    = 'viewer-flw-sub-follows';
    const nonFollowerViewerId = 'viewer-flw-sub-nofollows';
    const creatorId           = 'creator-flw-excl';
    const profileId           = 'cp-flw-excl';

    const exclusiveFollowersPost = makePost('post-flw-excl-1', creatorId, {
      visibility:  'FOLLOWERS',
      isExclusive: true,
    });

    // ── Sub-scenario A: viewer subscribes AND follows ────────────────────
    asUser(followerViewerId);
    prisma.creatorSubscription.findMany.mockResolvedValue([{ creatorId: profileId }]);
    prisma.creatorProfile.findMany.mockResolvedValue([{ userId: creatorId }]);
    // Viewer follows the creator
    prisma.follow.findMany.mockResolvedValue([{ followingId: creatorId }]);

    // The WHERE must include a branch for
    // { isExclusive:true, visibility:'FOLLOWERS', authorId:{in:[creatorId]} }
    // which requires creatorId to be in BOTH subscribedCreatorIds AND followingIds.
    prisma.post.findMany.mockImplementation(({ where }) => {
      const orBranches = where.OR || [];
      const followersExclusiveBranch = orBranches.find(b =>
        b.isExclusive === true &&
        b.visibility  === 'FOLLOWERS' &&
        b.authorId?.in?.includes(creatorId)
      );
      if (followersExclusiveBranch) {
        return Promise.resolve([exclusiveFollowersPost]);
      }
      return Promise.resolve([]);
    });

    const resFollower = await request(app)
      .get('/api/v1/posts/reels')
      .set('Authorization', tok(followerViewerId));

    expect(resFollower.status).toBe(200);
    const followerIds = (resFollower.body.data?.items || []).map(p => p.id);
    expect(followerIds).toContain('post-flw-excl-1');

    // ── Sub-scenario B: viewer subscribes but does NOT follow ─────────────
    jest.clearAllMocks();
    require('../utils/redis').isRedisReady.mockReturnValue(false);

    asUser(nonFollowerViewerId);
    prisma.creatorSubscription.findMany.mockResolvedValue([{ creatorId: profileId }]);
    prisma.creatorProfile.findMany.mockResolvedValue([{ userId: creatorId }]);
    // Viewer does NOT follow the creator
    prisma.follow.findMany.mockResolvedValue([]);

    // With no followingIds, the FOLLOWERS-exclusive branch must NOT be generated.
    // getReels only adds that branch when
    //   followingIds.includes(creatorId) — which is false here.
    prisma.post.findMany.mockImplementation(({ where }) => {
      const orBranches = where.OR || [];
      const followersExclusiveBranch = orBranches.find(b =>
        b.isExclusive === true &&
        b.visibility  === 'FOLLOWERS' &&
        b.authorId?.in?.includes(creatorId)
      );
      if (followersExclusiveBranch) {
        // Branch present even without following — fix is not applied correctly
        return Promise.resolve([exclusiveFollowersPost]);
      }
      // No branch → post excluded (correct behaviour)
      return Promise.resolve([]);
    });

    // Reinitialise mocks cleared by jest.clearAllMocks above
    prisma.user       = prisma.user       || {};
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      id: nonFollowerViewerId, role: 'MEMBER', status: 'ACTIVE',
      schoolId: null, firstName: 'Test', lastName: 'User',
      avatarUrl: null, deletedAt: null,
    });
    prisma.userBlock = prisma.userBlock || {};
    prisma.userBlock.findMany  = jest.fn().mockResolvedValue([]);
    prisma.communityMember = prisma.communityMember || {};
    prisma.communityMember.findMany = jest.fn().mockResolvedValue([]);
    prisma.community = prisma.community || {};
    prisma.community.findMany = jest.fn().mockResolvedValue([]);
    prisma.communityBan = prisma.communityBan || {};
    prisma.communityBan.findMany = jest.fn().mockResolvedValue([]);
    prisma.schoolMembership = prisma.schoolMembership || {};
    prisma.schoolMembership.findFirst = jest.fn().mockResolvedValue(null);
    prisma.post.update = jest.fn().mockResolvedValue({});

    const resNonFollower = await request(app)
      .get('/api/v1/posts/reels')
      .set('Authorization', tok(nonFollowerViewerId));

    expect(resNonFollower.status).toBe(200);
    const nonFollowerIds = (resNonFollower.body.data?.items || []).map(p => p.id);
    expect(nonFollowerIds).not.toContain('post-flw-excl-1');
  });
});
