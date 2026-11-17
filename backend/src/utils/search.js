'use strict';
/**
 * Full-Text Search Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps MySQL MATCH AGAINST for Prisma raw queries.
 *
 * MySQL FULLTEXT rules:
 *   - Minimum word length: 3 chars (default ft_min_word_len = 3)
 *   - Queries shorter than 3 chars fall back to LIKE
 *   - IN BOOLEAN MODE: supports +word (required), -word (excluded), "phrase"
 *   - Stopwords (the, a, is etc.) are ignored — use raw LIKE for these
 *
 * Usage:
 *   const { searchPosts } = require('./search');
 *   const results = await searchPosts(prisma, term, viewerId, { take: 20 });
 * ─────────────────────────────────────────────────────────────────────────────
 */

const logger = require('./logger');

/**
 * Sanitize a search term for use in MySQL FULLTEXT BOOLEAN MODE.
 * Removes characters that break the parser, keeps alphanumeric + spaces.
 * Returns null if the term is too short or empty after sanitization.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function sanitizeSearchTerm(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/[+\-><()~*"@]/g, ' ')  // remove BOOLEAN MODE operators
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * Build a MySQL FULLTEXT BOOLEAN MODE query string.
 * Splits the term into words and adds '+' prefix so all words must match.
 *
 * @param {string} term
 * @returns {string}  e.g. "+quran +memorization"
 */
function toBooleanQuery(term) {
  return term
    .split(' ')
    .filter(w => w.length >= 2)
    .map(w => `+${w}*`)   // prefix wildcard: "quran*" matches "quranic"
    .join(' ');
}

// ─── Posts ────────────────────────────────────────────────────────────────────

/**
 * Full-text search across post bodies.
 * Falls back to LIKE for very short terms.
 *
 * CF-20 FIX: Added allowedCommunityIds parameter. Posts belonging to
 * PRIVATE or INVITE_ONLY communities are now excluded unless the viewer
 * is a member. The caller (searchPosts controller) pre-computes this list
 * and passes it in. Posts with communityId IS NULL are always included.
 *
 * @param {PrismaClient} prisma
 * @param {string}       term
 * @param {string}       viewerId          — for visibility filter
 * @param {object}       opts              — { take, before, allowedCommunityIds }
 * @param {string[]}     opts.allowedCommunityIds — community IDs the viewer may access
 */
