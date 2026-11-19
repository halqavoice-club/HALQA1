// @ts-nocheck
'use strict';
/**
 * Post Controller — Social Feed (Phase B-1)
 * Reuses: prisma, response helpers, notification service, getIo, auth middleware
 * Never modifies existing controllers or routes.
 */
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { getIo } = require('../sockets');
const { successResponse, errorResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { notify } = require('../services/notification.service');
const logger = require('../utils/logger');
// CF-01, CF-02, CF-18: Centralized post authorization helpers (Feed P0 remediation)
const { assertPostAccessible, filterOriginalPost } = require('../utils/postAccess');

// ─── Shared selects ───────────────────────────────────────────────────────────
const AUTHOR_SELECT = {
  id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true
};

const POST_INCLUDE = (/** @param {string|number|null} viewerId */ viewerId) => ({
  author: { select: AUTHOR_SELECT },
  media: { orderBy: { orderIndex: 'asc' } },
  hashtags: { include: { hashtag: { select: { id: true, name: true } } } },
  community: { select: { id: true, slug: true, name: true, avatarUrl: true } },
  _count: { select: { reactions: true, comments: true } },
  reactions: viewerId ? { where: { userId: viewerId }, select: { type: true } } : false,
  bookmarks: viewerId ? { where: { userId: viewerId }, select: { id: true } } : false,
  originalPost: {
    select: {
      // ── Authorization scalars (required by filterOriginalPost) ───────────
      id:          true,
      authorId:    true,
      visibility:  true,
      isDraft:     true,
      deletedAt:   true,
      isExclusive: true,
      communityId: true,
      schoolId:    true,
      // ── Display scalars (required by web/mobile clients) ─────────────────
      type:            true,
      body:            true,
      quotedBody:      true,
      linkUrl:         true,
      linkTitle:       true,
      linkDescription: true,
      linkImage:       true,
      pollData:        true,
      createdAt:       true,
      // ── Relations ─────────────────────────────────────────────────────────
      author: { select: AUTHOR_SELECT },
      media:  { orderBy: { orderIndex: 'asc' } },
    }
  }
});

// ─── Helper: stamp isFollowing on each post ───────────────────────────────────
// One extra query per feed page — fetches the viewer's full following set once,
// then stamps each post with `isFollowing: true/false` so the client can show
// an inline Follow / Unfollow button without a separate API call.
async function stampFollowing(posts, viewerId) {
  if (!posts.length || !viewerId) return posts;

  const authorIds = [...new Set(posts.map(p => p.authorId))];
  const follows   = await prisma.follow.findMany({
    where:  { followerId: viewerId, followingId: { in: authorIds } },
    select: { followingId: true },
  });
  const followingSet = new Set(follows.map(f => f.followingId));

  return posts.map(p => ({ ...p, isFollowing: followingSet.has(p.authorId) }));
}

// ─── Helper: extract & upsert hashtags ───────────────────────────────────────
async function syncHashtags(postId, body) {
  if (!body) return;
  const tags = [...new Set((body.match(/#[\w\u0600-\u06FF]+/g) || []).map(t => t.slice(1).toLowerCase()))];
  if (!tags.length) return;

  await Promise.all(tags.map(async (name) => {
    const hashtag = await prisma.hashtag.upsert({
      where: { name },
      create: { id: uuidv4(), name, postCount: 1 },
      update: { postCount: { increment: 1 } }
    });
    await prisma.postHashtag.upsert({
      where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
      create: { postId, hashtagId: hashtag.id },
      update: {}
    });
  }));
}

// ─── Helper: extract & save mentions ─────────────────────────────────────────
// BUG FIX: Previously matched @handles against User.firstName and User.lastName.
// This caused notification spam — all users sharing a first/last name were notified.
// Now matches against User.username (unique field) for precise single-user targeting.
//
// Backward compat: if a user has no username set (null), they cannot be @mentioned
// until they set one. This is the correct behavior for a unique handle system.
async function syncMentions(postId, commentId, body, authorId) {
  if (!body) return;

  // Extract @handles: @word chars (letters, digits, underscore)
  const handles = [...new Set((body.match(/@[\w]+/g) || []).map(h => h.slice(1).toLowerCase()))];
  if (!handles.length) return;

  // Match against username field only — unique, so at most 1 user per handle
  const users = await prisma.user.findMany({
    where: {
      username: { in: handles },
      id:       { not: authorId },  // don't notify the author about their own mention
      status:   'ACTIVE',
      deletedAt: null
    },
    select: { id: true, firstName: true, username: true }
  });

  if (!users.length) return;

  // Create mention records + send notifications in parallel
  await Promise.allSettled(users.map(async (u) => {
    // Upsert to avoid duplicate mention records if body is re-saved
    await prisma.postMention.upsert({
      where:  { id: `${postId || commentId}_${u.id}` },
      create: {
        id:        uuidv4(),
        postId:    postId    || null,
        commentId: commentId || null,
        userId:    u.id
      },
      update: {}
    }).catch(() => {
      // Fallback: if upsert fails (e.g. id collision), try plain create
      return prisma.postMention.create({
        data: { id: uuidv4(), postId: postId || null, commentId: commentId || null, userId: u.id }
      }).catch(() => {}); // idempotent — ignore duplicate
    });

    await notify(u.id, {
      type:  'MENTION',
      title: 'You were mentioned',
      body:  `Someone mentioned @${u.username} in a post`,
      data:  { postId, commentId }
    });
  }));
}

// ─── Helper: build visibility filter for feed queries ────────────────────────
// Returns a Prisma `where` clause that filters posts to only those the viewer
// is allowed to see, based on:
//   1. Post visibility setting (PUBLIC / FOLLOWERS / PRIVATE / SCHOOL_ONLY)
//   2. Whether the viewer follows the author (for FOLLOWERS posts)
//   3. School membership (for SCHOOL_ONLY posts)
//   4. Creator subscription (for isExclusive posts)
//   5. Block status — posts from blocked users (in either direction) are hidden
//
// SECURITY FIX: Added isExclusive enforcement.
// Previously, posts marked isExclusive:true were returned to ALL followers
// regardless of subscription status. Now they are only returned to:
//   - The post author themselves
//   - Viewers who have an active CreatorSubscription matching the post's tierRequired
//
// BLOCK FIX: Added bilateral block enforcement.
// Previously, UserBlock records were never consulted here. A user could still
// see posts from someone they blocked (or who blocked them). Now both directions
// are resolved and excluded via NOT authorId in [...].
//
// CF-20 FIX: Added private/invite-only community access gate.
// A PUBLIC-visibility post belonging to a PRIVATE or INVITE_ONLY community was
// previously returned to any viewer (it matched the PUBLIC OR branch). Now, posts
// with communityId must also satisfy community access: either the community is
// PUBLIC, or the viewer is a member and not banned.
async function visibilityFilter(viewerId) {
  // Run all prerequisite queries in parallel — cuts latency from ~N× to ~1×
  // CF-20: Added communityMember, community (public IDs), and communityBan queries.
  const [viewer, following, activeSubs, schoolMembership, blocks, memberCommunities, publicCommunities, communityBans] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }),
    prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
    prisma.creatorSubscription.findMany({
      where: { subscriberId: viewerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { creatorId: true }
    }).catch(() => []),  // non-fatal — table may not exist in older DB
    // FS-GAP-002 FIX: Also check SchoolMembership for new-architecture users
    // whose User.schoolId may be null (MEMBER role with school membership).
    // Prefer User.schoolId for legacy users; fall back to SchoolMembership.schoolId.
    prisma.schoolMembership.findFirst({
      where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
      select: { schoolId: true },
      orderBy: { joinedAt: 'asc' }
    }).catch(() => null),
    // BLOCK FIX: Fetch all block relationships involving this viewer (both directions).
    // blockerId = viewerId → viewer blocked that user
    // blockedId = viewerId → that user blocked the viewer
    // P1-04 FIX: No .catch() — a block-query failure must propagate as 500 (fail-closed).
    // Silently degrading to an empty block list (fail-open) would expose blocked-user posts.
    prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true }
    }),
    // CF-20: Viewer's community memberships (exclude deleted communities)
    // .catch(() => []) is intentional: membership failure is fail-restrictive —
    // the viewer simply cannot see private-community posts (no security downgrade).
    prisma.communityMember.findMany({
      where: { userId: viewerId, community: { deletedAt: null } },
      select: { communityId: true }
    }).catch(() => []),
    // CF-20: All non-deleted PUBLIC communities (so their posts pass the community gate)
    prisma.community.findMany({
      where: { privacy: 'PUBLIC', deletedAt: null },
      select: { id: true }
    }).catch(() => []),
    // CF-20: Communities the viewer is banned from (banned members must not see posts)
    // P1-04 FIX: No .catch() — a communityBan-query failure must propagate as 500 (fail-closed).
    // Silently degrading to an empty ban list would let banned users see community posts.
    prisma.communityBan.findMany({
      where: { userId: viewerId },
      select: { communityId: true }
    })
  ]);
  const followingIds = following.map(f => f.followingId);

  // FS-GAP-002 FIX: Resolve effective schoolId for feed visibility.
  // Legacy users: User.schoolId (non-null). New MEMBER users: SchoolMembership.schoolId.
  const effectiveSchoolId = viewer?.schoolId ?? schoolMembership?.schoolId ?? null;

  // BLOCK FIX: Build the set of user IDs whose posts must be excluded.
  // Union of: users the viewer blocked + users who blocked the viewer.
  // The viewer's own ID is never in this set (UserBlock@@unique prevents self-blocks).
  const blockedAuthorIds = [
    ...new Set(
      blocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId)
    )
  ];

  // Resolve creatorProfile → userId mapping (only if we have active subs)
  let subscribedCreatorIds = [];
  if (activeSubs.length > 0) {
    try {
      const creatorProfiles = await prisma.creatorProfile.findMany({
        where: { id: { in: activeSubs.map(s => s.creatorId) } },
        select: { userId: true }
      });
      subscribedCreatorIds = creatorProfiles.map(p => p.userId);
    } catch {
      // Non-fatal — if subscription check fails, exclusive posts are simply hidden
    }
  }

  // CF-20: Build the allowed community ID set.
  // A community post is visible to the viewer if:
  //   - The community is PUBLIC AND the viewer is not banned from it, OR
  //   - The viewer is a member AND not banned.
  // P1-01 FIX: Ban enforcement now applies to PUBLIC communities too. Previously
  // all public community IDs were included unconditionally before ban filtering,
  // so a viewer banned from a PUBLIC community could still see its posts.
  // Personal posts (communityId: null) are always allowed through the community gate.
  const bannedCommunityIds = new Set((communityBans || []).map(b => b.communityId));
  const accessibleMemberCommunityIds = (memberCommunities || [])
    .map(m => m.communityId)
    .filter(id => !bannedCommunityIds.has(id));
  const allowedCommunityIds = [
    ...new Set([
      ...(publicCommunities || []).map(c => c.id).filter(id => !bannedCommunityIds.has(id)),
      ...accessibleMemberCommunityIds,
    ])
  ];

  const filter = {
    deletedAt: null,
    isDraft:   false,
    OR: [
      // Non-exclusive public posts visible to everyone
      { visibility: 'PUBLIC',      isExclusive: false },
      // Non-exclusive follower-only posts visible to followers
      { visibility: 'FOLLOWERS',   isExclusive: false, authorId: { in: followingIds } },
      // Own posts always visible (author sees all their own posts)
      { authorId: viewerId },
      // School-only posts visible to school members
      // FS-GAP-002 FIX: Uses effectiveSchoolId which resolves from User.schoolId
      // (legacy) OR SchoolMembership.schoolId (new MEMBER users). Both paths covered.
      ...(effectiveSchoolId
        ? [{ visibility: 'SCHOOL_ONLY', isExclusive: false, schoolId: effectiveSchoolId }]
        : []),
      // Exclusive posts: only visible to active subscribers via PUBLIC posts.
      // P0-02 FIX: Restrict exclusive content to PUBLIC visibility only.
      // Previously this branch had no visibility constraint, allowing exclusive
      // PRIVATE/FOLLOWERS posts to appear in subscribed feeds (bypass). Subscribers
      // may only receive exclusive PUBLIC posts via the feed; direct-access to
      // exclusive PRIVATE posts is not supported through the feed endpoint.
      ...(subscribedCreatorIds.length > 0
        ? [{ isExclusive: true, visibility: 'PUBLIC', authorId: { in: subscribedCreatorIds } }]
        : [])
    ]
  };

  // BLOCK FIX: Exclude posts from blocked authors (both directions).
  // Only inject NOT clause when there are actually blocked users — avoids
  // adding an unnecessary empty-set exclusion that could affect query plans.
  if (blockedAuthorIds.length > 0) {
    filter.NOT = { authorId: { in: blockedAuthorIds } };
  }

  // CF-20: Community access gate (AND-wrapper).
  // A post must satisfy BOTH the visibility OR branches above AND the community gate.
  // Posts with communityId: null (personal posts) always pass the gate.
  // Posts with a communityId must belong to an allowed community.
  // The viewer's own posts (authorId: viewerId branch) bypass this gate so authors
  // always see their own community posts even if banned/non-member.
  filter.AND = [
    {
      OR: [
        { communityId: null },
        { communityId: { in: allowedCommunityIds } },
        // Author always sees their own posts regardless of community membership
        { authorId: viewerId },
      ]
    }
  ];

  // Also expose these context lists so callers can reuse them for CF-18 (filterOriginalPost)
  // without additional queries.
  filter._ctx = {
    followingIds,
    effectiveSchoolId,
    subscribedCreatorIds,
    allowedCommunityIds,
    blockedAuthorIds,
  };

  return filter;
}

