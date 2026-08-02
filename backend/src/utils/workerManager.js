/**
 * Background Worker Manager
 * 
 * Enhanced worker management with:
 * - Worker pool management
 * - Health monitoring
 * - Graceful shutdown
 * - Worker statistics
 * - Auto-restart on failure
 * 
 * Usage:
 *   const workerManager = require('./utils/workerManager');
 *   
 *   // Create worker pool
 *   const pool = workerManager.createPool('email', {
 *     concurrency: 5,
 *     maxRetries: 3
 *   });
 *   
 *   // Add worker
 *   pool.addWorker(async (job) => {
 *     // Process job
 *   });
 */

const { Worker } = require('bullmq');
const { getBullMQConnection } = require('./redis');
const logger = require('./logger');
const { alertCritical } = require('./alerting');
const prom = require('./prometheus');

const workerPools = new Map();
const workerStats = new Map();

/**
 * Create worker pool with enhanced features
 */
function createPool(queueName, options = {}) {
  const {
    concurrency = 5,
    maxRetries = 3,
    retryDelay = 5000,
    autoRestart = true,
    restartDelay = 10000,
    healthCheckInterval = 30000
  } = options;

  const pool = {
    name: queueName,
    workers: [],
    concurrency,
    maxRetries,
    retryDelay,
    autoRestart,
    restartDelay,
    healthCheckInterval,
    isRunning: false,
    processor: null,
    healthCheckTimer: null,
    stats: {
      jobsProcessed: 0,
      jobsFailed: 0,
      jobsSucceeded: 0,
      lastJobTime: null,
      startTime: null
    }
  };

  workerPools.set(queueName, pool);
  workerStats.set(queueName, pool.stats);

  logger.info(`[workerManager] Created worker pool: ${queueName}`);
  return pool;
}

/**
 * Add worker to pool
 */
function addWorker(poolName, processor, options = {}) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    throw new Error(`Worker pool ${poolName} not found`);
  }

  pool.processor = processor;

  const connection = getBullMQConnection();

  const worker = new Worker(poolName, processor, {
    connection,
    concurrency: pool.concurrency
  });

  // Enhanced error handling
  worker.on('failed', (job, error) => {
    pool.stats.jobsFailed++;
    logger.error(`[workerManager] Worker failed for job ${job?.id}:`, error.message);

    // Alert on critical failures
    if (pool.stats.jobsFailed > 10 && pool.stats.jobsFailed % 10 === 0) {
      alertCritical(`High failure rate in worker pool ${poolName}`, {
        failedJobs: pool.stats.jobsFailed,
        lastError: error.message
      });
    }
  });

  worker.on('completed', (job) => {
    pool.stats.jobsSucceeded++;
    pool.stats.jobsProcessed++;
    pool.stats.lastJobTime = new Date();
    logger.debug(`[workerManager] Worker completed job ${job.id}`);
  });

  worker.on('error', (error) => {
    logger.error(`[workerManager] Worker error in pool ${poolName}:`, error);
  });

  pool.workers.push(worker);
  pool.isRunning = true;
  pool.stats.startTime = new Date();

  // Start health check
  startHealthCheck(poolName);

  logger.info(`[workerManager] Added worker to pool: ${poolName}`);
  return worker;
}

/**
 * Start health check for worker pool
 */
function startHealthCheck(poolName) {
  const pool = workerPools.get(poolName);
  if (!pool || pool.healthCheckTimer) {
    return;
  }

  pool.healthCheckTimer = setInterval(() => {
    checkWorkerHealth(poolName);
  }, pool.healthCheckInterval);
}

/**
 * Check worker health
 */
function checkWorkerHealth(poolName) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    return;
  }

  const now = Date.now();
  const timeSinceLastJob = pool.stats.lastJobTime 
    ? now - pool.stats.lastJobTime.getTime() 
    : Infinity;

  // Check if worker is stuck (no jobs processed in 5 minutes)
  if (timeSinceLastJob > 300000 && pool.stats.jobsProcessed > 0) {
    logger.warn(`[workerManager] Worker pool ${poolName} may be stuck`);
    
    if (pool.autoRestart) {
      logger.info(`[workerManager] Auto-restarting worker pool: ${poolName}`);
      restartPool(poolName);
    }
  }

  // Log statistics
  logger.debug(`[workerManager] Pool ${poolName} stats:`, {
    processed: pool.stats.jobsProcessed,
    succeeded: pool.stats.jobsSucceeded,
    failed: pool.stats.jobsFailed,
    uptime: pool.stats.startTime ? Math.round((now - pool.stats.startTime.getTime()) / 1000) : 0
  });
}

/**
 * Restart worker pool
 */
