/**
 * autoPromote — shared helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Called whenever a speaker slot is freed (drop mic, leave room, disconnect).
 * Pops the next user from the FIFO queue and promotes them to SPEAKER.
 * Broadcasts role_changed + queue_updated to the room.
 *
 * SEAT 1 RULE: Auto-promoted users always get role=SPEAKER (not HOST/MODERATOR).
 * The layout engine (computeStageLayout) places SPEAKER participants in Seats 2–12.
 * Seat 1 remains empty if no HOST/MOD is on stage — it is NEVER filled by
 * a normal user via auto-promotion.
 *
 * Returns the promoted user's userId, or null if queue was empty.
 */

const { popNext, getQueue } = require('./voiceQueue');
const { deleteCache, isRedisReady } = require('./redis');
const logger = require('./logger');

const roomCacheKey = (roomId) => `voice:room:${roomId}`;

async function autoPromoteNext(roomId, io) {
  const prisma = require('./prisma');

  // Check if there's room for another speaker
  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { maxSpeakers: true, status: true, micLocked: true }
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
  // Seat 1 is only filled by HOST/MOD when they call grabMic/unmute themselves.
  if (speakerCount >= (room.maxSpeakers || 12)) return null; // all seats full

  // Pop next from queue (Redis-safe: fall back to DB handRaised)
  let next = null;
  if (isRedisReady()) {
    try { next = await popNext(roomId); } catch (err) {
      logger.warn(`[autoPromote] Redis popNext failed: ${err.message}`);
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

  // Verify they're still active in the room
  const participant = await prisma.voiceParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } }
  });

  if (!participant || !participant.isActive) {
    // They left — try the next one recursively
    return autoPromoteNext(roomId, io);
  }

  // QUEUE FIFO FIX: Accept both AUDIENCE and muted MODERATOR participants from the queue.
  // Also accept ghost SPEAKER (role=SPEAKER but seatNumber=null — stale state from disconnect).
  // If the participant is already on stage (seatNumber != null), skip them and try next.
  if (participant.seatNumber != null) {
    // Already on stage — clean up stale queue entry and try the next person
    try {
      await prisma.voiceParticipant.update({
        where: { roomId_userId: { roomId, userId } },
        data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
      });
    } catch { /* non-fatal */ }
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId, raised: false });
    }
    return autoPromoteNext(roomId, io);
  }
  const isQueueEligible = participant.role === 'AUDIENCE' ||
    (participant.role === 'MODERATOR' && participant.isMuted) ||
    (participant.role === 'SPEAKER' && participant.seatNumber == null); // ghost SPEAKER
  if (!isQueueEligible) {
    // They already got promoted or changed state — try next
    return autoPromoteNext(roomId, io);
  }

  // Promote: AUDIENCE → SPEAKER with an assigned seat; muted MODERATOR → unmuted MODERATOR with a seat
  const isMod = participant.role === 'MODERATOR';

  // Find the lowest available seat for the promoted user
  const occupiedRows = await prisma.$queryRaw`
    SELECT seatNumber FROM voice_participants
    WHERE roomId = ${roomId} AND isActive = 1 AND seatNumber IS NOT NULL
  `;
  const occupiedSet = new Set(occupiedRows.map(r => Number(r.seatNumber)));
  const maxSp = room.maxSpeakers || 12;

  // SPEAKER gets Seats 2–12; MODERATOR can also get Seat 1 if empty (first available)
  let promotedSeat = null;
  for (let s = 1; s <= maxSp; s++) {
    if (occupiedSet.has(s)) continue;
    if (s === 1 && !isMod) continue; // SPEAKER cannot take Seat 1
    promotedSeat = s;
    break;
  }

  if (promotedSeat === null) {
    // No seat available (race condition) — try next in queue
    return autoPromoteNext(roomId, io);
  }

  if (isMod) {
    await prisma.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = ${promotedSeat}, isMuted = 0,
          handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE voice_participants
      SET seatNumber = ${promotedSeat}, role = 'SPEAKER', isMuted = 0,
          handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
      WHERE roomId = ${roomId} AND userId = ${userId}
    `;
  }

  try { await deleteCache(roomCacheKey(roomId)); } catch (err) { /* ignore */ }

  if (io) {
    const isMod = participant.role === 'MODERATOR';
    if (isMod) {
      // MODERATOR returns to stage — emit mute_changed + seatNumber
      io.to(`voice:${roomId}`).emit('voice:mute_changed', {
        roomId, userId, isMuted: false, seatNumber: promotedSeat
      });
    } else {
      // AUDIENCE → SPEAKER — emit role_changed with seatNumber
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId, userId, role: 'SPEAKER', seatNumber: promotedSeat
      });
    }
    io.to(`user:${userId}`).emit('voice:promoted_to_speaker', {
      roomId,
      seatNumber: promotedSeat,
      message: `🎙️ You're on stage at Seat ${promotedSeat}!`
    });
    // Broadcast updated queue
    let q = [];
    if (isRedisReady()) {
      try { q = await getQueue(roomId); } catch (err) { /* ignore */ }
    }
    io.to(`voice:${roomId}`).emit('voice:queue_updated', {
      roomId, queue: q, queueLength: q.length
    });

    // Authoritative stage snapshot — ensures all clients reconcile seat positions
    // even if voice:role_changed arrives out of order on slow connections.
    try {
      const stageRows = await prisma.$queryRaw`
        SELECT vp.userId, vp.role, vp.isMuted, vp.seatNumber, vp.isPinned,
               vp.handRaised, vp.mutedByModerator, vp.joinedAt
        FROM voice_participants vp
        WHERE vp.roomId = ${roomId} AND vp.isActive = 1 AND vp.seatNumber IS NOT NULL
        ORDER BY vp.seatNumber ASC
      `;
      io.to(`voice:${roomId}`).emit('voice:stage_state', {
        roomId,
        stageParticipants: stageRows.map(r => ({
          ...r,
          seatNumber: Number(r.seatNumber),
          isMuted: Boolean(r.isMuted),
          isPinned: Boolean(r.isPinned),
          handRaised: Boolean(r.handRaised),
          mutedByModerator: Boolean(r.mutedByModerator),
        })),
        stageCount: stageRows.length,
      });
    } catch { /* non-fatal */ }
  }

  return userId;
}

module.exports = { autoPromoteNext };