// ─── CREATE POST ─────────────────────────────────────────────────────────────
async function createPost(req, res, next) {
  try {
    const { body, type = 'TEXT', visibility = 'PUBLIC', media = [], isDraft = false,
      scheduledAt, pollData, linkUrl, linkTitle, linkDescription, linkImage,
      originalPostId, quotedBody, refEntityType, refEntityId, communityId,
      isExclusive, tierRequired, location } = req.body;

    if (!body?.trim() && !media.length && type !== 'REPOST' && type !== 'POLL'
        && type !== 'LIVE_ROOM_SHARE' && type !== 'LIVE_CLASS_SHARE') {
      return errorResponse(res, 'Post body or media required', 400);
    }

    // BUG-006 FIX: Validate the referenced VoiceRoom before creating a LIVE_ROOM_SHARE post.
    // Prevents creating posts for deleted, ended, or non-existent rooms.
    // Only applies to LIVE_ROOM_SHARE — does not affect TEXT or any other post type.
    if (type === 'LIVE_ROOM_SHARE') {
      if (!refEntityId) {
        return errorResponse(res, 'refEntityId is required for LIVE_ROOM_SHARE posts', 400);
      }
      const voiceRoom = await prisma.voiceRoom.findUnique({
        where: { id: refEntityId },
        select: { id: true, status: true, deletedAt: true, privacy: true },
      });
      if (!voiceRoom || voiceRoom.deletedAt) {
        return errorResponse(res, 'Voice Club room not found', 404);
      }
      // ENDED rooms can still be shared (recipient sees it ended on the card).
      // Banned/blocked rooms have no explicit status — deletedAt covers that.
    }

    // CF-19 FIX: Validate community membership before allowing a community post.
    // A non-member (or banned user) must not be able to post into a community.
    // Schema confirmed: Community.deletedAt exists, CommunityMember.@@unique([communityId,userId]),
    // CommunityBan model exists with communityId + userId fields.
    if (communityId) {
      const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, privacy: true, deletedAt: true }
      });
      if (!community || community.deletedAt !== null) {
        return errorResponse(res, 'Community not found', 404);
      }
      const membership = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId, userId: req.user.id } },
        select: { id: true }
      });
      if (!membership) {
        return errorResponse(res, 'You must be a member of this community to post', 403);
      }
      const ban = await prisma.communityBan.findFirst({
        where: { communityId, userId: req.user.id },
        select: { id: true }
      });
      if (ban) {
        return errorResponse(res, 'You are banned from this community', 403);
      }
    }

    const post = await prisma.post.create({
      data: {
        id: uuidv4(), authorId: req.user.id,
        body: body?.trim() || null, type, visibility, isDraft,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        // FS-GAP-002 FIX: Resolve schoolId from SchoolMembership for MEMBER users
        // whose User.schoolId may be null. Legacy users use User.schoolId directly.
        schoolId: visibility === 'SCHOOL_ONLY'
          ? (req.user.schoolId || (await prisma.schoolMembership.findFirst({
              where: { userId: req.user.id, status: 'ACTIVE', deletedAt: null },
              select: { schoolId: true }
            }).then(m => m?.schoolId ?? null).catch(() => null)))
          : null,
        pollData: pollData || null,
        linkUrl: linkUrl || null, linkTitle: linkTitle || null,
        linkDescription: linkDescription || null, linkImage: linkImage || null,
        originalPostId: originalPostId || null, quotedBody: quotedBody || null,
        refEntityType: refEntityType || null, refEntityId: refEntityId || null,
        communityId: communityId || null,
        isExclusive: isExclusive || false,
        tierRequired: tierRequired || null,
        location: location?.trim() || null,
      }
    });

    // Save media
    if (media.length) {
      await prisma.postMedia.createMany({
        data: media.map((m, i) => ({ id: uuidv4(), postId: post.id, url: m.url, type: m.type || 'IMAGE', mimeType: m.mimeType || null, size: m.size || null, width: m.width || null, height: m.height || null, duration: m.duration || null, thumbnail: m.thumbnail || null, orderIndex: i }))
      });
    }

    // Repost: increment share count on original
    if (originalPostId) {
      await prisma.post.update({ where: { id: originalPostId }, data: { shareCount: { increment: 1 } } });
    }

    await syncHashtags(post.id, body);
    await syncMentions(post.id, null, body, req.user.id);

    const full = await prisma.post.findUnique({ where: { id: post.id }, include: POST_INCLUDE(req.user.id) });

    // Broadcast to feed rooms via socket
    const io = getIo();
    if (io && !isDraft) {
      // Posts in PRIVATE or INVITE_ONLY communities must NOT be broadcast to feed:public.
      // Only emit to the community room so only connected members see the new post.
      if (communityId) {
        // Check community privacy before deciding which room to emit to
        const comm = await prisma.community.findUnique({
          where: { id: communityId },
          select: { privacy: true }
        }).catch(() => null);

        if (!comm || comm.privacy === 'PRIVATE' || comm.privacy === 'INVITE_ONLY') {
          // Private/invite-only community — emit only to community room
          io.to(`community:${communityId}`).emit('post:create', { post: full });
        } else {
          // Public community — emit to both community room and feed:public
          io.to(`community:${communityId}`).emit('post:create', { post: full });
          if (post.visibility === 'PUBLIC' || post.visibility === 'FOLLOWERS') {
            io.to('feed:public').emit('post:create', { post: full });
          }
        }
      } else if (post.visibility === 'PUBLIC' || post.visibility === 'FOLLOWERS') {
        // MF-010 FIX: Exclude blocked users from feed:public broadcast.
        // Each connected user has a personal room `feed:${userId}` (joined in app.js feed:join handler).
        // We fetch the author's bilateral block list and use io.except() to skip those personal rooms,
        // so blocked users don't receive the new-post banner for content they can't see.
        const blocks = await prisma.userBlock.findMany({
          where: { OR: [{ blockerId: req.user.id }, { blockedId: req.user.id }] },
          select: { blockerId: true, blockedId: true }
        }).catch(() => []);

        const blockedRooms = blocks
          .flatMap(b => [b.blockerId, b.blockedId])
          .filter(id => id !== req.user.id)
          .map(id => `feed:${id}`);

        const emitter = blockedRooms.length > 0
          ? io.except(blockedRooms).to('feed:public')
          : io.to('feed:public');

        emitter.emit('post:create', { post: full });
      } else if (post.visibility === 'SCHOOL_ONLY' && post.schoolId) {
        // FS-GAP-002 FIX: Use post.schoolId (resolved at creation) not req.user.schoolId
        io.to(`feed:school:${post.schoolId}`).emit('post:create', { post: full });
      }
      // PRIVATE posts are not broadcast
    }

    // Invalidate trending hashtag cache when a new post is created with hashtags
    if (body && body.includes('#')) {
      try {
        const { isRedisReady, deleteCache } = require('../utils/redis');
        if (isRedisReady()) await deleteCache('trending:hashtags');
      } catch { /* non-fatal */ }
    }

    return successResponse(res, full, 'Post created', 201);
  } catch (e) { next(e); }
}

// ─── GET SINGLE POST ─────────────────────────────────────────────────────────
async function getPost(req, res, next) {
  try {
    const requesterId = req.user.id;
    const postId = req.params.id;
    // P0-01 FIX: Call assertPostAccessible BEFORE the full POST_INCLUDE fetch
    // to close the TOCTOU gap. Previously the full JOINed post (media, reactions,
    // originalPost, etc.) was fetched first, then authorization checks ran — an
    // unauthorized viewer had the full post data in memory before denial. Now:
    //   1. assertPostAccessible runs a lightweight 7-field select and enforces
    //      all 8 authorization dimensions (deletion, draft, block, visibility,
    //      exclusive, community membership, ban, deleted community).
    //   2. Only after authorization passes does the full POST_INCLUDE fetch run.
    // This also adds the isDraft check that was missing from the previous inline
    // authorization block (non-authors could retrieve draft posts by UUID).
    const { error: authError } = await assertPostAccessible(postId, requesterId, prisma);
    if (authError) return errorResponse(res, authError.message, authError.status);
    // Authorization passed — fetch full post with all includes.
    const post = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      include: POST_INCLUDE(requesterId)
    });
    if (!post) return errorResponse(res, 'Post not found', 404);
    // CF-18 FIX: Redact inaccessible nested originalPost for single-post endpoint.
    // assertPostAccessible above verified the main post. For the nested original,
    // run assertPostAccessible independently since we have no pre-fetched context.
    let resultPost = post;
    if (post.originalPost && post.originalPostId) {
      const { error: origError } = await assertPostAccessible(post.originalPostId, requesterId, prisma);
      if (origError) {
        resultPost = { ...post, originalPost: null };
      }
    }
    // Record view (fire-and-forget).
    // VIEW-COUNT FIX: Use try/create/catch(P2002) so viewCount is only
    // incremented on the FIRST view from this user.
    if (post.authorId !== requesterId) {
      prisma.postView.create({
        data: { id: uuidv4(), postId: post.id, userId: requesterId }
      }).then(() =>
        prisma.post.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } })
      ).catch(err => {
        if (!err || err.code !== 'P2002') {
          // Unexpected error: swallow silently (fire-and-forget contract)
        }
      });
    }
    return successResponse(res, resultPost);
  } catch (e) { next(e); }
}