async function restartPool(poolName) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    return;
  }

  logger.info(`[workerManager] Restarting worker pool: ${poolName}`);

  // Stop existing workers
  await stopPool(poolName);

  // Wait before restart
  await new Promise(resolve => setTimeout(resolve, pool.restartDelay));

  // Restart workers
  if (pool.processor) {
    addWorker(poolName, pool.processor, {
      concurrency: pool.concurrency
    });
  }
}

/**
 * Stop worker pool
 */
async function stopPool(poolName) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    return;
  }

  logger.info(`[workerManager] Stopping worker pool: ${poolName}`);

  // Clear health check timer
  if (pool.healthCheckTimer) {
    clearInterval(pool.healthCheckTimer);
    pool.healthCheckTimer = null;
  }

  // Close all workers
  await Promise.all(
    pool.workers.map(worker => worker.close())
  );

  pool.workers = [];
  pool.isRunning = false;

  logger.info(`[workerManager] Stopped worker pool: ${poolName}`);
}

/**
 * Get pool statistics
 */
function getPoolStats(poolName) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    return null;
  }

  return {
    name: pool.name,
    isRunning: pool.isRunning,
    workers: pool.workers.length,
    concurrency: pool.concurrency,
    ...pool.stats
  };
}

/**
 * Get all pool statistics
 */
function getAllPoolStats() {
  const stats = {};
  workerPools.forEach((pool, name) => {
    stats[name] = getPoolStats(name);
  });
  return stats;
}

/**
 * Scale worker pool (adjust concurrency)
 */
function scalePool(poolName, newConcurrency) {
  const pool = workerPools.get(poolName);
  if (!pool) {
    throw new Error(`Worker pool ${poolName} not found`);
  }

  logger.info(`[workerManager] Scaling pool ${poolName} from ${pool.concurrency} to ${newConcurrency}`);

  // Stop existing workers
  stopPool(poolName).then(() => {
    // Update concurrency
    pool.concurrency = newConcurrency;

    // Restart with new concurrency
    if (pool.processor) {
      addWorker(poolName, pool.processor, {
        concurrency: newConcurrency
      });
    }
  });
}

/**
 * Gracefully shutdown all worker pools
 */
async function shutdownAll() {
  logger.info('[workerManager] Shutting down all worker pools');

  const poolNames = Array.from(workerPools.keys());
  await Promise.all(
    poolNames.map(name => stopPool(name))
  );

  logger.info('[workerManager] All worker pools shut down');
}

/**
 * Handle process shutdown
 */
process.on('SIGTERM', async () => {
  await shutdownAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownAll();
  process.exit(0);
});

/**
 * Worker wrapper with enhanced error handling
 */
function createWorkerWrapper(queueName, processor, options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 5000,
    timeout = 30000
  } = options;

  return async (job) => {
    let attempts = 0;
    let lastError = null;

    while (attempts <= maxRetries) {
      try {
        // Add timeout to prevent hanging jobs
        const result = await Promise.race([
          processor(job),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Worker timeout')), timeout)
          )
        ]);

        return result;
      } catch (error) {
        lastError = error;
        attempts++;

        if (attempts <= maxRetries) {
          logger.warn(`[workerManager] Job ${job.id} failed (attempt ${attempts}/${maxRetries}), retrying in ${retryDelay}ms:`, error.message);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          logger.error(`[workerManager] Job ${job.id} failed after ${maxRetries} attempts:`, error.message);
          throw error;
        }
      }
    }

    throw lastError;
  };
}

/**
 * Pre-configured worker pools
 */

// Email worker pool - high priority, low latency
const emailPoolConfig = {
  concurrency: 10,
  maxRetries: 3,
  retryDelay: 5000,
  autoRestart: true,
  restartDelay: 5000,
  healthCheckInterval: 30000
};

// Notification worker pool - medium priority
const notificationPoolConfig = {
  concurrency: 20,
  maxRetries: 5,
  retryDelay: 3000,
  autoRestart: true,
  restartDelay: 10000,
  healthCheckInterval: 30000
};

// Report worker pool - low priority, high latency tolerance
const reportPoolConfig = {
  concurrency: 3,
  maxRetries: 2,
  retryDelay: 10000,
  autoRestart: true,
  restartDelay: 30000,
  healthCheckInterval: 60000
};

// Cleanup worker pool - very low priority
const cleanupPoolConfig = {
  concurrency: 2,
  maxRetries: 1,
  retryDelay: 60000,
  autoRestart: true,
  restartDelay: 60000,
  healthCheckInterval: 120000
};

module.exports = {
  createPool,
  addWorker,
  stopPool,
  restartPool,
  getPoolStats,
  getAllPoolStats,
  scalePool,
  shutdownAll,
  createWorkerWrapper,
  startHealthCheck,
  checkWorkerHealth,
  emailPoolConfig,
  notificationPoolConfig,
  reportPoolConfig,
  cleanupPoolConfig
};
