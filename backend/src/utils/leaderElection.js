/**
 * Cluster Leader Election
 * 
 * Provides leader election for distributed systems using Redis.
 * Supports:
 * - Leader election with Redis-based distributed lock
 * - Automatic failover
 * - Health monitoring
 * - Leader callbacks
 * - Cluster membership
 * 
 * Usage:
 *   const leaderElection = require('./utils/leaderElection');
 *   
 *   // Initialize
 *   await leaderElection.initialize('my-service');
 *   
 *   // Register leader callback
 *   leaderElection.onLeader(() => {
 *     console.log('I am now the leader');
 *   });
 * 
 * Environment Variables:
 *   LEADER_ELECTION_ENABLED: true/false (default: true)
 *   LEADER_ELECTION_TTL: Leader lock TTL in seconds (default: 30)
 *   LEADER_ELECTION_RENEW_INTERVAL: Renew interval in seconds (default: 10)
 */

const { v4: uuidv4 } = require('uuid');
const { getCache, setCache, deleteCache, getRedis } = require('./redis');
const logger = require('./logger');
const { alertCritical } = require('./alerting');

let enabled = process.env.LEADER_ELECTION_ENABLED !== 'false';
let nodeId = uuidv4();
let serviceName = process.env.SERVICE_NAME || 'halqa-backend';
let leaderId = null;
let isLeader = false;
let leaderLockKey = null;
let renewTimer = null;
let electionTimer = null;
let leaderCallbacks = [];
let followerCallbacks = [];

const ttl = parseInt(process.env.LEADER_ELECTION_TTL?.toString() || '30', 10) * 1000;
const renewInterval = parseInt(process.env.LEADER_ELECTION_RENEW_INTERVAL?.toString() || '10', 10) * 1000;

/**
 * Initialize leader election
 */
async function initialize(service) {
  if (!enabled) {
    logger.warn('[leaderElection] Leader election disabled');
    return;
  }

  // Skip leader election if Redis is not available (development without Redis)
  try {
    const { isRedisReady } = require('./redis');
    if (!isRedisReady()) {
      logger.warn('[leaderElection] Redis unavailable — leader election disabled (single-node mode)');
      enabled = false;
      return;
    }
  } catch {
    logger.warn('[leaderElection] Redis check failed — leader election disabled');
    enabled = false;
    return;
  }

  serviceName = service || serviceName;
  leaderLockKey = `leader:${serviceName}`;

  logger.info(`[leaderElection] Initialized with node ID: ${nodeId}, service: ${serviceName}`);

  // Start election process
  await startElection();
}

/**
 * Start election process
 */
async function startElection() {
  if (!enabled) {
    return;
  }

  try {
    // Try to become leader
    const acquired = await acquireLeadership();

    if (acquired) {
      logger.info(`[leaderElection] Node ${nodeId} became leader for service ${serviceName}`);
      isLeader = true;
      leaderId = nodeId;
      callLeaderCallbacks();
    } else {
      logger.info(`[leaderElection] Node ${nodeId} is follower for service ${serviceName}`);
      isLeader = false;
      callFollowerCallbacks();
    }

    // Start monitoring
    startMonitoring();
  } catch (error) {
    logger.error('[leaderElection] Election failed:', error);
    // Retry after delay
    electionTimer = setTimeout(startElection, 5000);
  }
}

/**
 * Acquire leadership lock
 */
async function acquireLeadership() {
  try {
    const { isRedisReady } = require('./redis');
    if (!isRedisReady()) return false;

    // Try to set lock with NX (only if not exists)
    const result = await getRedis().set(leaderLockKey, nodeId, 'EX', Math.ceil(ttl / 1000), 'NX');

    if (result === 'OK') {
      return true;
    }

    // Check if current leader is still alive
    const currentLeader = await getCache(leaderLockKey);
    if (!currentLeader) {
      // Leader lock expired, try to acquire
      const retryResult = await getRedis().set(leaderLockKey, nodeId, 'EX', Math.ceil(ttl / 1000), 'NX');
      return retryResult === 'OK';
    }

    leaderId = currentLeader;
    return false;
  } catch (error) {
    logger.error('[leaderElection] Failed to acquire leadership:', error);
    return false;
  }
}

/**
 * Renew leadership lock
 */
async function renewLeadership() {
  if (!isLeader) {
    return;
  }

  try {
    // Check if we still hold the lock
    const currentLeader = await getCache(leaderLockKey);

    if (currentLeader === nodeId) {
      // Renew the lock
      await setCache(leaderLockKey, nodeId, ttl / 1000);
      logger.debug(`[leaderElection] Renewed leadership for node ${nodeId}`);
    } else {
      // Lost leadership
      logger.warn(`[leaderElection] Node ${nodeId} lost leadership to ${currentLeader}`);
      isLeader = false;
      leaderId = currentLeader;
      callFollowerCallbacks();
      clearInterval(renewTimer);
      startMonitoring();
    }
  } catch (error) {
    logger.error('[leaderElection] Failed to renew leadership:', error);
    isLeader = false;
    callFollowerCallbacks();
    clearInterval(renewTimer);
    startMonitoring();
  }
}

