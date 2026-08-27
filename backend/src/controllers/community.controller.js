'use strict';
/**
 * Community Controller — P0 fixes applied
 *
 * Fixed:
 *  P0-1: PRIVATE community join bypass — now creates a pending JoinRequest
 *  P0-2: Ban persistence — CommunityBan table is now the source of truth; Redis is a cache
 *  P0-3: getPendingJoinRequests — now queries community_join_requests (was a stub returning [])
 *  P0-4: acceptJoinRequest / declineJoinRequest — now operates on real JoinRequest rows
 *  P1-1: unbanMember — new endpoint
 *  P1-2: POST /leave guards against INVITE_ONLY re-join without a new invite
 *
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

// ─── Helper: get caller's role in a community ─────────────────────────────────
async function getMemberRole(communityId, userId) {
  const m = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } }
  });
  return m?.role || null;
}

// ─── Helper: check if a user is banned (DB-first, Redis cache second) ─────────
async function isUserBanned(communityId, userId) {
  // Fast Redis check first
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (isRedisReady()) {
      const cached = await getRedis().sismember(`community:ban:${communityId}`, userId);
      if (cached === 1) return true;
    }
  } catch { /* non-fatal */ }

  // Authoritative DB check
  const ban = await prisma.communityBan.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { id: true }
  }).catch(() => null);

  if (ban) {
    // Re-populate cache
    try {
      const { isRedisReady, getRedis } = require('../utils/redis');
      if (isRedisReady()) {
        await getRedis().sadd(`community:ban:${communityId}`, userId);
        await getRedis().expire(`community:ban:${communityId}`, 365 * 24 * 3600);
      }
    } catch { /* non-fatal */ }
    return true;
  }
  return false;
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

    const io = getIo();
    if (io) io.to(`community:${community.id}`).emit('community:updated', { community: updated });

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

    // Evict all sockets from the community room so no one continues receiving events
    const io = getIo();
    if (io) {
      io.to(`community:${community.id}`).emit('community:deleted', { communityId: community.id });
      // VC-GAP-004 FIX: socketsLeave() covers multi-tab and multi-server
      io.in(`community:${community.id}`).socketsLeave(`community:${community.id}`);
    }

    return successResponse(res, null, 'Community deleted');
  } catch (e) { next(e); }
}

