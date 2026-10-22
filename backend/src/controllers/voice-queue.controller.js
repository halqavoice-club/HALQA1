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
 *   voice:role_changed    → { roomId, userId, role, seatNumber }       (on AUDIENCE approve)
 *   voice:mute_changed    → { roomId, userId, isMuted, seatNumber }    (on MODERATOR approve)
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
const { notify } = require('../services/notification.service');
const { getNextStageVersion } = require('../utils/voiceRoomCache');

const MAX_SPEAKERS = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomCacheKey(roomId) { return `voice:room:${roomId}`; }

// FIX-001: convert Json? lockedSeats (0-based array) to a 1-based Set for seat-loop checks
function buildLockedSet(raw) { const a = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []); return new Set(a.map(s => s + 1)); }

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
  // Always call queue.getQueue() — it handles Redis-unavailable internally
  // by falling back to DB (getQueueFromDB). The previous isRedisReady() guard
  // caused broadcastQueue to emit queue:[] when Redis was down, wiping the
  // host's waiting list on every queue mutation (P0 bug).
  let q = [];
  try {
    q = await queue.getQueue(roomId);
  } catch (err) {
    logger.warn(`[voice-queue] broadcastQueue getQueue error: ${err.message}`);
  }
  io.to(`voice:${roomId}`).emit('voice:queue_updated', {
    roomId,
    queue: q,
    queueLength: q.length
  });
}

/**
 * Count participants actually occupying a stage seat.
 * Authoritative: seatNumber IS NOT NULL (set atomically on seat assignment).
 * This is the single source of truth — role-based counting is unreliable
 * because a role update and seatNumber assignment happen separately.
 */
