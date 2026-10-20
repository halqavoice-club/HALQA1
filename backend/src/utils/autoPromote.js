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

  // PH24C-007 FIX: Skip kicked participants — they must not be auto-promoted.
  // wasKicked=true means the host explicitly removed them; auto-promotion would
  // silently re-grant stage access, violating the kick contract.
  if (participant.wasKicked) {
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

  // FIX-001: locked seats block new occupants (lockedSeats stored as 0-based indices → 1-based)
  let _lockedSeats = room?.lockedSeats;
  if (typeof _lockedSeats === 'string') { try { _lockedSeats = JSON.parse(_lockedSeats); } catch { _lockedSeats = []; } }
  const lockedSet = new Set((Array.isArray(_lockedSeats) ? _lockedSeats : []).map(s => s + 1));

  // SPEAKER gets Seats 2–12; MODERATOR can also get Seat 1 if empty (first available)
  let promotedSeat = null;
  for (let s = 1; s <= maxSp; s++) {
    if (occupiedSet.has(s)) continue;
    if (lockedSet.has(s)) continue; // FIX-001: skip locked seats
    if (s === 1 && !isMod) continue; // SPEAKER cannot take Seat 1
    promotedSeat = s;
    break;
  }

  if (promotedSeat === null) {
    // FIX-001: no unlocked seat available (all free seats locked, or rare race) — do NOT recurse.
    // Recursing would pop+drop every remaining queued user because locked seats stay locked.
    // Return null so the caller stops; the just-popped user is dropped from the Redis queue
    // (their DB handRaised flag remains, so getQueue DB fallback / re-hydration still lists them).
    // Callers ignore the return value and do not know the popped user's identity, so they
    // cannot re-enqueue — this matches the existing race-condition behavior and is strictly
    // better than draining the whole queue. See FIX-001 final report (known limitation).
    return null;
  }

  // PH24C-004 FIX: Wrap seat assignment in try/catch to handle concurrent seat collision.
  // Two simultaneous autoPromoteNext calls (e.g. two speakers drop at once) could both
  // select the same lowest free seat, then race to write it. The @@unique([roomId,seatNumber])
  // constraint catches the second write as P2002/ER_DUP_ENTRY. Previously this error
  // propagated uncaught. Now: detect the collision, clean up the stale queue entry,
  // and recurse to try the next eligible user — matching the existing grabMic pattern.
  try {
    if (isMod) {
      // MODERATOR is exempt from allMuted — isMuted stays 0
      await prisma.$executeRaw`
        UPDATE voice_participants
        SET seatNumber = ${promotedSeat}, isMuted = 0,
            handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${userId}
      `;
    } else {
      // DEF-002: auto-promoted SPEAKERs respect the room-wide mute policy
      const autoAllMuted = Boolean(room.allMuted);
      await prisma.$executeRaw`
        UPDATE voice_participants
        SET seatNumber = ${promotedSeat}, role = 'SPEAKER', isMuted = ${autoAllMuted ? 1 : 0},
            handRaised = 0, handRaisedAt = NULL, updatedAt = NOW()
        WHERE roomId = ${roomId} AND userId = ${userId}
      `;
    }
  } catch (assignErr) {
    // PH24C-004: Detect duplicate-seat race (P2002 Prisma / ER_DUP_ENTRY MySQL)
    const isDupSeat = assignErr.code === 'P2002' ||
      (assignErr.message && (
        assignErr.message.includes('Duplicate entry') ||
        assignErr.message.includes('ER_DUP_ENTRY') ||
        assignErr.message.includes('voice_participants_roomId_seatNumber_key')
      ));
    if (isDupSeat) {
      logger.warn(`[autoPromote] Seat race for userId=${userId} room=${roomId} seat=${promotedSeat} — skipping to next in queue`);
      // Clean up the stale handRaised flag so the host queue display is accurate
      try {
        await prisma.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId } },
          data: { handRaised: false, handRaisedAt: null, updatedAt: new Date() }
        });
      } catch { /* non-fatal */ }
      if (io) {
        io.to(`voice:${roomId}`).emit('voice:hand_raised', { roomId, userId, raised: false });
      }
      // Recurse to try next in queue — autoPromoteNext already has existing recursion
      // with termination conditions (empty queue returns null), so infinite loop is impossible.
      return autoPromoteNext(roomId, io);
    }
    // Non-seat-race error — re-throw so callers see it
    throw assignErr;
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
      });
    } catch { /* non-fatal */ }
  }

  return userId;
}

module.exports = { autoPromoteNext };
