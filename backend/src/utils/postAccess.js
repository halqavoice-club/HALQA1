'use strict';
/**
 * Post Access Authorization Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the centralized 8-dimension post authorization policy for the
 * Feed P0 security remediation (CF-01, CF-02, CF-18).
 *
 * This module is intentionally independent of post.controller.js and getPost()
 * to avoid reproducing the gaps identified in CF-17 and CF-20.
 *
 * CF-17 gap: getPost() does not enforce isDraft:false.
 * CF-20 gap: getPost() does not enforce private-community membership.
 * Both are enforced here from scratch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Checks whether viewerId is authorized to access postId.
 *
 * Returns { post, error: null } on success.
 * Returns { post: null, error: { status: 403|404, message } } on denial.
 * Never throws — callers must handle the error object.
 *
 * Authorization dimensions (checked in order):
 *  1. Post exists and deletedAt is null                (404 if not found/deleted)
 *  2. isDraft is false OR viewerId === authorId        (404 if draft and not author)
 *  3. Bilateral block in either direction              (404 if blocked)
 *  4. Visibility tier: PUBLIC/FOLLOWERS/PRIVATE/SCHOOL_ONLY
 *  5. Exclusive content: active CreatorSubscription required
 *  6. Community: if communityId != null, enforce membership for PRIVATE/INVITE_ONLY
 *  7. Community ban: bannedAt != null means 403
 *  8. Community deletion: apply soft-delete policy (404)
 *
 * @param {string}       postId
 * @param {string}       viewerId
 * @param {PrismaClient} prismaClient
 * @returns {Promise<{ post: object|null, error: { status: number, message: string }|null }>}
 */
