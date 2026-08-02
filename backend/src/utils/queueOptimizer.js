/**
 * BullMQ Queue Optimizer with Dead Letter Queue Support
 * 
 * Enhances BullMQ queues with:
 * - Dead letter queues for failed jobs
 * - Advanced retry strategies
 * - Job monitoring and alerting
 * - Job prioritization
 * - Rate limiting per queue
 * 
 * Usage:
 *   const queueOptimizer = require('./utils/queueOptimizer');
 *   
 *   // Create optimized queue with DLQ
 *   const queue = queueOptimizer.createOptimizedQueue('email', {
 *     dlq: true,
 *     maxRetries: 5,
 *     retryDelay: 5000
 *   });
 *   
 *   // Add job with DLQ support
 *   await queue.add('send-email', data, {
 *     attempts: 3,
 *     backoff: { type: 'exponential', delay: 2000 }
 *   });
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const { getBullMQConnection } = require('./redis');
const logger = require('./logger');
const { alertCritical, alertErrorSpike } = require('./alerting');
const prom = require('./prometheus');

// Dead letter queue suffix
const DLQ_SUFFIX = ':dlq';

/**
 * Create optimized queue with dead letter queue support
 */
function createOptimizedQueue(name, options = {}) {
  const {
    enableDLQ = true,
    maxRetries = 3,
    retryDelay = 2000,
    backoffType = 'exponential',
    removeOnComplete = 100,
    removeOnFail = 50,
    defaultJobPriority = 0,
    limiter = null
  } = options;

  const connection = getBullMQConnection();

  // Create main queue
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: maxRetries,
      backoff: {
        type: backoffType,
        delay: retryDelay
      },
      removeOnComplete: { count: removeOnComplete },
      removeOnFail: { count: removeOnFail },
      priority: defaultJobPriority,
      limiter
    }
  });

  logger.info(`[queueOptimizer] Created optimized queue: ${name}`);

  // Create dead letter queue if enabled
  let dlqQueue = null;
  if (enableDLQ) {
    dlqQueue = new Queue(`${name}${DLQ_SUFFIX}`, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 }
      }
    });
    logger.info(`[queueOptimizer] Created dead letter queue: ${name}${DLQ_SUFFIX}`);
  }

  // Set up queue events for monitoring
  setupQueueMonitoring(name, queue, dlqQueue);

  return { queue, dlqQueue };
}

/**
 * Set up queue monitoring with Prometheus metrics and alerting
 */
function setupQueueMonitoring(name, queue, dlqQueue) {
  const queueEvents = new QueueEvents(name, {
    connection: getBullMQConnection()
  });

  let failedCount = 0;
  let lastAlertTime = Date.now();

  // Track completed jobs
  queueEvents.on('completed', ({ jobId }) => {
    prom.cacheHitsTotal.inc(); // Reuse cache metric for job completions
    logger.debug(`[queueOptimizer] Job completed: ${name}:${jobId}`);
  });

  // Track failed jobs
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    failedCount++;
    prom.cacheMissesTotal.inc(); // Reuse cache metric for job failures
    logger.error(`[queueOptimizer] Job failed: ${name}:${jobId}`, failedReason);

    // Alert on error spike (more than 10 failures in 1 minute)
    if (Date.now() - lastAlertTime > 60000 && failedCount > 10) {
      alertErrorSpike(failedCount, 10, 60000);
      failedCount = 0;
      lastAlertTime = Date.now();
    }
  });

  // Track delayed jobs
  queueEvents.on('delayed', ({ jobId }) => {
    logger.debug(`[queueOptimizer] Job delayed: ${name}:${jobId}`);
  });

  // Track jobs moved to DLQ
  if (dlqQueue) {
    const dlqEvents = new QueueEvents(`${name}${DLQ_SUFFIX}`, {
      connection: getBullMQConnection()
    });

    dlqEvents.on('waiting', ({ jobId }) => {
      logger.warn(`[queueOptimizer] Job moved to DLQ: ${name}:${jobId}`);
      alertCritical(`Job moved to DLQ in queue ${name}`, {
        jobId,
        queue: name
      });
    });
  }
}

/**
 * Create optimized worker with enhanced error handling
 */
function createOptimizedWorker(name, processor, options = {}) {
  const {
    concurrency = 5,
    limiter = null,
    enableDLQ = true
  } = options;

  const connection = getBullMQConnection();

  const worker = new Worker(name, processor, {
    connection,
    concurrency,
    limiter
  });

  // Enhanced error handling
  worker.on('failed', (job, error) => {
    logger.error(`[queueOptimizer] Worker failed for job ${job?.id}:`, error.message);

    // Move to DLQ after max retries
    if (job?.attemptsMade >= job?.opts?.attempts && enableDLQ) {
      moveToDLQ(name, job);
    }
  });

  worker.on('completed', (job) => {
    logger.debug(`[queueOptimizer] Worker completed job ${job.id}`);
  });

  logger.info(`[queueOptimizer] Created optimized worker: ${name}`);
  return worker;
}

/**
 * Move failed job to dead letter queue
 */
