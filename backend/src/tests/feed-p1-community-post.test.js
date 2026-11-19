'use strict';
/**
 * CF-19 — createPost community membership validation tests
 *
 * Verifies that posting to a community requires active membership
 * and that banned members, non-existent communities, and soft-deleted
 * communities are all rejected.
 */

// ─── Mock prisma ──────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => ({
  post: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  postMedia: { createMany: jest.fn().mockResolvedValue({}) },
  community: { findUnique: jest.fn() },
  communityMember: { findUnique: jest.fn() },
  communityBan: { findFirst: jest.fn() },
  schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
  voiceRoom: { findUnique: jest.fn().mockResolvedValue(null) },
  userBlock: { findMany: jest.fn().mockResolvedValue([]) },
  hashtag: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  postHashtag: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
  mention: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
  postMention: { upsert: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
}));

// Mock sockets so the io broadcast doesn't blow up
jest.mock('../sockets', () => ({ getIo: () => null }));

// Mock redis so cache invalidation is a no-op
jest.mock('../utils/redis', () => ({
  isRedisReady: () => false,
  deleteCache: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require('../utils/prisma');

// ─── req/res helpers ──────────────────────────────────────────────────────────
const makeRes = () => {
  const captured = {};
  const res = {};
  res.status = jest.fn(code => { captured.status = code; return res; });
  res.json   = jest.fn(body => { captured.body = body; return res; });
  res._get   = () => captured;
  return res;
};

const makeReq = (userId, bodyOverrides = {}) => ({
  user:   { id: userId, role: 'STUDENT', schoolId: null },
  body:   { body: 'Hello community', type: 'TEXT', visibility: 'PUBLIC', media: [], ...bodyOverrides },
  params: {},
  query:  {},
});

// ─── Shared community stubs ───────────────────────────────────────────────────
const ACTIVE_COMMUNITY = { id: 'comm-1', privacy: 'PUBLIC', deletedAt: null };
const DELETED_COMMUNITY = { id: 'comm-deleted', privacy: 'PUBLIC', deletedAt: new Date() };
const ACTIVE_MEMBERSHIP = { id: 'mem-1' };
const ACTIVE_BAN = { id: 'ban-1' };

const CREATED_POST = {
  id: 'new-post-1', authorId: 'user-member', communityId: 'comm-1',
  body: 'Hello community', type: 'TEXT', visibility: 'PUBLIC', isDraft: false,
  deletedAt: null, _count: { reactions: 0, comments: 0, bookmarks: 0 },
  reactions: [], bookmarks: [], author: {}, media: [], community: null,
  mentions: [], hashtags: [], poll: null, originalPost: null,
  createdAt: new Date(), updatedAt: new Date(), shareCount: 0,
};

let createPost;
beforeAll(() => {
  const ctrl = require('../controllers/post.controller');
  createPost = ctrl.createPost;
});

// Reset all mock implementations AND call records before each test
beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply permanent safe defaults for things used in every path
  prisma.postMedia.createMany.mockResolvedValue({});
  prisma.post.update.mockResolvedValue({});
  prisma.schoolMembership.findFirst.mockResolvedValue(null);
  prisma.voiceRoom.findUnique.mockResolvedValue(null);
  prisma.userBlock.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.postHashtag.deleteMany.mockResolvedValue({});
  prisma.postHashtag.createMany.mockResolvedValue({});
  prisma.hashtag.findMany.mockResolvedValue([]);
  prisma.postMention.upsert.mockResolvedValue({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CF-19 — createPost community membership validation', () => {

  it('rejects non-member with 403', async () => {
    prisma.community.findUnique.mockResolvedValue(ACTIVE_COMMUNITY);
    prisma.communityMember.findUnique.mockResolvedValue(null); // not a member
    prisma.communityBan.findFirst.mockResolvedValue(null);

    const req = makeReq('user-outsider', { communityId: 'comm-1' });
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('rejects banned member with 403', async () => {
    prisma.community.findUnique.mockResolvedValue(ACTIVE_COMMUNITY);
    prisma.communityMember.findUnique.mockResolvedValue(ACTIVE_MEMBERSHIP); // is a member
    prisma.communityBan.findFirst.mockResolvedValue(ACTIVE_BAN);            // but is banned

    const req = makeReq('user-banned', { communityId: 'comm-1' });
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('allows active member to post — returns 201', async () => {
    prisma.community.findUnique.mockResolvedValue(ACTIVE_COMMUNITY);
    prisma.communityMember.findUnique.mockResolvedValue(ACTIVE_MEMBERSHIP);
    prisma.communityBan.findFirst.mockResolvedValue(null);
    prisma.post.create.mockResolvedValue(CREATED_POST);
    // post.findUnique is called after create to build the full response
    prisma.post.findUnique.mockResolvedValue(CREATED_POST);

    const req = makeReq('user-member', { communityId: 'comm-1' });
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(prisma.post.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects soft-deleted community with 404', async () => {
    prisma.community.findUnique.mockResolvedValue(DELETED_COMMUNITY);

    const req = makeReq('user-member', { communityId: 'comm-deleted' });
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('rejects non-existent community with 404', async () => {
    prisma.community.findUnique.mockResolvedValue(null);

    const req = makeReq('user-member', { communityId: 'comm-does-not-exist' });
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('no communityId — behaves as before (no community checks run)', async () => {
    // No communityId in body → community checks must NOT be called
    prisma.post.create.mockResolvedValue({
      id: 'new-post-2', authorId: 'user-1', communityId: null,
      body: 'Plain post', type: 'TEXT', visibility: 'PUBLIC', isDraft: false,
      deletedAt: null, createdAt: new Date(), updatedAt: new Date(), shareCount: 0,
    });
    prisma.post.findUnique.mockResolvedValue({
      id: 'new-post-2', authorId: 'user-1', communityId: null,
      body: 'Plain post', type: 'TEXT', visibility: 'PUBLIC', isDraft: false,
      deletedAt: null, _count: { reactions: 0, comments: 0, bookmarks: 0 },
      reactions: [], bookmarks: [], author: {}, media: [], community: null,
      mentions: [], hashtags: [], poll: null, originalPost: null,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const req = makeReq('user-1');  // no communityId in body
    const res = makeRes();

    await createPost(req, res, jest.fn());

    expect(prisma.community.findUnique).not.toHaveBeenCalled();
    expect(prisma.communityMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.communityBan.findFirst).not.toHaveBeenCalled();
    expect(prisma.post.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
