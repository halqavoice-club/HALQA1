/**
 * Voice Room — Mic Pass Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * A SPEAKER (or HOST/MODERATOR) can "pass" their mic to an AUDIENCE member.
 *
 * Flow:
 *   1. Passer calls POST /voice/:id/mic-pass/:targetUserId
 *      → Validates passer is SPEAKER/HOST/MOD, target is AUDIENCE
 *      → Stores offer in Redis with 30s TTL
 *      → Emits voice:mic_offer to target user
 *
 *   2a. Target accepts: POST /voice/:id/mic-pass/:offerId/accept
 *       → Passer → AUDIENCE (muted)
 *       → Target → SPEAKER (unmuted)
 *       → Emits voice:mic_passed to room
 *       → Emits voice:role_changed × 2
 *
 *   2b. Target declines: POST /voice/:id/mic-pass/:offerId/decline
 *       → Deletes offer from Redis
 *       → Emits voice:mic_declined to passer
 *
 *   2c. Offer expires (30s): Redis TTL fires
 *       → Passer stays as SPEAKER
 *       → Target stays as AUDIENCE
 *
 * Redis key:
 *   voice:mic_offer:{offerId}  →  { roomId, passerId, targetId, passerRole }
 *   TTL: 30 seconds
 *
 * Socket events:
 *   voice:mic_offer    → target user only  { offerId, roomId, passerName, passerAvatar }
 *   voice:mic_passed   → whole room        { roomId, passerId, targetId, targetName }
 *   voice:mic_declined → passer only       { roomId, targetName }
 *   voice:mic_expired  → passer only       (emitted by TTL expiry via keyspace notification — optional)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { setCache, getCache, deleteCache } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES, SPEAKER_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');

const OFFER_TTL = 30; // seconds

function offerKey(offerId)    { return `voice:mic_offer:${offerId}`; }
function roomCacheKey(roomId) { return `voice:room:${roomId}`; }

// Safe wrappers — cache errors must never fail an HTTP response
async function safeSetCache(key, value, ttl) {
  try { await setCache(key, value, ttl); }
  catch (err) { logger.error(`[voice-mic] Cache SET failed for "${key}": ${err.message}`); }
}
async function safeGetCache(key) {
  try { return await getCache(key); }
  catch (err) { logger.error(`[voice-mic] Cache GET failed for "${key}": ${err.message}`); return null; }
}
async function safeDeleteCache(key) {
  try { await deleteCache(key); }
  catch (err) { logger.error(`[voice-mic] Cache DEL failed for "${key}": ${err.message}`); }
}

// ─── SEND MIC OFFER ───────────────────────────────────────────────────────────
/**
 * POST /voice/:id/mic-pass/:targetUserId
 *
 * Passer sends a mic offer to an AUDIENCE member.
 * Passer must be SPEAKER, HOST, or MODERATOR.
 * Target must be AUDIENCE and active in the room.
 */
async function sendMicOffer(req, res, next) {
  try {
    const { id: roomId, targetUserId } = req.params;
    const passerId = req.user.id;

    if (passerId === targetUserId) {
      return errorResponse(res, 'Cannot pass mic to yourself', 400);
    }

    // ── Validate passer ────────────────────────────────────────────────────
    const passer = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: passerId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    if (!passer || !passer.isActive) {
      return errorResponse(res, 'You are not active in this room', 403);
    }
    if (!SPEAKER_ROLES.includes(passer.role)) {
      return errorResponse(res, 'Only speakers, moderators, and the host can pass the mic', 403);
    }

    // ── Validate target ────────────────────────────────────────────────────
    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Target user is not active in this room', 404);
    }
    if (target.role !== VOICE_ROLES.AUDIENCE) {
      return errorResponse(res, 'Mic can only be passed to an audience member', 400);
    }

    // ── Check room is live ─────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.status !== 'LIVE') {
      return errorResponse(res, 'Room is not live', 400);
    }

    // ── Check speaker limit (target will become speaker) ──────────────────
    // HOST passing mic: they stay HOST, target becomes SPEAKER — no slot freed
    // SPEAKER passing mic: they become AUDIENCE, target becomes SPEAKER — net 0
    // MODERATOR passing mic: they become AUDIENCE, target becomes SPEAKER — net 0
    // So limit is only an issue if passer is HOST (they keep their slot, adding +1)
    if (passer.role === VOICE_ROLES.HOST) {
      // PHASE 4 FIX: Count only participants actually on stage.
      const speakerCount = await prisma.voiceParticipant.count({
        where: {
          roomId, isActive: true,
          OR: [
            { role: 'SPEAKER' },
            { role: 'HOST',      isMuted: false },
            { role: 'MODERATOR', isMuted: false },
          ]
        }
      });
      // PHASE 4 FIX: Use room.maxSpeakers directly as authoritative capacity.
      // Seat 1 eligibility is enforced by the layout engine, not by reducing cap to 11.
      const limit = room.maxSpeakers || 12;
      if (speakerCount >= limit) {
        return errorResponse(res, `All ${limit} stage seats are occupied. Cannot add another speaker.`, 400);
      }
    }

    // ── Create offer in Redis ──────────────────────────────────────────────
    const offerId = uuidv4();
    await safeSetCache(offerKey(offerId), {
      offerId,
      roomId,
      passerId,
      targetId:   targetUserId,
      passerRole: passer.role
    }, OFFER_TTL);

    // ── Notify target ──────────────────────────────────────────────────────
    const io = getIo();
    if (io) {
      io.to(`user:${targetUserId}`).emit('voice:mic_offer', {
        offerId,
        roomId,
        passerId,
        passerName:   `${passer.user.firstName} ${passer.user.lastName}`,
        passerAvatar: passer.user.avatarUrl,
        passerRole:   passer.role,
        expiresIn:    OFFER_TTL
      });
    }

    return successResponse(res, {
      offerId,
      targetId:   targetUserId,
      targetName: `${target.user.firstName} ${target.user.lastName}`,
      expiresIn:  OFFER_TTL
    }, `Mic offer sent to ${target.user.firstName}. Waiting for acceptance (${OFFER_TTL}s)`);
  } catch (error) { next(error); }
}