async function moveToDLQ(queueName, job) {
  try {
    const dlqQueue = new Queue(`${queueName}${DLQ_SUFFIX}`, {
      connection: getBullMQConnection()
    });

    await dlqQueue.add(
      job.name,
      {
        originalJobId: job.id,
        originalData: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: new Date().toISOString()
      },
      {
        priority: job.opts.priority || 0,
        delay: 0
      }
    );

    logger.info(`[queueOptimizer] Moved job ${job.id} to DLQ: ${queueName}${DLQ_SUFFIX}`);
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to move job to DLQ:`, error);
  }
}

/**
 * Retry jobs from dead letter queue
 */
async function retryDLQJobs(queueName, options = {}) {
  const {
    maxAge = 3600000, // 1 hour
    limit = 100
  } = options;

  try {
    const dlqQueue = new Queue(`${queueName}${DLQ_SUFFIX}`, {
      connection: getBullMQConnection()
    });

    const mainQueue = new Queue(queueName, {
      connection: getBullMQConnection()
    });

    const jobs = await dlqQueue.getJobs(['waiting', 'delayed'], 0, limit);

    let retriedCount = 0;
    for (const job of jobs) {
      const jobAge = Date.now() - new Date(job.timestamp).getTime();
      
      if (jobAge < maxAge) {
        await mainQueue.add(
          job.name,
          job.data.originalData,
          {
            priority: job.opts.priority,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }
          }
        );
        
        await job.remove();
        retriedCount++;
      }
    }

    logger.info(`[queueOptimizer] Retried ${retriedCount} jobs from DLQ: ${queueName}`);
    return retriedCount;
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to retry DLQ jobs:`, error);
    return 0;
  }
}

/**
 * Get queue statistics
 */
async function getQueueStats(queueName) {
  try {
    const queue = new Queue(queueName, {
      connection: getBullMQConnection()
    });

    const dlqQueue = new Queue(`${queueName}${DLQ_SUFFIX}`, {
      connection: getBullMQConnection()
    });

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    const dlqWaiting = await dlqQueue.getWaitingCount();

    return {
      queue: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      dlqWaiting,
      total: waiting + active + completed + failed + delayed
    };
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to get queue stats:`, error);
    return null;
  }
}

/**
 * Get all queue statistics
 */
async function getAllQueueStats(queueNames) {
  const stats = {};
  
  for (const name of queueNames) {
    stats[name] = await getQueueStats(name);
  }

  return stats;
}

/**
 * Pause queue (stop processing new jobs)
 */
async function pauseQueue(queueName) {
  try {
    const queue = new Queue(queueName, {
      connection: getBullMQConnection()
    });

    await queue.pause();
    logger.info(`[queueOptimizer] Paused queue: ${queueName}`);
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to pause queue:`, error);
  }
}

/**
 * Resume queue (start processing jobs)
 */
async function resumeQueue(queueName) {
  try {
    const queue = new Queue(queueName, {
      connection: getBullMQConnection()
    });

    await queue.resume();
    logger.info(`[queueOptimizer] Resumed queue: ${queueName}`);
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to resume queue:`, error);
  }
}

/**
 * Clean up old jobs from queue
 */
async function cleanQueue(queueName, options = {}) {
  const {
    age = 86400000, // 24 hours
    limit = 1000
  } = options;

  try {
    const queue = new Queue(queueName, {
      connection: getBullMQConnection()
    });

    const removed = await queue.clean(age, limit);
    logger.info(`[queueOptimizer] Cleaned ${removed} jobs from queue: ${queueName}`);
    return removed;
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to clean queue:`, error);
    return 0;
  }
}

/**
 * Clean up dead letter queue
 */
async function cleanDLQ(queueName, options = {}) {
  const {
    age = 604800000, // 7 days
    limit = 1000
  } = options;

  try {
    const dlqQueue = new Queue(`${queueName}${DLQ_SUFFIX}`, {
      connection: getBullMQConnection()
    });

    const removed = await dlqQueue.clean(age, limit);
    logger.info(`[queueOptimizer] Cleaned ${removed} jobs from DLQ: ${queueName}`);
    return removed;
  } catch (error) {
    logger.error(`[queueOptimizer] Failed to clean DLQ:`, error);
    return 0;
  }
}

/**
 * Pre-configured queue optimizers for common use cases
 */

// Email queue - high priority, low latency
const emailQueueConfig = {
  enableDLQ: true,
  maxRetries: 3,
  retryDelay: 5000,
  backoffType: 'exponential',
  removeOnComplete: 50,
  removeOnFail: 20,
  defaultJobPriority: 1,
  limiter: {
    max: 100,
    duration: 60000 // 100 emails per minute
  }
};

// Notification queue - medium priority
const notificationQueueConfig = {
  enableDLQ: true,
  maxRetries: 5,
  retryDelay: 3000,
  backoffType: 'exponential',
  removeOnComplete: 100,
  removeOnFail: 50,
  defaultJobPriority: 5,
  limiter: {
    max: 500,
    duration: 60000 // 500 notifications per minute
  }
};

// Report queue - low priority, high latency tolerance
const reportQueueConfig = {
  enableDLQ: true,
  maxRetries: 2,
  retryDelay: 10000,
  backoffType: 'fixed',
  removeOnComplete: 10,
  removeOnFail: 10,
  defaultJobPriority: 10,
  limiter: {
    max: 10,
    duration: 60000 // 10 reports per minute
  }
};

// Cleanup queue - very low priority
const cleanupQueueConfig = {
  enableDLQ: false,
  maxRetries: 1,
  retryDelay: 60000,
  backoffType: 'fixed',
  removeOnComplete: 5,
  removeOnFail: 5,
  defaultJobPriority: 20,
  limiter: {
    max: 5,
    duration: 60000 // 5 cleanup jobs per minute
  }
};

module.exports = {
  createOptimizedQueue,
  createOptimizedWorker,
  moveToDLQ,
  retryDLQJobs,
  getQueueStats,
  getAllQueueStats,
  pauseQueue,
  resumeQueue,
  cleanQueue,
  cleanDLQ,
  setupQueueMonitoring,
  emailQueueConfig,
  notificationQueueConfig,
  reportQueueConfig,
  cleanupQueueConfig,
  DLQ_SUFFIX
};
