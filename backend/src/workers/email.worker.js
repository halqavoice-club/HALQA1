'use strict';
/**
 * Email BullMQ Worker
 * Processes jobs from the 'email' queue.
 * Sends emails via nodemailer (configured in utils/email.js).
 */
const { Worker } = require('bullmq');
const logger     = require('../utils/logger');

function createEmailWorker(connection) {
  const worker = new Worker('email', async (job) => {
    const { sendEmail } = require('../utils/email');
    const { to, subject, html, text } = job.data;
    logger.info(`[email-worker] Processing job ${job.id} → ${to}`);
    await sendEmail({ to, subject, html, text });
  }, { connection, concurrency: 5 });

  worker.on('completed', job => logger.debug(`[email-worker] Job ${job.id} completed`));
  worker.on('failed',    (job, err) => logger.error(`[email-worker] Job ${job?.id} failed: ${err.message}`));

  return worker;
}

module.exports = { createEmailWorker };