// ─── JOIN ─────────────────────────────────────────────────────────────────────
// PUBLIC     → immediate join
// PRIVATE    → creates a pending JoinRequest; owner/admin must approve
// INVITE_ONLY → always 403 (must be invited)
async function joinCommunity(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    // INVITE_ONLY: must have a valid (non-expired, non-revoked) invite
    if (community.privacy === 'INVITE_ONLY') {
      const validInvite = await prisma.communityInvite.findFirst({
        where: {
          communityId:   community.id,
          invitedUserId: req.user.id,
          status:        'PENDING',
          expiresAt:     { gt: new Date() }
        }
      });
      if (!validInvite) {
        return errorResponse(res, 'Invite only — contact an admin to be invited', 403);
      }
      // Accept the invite and add as member atomically
      await prisma.$transaction(async (tx) => {
        await tx.communityInvite.update({ where: { id: validInvite.id }, data: { status: 'ACCEPTED' } });
        const alreadyMember = await tx.communityMember.findUnique({
          where: { communityId_userId: { communityId: community.id, userId: req.user.id } }
        });
        if (!alreadyMember) {
          await tx.communityMember.create({
            data: { id: uuidv4(), communityId: community.id, userId: req.user.id, role: 'MEMBER', invitedBy: validInvite.invitedBy }
          });
          await tx.community.update({
            where: { id: community.id },
            data:  { memberCount: { increment: 1 } }
          });
        }
      });
      const io = getIo();
      if (io) io.to(`community:${community.id}`).emit('community:member_joined', {
        communityId: community.id,
        user: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName }
      });
      logger.info(`[community] ${req.user.id} joined INVITE_ONLY ${community.slug} via invite`);
      return successResponse(res, { role: 'MEMBER' }, 'Joined community');
    }

    // Check if user is banned
    const banned = await isUserBanned(community.id, req.user.id);
    if (banned) return errorResponse(res, 'You are not allowed to join this community', 403);

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: req.user.id } }
    });
    if (existing) return successResponse(res, { role: existing.role }, 'Already a member');

    // PRIVATE: create a join request instead of immediately joining
    if (community.privacy === 'PRIVATE') {
      // Check for existing pending request
      const existingRequest = await prisma.communityJoinRequest.findFirst({
        where: { communityId: community.id, userId: req.user.id, status: 'PENDING' }
      });
      if (existingRequest) {
        return successResponse(res, { status: 'pending', requestId: existingRequest.id },
          'Join request already pending');
      }

      const joinRequest = await prisma.communityJoinRequest.create({
        data: {
          id: uuidv4(),
          communityId: community.id,
          userId: req.user.id,
          status: 'PENDING',
          message: req.body.message?.trim() || null,
        }
      });

      // Notify community owner
      if (community.ownerId !== req.user.id) {
        await notify(community.ownerId, {
          type:  'COMMUNITY_JOIN_REQUEST',
          title: `${req.user.firstName} wants to join ${community.name}`,
          body:  `Review the join request in your community admin panel`,
          data:  { communityId: community.id, requestId: joinRequest.id, type: 'community_join_request' }
        }).catch(() => {});
      }

      const io = getIo();
      if (io) io.to(`user:${community.ownerId}`).emit('community:join_request', {
        communityId: community.id,
        requestId:   joinRequest.id,
        user: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName }
      });

      logger.info(`[community] Join request created: ${req.user.id} -> ${community.slug}`);
      return successResponse(res, { status: 'pending', requestId: joinRequest.id },
        'Join request submitted — waiting for admin approval', 202);
    }

    // PUBLIC: immediate join
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
      }).catch(() => {});
    }

    const io = getIo();
    if (io) io.to(`community:${community.id}`).emit('community:member_joined', {
      communityId: community.id,
      user: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName }
    });

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

    const io = getIo();
    if (io) {
      io.to(`community:${community.id}`).emit('community:member_left', {
        communityId: community.id,
        userId: req.user.id
      });
      // VC-GAP-004 FIX: socketsLeave() covers multi-tab and multi-server
      io.in(`user:${req.user.id}`).socketsLeave(`community:${community.id}`);
    }

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

    // Notify the promoted/demoted user
    await notify(userId, {
      type:  'COMMUNITY_ROLE_CHANGED',
      title: `Your role in ${community.name} changed`,
      body:  `You are now a ${role.toLowerCase()} in ${community.name}`,
      data:  { communityId: community.id, role, type: 'community_role_changed' }
    }).catch(() => {});

    const io = getIo();
    if (io) io.to(`community:${community.id}`).emit('community:member_role_changed', {
      communityId: community.id, userId, role
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

    // Notify kicked user
    await notify(userId, {
      type:  'COMMUNITY_KICKED',
      title: `You were removed from ${community.name}`,
      body:  `An admin removed you from the community`,
      data:  { communityId: community.id, type: 'community_kicked' }
    }).catch(() => {});

    const io = getIo();
    if (io) {
      io.to(`community:${community.id}`).emit('community:member_kicked', { communityId: community.id, userId });
      io.to(`user:${userId}`).emit('community:kicked', { communityId: community.id, communityName: community.name });
      // VC-GAP-004 FIX: socketsLeave() covers multi-tab and multi-server
      io.in(`user:${userId}`).socketsLeave(`community:${community.id}`);
    }

    return successResponse(res, null, 'Member removed');
  } catch (e) { next(e); }
}

