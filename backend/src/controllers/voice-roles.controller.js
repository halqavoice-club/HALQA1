/**
 * Voice Room Role Management Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints (all require authenticate + checkVoiceRole):
 *
 *   POST   /voice/:id/moderator/:userId    HOST assigns MODERATOR
 *   DELETE /voice/:id/moderator/:userId    HOST removes MODERATOR → AUDIENCE
 *   POST   /voice/:id/transfer/:userId     HOST transfers ownership → new HOST
 *   PATCH  /voice/:id/mute-all             HOST/MOD mutes all speakers
 *   GET    /voice/:id/participants         Get full participant list with roles
 *
 * Socket events emitted:
 *   voice:moderator_assigned   → { roomId, userId, firstName, lastName }
 *   voice:moderator_removed    → { roomId, userId }
 *   voice:admin_transferred    → { roomId, newHostId, prevHostId }
 *   voice:role_changed         → { roomId, userId, role }
 *   voice:mute_changed         → { roomId, userId, isMuted }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const prisma = require('../utils/prisma');
const { deleteCache } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');

function roomCacheKey(roomId) { return `voice:room:${roomId}`; }

async function safeDeleteCache(key) {
  try {
    await deleteCache(key);
  } catch (err) {
    logger.error(`[voice-roles] Cache DEL failed for "${key}": ${err.message}`);
  }
}

// ─── ASSIGN MODERATOR ─────────────────────────────────────────────────────────
/**
 * POST /voice/:id/moderator/:userId
 * HOST assigns a SPEAKER or AUDIENCE member as MODERATOR.
 * Only HOST can do this. Only 1 HOST per room.
 */
async function assignModerator(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    // req.voiceParticipant is the HOST (set by checkVoiceRole middleware)

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found or not active', 404);
    }
    if (target.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'Cannot assign moderator to the host', 400);
    }
    if (target.role === VOICE_ROLES.MODERATOR) {
      return errorResponse(res, 'User is already a moderator', 400);
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: {
        role:    'MODERATOR',
        isMuted: false,   // moderators can speak
        updatedAt: new Date()
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:moderator_assigned', {
        roomId,
        userId:    targetUserId,
        firstName: target.user.firstName,
        lastName:  target.user.lastName,
        avatarUrl: target.user.avatarUrl
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId,
        userId: targetUserId,
        role:   VOICE_ROLES.MODERATOR
      });
      // Notify the new moderator directly
      io.to(`user:${targetUserId}`).emit('voice:you_are_moderator', {
        roomId,
        message: "You've been assigned as a moderator!"
      });
    }

    return successResponse(res, {
      userId: targetUserId,
      role:   VOICE_ROLES.MODERATOR,
      name:   `${target.user.firstName} ${target.user.lastName}`
    }, `${target.user.firstName} is now a moderator`);
  } catch (error) { next(error); }
}

// ─── REMOVE MODERATOR ─────────────────────────────────────────────────────────
/**
 * DELETE /voice/:id/moderator/:userId
 * HOST removes MODERATOR role → demotes to AUDIENCE.
 */
async function removeModerator(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found', 404);
    }
    if (target.role !== VOICE_ROLES.MODERATOR) {
      return errorResponse(res, 'User is not a moderator', 400);
    }

    await prisma.voiceParticipant.update({
      where: { id: target.id },
      data: {
        role:    'AUDIENCE',
        isMuted: true,
        updatedAt: new Date()
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:moderator_removed', {
        roomId,
        userId: targetUserId
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId,
        userId: targetUserId,
        role:   VOICE_ROLES.AUDIENCE
      });
      io.to(`user:${targetUserId}`).emit('voice:moderator_removed', {
        roomId,
        message: 'Your moderator role has been removed.'
      });
    }

    return successResponse(res, { userId: targetUserId, role: VOICE_ROLES.AUDIENCE },
      `${target.user.firstName} removed from moderators`);
  } catch (error) { next(error); }
}

// ─── TRANSFER ADMIN (OWNERSHIP) ───────────────────────────────────────────────
/**
 * POST /voice/:id/transfer/:userId
 * HOST transfers ownership to another participant.
 * Old HOST becomes MODERATOR. New HOST gets full control.
 */
