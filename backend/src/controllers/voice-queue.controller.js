/**
 * Voice Room FIFO Speaker Queue — Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST   /voice/:id/queue/raise      Audience raises hand → enqueue
 *   DELETE /voice/:id/queue/cancel     Audience cancels their request → dequeue
 *   POST   /voice/:id/queue/approve    Host approves next in queue → promote
 *   POST   /voice/:id/queue/approve/:userId  Host approves specific user
 *   DELETE /voice/:id/queue/reject/:userId   Host rejects a user → dequeue
 *   GET    /voice/:id/queue            Get full FIFO queue (host only)
 *
 * Socket events emitted:
 *   voice:queue_updated   → { roomId, queue: [...], queueLength }
 *   voice:queue_position  → { roomId, position }          (to the user only)
 *   voice:role_changed    → { roomId, userId, role }       (on approve)
 *   voice:queue_rejected  → { roomId }                     (to rejected user)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const prisma  = require('../utils/prisma');
const queue   = require('../utils/voiceQueue');
const { deleteCache, isRedisReady } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES, MODERATOR_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');

const MAX_SPEAKERS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomCacheKey(roomId) { return `voice:room:${roomId}`; }

async function safeDeleteCache(key) {
  try {
    await deleteCache(key);
  } catch (err) {
    logger.error(`[voice-queue] Cache DEL failed for "${key}": ${err.message}`);
  }
}

/**
 * Broadcast the full queue to everyone in the room.
 * Called after every queue mutation.
 */
async function broadcastQueue(roomId) {
  const io = getIo();
  if (!io) return;
  let q = [];
  if (isRedisReady()) {
    try { q = await queue.getQueue(roomId); } catch (err) {
      logger.warn(`[voice-queue] broadcastQueue Redis error: ${err.message}`);
    }
  }
  io.to(`voice:${roomId}`).emit('voice:queue_updated', {
    roomId,
    queue: q,
    queueLength: q.length
  });
}

/**
 * Count active speakers (HOST + MODERATOR + SPEAKER) in a room.
 */
async function countSpeakers(roomId) {
  return prisma.voiceParticipant.count({
    where: { roomId, isActive: true, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } }
  });
}

// ─── RAISE HAND → enqueue ─────────────────────────────────────────────────────
/**
 * POST /voice/:id/queue/raise
 *
 * Audience member raises hand.
 * - Validates they are AUDIENCE and active in the room
 * - Adds to Redis FIFO queue (idempotent)
 * - Updates DB handRaised flag
 * - Broadcasts updated queue + personal position
 */
async function raiseHand(req, res, next) {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;

    // ── Validate room ──────────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED')  return errorResponse(res, 'Room has ended', 400);

    // ── Validate participant ───────────────────────────────────────────────
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 400);
    }
    if (participant.role !== 'AUDIENCE') {
      return errorResponse(res, 'Only audience members can raise hand', 400);
    }
    if (participant.handRaised) {
      // Already in queue — just return current position
      let position = 1;
      if (isRedisReady()) {
        try { position = await queue.getPosition(roomId, userId); } catch (err) { /* Redis unavailable */ }
      }
      return successResponse(res, { raised: true, position }, 'Already in queue');
    }

    // ── Enqueue ───────────────────────────────────────────────────────────
    let position = 1;
    if (isRedisReady()) {
      try {
        position = await queue.enqueue(roomId, {
          id:        userId,
          firstName: req.user.firstName,
          lastName:  req.user.lastName,
          avatarUrl: req.user.avatarUrl
        });
      } catch (err) {
        logger.warn(`[voice-queue:raiseHand] Redis enqueue failed, using DB only: ${err.message}`);
      }
    }

    // ── Update DB ─────────────────────────────────────────────────────────
    await prisma.voiceParticipant.update({
      where: { id: participant.id },
      data: { handRaised: true, handRaisedAt: new Date(), updatedAt: new Date() }
    });
    await safeDeleteCache(roomCacheKey(roomId));

    // ── Broadcast ─────────────────────────────────────────────────────────
    await broadcastQueue(roomId);

    // Tell the user their position privately
    const io = getIo();
    if (io) {
      io.to(`user:${userId}`).emit('voice:queue_position', { roomId, position });
      // Broadcast hand raised to whole room so all clients update the UI
      io.to(`voice:${roomId}`).emit('voice:hand_raised', {
        roomId,
        userId,
        firstName: req.user.firstName,
        lastName:  req.user.lastName,
        avatarUrl: req.user.avatarUrl,
        raised:    true,
        position
      });
    }

    return successResponse(res, { raised: true, position }, `You are #${position} in the queue`);
  } catch (error) { next(error); }
}

// ─── CANCEL → dequeue self ────────────────────────────────────────────────────
/**
 * DELETE /voice/:id/queue/cancel
 *
 * Audience member cancels their raise-hand request.
 */