async function countSpeakers(roomId) {
  const [{ cnt }] = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM voice_participants
    WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
  `;
  return Number(cnt ?? 0);
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
    // PERMANENT ROOMS: Only archived rooms block the queue.
    if (room.status === 'ENDED')  return errorResponse(res, 'This room has been archived', 400);

    // P0-1 FIX: micLocked blocks new speaker entries via the queue as well.
    // HOST/MODERATOR are already speakers so they cannot raiseHand; this only
    // affects AUDIENCE members trying to enter the speaker queue.
    if (room.micLocked) {
      return errorResponse(res, 'The mic is locked — no new speakers can join the stage', 403);
    }

    // ── Validate participant ───────────────────────────────────────────────
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not in this room', 400);
    }
    // QUEUE FIFO FIX: Allow MODERATOR (when muted/audience state) to join the queue.
    // MODERATOR is eligible to join queue just like normal AUDIENCE users.
    // Role controls permission to speak; queue position controls promotion priority.
    // Only HOST is exempt (they use grabMic directly to return to their own room).
    const isEligibleForQueue = participant.role === 'AUDIENCE' ||
      (participant.role === 'MODERATOR' && participant.isMuted);
    if (!isEligibleForQueue) {
      if (participant.role === 'HOST') {
        return errorResponse(res, 'Hosts use the mic button to return to stage', 400);
      }
      if (participant.role === 'SPEAKER') {
        return errorResponse(res, 'You are already a speaker', 400);
      }
      if (participant.role === 'MODERATOR' && !participant.isMuted) {
        return errorResponse(res, 'You are already on stage', 400);
      }
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
        position,
        handRaisedAt: new Date().toISOString(), // FIX: include server timestamp so clients sort FIFO correctly
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

    // P2-1 FIX: micLocked blocks HOST/MOD from approving new speakers too.
    // The queue may still contain waiting users but no new speakers should
    // be created while the stage is locked.
    if (room.micLocked) {
      return errorResponse(res, 'The mic is locked — unlock to approve speakers', 403);
    }

    const speakerCount = await countSpeakers(roomId);
    // PHASE 4 FIX: Use room.maxSpeakers as the authoritative capacity limit.
    // All 12 stage slots are in the shared pool; Seat 1 eligibility is enforced
    // by the layout engine (HOST/MOD always at index 0), NOT by reducing capacity.
    const limit = room.maxSpeakers || MAX_SPEAKERS;
    if (speakerCount >= limit) {
      return errorResponse(res, `All ${limit} stage seats are occupied — wait for a slot to open`, 400);
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
      // QUEUE FIFO FIX: Include muted MODERATORs who joined the queue voluntarily
      const waiting = await prisma.voiceParticipant.findFirst({
        where: {
          roomId,
          isActive: true,
          handRaised: true,
          OR: [
            { role: 'AUDIENCE' },
            { role: 'MODERATOR', isMuted: true },
          ]
        },
        orderBy: { handRaisedAt: 'asc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
      });
      if (!waiting) return errorResponse(res, 'Queue is empty', 400);
      nextUser = {
        userId:    waiting.userId,
        firstName: waiting.user.firstName,
        lastName:  waiting.user.lastName,
        avatarUrl: waiting.user.avatarUrl,
        raisedAt:  waiting.handRaisedAt ? waiting.handRaisedAt.toISOString() : undefined,
      };
    }

    return _promoteUser(req, res, nextUser, roomId, room);
  } catch (error) { next(error); }
}
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

    // P2-1 FIX: micLocked blocks approveUser as well
    if (room.micLocked) {
      return errorResponse(res, 'The mic is locked — unlock to approve speakers', 403);
    }

    const speakerCount = await countSpeakers(roomId);
    // PHASE 4 FIX: Use room.maxSpeakers directly — consistent with all other paths.
    const limit = room.maxSpeakers || MAX_SPEAKERS;
    if (speakerCount >= limit) {
      return errorResponse(res, `All ${limit} stage seats are occupied`, 400);
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
      avatarUrl: targetParticipant.user.avatarUrl,
      raisedAt:  targetParticipant.handRaisedAt ? targetParticipant.handRaisedAt.toISOString() : undefined,
    };

    return _promoteUser(req, res, meta, roomId, room);
  } catch (error) { next(error); }
}

// ─── Shared promotion logic ───────────────────────────────────────────────────
// Promotes a queued AUDIENCE user to SPEAKER (Seats 2–12).
// SEAT 1 RULE: Promoted users always get role=SPEAKER.
// The layout engine places SPEAKER participants in Seats 2–12.
// Seat 1 is only occupied by HOST/MOD and stays empty otherwise.
async function _promoteUser(req, res, userMeta, roomId, room) {
  const { userId } = userMeta;

  // Full stage check: use seatNumber IS NOT NULL as authoritative count
  const [{ cnt: seatedCnt }] = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM voice_participants
    WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
  `;
  const fullLimit = room.maxSpeakers || 12;
  if (Number(seatedCnt) >= fullLimit) {
    return errorResponse(res, `All ${fullLimit} stage seats are occupied — wait for a slot to open`, 400);
  }

  // Find the lowest available seat before the transaction (early-exit)
  const occupiedPre = await prisma.$queryRaw`
    SELECT seatNumber FROM voice_participants
    WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
  `;
  const occupiedSetPre = new Set(occupiedPre.map(r => Number(r.seatNumber)));

  // Determine if this user is a MODERATOR (can take Seat 1)
  const userRow = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, isMuted: true, isActive: true }
  });
  if (!userRow?.isActive) return errorResponse(res, 'Participant not found', 404);

  const isMod = userRow.role === 'MODERATOR';
  let preSeat = null;
  for (let s = 1, ls = buildLockedSet(room?.lockedSeats); s <= fullLimit; s++) {
    if (occupiedSetPre.has(s)) continue;
    if (ls.has(s)) continue;
    if (s === 1 && !isMod) continue; // SPEAKER cannot take Seat 1
    preSeat = s; break;
  }
  // FIX-001: fall through to tx if no pre-tx seat (tx re-enqueues on reject)
  let assignedSeat = preSeat;

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read inside transaction — race condition protection
      const current = await tx.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { role: true, isActive: true, isMuted: true }
      });

      if (!current?.isActive) {
        const err = new Error('Participant is no longer in the room');
        err.statusCode = 400;
        throw err;
      }
      // QUEUE FIFO FIX: Accept AUDIENCE or muted MODERATOR from the queue.
      // Also accept SPEAKER with seatNumber=null (ghost state from crash/disconnect).
      // Check seatNumber directly — it's the authoritative "on stage" indicator.
      const [seatRow] = await tx.$queryRaw`
        SELECT seatNumber FROM voice_participants
        WHERE roomId = ${roomId} AND userId = ${userId} LIMIT 1
      `;
      const alreadySeated = seatRow?.seatNumber != null;
      if (alreadySeated) {
        // User is genuinely on stage — no need to promote.
        // Signal the caller to clean up queue state and return success.
        const err = new Error('ALREADY_ON_STAGE');
        err.statusCode = 409;
        throw err;
      }
      const isQueueEligible = current.role === 'AUDIENCE' ||
        (current.role === 'MODERATOR' && current.isMuted) ||
        (current.role === 'SPEAKER' && seatRow?.seatNumber == null); // ghost SPEAKER
      if (!isQueueEligible) {
        const err = new Error(`User is already ${current.role.toLowerCase()} on stage — cannot promote again`);
        err.statusCode = 409;
        throw err;
      }

      // Re-check seat availability inside tx (TOCTOU)
      const occupiedTx = await tx.$queryRaw`
        SELECT seatNumber FROM voice_participants
        WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
      `;
      const occupiedSetTx = new Set(occupiedTx.map(r => Number(r.seatNumber)));
      const txIsMod = current.role === 'MODERATOR';
      // FIX-001: re-read lockedSeats inside the transaction so a concurrent toggleSeatLock()
      // is visible to this promotion. This is a non-locking read (Prisma default isolation,
      // REPEATABLE READ on MySQL); a lock toggle racing in the same tiny window can still be
      // missed — closing that fully would need SELECT ... FOR UPDATE on the room row, a
      // larger change. See FIX-001 report (known concurrency limitation).
      const txLockRoom = await tx.voiceRoom.findUnique({ where: { id: roomId }, select: { lockedSeats: true } });
      const lockedSet = buildLockedSet(txLockRoom?.lockedSeats); // FIX-001: locked seats (in-tx re-read)
      let seat = null;
      for (let s = 1; s <= fullLimit; s++) {
        if (occupiedSetTx.has(s)) continue;
        if (lockedSet.has(s)) continue; // FIX-001: skip locked seats
        if (s === 1 && !txIsMod) continue;
        seat = s; break;
      }
      if (seat === null) {
        // FIX-001: no unlocked seat — requeue the user with their ORIGINAL FIFO score
        // (raisedAt) instead of enqueue() which would stamp Date.now() and send them to
        // the back of the queue. The user was already popped/dequeued by the caller.
        try { await queue.requeue(roomId, { userId, firstName: userMeta.firstName, lastName: userMeta.lastName, avatarUrl: userMeta.avatarUrl, raisedAt: userMeta.raisedAt }); } catch {}
        const err = new Error('All seats just filled — please wait'); err.statusCode = 400; throw err;
      }
      assignedSeat = seat;

      // Assign seat using raw SQL (Prisma client not regenerated with seatNumber yet)
      // DEF-002: MODERATOR is exempt from allMuted; AUDIENCE→SPEAKER respects it.
      if (txIsMod) {
        await tx.$executeRaw`
          UPDATE voice_participants
          SET seatNumber = ${seat}, isMuted = 0,
              handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
          WHERE roomId = ${roomId} AND userId = ${userId}
        `;
      } else {
        // DEF-002: queue promotions are always AUDIENCE→SPEAKER; respect allMuted.
        const promoteAllMuted = Boolean(room.allMuted);
        await tx.$executeRaw`
          UPDATE voice_participants
          SET seatNumber = ${seat}, role = 'SPEAKER', isMuted = ${promoteAllMuted ? 1 : 0},
              handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
          WHERE roomId = ${roomId} AND userId = ${userId}
        `;
      }
    });
  } catch (txErr) {
    if (txErr.statusCode === 409 && txErr.message === 'ALREADY_ON_STAGE') {
      // User is already on stage (auto-promoted before host could approve).
      // Clean up stale queue entry so the host's queue display refreshes.
      try {
        await prisma.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId } },
          data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
        });
      } catch { /* non-fatal */ }
      await safeDeleteCache(roomCacheKey(roomId));
      const ioClean = getIo();
      if (ioClean) {
        ioClean.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId, raised: false });
        await broadcastQueue(roomId);
      }
      // Return success — the user IS on stage, which is the desired outcome.
      return successResponse(res, {
        userId,
        role: 'SPEAKER',
        seatNumber: null,
        firstName: userMeta.firstName,
        lastName: userMeta.lastName,
        alreadyOnStage: true,
      }, `${userMeta.firstName} is already on stage`);
    }
    if (txErr.statusCode) {
      return errorResponse(res, txErr.message, txErr.statusCode);
    }
    // SEAT RACE PROTECTION: DB unique constraint on (roomId, seatNumber) prevented a duplicate.
    // Two concurrent promotions targeted the same seat. Treat as "seat taken" → 409.
    const isDupSeat = txErr.code === 'P2002' ||
      (txErr.message && (txErr.message.includes('Duplicate entry') || txErr.message.includes('voice_participants_roomId_seatNumber_key')));
    if (isDupSeat) {
      logger.warn(`[_promoteUser] Seat race for userId=${userId} room=${roomId} — concurrent seat assignment. Returning 409.`);
      // FIX-001: requeue the dequeued user with their original FIFO score so they don't
      // vanish from the queue after a lost seat race. The user was already popped/dequeued.
      try { await queue.requeue(roomId, { userId, firstName: userMeta.firstName, lastName: userMeta.lastName, avatarUrl: userMeta.avatarUrl, raisedAt: userMeta.raisedAt }); } catch {}
      return errorResponse(res, 'Seat was just taken by another user — please try again', 409);
    }
    throw txErr;
  }

  await safeDeleteCache(roomCacheKey(roomId));

  // ── Broadcast with seatNumber ─────────────────────────────────────────
  const io = getIo();
  if (io) {
    if (isMod) {
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId, isMuted: false, seatNumber: assignedSeat
      });
    } else {
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId, role: 'SPEAKER', seatNumber: assignedSeat
      });
    }
    io.to(`user:${userId}`).emit('voice:promoted_to_speaker', {
      roomId,
      seatNumber: assignedSeat,
      message: `You've been approved as a speaker at Seat ${assignedSeat}!`
    });

    // GAP-D1 FIX: Restore SFU canPublish for the newly promoted speaker.
    // Without this, a participant whose canPublish was previously revoked (e.g. by micLocked
    // or a prior mute) cannot publish audio until they request a new token (up to 1h gap).
    // Best-effort — matches the pattern used in unmuteAll() P3a fix.
    try {
      const { sfuRevokePublish } = require('../utils/livekitService');
      sfuRevokePublish(roomId, userId, true, '[voice:promote]').catch(() => {});
    } catch {}

    // BUG-004 FIX: Add LEFT JOIN users so profile fields are included in the snapshot.
    // Audience was already included (no seatNumber filter) from a previous partial fix.
    // Previously firstName/lastName/avatarUrl were absent, causing blank names in upsert paths.
    try {
      const stageRows = await prisma.$queryRaw`
        SELECT vp.userId, vp.role, vp.isMuted, vp.seatNumber, vp.isPinned,
               vp.handRaised, vp.mutedByModerator, vp.joinedAt,
               u.firstName, u.lastName, u.avatarUrl
        FROM voice_participants vp
        LEFT JOIN users u ON u.id = vp.userId
        WHERE vp.roomId = ${roomId} AND vp.isActive = 1
        ORDER BY vp.role ASC, vp.joinedAt ASC
      `;
      io.to(`voice:${roomId}`).emit('voice:stage_state', {
        roomId,
        stageParticipants: stageRows.map(r => ({
          ...r,
          seatNumber:       r.seatNumber != null ? Number(r.seatNumber) : null,
          isMuted:          Boolean(r.isMuted),
          isPinned:         Boolean(r.isPinned),
          handRaised:       Boolean(r.handRaised),
          mutedByModerator: Boolean(r.mutedByModerator),
          firstName:        r.firstName  ?? null,
          lastName:         r.lastName   ?? null,
          avatarUrl:        r.avatarUrl  ?? null,
        })),
        stageCount: stageRows.length,
        stateVersion: await getNextStageVersion(roomId).catch(() => 0),
      });
    } catch (stageErr) {
      logger.warn(`[_promoteUser] voice:stage_state broadcast failed: ${stageErr.message}`);
    }
  }

  await broadcastQueue(roomId);

  // P2-3: Push notification to the promoted user
  notify(userId, {
    type:  'MENTION',  // reuse as speaker approval notification
    title: 'You are now a speaker!',
    body:  "You've been approved as a speaker in a voice room.",
    data:  { roomId, type: 'speaker_approved' }
  }).catch(() => {});

  return successResponse(res, {
    userId,
    role:       isMod ? VOICE_ROLES.MODERATOR : 'SPEAKER',
    seatNumber: assignedSeat,
    firstName:  userMeta.firstName,
    lastName:   userMeta.lastName,
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
      io.to(`user:${targetUserId}`).emit('voice:queue_rejected', {
        roomId,
        message: 'Your request to speak was declined.'
      });
    }
    await broadcastQueue(roomId);

    // P2-3: Push notification to the rejected user
    notify(targetUserId, {
      type:  'SYSTEM',
      title: 'Speaker request declined',
      body:  'Your request to speak was not approved.',
      data:  { roomId, type: 'speaker_rejected' }
    }).catch(() => {});

    return successResponse(res, null, 'Request rejected');
  } catch (error) { next(error); }
}