async function searchPosts(prisma, term, viewerId, { take = 20, before, allowedCommunityIds = [], blockedAuthorIds = [] } = {}) {
  const clean = sanitizeSearchTerm(term);
  if (!clean) return [];

  const boolQuery = toBooleanQuery(clean);

  // CF-20: Build the community filter clause for the raw SQL query.
  // If allowedCommunityIds is non-empty, allow posts with no community OR
  // posts whose communityId is in the allowed set.
  // If empty (viewer has no memberships and no public communities exist),
  // only allow posts with communityId IS NULL.
  const { Prisma } = require('@prisma/client');
  const communityClause = allowedCommunityIds.length > 0
    ? Prisma.sql`AND (communityId IS NULL OR communityId IN (${Prisma.join(allowedCommunityIds)}))`
    : Prisma.sql`AND communityId IS NULL`;

  // P1-03: Exclude posts from blocked authors (both block directions resolved by
  // the caller). Guarded so the clause is empty when there are no blocks, avoiding
  // an invalid `IN ()` SQL expression. Applied to BOTH the FULLTEXT and LIKE paths.
  const blockedAuthorClause = blockedAuthorIds.length > 0
    ? Prisma.sql`AND authorId NOT IN (${Prisma.join(blockedAuthorIds)})`
    : Prisma.sql``;

  try {
    // MATCH AGAINST with BOOLEAN MODE — uses FULLTEXT index
    const raw = await prisma.$queryRaw`
      SELECT id FROM posts
      WHERE deletedAt IS NULL
        AND isDraft = 0
        AND visibility = 'PUBLIC'
        ${communityClause}
        ${blockedAuthorClause}
        AND MATCH(body) AGAINST(${boolQuery} IN BOOLEAN MODE)
        ${before ? Prisma.sql`AND createdAt < ${new Date(before)}` : Prisma.sql``}
      ORDER BY MATCH(body) AGAINST(${boolQuery} IN BOOLEAN MODE) DESC,
               createdAt DESC
      LIMIT ${take}
    `;

    const ids = raw.map(r => r.id);
    if (!ids.length) return [];

    // Fetch full post objects maintaining relevance order
    const posts = await prisma.post.findMany({
      where: { id: { in: ids } },
      include: {
        author:       { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
        media:        { orderBy: { orderIndex: 'asc' } },
        hashtags:     { include: { hashtag: { select: { id: true, name: true } } } },
        community:    { select: { id: true, slug: true, name: true } },
        _count:       { select: { reactions: true, comments: true } },
        reactions:    { where: { userId: viewerId }, select: { type: true } },
        bookmarks:    { where: { userId: viewerId }, select: { id: true } },
        originalPost: { select: {
          // Authorization scalars (required by filterOriginalPost)
          id:          true,
          authorId:    true,
          visibility:  true,
          isDraft:     true,
          deletedAt:   true,
          isExclusive: true,
          communityId: true,
          schoolId:    true,
          // Display scalars
          type:            true,
          body:            true,
          quotedBody:      true,
          linkUrl:         true,
          linkTitle:       true,
          linkDescription: true,
          linkImage:       true,
          pollData:        true,
          createdAt:       true,
          // Relations
          author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
          media:  { orderBy: { orderIndex: 'asc' } },
        }},
      }
    });

    // Re-sort to match relevance order from raw query
    const order = new Map(ids.map((id, i) => [id, i]));
    return posts.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  } catch (err) {
    // FULLTEXT index may not exist in dev — fall back to LIKE
    logger.warn(`[search:posts] FULLTEXT failed, falling back to LIKE: ${err.message}`);

    // CF-20: Apply community gate in the LIKE fallback as well.
    const communityWhere = allowedCommunityIds.length > 0
      ? { OR: [{ communityId: null }, { communityId: { in: allowedCommunityIds } }] }
      : { communityId: null };

    // P1-03: Exclude blocked authors in the LIKE fallback (mirrors the FULLTEXT path).
    const likeWhere = {
      deletedAt:  null,
      isDraft:    false,
      visibility: 'PUBLIC',
      body:       { contains: clean },
      AND: [communityWhere],
    };
    if (blockedAuthorIds.length > 0) {
      likeWhere.NOT = { authorId: { in: blockedAuthorIds } };
    }

    return prisma.post.findMany({
      where: likeWhere,
      include: {
        author:       { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
        media:        { orderBy: { orderIndex: 'asc' } },
        _count:       { select: { reactions: true, comments: true } },
        reactions:    { where: { userId: viewerId }, select: { type: true } },
        bookmarks:    { where: { userId: viewerId }, select: { id: true } },
        originalPost: { select: {
          // Authorization scalars (required by filterOriginalPost)
          id:          true,
          authorId:    true,
          visibility:  true,
          isDraft:     true,
          deletedAt:   true,
          isExclusive: true,
          communityId: true,
          schoolId:    true,
          // Display scalars
          type:            true,
          body:            true,
          quotedBody:      true,
          linkUrl:         true,
          linkTitle:       true,
          linkDescription: true,
          linkImage:       true,
          pollData:        true,
          createdAt:       true,
          // Relations
          author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
          media:  { orderBy: { orderIndex: 'asc' } },
        }},
      },
      orderBy: { createdAt: 'desc' },
      take
    });
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * Full-text search across user names.
 *
 * @param {PrismaClient} prisma
 * @param {string}       term
 * @param {string}       excludeId  — viewer's own ID
 * @param {number}       take
 */
async function searchUsers(prisma, term, excludeId, take = 20) {
  const clean = sanitizeSearchTerm(term);
  if (!clean) return [];

  const boolQuery = toBooleanQuery(clean);

  try {
    const raw = await prisma.$queryRaw`
      SELECT id FROM users
      WHERE deletedAt IS NULL
        AND status = 'ACTIVE'
        AND id != ${excludeId}
        AND MATCH(firstName, lastName) AGAINST(${boolQuery} IN BOOLEAN MODE)
      ORDER BY MATCH(firstName, lastName) AGAINST(${boolQuery} IN BOOLEAN MODE) DESC
      LIMIT ${take}
    `;

    const ids = raw.map(r => r.id);
    if (!ids.length) return [];

    return prisma.user.findMany({
      where:  { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true, bio: true, username: true }
    });

  } catch (err) {
    logger.warn(`[search:users] FULLTEXT failed, falling back to LIKE: ${err.message}`);
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        status:    'ACTIVE',
        id:        { not: excludeId },
        OR: [
          { firstName: { contains: clean } },
          { lastName:  { contains: clean } }
        ]
      },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true, bio: true, username: true },
      take
    });
  }
}

// ─── Communities ─────────────────────────────────────────────────────────────

/**
 * Full-text search across community names and descriptions.
 *
 * @param {PrismaClient} prisma
 * @param {string}       term
 * @param {number}       take
 */
