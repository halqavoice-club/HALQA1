'use strict';
/**
 * voiceRoomLifecycle.service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Authoritative Voice Club room termination lifecycle.
 *
 * Both the normal PATCH /voice/:id/end (voice.controller.js) and the
 * platform-admin POST /admin/actions/voice/:id/terminate (admin-actions.routes.js)
 * must call this service instead of implementing their own DB logic.
 *
 * This file must NOT import from:
 *   - voice.controller.js          (circular)
 *   - sockets/index.js             (post-commit side-effect, caller's responsibility)
 *   - utils/voiceRoomCache.js      (post-commit side-effect, caller's responsibility)
 *   - utils/voiceQueue.js          (post-commit side-effect, caller's responsibility)
 *   - utils/feedLive.js            (post-commit side-effect, caller's responsibility)
 *
 * Lock order (must be consistent with joinRoom()):
 *   voice_rooms FOR UPDATE  →  voice_participants (write)
 */

const { Prisma } = require('@prisma/client');
const { getLivekitRoomService } = require('../utils/livekitService');
const logger = require('../utils/logger');

const SFU_OP_TIMEOUT_MS = 3000;   // 3 s per SFU operation
const SFU_RETRY_TOTAL_DEADLINE_MS = 10_000; // 10 s wall-clock cap for retry sweeps
const SFU_RETRY_BATCH_SIZE = 5;   // max concurrent removeParticipant calls

/**
 * terminateVoiceRoom
 * ─────────────────────────────────────────────────────────────────────────────
 * Transactionally terminates a voice room.
 *
 * Lock order inside the transaction:
 *   1. voice_rooms FOR UPDATE  — must be first (mirrors joinRoom / endRoom)
 *   2. voice_participants read (findMany)
 *   3. voice_participants write (updateMany)
 *   4. voice_rooms write (update)
 *
 * @param {string} roomId
 * @param {{ endedAt?: Date, prismaClient?: object }} [opts]
 * @returns {Promise<{ alreadyEnded: boolean, participantSnapshot: Array }>}
 */