async function cancelHand(req, res, next) {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;

    // Validate room exists
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant) return errorResponse(res, 'Not in this room', 400);

    // Remove from queue (Redis-safe)
    if (isRedisReady()) {
      try { await queue.dequeue(roomId, userId); } catch (err) {
        logger.warn(`[voice-queue:cancelHand] Redis dequeue failed: ${err.message}`);
      }
    }

    // Update DB
    await prisma.voiceParticipant.update({
      where: { id: participant.id },
      data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
    });
    await safeDeleteCache(roomCacheKey(roomId));

    // Broadcast updated queue
    await broadcastQueue(roomId);

    // Notify host/moderators that hand was lowered
    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:hand_raised', {
        roomId, userId, raised: false
      });
    }

    return successResponse(res, { raised: false }, 'Hand lowered');
  } catch (error) { next(error); }
}

// ─── APPROVE NEXT → promote first in queue ───────────────────────────────────
/**
 * POST /voice/:id/queue/approve
 *
 * Host approves the next user in FIFO order.
 * Fails if speakers >= 10.
 */
async function approveNext(req, res, next) {
  try {
    const roomId = req.params.id;

    // ── Must be HOST or MODERATOR ──────────────────────────────────────────
    const myParticipant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.id } }
    });
    if (!myParticipant || !MODERATOR_ROLES.includes(myParticipant.role)) {
      return errorResponse(res, 'Only the host or moderator can approve speakers', 403);
    }

    // ── Speaker limit ──────────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const speakerCount = await countSpeakers(roomId);
    const limit = room.maxSpeakers || MAX_SPEAKERS;
    if (speakerCount >= limit) {
      return errorResponse(res, `Speaker limit reached (max ${limit})`, 400);
    }

    // ── Pop next from queue (Redis-safe: fall back to DB handRaised) ──────
    let nextUser = null;
    if (isRedisReady()) {
      try { nextUser = await queue.popNext(roomId); } catch (err) {
        logger.warn(`[voice-queue:approveNext] Redis popNext failed: ${err.message}`);
      }
    }
    if (!nextUser) {
      // Redis unavailable or queue empty — find first waiting user in DB
      const waiting = await prisma.voiceParticipant.findFirst({
        where: { roomId, isActive: true, role: 'AUDIENCE', handRaised: true },
        orderBy: { handRaisedAt: 'asc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
      });
      if (!waiting) return errorResponse(res, 'Queue is empty', 400);
      nextUser = {
        userId:    waiting.userId,
        firstName: waiting.user.firstName,
        lastName:  waiting.user.lastName,
        avatarUrl: waiting.user.avatarUrl
      };
    }

    return _promoteUser(req, res, nextUser, roomId, room);
  } catch (error) { next(error); }
}

// ─── APPROVE SPECIFIC USER ────────────────────────────────────────────────────
/**
 * POST /voice/:id/queue/approve/:userId
 *
 * Host approves a specific user (not necessarily the first).
 * The user must be in the queue.
 */
async function approveUser(req, res, next) {
  try {
    const roomId      = req.params.id;
    const targetUserId = req.params.userId;

    // ── Must be HOST or MODERATOR ──────────────────────────────────────────
    const myParticipant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.id } }
    });
    if (!myParticipant || !MODERATOR_ROLES.includes(myParticipant.role)) {
      return errorResponse(res, 'Only the host or moderator can approve speakers', 403);
    }

    // ── Must be in queue (Redis-safe: fall back to DB handRaised) ─────────
    let inQueue = false;
    if (isRedisReady()) {
      try { inQueue = await queue.isInQueue(roomId, targetUserId); } catch (err) {
        logger.warn(`[voice-queue:approveUser] Redis isInQueue failed: ${err.message}`);
      }
    }
    if (!inQueue) {
      // Fallback: check DB handRaised flag
      const p = await prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: targetUserId } }
      });
      inQueue = !!(p?.handRaised);
    }
    if (!inQueue) return errorResponse(res, 'User is not in the queue', 400);

    // ── Speaker limit ──────────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room) return errorResponse(res, 'Room not found', 404);

    const speakerCount = await countSpeakers(roomId);
    const limit = room.maxSpeakers || MAX_SPEAKERS;
    if (speakerCount >= limit) {
      return errorResponse(res, `Speaker limit reached (max ${limit})`, 400);
    }

    // ── Remove from queue (Redis-safe) — approveUser ──────────────────────
    if (isRedisReady()) {
      try { await queue.dequeue(roomId, targetUserId); } catch (err) {
        logger.warn(`[voice-queue:approveUser] Redis dequeue failed: ${err.message}`);
      }
    }

    // Fetch meta from DB since we dequeued without popping
    const targetParticipant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });
    if (!targetParticipant) return errorResponse(res, 'Participant not found', 404);

    const meta = {
      userId:    targetUserId,
      firstName: targetParticipant.user.firstName,
      lastName:  targetParticipant.user.lastName,
      avatarUrl: targetParticipant.user.avatarUrl
    };

    return _promoteUser(req, res, meta, roomId, room);
  } catch (error) { next(error); }
}

