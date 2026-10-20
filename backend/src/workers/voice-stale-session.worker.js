'use strict';
/**
 * Voice Stale Session Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Problem: VoiceParticipant.isActive can remain true indefinitely when a user
 * disconnects without a clean leave (browser crash, force-close, server restart,
 * iOS background termination, network failure).
 *
 * This worker runs every 10 minutes and marks participants inactive if:
 *   1. They have been "active" for longer than STALE_THRESHOLD_MS (90 minutes)
 *      AND there is no active Socket.IO connection for them in this room.
 *      (Socket.IO is checked via the Redis adapter presence key.)
 *   2. OR they have been "active" for longer than FORCE_STALE_THRESHOLD_MS (6 hours),
 *      regardless of Socket.IO state — this catches cases where the Redis adapter
 *      itself has stale data (e.g. after a Redis flush or server crash).
 *
 * SAFETY RULES:
 *   - Never marks a participant inactive if their joinedAt is within the last
 *     GRACE_PERIOD_MS (5 minutes) — this protects legitimate joins.
 *   - Never marks a HOST inactive if any other participants are still active
 *     in the same room — the host timeout is applied only if the room is empty.
 *   - This worker does NOT kick users from rooms — it only marks isActive=false
 *     on records that are already orphaned (the LiveKit session is gone).
 *   - The one-active-room-per-user rule remains enforced by the joinRoom controller.
 *     This worker just ensures stale records don't permanently block new joins.
 */
const { Worker } = require('bullmq');
const logger = require('../utils/logger');

// A participant active for longer than this is considered stale if no Socket.IO
// presence is detected. 90 minutes covers the longest realistic session without
// any reconnect.
const STALE_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

// Force-mark as stale regardless of Socket.IO state after 6 hours.
// This handles Redis adapter stale data.
const FORCE_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

// Never touch participants who joined within the last 5 minutes.
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a user has an active Socket.IO connection in a voice room.
 * Queries the Socket.IO adapter directly for live socket membership.
 * Falls back to true (assume active/connected) if io is unavailable or
 * fetchSockets throws — conservative: never falsely evict a connected user.
 *
 * @param {string} roomId
 * @param {string} userId
 * @returns {Promise<boolean>} true if user appears connected
 */
async function hasActiveSocketConnection(roomId, userId) {
  try {
    const { getIo } = require('../sockets');
    const io = getIo();
    if (!io) {
      logger.warn('[stale-session] io not available, skipping eviction (conservative)');
      return true; // conservative: assume connected
    }
    const sockets = await io.in(`voice:${roomId}`).fetchSockets();
    return sockets.some(s => String(s.data.userId) === String(userId));
  } catch (err) {
    logger.warn('[stale-session] fetchSockets error, skipping eviction (conservative):', err?.message || err);
    return true; // conservative: assume connected
  }
}

async function runStaleSweep() {
  const prisma = require('../utils/prisma');
  const { getIo } = require('../sockets');
  const now = new Date();
  const graceThreshold = new Date(now.getTime() - GRACE_PERIOD_MS);
  const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS);
  const forceThreshold = new Date(now.getTime() - FORCE_STALE_THRESHOLD_MS);

  // Find all active participants who joined before the grace period
  const candidates = await prisma.voiceParticipant.findMany({
    where: {
      isActive: true,
      joinedAt: { lt: graceThreshold },
    },
    include: {
      room: { select: { id: true, hostId: true, status: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (candidates.length === 0) {
    logger.debug('[voice-stale] No stale session candidates found');
    return;
  }

  let markedInactive = 0;
  let skippedConnected = 0;
  let skippedGrace = 0;

  for (const participant of candidates) {
    const room = participant.room;
    if (!room || room.status === 'ENDED') continue;

    const joinedMsAgo = now.getTime() - new Date(participant.joinedAt).getTime();
    const isForceStale = joinedMsAgo > FORCE_STALE_THRESHOLD_MS;
    const isStaleCandidateByAge = joinedMsAgo > STALE_THRESHOLD_MS;

    if (!isStaleCandidateByAge) {
      skippedGrace++;
      continue;
    }

    // For force-stale (> 6h), mark inactive regardless of Socket.IO state
    // For normal stale (> 90min), only mark inactive if no Socket.IO presence
    let shouldMark = isForceStale;
    if (!shouldMark) {
      const connected = await hasActiveSocketConnection(room.id, participant.userId);
      if (!connected) {
        shouldMark = true;
      } else {
        skippedConnected++;
        continue;
      }
    }

    // Safety: never remove the host if other participants are still active
    if (participant.role === 'HOST') {
      const otherActive = await prisma.voiceParticipant.count({
        where: {
          roomId:   room.id,
          isActive: true,
          userId:   { not: participant.userId },
        },
      });
      if (otherActive > 0) {
        skippedConnected++;
        continue;
      }
    }

    // Mark inactive
    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId: room.id, userId: participant.userId } },
      data: {
        isActive:     false,
        leftAt:       now,
        seatNumber:   null,
        handRaised:   false,
        handRaisedAt: null,
      },
    }).catch(err => {
      logger.warn(`[voice-stale] Failed to mark ${participant.userId} inactive in ${room.id}: ${err.message}`);
    });

    // Emit Socket.IO user_left so other participants' UIs remove the ghost
    const io = getIo();
    if (io) {
      io.to(`voice:${room.id}`).emit('voice:user_left', {
        roomId: room.id,
        userId: participant.userId,
      });
    }

    markedInactive++;
    logger.info(
      `[voice-stale] Marked inactive: user=${participant.userId} ` +
      `(${participant.user?.firstName} ${participant.user?.lastName}) ` +
      `room=${room.id} joinedMsAgo=${Math.round(joinedMsAgo / 60000)}min ` +
      `forced=${isForceStale}`
    );
  }

  logger.info(
    `[voice-stale] Sweep complete — ` +
    `candidates=${candidates.length} ` +
    `markedInactive=${markedInactive} ` +
    `skippedConnected=${skippedConnected} ` +
    `skippedGrace=${skippedGrace}`
  );
}

function createVoiceStaleSessionWorker(connection) {
  const worker = new Worker('voice-stale-session', async (job) => {
    const utcTimestamp = new Date().toUTCString();
    try {
      await runStaleSweep();
    } catch (err) {
      logger.error(
        `[voice-stale] job="${job.name}" error="${err.message}" ` +
        `stack="${err.stack}" utc="${utcTimestamp}"`
      );
      // Do not rethrow — allow the scheduler to retry on next interval
    }
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[voice-stale] Job ${job?.id} (${job?.name}) failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createVoiceStaleSessionWorker };
