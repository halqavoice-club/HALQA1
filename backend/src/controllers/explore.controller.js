'use strict';
/**
 * Explore Controller — Phase B-5: Global Discovery
 * New file — never modifies existing controllers.
 * Provides: trending posts, trending hashtags, suggested people,
 *           suggested communities, trending voice rooms, unified search.
 */
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

const USER_SELECT = {
  id: true, firstName: true, lastName: true,
  avatarUrl: true, role: true, schoolId: true, bio: true
};

// ─── GET /explore — aggregated trending content ───────────────────────────────
async function getExploreFeed(req, res, next) {
  try {
    const viewerId  = req.user.id;

    // ── Cache: serve from Redis for 2 minutes (explore feed is non-personal) ──
    // Cache key includes viewerId so suggested people (already-following filter)
    // are per-user. TTL 2 min is short enough for freshness, long enough to ease DB.
    try {
      const { isRedisReady, getCache, setCache } = require('../utils/redis');
      if (isRedisReady()) {
        const cacheKey = `explore:feed:${viewerId}`;
        const cached = await getCache(cacheKey);
        if (cached) return successResponse(res, cached);
      }
    } catch { /* non-fatal — fall through to DB */ }

    const since24h  = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d   = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);

    // BLOCK FIX: Load bilateral block list once for the whole explore feed.
    // Used to exclude blocked authors from trending posts and suggested people.
    const blocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true }
    }).catch(() => []);
    const blockedUserIds = [
      ...new Set(blocks.flatMap(b => [b.blockerId, b.blockedId]).filter(id => id !== viewerId))
    ];

    const [
      trendingPosts,
      trendingHashtags,
      suggestedCommunities,
      liveVoiceRooms,
      liveLiveClasses,
      suggestedPeople,
    ] = await Promise.all([

      // Trending posts (last 24h, sorted by reactions + comments)
      // BLOCK FIX: exclude posts authored by blocked users (both directions).
      prisma.post.findMany({
        where: {
          deletedAt: null, isDraft: false, visibility: 'PUBLIC', createdAt: { gte: since24h },
          ...(blockedUserIds.length > 0 ? { NOT: { authorId: { in: blockedUserIds } } } : {}),
        },
        include: {
          author:    { select: USER_SELECT },
          media:     { orderBy: { orderIndex: 'asc' }, take: 1 },
          hashtags:  { include: { hashtag: { select: { id: true, name: true } } } },
          community: { select: { id: true, slug: true, name: true } },
          _count:    { select: { reactions: true, comments: true } },
          reactions: { where: { userId: viewerId }, select: { type: true } },
          bookmarks: { where: { userId: viewerId }, select: { id: true } },
        },
        orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { viewCount: 'desc' }],
        take: 20,
      }),

      // Trending hashtags (top 20 by post count)
      prisma.hashtag.findMany({
        orderBy: { postCount: 'desc' },
        take: 20,
      }),

      // Suggested communities (public, most members, not already joined)
      prisma.community.findMany({
        where: {
          deletedAt: null,
          privacy: 'PUBLIC',
          members: { none: { userId: viewerId } },   // not already a member
        },
        select: {
          id: true, slug: true, name: true, description: true,
          avatarUrl: true, memberCount: true, category: true, isVerified: true,
          owner: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { memberCount: 'desc' },
        take: 8,
      }),

      // Live voice rooms (global public rooms currently live)
      prisma.voiceRoom.findMany({
        where: { status: 'LIVE', privacy: 'PUBLIC', deletedAt: null },
        include: {
          host:         { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          _count:       { select: { participants: { where: { isActive: true } } } },
        },
        orderBy: { lastActivityAt: 'desc' },
        take: 10,
      }),

      // Live classes (school-scoped — only show classes from the viewer's school,
      // or all classes for SUPER_ADMIN)
      (async () => {
        const viewer = await prisma.user.findUnique({
          where: { id: viewerId },
          select: { schoolId: true, role: true },
        });
        const isSuperAdmin = viewer?.role === 'SUPER_ADMIN';
        const schoolFilter = !isSuperAdmin && viewer?.schoolId ? { schoolId: viewer.schoolId } : {};

        // Fetch classes without teacher include to avoid null reference crash
        const classes = await prisma.liveClass.findMany({
          where: { status: 'LIVE', deletedAt: null, ...schoolFilter },
          include: {
            class:  { select: { id: true, name: true } },
            _count: { select: { participants: { where: { isActive: true } } } },
          },
          orderBy: { startedAt: 'desc' },
          take: 6,
        });

        // Fetch teachers separately to handle orphaned references gracefully
        const teacherIds = [...new Set(classes.map(c => c.teacherId).filter(Boolean))];
        const teachers = teacherIds.length > 0 ? await prisma.teacher.findMany({
          where: { id: { in: teacherIds } },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        }) : [];
        const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]));
        return classes.map(c => ({ ...c, teacher: teacherMap[c.teacherId] ?? null }));
      })(),

      // Suggested people — users the viewer doesn't follow yet, globally
      // Ordered by follower count descending so well-known users appear first
      // BLOCK FIX: Also exclude blocked users (both directions) from suggestions.
      (async () => {
        const alreadyFollowing = await prisma.follow.findMany({
          where: { followerId: viewerId },
          select: { followingId: true },
        });
        // Union: already-following + viewer themselves + blocked users (both directions)
        const excludeIds = [viewerId, ...alreadyFollowing.map(f => f.followingId), ...blockedUserIds];

        const people = await prisma.user.findMany({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            id: { notIn: excludeIds },
          },
          select: {
            ...USER_SELECT,
            _count: { select: { followers: true } },
          },
          orderBy: [
            { followers: { _count: 'desc' } },  // most-followed first
            { createdAt: 'desc' },               // newest as tiebreaker
          ],
          take: 12,
        });
        return people;
      })(),
    ]);

    const result = {
      trendingPosts,
      trendingHashtags,
      suggestedCommunities,
      liveVoiceRooms,
      liveLiveClasses,
      suggestedPeople,
    };

    // Cache the result for 2 minutes
    try {
      const { isRedisReady, setCache } = require('../utils/redis');
      if (isRedisReady()) await setCache(`explore:feed:${viewerId}`, result, 120);
    } catch { /* non-fatal */ }

    return successResponse(res, result);
  } catch (e) { next(e); }
}