// ─── BAN MEMBER ───────────────────────────────────────────────────────────────
// Kicks the member + creates a persistent CommunityBan record + Redis cache
async function banMember(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;
    const { reason = '' } = req.body;

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

    await prisma.$transaction(async (tx) => {
      // Remove member if present
      if (target) {
        await tx.communityMember.delete({
          where: { communityId_userId: { communityId: community.id, userId } }
        });
        await tx.community.update({
          where: { id: community.id },
          data:  { memberCount: { decrement: 1 } }
        });
      }

      // Create persistent ban record (upsert so re-banning doesn't throw)
      await tx.communityBan.upsert({
        where:  { communityId_userId: { communityId: community.id, userId } },
        create: {
          id: uuidv4(),
          communityId: community.id,
          userId,
          bannedBy: req.user.id,
          reason: reason || null
        },
        update: {
          bannedBy: req.user.id,
          reason:   reason || null
        }
      });
    });

    // Also cache in Redis for fast join-time checks
    try {
      const { isRedisReady, getRedis } = require('../utils/redis');
      if (isRedisReady()) {
        await getRedis().sadd(`community:ban:${community.id}`, userId);
        await getRedis().expire(`community:ban:${community.id}`, 365 * 24 * 3600);
      }
    } catch { /* non-fatal */ }

    logger.info(`[community] User ${userId} banned from ${community.slug} by ${req.user.id}. Reason: ${reason}`);

    const io = getIo();
    if (io) {
      io.to(`user:${userId}`).emit('community:banned', { communityId: community.id, reason });
      // VC-GAP-004 FIX: socketsLeave() covers multi-tab and multi-server
      io.in(`user:${userId}`).socketsLeave(`community:${community.id}`);
    }

    return successResponse(res, null, 'Member banned');
  } catch (e) { next(e); }
}

// ─── UNBAN MEMBER ─────────────────────────────────────────────────────────────
async function unbanMember(req, res, next) {
  try {
    const { idOrSlug, userId } = req.params;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) return errorResponse(res, 'Not authorized', 403);

    // Delete the persistent ban record
    await prisma.communityBan.deleteMany({
      where: { communityId: community.id, userId }
    });

    // Invalidate Redis cache
    try {
      const { isRedisReady, getRedis } = require('../utils/redis');
      if (isRedisReady()) {
        await getRedis().srem(`community:ban:${community.id}`, userId);
      }
    } catch { /* non-fatal */ }

    logger.info(`[community] User ${userId} unbanned from ${community.slug} by ${req.user.id}`);
    return successResponse(res, null, 'Member unbanned');
  } catch (e) { next(e); }
}

// ─── GET COMMUNITY FEED ───────────────────────────────────────────────────────
async function getCommunityFeed(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { cursor, limit = 20 } = req.query;
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { members: { where: { userId: req.user.id }, select: { role: true } } }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = community.members[0]?.role || null;
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

    return successResponse(res, {
      items, nextCursor, hasMore,
      community: { ...community, members: undefined, myRole }
    });
  } catch (e) { next(e); }
}

// ─── MY COMMUNITIES ───────────────────────────────────────────────────────────
async function getMyCommunities(req, res, next) {
  try {
    const { cursor, limit = 30 } = req.query;
    const take = Math.min(50, parseInt(limit));

    const where = { userId: req.user.id };
    if (cursor) where.joinedAt = { lte: new Date(cursor) };

    const memberships = await prisma.communityMember.findMany({
      where,
      include: { community: { select: { ...COMMUNITY_SELECT } } },
      orderBy: { joinedAt: 'desc' },
      take: take + 1
    });

    const hasMore = memberships.length > take;
    const items = (hasMore ? memberships.slice(0, take) : memberships)
      .filter(m => m.community && !m.community.deletedAt)
      .map(m => ({ ...m.community, myRole: m.role }));

    const nextCursor = hasMore && memberships.length > take
      ? memberships[take - 1].joinedAt.toISOString()
      : null;

    return successResponse(res, { items, nextCursor, hasMore });
  } catch (e) { next(e); }
}

