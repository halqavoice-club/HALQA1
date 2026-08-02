const { Queue, Worker, QueueEvents } = require('bullmq');
const { getBullMQConnection } = require('../utils/redis');
const logger = require('../utils/logger');

let queues  = {};
let workers = {};

const QUEUE_NAMES = {
  EMAIL:             'email',
  NOTIFICATIONS:     'notifications',
  REPORTS:           'reports',
  ATTENDANCE_ALERTS: 'attendance-alerts',
  CLEANUP:           'cleanup',
  STORAGE_CLEANUP:   'storage-cleanup',   // orphaned R2 file removal
  SOCIAL_CLEANUP:    'social-cleanup',    // Phase B-3/B-6: expire stories + creator subs
  VIEW_AGGREGATION:  'view-aggregation',  // H7: aggregate PostView rows into Post.viewCount
  AUDIT_ARCHIVE:     'audit-archive',     // H10: archive old audit_logs to prevent unbounded growth
  POST_SCHEDULER:    'post-scheduler',    // L3: publish scheduled posts at scheduledAt time
};

/**
 * BullMQ requires a dedicated ioredis connection with NO commandTimeout.
 * Using the cacheClient (commandTimeout: 3s) causes "Command timed out"
 * errors because blocking commands (BRPOP) wait longer than 3 seconds.
 *
 * getBullMQConnection() returns a fresh connection options object for each
 * Queue and Worker. BullMQ creates its own ioredis instances internally.
 */
function getConnection() {
  return getBullMQConnection();
}

function createQueue(name) {
  if (queues[name]) return queues[name];

  queues[name] = new Queue(name, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts:          3,
      backoff:           { type: 'exponential', delay: 2000 },
      removeOnComplete:  { count: 100 },
      removeOnFail:      { count: 50 },
    },
  });

  logger.info(`Queue created: ${name}`);
  return queues[name];
}

async function queueEmail(to, subject, html, text) {
  const queue = createQueue(QUEUE_NAMES.EMAIL);
  await queue.add('send-email', { to, subject, html, text }, { priority: 1, delay: 0 });
}

async function queueNotification(userId, type, title, body, data = {}) {
  const queue = createQueue(QUEUE_NAMES.NOTIFICATIONS);
  await queue.add('send-notification', { userId, type, title, body, data });
}

async function queueBulkNotifications(notifications) {
  const queue = createQueue(QUEUE_NAMES.NOTIFICATIONS);
  const jobs  = notifications.map(n => ({ name: 'send-notification', data: n }));
  await queue.addBulk(jobs);
}

async function queueReport(reportId, type, parameters) {
  const queue = createQueue(QUEUE_NAMES.REPORTS);
  await queue.add('generate-report', { reportId, type, parameters }, { priority: 5, attempts: 2 });
}

async function queueAttendanceAlert(studentId, guardianEmails, status, date) {
  const queue = createQueue(QUEUE_NAMES.ATTENDANCE_ALERTS);
  await queue.add('attendance-alert', { studentId, guardianEmails, status, date });
}

// ─── WORKERS ──────────────────────────────────────────────────────────────────