// ─── UPDATE POST ─────────────────────────────────────────────────────────────
async function updatePost(req, res, next) {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!post) return errorResponse(res, 'Post not found', 404);
    if (post.authorId !== req.user.id) return errorResponse(res, 'Not your post', 403);

    const { body, visibility, isDraft, scheduledAt, linkUrl, linkTitle, linkDescription, linkImage, location } = req.body;
    const updated = await prisma.post.update({
      where: { id: post.id },
      data: {
        ...(body !== undefined && { body: body?.trim() || null }),
        ...(visibility !== undefined && { visibility }),
        ...(isDraft !== undefined && { isDraft }),
        ...(scheduledAt !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }),
        ...(linkUrl !== undefined && { linkUrl, linkTitle, linkDescription, linkImage }),
        ...(location !== undefined && { location: location?.trim() || null }),
      },
      include: POST_INCLUDE(req.user.id)
    });

    if (body !== undefined) {
      await syncHashtags(post.id, body);
    }

    const io = getIo();
    if (io) io.to('feed:public').emit('post:update', { post: updated });

    return successResponse(res, updated, 'Post updated');
  } catch (e) { next(e); }
}

// ─── DELETE POST ─────────────────────────────────────────────────────────────
async function deletePost(req, res, next) {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!post) return errorResponse(res, 'Post not found', 404);
    // F-2 FIX: Content deletion must be restricted to:
    //   1. The post author (content ownership)
    //   2. SUPER_ADMIN only (HALQA platform admin — not SCHOOL_ADMIN)
    // Previously SCHOOL_ADMIN could delete any user's post platform-wide, including
    // posts by MEMBER users with no school affiliation.
    const canDelete = post.authorId === req.user.id || req.user.role === 'SUPER_ADMIN';
    if (!canDelete) return errorResponse(res, 'Not authorized', 403);

    // FIX: Decrement hashtag post counts before soft-deleting the post.
    // Previously postCount only ever incremented (on create) and never decremented,
    // causing Hashtag.postCount to drift higher than the real post count over time.
    // We do this before the soft-delete so the PostHashtag join records still exist.
    try {
      const postHashtags = await prisma.postHashtag.findMany({
        where:  { postId: post.id },
        select: { hashtagId: true }
      });
      if (postHashtags.length > 0) {
        const hashtagIds = postHashtags.map(ph => ph.hashtagId);
        await prisma.hashtag.updateMany({
          where: { id: { in: hashtagIds } },
          data:  { postCount: { decrement: 1 } }
        });
      }
    } catch (hashtagErr) {
      // Non-fatal — soft-delete still proceeds; postCount may drift but post is deleted
      logger.warn(`[deletePost] Hashtag decrement failed for post ${post.id}: ${hashtagErr.message}`);
    }

    await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });

    // Invalidate trending hashtag cache so the next request reflects the deletion
    try {
      const { isRedisReady, deleteCache } = require('../utils/redis');
      if (isRedisReady()) await deleteCache('trending:hashtags');
    } catch { /* non-fatal */ }

    const io = getIo();
    if (io) io.to('feed:public').emit('post:delete', { postId: post.id });

    return successResponse(res, null, 'Post deleted');
  } catch (e) { next(e); }
}

// ─── Helper: enrich live posts (LIVE_ROOM_SHARE / LIVE_CLASS_SHARE) with liveData ──
// POST_INCLUDE does not include liveData because it is computed from the related
// VoiceRoom or LiveClass entity. This helper fetches those in a single batch and
// attaches the field so LiveCard can render correctly in the feed.
async function enrichLivePosts(posts) {
  const voiceIds = posts.filter(p => p.type === 'LIVE_ROOM_SHARE' && p.refEntityId).map(p => p.refEntityId);
  const classIds = posts.filter(p => p.type === 'LIVE_CLASS_SHARE' && p.refEntityId).map(p => p.refEntityId);

  if (voiceIds.length === 0 && classIds.length === 0) return posts;

  const [voiceRooms, liveClasses] = await Promise.all([
    voiceIds.length > 0 ? prisma.voiceRoom.findMany({
      where: { id: { in: voiceIds } },
      select: {
        id: true, title: true, description: true,
        coverEmoji: true, coverImageUrl: true, status: true,
        _count: { select: { participants: { where: { isActive: true } } } },
      },
    }) : [],
    classIds.length > 0 ? prisma.liveClass.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true, title: true, description: true, coverImageUrl: true, status: true,
        class: { select: { name: true } },
        _count: { select: { participants: { where: { isActive: true } } } },
      },
    }).catch(() => []) : [],
  ]);

  const voiceMap = Object.fromEntries(voiceRooms.map(r => [r.id, r]));
  const classMap = Object.fromEntries(liveClasses.map(c => [c.id, c]));

  return posts.map(post => {
    if (post.type === 'LIVE_ROOM_SHARE' && post.refEntityId) {
      const room = voiceMap[post.refEntityId];
      if (room) {
        post.liveData = {
          title:            room.title,
          description:      room.description ?? null,
          coverEmoji:       room.coverEmoji ?? '🎙️',
          coverImageUrl:    room.coverImageUrl ?? null,
          participantCount: room._count.participants,
          isLive:           room.status === 'LIVE',
        };
      }
    } else if (post.type === 'LIVE_CLASS_SHARE' && post.refEntityId) {
      const lc = classMap[post.refEntityId];
      if (lc) {
        post.liveData = {
          title:            lc.title,
          description:      lc.description ?? null,
          coverEmoji:       '📹',
          coverImageUrl:    lc.coverImageUrl ?? null,
          participantCount: lc._count.participants,
          className:        lc.class?.name ?? null,
          isLive:           lc.status === 'LIVE',
        };
      }
    }
    return post;
  });
}

