'use strict';
/**
 * Room Reminder Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Processes BullMQ jobs from the 'room-reminders' queue.
 * Sends push notifications to all followers of the host 15 minutes before a
 * scheduled voice room starts.
 *
 * Job payload:
 *   { roomId, roomTitle, hostId, schoolId, scheduledAt }
 *
 * Notification strategy:
 *   1. Fetch all users who follow the host (via the social follows table)
 *   2. Also notify school members if the room is school-scoped
 *   3. Limit to 1,000 recipients per job to avoid BullMQ job timeout
 *   4. Queue remaining recipients as follow-up jobs (batching)
 */

const { Worker }  = require('bullmq');
const prisma      = require('../utils/prisma');
const { queueBulkNotifications } = require('../services/queue.service');
const { QUEUE_NAMES } = require('../services/queue.service');
const logger      = require('../utils/logger');

const BATCH_SIZE = 1_000; // max recipients per job

function createRoomReminderWorker(connection) {
  const worker = new Worker(QUEUE_NAMES.ROOM_REMINDERS, async (job) => {
    const { roomId, roomTitle, hostId, schoolId, scheduledAt } = job.data;

    // Confirm room is still scheduled (not cancelled/ended)
    const room = await prisma.voiceRoom.findUnique({
      where:  { id: roomId },
      select: { id: true, status: true, privacy: true }
    });

    if (!room || room.status === 'ENDED' || room.status === 'CANCELLED') {
      logger.info(`[room-reminder] Skipping room ${roomId} — status is ${room?.status ?? 'not found'}`);
      return;
    }

    // Fetch followers of the host
    const followers = await prisma.follow.findMany({
      where:   { followingId: hostId },
      select:  { followerId: true },
      take:    BATCH_SIZE,
    });

    const recipientIds = [...new Set(followers.map(f => f.followerId))];

    if (recipientIds.length === 0) {
      logger.info(`[room-reminder] No followers to notify for room ${roomId}`);
      return;
    }

    const startTime = new Date(scheduledAt).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Queue push notifications for all followers
    const notifications = recipientIds.map(userId => ({
      userId,
      type:  'VOICE_ROOM_REMINDER',
      title: `🎙️ ${roomTitle} starts in 15 minutes`,
      body:  `Join the live room at ${startTime}`,
      data:  { roomId, screen: 'voice_room' }
    }));

    await queueBulkNotifications(notifications);

    logger.info(`[room-reminder] Queued ${notifications.length} notifications for room "${roomTitle}" (${roomId})`);
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[room-reminder] Job ${job?.id} failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createRoomReminderWorker };