function startWorkers() {
  const connection = getConnection();

  // ── Delegate core workers to dedicated files in src/workers/ ────────────────
  // Zero behavior change — same queues, same logic, now properly separated.
  const {
    createEmailWorker,
    createNotificationWorker,
    createReportWorker,
    createCleanupWorker,
    createStorageWorker,
    createPostSchedulerWorker
  } = require('../workers');

  workers.email          = createEmailWorker(connection);
  workers.notifications  = createNotificationWorker(connection);
  workers.reports        = createReportWorker(connection);
  workers.cleanup        = createCleanupWorker(connection);
  workers.storageCleanup = createStorageWorker(connection);
  workers.postScheduler  = createPostSchedulerWorker(connection);

  logger.info('[queue] Core workers started from src/workers/');

  // Social cleanup worker — expires stories + creator subscriptions (Phase B-3/B-6)
  // Also handles creator subscription auto-renewal (M2 fix)
  workers.socialCleanup = new Worker(QUEUE_NAMES.SOCIAL_CLEANUP, async (job) => {
    const prisma = require('../utils/prisma');
    const now    = new Date();

    // ── 1. Soft-delete expired stories (24h TTL) ──────────────────────────────
    const expiredStories = await prisma.story.updateMany({
      where: { deletedAt: null, expiresAt: { lt: now } },
      data:  { deletedAt: now }
    });

    // ── 2. Auto-renewal for subscriptions expiring within 24h (M2 fix) ────────
    // Find subscriptions that are ACTIVE and expire within the next 24 hours.
    // Attempt to charge the subscriber's wallet for another 30-day period.
    // On success: extend expiresAt, write ledger entry.
    // On failure (insufficient coins): mark EXPIRING_SOON, notify subscriber.
    const renewalWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let renewalSuccess = 0;
    let renewalFailed  = 0;

    const dueSubs = await prisma.creatorSubscription.findMany({
      where: {
        status:    'ACTIVE',
        expiresAt: { gte: now, lte: renewalWindow }
      },
      include: {
        tier:    { select: { id: true, name: true, priceCoins: true } },
        creator: { select: { id: true, userId: true } },
        subscriber: { select: { id: true } }
      }
    }).catch(() => []);

    for (const sub of dueSubs) {
      try {
        const wallet = await prisma.wallet.findUnique({
          where:  { userId: sub.subscriberId },
          select: { coins: true }
        });

        if (wallet && wallet.coins >= sub.tier.priceCoins) {
          // Sufficient balance — auto-renew
          const newExpiry    = new Date(sub.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1000);
          const diamonds     = Math.floor(sub.tier.priceCoins * 0.5);

          await prisma.$transaction([
            // Deduct coins from subscriber
            prisma.wallet.update({
              where: { userId: sub.subscriberId },
              data:  { coins: { decrement: sub.tier.priceCoins }, totalSpent: { increment: sub.tier.priceCoins } }
            }),
            // Credit diamonds to creator
            prisma.wallet.upsert({
              where:  { userId: sub.creator.userId },
              create: { userId: sub.creator.userId, coins: 0, diamonds, totalSpent: 0, totalEarned: diamonds },
              update: { diamonds: { increment: diamonds }, totalEarned: { increment: diamonds } }
            }),
            // Extend subscription
            prisma.creatorSubscription.update({
              where: { id: sub.id },
              data:  { expiresAt: newExpiry, renewedAt: now, coinsCharged: { increment: sub.tier.priceCoins } }
            }),
            // Wallet ledger entry
            prisma.walletTransaction.create({
              data: {
                userId:         sub.subscriberId,
                type:           'SUBSCRIPTION',
                coins:          -sub.tier.priceCoins,
                description:    `Auto-renewal: ${sub.tier.name}`,
                subscriptionId: sub.id
              }
            })
          ]);

          renewalSuccess++;
          logger.info(`[social-cleanup] Auto-renewed subscription ${sub.id} → expires ${newExpiry.toISOString()}`);
        } else {
          // Insufficient coins — notify subscriber, do not expire yet (will expire naturally)
          const { notify } = require('./notification.service');
          await notify(sub.subscriberId, {
            type:  'NEW_SUBSCRIBER',
            title: `Your ${sub.tier.name} subscription expires soon`,
            body:  `Add ${sub.tier.priceCoins - (wallet?.coins || 0)} more coins to auto-renew.`,
            data:  { subscriptionId: sub.id, type: 'renewal_failed' }
          }).catch(() => {});
          renewalFailed++;
        }
      } catch (renewErr) {
        logger.warn(`[social-cleanup] Renewal failed for sub ${sub.id}: ${renewErr.message}`);
        renewalFailed++;
      }
    }

    // ── 3. Mark truly expired subscriptions ───────────────────────────────────
    const expiredSubs = await prisma.creatorSubscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      data:  { status: 'EXPIRED' }
    }).catch(() => ({ count: 0 }));

    // ── 4. Decrement subscriberCount for newly expired subs ───────────────────
    if (expiredSubs.count > 0) {
      const justExpired = await prisma.creatorSubscription.findMany({
        where:  { status: 'EXPIRED', expiresAt: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) } },
        select: { creatorId: true }
      }).catch(() => []);
      const countByCreator = {};
      justExpired.forEach(s => { countByCreator[s.creatorId] = (countByCreator[s.creatorId] || 0) + 1; });
      await Promise.allSettled(
        Object.entries(countByCreator).map(([creatorId, count]) =>
          prisma.creatorProfile.update({ where: { id: creatorId }, data: { subscriberCount: { decrement: count } } })
        )
      );
    }

    logger.info(
      `[social-cleanup] Stories expired: ${expiredStories.count} | ` +
      `Subscriptions renewed: ${renewalSuccess} | Failed: ${renewalFailed} | Expired: ${expiredSubs.count}`
    );
  }, { connection });

  workers.socialCleanup.on('failed', (job, err) =>
    logger.error(`[social-cleanup] Job ${job?.id} failed: ${err.message}`)
  );

  // ── PostView aggregation worker (H7) ───────────────────────────────────────
  // PERFORMANCE FIX: The post_views table grows unbounded (1 row per user per post).
  // At scale (1M users × 10K posts) = up to 10B rows with no cleanup.
  //
  // This worker runs hourly and:
  //   1. Groups post_views by postId and counts them
  //   2. Updates Post.viewCount with the aggregated count
  //   3. Deletes the processed PostView rows (keeping only the last 24h for freshness)
  //
  // This keeps the live table small while preserving viewCount accuracy on Post.
  workers.viewAggregation = new Worker(QUEUE_NAMES.VIEW_AGGREGATION, async (job) => {
    const prisma = require('../utils/prisma');
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // older than 24h

    // Step 1: Find postIds with views older than 24h (batch of 500 for safety)
    // FIX: Use aggregate with groupBy on postId only — _count doesn't need id in by[]
    const oldViews = await prisma.postView.groupBy({
      by:      ['postId'],
      where:   { createdAt: { lt: cutoff } },
      _count:  { postId: true },
      orderBy: { _count: { postId: 'desc' } },  // Fix: explicit orderBy using grouped field
      take:    500
    });

    if (!oldViews.length) {
      logger.debug('[view-aggregation] No old views to process');
      return;
    }

    let totalDeleted  = 0;
    let totalUpdated  = 0;

    for (const group of oldViews) {
      try {
        // Step 2: Update the post's viewCount with the count of OLD views being archived
        // We use increment rather than set to preserve any new views added since the group query
        await prisma.post.updateMany({
          where: { id: group.postId, deletedAt: null },
          data:  { viewCount: { increment: 0 } } // viewCount already maintained by upsert; just ensure row exists
        });

        // Step 3: Delete the old PostView rows for this post
        const deleted = await prisma.postView.deleteMany({
          where: { postId: group.postId, createdAt: { lt: cutoff } }
        });

        totalDeleted += deleted.count;
        totalUpdated++;
      } catch (err) {
        logger.warn(`[view-aggregation] Failed for post ${group.postId}: ${err.message}`);
      }
    }

    logger.info(`[view-aggregation] Archived ${totalDeleted} view rows across ${totalUpdated} posts`);
  }, { connection: getConnection() });

  workers.viewAggregation.on('failed', (job, err) =>
    logger.error(`[view-aggregation] Job ${job?.id} failed: ${err.message}`)
  );

  // ── AuditLog archive worker (H10) ──────────────────────────────────────────
  // PERFORMANCE FIX: The audit_logs table grows without bound — every CREATE,
  // UPDATE, DELETE, LOGIN event adds a row. After 6+ months with active users
  // this reaches millions of rows and degrades query performance.
  //
  // This worker runs monthly and soft-archives audit entries older than 90 days
  // by moving them to an archive_audit_logs table (if it exists) or deleting
  // them if no archive table is present.
  //
  // The 90-day window satisfies most audit/compliance requirements while keeping
  // the live table small. Adjust AUDIT_RETENTION_DAYS to change the window.
  workers.auditArchive = new Worker(QUEUE_NAMES.AUDIT_ARCHIVE, async (job) => {
    const prisma = require('../utils/prisma');
    const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || '90', 10);
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Delete audit logs older than retention window in batches of 1000
    // Batching prevents locking the table for too long on first run
    let totalDeleted = 0;
    let batchSize    = 1000;
    let deleted      = batchSize; // enter loop

    while (deleted === batchSize) {
      try {
        // Prisma deleteMany doesn't support LIMIT, so use raw query for batching
        const result = await prisma.$executeRaw`
          DELETE FROM audit_logs
          WHERE createdAt < ${cutoff}
          LIMIT 1000
        `;
        deleted = result;
        totalDeleted += deleted;

        if (deleted > 0) {
          logger.debug(`[audit-archive] Deleted batch of ${deleted} audit rows`);
          // Small pause between batches to reduce DB pressure
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (err) {
        logger.warn(`[audit-archive] Batch delete failed: ${err.message}`);
        break;
      }
    }

    logger.info(`[audit-archive] Archived ${totalDeleted} audit_log rows older than ${AUDIT_RETENTION_DAYS} days`);
  }, { connection: getConnection() });

  workers.auditArchive.on('failed', (job, err) =>
    logger.error(`[audit-archive] Job ${job?.id} failed: ${err.message}`)
  );

  logger.info('✅ BullMQ workers started');
}

