'use strict';
/**
 * Cleanup BullMQ Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Scheduled housekeeping tasks:
 *   1. Delete expired OTP codes                  (DB-005)  — daily
 *   2. Delete revoked/expired refresh tokens     (DB-006)  — daily
 *   3. Mark overdue fee records                            — daily
 *   4. Soft-delete stale read notifications      (DB-004)  — daily
 *   5. Archive old audit logs to R2              (DB-007)  — monthly (1st at 05:00 UTC)
 *   6. Count orphaned gift transactions          (DB-003)  — weekly  (Sunday at 04:00 UTC)
 */
const { Worker }   = require('bullmq');
const { promisify } = require('util');
const zlib         = require('zlib');
const logger       = require('../utils/logger');

const gzip = promisify(zlib.gzip);

// DB-004: Notification retention policy.
// Read notifications older than this age are deleted to prevent unbounded
// table growth. Critical types (SYSTEM, COINS_PURCHASED, GRADE) are kept
// for compliance and dispute resolution regardless of age.
const NOTIFICATION_RETENTION_DAYS    = 90;
const NOTIFICATION_KEEP_TYPES        = ['SYSTEM', 'COINS_PURCHASED', 'GRADE'];

// DB-007: Audit log retention — export rows older than 1 year to R2, then delete.
const AUDIT_LOG_RETENTION_YEARS = 1;

// ─── Job handlers ─────────────────────────────────────────────────────────────

/**
 * Daily cleanup: OTPs, refresh tokens, fee records, old notifications.
 */
async function runDailyCleanup() {
  const prisma = require('../utils/prisma');

  const now           = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [deletedOtps, deletedTokens, overdueResult, deletedNotifications] = await Promise.all([

    // 1. Delete expired OTP codes (DB-005)
    // Keeps only OTPs that are still valid AND unused — everything else purged.
    prisma.otpCode.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { isUsed: true }
        ]
      }
    }),

    // 2. Delete expired or revoked refresh tokens (DB-006)
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { isRevoked: true }] }
    }),

    // 3. Mark overdue fee records
    prisma.feeRecord.updateMany({
      where: { status: 'PENDING', dueDate: { lt: now } },
      data:  { status: 'OVERDUE' }
    }),

    // 4. Delete old read notifications (DB-004)
    // Only deletes READ notifications older than 90 days.
    // Keeps SYSTEM / COINS_PURCHASED / GRADE regardless of age.
    // Keeps ALL unread notifications regardless of age.
    prisma.notification.deleteMany({
      where: {
        isRead:    true,
        createdAt: { lt: ninetyDaysAgo },
        type:      { notIn: NOTIFICATION_KEEP_TYPES }
      }
    })
  ]);

  logger.info(
    `[cleanup-worker] OTPs removed: ${deletedOtps.count} | ` +
    `Tokens removed: ${deletedTokens.count} | ` +
    `Fees marked overdue: ${overdueResult.count} | ` +
    `Notifications pruned: ${deletedNotifications.count}`
  );
}

/**
 * Monthly audit log archival (DB-007).
 *
 * Queries audit_logs where createdAt < now - 1 year, exports them as
 * gzipped JSON to R2, and only deletes the exported rows if the upload
 * succeeds. If the upload fails, no rows are deleted and the error is logged.
 *
 * Requirement 3.5: delete only after confirmed successful export.
 * Requirement 3.6: log job name, error message, stack trace, UTC timestamp on failure.
 */
