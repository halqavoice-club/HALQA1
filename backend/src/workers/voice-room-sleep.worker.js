'use strict';
/**
 * Voice Room Sleep Worker
 * ──────────────────────────────────────────────────────────────────────────────
 * Transitions a LIVE voice room to IDLE after the HOST-left grace period (5 min).
 *
 * This replaces the in-memory setTimeout that was previously inside
 * voice.controller.js leaveRoom(). The setTimeout was lost on process restart,
 * leaving rooms stuck in LIVE status with 0 active participants until the
 * 90-minute stale-session worker eventually swept them. By moving the sleep
 * transition to a durable BullMQ job, the transition survives process restarts
 * and fires reliably 5 minutes after the HOST leaves an empty room.
 *
 * Safety checks (same as the original setTimeout logic):
 *   1. Room must still be LIVE — if endRoom() or deleteRoom() already ran,
 *      the room is ENDED/deleted and we must not touch it.
 *   2. Room must still have 0 active participants — if someone rejoined
 *      during the grace window, cancelRoomSleep() should have removed the
 *      job, but we double-check here as defence-in-depth.
 *   3. If both checks pass: update status=IDLE, clear queue, invalidate cache,
 *      emit voice:status_changed, and remove the live card from the feed.
 *
 * Queue name: 'voice-room-sleep' (defined in queue.service.js QUEUE_NAMES)
 * Job ID:    'room-sleep:<roomId>' — one job per room, deduped by BullMQ
 */
const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

// Status constants — mirror voice.controller.js STATUS. Inlined here to avoid
// a circular dependency on the controller module.
const STATUS_LIVE = 'LIVE';
const STATUS_IDLE = 'IDLE';

/**
 * Run the sleep transition for a single room.
 * @param {string} roomId
 */
async function runRoomSleep(roomId) {
  const prisma            = require('../utils/prisma');
  const { getIo }         = require('../sockets');
  const { invalidateRoomCache } = require('../utils/voiceRoomCache');
  const { broadcastLiveEnd }    = require('../utils/feedLive');
  const { clearQueue }          = require('../utils/voiceQueue');

  // 1. Only sleep if the room is still LIVE
  const room = await prisma.voiceRoom.findUnique({
    where: { id: roomId },
    select: { status: true },
  });
  if (!room || room.status !== STATUS_LIVE) {
    logger.debug(`[voice-sleep] Room ${roomId} is no longer LIVE (status=${room?.status ?? 'null'}) — skipping sleep`);
    return;
  }

  // 2. Defence-in-depth: only sleep if 0 active participants
  const activeCount = await prisma.voiceParticipant.count({
    where: { roomId, isActive: true },
  });
  if (activeCount > 0) {
    logger.debug(`[voice-sleep] Room ${roomId} has ${activeCount} active participant(s) — skipping sleep`);
    return;
  }

  // 3. Transition LIVE → IDLE (permanent room sleep — NOT terminal)
  //    Do NOT set endedAt. Do NOT mark status=ENDED.
  await prisma.voiceRoom.update({
    where: { id: roomId },
    data: {
      status:         STATUS_IDLE,
      lastActivityAt: new Date(),
      updatedAt:       new Date(),
    },
  });

  // 4. Clear any stale FIFO queue entries for this room
  try { await clearQueue(roomId); } catch (err) {
    logger.warn(`[voice-sleep] clearQueue failed for ${roomId}: ${err.message}`);
  }

  // 5. Invalidate room + list caches
  await invalidateRoomCache(roomId, null);

  // 6. Notify all connected clients of the status change
  const io = getIo();
  if (io) {
    io.to(`voice:${roomId}`).emit('voice:status_changed', {
      roomId,
      status: STATUS_IDLE,
      reason: 'empty_room_sleep',
    });
  }

  // 7. Remove the live card from the social feed
  broadcastLiveEnd('voice_room', roomId);

  logger.info(`[voice-sleep] Room ${roomId} transitioned LIVE → IDLE (BullMQ job, 0 participants)`);
}

/**
 * BullMQ worker factory. Called from queue.service.js startWorkers() with a
 * live Redis connection.
 * @param {import('ioredis').Redis|object} connection
 */
function createVoiceRoomSleepWorker(connection) {
  const worker = new Worker('voice-room-sleep', async (job) => {
    const { roomId } = job.data || {};
    if (!roomId) {
      logger.warn(`[voice-sleep] Job ${job.id} has no roomId — skipping`);
      return;
    }
    try {
      await runRoomSleep(roomId);
    } catch (err) {
      logger.error(`[voice-sleep] job=${job.id} roomId=${roomId} error=${err.message}`);
      throw err; // BullMQ retries per the job's attempts config
    }
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[voice-sleep] Job ${job?.id} (${job?.name}) failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createVoiceRoomSleepWorker };