async function transferAdmin(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const prevHostId = req.user.id;

    if (targetUserId === prevHostId) {
      return errorResponse(res, 'Cannot transfer to yourself', 400);
    }

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Target participant not found or not active', 404);
    }
    if (target.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'Target is already the host', 400);
    }

    // Atomic: demote old host → MODERATOR, promote target → HOST
    await prisma.$transaction([
      prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId: prevHostId } },
        data: { role: VOICE_ROLES.MODERATOR, updatedAt: new Date() }
      }),
      prisma.voiceParticipant.update({
        where: { id: target.id },
        data: { role: VOICE_ROLES.HOST, isMuted: false, updatedAt: new Date() }
      }),
      prisma.voiceRoom.update({
        where: { id: roomId },
        data: { hostId: targetUserId, updatedAt: new Date() }
      })
    ]);

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:admin_transferred', {
        roomId,
        newHostId:  targetUserId,
        prevHostId,
        newHostName: `${target.user.firstName} ${target.user.lastName}`
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId: targetUserId, role: VOICE_ROLES.HOST
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId: prevHostId, role: VOICE_ROLES.MODERATOR
      });
      io.to(`user:${targetUserId}`).emit('voice:you_are_host', {
        roomId,
        message: "You are now the host of this room!"
      });
    }

    return successResponse(res, {
      newHostId:  targetUserId,
      prevHostId,
      newHostRole: VOICE_ROLES.HOST,
      prevHostRole: VOICE_ROLES.MODERATOR
    }, `Ownership transferred to ${target.user.firstName}`);
  } catch (error) { next(error); }
}

// ─── MUTE ALL ─────────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/mute-all
 * HOST or MODERATOR mutes all speakers (except themselves).
 */
async function muteAll(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const callerId = req.user.id;

    // Mute all SPEAKER and MODERATOR (not HOST, not self)
    const targets = await prisma.voiceParticipant.findMany({
      where: {
        roomId,
        isActive: true,
        isMuted:  false,
        userId:   { not: callerId },
        role:     { in: [VOICE_ROLES.SPEAKER, VOICE_ROLES.MODERATOR] }
      },
      select: { id: true, userId: true }
    });

    if (targets.length === 0) {
      return successResponse(res, { mutedCount: 0 }, 'No active speakers to mute');
    }

    await prisma.voiceParticipant.updateMany({
      where: { id: { in: targets.map(t => t.id) } },
      data: { isMuted: true, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      targets.forEach(t => {
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: t.userId, isMuted: true
        });
      });
    }

    return successResponse(res, { mutedCount: targets.length },
      `Muted ${targets.length} speaker${targets.length > 1 ? 's' : ''}`);
  } catch (error) { next(error); }
}

// ─── GET PARTICIPANTS WITH ROLES ──────────────────────────────────────────────
/**
 * GET /voice/:id/participants
 * Returns all active participants grouped by role.
 * Available to everyone in the room.
 */
async function getParticipants(req, res, next) {
  try {
    const { id: roomId } = req.params;

    const participants = await prisma.voiceParticipant.findMany({
      where: { roomId, isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }]
    });

    // Group by role
    const grouped = {
      host:       participants.filter(p => p.role === VOICE_ROLES.HOST),
      moderators: participants.filter(p => p.role === VOICE_ROLES.MODERATOR),
      speakers:   participants.filter(p => p.role === VOICE_ROLES.SPEAKER),
      audience:   participants.filter(p => p.role === VOICE_ROLES.AUDIENCE),
      total:      participants.length
    };

    return successResponse(res, grouped);
  } catch (error) { next(error); }
}

// ─── PIN SPEAKER ─────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/pin/:userId
 * HOST or MODERATOR pins a speaker to the front of the stage grid.
 * Pinned speaker shows first in the 5×2 grid on all clients.
 * Pinning someone else auto-unpins the previous pinned speaker.
 */
async function pinSpeaker(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const callerId = req.user.id;

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found or not active', 404);
    }

    // Can only pin HOST, MODERATOR, or SPEAKER
    if (!['HOST', 'MODERATOR', 'SPEAKER'].includes(target.role)) {
      return errorResponse(res, 'Can only pin speakers, moderators, or the host', 400);
    }

    // Toggle pin: unpin if already pinned, pin if not
    const newPinned = !target.isPinned;

    // Unpin anyone else currently pinned in this room
    if (newPinned) {
      await prisma.voiceParticipant.updateMany({
        where: { roomId, isPinned: true, userId: { not: targetUserId } },
        data: { isPinned: false, updatedAt: new Date() }
      });
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { isPinned: newPinned, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:speaker_pinned', {
        roomId,
        userId:    targetUserId,
        isPinned:  newPinned,
        firstName: target.user.firstName,
        lastName:  target.user.lastName,
        pinnedBy:  callerId
      });
    }

    return successResponse(res, {
      userId:   targetUserId,
      isPinned: newPinned
    }, newPinned ? `${target.user.firstName} pinned to stage` : `${target.user.firstName} unpinned`);
  } catch (error) { next(error); }
}

module.exports = { assignModerator, removeModerator, transferAdmin, muteAll, getParticipants, pinSpeaker };
