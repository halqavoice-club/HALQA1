'use strict';
/**
 * SOURCE-LEVEL UNIT TESTS — Phase 24E Community Security
 *
 * Tests for:
 *   COMM-P2-001 — kickMember role hierarchy enforcement
 *   COMM-P2-002 — getMembers privacy boundary (PRIVATE/INVITE_ONLY non-member denied)
 *   COMM-P2-003 — getCommunityFeed / getCommunityMedia INVITE_ONLY privacy guard
 *   COMM-P3-001 — joinCommunity existing-member check before ban check ordering
 *
 * These are source-level unit tests. All DB and external calls are mocked.
 * No runtime server is required.
 */

const {
  kickMember,
  getMembers,
  getCommunityFeed,
  getCommunityMedia,
  joinCommunity,
} = require('../controllers/community.controller');

// ─── Mock prisma ──────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  community:       { findFirst: jest.fn(), update: jest.fn() },
  communityMember: { findUnique: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  communityBan:    { findUnique: jest.fn() },
  communityInvite: { findFirst: jest.fn() },
  communityJoinRequest: { findFirst: jest.fn(), create: jest.fn() },
  post:            { findMany: jest.fn() },
  userBlock:       { findMany: jest.fn() },
  $transaction:    jest.fn(ops => Array.isArray(ops) ? Promise.all(ops) : ops(mockTx)),
}));

jest.mock('../sockets', () => ({ getIo: jest.fn(() => null) }));
jest.mock('../services/notification.service', () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/redis', () => ({
  isRedisReady: jest.fn(() => false),
  getRedis:     jest.fn(),
}));

const prisma = require('../utils/prisma');

