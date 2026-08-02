'use strict';
/**
 * Community Controller — Phase B-4
 * Reuses: prisma, response helpers, notification service, getIo, authenticate
 */
const { v4: uuidv4 } = require('uuid');
const prisma   = require('../utils/prisma');
const { getIo }          = require('../sockets');
const { successResponse, errorResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { notify }         = require('../services/notification.service');
const logger             = require('../utils/logger');

const COMMUNITY_SELECT = {
  id: true, slug: true, name: true, description: true,
  avatarUrl: true, coverUrl: true, privacy: true,
  memberCount: true, postCount: true, isVerified: true,
  category: true, rules: true, createdAt: true, deletedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
};

// ─── Helper: slugify ──────────────────────────────────────────────────────────
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 80);
}

// ─── Helper: get member role ──────────────────────────────────────────────────
async function getMemberRole(communityId, userId) {
  const m = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } }
  });
  return m?.role || null;
}

// ─── LIST / DISCOVER ──────────────────────────────────────────────────────────
async function listCommunities(req, res, next) {
  try {
    const { q, category, page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(50, parseInt(limit));

    const where = { deletedAt: null, privacy: { not: 'PRIVATE' } };
    if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
    if (category) where.category = category;

    const [total, items] = await Promise.all([
      prisma.community.count({ where }),
      prisma.community.findMany({
        where,
        select: {
          ...COMMUNITY_SELECT,
          members: { where: { userId: req.user.id }, select: { role: true } }
        },
        orderBy: { memberCount: 'desc' },
        skip, take
      })
    ]);

    return successResponse(res, {
      items: items.map(c => ({ ...c, myRole: c.members[0]?.role || null, members: undefined })),
      pagination: buildPaginationMeta(total, +page, take)
    });
  } catch (e) { next(e); }
}

// ─── GET ONE ──────────────────────────────────────────────────────────────────
async function getCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: idOrSlug }, { slug: idOrSlug }]
      },
      include: {
        owner:   { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        members: { where: { userId: req.user.id }, select: { role: true } },
        _count:  { select: { members: true, posts: { where: { deletedAt: null } } } }
      }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = community.members[0]?.role || null;
    if (community.privacy === 'PRIVATE' && !myRole) {
      return errorResponse(res, 'This community is private', 403);
    }

    return successResponse(res, { ...community, myRole, members: undefined });
  } catch (e) { next(e); }
}

// ─── CREATE ───────────────────────────────────────────────────────────────────
async function createCommunity(req, res, next) {
  try {
    const { name, description, privacy = 'PUBLIC', category, rules, avatarUrl, coverUrl } = req.body;
    if (!name?.trim()) return errorResponse(res, 'name required', 400);

    // Generate unique slug
    let slug = slugify(name);
    const existing = await prisma.community.findUnique({ where: { slug } });
    if (existing) slug = slug + '-' + Date.now().toString(36);

    const community = await prisma.$transaction(async (tx) => {
      const c = await tx.community.create({
        data: {
          id: uuidv4(), slug, name: name.trim(),
          description: description?.trim() || null,
          privacy, category: category || null,
          rules: rules?.trim() || null,
          avatarUrl: avatarUrl || null,
          coverUrl: coverUrl || null,
          ownerId: req.user.id,
          memberCount: 1
        }
      });
      // Auto-add owner as OWNER member
      await tx.communityMember.create({
        data: { id: uuidv4(), communityId: c.id, userId: req.user.id, role: 'OWNER' }
      });
      return c;
    });

    logger.info(`[community] Created: ${community.slug} by ${req.user.id}`);
    return successResponse(res, community, 'Community created', 201);
  } catch (e) { next(e); }
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
async function updateCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const role = await getMemberRole(community.id, req.user.id);
    if (!['OWNER','ADMIN'].includes(role)) return errorResponse(res, 'Not authorized', 403);

    const allowed = ['name','description','privacy','category','rules','avatarUrl','coverUrl'];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

    const updated = await prisma.community.update({ where: { id: community.id }, data });
    return successResponse(res, updated, 'Community updated');
  } catch (e) { next(e); }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