async function terminateVoiceRoom(roomId, { endedAt, prismaClient } = {}) {
  const resolvedEndedAt = endedAt || new Date();
  const db = prismaClient || require('../utils/prisma');

  const result = await db.$transaction(
    async (tx) => {
      // 1. Acquire room row lock — serialize with joinRoom() and any concurrent endRoom.
      //    This must be the first operation inside the transaction.
      await tx.$queryRaw`SELECT id FROM voice_rooms WHERE id = ${roomId} FOR UPDATE`;

      // 2. Re-read room state inside the lock (READ COMMITTED sees the latest committed row).
      const room = await tx.voiceRoom.findUnique({
        where: { id: roomId },
        select: { id: true, status: true, deletedAt: true },
      });

      // 3. Idempotency: already ended or soft-deleted → return without mutation.
      if (!room || room.deletedAt || room.status === 'ENDED') {
        return { alreadyEnded: true, participantSnapshot: [] };
      }

      // 4. Pre-snapshot active participants before deactivation.
      //    This snapshot is used post-commit for SFU cleanup and voiceMinutes stats.
      const participantSnapshot = await tx.voiceParticipant.findMany({
        where: { roomId, isActive: true },
        select: { userId: true, joinedAt: true },
      });

      // 5. Deactivate all active participants.
      //    seatNumber is cleared because of the @@unique([roomId, seatNumber]) constraint.
      await tx.voiceParticipant.updateMany({
        where: { roomId, isActive: true },
        data: {
          isActive:   false,
          leftAt:     resolvedEndedAt,
          seatNumber: null,
        },
      });

      // 6. Transition room to terminal ENDED state.
      await tx.voiceRoom.update({
        where: { id: roomId },
        data: {
          status:    'ENDED',
          endedAt:   resolvedEndedAt,
          updatedAt: resolvedEndedAt,
        },
      });

      return { alreadyEnded: false, participantSnapshot };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );

  return result;
}

/**
 * runSfuCleanup
 * ─────────────────────────────────────────────────────────────────────────────
 * Post-commit SFU cleanup. Best-effort — individual failures are collected and
 * returned, never thrown.
 *
 * retryMode = false (default, normal termination):
 *   Calls svc.deleteRoom() once with a 3 s timeout. Treats 404 as success.
 *   Does NOT iterate per-participant (the SFU room delete disconnects everyone).
 *
 * retryMode = true (sfuRetry path, room already ENDED):
 *   Calls svc.removeParticipant() for each entry in `participants`, bounded to
 *   batches of 5 concurrent calls and a total wall-clock deadline of 10 s.
 *
 * @param {string} roomId
 * @param {Array<{ userId: string }>} participants
 * @param {{ retryMode?: boolean }} [opts]
 * @returns {Promise<object>}
 */
async function runSfuCleanup(roomId, participants, { retryMode = false } = {}) {
  const sfuResult = {
    participantsAttempted:   0,
    participantsDisconnected: 0,
    participantsFailed:      0,
    participantsTimedOut:    0,
    roomDeleted:             false,
    notConfigured:           false,
    cleanupMode: retryMode ? 'participant_sweep' : 'room_delete',
  };

  const svc = getLivekitRoomService();
  if (!svc) {
    sfuResult.notConfigured = true;
    return sfuResult;
  }

  if (!retryMode) {
    // ── Initial cleanup: delete the whole SFU room in one call ──────────────
    let delTimer;
    try {
      await Promise.race([
        svc.deleteRoom(roomId),
        new Promise((_, reject) => {
          delTimer = setTimeout(() => {
            const err = new Error(`deleteRoom timed out after ${SFU_OP_TIMEOUT_MS}ms`);
            err.code = 'LIVEKIT_TIMEOUT';
            reject(err);
          }, SFU_OP_TIMEOUT_MS);
          delTimer.unref?.();
        }),
      ]);
      sfuResult.roomDeleted = true;
    } catch (err) {
      if (err?.code === 'LIVEKIT_TIMEOUT') {
        logger.warn(`[voice-lifecycle] deleteRoom timed out for ${roomId}`);
      } else {
        const status = err?.status || err?.statusCode;
        const missing = status === 404 || err?.code === 5 || /not found/i.test(err?.message || '');
        if (missing) {
          sfuResult.roomDeleted = true; // already gone — counts as success
        } else {
          logger.warn(`[voice-lifecycle] deleteRoom failed for ${roomId}: ${err?.message || err}`);
        }
      }
    } finally {
      if (delTimer) clearTimeout(delTimer);
    }
    return sfuResult;
  }

  // ── Retry sweep: per-participant removeParticipant, bounded concurrency ───
  const participantList = Array.isArray(participants) ? participants : [];
  const deadlinePromise = new Promise((resolve) => {
    const t = setTimeout(() => resolve('DEADLINE'), SFU_RETRY_TOTAL_DEADLINE_MS);
    t.unref?.();
  });

  let deadlineHit = false;
  // Race the entire sweep against the 10 s wall-clock deadline
  await Promise.race([
    (async () => {
      for (let i = 0; i < participantList.length; i += SFU_RETRY_BATCH_SIZE) {
        if (deadlineHit) break;
        const batch = participantList.slice(i, i + SFU_RETRY_BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (p) => {
            const identity = p.identity || p.userId;
            sfuResult.participantsAttempted++;
            let timer;
            try {
              await Promise.race([
                svc.removeParticipant(roomId, identity),
                new Promise((_, reject) => {
                  timer = setTimeout(() => {
                    const err = new Error(`removeParticipant timed out after ${SFU_OP_TIMEOUT_MS}ms`);
                    err.code = 'LIVEKIT_TIMEOUT';
                    reject(err);
                  }, SFU_OP_TIMEOUT_MS);
                  timer.unref?.();
                }),
              ]);
              sfuResult.participantsDisconnected++;
            } catch (err) {
              if (err?.code === 'LIVEKIT_TIMEOUT') {
                sfuResult.participantsTimedOut++;
              } else {
                const status = err?.status || err?.statusCode;
                const missing = status === 404 || err?.code === 5 || /not found/i.test(err?.message || '');
                if (missing) {
                  sfuResult.participantsDisconnected++; // already gone — success
                } else {
                  sfuResult.participantsFailed++;
                }
              }
              logger.warn(`[voice-lifecycle] removeParticipant failed for ${identity} in ${roomId}: ${err?.message || err}`);
            } finally {
              if (timer) clearTimeout(timer);
            }
          })
        );
      }
    })(),
    deadlinePromise.then(() => { deadlineHit = true; }),
  ]);

  if (deadlineHit) {
    logger.warn(`[voice-lifecycle] Retry sweep deadline hit for ${roomId} after ${SFU_RETRY_TOTAL_DEADLINE_MS}ms`);
  }

  return sfuResult;
}

module.exports = { terminateVoiceRoom, runSfuCleanup };