async function runAuditLogArchival() {
  const prisma                  = require('../utils/prisma');
  const { getS3Client, R2_BUCKET } = require('../utils/storage');
  const { PutObjectCommand }    = require('@aws-sdk/client-s3');

  const now     = new Date();
  const cutoff  = new Date(now.getTime() - AUDIT_LOG_RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000);

  // Fetch all audit log rows older than 1 year
  const rows = await prisma.$queryRaw`
    SELECT * FROM audit_logs WHERE createdAt < ${cutoff}
  `;

  if (!rows || rows.length === 0) {
    logger.info('[cleanup-worker] audit-log-archival: no rows older than 1 year — nothing to archive');
    return;
  }

  // Serialise and gzip the rows
  const jsonBuffer  = Buffer.from(JSON.stringify(rows));
  const gzipBuffer  = await gzip(jsonBuffer);

  // Build a deterministic R2 key: audit-archive/YYYY-MM-DD.json.gz
  const dateTag = now.toISOString().slice(0, 10);
  const r2Key   = `audit-archive/${dateTag}.json.gz`;

  // Upload to R2
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket:        R2_BUCKET(),
    Key:           r2Key,
    Body:          gzipBuffer,
    ContentType:   'application/gzip',
    ContentLength: gzipBuffer.length,
  }));

  logger.info(`[cleanup-worker] audit-log-archival: uploaded ${rows.length} rows → R2 key "${r2Key}"`);

  // Only delete rows after confirmed successful upload (Requirement 3.5)
  const deleteResult = await prisma.$executeRaw`
    DELETE FROM audit_logs WHERE createdAt < ${cutoff}
  `;

  logger.info(`[cleanup-worker] audit-log-archival: deleted ${deleteResult} archived rows from MySQL`);
}

/**
 * Weekly orphaned gift transaction check (DB-003).
 *
 * Counts gift_transactions whose roomId does not exist in the appropriate
 * room table (voice_rooms for roomType='voice', live_classes for
 * roomType='live_class'). Logs the count — does NOT delete anything.
 *
 * Requirement 3.4: log count, no deletion.
 */
async function runOrphanedGiftCheck() {
  const prisma = require('../utils/prisma');

  // Count orphaned gifts for voice rooms
  const voiceOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt
    FROM gift_transactions gt
    WHERE gt.roomType = 'voice'
      AND NOT EXISTS (
        SELECT 1 FROM voice_rooms vr WHERE vr.id = gt.roomId
      )
  `;

  // Count orphaned gifts for live classes
  const liveClassOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt
    FROM gift_transactions gt
    WHERE gt.roomType = 'live_class'
      AND NOT EXISTS (
        SELECT 1 FROM live_classes lc WHERE lc.id = gt.roomId
      )
  `;

  const voiceCount     = Number(voiceOrphans[0]?.cnt     ?? 0);
  const liveClassCount = Number(liveClassOrphans[0]?.cnt ?? 0);
  const totalOrphans   = voiceCount + liveClassCount;

  logger.info(
    `[cleanup-worker] orphaned-gift-check: ` +
    `voice=${voiceCount} live_class=${liveClassCount} total=${totalOrphans} ` +
    `(no records deleted — observability only)`
  );
}

// ─── Worker factory ───────────────────────────────────────────────────────────

function createCleanupWorker(connection) {
  const worker = new Worker('cleanup', async (job) => {
    // Dispatch to the appropriate handler based on job name.
    // Each handler is wrapped in try/catch so one failing job does not
    // prevent other scheduled jobs from running (Requirement 3.6).
    const utcTimestamp = new Date().toUTCString();

    if (job.name === 'audit-log-archival') {
      try {
        await runAuditLogArchival();
      } catch (err) {
        logger.error(
          `[cleanup-worker] job="${job.name}" error="${err.message}" ` +
          `stack="${err.stack}" utc="${utcTimestamp}"`
        );
        // Do not rethrow — continue without crashing the worker (Requirement 3.6)
      }
      return;
    }

    if (job.name === 'orphaned-gift-check') {
      try {
        await runOrphanedGiftCheck();
      } catch (err) {
        logger.error(
          `[cleanup-worker] job="${job.name}" error="${err.message}" ` +
          `stack="${err.stack}" utc="${utcTimestamp}"`
        );
      }
      return;
    }

    // Default: daily cleanup (handles 'daily-cleanup' and any unrecognised job names)
    try {
      await runDailyCleanup();
    } catch (err) {
      logger.error(
        `[cleanup-worker] job="${job.name ?? 'daily-cleanup'}" error="${err.message}" ` +
        `stack="${err.stack}" utc="${utcTimestamp}"`
      );
    }
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[cleanup-worker] Job ${job?.id} (${job?.name}) failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createCleanupWorker };