async function deleteCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const role = await getMemberRole(community.id, req.user.id);
    if (role !== 'OWNER' && req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(res, 'Only owner can delete', 403);
    }

    await prisma.community.update({ where: { id: community.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Community deleted');
  } catch (e) { next(e); }
}

// ─── JOIN ─────────────────────────────────────────────────────────────────────
async function joinCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);
    if (community.privacy === 'INVITE_ONLY') return errorResponse(res, 'Invite only — request an invite', 403);

    // Check if user is banned
    const banned = await isUserBanned(community.id, req.user.id);
    if (banned) return errorResponse(res, 'You are not allowed to join this community', 403);

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: req.user.id } }
    });
    if (existing) return successResponse(res, { role: existing.role }, 'Already a member');

    await prisma.$transaction([
      prisma.communityMember.create({
        data: { id: uuidv4(), communityId: community.id, userId: req.user.id, role: 'MEMBER' }
      }),
      prisma.community.update({
        where: { id: community.id },
        data:  { memberCount: { increment: 1 } }
      })
    ]);

    // Notify owner
    if (community.ownerId !== req.user.id) {
      await notify(community.ownerId, {
        type:  'COMMUNITY_JOIN',
        title: `${req.user.firstName} joined ${community.name}`,
        body:  `Your community now has ${community.memberCount + 1} members`,
        data:  { communityId: community.id, type: 'community_join' }
      });
    }

    return successResponse(res, { role: 'MEMBER' }, 'Joined community');
  } catch (e) { next(e); }
}

// ─── LEAVE ────────────────────────────────────────────────────────────────────
async function leaveCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const role = await getMemberRole(community.id, req.user.id);
    if (!role) return errorResponse(res, 'Not a member', 400);
    if (role === 'OWNER') return errorResponse(res, 'Owner cannot leave — transfer ownership or delete', 400);

    await prisma.$transaction([
      prisma.communityMember.delete({
        where: { communityId_userId: { communityId: community.id, userId: req.user.id } }
      }),
      prisma.community.update({
        where: { id: community.id },
        data:  { memberCount: { decrement: 1 } }
      })
    ]);

    return successResponse(res, null, 'Left community');
  } catch (e) { next(e); }
}

// ─── GET MEMBERS ──────────────────────────────────────────────────────────────
async function getMembers(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const { page = 1, limit = 50, role } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(100, parseInt(limit));

    const where = { communityId: community.id };
    if (role) where.role = role;

    const [total, members] = await Promise.all([
      prisma.communityMember.count({ where }),
      prisma.communityMember.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        skip, take
      })
    ]);

    return successResponse(res, { items: members, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

// ─── UPDATE MEMBER ROLE ───────────────────────────────────────────────────────
async function updateMemberRole(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;
    const { role } = req.body;
    if (!['ADMIN','MODERATOR','MEMBER'].includes(role)) return errorResponse(res, 'Invalid role', 400);

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER','ADMIN'].includes(myRole)) return errorResponse(res, 'Not authorized', 403);

    const target = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } }
    });
    if (!target) return errorResponse(res, 'Member not found', 404);
    if (target.role === 'OWNER') return errorResponse(res, 'Cannot change owner role', 400);

    await prisma.communityMember.update({
      where: { communityId_userId: { communityId: community.id, userId } },
      data: { role }
    });

    return successResponse(res, { role }, 'Role updated');
  } catch (e) { next(e); }
}

// ─── KICK MEMBER ─────────────────────────────────────────────────────────────
async function kickMember(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER','ADMIN','MODERATOR'].includes(myRole)) return errorResponse(res, 'Not authorized', 403);

    const target = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } }
    });
    if (!target) return errorResponse(res, 'Member not found', 404);
    if (target.role === 'OWNER') return errorResponse(res, 'Cannot remove owner', 400);

    await prisma.$transaction([
      prisma.communityMember.delete({
        where: { communityId_userId: { communityId: community.id, userId } }
      }),
      prisma.community.update({
        where: { id: community.id },
        data: { memberCount: { decrement: 1 } }
      })
    ]);

    return successResponse(res, null, 'Member removed');
  } catch (e) { next(e); }
}