// ─── ACCEPT MIC OFFER ─────────────────────────────────────────────────────────
/**
 * POST /voice/:id/mic-pass/:offerId/accept
 *
 * Target accepts the mic offer.
 * - Passer → AUDIENCE (muted), unless passer is HOST (stays HOST)
 * - Target → SPEAKER (unmuted)
 */
async function acceptMicOffer(req, res, next) {
  try {
    const { id: roomId, offerId } = req.params;
    const acceptorId = req.user.id;

    // ── Load offer ─────────────────────────────────────────────────────────
    const offer = await safeGetCache(offerKey(offerId));
    if (!offer) {
      return errorResponse(res, 'Mic offer has expired or does not exist', 410);
    }
    if (offer.roomId !== roomId) {
      return errorResponse(res, 'Offer does not belong to this room', 400);
    }
    if (offer.targetId !== acceptorId) {
      return errorResponse(res, 'This offer was not sent to you', 403);
    }

    // ── P2-1 FIX: Check micLocked before accepting — mic-pass creates a new speaker ──
    const roomForLock = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { micLocked: true, status: true }
    });
    if (!roomForLock || roomForLock.status !== 'LIVE') {
      return errorResponse(res, 'Room is not live', 400);
    }
    if (roomForLock.micLocked) {
      return errorResponse(res, 'The mic is locked — mic pass is not allowed while the stage is locked', 403);
    }

    // ── Validate both participants still active ────────────────────────────
    const [passer, target] = await Promise.all([
      prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: offer.passerId } },
        include: { user: { select: { id: true, firstName: true, lastName: true } } }
      }),
      prisma.voiceParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: acceptorId } },
        include: { user: { select: { id: true, firstName: true, lastName: true } } }
      })
    ]);

    if (!passer?.isActive) {
      await safeDeleteCache(offerKey(offerId));
      return errorResponse(res, 'The passer has left the room', 400);
    }
    if (!target?.isActive) {
      await safeDeleteCache(offerKey(offerId));
      return errorResponse(res, 'You are no longer active in this room', 400);
    }

    // ── Consume offer ──────────────────────────────────────────────────────
    await safeDeleteCache(offerKey(offerId));

    // ── Find seat for target and perform atomic swap ───────────────────────
    // The passer releases their seat (or HOST keeps their seat but grants a new slot to target).
    // Use raw SQL for seatNumber operations (Prisma client not regenerated yet).

    const roomInfo = await prisma.voiceRoom.findUnique({
      where: { id: roomId }, select: { maxSpeakers: true }
    });
    const maxSp = roomInfo?.maxSpeakers || 12;

    // Get passer's current seatNumber so we can assign it to target (seat swap)
    const [passerRow] = await prisma.$queryRaw`
      SELECT seatNumber FROM voice_participants
      WHERE roomId = ${roomId} AND userId = ${offer.passerId} LIMIT 1
    `;
    const passerSeat = passerRow ? Number(passerRow.seatNumber) : null;

    // Find target's seat: reuse passer's seat if HOST passes (HOST keeps their seat, target gets new one)
    // or if passer releases seat, target gets passer's freed seat
    let targetSeat = passerSeat; // default: target takes passer's old seat
    if (offer.passerRole === VOICE_ROLES.HOST) {
      // HOST keeps their seat — find lowest available for target
      const occupied = await prisma.$queryRaw`
        SELECT seatNumber FROM voice_participants
        WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
      `;
      const occupiedSet = new Set(occupied.map(r => Number(r.seatNumber)));
      targetSeat = null;
      for (let s = 2; s <= maxSp; s++) { // SPEAKER starts from Seat 2
        if (!occupiedSet.has(s)) { targetSeat = s; break; }
      }
      if (targetSeat === null) {
        return errorResponse(res, 'No stage seats available for the mic pass', 400);
      }
    }

    // Perform the swap atomically
    await prisma.$transaction([
      // Passer: release seat → AUDIENCE (unless HOST who keeps seat)
      offer.passerRole !== VOICE_ROLES.HOST
        ? prisma.$executeRaw`
            UPDATE voice_participants
            SET seatNumber = NULL, role = 'AUDIENCE', isMuted = 1, updatedAt = NOW()
            WHERE roomId = ${roomId} AND userId = ${offer.passerId}
          `
        : prisma.$executeRaw`SELECT 1`, // no-op for HOST

      // Target: assign seat → SPEAKER
      prisma.$executeRaw`
        UPDATE voice_participants
        SET seatNumber = ${targetSeat}, role = 'SPEAKER', isMuted = 0,
            handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${acceptorId}
      `,
    ]);

    await safeDeleteCache(roomCacheKey(roomId));

    // ── Broadcast ──────────────────────────────────────────────────────────
    const io = getIo();
    if (io) {
      // Tell the room the mic was passed
      io.to(`voice:${roomId}`).emit('voice:mic_passed', {
        roomId,
        passerId:   offer.passerId,
        passerName: `${passer.user.firstName} ${passer.user.lastName}`,
        targetId:   acceptorId,
        targetName: `${target.user.firstName} ${target.user.lastName}`,
        passerRole: offer.passerRole
      });

      // Role change events with seatNumber so clients update their UI
      if (offer.passerRole !== VOICE_ROLES.HOST) {
        io.to(`voice:${roomId}`).emit('voice:role_changed', {
          roomId, userId: offer.passerId, role: VOICE_ROLES.AUDIENCE, seatNumber: null
        });
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: offer.passerId, isMuted: true, seatNumber: null
        });
      }
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId: acceptorId, role: VOICE_ROLES.SPEAKER, seatNumber: targetSeat
      });

      // Tell the new speaker directly
      io.to(`user:${acceptorId}`).emit('voice:mic_received', {
        roomId,
        seatNumber: targetSeat,
        message: `${passer.user.firstName} passed the mic to you! You're now a speaker at Seat ${targetSeat}.`
      });
    }

    return successResponse(res, {
      passerId:   offer.passerId,
      targetId:   acceptorId,
      seatNumber: targetSeat,
      passerRole: offer.passerRole === VOICE_ROLES.HOST ? VOICE_ROLES.HOST : VOICE_ROLES.AUDIENCE,
      targetRole: VOICE_ROLES.SPEAKER
    }, 'Mic accepted — you are now a speaker!');
  } catch (error) { next(error); }
}

