/**
 * autoPromote — shared helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Called whenever a speaker slot is freed (drop mic, leave room, disconnect).
 * Seats the next queued user muted, then removes their completed queue entry.
 * Broadcasts role_changed + queue_updated to the room.
 *
 * SEAT 1 RULE: AUDIENCE becomes SPEAKER and can use only Seats 2–12.
 * Queued MODERATOR retains their role and existing Seat 1 eligibility.
 *
 * Returns the promoted user's userId, or null if queue was empty.
 */

const { peekNext, requeue, dequeue, getQueue } = require('./voiceQueue');
const { deleteCache, isRedisReady } = require('./redis');
const { getNextStageVersion } = require('./voiceRoomCache');
const logger = require('./logger');

// INV-002: Sleep helper for exponential backoff in seat allocation retry loop
const _sleep = ms => new Promise(r => setTimeout(r, ms));

const roomCacheKey = (roomId) => `voice:room:${roomId}`;

async function autoPromoteNext(roomId, io) {
  const prisma = require('./prisma');

  // Check if there's room for another speaker
  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { maxSpeakers: true, status: true, micLocked: true, allMuted: true, lockedSeats: true }  // DEF-002 + FIX-001: include allMuted + lockedSeats
  });
  if (!room || room.status === 'ENDED') return null;

  // P2-1 FIX: Do not auto-promote when mic is locked.
  // The host locked the stage intentionally; respect that even on slot-free events.
  if (room.micLocked) return null;

  // Count participants actually on stage: authoritative = seatNumber IS NOT NULL
  const speakerCount = await prisma.$queryRaw`
    SELECT COUNT(*) as cnt FROM voice_participants
    WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
  `.then(rows => Number(rows[0]?.cnt ?? 0));

  // PHASE 5 FIX: Use room.maxSpeakers as the authoritative capacity.
  // Normal users promoted here get role=SPEAKER and land in Seats 2–12.
  // A normal SPEAKER cannot occupy Seat 1.
  if (speakerCount >= (room.maxSpeakers || 12)) return null; // all seats full

  // Peek without consuming: failed seat assignment must retain FIFO priority.
  let next = null;
  if (isRedisReady()) {
    try { next = await peekNext(roomId); } catch (err) {
      logger.warn(`[autoPromote] Redis peekNext failed: ${err.message}`);
    }
  }
  if (!next) {
    // Redis unavailable or queue empty — check DB for waiting users
    // QUEUE FIFO FIX: Include muted MODERATORs (who joined the queue voluntarily)
    // in the same FIFO order as normal AUDIENCE members. Role does NOT give queue priority.
    const waiting = await prisma.voiceParticipant.findFirst({
      where: {
        roomId,
        isActive: true,
        handRaised: true,
        wasKicked: false,
        // AUDIENCE participants OR muted MODERATOR participants (in audience state)
        OR: [
          { role: 'AUDIENCE' },
          { role: 'MODERATOR', isMuted: true },
        ]
      },
      orderBy: { handRaisedAt: 'asc' }
    });
    if (!waiting) {
      // Slot is free and nobody is waiting — notify moderators
      if (io) {
        io.to(`voice:${roomId}`).emit('voice:speaker_slot_freed', {
          roomId,
          speakerCount,
          maxSpeakers: room.maxSpeakers || 12
        });
      }
      return null;
    }
    next = { userId: waiting.userId };
  }

  const { userId } = next;
  async function skipStaleEntry() {
    await dequeue(roomId, userId);
    // dequeue is best-effort. Do not recurse forever on an unchanged Redis head.
    if (isRedisReady() && (await peekNext(roomId))?.userId === userId) return null;
    return autoPromoteNext(roomId, io);
  }

  // Verify they're still active in the room
  const participant = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });

  if (!participant || !participant.isActive) {
    // They left — try the next one recursively
    return skipStaleEntry();
  }

  // PH24C-007 FIX: Skip kicked participants — they must not be auto-promoted.
  // wasKicked=true means the host explicitly removed them; auto-promotion would
  // silently re-grant stage access, violating the kick contract.
  if (participant.wasKicked || !participant.handRaised) {
    return skipStaleEntry();
  }

  // QUEUE FIFO FIX: Accept both AUDIENCE and muted MODERATOR participants from the queue.
  // Also accept ghost SPEAKER (role=SPEAKER but seatNumber=null — stale state from disconnect).
  // If the participant is already on stage (seatNumber != null), skip them and try next.
  if (participant.seatNumber != null) {
    // Already on stage — clean up stale queue entry and try the next person
    const cleaned = await prisma.voiceParticipant.updateMany({
      where: { roomId, userId, isActive: true, role: participant.role, seatNumber: participant.seatNumber },
      data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
    });
    if (cleaned.count !== 1) return null;
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId, raised: false });
    }
    return skipStaleEntry();
  }
  const isQueueEligible = participant.role === 'AUDIENCE' ||
    (participant.role === 'MODERATOR' && participant.isMuted) ||
    (participant.role === 'SPEAKER' && participant.seatNumber == null); // ghost SPEAKER
  if (!isQueueEligible) {
    // They already got promoted or changed state — try next
    return skipStaleEntry();
  }

  // Approval is seat consent only; microphone consent stays with self-unmute.
  let promotedSeat = null;
  let promotedRole;
  let promotedModeratorMute;

  // INV-002: Retry loop for seat allocation race condition
  const INV002_MAX_ATTEMPTS = 3;
  const INV002_BACKOFF_MS = [50, 150];

  for (let _attempt = 0; _attempt < INV002_MAX_ATTEMPTS; _attempt++) {
    promotedSeat = null; // INV-002: reset before each attempt so stale values never pass the null guard
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.voiceParticipant.findUnique({ where: { roomId_userId: { roomId, userId } } });
        const txRoom = await tx.voiceRoom.findUnique({ where: { id: roomId } });
        const eligible = current?.role === 'AUDIENCE' ||
          (current?.role === 'MODERATOR' && current.isMuted) || current?.role === 'SPEAKER';
        if (!current?.isActive || current.wasKicked || !current.handRaised || current.seatNumber != null || !eligible) {
          const err = new Error('Participant state changed during queue promotion'); err.statusCode = 409; throw err;
        }
        if (!txRoom || txRoom.deletedAt || txRoom.status === 'ENDED' || txRoom.micLocked) {
          const err = new Error('The stage is unavailable for queue promotion'); err.statusCode = 403; throw err;
        }
        const occupiedRows = await tx.$queryRaw`
          SELECT seatNumber FROM voice_participants
          WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
        `;
        const occupiedSet = new Set(occupiedRows.map(r => Number(r.seatNumber)));
        let lockedSeats = txRoom.lockedSeats;
        if (typeof lockedSeats === 'string') { try { lockedSeats = JSON.parse(lockedSeats); } catch { lockedSeats = []; } }
        const lockedSet = new Set((Array.isArray(lockedSeats) ? lockedSeats : []).map(s => s + 1));
        const isMod = current.role === 'MODERATOR';
        for (let s = 1; s <= (txRoom.maxSpeakers || 12); s++) {
          if (occupiedSet.has(s) || lockedSet.has(s) || (s === 1 && !isMod)) continue;
          promotedSeat = s; break;
        }
        if (promotedSeat === null) {
          const err = new Error('No unlocked seat available'); err.statusCode = 409; throw err;
        }
        const updated = isMod
          ? await tx.$executeRaw`
              UPDATE voice_participants
              SET seatNumber = ${promotedSeat}, isMuted = 1,
                  handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
              WHERE roomId = ${roomId} AND userId = ${userId}
                AND isActive = 1 AND wasKicked = 0 AND role = ${current.role}
                AND seatNumber IS NULL AND handRaised = 1
            `
          : await tx.$executeRaw`
              UPDATE voice_participants
              SET seatNumber = ${promotedSeat}, role = 'SPEAKER', isMuted = 1,
                  handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
              WHERE roomId = ${roomId} AND userId = ${userId}
                AND isActive = 1 AND wasKicked = 0 AND role = ${current.role}
                AND seatNumber IS NULL AND handRaised = 1
            `;
        if (Number(updated) !== 1) {
          const err = new Error('Participant state changed during queue promotion'); err.statusCode = 409; throw err;
        }
        promotedRole = isMod ? 'MODERATOR' : 'SPEAKER';
        const approved = await tx.voiceParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } }, select: { mutedByModerator: true },
        });
        if (!approved) {
          const err = new Error('Participant state changed during queue promotion'); err.statusCode = 409; throw err;
        }
        promotedModeratorMute = Boolean(approved.mutedByModerator);
      });
      // Success — exit retry loop
      break;
    } catch (assignErr) {
      // INV-002: Detect duplicate-seat race (P2002 Prisma / ER_DUP_ENTRY MySQL)
      const isDupSeat = assignErr.code === 'P2002' || assignErr.code === 'ER_DUP_ENTRY' ||
        String(assignErr.meta?.code) === '1062' ||
        (assignErr.message && (
          assignErr.message.includes('Duplicate entry') ||
          assignErr.message.includes('ER_DUP_ENTRY') ||
          assignErr.message.includes('voice_participants_roomId_seatNumber_key')
        ));
      if (isDupSeat) {
        logger.warn(`[autoPromote] Seat race attempt ${_attempt + 1}/${INV002_MAX_ATTEMPTS} for userId=${userId} room=${roomId} seat=${promotedSeat}`);
        if (_attempt < INV002_MAX_ATTEMPTS - 1) {
          // Recalculate seat availability before retry
          const freshCount = await prisma.$queryRaw`
            SELECT COUNT(*) as cnt FROM voice_participants
            WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
          `.then(rows => Number(rows[0]?.cnt ?? 0));
          if (freshCount >= (room.maxSpeakers || 12)) {
            logger.warn(`[autoPromote] No seats available after race, skipping retry (userId=${userId})`);
            return null;
          }
          await _sleep(INV002_BACKOFF_MS[_attempt]);
          continue;
        }
        // All attempts exhausted — retain queue position
        logger.warn(`[autoPromote] Seat race exhausted retries for userId=${userId} room=${roomId} — retaining queue position`);
        return null;
      }
      if (assignErr.statusCode === 403 || assignErr.statusCode === 409) {
        // F5E (T-AUTO): on locked-seat 409, requeue the user with their original FIFO
        // score so they stay at the front of the queue for the next available slot.
        // We already called popNext (not peek), so the entry was consumed; we must
        // restore it. The 403 path (mic locked / room ended) drops the user intentionally.
        if (assignErr.statusCode === 409 &&
            assignErr.message === 'No unlocked seat available' &&
            next?.raisedAt) {
          try {
            await requeue(roomId, {
              userId,
              firstName: next.firstName ?? null,
              lastName:  next.lastName  ?? null,
              avatarUrl: next.avatarUrl ?? null,
              raisedAt:  next.raisedAt,
            });
          } catch (requeueErr) {
            logger.warn(`[autoPromote] requeue failed for userId=${userId}: ${requeueErr.message}`);
          }
        }
        return null;
      }
      // Non-seat-race error — re-throw so callers see it
      throw assignErr;
    }
  }

  await dequeue(roomId, userId);
  try { await deleteCache(roomCacheKey(roomId)); } catch (err) { /* ignore */ }

  if (io) {
    const isMod = promotedRole === 'MODERATOR';
    if (isMod) {
      // MODERATOR returns to stage — emit mute_changed + seatNumber
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId, role: promotedRole, isMuted: true, mutedByModerator: promotedModeratorMute, seatNumber: promotedSeat
      });
    } else {
      // AUDIENCE → SPEAKER — emit role_changed with seatNumber
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId, role: promotedRole, isMuted: true, mutedByModerator: promotedModeratorMute, seatNumber: promotedSeat
      });
    }
    io.to(`user:${userId}`).emit('voice:promoted_to_speaker', {
      roomId,
      role: promotedRole,
      isMuted: true,
      mutedByModerator: promotedModeratorMute,
      seatNumber: promotedSeat,
      handRaised: false,
      message: `🎙️ You're on stage at Seat ${promotedSeat}. Tap the microphone to speak.`
    });
    io.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId, raised: false });
    // Broadcast updated queue
    let q = [];
    try { q = await getQueue(roomId); } catch (err) { /* DB fallback is provided by getQueue */ }
    io.to(`voice:${roomId}`).emit('voice:queue_updated', {
      roomId, queue: q, queueLength: q.length
    });

    // BUG-003 FIX: Full-room snapshot — all active participants, not stage-only.
    // Contract: voice:stage_state includes every active participant with authoritative
    // nullable seatNumber. Audience members have seatNumber=null. Profile fields are
    // populated from the users table so upsert paths have correct names/avatars.
    // Previously: AND vp.seatNumber IS NOT NULL excluded audience; no LEFT JOIN users
    // meant firstName/lastName/avatarUrl were missing from the snapshot payload.
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
    } catch { /* non-fatal */ }
  }

  return userId;
}

module.exports = { autoPromoteNext };