async function searchCommunities(prisma, term, take = 20) {
  const clean = sanitizeSearchTerm(term);
  if (!clean) return [];

  const boolQuery = toBooleanQuery(clean);

  try {
    const raw = await prisma.$queryRaw`
      SELECT id FROM communities
      WHERE deletedAt IS NULL
        AND privacy != 'PRIVATE'
        AND MATCH(name, description) AGAINST(${boolQuery} IN BOOLEAN MODE)
      ORDER BY MATCH(name, description) AGAINST(${boolQuery} IN BOOLEAN MODE) DESC,
               memberCount DESC
      LIMIT ${take}
    `;

    const ids = raw.map(r => r.id);
    if (!ids.length) return [];

    return prisma.community.findMany({
      where:  { id: { in: ids } },
      select: {
        id: true, slug: true, name: true, description: true,
        avatarUrl: true, memberCount: true, category: true, isVerified: true,
        owner: { select: { id: true, firstName: true, lastName: true } }
      }
    });

  } catch (err) {
    logger.warn(`[search:communities] FULLTEXT failed, falling back to LIKE: ${err.message}`);
    return prisma.community.findMany({
      where: {
        deletedAt: null,
        privacy:   { not: 'PRIVATE' },
        OR: [{ name: { contains: clean } }, { description: { contains: clean } }]
      },
      select: {
        id: true, slug: true, name: true, description: true,
        avatarUrl: true, memberCount: true, category: true, isVerified: true
      },
      orderBy: { memberCount: 'desc' },
      take
    });
  }
}

// ─── Voice Rooms ─────────────────────────────────────────────────────────────

/**
 * Full-text search across voice room titles, topics, and descriptions.
 *
 * @param {PrismaClient} prisma
 * @param {string}       term
 * @param {number}       take
 */
async function searchVoiceRooms(prisma, term, take = 20) {
  const clean = sanitizeSearchTerm(term);
  if (!clean) return [];

  const boolQuery = toBooleanQuery(clean);

  try {
    const raw = await prisma.$queryRaw`
      SELECT id FROM voice_rooms
      WHERE deletedAt IS NULL
        AND status != 'ENDED'
        AND MATCH(title, topic, description) AGAINST(${boolQuery} IN BOOLEAN MODE)
      ORDER BY MATCH(title, topic, description) AGAINST(${boolQuery} IN BOOLEAN MODE) DESC,
               lastActivityAt DESC
      LIMIT ${take}
    `;

    const ids = raw.map(r => r.id);
    if (!ids.length) return [];

    return prisma.voiceRoom.findMany({
      where:   { id: { in: ids } },
      include: {
        host:   { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { participants: { where: { isActive: true } } } }
      }
    });

  } catch (err) {
    logger.warn(`[search:voiceRooms] FULLTEXT failed, falling back to LIKE: ${err.message}`);
    return prisma.voiceRoom.findMany({
      where: {
        deletedAt: null,
        status:    { not: 'ENDED' },
        OR: [
          { title:       { contains: clean } },
          { topic:       { contains: clean } },
          { description: { contains: clean } }
        ]
      },
      include: {
        host:   { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { participants: { where: { isActive: true } } } }
      },
      orderBy: { lastActivityAt: 'desc' },
      take
    });
  }
}

// ─── Hashtags ─────────────────────────────────────────────────────────────────

/**
 * Full-text search across hashtag names.
 *
 * @param {PrismaClient} prisma
 * @param {string}       term
 * @param {number}       take
 */
async function searchHashtags(prisma, term, take = 10) {
  const clean = sanitizeSearchTerm(term.replace(/^#/, '').toLowerCase());
  if (!clean) return [];

  try {
    const boolQuery = toBooleanQuery(clean);
    const raw = await prisma.$queryRaw`
      SELECT id FROM hashtags
      WHERE MATCH(name) AGAINST(${boolQuery} IN BOOLEAN MODE)
      ORDER BY postCount DESC
      LIMIT ${take}
    `;

    const ids = raw.map(r => r.id);
    if (!ids.length) return [];

    return prisma.hashtag.findMany({
      where:   { id: { in: ids } },
      orderBy: { postCount: 'desc' }
    });

  } catch (err) {
    logger.warn(`[search:hashtags] FULLTEXT failed, falling back to LIKE: ${err.message}`);
    return prisma.hashtag.findMany({
      where:   { name: { contains: clean } },
      orderBy: { postCount: 'desc' },
      take
    });
  }
}

module.exports = {
  sanitizeSearchTerm,
  searchPosts,
  searchUsers,
  searchCommunities,
  searchVoiceRooms,
  searchHashtags
};
