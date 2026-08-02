/**
 * Voice Room Member Controller — Full TikTok/BIGO-style
 * Permanent membership with roles, online status, join requests, invites
 *
 * Roles (highest→lowest): OWNER > CO_OWNER > ADMIN > MODERATOR > VIP > OFFICIAL > MEMBER > BLOCKED
 * Status: PENDING | ACTIVE | REMOVED
 *
 * Room levels 1-10 control max permanent members:
 *  Lv1=500  Lv2=1000  Lv3=2000  Lv4=3500  Lv5=5000
 *  Lv6=8000 Lv7=12000 Lv8=18000 Lv9=25000 Lv10=50000
 */

const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES, MODERATOR_ROLES } = require('../middleware/voiceRole.middleware');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_CAPACITY = {
  1: 500, 2: 1000, 3: 2000, 4: 3500, 5: 5000,
  6: 8000, 7: 12000, 8: 18000, 9: 25000, 10: 50000,
};

const MEMBER_ROLES = ['OWNER','CO_OWNER','ADMIN','MODERATOR','VIP','OFFICIAL','MEMBER','BLOCKED'];
const MEMBER_ROLE_WEIGHT = { OWNER:8, CO_OWNER:7, ADMIN:6, MODERATOR:5, VIP:4, OFFICIAL:3, MEMBER:2, BLOCKED:1 };

const MEMBER_LEVEL_LABELS = {
  1: { label: 'Fan',    emoji: '⭐', color: '#9ca3af' },
  2: { label: 'Regular',emoji: '🌟', color: '#6366f1' },
  3: { label: 'VIP',   emoji: '💎', color: '#06b6d4' },
  4: { label: 'Super',  emoji: '🔥', color: '#f59e0b' },
  5: { label: 'Legend', emoji: '👑', color: '#ef4444' },
};

function maxMembersForLevel(level) { return LEVEL_CAPACITY[level] ?? LEVEL_CAPACITY[1]; }

function canManage(callerRole, targetRole) {
  return (MEMBER_ROLE_WEIGHT[callerRole] ?? 0) > (MEMBER_ROLE_WEIGHT[targetRole] ?? 0);
}