// ─── HOME FEED ───────────────────────────────────────────────────────────────
// ─── HOME FEED ───────────────────────────────────────────────────────────────
// filter=following → only show posts from people the viewer follows (+ own posts)
// filter=all (default) → full public feed
async function getFeed(req, res, next) {
  try {
    const { cursor, limit = 20, filter = 'all' } = req.query;
    const take = Math.min(50, Math.max(1, parseInt(limit)));
    const viewerId = req.user.id;

    let where;
    // CF-18: context for filterOriginalPost (reused from visibilityFilter to avoid extra queries)
    let feedCtx = null;

    if (filter === 'following') {
      // Pure following feed: only posts from people the viewer follows + own posts
      const [following, followingBlocks, memberCommunities, publicCommunities, communityBans, activeSubs, schoolMembership] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: viewerId },
          select: { followingId: true }
        }),
        // FOLLOW-BLOCK FIX: Apply bilateral block policy to the following feed.
        prisma.userBlock.findMany({
          where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
          select: { blockerId: true, blockedId: true }
        }).catch(() => []),
        // CF-20 + CF-18: community membership for following feed
        prisma.communityMember.findMany({
          where: { userId: viewerId, community: { deletedAt: null } },
          select: { communityId: true }
        }).catch(() => []),
        prisma.community.findMany({
          where: { privacy: 'PUBLIC', deletedAt: null },
          select: { id: true }
        }).catch(() => []),
        prisma.communityBan.findMany({
          where: { userId: viewerId },
          select: { communityId: true }
        }).catch(() => []),
        // CF-18: subscriptions for filterOriginalPost
        prisma.creatorSubscription.findMany({
          where: { subscriberId: viewerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
          select: { creatorId: true }
        }).catch(() => []),
        prisma.schoolMembership.findFirst({
          where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
          select: { schoolId: true }
        }).catch(() => null),
      ]);
      const followingIds = following.map(f => f.followingId);

      const blockedFollowingIds = new Set(
        followingBlocks
          .flatMap(b => [b.blockerId, b.blockedId])
          .filter(id => id !== viewerId)
      );

      // CF-20: community gate for following feed
      const bannedCommunityIds = new Set((communityBans || []).map(b => b.communityId));
      const accessibleMemberIds = (memberCommunities || [])
        .map(m => m.communityId)
        .filter(id => !bannedCommunityIds.has(id));
      const allowedCommunityIds = [...new Set([
        ...(publicCommunities || []).map(c => c.id),
        ...accessibleMemberIds,
      ])];

      where = {
        deletedAt: null,
        isDraft:   false,
        OR: [
          { authorId: { in: followingIds } },
          { authorId: viewerId },
        ],
        // CF-20: community gate
        AND: [{
          OR: [
            { communityId: null },
            { communityId: { in: allowedCommunityIds } },
            { authorId: viewerId },
          ]
        }]
      };

      if (blockedFollowingIds.size > 0) {
        where.NOT = { authorId: { in: [...blockedFollowingIds] } };
      }

      // CF-18: resolve subscribedCreatorIds for filterOriginalPost
      let subscribedCreatorIds = [];
      if (activeSubs.length > 0) {
        try {
          const creatorProfiles = await prisma.creatorProfile.findMany({
            where: { id: { in: activeSubs.map(s => s.creatorId) } },
            select: { userId: true }
          });
          subscribedCreatorIds = creatorProfiles.map(p => p.userId);
        } catch { /* non-fatal */ }
      }
      const viewerUser = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }).catch(() => null);
      const effectiveSchoolId = viewerUser?.schoolId ?? schoolMembership?.schoolId ?? null;
      const blockedUserIds = new Set([...blockedFollowingIds]);

      feedCtx = { followingIds, effectiveSchoolId, subscribedCreatorIds, allowedCommunityIds, blockedUserIds };
    } else {
      // Default: full public feed (existing behaviour)
      where = await visibilityFilter(viewerId);
      // CF-18: reuse context computed by visibilityFilter (no extra queries)
      if (where._ctx) {
        const ctx = where._ctx;
        delete where._ctx;
        const blockedUserIds = new Set(ctx.blockedAuthorIds);
        feedCtx = {
          followingIds: ctx.followingIds,
          effectiveSchoolId: ctx.effectiveSchoolId,
          subscribedCreatorIds: ctx.subscribedCreatorIds,
          allowedCommunityIds: ctx.allowedCommunityIds,
          blockedUserIds,
        };
      }
    }

    // Cursor pagination (createdAt + id for stable sort)
    if (cursor) {
      const [cursorTime, cursorId] = cursor.split('_');
      where.createdAt = { lte: new Date(cursorTime) };
      // P1-A FIX: Merge cursor id exclusion with any existing NOT clause instead of
      // unconditionally overwriting it. Overwriting would drop the block-exclusion
      // predicate set by visibilityFilter(), allowing blocked-author posts to leak
      // through on pages 2+. Prisma 5 accepts NOT as a single object or an array
      // (AND-NOT semantics), so both forms are valid and equivalent here.
      const cursorNot = { id: cursorId };
      where.NOT = where.NOT ? [where.NOT, cursorNot] : cursorNot;
    }

    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE(viewerId),
      orderBy: [{ createdAt: 'desc' }],
      take: take + 1
    });

    const hasMore = posts.length > take;
    let items = hasMore ? posts.slice(0, take) : posts;

    // CF-18 FIX: Redact inaccessible nested originalPost objects.
    // POST_INCLUDE fetches originalPost unconditionally with no authorization check.
    // Apply filterOriginalPost to nullify any originalPost the viewer cannot access.
    if (feedCtx) {
      items = items.map(p => ({
        ...p,
        originalPost: p.originalPost
          ? filterOriginalPost(p.originalPost, viewerId, feedCtx)
          : null,
      }));
    }

    items = await enrichLivePosts(items);
    items = await stampFollowing(items, viewerId);

    const nextCursor = hasMore && items.length > 0
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return successResponse(res, { items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

// ─── USER POSTS (profile tab) ─────────────────────────────────────────────────
async function getUserPosts(req, res, next) {
  try {
    let { userId } = req.params;
    // Support 'me' alias for the authenticated user
    if (userId === 'me') userId = req.user.id;
    const { cursor, limit = 20, tab = 'posts' } = req.query;
    const take = Math.min(50, Math.max(1, parseInt(limit)));
    const viewerId = req.user.id;
    const isOwner = userId === viewerId;

    // P1-C FIX: Enforce bilateral block policy for non-owner viewers.
    // If the viewer has blocked the profile owner, or the profile owner has
    // blocked the viewer, return 404 (consistent with getUserProfile conventions).
    // Owner always skips this check — a user can always view their own posts.
    if (!isOwner) {
      const block = await prisma.userBlock.findFirst({
        where: { OR: [
          { blockerId: viewerId, blockedId: userId },
          { blockerId: userId,   blockedId: viewerId }
        ]}
      });
      if (block) return errorResponse(res, 'User not found', 404);
    }

    let where = { authorId: userId, deletedAt: null, isDraft: false };

    if (tab === 'bookmarks' && isOwner) {
      // Return bookmarked posts
      const bookmarks = await prisma.postBookmark.findMany({
        where: { userId: viewerId },
        include: { post: { include: POST_INCLUDE(viewerId) } },
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 })
      });
      const hasMore = bookmarks.length > take;
      const rawItems = (hasMore ? bookmarks.slice(0, take) : bookmarks).map(b => b.post).filter(Boolean);
      // P1-05 FIX: Recheck accessibility for each bookmarked post at retrieval time.
      // A post's visibility may have changed (PUBLIC→PRIVATE) or the author may have
      // blocked the viewer after the bookmark was created. Without this check, stale
      // bookmarks would surface inaccessible content. assertPostAccessible enforces
      // all 8 dimensions (block, visibility, draft, school, exclusive, community).
      const accessChecks = await Promise.all(
        rawItems.map(post => assertPostAccessible(post.id, viewerId, prisma))
      );
      const items = rawItems.filter((_, i) => accessChecks[i].error === null);
      return successResponse(res, { items, nextCursor: hasMore && items.length > 0 ? items[items.length - 1]?.id : null, hasMore });
    }

    if (tab === 'media') where.type = { in: ['IMAGE', 'VIDEO', 'MULTI_IMAGE'] };
    // BUG FIX: Post has no parentId field (that belongs to PostComment).
    // 'replies' tab on a user profile shows their QUOTE posts (originalPostId set + quotedBody).
    if (tab === 'replies') where = { ...where, type: 'QUOTE', originalPostId: { not: null } };
    if (!isOwner) where.visibility = { not: 'PRIVATE' };

    // CF-20 FIX: Apply community access gate for non-owner viewers.
    // A PUBLIC post belonging to a PRIVATE community was previously visible
    // on the author's profile to any viewer. The owner sees all their own posts.
    let profileCtx = null;
    if (!isOwner) {
      const [memberCommunities, publicCommunities, communityBans, following, activeSubs, schoolMembership, profileBlocks] = await Promise.all([
        prisma.communityMember.findMany({
          where: { userId: viewerId, community: { deletedAt: null } },
          select: { communityId: true }
        }).catch(() => []),
        prisma.community.findMany({
          where: { privacy: 'PUBLIC', deletedAt: null },
          select: { id: true }
        }).catch(() => []),
        prisma.communityBan.findMany({
          where: { userId: viewerId },
          select: { communityId: true }
        }).catch(() => []),
        // CF-18: for filterOriginalPost
        prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }).catch(() => []),
        prisma.creatorSubscription.findMany({
          where: { subscriberId: viewerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
          select: { creatorId: true }
        }).catch(() => []),
        prisma.schoolMembership.findFirst({
          where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
          select: { schoolId: true }
        }).catch(() => null),
        // CF-18 FIX: Bilateral block set for filterOriginalPost — prevents a blocked
        // user's originalPost content from leaking in reposts on an accessible profile.
        prisma.userBlock.findMany({
          where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
          select: { blockerId: true, blockedId: true }
        }).catch(() => []),
      ]);
      const bannedCommunityIds = new Set((communityBans || []).map(b => b.communityId));
      const accessibleMemberIds = (memberCommunities || [])
        .map(m => m.communityId)
        .filter(id => !bannedCommunityIds.has(id));
      const allowedCommunityIds = [...new Set([
        ...(publicCommunities || []).map(c => c.id),
        ...accessibleMemberIds,
      ])];

      // CF-18: build context for filterOriginalPost
      let subscribedCreatorIds = [];
      if (activeSubs.length > 0) {
        try {
          const creatorProfiles = await prisma.creatorProfile.findMany({
            where: { id: { in: activeSubs.map(s => s.creatorId) } },
            select: { userId: true }
          });
          subscribedCreatorIds = creatorProfiles.map(p => p.userId);
        } catch { /* non-fatal */ }
      }
      const viewerUser = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }).catch(() => null);
      const effectiveSchoolId = viewerUser?.schoolId ?? schoolMembership?.schoolId ?? null;
      const followingIds = following.map(f => f.followingId);
      // CF-18 FIX: Build bilateral block set from profileBlocks so filterOriginalPost
      // can redact originalPost content from a blocked third-party author appearing in
      // reposts on this profile. (The profile owner bilateral block is already rejected
      // upstream; this covers unrelated blocked authors in nested originalPosts.)
      const blockedUserIds = new Set(
        (profileBlocks || []).flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId)
      );
      // P0-02 FIX: Enforce exclusive-content subscription gate for non-owner viewers.
      // Previously the non-owner filter only excluded PRIVATE posts (visibility != PRIVATE)
      // but did not check isExclusive. A non-subscriber could see any exclusive post on
      // the author's profile as long as it was PUBLIC/FOLLOWERS/SCHOOL_ONLY.
      // The gate: isExclusive:true posts are only visible if the viewer has an active
      // subscription to that creator (authorId in subscribedCreatorIds).
      where.AND = [
        // Community access gate (CF-20)
        {
          OR: [
            { communityId: null },
            { communityId: { in: allowedCommunityIds } },
          ]
        },
        // Exclusive content gate (P0-02):
        // A post is accessible if it is NOT exclusive, OR the viewer subscribes to
        // the author, OR the viewer IS the author (owner path already bypassed above).
        {
          OR: [
            { isExclusive: false },
            { authorId: { in: subscribedCreatorIds.length > 0 ? subscribedCreatorIds : ['__no_match__'] } },
          ]
        },
      ];
      profileCtx = { followingIds, effectiveSchoolId, subscribedCreatorIds, allowedCommunityIds, blockedUserIds };
    }

    if (cursor) { where.createdAt = { lte: new Date(cursor.split('_')[0]) }; }

    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE(viewerId),
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: take + 1
    });

    const hasMore = posts.length > take;
    let items     = hasMore ? posts.slice(0, take) : posts;

    // CF-18 FIX: Redact inaccessible nested originalPost objects for non-owner viewers.
    if (profileCtx) {
      items = items.map(p => ({
        ...p,
        originalPost: p.originalPost
          ? filterOriginalPost(p.originalPost, viewerId, profileCtx)
          : null,
      }));
    }

    const stamped = await stampFollowing(items, viewerId);
    const nextCursor = hasMore && stamped.length > 0 ? `${stamped[stamped.length - 1].createdAt.toISOString()}_${stamped[stamped.length - 1].id}` : null;

    return successResponse(res, { items: stamped, nextCursor, hasMore });
  } catch (e) { next(e); }
}

// ─── REACT TO POST ───────────────────────────────────────────────────────────
async function reactToPost(req, res, next) {
  try {
    const { type = 'LIKE' } = req.body;
    const { id: postId } = req.params;
    const userId = req.user.id;
    const VALID = ['LIKE','LOVE','CELEBRATE','SUPPORT','INSIGHTFUL','FUNNY'];
    if (!VALID.includes(type)) return errorResponse(res, 'Invalid reaction type', 400);

    // CF-02 FIX: Verify full post accessibility (all 8 dimensions) before mutating.
    // Previously only a deletion check + bilateral block check existed. This missed
    // PRIVATE, FOLLOWERS-only, SCHOOL_ONLY, and private-community visibility gates.
    // assertPostAccessible subsumes the previous block check (dimension 3).
    // NOTE: Response code for blocked interactions changes from 403 → 404 for
    // oracle-attack prevention consistency (aligns with read-operation behavior).
    const { post, error: accessError } = await assertPostAccessible(postId, userId, prisma);
    if (accessError) return errorResponse(res, accessError.message, accessError.status);

    const existing = await prisma.postReaction.findUnique({
      where: { postId_userId: { postId, userId } }
    });

    let action, delta;
    if (existing) {
      if (existing.type === type) {
        // Same reaction — remove it (toggle off), atomic with counter decrement
        await prisma.$transaction([
          prisma.postReaction.delete({ where: { postId_userId: { postId, userId } } }),
          prisma.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } })
        ]);
        delta = 0; action = 'removed'; // delta=0 to skip the second update below
      } else {
        // Different reaction — update type only (count unchanged)
        await prisma.postReaction.update({ where: { postId_userId: { postId, userId } }, data: { type } });
        delta = 0; action = 'updated';
      }
    } else {
      // New reaction — atomic with counter increment
      await prisma.$transaction([
        prisma.postReaction.create({ data: { id: uuidv4(), postId, userId, type } }),
        prisma.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } })
      ]);
      delta = 0; action = 'added'; // delta=0: counter already updated inside transaction
    }

    if (delta !== 0) {
      await prisma.post.update({ where: { id: postId }, data: { likeCount: { increment: delta } } });
    }

    // Notify post author (only on new reaction, not own post)
    if (action === 'added' && post.authorId !== userId) {
      await notify(post.authorId, {
        type:  'LIKE',
        title: `${req.user.firstName} reacted to your post`,
        body:  `${req.user.firstName} ${req.user.lastName} reacted with ${type.toLowerCase()}`,
        data:  { postId, type: 'post_reaction' }
      });
    }

    const io = getIo();
    if (io) io.to('feed:public').emit('post:like', { postId, userId, type, action });

    return successResponse(res, { action, type });
  } catch (e) { next(e); }
}

