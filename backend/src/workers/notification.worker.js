'use strict';
/**
 * Notification BullMQ Worker
 * Saves notifications to DB, delivers via Socket.IO (in-app),
 * and sends push notifications via FCM if the user has a registered token.
 */
const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

function createNotificationWorker(connection) {
  const worker = new Worker('notifications', async (job) => {
    const prisma  = require('../utils/prisma');
    const { getIo } = require('../sockets');
    const { sendPush } = require('../utils/push');
    const { userId, type, title, body, data } = job.data;

    // 1. Save to database
    const notification = await prisma.notification.create({
      data: { userId, type, title, body, data }
    });

    // 2. Deliver in-app via Socket.IO (real-time, if user is online)
    const io = getIo();
    if (io) io.to(`user:${userId}`).emit('notification:new', notification);

    // 3. Send push notification via FCM (if user has a device token)
    try {
      const user = await prisma.user.findUnique({
        where:  { id: userId },
        select: { fcmToken: true }
      });

      if (user?.fcmToken) {
        const result = await sendPush(user.fcmToken, { title, body, data, type });

        // If token is expired/invalid, clear it from the DB so we don't retry
        if (result === 'EXPIRED') {
          await prisma.user.update({
            where: { id: userId },
            data:  { fcmToken: null }
          }).catch(() => {}); // non-fatal
          logger.debug(`[notification-worker] Cleared expired FCM token for user ${userId}`);
        }
      }
    } catch (pushErr) {
      // Push failure never blocks the notification — in-app delivery already done
      logger.warn(`[notification-worker] Push failed for user ${userId}: ${pushErr.message}`);
    }

  }, { connection, concurrency: 10 });

  worker.on('failed', (job, err) =>
    logger.error(`[notification-worker] Job ${job?.id} failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createNotificationWorker };