function formatLastActive(date) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'Active';
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `Active ${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `Active ${months} month${months > 1 ? 's' : ''} ago`;
}

// ── Helper: get caller's member record ───────────────────────────────────────
async function getCallerMember(roomId, userId) {
  // Check live participant role
  const participant = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });
  // Also check permanent member role
  const member = await prisma.voiceRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });
  return { participant, member };
}

// ── Helper: enrich member with computed fields ────────────────────────────────
function enrichMember(m) {
  return {
    ...m,
    lastActiveLabel: formatLastActive(m.lastActiveAt),
    levelMeta: MEMBER_LEVEL_LABELS[m.memberLevel] ?? MEMBER_LEVEL_LABELS[1],
    roleWeight: MEMBER_ROLE_WEIGHT[m.role] ?? 0,
  };
}

// ── REQUEST to join (creates PENDING record) ──────────────────────────────────
async function requestJoin(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, status: true, deletedAt: true, roomLevel: true, title: true }
    });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'Room has ended', 400);

    const existing = await prisma.voiceRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (existing) {
      if (existing.status === 'REMOVED') return errorResponse(res, 'You were removed from this room', 403);
      if (existing.role === 'BLOCKED') return errorResponse(res, 'You are blocked from this room', 403);
      if (existing.status === 'PENDING') return successResponse(res, existing, 'Join request already pending');
      if (existing.status === 'ACTIVE') return successResponse(res, existing, 'Already a member');
    }

    // Check capacity
    const currentCount = await prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } });
    const maxMembers = maxMembersForLevel(room.roomLevel ?? 1);
    if (currentCount >= maxMembers) {
      return errorResponse(res, `Room is full — max ${maxMembers.toLocaleString()} members at Level ${room.roomLevel}`, 400);
    }

    // If user is the room host, auto-approve as OWNER
    const isOwner = room.hostId === userId;
    const status = isOwner ? 'ACTIVE' : 'PENDING';
    const role   = isOwner ? 'OWNER'  : 'MEMBER';

    const member = await prisma.voiceRoomMember.create({
      data: {
        id: crypto.randomUUID(), roomId, userId,
        role, status, memberLevel: 1,
        lastActiveAt: new Date(),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const io = getIo();
    if (isOwner) {
      // Notify everyone
      if (io) io.to(`voice:${roomId}`).emit('voice:member_joined', {
        roomId, userId, memberCount: currentCount + 1, maxMembers,
        firstName: member.user.firstName, lastName: member.user.lastName,
        avatarUrl: member.user.avatarUrl, role, memberLevel: 1,
      });
    } else {
      // Notify room admins of pending request
      if (io) io.to(`voice:${roomId}`).emit('voice:join_request', {
        roomId, userId,
        firstName: member.user.firstName, lastName: member.user.lastName,
        avatarUrl: member.user.avatarUrl,
      });
    }

    const statusCode = isOwner ? 201 : 200;
    return successResponse(res, enrichMember(member),
      isOwner ? 'Joined as room owner' : 'Join request sent — waiting for approval',
      statusCode
    );
  } catch (error) { next(error); }
}

// ── APPROVE join request ──────────────────────────────────────────────────────
async function approveRequest(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const callerId = req.user.id;
    const { caller, room } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN','MODERATOR']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    const member = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
    if (!member || member.status !== 'PENDING') return errorResponse(res, 'No pending request found', 404);

    const updated = await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { status: 'ACTIVE', lastActiveAt: new Date() },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const io = getIo();
    if (io) {
      io.to(`user:${targetId}`).emit('voice:join_approved', { roomId, title: room?.title });
      io.to(`voice:${roomId}`).emit('voice:member_joined', {
        roomId, userId: targetId, firstName: updated.user.firstName,
        lastName: updated.user.lastName, avatarUrl: updated.user.avatarUrl,
        role: updated.role, memberLevel: updated.memberLevel,
      });
    }
    return successResponse(res, enrichMember(updated), 'Join request approved');
  } catch (error) { next(error); }
}

// ── REJECT join request ───────────────────────────────────────────────────────
async function rejectRequest(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const callerId = req.user.id;
    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN','MODERATOR']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    await prisma.voiceRoomMember.delete({ where: { roomId_userId: { roomId, userId: targetId } } });

    const io = getIo();
    if (io) io.to(`user:${targetId}`).emit('voice:join_rejected', { roomId });
    return successResponse(res, null, 'Request rejected');
  } catch (error) { next(error); }
}

// ── Helper: validate caller has required role ──────────────────────────────────
async function validateCaller(roomId, userId, allowedRoles) {
  const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { hostId: true, title: true, roomLevel: true } });
  if (!room) return { caller: null, room: null };

  // Room host always has permission
  if (room.hostId === userId) return { caller: { role: 'OWNER' }, room };

  const member = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
  if (!member || member.status !== 'ACTIVE') return { caller: null, room };
  if (!allowedRoles.includes(member.role)) return { caller: null, room };
  return { caller: member, room };
}

// ── LEAVE membership ───────────────────────────────────────────────────────────
async function leaveRoom(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    const member = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!member) return errorResponse(res, 'Not a member', 404);
    if (member.role === 'OWNER') return errorResponse(res, 'Owner cannot leave — transfer ownership first', 400);

    await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { status: 'REMOVED' }
    });

    const newCount = await prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } });
    const io = getIo();
    if (io) io.to(`voice:${roomId}`).emit('voice:member_left', { roomId, userId, memberCount: newCount });
    return successResponse(res, null, 'Left room');
  } catch (error) { next(error); }
}

// ── GET pending requests ───────────────────────────────────────────────────────
async function getPendingRequests(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const [requests, total] = await Promise.all([
      prisma.voiceRoomMember.findMany({
        where: { roomId, status: 'PENDING' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' },
        skip, take: pagination.limit,
      }),
      prisma.voiceRoomMember.count({ where: { roomId, status: 'PENDING' } })
    ]);
    return paginatedResponse(res, requests.map(enrichMember), buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

// ── GET membership status ──────────────────────────────────────────────────────
async function getMembershipStatus(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const [member, room, currentCount] = await Promise.all([
      prisma.voiceRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
      }),
      prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { roomLevel: true, title: true, hostId: true } }),
      prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } })
    ]);

    const maxMembers = maxMembersForLevel(room?.roomLevel ?? 1);
    const pendingCount = await prisma.voiceRoomMember.count({ where: { roomId, status: 'PENDING' } });

    return successResponse(res, {
      isMember: member?.status === 'ACTIVE',
      isPending: member?.status === 'PENDING',
      isBlocked: member?.role === 'BLOCKED',
      member: member ? enrichMember(member) : null,
      roomLevel: room?.roomLevel ?? 1,
      maxMembers, currentCount, pendingCount,
      levelCapacities: LEVEL_CAPACITY,
      memberLevelLabels: MEMBER_LEVEL_LABELS,
    });
  } catch (error) { next(error); }
}

// ── LIST members (paginated, searchable, filterable) ──────────────────────────
async function listMembers(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { page = 1, limit = 50, search, role, sortBy = 'joinedAt', order = 'asc' } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const where = { roomId, status: 'ACTIVE' };
    if (role && MEMBER_ROLES.includes(role)) where.role = role;

    const orderMap = { joinedAt: { joinedAt: order }, lastActive: { lastActiveAt: order }, contribution: { contribution: order }, name: { user: { firstName: order } } };
    const orderBy = orderMap[sortBy] ?? { joinedAt: 'asc' };

    let [members, total] = await Promise.all([
      prisma.voiceRoomMember.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy,
        skip,
        take: pagination.limit,
      }),
      prisma.voiceRoomMember.count({ where })
    ]);

    // Apply name search in memory (small page size)
    if (search) {
      members = members.filter(m =>
        `${m.user.firstName} ${m.user.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
        (m.nickname ?? '').toLowerCase().includes(search.toLowerCase())
      );
    }

    return paginatedResponse(res, members.map(enrichMember), buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) { next(error); }
}