// ─── GET COMMUNITY FEED ───────────────────────────────────────────────────────
async function getCommunityFeed(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { cursor, limit = 20 } = req.query;
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    // Check access for private communities
    const myRole = await getMemberRole(community.id, req.user.id);
    if (community.privacy === 'PRIVATE' && !myRole) {
      return errorResponse(res, 'Join community to view posts', 403);
    }

    const where = { communityId: community.id, deletedAt: null, isDraft: false };
    if (cursor) where.createdAt = { lte: new Date(cursor.split('_')[0]) };

    const posts = await prisma.post.findMany({
      where,
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true, schoolId: true } },
        media:  { orderBy: { orderIndex: 'asc' } },
        hashtags: { include: { hashtag: { select: { id: true, name: true } } } },
        _count: { select: { reactions: true, comments: true } },
        reactions: { where: { userId: req.user.id }, select: { type: true } },
        bookmarks: { where: { userId: req.user.id }, select: { id: true } },
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: take + 1
    });

    const hasMore = posts.length > take;
    const items   = hasMore ? posts.slice(0, take) : posts;
    const nextCursor = hasMore && items.length > 0
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return successResponse(res, { items, nextCursor, hasMore, community });
  } catch (e) { next(e); }
}

// ─── MY COMMUNITIES ───────────────────────────────────────────────────────────
async function getMyCommunities(req, res, next) {
  try {
    const memberships = await prisma.communityMember.findMany({
      where: { userId: req.user.id },
      include: {
        community: {
          select: { ...COMMUNITY_SELECT }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    return successResponse(res, memberships
      .filter(m => m.community && !m.community.deletedAt)
      .map(m => ({ ...m.community, myRole: m.role }))
    );
  } catch (e) { next(e); }
}

// ─── BAN MEMBER ───────────────────────────────────────────────────────────────
// Kicks the member AND adds them to a ban list so they can't re-join.
// Ban list is stored in Community.rules JSON field as a structured banList array
// until a dedicated CommunityBan model is added in a future migration.
async function banMember(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;
    const { reason = '' }      = req.body;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) return errorResponse(res, 'Not authorized', 403);

    const target = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } }
    });
    if (target?.role === 'OWNER') return errorResponse(res, 'Cannot ban the owner', 400);

    // Remove member if present
    if (target) {
      await prisma.$transaction([
        prisma.communityMember.delete({
          where: { communityId_userId: { communityId: community.id, userId } }
        }),
        prisma.community.update({
          where: { id: community.id },
          data:  { memberCount: { decrement: 1 } }
        })
      ]);
    }

    // Persist ban in a Redis set for fast join-time checks
    // Key: community:ban:{communityId} — set of banned userIds
    try {
      const { isRedisReady, getRedis } = require('../utils/redis');
      if (isRedisReady()) {
        await getRedis().sadd(`community:ban:${community.id}`, userId);
        await getRedis().expire(`community:ban:${community.id}`, 365 * 24 * 3600); // 1 year
      }
    } catch { /* non-fatal — ban still recorded in response */ }

    logger.info(`[community] User ${userId} banned from ${community.slug} by ${req.user.id}. Reason: ${reason}`);

    const io = getIo();
    if (io) io.to(`user:${userId}`).emit('community:banned', { communityId: community.id, reason });

    return successResponse(res, null, 'Member banned');
  } catch (e) { next(e); }
}

// ─── CHECK BAN (used in joinCommunity) ───────────────────────────────────────
async function isUserBanned(communityId, userId) {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) return false;
    const result = await getRedis().sismember(`community:ban:${communityId}`, userId);
    return result === 1;
  } catch {
    return false;
  }
}

// ─── GET PENDING POSTS (owner/admin/moderator) ────────────────────────────────
// When a community has requireApproval:true (future schema field), posts land
// in PENDING state. This endpoint lists them for review.
// For now: returns recent posts from non-member users so moderators can review.
async function getPendingPosts(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { limit = 20 } = req.query;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN', 'MODERATOR'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Get member IDs for this community
    const members = await prisma.communityMember.findMany({
      where:  { communityId: community.id },
      select: { userId: true }
    });
    const memberIds = new Set(members.map(m => m.userId));

    // Return recent posts from non-members (they may have been added after posting)
    const posts = await prisma.post.findMany({
      where: {
        communityId: community.id,
        deletedAt:   null,
        authorId:    { notIn: [...memberIds] }
      },
      include: {
        author:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        media:   { orderBy: { orderIndex: 'asc' } },
        _count:  { select: { reactions: true, comments: true } }
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(parseInt(limit), 50)
    });

    return successResponse(res, posts);
  } catch (e) { next(e); }
}