// ─── DECLINE MIC OFFER ────────────────────────────────────────────────────────
/**
 * POST /voice/:id/mic-pass/:offerId/decline
 *
 * Target declines the offer. Passer keeps their role.
 */
async function declineMicOffer(req, res, next) {
  try {
    const { id: roomId, offerId } = req.params;
    const declinerId = req.user.id;

    const offer = await safeGetCache(offerKey(offerId));
    if (!offer) {
      return errorResponse(res, 'Offer has already expired', 410);
    }
    if (offer.roomId !== roomId) {
      return errorResponse(res, 'Offer does not belong to this room', 400);
    }
    if (offer.targetId !== declinerId) {
      return errorResponse(res, 'This offer was not sent to you', 403);
    }

    await safeDeleteCache(offerKey(offerId));

    // Notify passer
    const decliner = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: declinerId } },
      include: { user: { select: { firstName: true, lastName: true } } }
    });

    const io = getIo();
    if (io) {
      io.to(`user:${offer.passerId}`).emit('voice:mic_declined', {
        roomId,
        targetId:   declinerId,
        targetName: decliner
          ? `${decliner.user.firstName} ${decliner.user.lastName}`
          : 'The user'
      });
    }

    return successResponse(res, null, 'Mic offer declined');
  } catch (error) { next(error); }
}

// ─── CANCEL MIC OFFER (passer changes mind) ───────────────────────────────────
/**
 * DELETE /voice/:id/mic-pass/:offerId
 *
 * Passer cancels a pending offer before it's accepted.
 */
async function cancelMicOffer(req, res, next) {
  try {
    const { id: roomId, offerId } = req.params;
    const cancellerId = req.user.id;

    const offer = await safeGetCache(offerKey(offerId));
    if (!offer) {
      return errorResponse(res, 'Offer not found or already expired', 410);
    }
    if (offer.passerId !== cancellerId) {
      return errorResponse(res, 'You did not create this offer', 403);
    }

    await safeDeleteCache(offerKey(offerId));

    // Notify target that offer was cancelled
    const io = getIo();
    if (io) {
      io.to(`user:${offer.targetId}`).emit('voice:mic_offer_cancelled', {
        roomId,
        offerId
      });
    }

    return successResponse(res, null, 'Mic offer cancelled');
  } catch (error) { next(error); }
}

module.exports = { sendMicOffer, acceptMicOffer, declineMicOffer, cancelMicOffer };