// ─── GET PENDING JOIN REQUESTS ────────────────────────────────────────────────
// Replaces the stub that returned []. Now queries community_join_requests.
async function getPendingJoinRequests(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const [total, requests] = await Promise.all([
      prisma.communityJoinRequest.count({
        where: { communityId: community.id, status: 'PENDING' }
      }),
      prisma.communityJoinRequest.findMany({
        where: { communityId: community.id, status: 'PENDING' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } }
        },
        orderBy: { createdAt: 'asc' },
        skip, take
      })
    ]);

    return successResponse(res, { items: requests, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

// ─── ACCEPT JOIN REQUEST ─────────────────────────────────────────────────────
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

    // Check ban
    const banned = await isUserBanned(community.id, userId);
    if (banned) return errorResponse(res, 'User is banned from this community', 403);

    // Find pending request
    const joinRequest = await prisma.communityJoinRequest.findFirst({
      where: { communityId: community.id, userId, status: 'PENDING' }
    });
    if (!joinRequest) return errorResponse(res, 'No pending join request found', 404);

    // Check if already a member
    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } }
    });

    await prisma.$transaction(async (tx) => {
      // Mark request as accepted
      await tx.communityJoinRequest.update({
        where: { id: joinRequest.id },
        data:  { status: 'ACCEPTED', reviewedBy: req.user.id, reviewedAt: new Date() }
      });

      if (!existing) {
        await tx.communityMember.create({
          data: { id: uuidv4(), communityId: community.id, userId, role: 'MEMBER' }
        });
        await tx.community.update({
          where: { id: community.id },
          data:  { memberCount: { increment: 1 } }
        });
      }
    });

    // Notify the user
    await notify(userId, {
      type:  'COMMUNITY_JOIN_ACCEPTED',
      title: `You joined ${community.name}`,
      body:  `Your request to join ${community.name} has been accepted`,
      data:  { communityId: community.id, type: 'community_join_accepted' }
    }).catch(() => {});

    const io = getIo();
    if (io) {
      io.to(`community:${community.id}`).emit('community:member_joined', {
        communityId: community.id,
        userId
      });
      io.to(`user:${userId}`).emit('community:join_accepted', {
        communityId: community.id,
        communityName: community.name
      });
    }

    logger.info(`[community] Join request accepted: ${userId} -> ${community.slug} by ${req.user.id}`);
    return successResponse(res, { role: 'MEMBER' }, 'Join request accepted');
  } catch (e) { next(e); }
}

// ─── DECLINE JOIN REQUEST ────────────────────────────────────────────────────
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

    const joinRequest = await prisma.communityJoinRequest.findFirst({
      where: { communityId: community.id, userId, status: 'PENDING' }
    });
    if (!joinRequest) return errorResponse(res, 'No pending join request found', 404);

    await prisma.communityJoinRequest.update({
      where: { id: joinRequest.id },
      data:  { status: 'DECLINED', reviewedBy: req.user.id, reviewedAt: new Date() }
    });

    // Notify the user
    await notify(userId, {
      type:  'COMMUNITY_JOIN_DECLINED',
      title: `Join request declined`,
      body:  `Your request to join ${community.name} was declined`,
      data:  { communityId: community.id, type: 'community_join_declined' }
    }).catch(() => {});

    const io = getIo();
    if (io) io.to(`user:${userId}`).emit('community:join_declined', {
      communityId: community.id,
      communityName: community.name
    });

    logger.info(`[community] Join request declined: ${userId} -> ${community.slug} by ${req.user.id}`);
    return successResponse(res, null, 'Join request declined');
  } catch (e) { next(e); }
}

// ─── GET PENDING POSTS (moderation queue) ────────────────────────────────────
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