// ─── Shared promotion logic ───────────────────────────────────────────────────
async function _promoteUser(req, res, userMeta, roomId, room) {
  const { userId } = userMeta;

  // ── Update DB ─────────────────────────────────────────────────────────
  await prisma.voiceParticipant.update({
    where: { roomId_userId: { roomId, userId } },
    data: {
      role:        'SPEAKER',
      isMuted:     false,
      handRaised:  false,
      handRaisedAt: null,
      updatedAt:   new Date()
    }
  });
  await safeDeleteCache(roomCacheKey(roomId));

  // ── Broadcast ─────────────────────────────────────────────────────────
  const io = getIo();
  if (io) {
    // Tell everyone the role changed
    io.to(`voice:${roomId}`).emit('voice:role_changed', {
      roomId,
      userId,
      role: 'SPEAKER'
    });
    // Tell the promoted user specifically
    io.to(`user:${userId}`).emit('voice:promoted_to_speaker', {
      roomId,
      message: "You've been approved as a speaker!"
    });
  }

  // Broadcast updated queue
  await broadcastQueue(roomId);

  return successResponse(res, {
    userId,
    role: 'SPEAKER',
    firstName: userMeta.firstName,
    lastName:  userMeta.lastName
  }, `${userMeta.firstName} promoted to speaker`);
}

// ─── REJECT → remove from queue ──────────────────────────────────────────────
/**
 * DELETE /voice/:id/queue/reject/:userId
 *
 * Host rejects a user's request — removes from queue, notifies user.
 */
async function rejectUser(req, res, next) {
  try {
    const roomId      = req.params.id;
    const targetUserId = req.params.userId;

    // ── Must be HOST or MODERATOR ──────────────────────────────────────────
    const myParticipant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.id } }
    });
    if (!myParticipant || !MODERATOR_ROLES.includes(myParticipant.role)) {
      return errorResponse(res, 'Only the host or moderator can reject requests', 403);
    }

    // ── Remove from queue (Redis-safe) — rejectUser ───────────────────────
    if (isRedisReady()) {
      try { await queue.dequeue(roomId, targetUserId); } catch (err) {
        logger.warn(`[voice-queue:rejectUser] Redis dequeue failed: ${err.message}`);
      }
    }

    // ── Update DB ─────────────────────────────────────────────────────────
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } }
    });
    if (participant) {
      await prisma.voiceParticipant.update({
        where: { id: participant.id },
        data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
      });
    }
    await safeDeleteCache(roomCacheKey(roomId));

    // ── Broadcast ─────────────────────────────────────────────────────────
    const io = getIo();
    if (io) {
      // Notify the rejected user privately
      io.to(`user:${targetUserId}`).emit('voice:queue_rejected', {
        roomId,
        message: 'Your request to speak was declined.'
      });
      // Update queue for everyone
    }
    await broadcastQueue(roomId);

    return successResponse(res, null, 'Request rejected');
  } catch (error) { next(error); }
}

// ─── GET QUEUE ────────────────────────────────────────────────────────────────
/**
 * GET /voice/:id/queue
 *
 * Returns the full FIFO queue in order.
 * Available to host and admins; audience members see only their position.
 */
async function getQueueHandler(req, res, next) {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    const isHost  = participant?.role === 'HOST' || participant?.role === 'MODERATOR';
    const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(req.user.role);

    if (isHost || isAdmin) {
      // Full queue for host
      let q = [];
      if (isRedisReady()) {
        try { q = await queue.getQueue(roomId); } catch (err) { /* Redis unavailable */ }
      }
      return successResponse(res, { queue: q, queueLength: q.length });
    } else {
      // Audience: just their position
      let position = 0;
      let length   = 0;
      if (isRedisReady()) {
        try {
          position = await queue.getPosition(roomId, userId);
          length   = await queue.queueLength(roomId);
        } catch (err) { /* Redis unavailable — use DB fallback */ }
      }
      if (!isRedisReady()) {
        // DB fallback: count handRaised participants
        length = await prisma.voiceParticipant.count({
          where: { roomId, isActive: true, handRaised: true }
        });
        const p = await prisma.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } }
        });
        position = p?.handRaised ? 1 : 0;
      }
      return successResponse(res, {
        queue:       [],
        queueLength: length,
        myPosition:  position,
        inQueue:     position > 0
      });
    }
  } catch (error) { next(error); }
}

module.exports = {
  raiseHand,
  cancelHand,
  approveNext,
  approveUser,
  rejectUser,
  getQueueHandler
};
