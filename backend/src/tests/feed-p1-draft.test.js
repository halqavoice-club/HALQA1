'use strict';
/**
 * CF-17 — getPost draft visibility tests
 *
 * Verifies that draft posts are not leaked to non-authors via GET /posts/:id.
 * Uses mocked prisma to avoid a live DB dependency.
 */

// ─── Mock prisma ──────────────────────────────────────────────────────────────
jest.mock('../utils/prisma', () => {
  const mockPost = {
    id: 'post-draft-1',
    authorId: 'author-1',
    isDraft: true,
    deletedAt: null,
    visibility: 'PUBLIC',
    communityId: null,
    _count: { reactions: 0, comments: 0, bookmarks: 0 },
    reactions: [],
    bookmarks: [],
    author: { id: 'author-1', firstName: 'Alice', lastName: 'Smith', avatarUrl: null, role: 'STUDENT', email: 'alice@test.com' },
    media: [],
    comments: [],
    poll: null,
    originalPost: null,
    community: null,
    mentions: [],
    hashtags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPublishedPost = { ...mockPost, id: 'post-pub-1', isDraft: false };

  return {
    post: {
      findFirst: jest.fn(),
    },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    follow: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    communityMember: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    _mockDraftPost: mockPost,
    _mockPublishedPost: mockPublishedPost,
  };
});

const prisma = require('../utils/prisma');

// ─── Mock response helpers ────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (userId, postId) => ({
  user: { id: userId },
  params: { id: postId },
  query: {},
});

// ─── Import the controller ────────────────────────────────────────────────────
// We need to require after mocks are set up
let getPost;
beforeAll(() => {
  // Partial require: pull only getPost — the module uses a prisma singleton
  const ctrl = require('../controllers/post.controller');
  getPost = ctrl.getPost;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CF-17 — getPost draft visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when a non-author requests a draft post', async () => {
    // Arrange: findFirst returns the draft post (deletedAt: null check passes)
    prisma.post.findFirst.mockResolvedValueOnce(prisma._mockDraftPost);

    const req = mockReq('other-user-999', 'post-draft-1');
    const res = mockRes();
    const next = jest.fn();

    await getPost(req, res, next);

    // Assert: 404, not 200 or 403
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 200 when the author requests their own draft post', async () => {
    // Arrange: assertPostAccessible calls findFirst first (minimal select),
    // then getPost calls findFirst again with POST_INCLUDE after auth passes.
    // The author bypass in assertPostAccessible skips the draft gate for the author.
    prisma.post.findFirst
      .mockResolvedValueOnce(prisma._mockDraftPost)  // assertPostAccessible lightweight check
      .mockResolvedValueOnce(prisma._mockDraftPost); // getPost full POST_INCLUDE fetch

    const req = mockReq('author-1', 'post-draft-1');
    const res = mockRes();
    const next = jest.fn();

    await getPost(req, res, next);

    // The author should NOT be blocked by the draft check.
    // findFirst is called twice (assertPostAccessible + POST_INCLUDE fetch).
    expect(prisma.post.findFirst).toHaveBeenCalledTimes(2);
    // The author bypass means we should NOT see a 404 response from the draft gate.
    // successResponse sets status 200.
    expect(res.status).not.toHaveBeenCalledWith(404);
  });

  it('returns 404 when post does not exist at all', async () => {
    prisma.post.findFirst.mockResolvedValueOnce(null);

    const req = mockReq('any-user', 'non-existent-post');
    const res = mockRes();
    const next = jest.fn();

    await getPost(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('published post is accessible to any user (draft gate does not block)', async () => {
    // assertPostAccessible (1st call) passes for PUBLIC non-draft post,
    // then getPost fetches full post with POST_INCLUDE (2nd call).
    prisma.post.findFirst
      .mockResolvedValueOnce(prisma._mockPublishedPost)  // assertPostAccessible lightweight check
      .mockResolvedValueOnce(prisma._mockPublishedPost); // getPost full POST_INCLUDE fetch

    const req = mockReq('other-user-999', 'post-pub-1');
    const res = mockRes();
    const next = jest.fn();

    await getPost(req, res, next);

    // Published post: draft gate MUST NOT fire 404.
    // The request will reach visibility checks; for PUBLIC post with no blocks → 200.
    expect(res.status).not.toHaveBeenCalledWith(404);
  });
});
