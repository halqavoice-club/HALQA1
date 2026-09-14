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
const { v4: uuidv4 } = require('uuid');
const { deleteCache } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');

// ── Audit helper (fire-and-forget, never throws) ──────────────────────────────
async function _rolesAudit(actorId, action, roomId, meta = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        id: uuidv4(), userId: actorId, action: 'UPDATE',
        entity: 'VoiceRoom', entityId: roomId,
        newValues: { action, ...meta }
      }
    });
  } catch { /* non-fatal */ }
}

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

    _rolesAudit(req.user.id, 'ASSIGN_MODERATOR', roomId, { targetUserId });
    return successResponse(res, {
      userId: targetUserId,
      role:   VOICE_ROLES.MODERATOR,
      name:   `${target.user.firstName} ${target.user.lastName}`
    }, `${target.user.firstName} is now a moderator`);
  } catch (error) { next(error); }
}
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

    _rolesAudit(req.user.id, 'REMOVE_MODERATOR', roomId, { targetUserId });
    return successResponse(res, { userId: targetUserId, role: VOICE_ROLES.AUDIENCE },
      `${target.user.firstName} removed from moderators`);
  } catch (error) { next(error); }
}

// ─── TRANSFER ADMIN (OWNERSHIP) ───────────────────────────────────────────────
/**
 * POST /voice/:id/transfer/:userId
 * HOST transfers ownership to another participant.
 * Old HOST becomes MODERATOR. New HOST gets full control.
 *
 * RACE CONDITION FIX: The transaction now re-reads the current hostId inside
 * the transaction and verifies the caller is still the host before committing.
 * Two concurrent transfers can no longer both succeed and leave inconsistent state.
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

    // Race-condition protection: re-read current hostId inside transaction.
    // The VoiceRoom update uses a WHERE condition matching the expected hostId
    // so it affects 0 rows if another transaction already changed the host.
    try {
      let transferred = false;
      await prisma.$transaction(async (tx) => {
        // Demote old host → MODERATOR
        await tx.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId: prevHostId } },
          data: { role: VOICE_ROLES.MODERATOR, updatedAt: new Date() }
        });
        // Promote target → HOST
        await tx.voiceParticipant.update({
          where: { id: target.id },
          data: { role: VOICE_ROLES.HOST, isMuted: false, updatedAt: new Date() }
        });
        // Update room hostId — only if current hostId still matches prevHostId
        const updateResult = await tx.voiceRoom.updateMany({
          where: { id: roomId, hostId: prevHostId },   // serialization point
          data: { hostId: targetUserId, updatedAt: new Date() }
        });
        if (updateResult.count === 0) {
          // Another transfer already succeeded — rollback by throwing
          const err = new Error('You are no longer the host of this room');
          err.statusCode = 403;
          throw err;
        }
        transferred = true;
      });
    } catch (txErr) {
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);
      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:admin_transferred', {
        roomId, newHostId: targetUserId, prevHostId,
        newHostName: `${target.user.firstName} ${target.user.lastName}`
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: targetUserId, role: VOICE_ROLES.HOST });
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: prevHostId, role: VOICE_ROLES.MODERATOR });
      io.to(`user:${targetUserId}`).emit('voice:you_are_host', { roomId, message: 'You are now the host of this room!' });
    }

    _rolesAudit(prevHostId, 'TRANSFER_OWNERSHIP', roomId, { newHostId: targetUserId });
    return successResponse(res, {
      newHostId: targetUserId, prevHostId,
      newHostRole: VOICE_ROLES.HOST, prevHostRole: VOICE_ROLES.MODERATOR
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
      data: { isMuted: true, mutedByModerator: true, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      targets.forEach(t => {
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: t.userId, isMuted: true, mutedByModerator: true
        });
      });
    }

    _rolesAudit(callerId, 'MUTE_ALL', roomId, { mutedCount: targets.length });
    return successResponse(res, { mutedCount: targets.length },
      `Muted ${targets.length} speaker${targets.length > 1 ? 's' : ''}`);
  } catch (error) { next(error); }
}

// ─── UNMUTE ALL ───────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/unmute-all
 * P1-1 FIX: Unmutes all SPEAKER and MODERATOR participants.
 * HOST/MOD only. Inverse of muteAll.
 * The calling user (HOST/MOD) is excluded from the update — they control their
 * own mic independently. AUDIENCE participants are left alone (they are always
 * muted and are not stage speakers).
 */
async function unmuteAll(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const callerId = req.user.id;

    // Find all currently muted SPEAKER and MODERATOR (not self, not HOST who controls own mic)
    const targets = await prisma.voiceParticipant.findMany({
      where: {
        roomId,
        isActive: true,
        isMuted:  true,
        userId:   { not: callerId },
        role:     { in: [VOICE_ROLES.SPEAKER, VOICE_ROLES.MODERATOR] }
      },
      select: { id: true, userId: true }
    });

    if (targets.length === 0) {
      return successResponse(res, { unmutedCount: 0 }, 'No muted speakers to unmute');
    }

    await prisma.voiceParticipant.updateMany({
      where: { id: { in: targets.map(t => t.id) } },
      data: { isMuted: false, mutedByModerator: false, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      targets.forEach(t => {
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: t.userId, isMuted: false, mutedByModerator: false
        });
      });
    }

    _rolesAudit(callerId, 'UNMUTE_ALL', roomId, { unmutedCount: targets.length });
    return successResponse(res, { unmutedCount: targets.length },
      `Unmuted ${targets.length} speaker${targets.length > 1 ? 's' : ''}`);
  } catch (error) { next(error); }
}

// ─── GET PARTICIPANTS WITH ROLES ──────────────────────────────────────────────
/**
 * GET /voice/:id/participants
 * Returns all active participants grouped by role.
 * P2-2 FIX: Added pagination — ?page=1&limit=100. Default limit 100, max 200.
 */
async function getParticipants(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { page = 1, limit = 100 } = req.query;
    const take = Math.min(200, parseInt(limit));
    const skip = (Math.max(1, parseInt(page)) - 1) * take;

    const [total, participants] = await Promise.all([
      prisma.voiceParticipant.count({ where: { roomId, isActive: true } }),
      prisma.voiceParticipant.findMany({
        where: { roomId, isActive: true },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        skip,
        take,
      })
    ]);

    // Group by role
    const grouped = {
      host:       participants.filter(p => p.role === VOICE_ROLES.HOST),
      moderators: participants.filter(p => p.role === VOICE_ROLES.MODERATOR),
      speakers:   participants.filter(p => p.role === VOICE_ROLES.SPEAKER),
      audience:   participants.filter(p => p.role === VOICE_ROLES.AUDIENCE),
      total,
      page:       parseInt(page),
      hasMore:    skip + take < total,
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

module.exports = { assignModerator, removeModerator, transferAdmin, muteAll, unmuteAll, getParticipants, pinSpeaker };