// ─── GET REACTIONS ───────────────────────────────────────────────────────────
async function getReactions(req, res, next) {
  try {
    const viewerId = req.user.id;
    const reactions = await prisma.postReaction.findMany({
      where: { postId: req.params.id },
      include: { user: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // REACTION-BLOCK FIX (FIND-007): Filter out reactions from/to blocked users.
    const rBlocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true }
    }).catch(() => []);

    const blockedIds = new Set(
      rBlocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId)
    );

    const visible = blockedIds.size > 0
      ? reactions.filter(r => !blockedIds.has(r.user.id))
      : reactions;

    // Group by type (uses visible, not reactions)
    const grouped = {};
    visible.forEach(r => {
      if (!grouped[r.type]) grouped[r.type] = [];
      grouped[r.type].push(r.user);
    });
    return successResponse(res, { reactions: visible, grouped, total: visible.length });
  } catch (e) { next(e); }
}

// ─── ADD COMMENT ─────────────────────────────────────────────────────────────
async function addComment(req, res, next) {
  try {
    const { body, parentId } = req.body;
    const { id: postId } = req.params;
    if (!body?.trim()) return errorResponse(res, 'Comment body required', 400);

    // CF-02 FIX: Verify full post accessibility (all 8 dimensions) before mutating.
    // Previously only a deletion check + bilateral block check existed. This missed
    // PRIVATE, FOLLOWERS-only, SCHOOL_ONLY, and private-community visibility gates.
    // assertPostAccessible subsumes the previous block check (dimension 3).
    // NOTE: Response code for blocked interactions changes from 403 → 404 for
    // oracle-attack prevention consistency (aligns with read-operation behavior).
    const { post, error: accessError } = await assertPostAccessible(postId, req.user.id, prisma);
    if (accessError) return errorResponse(res, accessError.message, accessError.status);

    // Validate parentId belongs to this post
    if (parentId) {
      const parent = await prisma.postComment.findFirst({ where: { id: parentId, postId, deletedAt: null } });
      if (!parent) return errorResponse(res, 'Parent comment not found', 404);
    }

    // Create the comment and increment counters atomically in an interactive transaction
    // Interactive form required because postComment.create uses `include`
    const comment = await prisma.$transaction(async (tx) => {
      const newComment = await tx.postComment.create({
        data: { id: uuidv4(), postId, authorId: req.user.id, parentId: parentId || null, body: body.trim() },
        include: { author: { select: AUTHOR_SELECT } }
      });
      await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
      if (parentId) {
        await tx.postComment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
      }
      return newComment;
    });

    await syncMentions(postId, comment.id, body, req.user.id);

    // Notify post author
    if (post.authorId !== req.user.id) {
      await notify(post.authorId, {
        type:  'COMMENT',
        title: `${req.user.firstName} commented on your post`,
        body:  body.substring(0, 80),
        data:  { postId, commentId: comment.id, type: 'post_comment' }
      });
    }
    // Notify parent comment author if reply
    if (parentId) {
      const parent = await prisma.postComment.findUnique({ where: { id: parentId }, select: { authorId: true } });
      if (parent && parent.authorId !== req.user.id && parent.authorId !== post.authorId) {
        await notify(parent.authorId, {
          type:  'COMMENT_REPLY',
          title: `${req.user.firstName} replied to your comment`,
          body:  body.substring(0, 80),
          data:  { postId, commentId: comment.id, type: 'comment_reply' }
        });
      }
    }

    const io = getIo();
    if (io) io.to('feed:public').emit('comment:create', { postId, comment });

    return successResponse(res, comment, 'Comment added', 201);
  } catch (e) { next(e); }
}

