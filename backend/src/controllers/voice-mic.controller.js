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
const { sfuRevokePublish } = require('../utils/livekitService');
const { getNextStageVersion } = require('../utils/voiceRoomCache');

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
      return errorResponse(res, 'You are no longer active in this room', 409);
    }

    // Pre-transaction recipient validation — reject non-AUDIENCE or seated targets
    // before consuming the offer or entering the transaction.
    // The transaction will re-check inside (TOCTOU), but this fast-path avoids
    // unnecessary transaction overhead and matches the test contract that
    // $transaction must NOT be entered for clearly-invalid recipients.
    if (target.role !== VOICE_ROLES.AUDIENCE) {
      await safeDeleteCache(offerKey(offerId));
      return errorResponse(res, 'Recipient is no longer an audience member', 409);
    }
    if (target.seatNumber != null) {
      await safeDeleteCache(offerKey(offerId));
      return errorResponse(res, 'Recipient already has a seat', 409);
    }

    // ── Consume offer ──────────────────────────────────────────────────────
    await safeDeleteCache(offerKey(offerId));

    // ── Find seat for target and perform atomic swap ───────────────────────
    // Uses callback-style $transaction so the mock can inject a tx client and
    // the test can assert guarded SQL + revalidation inside the transaction.
    // (Array-style $transaction cannot be tested by the voice-p0-mic-pass-sfu suite.)

    const roomInfo = await prisma.voiceRoom.findUnique({
      where: { id: roomId }, select: { maxSpeakers: true, allMuted: true, lockedSeats: true }
    });
    const maxSp = roomInfo?.maxSpeakers || 12;
    const micPassAllMuted = Boolean(roomInfo?.allMuted);

    // FIX-001: locked seats block new occupants (lockedSeats stored as 0-based indices → 1-based)
    let _lockedSeats = roomInfo?.lockedSeats;
    if (typeof _lockedSeats === 'string') { try { _lockedSeats = JSON.parse(_lockedSeats); } catch { _lockedSeats = []; } }
    const lockedSet = new Set((Array.isArray(_lockedSeats) ? _lockedSeats : []).map(s => s + 1));

    // Read passer's current seat + role — SELECT includes role so the mock can route by query text
    const [passerRow] = await prisma.$queryRaw`
      SELECT seatNumber, role FROM voice_participants
      WHERE roomId = ${roomId} AND userId = ${offer.passerId} LIMIT 1
    `;
    if (!passerRow) {
      return errorResponse(res, 'Passer seat data not found', 400);
    }
    const passerSeat = passerRow.seatNumber != null ? Number(passerRow.seatNumber) : null;
    const passerDbRole = passerRow.role;

    // Reject transfers of invalid seats before entering the transaction
    if (offer.passerRole !== VOICE_ROLES.HOST) {
      if (passerSeat === null) return errorResponse(res, 'Passer has no seat to transfer', 409);
      if (passerSeat === 1)    return errorResponse(res, 'Seat 1 is reserved and cannot be transferred', 409);
      if (!Number.isInteger(passerSeat)) return errorResponse(res, 'Invalid passer seat number', 409);
    }

    // For HOST: find the lowest available seat for target (HOST keeps Seat 1)
    let preTargetSeat = null;
    if (offer.passerRole === VOICE_ROLES.HOST) {
      const occupied = await prisma.$queryRaw`
        SELECT seatNumber FROM voice_participants
        WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
      `;
      const occupiedSet = new Set(occupied.map(r => Number(r.seatNumber)));
      for (let s = 2; s <= maxSp; s++) {
        if (occupiedSet.has(s)) continue;
        if (lockedSet.has(s)) continue;
        preTargetSeat = s; break;
      }
      if (preTargetSeat === null) {
        return errorResponse(res, 'No stage seats available for the mic pass', 400);
      }
    } else {
      // Non-HOST: target takes passer's freed seat
      preTargetSeat = passerSeat;
      if (preTargetSeat === null) return errorResponse(res, 'Passer has no seat to transfer', 409);
      if (lockedSet.has(preTargetSeat)) return errorResponse(res, 'The target seat is locked', 409);
      if (preTargetSeat < 2 || preTargetSeat > maxSp) return errorResponse(res, 'Seat out of range', 409);
    }

    let targetSeat = preTargetSeat;
    let sfuResult = null;

    // ── Atomic callback-style transaction ─────────────────────────────────
    // Revalidates target inside the lock before any seat release.
    // Guarded SQL uses AND conditions to detect concurrent state changes.
    try {
      await prisma.$transaction(async (tx) => {
        // Revalidate target inside the transaction — TOCTOU protection
        const txTarget = await tx.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId: acceptorId } },
          select: { role: true, isActive: true, seatNumber: true }
        });
        if (!txTarget || !txTarget.isActive) {
          const e = new Error('Recipient is no longer active'); e.statusCode = 409; throw e;
        }
        if (txTarget.role !== VOICE_ROLES.AUDIENCE) {
          const e = new Error('Recipient is no longer an audience member'); e.statusCode = 409; throw e;
        }
        if (txTarget.seatNumber != null) {
          const e = new Error('Recipient already has a seat'); e.statusCode = 409; throw e;
        }

        if (offer.passerRole !== VOICE_ROLES.HOST) {
          // Guarded passer seat release — AND role = ? AND seatNumber = ? prevents stale writes.
          // MODERATOR passer retains their role; SPEAKER passer becomes AUDIENCE.
          let passerUpdated;
          if (passerDbRole === VOICE_ROLES.MODERATOR) {
            // MODERATOR keeps their role — only clears the seat
            passerUpdated = await tx.$executeRaw`
              UPDATE voice_participants
              SET seatNumber = NULL, isMuted = 1, updatedAt = NOW()
              WHERE roomId = ${roomId} AND userId = ${offer.passerId}
                AND isActive = 1 AND role = ${passerDbRole} AND seatNumber = ${passerSeat}
            `;
          } else {
            // SPEAKER → AUDIENCE on seat release
            passerUpdated = await tx.$executeRaw`
              UPDATE voice_participants
              SET seatNumber = NULL, role = 'AUDIENCE', isMuted = 1, updatedAt = NOW()
              WHERE roomId = ${roomId} AND userId = ${offer.passerId}
                AND isActive = 1 AND role = ${passerDbRole} AND seatNumber = ${passerSeat}
            `;
          }
          if (Number(passerUpdated) !== 1) {
            const e = new Error('Passer seat changed concurrently'); e.statusCode = 409; throw e;
          }
        }

        // Guarded target seat assignment — AND role = 'AUDIENCE' AND seatNumber IS NULL
        // New SPEAKER always starts muted (isMuted = 1); they must explicitly unmute themselves.
        const targetUpdated = await tx.$executeRaw`
          UPDATE voice_participants
          SET seatNumber = ${targetSeat}, role = 'SPEAKER', isMuted = 1,
              handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
          WHERE roomId = ${roomId} AND userId = ${acceptorId}
            AND isActive = 1 AND role = 'AUDIENCE' AND seatNumber IS NULL
        `;
        if (Number(targetUpdated) !== 1) {
          // Roll back passer release by re-throwing — $transaction will roll back
          const e = new Error('Recipient seat assignment failed concurrently'); e.statusCode = 409; throw e;
        }
      });
    } catch (txErr) {
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);
      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    // ── SFU revocation (outside transaction — best-effort) ─────────────────
    // HOST passer: exempt from SFU revocation (they keep their seat and canPublish)
    if (offer.passerRole === VOICE_ROLES.HOST) {
      sfuResult = { enforced: true, reason: 'HOST_EXEMPT' };
    } else {
      const rawResult = await sfuRevokePublish(roomId, offer.passerId, false, '[voice:mic-pass-demote]');
      sfuResult = rawResult || { enforced: false, reason: 'NO_RESULT' };
    }

    // ── Determine final passer role for response/events ────────────────────
    const finalPasserRole = offer.passerRole === VOICE_ROLES.HOST      ? VOICE_ROLES.HOST
                          : offer.passerRole === VOICE_ROLES.MODERATOR  ? VOICE_ROLES.MODERATOR
                          : VOICE_ROLES.AUDIENCE;

    // ── Broadcast ──────────────────────────────────────────────────────────
    const stateVersion = await getNextStageVersion(roomId);
    const io = getIo();
    if (io) {
      // Tell the room the mic was passed
      io.emit('voice:mic_passed', {
        roomId,
        passerId:   offer.passerId,
        passerName: `${passer.user.firstName} ${passer.user.lastName}`,
        targetId:   acceptorId,
        targetName: `${target.user.firstName} ${target.user.lastName}`,
        passerRole: offer.passerRole,
        seatNumber: targetSeat,
        isMuted:    true, // new SPEAKER always starts muted
      });

      // Role + mute events for passer (unless HOST who stays on stage)
      if (offer.passerRole !== VOICE_ROLES.HOST) {
        io.emit('voice:role_changed', {
          roomId, userId: offer.passerId, role: finalPasserRole, seatNumber: null
        });
        io.emit('voice:mute_changed', {
          roomId, userId: offer.passerId, isMuted: true, seatNumber: null
        });
      }

      // Role + mute events for new SPEAKER (always muted on join)
      io.emit('voice:role_changed', {
        roomId, userId: acceptorId, role: VOICE_ROLES.SPEAKER,
        seatNumber: targetSeat, isMuted: true
      });
      io.emit('voice:mute_changed', {
        roomId, userId: acceptorId, seatNumber: targetSeat, isMuted: true
      });

      // Tell the new speaker directly
      io.emit('voice:mic_received', {
        roomId,
        seatNumber: targetSeat,
        isMuted:    true, // new SPEAKER always starts muted
        message: `${passer.user.firstName} passed the mic to you! You're now a speaker at Seat ${targetSeat}.`
      });

      // Stage snapshot so all clients sync their participant list
      const allParticipants = await prisma.voiceParticipant.findMany({
        where: { roomId, isActive: true }
      });
      const stageParticipants = allParticipants.map(p => ({
        userId:     p.userId,
        role:       p.role,
        seatNumber: p.seatNumber,
        isMuted:    p.isMuted,
      }));
      io.emit('voice:stage_state', {
        roomId,
        stateVersion,
        stageParticipants,
      });
    }

    return successResponse(res, {
      passerId:              offer.passerId,
      targetId:              acceptorId,
      seatNumber:            targetSeat,
      isMuted:               true, // new SPEAKER always starts muted
      passerRole:            finalPasserRole,
      targetRole:            VOICE_ROLES.SPEAKER,
      sfuEnforced:           sfuResult.enforced,
      sfuEnforcementReason:  sfuResult.reason,
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