async function assertPostAccessible(postId, viewerId, prismaClient) {
  // ── Dimension 1: Post existence + deletion ──────────────────────────────
  const post = await prismaClient.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: {
      id: true,
      authorId: true,
      visibility: true,
      isDraft: true,
      isExclusive: true,
      communityId: true,
      schoolId: true,
      type: true,
    },
  });

  if (!post) {
    return { post: null, error: { status: 404, message: 'Post not found' } };
  }

  // Author bypass: the author always has access to their own post
  // (skips dimensions 2–8 except deletion which is never skipped).
  if (post.authorId === viewerId) {
    return { post, error: null };
  }

  // ── Dimension 2: Draft state ─────────────────────────────────────────────
  if (post.isDraft) {
    return { post: null, error: { status: 404, message: 'Post not found' } };
  }

  // ── Dimensions 3–5: Parallel queries ────────────────────────────────────
  // Block check and viewer context fetched in parallel to minimize latency.
  const [block, viewerUser, followRecord, schoolMembership] = await Promise.all([
    // Dimension 3: Bilateral block
    prismaClient.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: post.authorId },
          { blockerId: post.authorId, blockedId: viewerId },
        ],
      },
      select: { id: true },
    }),
    // Viewer's schoolId for dimension 4 (SCHOOL_ONLY)
    prismaClient.user.findUnique({
      where: { id: viewerId },
      select: { schoolId: true },
    }),
    // Dimension 4: FOLLOWERS check (only needed when visibility is FOLLOWERS)
    post.visibility === 'FOLLOWERS'
      ? prismaClient.follow.findFirst({
          where: { followerId: viewerId, followingId: post.authorId },
          select: { id: true },
        })
      : Promise.resolve(null),
    // SchoolMembership fallback for dimension 4 (SCHOOL_ONLY)
    post.visibility === 'SCHOOL_ONLY'
      ? prismaClient.schoolMembership.findFirst({
          where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
          select: { schoolId: true },
        })
      : Promise.resolve(null),
  ]);

  // ── Dimension 3: Block check ─────────────────────────────────────────────
  if (block) {
    return { post: null, error: { status: 404, message: 'Post not found' } };
  }

  // ── Dimension 4: Visibility tier ─────────────────────────────────────────
  if (post.visibility === 'PRIVATE') {
    // Only the author may view PRIVATE posts (author already returned above)
    return { post: null, error: { status: 404, message: 'Post not found' } };
  }

  if (post.visibility === 'FOLLOWERS') {
    if (!followRecord) {
      return { post: null, error: { status: 404, message: 'Post not found' } };
    }
  }

  if (post.visibility === 'SCHOOL_ONLY') {
    // Resolve effective schoolId: User.schoolId (legacy) with SchoolMembership fallback.
    // SUPER_ADMIN role does NOT bypass school-scoped authorization.
    const effectiveSchoolId = viewerUser?.schoolId ?? schoolMembership?.schoolId ?? null;
    if (!effectiveSchoolId || effectiveSchoolId !== post.schoolId) {
      return { post: null, error: { status: 404, message: 'Post not found' } };
    }
  }

  // ── Dimension 5: Exclusive content ───────────────────────────────────────
  if (post.isExclusive) {
    let hasSubscription = false;
    try {
      const creatorProfile = await prismaClient.creatorProfile.findUnique({
        where: { userId: post.authorId },
        select: { id: true },
      });
      if (creatorProfile) {
        const sub = await prismaClient.creatorSubscription.findFirst({
          where: {
            subscriberId: viewerId,
            creatorId: creatorProfile.id,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        hasSubscription = !!sub;
      }
    } catch {
      // Non-fatal — if subscription check fails, treat as no subscription
    }
    if (!hasSubscription) {
      return { post: null, error: { status: 404, message: 'Post not found' } };
    }
  }

  // ── Dimensions 6–8: Community checks (only when communityId is set) ──────
  if (post.communityId) {
    const community = await prismaClient.community.findUnique({
      where: { id: post.communityId },
      select: { privacy: true, deletedAt: true },
    });

    // Dimension 8: Community deletion
    if (!community || community.deletedAt !== null) {
      return { post: null, error: { status: 404, message: 'Post not found' } };
    }

    if (community.privacy === 'PRIVATE' || community.privacy === 'INVITE_ONLY') {
      // Dimension 7: Community ban (checked before membership — a ban overrides membership)
      const ban = await prismaClient.communityBan.findFirst({
        where: { communityId: post.communityId, userId: viewerId },
        select: { id: true },
      });
      if (ban) {
        return { post: null, error: { status: 403, message: 'You cannot access this content' } };
      }

      // Dimension 6: Community membership
      const membership = await prismaClient.communityMember.findUnique({
        where: { communityId_userId: { communityId: post.communityId, userId: viewerId } },
        select: { id: true },
      });
      if (!membership) {
        return { post: null, error: { status: 404, message: 'Post not found' } };
      }
    }
  }

  return { post, error: null };
}

/**
 * Checks whether a pre-fetched originalPost object is accessible to the viewer,
 * using pre-fetched context lists (no extra DB queries).
 *
 * Returns the originalPost if accessible, or null if not.
 *
 * @param {object|null} originalPost  — the nested originalPost object from POST_INCLUDE
 * @param {string}      viewerId
 * @param {object}      context
 * @param {string[]}    context.memberCommunityIds   — community IDs the viewer is a member of
 * @param {string[]}    context.followingIds          — user IDs the viewer follows
 * @param {string|null} context.effectiveSchoolId     — viewer's resolved school ID
 * @param {string[]}    context.subscribedCreatorIds  — author user IDs the viewer subscribes to
 * @param {Set<string>} context.blockedUserIds         — all user IDs in a bilateral block with viewer
 * @returns {object|null}
 */
function filterOriginalPost(originalPost, viewerId, context) {
  if (!originalPost) return null;

  const {
    memberCommunityIds = [],
    followingIds = [],
    effectiveSchoolId = null,
    subscribedCreatorIds = [],
    blockedUserIds = new Set(),
  } = context;

  // 1. Deletion
  if (originalPost.deletedAt !== null && originalPost.deletedAt !== undefined) {
    return null;
  }

  // 2. Draft state (non-author cannot see drafts)
  if (originalPost.isDraft && originalPost.authorId !== viewerId) {
    return null;
  }

  // 3. Bilateral block
  if (blockedUserIds.has(originalPost.authorId)) {
    return null;
  }

  // 4. Visibility tier
  const vis = originalPost.visibility;

  if (vis === 'PRIVATE' && originalPost.authorId !== viewerId) {
    return null;
  }

  if (vis === 'FOLLOWERS' && originalPost.authorId !== viewerId) {
    if (!followingIds.includes(originalPost.authorId)) {
      return null;
    }
  }

  if (vis === 'SCHOOL_ONLY' && originalPost.authorId !== viewerId) {
    if (!effectiveSchoolId || effectiveSchoolId !== originalPost.schoolId) {
      return null;
    }
  }

  // 5. Exclusive content
  if (originalPost.isExclusive && originalPost.authorId !== viewerId) {
    if (!subscribedCreatorIds.includes(originalPost.authorId)) {
      return null;
    }
  }

  // 6. Community check using pre-fetched membership list
  if (originalPost.communityId) {
    // communityPrivacy is not included in POST_INCLUDE's nested originalPost.
    // The original post includes community: { id, slug, name, avatarUrl } only.
    // We cannot determine privacy from included data, so we fall back to:
    // if the viewer is not a member of the community, deny access.
    // This is intentionally conservative: for PUBLIC communities the memberCommunityIds
    // list includes public community IDs (computed with publicCommunityIds merged in
    // the caller's visibilityFilter context).
    if (!memberCommunityIds.includes(originalPost.communityId)) {
      return null;
    }
  }

  return originalPost;
}

module.exports = { assertPostAccessible, filterOriginalPost };