// ─── GET COMMENTS ────────────────────────────────────────────────────────────
async function getComments(req, res, next) {
  try {
    const { cursor, limit = 20, parentId } = req.query;
    const take = Math.min(50, parseInt(limit));

    const where = {
      postId: req.params.id,
      deletedAt: null,
      parentId: parentId || null
    };
    if (cursor) where.createdAt = { lte: new Date(cursor.split('_')[0]) };

    const comments = await prisma.postComment.findMany({
      where,
      include: {
        author: { select: AUTHOR_SELECT },
        reactions: { where: { userId: req.user.id }, select: { type: true } },
        _count: { select: { replies: true, reactions: true } }
      },
      orderBy: { createdAt: 'asc' },
      take: take + 1
    });

    const hasMore = comments.length > take;
    const items = hasMore ? comments.slice(0, take) : comments;
    const nextCursor = hasMore && items.length > 0 ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}` : null;

    return successResponse(res, { items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

// ─── EDIT COMMENT ────────────────────────────────────────────────────────────
async function editComment(req, res, next) {
  try {
    const { body } = req.body;
    if (!body?.trim()) return errorResponse(res, 'Body required', 400);
    const comment = await prisma.postComment.findFirst({ where: { id: req.params.commentId, deletedAt: null } });
    if (!comment) return errorResponse(res, 'Comment not found', 404);
    if (comment.authorId !== req.user.id) return errorResponse(res, 'Not your comment', 403);
    const updated = await prisma.postComment.update({
      where: { id: comment.id },
      data: { body: body.trim() },
      include: { author: { select: AUTHOR_SELECT } }
    });
    return successResponse(res, updated, 'Comment updated');
  } catch (e) { next(e); }
}

// ─── DELETE COMMENT ──────────────────────────────────────────────────────────
async function deleteComment(req, res, next) {
  try {
    const comment = await prisma.postComment.findFirst({ where: { id: req.params.commentId, deletedAt: null } });
    if (!comment) return errorResponse(res, 'Comment not found', 404);
    // F-2 FIX: Comment deletion restricted to author + SUPER_ADMIN only (not SCHOOL_ADMIN).
    const can = comment.authorId === req.user.id || req.user.role === 'SUPER_ADMIN';
    if (!can) return errorResponse(res, 'Not authorized', 403);

    // Count active replies before soft-deleting so we decrement commentCount correctly.
    // (DB cascade only fires on hard-delete; soft-delete of parent leaves replies alive.)
    const replyCount = comment.parentId === null
      ? await prisma.postComment.count({ where: { parentId: comment.id, deletedAt: null } })
      : 0; // replies cannot themselves have replies (single-level threading)

    const now = new Date();
    // Soft-delete the comment itself and any active direct replies in one transaction
    await prisma.$transaction([
      prisma.postComment.update({ where: { id: comment.id }, data: { deletedAt: now } }),
      ...(replyCount > 0
        ? [prisma.postComment.updateMany({ where: { parentId: comment.id, deletedAt: null }, data: { deletedAt: now } })]
        : []
      ),
      prisma.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 + replyCount } }
      }),
    ]);

    return successResponse(res, null, 'Comment deleted');
  } catch (e) { next(e); }
}

// ─── REACT TO COMMENT ────────────────────────────────────────────────────────
async function reactToComment(req, res, next) {
  try {
    const { type = 'LIKE' } = req.body;
    const { commentId } = req.params;
    const userId = req.user.id;
    const existing = await prisma.commentReaction.findUnique({ where: { commentId_userId: { commentId, userId } } });
    let delta;
    if (existing) {
      await prisma.commentReaction.delete({ where: { commentId_userId: { commentId, userId } } });
      delta = -1;
    } else {
      await prisma.commentReaction.create({ data: { id: uuidv4(), commentId, userId, type } });
      delta = 1;
    }
    await prisma.postComment.update({ where: { id: commentId }, data: { likeCount: { increment: delta } } });
    return successResponse(res, { action: delta > 0 ? 'added' : 'removed' });
  } catch (e) { next(e); }
}

// ─── BOOKMARK ────────────────────────────────────────────────────────────────
async function toggleBookmark(req, res, next) {
  try {
    const { id: postId } = req.params;
    const userId = req.user.id;

    // CF-01 FIX: Verify post accessibility before any bookmark mutation.
    // Previously there was no post-existence or visibility check here, so a user
    // could bookmark PRIVATE, FOLLOWERS-only, SCHOOL_ONLY, or community-restricted
    // posts simply by knowing their UUID.
    const { error: accessError } = await assertPostAccessible(postId, userId, prisma);
    if (accessError) return errorResponse(res, accessError.message, accessError.status);

    const existing = await prisma.postBookmark.findUnique({ where: { postId_userId: { postId, userId } } });
    let action;
    if (existing) {
      await prisma.postBookmark.delete({ where: { postId_userId: { postId, userId } } });
      await prisma.post.update({ where: { id: postId }, data: { bookmarkCount: { decrement: 1 } } });
      action = 'removed';
    } else {
      await prisma.postBookmark.create({ data: { id: uuidv4(), postId, userId } });
      await prisma.post.update({ where: { id: postId }, data: { bookmarkCount: { increment: 1 } } });
      action = 'added';
    }
    return successResponse(res, { action, bookmarked: action === 'added' });
  } catch (e) { next(e); }
}

// ─── PIN POST ────────────────────────────────────────────────────────────────
async function pinPost(req, res, next) {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!post) return errorResponse(res, 'Post not found', 404);
    if (post.authorId !== req.user.id) return errorResponse(res, 'Not your post', 403);
    // Unpin any previously pinned post
    await prisma.post.updateMany({ where: { authorId: req.user.id, isPinned: true }, data: { isPinned: false } });
    const updated = await prisma.post.update({ where: { id: post.id }, data: { isPinned: !post.isPinned } });
    return successResponse(res, { isPinned: updated.isPinned });
  } catch (e) { next(e); }
}

// ─── SEARCH POSTS ────────────────────────────────────────────────────────────
// PERFORMANCE FIX (L1): Now uses MySQL FULLTEXT MATCH AGAINST instead of LIKE.
// Falls back to LIKE automatically if FULLTEXT index is not yet applied.
async function searchPosts(req, res, next) {
  try {
    const { q, limit = 20, before } = req.query;
    if (!q || q.trim().length < 2) {
      return successResponse(res, { items: [], nextCursor: null, hasMore: false });
    }
    const take     = Math.min(50, parseInt(limit));
    const viewerId = req.user.id;
    const { searchPosts: ftSearchPosts } = require('../utils/search');

    // CF-20 FIX: Compute allowed community IDs before searching, so the search
    // utility can gate out posts from PRIVATE/INVITE_ONLY communities.
    // CF-18: also fetch context for filterOriginalPost on search results.
    const [memberCommunities, publicCommunities, communityBans, following, activeSubs, schoolMembership, blocks] = await Promise.all([
      prisma.communityMember.findMany({
        where: { userId: viewerId, community: { deletedAt: null } },
        select: { communityId: true }
      }).catch(() => []),
      prisma.community.findMany({
        where: { privacy: 'PUBLIC', deletedAt: null },
        select: { id: true }
      }).catch(() => []),
      prisma.communityBan.findMany({
        where: { userId: viewerId },
        select: { communityId: true }
      }).catch(() => []),
      prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }).catch(() => []),
      prisma.creatorSubscription.findMany({
        where: { subscriberId: viewerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        select: { creatorId: true }
      }).catch(() => []),
      prisma.schoolMembership.findFirst({
        where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
        select: { schoolId: true }
      }).catch(() => null),
      // CF-18 FIX: Bilateral block set for filterOriginalPost — prevents blocked-author
      // originalPost content from leaking in repost search results.
      prisma.userBlock.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true }
      }).catch(() => []),
    ]);

    const bannedCommunityIds = new Set((communityBans || []).map(b => b.communityId));
    const accessibleMemberIds = (memberCommunities || [])
      .map(m => m.communityId)
      .filter(id => !bannedCommunityIds.has(id));
    const allowedCommunityIds = [...new Set([
      ...(publicCommunities || []).map(c => c.id),
      ...accessibleMemberIds,
    ])];

    // CF-18 FIX: Build bilateral block set so filterOriginalPost can redact blocked-author
    // content from nested originalPost on search results.
    const blockedUserIds = new Set(
      (blocks || []).flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId)
    );

    const items = await ftSearchPosts(prisma, q.trim(), viewerId, { take, before, allowedCommunityIds });

    // CF-18 FIX: Redact inaccessible nested originalPost on search results.
    let subscribedCreatorIds = [];
    if (activeSubs.length > 0) {
      try {
        const creatorProfiles = await prisma.creatorProfile.findMany({
          where: { id: { in: activeSubs.map(s => s.creatorId) } },
          select: { userId: true }
        });
        subscribedCreatorIds = creatorProfiles.map(p => p.userId);
      } catch { /* non-fatal */ }
    }
    const viewerUser = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }).catch(() => null);
    const effectiveSchoolId = viewerUser?.schoolId ?? schoolMembership?.schoolId ?? null;
    const followingIds = following.map(f => f.followingId);
    // CF-18 FIX: blockedUserIds now populated from bilateral block fetch above.
    const searchCtx = { followingIds, effectiveSchoolId, subscribedCreatorIds, allowedCommunityIds, blockedUserIds };
    const redacted = items.map(p => ({
      ...p,
      originalPost: p.originalPost
        ? filterOriginalPost(p.originalPost, viewerId, searchCtx)
        : null,
    }));

    const nextCursor = redacted.length === take && redacted.length > 0
      ? `${redacted[redacted.length - 1].createdAt.toISOString()}_${redacted[redacted.length - 1].id}`
      : null;

    return successResponse(res, { items: redacted, nextCursor, hasMore: !!nextCursor });
  } catch (e) { next(e); }
}

// ─── TRENDING HASHTAGS ───────────────────────────────────────────────────────
// L10 fix: Upgraded from raw postCount sort to an engagement-weighted trending score.
//
// Algorithm (inspired by Reddit/HN decay formula):
//   score = (recentPosts × 3) + (recentLikes × 2) + (recentComments × 1)
//   where "recent" = last 48 hours
//
// This means a hashtag with 10 posts in the last 2h ranks higher than
// a hashtag with 100 posts from last month. Fresh engagement wins.
//
// Cache: 5 minutes (trending changes slowly, serving from cache is correct).
async function getTrendingHashtags(req, res, next) {
  try {
    // Serve from cache if available
    try {
      const { isRedisReady, getCache } = require('../utils/redis');
      if (isRedisReady()) {
        const cached = await getCache('trending:hashtags');
        if (cached) return successResponse(res, cached);
      }
    } catch { /* non-fatal */ }

    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Step 1: Get recent post activity per hashtag
    const recentHashtagPosts = await prisma.postHashtag.findMany({
      where: { post: { createdAt: { gte: since48h }, deletedAt: null, isDraft: false, visibility: 'PUBLIC' } },
      select: { hashtagId: true, post: { select: { likeCount: true, commentCount: true } } }
    });

    // Step 2: Aggregate engagement score per hashtag
    const scoreMap = new Map();
    recentHashtagPosts.forEach(({ hashtagId, post }) => {
      const prev = scoreMap.get(hashtagId) || { posts: 0, likes: 0, comments: 0 };
      scoreMap.set(hashtagId, {
        posts:    prev.posts    + 1,
        likes:    prev.likes    + (post?.likeCount    || 0),
        comments: prev.comments + (post?.commentCount || 0)
      });
    });

    if (scoreMap.size === 0) {
      // No recent posts — fall back to all-time postCount
      const tags = await prisma.hashtag.findMany({ orderBy: { postCount: 'desc' }, take: 20 });
      try {
        const { isRedisReady, setCache } = require('../utils/redis');
        if (isRedisReady()) await setCache('trending:hashtags', tags, 300);
      } catch {}
      return successResponse(res, tags);
    }

    // Step 3: Fetch hashtag details for trending IDs
    const topIds = [...scoreMap.entries()]
      .map(([id, s]) => ({ id, score: (s.posts * 3) + (s.likes * 2) + (s.comments * 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(x => x.id);

    const hashtags = await prisma.hashtag.findMany({ where: { id: { in: topIds } } });

    // Re-sort to match relevance order
    const orderMap = new Map(topIds.map((id, i) => [id, i]));
    const sorted   = hashtags.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

    // Add trending score to each result for frontend display
    const enriched = sorted.map(h => ({
      ...h,
      trendingScore: scoreMap.get(h.id)
        ? (scoreMap.get(h.id).posts * 3) + (scoreMap.get(h.id).likes * 2) + (scoreMap.get(h.id).comments * 1)
        : 0
    }));

    try {
      const { isRedisReady, setCache } = require('../utils/redis');
      if (isRedisReady()) await setCache('trending:hashtags', enriched, 300);
    } catch {}

    return successResponse(res, enriched);
  } catch (e) { next(e); }
}

// ─── REPORT POST ─────────────────────────────────────────────────────────────
async function reportPost(req, res, next) {
  try {
    const { reason, description } = req.body;

    // Validate reason — same set as userReport, plus mobile-friendly aliases
    const VALID_REASONS = [
      'spam', 'harassment', 'hate_speech', 'sexual_content',
      'scam', 'impersonation', 'underage', 'other',
      // Mobile app sends these — included for client compatibility
      'inappropriate', 'misinformation',
    ];
    if (!reason || !VALID_REASONS.includes(reason)) {
      return errorResponse(res, `reason must be one of: ${VALID_REASONS.join(', ')}`, 400);
    }

    const post = await prisma.post.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!post) return errorResponse(res, 'Post not found', 404);

    // Reporter cannot report their own post
    if (post.authorId === req.user.id) {
      return errorResponse(res, 'Cannot report your own post', 400);
    }

    // REPORT-POST-DB FIX: Persist report to DB before emitting socket event.
    // Previously only emitted a socket event — if no admin was online the report
    // was permanently lost. Now mirrors the reportUser() pattern exactly.
    //
    // CF-03 FIX: Use a serializable transaction for the duplicate-guard + create pair.
    // A non-transactional findFirst+create has a race window: two concurrent requests
    // from the same reporter can both pass the findFirst check before either creates,
    // producing duplicate PENDING rows. The transaction serializes the check+create so
    // exactly one request wins and the other gets the duplicate guard.
    let report;
    const txResult = await prisma.$transaction(async (tx) => {
      const pendingReport = await tx.postReport.findFirst({
        where: { reporterId: req.user.id, postId: post.id, status: 'PENDING' },
        select: { id: true },
      });
      if (pendingReport) {
        return { duplicate: true };
      }
      const created = await tx.postReport.create({
        data: {
          id:          uuidv4(),
          reporterId:  req.user.id,
          postId:      post.id,
          reason,
          description: description?.trim() || null,
          status:      'PENDING',
        },
      });
      return { duplicate: false, report: created };
    });

    if (txResult.duplicate) {
      return errorResponse(res, 'You already have a pending report on this post. Wait for it to be reviewed.', 409);
    }
    report = txResult.report;
    const reportPayload = {
      type:        'post_reported',
      reportId:    report.id,
      postId:      post.id,
      authorId:    post.authorId,
      reporterId:  req.user.id,
      reporterName:`${req.user.firstName} ${req.user.lastName}`,
      reason,
      description: description || '',
      reportedAt:  new Date().toISOString(),
    };

    // Broadcast to platform admin room for real-time dashboard updates.
    // SOC-P0-03 / REPORT-POST-SOCKET FIX: Emit to role:SUPER_ADMIN only.
    // Previously emitted to both role:SUPER_ADMIN and role:SCHOOL_ADMIN, which
    // leaked reporter identity (name, userId) and report metadata to every
    // connected SCHOOL_ADMIN on the platform — regardless of whether the
    // reported post belongs to their school. Social content moderation is a
    // PLATFORM-LEVEL operation (SUPER_ADMIN only); school-scoped admins receive
    // a targeted notify() call below when the post actually belongs to their school.
    // Mirrors the identical fix already applied to reportUser() (SOC-P0-03).
    const io = getIo();
    if (io) {
      io.to('role:SUPER_ADMIN').emit('admin:post_reported', reportPayload);
    }

    // Notify the post author's school admin if the post belongs to a school
    if (post.schoolId) {
      try {
        const schoolAdmin = await prisma.user.findFirst({
          where: { schoolId: post.schoolId, role: 'SCHOOL_ADMIN', status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        if (schoolAdmin) {
          await notify(schoolAdmin.id, {
            type:  'SYSTEM',
            title: `Post reported: ${reason}`,
            body:  description || `A post was reported by ${req.user.firstName} ${req.user.lastName}`,
            data:  reportPayload,
          });
        }
      } catch (notifyErr) {
        // Non-fatal — report is already persisted even if notification fails
        logger.warn(`[reportPost] School admin notification failed: ${notifyErr.message}`);
      }
    }

    logger.info(`[reportPost] Post ${post.id} reported by user ${req.user.id} — reportId: ${report.id} reason: ${reason}`);
    return successResponse(res, { reportId: report.id }, 'Report submitted. Our moderation team will review it.', 201);
  } catch (e) {
    // CF-03: P2002 from the DB-level unique constraint backstop (pendingKey) means a
    // concurrent request already created the PENDING row — treat as duplicate, not 500.
    if (e && e.code === 'P2002') {
      return errorResponse(res, 'You already have a pending report on this post. Wait for it to be reviewed.', 409);
    }
    next(e);
  }
}

// ─── REELS — TikTok-style video feed ─────────────────────────────────────────
// Returns posts that have at least one VIDEO media item, cursor-paginated.
// Ordered by newest first. Only PUBLIC posts.
// BLOCK FIX: Excludes posts from blocked authors (both directions).
async function getReels(req, res, next) {
  try {
    const { cursor, limit = 10 } = req.query;
    const take      = Math.min(20, Math.max(1, parseInt(limit)));
    const viewerId  = req.user.id;

    // MF-016 FIX: Include FOLLOWERS-only reels from people the viewer follows.
    // CF-18/CF-20: Added community membership and subscription queries.
    const [blocks, following, memberCommunities, publicCommunities, communityBans, activeSubs, schoolMembership] = await Promise.all([
      prisma.userBlock.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true }
      }).catch(() => []),
      prisma.follow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true }
      }).catch(() => []),
      // CF-20: community membership for reels feed
      prisma.communityMember.findMany({
        where: { userId: viewerId, community: { deletedAt: null } },
        select: { communityId: true }
      }).catch(() => []),
      prisma.community.findMany({
        where: { privacy: 'PUBLIC', deletedAt: null },
        select: { id: true }
      }).catch(() => []),
      prisma.communityBan.findMany({
        where: { userId: viewerId },
        select: { communityId: true }
      }).catch(() => []),
      // CF-18: for filterOriginalPost
      prisma.creatorSubscription.findMany({
        where: { subscriberId: viewerId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        select: { creatorId: true }
      }).catch(() => []),
      prisma.schoolMembership.findFirst({
        where: { userId: viewerId, status: 'ACTIVE', deletedAt: null },
        select: { schoolId: true }
      }).catch(() => null),
    ]);

    const blockedAuthorIds = [
      ...new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId))
    ];
    const followingIds = following.map(f => f.followingId);

    // CF-20: community gate
    const bannedCommunityIds = new Set((communityBans || []).map(b => b.communityId));
    const accessibleMemberIds = (memberCommunities || [])
      .map(m => m.communityId)
      .filter(id => !bannedCommunityIds.has(id));
    const allowedCommunityIds = [...new Set([
      ...(publicCommunities || []).map(c => c.id),
      ...accessibleMemberIds,
    ])];

    // P0-02 FIX: Resolve subscribedCreatorIds before building the visibility filter.
    // Previously getReels built its own inline OR without any subscription check,
    // so exclusive reels (isExclusive:true) were returned to ALL viewers regardless
    // of subscription status.  The fix mirrors the pattern used in visibilityFilter():
    //   - Non-exclusive branches carry isExclusive:false
    //   - Subscriber-only branches are appended for creators the viewer subscribes to
    //   - Subscription requires isExclusive:true AND an active CreatorSubscription
    // Resolve subscribedCreatorIds before building the visibility filter.
    let subscribedCreatorIds = [];
    if (activeSubs.length > 0) {
      try {
        const creatorProfiles = await prisma.creatorProfile.findMany({
          where: { id: { in: activeSubs.map(s => s.creatorId) } },
          select: { userId: true }
        });
        subscribedCreatorIds = creatorProfiles.map(p => p.userId);
      } catch { /* non-fatal */ }
    }

    // Build visibility filter: PUBLIC/FOLLOWERS for all, plus subscriber branches
    const nonExclusiveOr = followingIds.length > 0
      ? [
          { visibility: 'PUBLIC',    isExclusive: false },
          { visibility: 'FOLLOWERS', isExclusive: false, authorId: { in: followingIds } },
        ]
      : [
          { visibility: 'PUBLIC', isExclusive: false },
        ];

    const exclusiveOr = subscribedCreatorIds.length > 0
      ? [
          { isExclusive: true, visibility: 'PUBLIC', authorId: { in: subscribedCreatorIds } },
          ...(followingIds.length > 0
            ? [{ isExclusive: true, visibility: 'FOLLOWERS', authorId: { in: subscribedCreatorIds.filter(id => followingIds.includes(id)) } }]
            : []),
        ]
      : [];

    const reelsVisibilityFilter = { OR: [...nonExclusiveOr, { authorId: viewerId }, ...exclusiveOr] };

    const where = {
      deletedAt: null,
      isDraft:   false,
      ...reelsVisibilityFilter,
      // Must have at least one VIDEO media item
      media: { some: { type: 'VIDEO' } },
      // CF-20: community gate
      AND: [{
        OR: [
          { communityId: null },
          { communityId: { in: allowedCommunityIds } },
          { authorId: viewerId },
        ]
      }],
    };

    // BLOCK FIX: Apply block exclusion when there are blocked users.
    if (blockedAuthorIds.length > 0) {
      where.NOT = { authorId: { in: blockedAuthorIds } };
    }

    if (cursor) {
      const [cursorTime, cursorId] = cursor.split('_');
      where.createdAt = { lte: new Date(cursorTime) };
      // Merge cursor id exclusion with any existing NOT clause
      if (where.NOT) {
        where.NOT = [where.NOT, { id: cursorId }];
      } else {
        where.NOT = { id: cursorId };
      }
    }

    const posts = await prisma.post.findMany({
      where,
      include: POST_INCLUDE(viewerId),
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = posts.length > take;
    let items = hasMore ? posts.slice(0, take) : posts;

    // CF-18 FIX: Redact inaccessible nested originalPost objects in reels.
    // Reuse community/follow/subscription context already fetched above.
    // subscribedCreatorIds was resolved before building the visibility filter (P0-02 FIX).
    const viewerUser = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }).catch(() => null);
    const effectiveSchoolId = viewerUser?.schoolId ?? schoolMembership?.schoolId ?? null;
    const blockedUserIds = new Set(blockedAuthorIds);
    const reelsCtx = { followingIds, effectiveSchoolId, subscribedCreatorIds, allowedCommunityIds, blockedUserIds };

    items = items.map(p => ({
      ...p,
      originalPost: p.originalPost
        ? filterOriginalPost(p.originalPost, viewerId, reelsCtx)
        : null,
    }));

    items = await stampFollowing(items, viewerId);

    const nextCursor = hasMore && items.length > 0
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return successResponse(res, { items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

// ─── GET LIVE SESSIONS ────────────────────────────────────────────────────────
// Returns currently active voice rooms + live classes as feed cards.
// Called by FeedPage on mount and after feed:live socket events.
async function getLiveSessions(req, res, next) {
  try {
    const viewerId = req.user.id;
    const viewer   = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } });

    // Fetch currently LIVE voice rooms (PUBLIC only)
    const [liveVoiceRooms, liveClasses] = await Promise.all([
      prisma.voiceRoom.findMany({
        where: { status: 'LIVE', privacy: 'PUBLIC', deletedAt: null },
        include: {
          host: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
          _count: { select: { participants: { where: { isActive: true } } } }
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 10,
      }),
      // Use a safe two-step approach: fetch live classes first, then filter
      // out any whose teacher relation is broken (deleted teacher records).
      // This avoids Prisma's "Field teacher is required, got null" crash.
      (async () => {
        const schoolFilter = viewer?.schoolId ? { schoolId: viewer.schoolId } : {};
        const classes = await prisma.liveClass.findMany({
          where: { status: 'LIVE', deletedAt: null, ...schoolFilter },
          include: {
            class: { select: { id: true, name: true } },
            _count: { select: { participants: { where: { isActive: true } } } },
          },
          orderBy: { startedAt: 'desc' },
          take: 10,
        });
        // Fetch teacher users separately to handle orphaned references
        const teacherIds = [...new Set(classes.map(c => c.teacherId).filter(Boolean))];
        const teachers = teacherIds.length > 0 ? await prisma.teacher.findMany({
          where: { id: { in: teacherIds } },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } } },
        }) : [];
        const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]));
        // Attach teacher info (may be null for orphaned records — handled in mapping below)
        return classes.map(c => ({ ...c, teacher: teacherMap[c.teacherId] ?? null }));
      })(),
    ]);

    // Shape into unified feed cards
    const voiceCards = liveVoiceRooms.map(room => ({
      id:            `live-voice-${room.id}`,
      type:          'LIVE_ROOM_SHARE',
      refEntityType: 'voice_room',
      refEntityId:   room.id,
      authorId:      room.hostId,
      author:        room.host,
      body:          room.description ? `${room.title}\n\n${room.description}` : room.title,
      visibility:    'PUBLIC',
      media: [], hashtags: [], reactions: [], bookmarks: [],
      _count: { reactions: 0, comments: 0 },
      likeCount: 0, commentCount: 0, shareCount: 0, viewCount: 0, bookmarkCount: 0,
      isPinned: false, isDraft: false, scheduledAt: null,
      linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
      pollData: null, originalPostId: null, originalPost: null, quotedBody: null, location: null,
      createdAt: room.startedAt ?? room.createdAt,
      updatedAt: room.updatedAt,
      liveData: {
        title:            room.title,
        description:      room.description,
        coverEmoji:       room.coverEmoji ?? '🎙️',
        coverImageUrl:    room.coverImageUrl ?? null,
        participantCount: room._count.participants,
        isLive:           true,
      },
    }));

    const classCards = liveClasses.map(lc => ({
      id:            `live-class-${lc.id}`,
      type:          'LIVE_CLASS_SHARE',
      refEntityType: 'live_class',
      refEntityId:   lc.id,
      authorId:      lc.teacher?.user?.id ?? viewerId,
      author:        lc.teacher?.user ?? null,
      body:          lc.description ? `${lc.title}\n\n${lc.description}` : lc.title,
      visibility:    'SCHOOL_ONLY',
      media: [], hashtags: [], reactions: [], bookmarks: [],
      _count: { reactions: 0, comments: 0 },
      likeCount: 0, commentCount: 0, shareCount: 0, viewCount: 0, bookmarkCount: 0,
      isPinned: false, isDraft: false, scheduledAt: null,
      linkUrl: null, linkTitle: null, linkDescription: null, linkImage: null,
      pollData: null, originalPostId: null, originalPost: null, quotedBody: null, location: null,
      createdAt: lc.startedAt ?? lc.createdAt,
      updatedAt: lc.updatedAt,
      liveData: {
        title:            lc.title,
        description:      lc.description,
        coverEmoji:       '📹',
        coverImageUrl:    lc.coverImageUrl ?? null,
        participantCount: lc._count.participants,
        className:        lc.class?.name ?? null,
        isLive:           true,
      },
    }));

    return successResponse(res, [...voiceCards, ...classCards]);
  } catch (e) { next(e); }
}

// ─── RECORD VIEW (feed impression) ───────────────────────────────────────────
// Called by the frontend when a post scrolls into view in the feed.
// Uses upsert so each user counts only once per post.
// Fire-and-forget design: returns 204 immediately, DB work is async.
async function recordView(req, res, next) {
  try {
    const { id: postId } = req.params;
    const userId = req.user.id;

    // Verify post exists (lightweight check — no includes)
    const exists = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true }
    });
    if (!exists) return res.status(204).end(); // silently ignore missing posts

    // VIEW-COUNT FIX: Use create/catch(P2002) instead of upsert+then.
    // Prisma 5 upsert always returns the row whether created or updated,
    // so the chained .then() always fired even on repeat visits.
    // Now: only increment viewCount when the create succeeds (first view).
    // P2002 = unique constraint = already viewed = do not increment.
    prisma.postView.create({
      data: { id: require('uuid').v4(), postId, userId }
    }).then(() =>
      prisma.post.update({
        where: { id: postId },
        data:  { viewCount: { increment: 1 } }
      })
    ).catch(() => {}); // P2002 (repeat view) and other errors swallowed — fire-and-forget

    return res.status(204).end();
  } catch (e) { next(e); }
}

// ─── RECORD SHARE ─────────────────────────────────────────────────────────────
// Called when a user shares via clipboard or native OS share sheet (not repost/quote).
// Increments shareCount by 1. Fire-and-forget — returns 200 immediately.
// Idempotent in the sense that calling multiple times keeps incrementing (each
// clipboard/native share is a real share event). Rate-limiting on the route prevents abuse.
async function recordShare(req, res, next) {
  try {
    const { id: postId } = req.params;
    const exists = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true }
    });
    if (!exists) return res.status(204).end(); // silently ignore missing posts
    await prisma.post.update({ where: { id: postId }, data: { shareCount: { increment: 1 } } });
    return successResponse(res, { shared: true });
  } catch (e) { next(e); }
}

// ─── LINK PREVIEW SCRAPE ─────────────────────────────────────────────────────
// Fetches OG/meta tags from a URL. Uses Node built-in https/http — no extra deps.
// Results cached in Redis for 1 hour (same URL will never be re-fetched during that window).
//
// L-7 FIX: Added SSRF protection. The endpoint previously allowed fetching
// any URL including internal services (localhost, AWS metadata, Redis, DB).
// Now blocked: private IP ranges (RFC 1918), loopback, link-local, and
// any non-https in production.
async function getLinkPreview(req, res, next) {
  try {
    const { url } = req.query;
    if (!url) return errorResponse(res, 'url required', 400);

    // Validate URL format
    let parsed;
    try { parsed = new URL(url); } catch { return errorResponse(res, 'Invalid URL', 400); }

    // L-7 FIX: Only allow https (not http) to prevent plaintext credential sniffing
    // Allow http in development for local testing convenience
    const allowHttp = process.env.NODE_ENV !== 'production';
    if (parsed.protocol === 'http:' && !allowHttp) {
      return errorResponse(res, 'Only https URLs are supported in production', 400);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return errorResponse(res, 'Only http/https URLs supported', 400);
    }

    // L-7 FIX: Block SSRF by resolving the hostname and checking against
    // private/reserved IP ranges before making the outbound request.
    const { resolve4, resolve6 } = require('dns').promises;
    const isPrivateIp = (ip) => {
      // IPv4 private ranges (RFC 1918), loopback, link-local, APIPA, metadata
      const BLOCKED_PATTERNS = [
        /^127\./,                       // Loopback
        /^10\./,                        // RFC 1918
        /^192\.168\./,                  // RFC 1918
        /^172\.(1[6-9]|2\d|3[01])\./,  // RFC 1918 (172.16–172.31)
        /^169\.254\./,                  // Link-local / APIPA
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // RFC 6598 shared
        /^::1$/,                        // IPv6 loopback
        /^fc00:/i,                      // IPv6 unique local
        /^fe80:/i,                      // IPv6 link-local
        /^fd/i,                         // IPv6 unique local (fd00::/8)
      ];
      return BLOCKED_PATTERNS.some(p => p.test(ip));
    };

    const hostname = parsed.hostname;

    // Block hostnames that are obviously internal without DNS
    if (hostname === 'localhost' || hostname === '0.0.0.0' ||
        hostname.endsWith('.local') || hostname.endsWith('.internal') ||
        hostname.endsWith('.localhost')) {
      return errorResponse(res, 'URL not allowed', 400);
    }

    // Resolve hostname to IP(s) and check each
    try {
      const ips = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
      const resolvedIps = ips.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      if (resolvedIps.some(isPrivateIp)) {
        logger.warn(`[getLinkPreview] SSRF attempt blocked: ${url} resolved to private IP`);
        return errorResponse(res, 'URL not allowed', 400);
      }
    } catch {
      // DNS resolution failed — reject the request (fail closed)
      return errorResponse(res, 'Could not resolve URL', 400);
    }

    // Serve from Redis cache if available (1h TTL)
    const cacheKey = `link-preview:${Buffer.from(url).toString('base64').slice(0, 80)}`;
    try {
      const { isRedisReady, getCache } = require('../utils/redis');
      if (isRedisReady()) {
        const cached = await getCache(cacheKey);
        if (cached) return successResponse(res, cached);
      }
    } catch { /* non-fatal */ }

    // Fetch the page HTML — 5s timeout, follow up to 3 redirects, max 200 KB
    // L-7 FIX: Re-validate redirect destinations against SSRF blocklist
    const html = await new Promise((resolve, reject) => {
      const lib     = parsed.protocol === 'https:' ? require('https') : require('http');
      let body      = '';
      let redirects = 0;

      const fetchUrl = async (targetUrl) => {
        let targetParsed;
        try { targetParsed = new URL(targetUrl); } catch { return reject(new Error('Invalid redirect URL')); }

        // Re-check redirect destination against SSRF blocklist
        if (!['http:', 'https:'].includes(targetParsed.protocol)) return reject(new Error('Invalid redirect protocol'));
        try {
          const ips = await Promise.allSettled([resolve4(targetParsed.hostname), resolve6(targetParsed.hostname)]);
          const resolvedIps = ips.flatMap(r => r.status === 'fulfilled' ? r.value : []);
          if (resolvedIps.some(isPrivateIp)) return reject(new Error('Redirect to private IP blocked'));
        } catch { return reject(new Error('Redirect DNS resolution failed')); }

        const targetLib = targetParsed.protocol === 'https:' ? require('https') : require('http');
        const reqHandle = targetLib.get(targetUrl, {
          timeout: 5000,
          headers: {
            'User-Agent': 'HalqaBot/1.0 (link preview)',
            'Accept':     'text/html',
          },
        }, (response) => {
          // Follow redirects
          if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            if (++redirects > 3) return reject(new Error('Too many redirects'));
            return fetchUrl(response.headers.location);
          }
          if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));

          response.setEncoding('utf8');
          response.on('data', chunk => {
            body += chunk;
            if (body.length > 200_000) { response.destroy(); resolve(body); } // cap at 200 KB
          });
          response.on('end', () => resolve(body));
        });
        reqHandle.on('error',   reject);
        reqHandle.on('timeout', () => { reqHandle.destroy(); reject(new Error('Timeout')); });
      };
      fetchUrl(url);
    });

    // Extract OG / Twitter / fallback meta tags with simple regex (no cheerio needed)
    const getMeta = (property) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'),
        new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:${property}["']`, 'i'),
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m) return m[1].trim();
      }
      return null;
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    const preview = {
      url,
      title:       getMeta('title') || (titleTag ? titleTag[1].trim() : parsed.hostname),
      description: getMeta('description') || null,
      image:       getMeta('image') || null,
    };

    // MF-015 FIX: Validate the og:image URL against the SSRF blocklist before storing.
    // A malicious page could set og:image to a private/internal URL (e.g. http://169.254.169.254/)
    // which would be stored and rendered in <img src> on the frontend.
    if (preview.image) {
      try {
        const imgParsed = new URL(preview.image);
        if (imgParsed.protocol !== 'https:' && imgParsed.protocol !== 'http:') {
          // Reject non-http(s) schemes (data:, javascript:, file:, etc.)
          preview.image = null;
        } else {
          const imgIps = await Promise.allSettled([resolve4(imgParsed.hostname), resolve6(imgParsed.hostname)]).catch(() => []);
          const imgResolvedIps = (Array.isArray(imgIps) ? imgIps : []).flatMap(r => r.status === 'fulfilled' ? r.value : []);
          if (imgResolvedIps.some(isPrivateIp)) {
            logger.warn(`[getLinkPreview] SSRF: og:image URL ${preview.image} resolves to private IP — suppressed`);
            preview.image = null;
          }
        }
      } catch {
        // DNS error or invalid URL — suppress image rather than crashing
        preview.image = null;
      }
    }

    // Cache for 1 hour
    try {
      const { isRedisReady, setCache } = require('../utils/redis');
      if (isRedisReady()) await setCache(cacheKey, preview, 3600);
    } catch { /* non-fatal */ }

    return successResponse(res, preview);
  } catch (e) {
    // Non-fatal — return empty preview rather than 500
    logger.warn(`[getLinkPreview] Failed to fetch preview: ${e.message}`);
    return successResponse(res, { url: req.query.url, title: null, description: null, image: null });
  }
}