// ─── GET QUEUE ────────────────────────────────────────────────────────────────
/**
 * GET /voice/:id/queue
 *
 * Returns the full FIFO queue in order.
 * Only active HOST or MODERATOR participants see the full queue.
 * All other users (including SUPER_ADMIN without a room role) see only their position.
 */
async function getQueueHandler(req, res, next) {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;

    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });

    // SA-FIX-09: SUPER_ADMIN has no room-level queue admin privilege.
    // Full queue is available only to active HOST or MODERATOR participants.
    const isHost = participant?.isActive &&
      (participant?.role === 'HOST' || participant?.role === 'MODERATOR');

    if (isHost) {
      // Full queue for host/moderator
      // FIX: was wrapped in isRedisReady() guard — returned [] when Redis was down,
      // causing navigate-back to silently show an empty queue. Now always calls
      // queue.getQueue() which handles Redis-unavailable via DB fallback internally.
      let q = [];
      try { q = await queue.getQueue(roomId); } catch (err) {
        logger.warn(`[voice-queue:getQueueHandler] getQueue failed: ${err.message}`);
      }
      return successResponse(res, { queue: q, queueLength: q.length });
    } else {
      // Audience (or non-participant): just their position
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
  broadcastQueue,  // FIX: was missing — voice.controller.js requires this for grabMic queuing paths
  raiseHand,
  cancelHand,
  approveNext,
  approveUser,
  rejectUser,
  getQueueHandler
};