// ── SET member role (promote/demote) ───────────────────────────────────────────
async function setMemberRole(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const { role } = req.body;
    const callerId = req.user.id;

    if (!MEMBER_ROLES.includes(role)) return errorResponse(res, 'Invalid role', 400);
    if (role === 'OWNER') return errorResponse(res, 'Use transfer-owner endpoint to change owner', 400);

    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    const target = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
    if (!target) return errorResponse(res, 'Member not found', 404);
    if (!canManage(caller.role, target.role)) return errorResponse(res, 'Cannot manage a higher-ranked member', 403);

    const updated = await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { role, upgradedAt: new Date() },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:member_role_changed', { roomId, userId: targetId, role, changedBy: callerId });
      io.to(`user:${targetId}`).emit('voice:your_member_role', { roomId, role });
    }
    return successResponse(res, enrichMember(updated), `Role updated to ${role}`);
  } catch (error) { next(error); }
}

// ── REMOVE member ──────────────────────────────────────────────────────────────
async function removeMember(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const callerId = req.user.id;
    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN','MODERATOR']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    const target = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
    if (!target) return errorResponse(res, 'Member not found', 404);
    if (target.role === 'OWNER') return errorResponse(res, 'Cannot remove the owner', 403);
    if (!canManage(caller.role, target.role)) return errorResponse(res, 'Cannot remove a higher-ranked member', 403);

    await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { status: 'REMOVED' }
    });

    const newCount = await prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } });
    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:member_left', { roomId, userId: targetId, memberCount: newCount });
      io.to(`user:${targetId}`).emit('voice:removed_from_room', { roomId });
    }
    return successResponse(res, null, 'Member removed');
  } catch (error) { next(error); }
}

// ── BLOCK / UNBLOCK member ────────────────────────────────────────────────────
async function blockMember(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const callerId = req.user.id;
    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    const target = await prisma.voiceRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetId } } });
    if (target?.role === 'OWNER') return errorResponse(res, 'Cannot block the owner', 403);

    if (target) {
      await prisma.voiceRoomMember.update({ where: { roomId_userId: { roomId, userId: targetId } }, data: { role: 'BLOCKED', status: 'REMOVED', isBanned: true } });
    } else {
      await prisma.voiceRoomMember.create({ data: { id: crypto.randomUUID(), roomId, userId: targetId, role: 'BLOCKED', status: 'REMOVED', isBanned: true, memberLevel: 1 } });
    }

    const io = getIo();
    if (io) io.to(`user:${targetId}`).emit('voice:blocked_from_room', { roomId });
    return successResponse(res, null, 'Member blocked');
  } catch (error) { next(error); }
}

async function unblockMember(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const callerId = req.user.id;
    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { role: 'MEMBER', status: 'ACTIVE' }
    });
    return successResponse(res, null, 'Member unblocked');
  } catch (error) { next(error); }
}