// ─── GET /explore/search — unified search across all content types ────────────
// PERFORMANCE FIX (L1): Now uses MySQL FULLTEXT MATCH AGAINST via search utility.
// Falls back to LIKE automatically if FULLTEXT indexes are not yet applied.
async function globalSearch(req, res, next) {
  try {
    const { q, type = 'all', limit = 20 } = req.query;
    const viewerId = req.user.id;

    if (!q || q.trim().length < 2) {
      return successResponse(res, { posts: [], people: [], communities: [], hashtags: [] });
    }

    const term = q.trim();
    const take = Math.min(30, parseInt(limit));
    const {
      searchPosts: ftPosts,
      searchUsers: ftUsers,
      searchCommunities: ftCommunities,
      searchHashtags: ftHashtags
    } = require('../utils/search');

    const [posts, rawPeople, rawCommunities, hashtags] = await Promise.all([
      (type === 'all' || type === 'posts')       ? ftPosts(prisma, term, viewerId, { take })       : [],
      (type === 'all' || type === 'people')      ? ftUsers(prisma, term, viewerId, take)            : [],
      (type === 'all' || type === 'communities') ? ftCommunities(prisma, term, take)                : [],
      (type === 'all' || type === 'hashtags')    ? ftHashtags(prisma, term, 10)                     : [],
    ]);

    // Enrich people with follow status
    let people = rawPeople;
    if (rawPeople.length > 0) {
      const userIds = rawPeople.map(u => u.id);
      const follows = await prisma.follow.findMany({
        where:  { followerId: viewerId, followingId: { in: userIds } },
        select: { followingId: true }
      });
      const followSet = new Set(follows.map(f => f.followingId));
      people = rawPeople.map(u => ({ ...u, isFollowing: followSet.has(u.id) }));
    }

    // Enrich communities with membership role
    let communities = rawCommunities;
    if (rawCommunities.length > 0) {
      const commIds = rawCommunities.map(c => c.id);
      const memberships = await prisma.communityMember.findMany({
        where:  { communityId: { in: commIds }, userId: viewerId },
        select: { communityId: true, role: true }
      });
      const memberMap = new Map(memberships.map(m => [m.communityId, m.role]));
      communities = rawCommunities.map(c => ({ ...c, myRole: memberMap.get(c.id) || null }));
    }

    return successResponse(res, { posts, people, communities, hashtags });
  } catch (e) { next(e); }
}

// ─── GET /explore/hashtag/:tag — posts for a specific hashtag ─────────────────
async function getHashtagFeed(req, res, next) {  try {
    const { tag }    = req.params;
    const { cursor, limit = 20 } = req.query;
    const take       = Math.min(50, parseInt(limit));
    const viewerId   = req.user.id;
    const name       = tag.toLowerCase().replace(/^#/, '');

    const hashtag = await prisma.hashtag.findUnique({ where: { name } });
    if (!hashtag) return successResponse(res, { hashtag: null, items: [], nextCursor: null, hasMore: false });

    const where = {
      deletedAt: null, isDraft: false, visibility: 'PUBLIC',
      hashtags: { some: { hashtagId: hashtag.id } }
    };
    if (cursor) where.createdAt = { lte: new Date(cursor.split('_')[0]) };

    const posts = await prisma.post.findMany({
      where,
      include: {
        author:    { select: USER_SELECT },
        media:     { orderBy: { orderIndex: 'asc' } },
        hashtags:  { include: { hashtag: { select: { id: true, name: true } } } },
        _count:    { select: { reactions: true, comments: true } },
        reactions: { where: { userId: viewerId }, select: { type: true } },
        bookmarks: { where: { userId: viewerId }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });

    const hasMore = posts.length > take;
    const items   = hasMore ? posts.slice(0, take) : posts;
    const nextCursor = hasMore && items.length > 0
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return successResponse(res, { hashtag, items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

module.exports = { getExploreFeed, globalSearch, getHashtagFeed };