// Mock transaction proxy for callback-style transactions
const mockTx = {
  communityMember: { delete: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  community:       { update: jest.fn(), create: jest.fn() },
  communityInvite: { update: jest.fn() },
  communityJoinRequest: { create: jest.fn() },
};
prisma.$transaction.mockImplementation(async (opsOrFn) => {
  if (typeof opsOrFn === 'function') return opsOrFn(mockTx);
  return Promise.all(opsOrFn);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides = {}) {
  return {
    params: {},
    query:  {},
    body:   {},
    user:   { id: 'caller-id', firstName: 'Test', lastName: 'User', role: 'MEMBER' },
    ...overrides,
  };
}

const COMMUNITY = {
  id: 'comm-1', slug: 'test-comm', name: 'Test Community',
  privacy: 'PUBLIC', ownerId: 'owner-id', memberCount: 5, deletedAt: null,
};

// ─── Reset mocks before each test ────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  // Default: transaction calls through to array-based ops
  prisma.$transaction.mockImplementation(async (opsOrFn) => {
    if (typeof opsOrFn === 'function') return opsOrFn(mockTx);
    return Promise.all(opsOrFn.map(p => p));
  });
  prisma.communityMember.delete.mockResolvedValue({});
  prisma.community.update.mockResolvedValue({});
  prisma.communityBan.findUnique.mockResolvedValue(null);
  prisma.communityMember.count.mockResolvedValue(0);
  prisma.communityMember.findMany.mockResolvedValue([]);
  prisma.post.findMany.mockResolvedValue([]);
  prisma.userBlock.findMany.mockResolvedValue([]);
  mockTx.communityMember.delete.mockResolvedValue({});
  mockTx.community.update.mockResolvedValue({});
  mockTx.communityMember.create.mockResolvedValue({});
  mockTx.communityMember.findUnique.mockResolvedValue(null);
  mockTx.communityInvite.update.mockResolvedValue({});
  mockTx.communityJoinRequest.create.mockResolvedValue({ id: 'req-1' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMM-P2-001: kickMember role hierarchy
// ═══════════════════════════════════════════════════════════════════════════════
describe('COMM-P2-001 — kickMember role hierarchy', () => {
  function setupKick({ callerRole, targetRole }) {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY });
    // getMemberRole for caller
    prisma.communityMember.findUnique
      .mockResolvedValueOnce({ role: callerRole })  // getMemberRole(caller)
      .mockResolvedValueOnce({ role: targetRole, userId: 'target-id' }); // target lookup
  }

  // ── OWNER may kick anyone except themselves ──────────────────────────────
  test('OWNER → kick ADMIN: allowed', async () => {
    setupKick({ callerRole: 'OWNER', targetRole: 'ADMIN' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'admin-id' }, user: { id: 'owner-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('OWNER → kick MODERATOR: allowed', async () => {
    setupKick({ callerRole: 'OWNER', targetRole: 'MODERATOR' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'mod-id' }, user: { id: 'owner-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('OWNER → kick MEMBER: allowed', async () => {
    setupKick({ callerRole: 'OWNER', targetRole: 'MEMBER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'member-id' }, user: { id: 'owner-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('OWNER → kick OWNER: denied (cannot remove self-as-owner via hierarchy)', async () => {
    setupKick({ callerRole: 'OWNER', targetRole: 'OWNER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'other-owner' }, user: { id: 'owner-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  test('ADMIN → kick MODERATOR: allowed', async () => {
    setupKick({ callerRole: 'ADMIN', targetRole: 'MODERATOR' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'mod-id' }, user: { id: 'admin-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('ADMIN → kick MEMBER: allowed', async () => {
    setupKick({ callerRole: 'ADMIN', targetRole: 'MEMBER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'member-id' }, user: { id: 'admin-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('ADMIN → kick ADMIN: denied', async () => {
    setupKick({ callerRole: 'ADMIN', targetRole: 'ADMIN' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'other-admin' }, user: { id: 'admin-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('ADMIN → kick OWNER: denied', async () => {
    setupKick({ callerRole: 'ADMIN', targetRole: 'OWNER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'owner-id' }, user: { id: 'admin-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── MODERATOR ────────────────────────────────────────────────────────────
  test('MODERATOR → kick MEMBER: allowed', async () => {
    setupKick({ callerRole: 'MODERATOR', targetRole: 'MEMBER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'member-id' }, user: { id: 'mod-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('MODERATOR → kick MODERATOR: denied', async () => {
    setupKick({ callerRole: 'MODERATOR', targetRole: 'MODERATOR' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'other-mod' }, user: { id: 'mod-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('MODERATOR → kick ADMIN: denied', async () => {
    setupKick({ callerRole: 'MODERATOR', targetRole: 'ADMIN' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'admin-id' }, user: { id: 'mod-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('MODERATOR → kick OWNER: denied', async () => {
    setupKick({ callerRole: 'MODERATOR', targetRole: 'OWNER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'owner-id' }, user: { id: 'mod-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── MEMBER ───────────────────────────────────────────────────────────────
  test('MEMBER → kick anyone: denied at role gate', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY });
    prisma.communityMember.findUnique.mockResolvedValueOnce({ role: 'MEMBER' });
    const req = makeReq({ params: { idOrSlug: 'comm-1', userId: 'other-member' }, user: { id: 'member-id' } });
    const res = makeRes();
    await kickMember(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMM-P2-002: getMembers privacy boundary
// ═══════════════════════════════════════════════════════════════════════════════
describe('COMM-P2-002 — getMembers privacy boundary', () => {
  test('PUBLIC community: non-member may list members', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PUBLIC' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    prisma.communityMember.count.mockResolvedValue(3);
    prisma.communityMember.findMany.mockResolvedValue([
      { userId: 'u1', role: 'MEMBER', user: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null, role: 'MEMBER' } }
    ]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('PRIVATE community: non-member denied (403)', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PRIVATE' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('INVITE_ONLY community: non-member denied (403)', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'INVITE_ONLY' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('PRIVATE community: member allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PRIVATE' });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // is a member
    prisma.communityMember.count.mockResolvedValue(2);
    prisma.communityMember.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('INVITE_ONLY community: member allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'INVITE_ONLY' });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // is a member
    prisma.communityMember.count.mockResolvedValue(2);
    prisma.communityMember.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('PRIVATE community: ADMIN allowed (is a member)', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PRIVATE' });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.communityMember.count.mockResolvedValue(5);
    prisma.communityMember.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('Authorization is server-side: role param in query does not bypass check', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PRIVATE' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    const req = makeReq({ params: { idOrSlug: 'comm-1' }, query: { role: 'OWNER' } });
    const res = makeRes();
    await getMembers(req, res, jest.fn());
    // Must still be denied despite query param claiming OWNER role
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMM-P2-003: getCommunityFeed / getCommunityMedia INVITE_ONLY guard
// ═══════════════════════════════════════════════════════════════════════════════
describe('COMM-P2-003 — feed/media INVITE_ONLY privacy guard', () => {
  // getCommunityFeed
  test('getCommunityFeed — PRIVATE non-member: denied', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'PRIVATE', members: []
    });
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getCommunityFeed — INVITE_ONLY non-member: denied', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'INVITE_ONLY', members: []
    });
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getCommunityFeed — INVITE_ONLY member: allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'INVITE_ONLY',
      members: [{ role: 'MEMBER' }]
    });
    prisma.post.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('getCommunityFeed — PUBLIC non-member: allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'PUBLIC', members: []
    });
    prisma.post.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // getCommunityMedia
  test('getCommunityMedia — PRIVATE non-member: denied', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'PRIVATE', members: []
    });
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityMedia(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getCommunityMedia — INVITE_ONLY non-member: denied', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'INVITE_ONLY', members: []
    });
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityMedia(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getCommunityMedia — INVITE_ONLY member: allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'INVITE_ONLY',
      members: [{ role: 'MEMBER' }]
    });
    prisma.post.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityMedia(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('getCommunityMedia — PUBLIC non-member: allowed', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY, privacy: 'PUBLIC', members: []
    });
    prisma.post.findMany.mockResolvedValue([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityMedia(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMM-P3-001: joinCommunity — existing-member check before ban check
// ═══════════════════════════════════════════════════════════════════════════════
describe('COMM-P3-001 — joinCommunity existing-member before ban ordering', () => {
  test('Active member who also has a ban record: gets "Already a member" (not 403)', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PUBLIC' });
    // existing member record present
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    // ban record also present (edge case)
    prisma.communityBan.findUnique.mockResolvedValue({ id: 'ban-1' });

    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await joinCommunity(req, res, jest.fn());

    // Must return 200 "Already a member", NOT 403 banned
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'Already a member' })
    );
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('Banned non-member: gets 403', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PUBLIC' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    prisma.communityBan.findUnique.mockResolvedValue({ id: 'ban-1' }); // banned

    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await joinCommunity(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Non-member, not banned, PUBLIC: joins successfully', async () => {
    prisma.community.findFirst.mockResolvedValue({ ...COMMUNITY, privacy: 'PUBLIC', ownerId: 'other-owner' });
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    prisma.communityBan.findUnique.mockResolvedValue(null);    // not banned
    // The PUBLIC join path calls prisma.$transaction([create, update]).
    // Those two Prisma calls are invoked when building the array argument.
    // We need communityMember.create and community.update to return resolved promises,
    // and $transaction to simply resolve with whatever it receives.
    prisma.communityMember.create = jest.fn().mockResolvedValue({ id: 'mock-uuid', role: 'MEMBER' });
    prisma.community.update.mockResolvedValue({ id: 'comm-1', memberCount: 6 });
    prisma.$transaction.mockImplementation(async (ops) => {
      if (typeof ops === 'function') return ops(mockTx);
      return Promise.all(ops);
    });

    const req = makeReq({ params: { idOrSlug: 'comm-1' }, user: { id: 'new-user', firstName: 'N', lastName: 'U', role: 'MEMBER' } });
    const res = makeRes();
    await joinCommunity(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'Joined community' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIND-008: getCommunityFeed bilateral block enforcement
// ═══════════════════════════════════════════════════════════════════════════════
describe('FIND-008 — getCommunityFeed block enforcement', () => {
  // Shared setup: PUBLIC community with viewer as member
  function setupFeed(blocks) {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY,
      privacy: 'PUBLIC',
      members: [{ role: 'MEMBER' }],
    });
    prisma.userBlock.findMany.mockResolvedValue(blocks || []);
    prisma.post.findMany.mockResolvedValue([]);
  }

  test('viewer blocks an author → where.NOT excludes that author', async () => {
    setupFeed([{ blockerId: 'caller-id', blockedId: 'author-blocked' }]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const findManyArgs = prisma.post.findMany.mock.calls[0][0];
    expect(findManyArgs.where.NOT).toEqual({ authorId: { in: ['author-blocked'] } });
  });

  test('author blocks viewer → where.NOT excludes that author', async () => {
    setupFeed([{ blockerId: 'author-who-blocked', blockedId: 'caller-id' }]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const findManyArgs = prisma.post.findMany.mock.calls[0][0];
    expect(findManyArgs.where.NOT).toEqual({ authorId: { in: ['author-who-blocked'] } });
  });

  test('no blocks → where.NOT is absent (no empty predicate injected)', async () => {
    setupFeed([]);
    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const findManyArgs = prisma.post.findMany.mock.calls[0][0];
    expect(findManyArgs.where.NOT).toBeUndefined();
  });

  test('block DB query fails → degrades safely, feed still returns 200', async () => {
    prisma.community.findFirst.mockResolvedValue({
      ...COMMUNITY,
      privacy: 'PUBLIC',
      members: [{ role: 'MEMBER' }],
    });
    prisma.userBlock.findMany.mockRejectedValue(new Error('DB down'));
    prisma.post.findMany.mockResolvedValue([]);

    const req = makeReq({ params: { idOrSlug: 'comm-1' } });
    const res = makeRes();
    await getCommunityFeed(req, res, jest.fn());

    // .catch(() => []) must swallow the error and continue with no block filter
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const findManyArgs = prisma.post.findMany.mock.calls[0][0];
    expect(findManyArgs.where.NOT).toBeUndefined();
  });
});

const uuidMock = '00000000-0000-0000-0000-000000000001';
jest.mock('uuid', () => ({ v4: jest.fn(() => uuidMock) }));
