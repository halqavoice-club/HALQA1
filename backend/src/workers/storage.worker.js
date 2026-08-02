'use strict';
/**
 * Storage Cleanup BullMQ Worker
 * Every 6 hours: delete orphaned R2 files whose DB records were soft-deleted.
 */
const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

function createStorageWorker(connection) {
  const worker = new Worker('storage-cleanup', async (job) => {
    const prisma = require('../utils/prisma');
    const { deleteFile, isCloudStorage } = require('../utils/storage');

    if (!isCloudStorage()) {
      logger.debug('[storage-worker] Skipped — not using cloud storage');
      return;
    }

    const cutoff  = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await prisma.fileUpload.findMany({
      where:  { deletedAt: { not: null, lt: cutoff }, url: { not: null } },
      select: { id: true, url: true },
      take:   100
    });

    if (!orphans.length) {
      logger.debug('[storage-worker] No orphaned files found');
      return;
    }

    let deleted = 0;
    let failed  = 0;

    for (const record of orphans) {
      try {
        await deleteFile(record.url);
        await prisma.fileUpload.update({ where: { id: record.id }, data: { url: null } });
        deleted++;
      } catch (err) {
        logger.warn(`[storage-worker] Failed to delete ${record.url}: ${err.message}`);
        failed++;
      }
    }

    logger.info(`[storage-worker] Deleted ${deleted} orphaned files, ${failed} failed`);
  }, { connection });

  worker.on('failed', (job, err) =>
    logger.error(`[storage-worker] Job ${job?.id} failed: ${err.message}`)
  );

  return worker;
}

module.exports = { createStorageWorker };