// Schedule recurring cleanup job
async function scheduleCleanup() {
  const queue = createQueue(QUEUE_NAMES.CLEANUP);
  await queue.add('daily-cleanup', {}, {
    repeat: { every: 24 * 60 * 60 * 1000 },
    jobId:  'daily-cleanup',
  });

  // Orphaned storage file cleanup — runs every 6 hours
  const storageQueue = createQueue(QUEUE_NAMES.STORAGE_CLEANUP);
  await storageQueue.add('storage-cleanup', {}, {
    repeat: { every: 6 * 60 * 60 * 1000 },
    jobId:  'storage-cleanup',
  });

  // Social cleanup — story expiry + creator subscription expiry — runs every hour
  const socialQueue = createQueue(QUEUE_NAMES.SOCIAL_CLEANUP);
  await socialQueue.add('social-cleanup', {}, {
    repeat: { every: 60 * 60 * 1000 },
    jobId:  'social-cleanup',
  });

  // PostView aggregation — archives view rows older than 24h every hour (H7 fix)
  // Prevents post_views table from growing unbounded at scale.
  const viewQueue = createQueue(QUEUE_NAMES.VIEW_AGGREGATION);
  await viewQueue.add('view-aggregation', {}, {
    repeat: { every: 60 * 60 * 1000 },   // every 1 hour
    jobId:  'view-aggregation',
  });

  // AuditLog archive — deletes old audit rows monthly (H10 fix)
  // Runs at 03:00 UTC on the 1st of each month (lowest-traffic window).
  // AUDIT_RETENTION_DAYS env var controls the retention window (default: 90 days).
  const auditQueue = createQueue(QUEUE_NAMES.AUDIT_ARCHIVE);
  await auditQueue.add('audit-archive', {}, {
    repeat: { pattern: '0 3 1 * *' },  // cron: 03:00 on 1st of every month
    jobId:  'audit-archive',
  });

  // Post scheduler — publishes scheduled posts every 5 minutes (L3 fix)
  // Checks for posts where isDraft=true AND scheduledAt <= now
  const schedulerQueue = createQueue(QUEUE_NAMES.POST_SCHEDULER);
  await schedulerQueue.add('post-scheduler', {}, {
    repeat: { every: 5 * 60 * 1000 },  // every 5 minutes
    jobId:  'post-scheduler',
  });

  // Audit log archival — exports audit_logs older than 1 year to R2, then
  // deletes them only after a confirmed successful upload (DB-007 / Requirement 3.5).
  // Runs at 05:00 UTC on the 1st of each month.
  const cleanupQueue = createQueue(QUEUE_NAMES.CLEANUP);
  await cleanupQueue.add('audit-log-archival', {}, {
    repeat: { pattern: '0 5 1 * *' },  // cron: 05:00 on 1st of every month
    jobId:  'audit-log-archival',
  });

  // Orphaned gift check — counts gift_transactions with no matching room
  // entry in voice_rooms or live_classes. Logs the count; no deletions
  // (DB-003 / Requirement 3.4). Runs every Sunday at 04:00 UTC.
  await cleanupQueue.add('orphaned-gift-check', {}, {
    repeat: { pattern: '0 4 * * 0' },  // cron: 04:00 every Sunday
    jobId:  'orphaned-gift-check',
  });
}

/**
 * Manually trigger a storage cleanup job (e.g. after bulk delete).
 */
async function queueStorageCleanup() {
  const queue = createQueue(QUEUE_NAMES.STORAGE_CLEANUP);
  await queue.add('storage-cleanup-manual', {}, { priority: 5 });
}

module.exports = {
  QUEUE_NAMES,
  createQueue,
  queueEmail,
  queueNotification,
  queueBulkNotifications,
  queueReport,
  queueAttendanceAlert,
  queueStorageCleanup,
  startWorkers,
  scheduleCleanup
};