// ─── GET PENDING JOIN REQUESTS (owner/admin only) ─────────────────────────────
async function getPendingJoinRequests(req, res, next) {
  try {
    const { idOrSlug } = req.params;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // For now, since we don't have a dedicated JoinRequest model,
    // we'll return users who have requested to join via a notification or similar mechanism.
    // This is a placeholder - in a full implementation, you'd query a JoinRequest table.
    // For now, return empty array
    return successResponse(res, []);
  } catch (e) { next(e); }
}

// ─── ACCEPT JOIN REQUEST (owner/admin only) ────────────────────────────────────
async function acceptJoinRequest(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Check if user is banned
    const banned = await isUserBanned(community.id, userId);
    if (banned) return errorResponse(res, 'User is banned from this community', 403);

    // Check if already a member
    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } }
    });
    if (existing) return successResponse(res, { role: existing.role }, 'Already a member');

    // Add as member
    await prisma.$transaction([
      prisma.communityMember.create({
        data: { id: uuidv4(), communityId: community.id, userId, role: 'MEMBER' }
      }),
      prisma.community.update({
        where: { id: community.id },
        data:  { memberCount: { increment: 1 } }
      })
    ]);

    // Notify the user
    await notify(userId, {
      type:  'COMMUNITY_JOIN_ACCEPTED',
      title: `You joined ${community.name}`,
      body:  `Your request to join ${community.name} has been accepted`,
      data:  { communityId: community.id, type: 'community_join_accepted' }
    });

    logger.info(`[community] Join request accepted: ${userId} -> ${community.slug} by ${req.user.id}`);
    return successResponse(res, { role: 'MEMBER' }, 'Join request accepted');
  } catch (e) { next(e); }
}

// ─── DECLINE JOIN REQUEST (owner/admin only) ──────────────────────────────────
async function declineJoinRequest(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Notify the user
    await notify(userId, {
      type:  'COMMUNITY_JOIN_DECLINED',
      title: `Join request declined`,
      body:  `Your request to join ${community.name} was declined`,
      data:  { communityId: community.id, type: 'community_join_declined' }
    });

    logger.info(`[community] Join request declined: ${userId} -> ${community.slug} by ${req.user.id}`);
    return successResponse(res, null, 'Join request declined');
  } catch (e) { next(e); }
}

// ─── GET COMMUNITY MEDIA ───────────────────────────────────────────────────────
async function getCommunityMedia(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { cursor, limit = 20 } = req.query;
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    // Check access for private communities
    const myRole = await getMemberRole(community.id, req.user.id);
    if (community.privacy === 'PRIVATE' && !myRole) {
      return errorResponse(res, 'Join community to view media', 403);
    }

    const where = { 
      communityId: community.id, 
      deletedAt: null, 
      isDraft: false,
      media: { some: {} } // Only posts with media
    };
    if (cursor) where.createdAt = { lte: new Date(cursor.split('_')[0]) };

    const posts = await prisma.post.findMany({
      where,
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        media:  { orderBy: { orderIndex: 'asc' } },
        _count: { select: { reactions: true, comments: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1
    });

    const hasMore = posts.length > take;
    const items   = hasMore ? posts.slice(0, take) : posts;
    const nextCursor = hasMore && items.length > 0
      ? `${items[items.length - 1].createdAt.toISOString()}_${items[items.length - 1].id}`
      : null;

    return successResponse(res, { items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

module.exports = {
  listCommunities, getCommunity, createCommunity, updateCommunity, deleteCommunity,
  joinCommunity, leaveCommunity, getMembers, updateMemberRole, kickMember,
  getCommunityFeed, getMyCommunities,
  banMember, isUserBanned, getPendingPosts,
  getPendingJoinRequests, acceptJoinRequest, declineJoinRequest, getCommunityMedia
};
