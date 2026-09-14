'use strict';
/**
 * Live Class Auto-End Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Sprint 3 fix: moves auto-end timers from in-process setTimeout (lost on
 * server restart) to a BullMQ delayed job (durable — survives restarts,
 * works across multiple processes/pods).
 *
 * Queue name : 'live-class-autoend'
 * Job name   : 'autoend'
 * Job payload: { liveClassId: string }
 * Job ID     : `autoend:${liveClassId}` — one job per live class (deduped)
 *
 * On server restart the queue is rehydrated from Redis — any live classes
 * that were LIVE with a duration will have their jobs recreated by
 * rehydrateLiveClassAutoEndJobs() called from app.js startup.
 */

const { Worker } = require('bullmq');
const prisma     = require('../utils/prisma');
const { getIo }  = require('../sockets');
const { broadcastLiveEnd } = require('../utils/feedLive');
const logger     = require('../utils/logger');

const QUEUE_NAME = 'live-class-autoend';

// ─── End a live class (shared logic, same as _endLiveClassById in controller) ─
async function endLiveClassById(liveClassId) {
  const now = new Date();

  // Check it is still LIVE (may have been ended manually)
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id, status FROM live_classes WHERE id = ? AND deletedAt IS NULL LIMIT 1',
    liveClassId
  );
  if (!rows || rows.length === 0 || rows[0].status !== 'LIVE') {
    logger.info(`[autoend-worker] ${liveClassId} is not LIVE — skipping`);
    return;
  }

  // Mark ended
  await prisma.$executeRawUnsafe(
    'UPDATE live_classes SET status = ?, endedAt = NOW(), updatedAt = NOW() WHERE id = ?',
    'ENDED', liveClassId
  );

  // Deactivate all active participants
  const active = await prisma.liveClassParticipant.findMany({
    where: { liveClassId, isActive: true },
  });
  if (active.length > 0) {
    await prisma.$transaction(
      active.map(p =>
        prisma.liveClassParticipant.update({
          where: { id: p.id },
          data: {
            isActive:      false,
            leftAt:        now,
            totalDuration: p.totalDuration + Math.floor(
              (now.getTime() - new Date(p.joinedAt).getTime()) / 1000
            ),
          },
        })
      )
    );
  }

  // Close open attendance records
  const attendances = await prisma.liveClassAttendance.findMany({
    where: { liveClassId, leftAt: null },
  });
  await Promise.all(
    attendances.map(a =>
      prisma.liveClassAttendance.update({
        where: { id: a.id },
        data: {
          leftAt:       now,
          totalMinutes: Math.floor(
            (now.getTime() - new Date(a.joinedAt).getTime()) / 60_000
          ),
          status: 'PRESENT',
        },
      })
    )
  );

  // Broadcast end to room members
  const io = getIo();
  if (io) io.to(`liveclass:${liveClassId}`).emit('liveclass:ended', { liveClassId });
  broadcastLiveEnd('live_class', liveClassId);

  logger.info(`[autoend-worker] Live class ${liveClassId} auto-ended by BullMQ job`);
}

function createLiveClassAutoEndWorker(connection) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { liveClassId } = job.data;
      if (!liveClassId) {
        logger.warn('[autoend-worker] Job missing liveClassId — skipping');
        return;
      }
      await endLiveClassById(liveClassId);
    },
    {
      connection,
      concurrency: 5,  // process up to 5 auto-ends simultaneously
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[autoend-worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[autoend-worker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}

module.exports = { createLiveClassAutoEndWorker, QUEUE_NAME };