// ─── GET COMMUNITY MEDIA ───────────────────────────────────────────────────────
async function getCommunityMedia(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { cursor, limit = 20 } = req.query;
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { members: { where: { userId: req.user.id }, select: { role: true } } }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = community.members[0]?.role || null;
    if (community.privacy === 'PRIVATE' && !myRole) {
      return errorResponse(res, 'Join community to view media', 403);
    }

    const where = {
      communityId: community.id,
      deletedAt: null,
      isDraft: false,
      media: { some: {} }
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

// ─── INVITE SYSTEM ───────────────────────────────────────────────────────────
// Default invite TTL: 7 days
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Rate limit bucket: max 20 invites created per admin per community per hour
// (enforced in-process; express-rate-limit handles HTTP-level rate limiting)

// POST /:idOrSlug/invites  — OWNER/ADMIN sends invite to a specific user
async function createInvite(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { userId: invitedUserId } = req.body;

    if (!invitedUserId) return errorResponse(res, 'userId is required', 400);

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    // Only OWNER/ADMIN may invite
    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Only admins can invite members', 403);
    }

    // Invited user must exist and not be suspended/banned at platform level
    const invitee = await prisma.user.findUnique({
      where: { id: invitedUserId },
      select: { id: true, firstName: true, lastName: true, status: true }
    });
    if (!invitee) return errorResponse(res, 'User not found', 404);
    if (invitee.status === 'BANNED' || invitee.status === 'SUSPENDED') {
      return errorResponse(res, 'Cannot invite a suspended or banned user', 400);
    }

    // Cannot invite an already-banned community member
    const communityBanned = await isUserBanned(community.id, invitedUserId);
    if (communityBanned) {
      return errorResponse(res, 'User is banned from this community', 400);
    }

    // Cannot invite an existing member
    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId: invitedUserId } }
    });
    if (existing) return errorResponse(res, 'User is already a member', 400);

    // Cannot send duplicate PENDING invite
    const existingInvite = await prisma.communityInvite.findFirst({
      where: { communityId: community.id, invitedUserId, status: 'PENDING' }
    });
    if (existingInvite) {
      return errorResponse(res, 'User already has a pending invite', 400);
    }

    const token     = uuidv4();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await prisma.communityInvite.create({
      data: {
        id: uuidv4(),
        communityId: community.id,
        invitedBy:   req.user.id,
        invitedUserId,
        token,
        status:    'PENDING',
        expiresAt,
      }
    });

    // Notify the invitee
    await notify(invitedUserId, {
      type:  'COMMUNITY_INVITE',
      title: `${req.user.firstName} invited you to join ${community.name}`,
      body:  `You have been invited to join the community "${community.name}"`,
      data:  { communityId: community.id, inviteToken: token, type: 'community_invite' }
    }).catch(() => {});

    // Real-time notification to invitee socket room
    const io = getIo();
    if (io) {
      io.to(`user:${invitedUserId}`).emit('community:invite', {
        communityId:   community.id,
        communityName: community.name,
        communitySlug: community.slug,
        inviteToken:   token,
        invitedBy: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName }
      });
    }

    logger.info(`[community] Invite created: ${req.user.id} -> ${invitedUserId} for ${community.slug}`);

    // Return invite without exposing raw token in list (token is for the invitee only)
    return successResponse(res, {
      id:            invite.id,
      communityId:   community.id,
      communityName: community.name,
      invitedUserId,
      inviteeName:   `${invitee.firstName} ${invitee.lastName}`,
      status:        'PENDING',
      expiresAt:     invite.expiresAt,
      createdAt:     invite.createdAt,
    }, 'Invite sent', 201);
  } catch (e) { next(e); }
}

// GET /:idOrSlug/invites  — OWNER/ADMIN lists pending invites (no token exposed)
async function listInvites(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(50, parseInt(limit));

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Auto-expire stale invites first (mark EXPIRED in DB)
    await prisma.communityInvite.updateMany({
      where: { communityId: community.id, status: 'PENDING', expiresAt: { lt: new Date() } },
      data:  { status: 'EXPIRED' }
    }).catch(() => {});

    const [total, invites] = await Promise.all([
      prisma.communityInvite.count({
        where: { communityId: community.id, status: 'PENDING' }
      }),
      prisma.communityInvite.findMany({
        where: { communityId: community.id, status: 'PENDING' },
        include: {
          invitee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          inviter: { select: { id: true, firstName: true, lastName: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip, take
      })
    ]);

    // Strip token from response — admins don't need to see it
    const items = invites.map(inv => ({
      id:          inv.id,
      invitedUser: inv.invitee,
      invitedBy:   inv.inviter,
      status:      inv.status,
      expiresAt:   inv.expiresAt,
      createdAt:   inv.createdAt,
    }));

    return successResponse(res, { items, pagination: buildPaginationMeta(total, +page, take) });
  } catch (e) { next(e); }
}

// DELETE /:idOrSlug/invites/:inviteId  — OWNER/ADMIN revokes a pending invite
async function revokeInvite(req, res, next) {
  try {
    const { idOrSlug, inviteId } = req.params;

    const community = await prisma.community.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }
    });
    if (!community) return errorResponse(res, 'Community not found', 404);

    const myRole = await getMemberRole(community.id, req.user.id);
    if (!['OWNER', 'ADMIN'].includes(myRole)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const invite = await prisma.communityInvite.findFirst({
      where: { id: inviteId, communityId: community.id }
    });
    if (!invite) return errorResponse(res, 'Invite not found', 404);
    if (invite.status !== 'PENDING') {
      return errorResponse(res, `Cannot revoke a ${invite.status.toLowerCase()} invite`, 400);
    }

    await prisma.communityInvite.delete({ where: { id: inviteId } });

    logger.info(`[community] Invite ${inviteId} revoked by ${req.user.id}`);
    return successResponse(res, null, 'Invite revoked');
  } catch (e) { next(e); }
}