// ─── POLL VOTE ───────────────────────────────────────────────────────────────
// Stores vote in pollData JSON. One vote per user per poll (enforced via PostView upsert trick
// — we reuse the PostView table: a "view" here represents a vote cast).
// After voting, recalculate vote counts from scratch and update pollData.
async function votePoll(req, res, next) {
  try {
    const { id: postId } = req.params;
    const { optionId }   = req.body;
    const userId         = req.user.id;

    if (!optionId) return errorResponse(res, 'optionId required', 400);

    // CF-02 FIX: Verify full post accessibility (all 8 dimensions) before recording vote.
    // Previously there was no visibility gate at all — only a deletion + type check.
    // A user could vote on PRIVATE, FOLLOWERS-only, SCHOOL_ONLY, or private-community
    // polls simply by knowing the post UUID. assertPostAccessible enforces all dimensions.
    const { error: accessError } = await assertPostAccessible(postId, userId, prisma);
    if (accessError) return errorResponse(res, accessError.message, accessError.status);

    // Post-authorization type check: confirm this post is actually a poll.
    // assertPostAccessible does not validate post.type — that is a domain constraint,
    // not an authorization dimension.
    const post = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null, type: 'POLL' },
    });
    if (!post) return errorResponse(res, 'Poll not found', 404);

    const pollData = post.pollData;
    if (!pollData || !Array.isArray(pollData.options)) {
      return errorResponse(res, 'Invalid poll data', 422);
    }

    // Check expiry
    if (pollData.endsAt && new Date(pollData.endsAt) < new Date()) {
      return errorResponse(res, 'Poll has ended', 400);
    }

    // Check option exists
    const optionExists = pollData.options.some(o =>
      (typeof o === 'object' ? o.id : String(pollData.options.indexOf(o))) === String(optionId)
    );
    if (!optionExists) return errorResponse(res, 'Invalid option', 400);

    // Use PostView as "poll vote" record (postId + userId unique) — avoids new table migration
    const existingVote = await prisma.postView.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existingVote) return errorResponse(res, 'You have already voted', 409);

    // Record vote
    await prisma.postView.create({
      data: { id: uuidv4(), postId, userId, votedOptionId: optionId }
    }).catch(async () => {
      // votedOptionId column may not exist — fall back to plain upsert
      await prisma.postView.upsert({
        where:  { postId_userId: { postId, userId } },
        create: { id: uuidv4(), postId, userId },
        update: {},
      });
    });

    // Recalculate votes by counting all PostView rows for this post
    // grouped by votedOptionId (best effort — falls back to simple increment)
    try {
      const votes = await prisma.$queryRaw`
        SELECT votedOptionId, COUNT(*) as cnt
        FROM post_views
        WHERE postId = ${postId} AND votedOptionId IS NOT NULL
        GROUP BY votedOptionId
      `;
      const voteMap = {};
      (votes || []).forEach(r => { voteMap[r.votedOptionId] = Number(r.cnt); });

      const updatedOptions = pollData.options.map(o => {
        const id = typeof o === 'object' ? o.id : String(pollData.options.indexOf(o));
        return typeof o === 'object'
          ? { ...o, votes: voteMap[id] ?? o.votes ?? 0 }
          : o;
      });
      const totalVotes = Object.values(voteMap).reduce((a, b) => a + b, 0);

      await prisma.post.update({
        where: { id: postId },
        data:  { pollData: { ...pollData, options: updatedOptions, totalVotes } },
      });
    } catch {
      // Non-fatal — increment the selected option's vote count directly
      const updatedOptions = pollData.options.map(o => {
        if (typeof o !== 'object') return o;
        return o.id === optionId ? { ...o, votes: (o.votes ?? 0) + 1 } : o;
      });
      await prisma.post.update({
        where: { id: postId },
        data:  { pollData: { ...pollData, options: updatedOptions, totalVotes: (pollData.totalVotes ?? 0) + 1 } },
      });
    }

    const io = getIo();
    if (io) io.to('feed:public').emit('post:poll_vote', { postId, optionId, userId });

    return successResponse(res, { voted: true, optionId });
  } catch (e) { next(e); }
}

// ─── MODULE EXPORTS ──────────────────────────────────────────────────────────
module.exports = {
  createPost, getPost, updatePost, deletePost,
  getFeed, getUserPosts, getReels,
  reactToPost, getReactions,
  addComment, getComments, editComment, deleteComment, reactToComment,
  toggleBookmark, pinPost, recordView, recordShare, getLiveSessions,
  searchPosts, getTrendingHashtags, reportPost, votePoll, getLinkPreview
};