/**
 * Start monitoring leader status
 */
function startMonitoring() {
  // Clear existing timers
  if (renewTimer) {
    clearInterval(renewTimer);
  }
  if (electionTimer) {
    clearTimeout(electionTimer);
  }

  if (isLeader) {
    // Renew leadership periodically
    renewTimer = setInterval(renewLeadership, renewInterval);
  } else {
    // Monitor leader and try to acquire if leader fails
    electionTimer = setTimeout(async () => {
      const currentLeader = await getCache(leaderLockKey);
      
      if (!currentLeader) {
        logger.info('[leaderElection] Leader lock expired, starting election');
        await startElection();
      } else {
        leaderId = currentLeader;
        // Continue monitoring
        startMonitoring();
      }
    }, renewInterval);
  }
}

/**
 * Step down from leadership
 */
async function stepDown() {
  if (!isLeader) {
    logger.warn('[leaderElection] Not currently leader');
    return;
  }

  try {
    const currentLeader = await getCache(leaderLockKey);

    if (currentLeader === nodeId) {
      await deleteCache(leaderLockKey);
      logger.info(`[leaderElection] Node ${nodeId} stepped down from leadership`);
    }

    isLeader = false;
    leaderId = null;

    if (renewTimer) {
      clearInterval(renewTimer);
    }

    callFollowerCallbacks();

    // Start monitoring for new leader
    startMonitoring();
  } catch (error) {
    logger.error('[leaderElection] Failed to step down:', error);
  }
}

/**
 * Get current leader
 */
async function getLeader() {
  if (!enabled) {
    return null;
  }

  try {
    const currentLeader = await getCache(leaderLockKey);
    return currentLeader;
  } catch (error) {
    logger.error('[leaderElection] Failed to get leader:', error);
    return null;
  }
}

/**
 * Check if current node is leader
 */
function isCurrentLeader() {
  return isLeader;
}

/**
 * Get cluster status
 */
async function getClusterStatus() {
  if (!enabled) {
    return { enabled: false };
  }

  return {
    enabled,
    nodeId,
    serviceName,
    isLeader,
    leaderId,
    leaderLockKey
  };
}

/**
 * Register leader callback
 */
function onLeader(callback) {
  leaderCallbacks.push(callback);
  
  // Call immediately if already leader
  if (isLeader) {
    callback();
  }
}

/**
 * Register follower callback
 */
function onFollower(callback) {
  followerCallbacks.push(callback);
  
  // Call immediately if already follower
  if (!isLeader) {
    callback();
  }
}

/**
 * Call leader callbacks
 */
function callLeaderCallbacks() {
  leaderCallbacks.forEach(callback => {
    try {
      callback();
    } catch (error) {
      logger.error('[leaderElection] Leader callback error:', error);
    }
  });
}

/**
 * Call follower callbacks
 */
function callFollowerCallbacks() {
  followerCallbacks.forEach(callback => {
    try {
      callback();
    } catch (error) {
      logger.error('[leaderElection] Follower callback error:', error);
    }
  });
}

/**
 * Get cluster members (simplified - in production, use service discovery)
 */
async function getClusterMembers() {
  // This is a simplified implementation
  // In production, integrate with service discovery (Consul, etcd, etc.)
  return [nodeId];
}

/**
 * Force new election
 */
async function forceElection() {
  if (!enabled) {
    return;
  }

  try {
    // Delete current lock to force re-election
    await deleteCache(leaderLockKey);
    logger.info('[leaderElection] Forced new election');

    // Restart election
    if (renewTimer) {
      clearInterval(renewTimer);
    }
    if (electionTimer) {
      clearTimeout(electionTimer);
    }

    await startElection();
  } catch (error) {
    logger.error('[leaderElection] Failed to force election:', error);
  }
}

/**
 * Shutdown leader election
 */
async function shutdown() {
  logger.info('[leaderElection] Shutting down leader election');

  if (isLeader) {
    await stepDown();
  }

  if (renewTimer) {
    clearInterval(renewTimer);
  }

  if (electionTimer) {
    clearTimeout(electionTimer);
  }

  leaderCallbacks = [];
  followerCallbacks = [];
}

/**
 * Express middleware for leader-only routes
 */
function leaderOnlyMiddleware() {
  return (req, res, next) => {
    if (!enabled) {
      return next(); // Allow if leader election disabled
    }

    if (isLeader) {
      return next();
    }

    return res.status(503).json({
      success: false,
      error:({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Request can only be handled by leader',
        statusCode: 503,
        leaderId
      })
    });
  };
}

/**
 * Express middleware to add cluster info to response
 */
function clusterInfoMiddleware() {
  return (req, res, next) => {
    req.clusterInfo = {
      nodeId,
      serviceName,
      isLeader,
      leaderId
    };
    next();
  };
}

module.exports = {
  initialize,
  startElection,
  acquireLeadership,
  renewLeadership,
  stepDown,
  getLeader,
  isCurrentLeader,
  getClusterStatus,
  getClusterMembers,
  forceElection,
  onLeader,
  onFollower,
  shutdown,
  leaderOnlyMiddleware,
  clusterInfoMiddleware,
  isEnabled: () => enabled
};