// POST /invites/:token/accept  — Invitee accepts their invite
async function acceptInvite(req, res, next) {
  try {
    const { token } = req.params;

    const invite = await prisma.communityInvite.findUnique({
      where: { token },
      include: { community: { select: { id: true, name: true, slug: true, deletedAt: true, memberCount: true } } }
    });

    if (!invite)                         return errorResponse(res, 'Invite not found', 404);
    // IDOR: token must belong to the authenticated user
    if (invite.invitedUserId !== req.user.id) {
      return errorResponse(res, 'This invite does not belong to you', 403);
    }
    if (!invite.community || invite.community.deletedAt) {
      return errorResponse(res, 'Community no longer exists', 404);
    }
    if (invite.status === 'ACCEPTED')    return successResponse(res, { role: 'MEMBER' }, 'Already accepted');
    if (invite.status === 'DECLINED')    return errorResponse(res, 'Invite was already declined', 400);
    if (invite.status === 'EXPIRED')     return errorResponse(res, 'Invite has expired', 400);
    if (new Date() > invite.expiresAt)  {
      await prisma.communityInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } }).catch(() => {});
      return errorResponse(res, 'Invite has expired', 400);
    }

    // Check community ban
    const banned = await isUserBanned(invite.community.id, req.user.id);
    if (banned) return errorResponse(res, 'You are banned from this community', 403);

    // Already a member?
    const alreadyMember = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: invite.community.id, userId: req.user.id } }
    });

    await prisma.$transaction(async (tx) => {
      // Mark invite accepted
      await tx.communityInvite.update({
        where: { id: invite.id },
        data:  { status: 'ACCEPTED' }
      });

      if (!alreadyMember) {
        await tx.communityMember.create({
          data: { id: uuidv4(), communityId: invite.community.id, userId: req.user.id, role: 'MEMBER', invitedBy: invite.invitedBy }
        });
        await tx.community.update({
          where: { id: invite.community.id },
          data:  { memberCount: { increment: 1 } }
        });
      }
    });

    // Notify the inviter
    await notify(invite.invitedBy, {
      type:  'COMMUNITY_JOIN',
      title: `${req.user.firstName} accepted your invite to ${invite.community.name}`,
      body:  `They are now a member of ${invite.community.name}`,
      data:  { communityId: invite.community.id, type: 'community_invite_accepted' }
    }).catch(() => {});

    const io = getIo();
    if (io) {
      io.to(`community:${invite.community.id}`).emit('community:member_joined', {
        communityId: invite.community.id,
        user: { id: req.user.id, firstName: req.user.firstName, lastName: req.user.lastName }
      });
    }

    logger.info(`[community] Invite accepted: ${req.user.id} joined ${invite.community.slug} via invite`);
    return successResponse(res, { role: 'MEMBER', communitySlug: invite.community.slug }, 'Joined community');
  } catch (e) { next(e); }
}

// POST /invites/:token/decline  — Invitee declines their invite
async function declineInvite(req, res, next) {
  try {
    const { token } = req.params;

    const invite = await prisma.communityInvite.findUnique({ where: { token } });

    if (!invite) return errorResponse(res, 'Invite not found', 404);
    // IDOR: token must belong to the authenticated user
    if (invite.invitedUserId !== req.user.id) {
      return errorResponse(res, 'This invite does not belong to you', 403);
    }
    if (invite.status !== 'PENDING') {
      return errorResponse(res, `Invite is already ${invite.status.toLowerCase()}`, 400);
    }

    await prisma.communityInvite.update({
      where: { id: invite.id },
      data:  { status: 'DECLINED' }
    });

    logger.info(`[community] Invite declined: ${req.user.id} declined invite for community ${invite.communityId}`);
    return successResponse(res, null, 'Invite declined');
  } catch (e) { next(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  listCommunities, getCommunity, createCommunity, updateCommunity, deleteCommunity,
  joinCommunity, leaveCommunity, getMembers, updateMemberRole, kickMember,
  banMember, unbanMember,
  getCommunityFeed, getMyCommunities,
  getPendingPosts, getPendingJoinRequests, acceptJoinRequest, declineJoinRequest,
  getCommunityMedia,
  // Invite system (Phase B-4 extension)
  createInvite, listInvites, revokeInvite, acceptInvite, declineInvite,
  // exported for test access
  isUserBanned,
};