// ── UPGRADE member level (1-5) ────────────────────────────────────────────────
async function upgradeMember(req, res, next) {
  try {
    const { id: roomId, userId: targetId } = req.params;
    const { memberLevel } = req.body;
    const callerId = req.user.id;
    if (!memberLevel || memberLevel < 1 || memberLevel > 5) return errorResponse(res, 'Member level must be 1-5', 400);

    const { caller } = await validateCaller(roomId, callerId, ['OWNER','CO_OWNER','ADMIN','MODERATOR']);
    if (!caller) return errorResponse(res, 'Permission denied', 403);

    const updated = await prisma.voiceRoomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { memberLevel, upgradedAt: new Date() },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    const levelMeta = MEMBER_LEVEL_LABELS[memberLevel] ?? MEMBER_LEVEL_LABELS[1];
    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:member_upgraded', { roomId, userId: targetId, memberLevel, levelMeta });
      io.to(`user:${targetId}`).emit('voice:your_member_level', { roomId, memberLevel, levelMeta, message: `${levelMeta.emoji} You've been upgraded to ${levelMeta.label}!` });
    }
    return successResponse(res, enrichMember(updated), 'Member level updated');
  } catch (error) { next(error); }
}

// ── UPGRADE room level ────────────────────────────────────────────────────────
async function upgradeRoomLevel(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { level } = req.body;
    const callerId = req.user.id;
    if (!level || level < 1 || level > 10) return errorResponse(res, 'Room level must be 1-10', 400);

    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { hostId: true, roomLevel: true } });
    if (!room) return errorResponse(res, 'Room not found', 404);
    if (room.hostId !== callerId) return errorResponse(res, 'Only the host can upgrade the room level', 403);
    if (level <= room.roomLevel) return errorResponse(res, `Room is already at Level ${room.roomLevel} or higher`, 400);

    await prisma.voiceRoom.update({ where: { id: roomId }, data: { roomLevel: level, updatedAt: new Date() } });
    const newCapacity = maxMembersForLevel(level);

    const io = getIo();
    if (io) io.to(`voice:${roomId}`).emit('voice:room_level_upgraded', { roomId, roomLevel: level, maxMembers: newCapacity, upgradedBy: callerId });

    return successResponse(res, { roomLevel: level, maxMembers: newCapacity, levelCapacities: LEVEL_CAPACITY }, `Room upgraded to Level ${level}`);
  } catch (error) { next(error); }
}

// ── UPDATE online status (heartbeat) ─────────────────────────────────────────
async function heartbeat(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;
    await prisma.voiceRoomMember.updateMany({
      where: { roomId, userId, status: 'ACTIVE' },
      data: { isOnline: true, lastActiveAt: new Date() }
    });
    return successResponse(res, null, 'OK');
  } catch (error) { next(error); }
}

// ── GET room level stats ──────────────────────────────────────────────────────
async function getRoomLevelStats(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId }, select: { roomLevel: true, title: true, hostId: true } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const [totalMembers, onlineCount, pendingCount, levelBreakdown] = await Promise.all([
      prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE' } }),
      prisma.voiceRoomMember.count({ where: { roomId, status: 'ACTIVE', isOnline: true } }),
      prisma.voiceRoomMember.count({ where: { roomId, status: 'PENDING' } }),
      prisma.voiceRoomMember.groupBy({ by: ['memberLevel'], where: { roomId, status: 'ACTIVE' }, _count: { memberLevel: true } }),
    ]);

    const maxMembers = maxMembersForLevel(room.roomLevel);
    return successResponse(res, {
      roomLevel: room.roomLevel, maxMembers, totalMembers, onlineCount, pendingCount,
      fillPercent: Math.round((totalMembers / maxMembers) * 100),
      levelCapacities: LEVEL_CAPACITY,
      levelBreakdown: levelBreakdown.map(b => ({ memberLevel: b.memberLevel, count: b._count.memberLevel, meta: MEMBER_LEVEL_LABELS[b.memberLevel] })),
      memberLevelLabels: MEMBER_LEVEL_LABELS,
    });
  } catch (error) { next(error); }
}

module.exports = {
  requestJoin, approveRequest, rejectRequest, leaveRoom,
  getMembershipStatus, getPendingRequests, listMembers,
  setMemberRole, removeMember, blockMember, unblockMember,
  upgradeMember, upgradeRoomLevel, heartbeat, getRoomLevelStats,
  LEVEL_CAPACITY, MEMBER_LEVEL_LABELS, MEMBER_ROLES,
};
