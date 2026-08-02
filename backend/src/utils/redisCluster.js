/**
 * Redis Clustering Support
 * 
 * Provides Redis cluster support for high availability and scalability.
 * Supports:
 * - Redis Cluster mode
 * - Sentinel mode for high availability
 * - Automatic failover
 * - Connection pooling
 * - Cluster health monitoring
 * 
 * Usage:
 *   const redisCluster = require('./utils/redisCluster');
 *   
 *   // Initialize cluster
 *   await redisCluster.initialize();
 *   
 *   // Get cluster client
 *   const client = redisCluster.getClient();
 *   
 *   // Execute commands
 *   await client.set('key', 'value');
 *   const value = await client.get('key');
 */

const Redis = require('ioredis');
const logger = require('./logger');
const { alertCritical } = require('./alerting');

let clusterClient = null;
let sentinelClient = null;
let isClusterMode = false;
let isSentinelMode = false;

/**
 * Initialize Redis cluster or sentinel based on configuration
 */
async function initialize() {
  const clusterMode = process.env.REDIS_CLUSTER_MODE === 'true';
  const sentinelMode = process.env.REDIS_SENTINEL_MODE === 'true';

  if (clusterMode) {
    await initializeCluster();
  } else if (sentinelMode) {
    await initializeSentinel();
  } else {
    logger.info('[redisCluster] Running in single-node mode (no clustering)');
  }
}

/**
 * Initialize Redis Cluster
 */
async function initializeCluster() {
  try {
    const nodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES || '127.0.0.1:7000');
    
    clusterClient = new Redis.Cluster(nodes, {
      scaleReads: 'slave',
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      slotsRefreshTimeout: 10000
    });

    clusterClient.on('connect', () => {
      logger.info('[redisCluster] Cluster connected');
    });

    clusterClient.on('error', (error) => {
      logger.error('[redisCluster] Cluster error:', error);
    });

    clusterClient.on('node error', (error, node) => {
      logger.error(`[redisCluster] Node error ${node}:`, error);
      alertCritical('Redis cluster node error', {
        node,
        error: error.message
      });
    });

    clusterClient.on('ready', () => {
      logger.info('[redisCluster] Cluster ready');
    });

    isClusterMode = true;
    logger.info('[redisCluster] Redis cluster initialized with', nodes.length, 'nodes');
  } catch (error) {
    logger.error('[redisCluster] Failed to initialize cluster:', error);
    throw error;
  }
}

/**
 * Initialize Redis Sentinel
 */
async function initializeSentinel() {
  try {
    const sentinels = parseSentinelNodes(process.env.REDIS_SENTINELS || '127.0.0.1:26379');
    const masterName = process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster';

    sentinelClient = new Redis({
      sentinels,
      name: masterName,
      password: process.env.REDIS_PASSWORD,
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    sentinelClient.on('connect', () => {
      logger.info('[redisCluster] Sentinel connected');
    });

    sentinelClient.on('error', (error) => {
      logger.error('[redisCluster] Sentinel error:', error);
    });

    sentinelClient.on('sentinel', (type, message) => {
      logger.info(`[redisCluster] Sentinel event: ${type}`, message);
      
      if (type === '+switch-master') {
        alertCritical('Redis master switch detected', message);
      }
    });

    isSentinelMode = true;
    logger.info('[redisCluster] Redis sentinel initialized with', sentinels.length, 'sentinels');
  } catch (error) {
    logger.error('[redisCluster] Failed to initialize sentinel:', error);
    throw error;
  }
}

/**
 * Parse cluster nodes from environment variable
 * Format: host1:port1,host2:port2,host3:port3
 */
function parseClusterNodes(nodesString) {
  return nodesString.split(',').map(node => {
    const [host, port] = node.split(':');
    return { host, port: parseInt(port) || 6379 };
  });
}

/**
 * Parse sentinel nodes from environment variable
 * Format: host1:port1,host2:port2,host3:port3
 */
function parseSentinelNodes(sentinelsString) {
  return sentinelsString.split(',').map(sentinel => {
    const [host, port] = sentinel.split(':');
    return { host, port: parseInt(port) || 26379 };
  });
}

/**
 * Get cluster client
 */
function getClient() {
  if (isClusterMode) {
    return clusterClient;
  } else if (isSentinelMode) {
    return sentinelClient;
  }
  return null;
}

/**
 * Check if cluster is ready
 */
function isReady() {
  if (isClusterMode && clusterClient) {
    return clusterClient.status === 'ready';
  } else if (isSentinelMode && sentinelClient) {
    return sentinelClient.status === 'ready';
  }
  return false;
}

/**
 * Get cluster information
 */
async function getClusterInfo() {
  if (!isClusterMode || !clusterClient) {
    return { mode: 'single-node' };
  }

  try {
    const nodes = await clusterClient.nodes('master');
    const info = {
      mode: 'cluster',
      nodes: nodes.map(node => ({
        id: node.id,
        host: node.host,
        port: node.port,
        connected: node.connected,
        role: node.role
      }))
    };

    return info;
  } catch (error) {
    logger.error('[redisCluster] Failed to get cluster info:', error);
    return { mode: 'cluster', error: error.message };
  }
}

/**
 * Get sentinel information
 */
async function getSentinelInfo() {
  if (!isSentinelMode || !sentinelClient) {
    return { mode: 'single-node' };
  }

  try {
    const sentinelInfo = await sentinelClient.sentinel('sentinels', process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster');
    const masterInfo = await sentinelClient.sentinel('master', process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster');

    return {
      mode: 'sentinel',
      sentinels: sentinelInfo,
      master: masterInfo
    };
  } catch (error) {
    logger.error('[redisCluster] Failed to get sentinel info:', error);
    return { mode: 'sentinel', error: error.message };
  }
}

/**
 * Execute command on cluster with automatic retry
 */
async function executeCommand(command, ...args) {
  const client = getClient();
  if (!client) {
    throw new Error('Redis cluster not initialized');
  }

  try {
    return await client[command](...args);
  } catch (error) {
    logger.error(`[redisCluster] Command failed: ${command}`, error);
    throw error;
  }
}

/**
 * Execute command on specific node
 */
async function executeCommandOnNode(nodeId, command, ...args) {
  if (!isClusterMode || !clusterClient) {
    throw new Error('Redis cluster not initialized');
  }

  try {
    const node = clusterClient.nodes('master').find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    return await node[command](...args);
  } catch (error) {
    logger.error(`[redisCluster] Command failed on node ${nodeId}: ${command}`, error);
    throw error;
  }
}

/**
 * Get cluster health status
 */
async function getHealthStatus() {
  if (isClusterMode) {
    return await getClusterHealth();
  } else if (isSentinelMode) {
    return await getSentinelHealth();
  }
  
  return { status: 'unknown', mode: 'single-node' };
}

/**
 * Get cluster health
 */
async function getClusterHealth() {
  try {
    const nodes = await clusterClient.nodes('all');
    const healthyNodes = nodes.filter(n => n.connected).length;
    const totalNodes = nodes.length;

    const status = healthyNodes === totalNodes ? 'healthy' : 
                  healthyNodes > totalNodes / 2 ? 'degraded' : 'unhealthy';

    return {
      status,
      mode: 'cluster',
      healthyNodes,
      totalNodes,
      nodes: nodes.map(n => ({
        id: n.id,
        host: n.host,
        port: n.port,
        connected: n.connected,
        role: n.role
      }))
    };
  } catch (error) {
    return { status: 'error', mode: 'cluster', error: error.message };
  }
}

/**
 * Get sentinel health
 */
async function getSentinelHealth() {
  try {
    const masterInfo = await sentinelClient.sentinel('master', process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster');
    const sentinelInfo = await sentinelClient.sentinel('sentinels', process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster');

    const status = masterInfo && masterInfo.length > 0 ? 'healthy' : 'unhealthy';

    return {
      status,
      mode: 'sentinel',
      master: masterInfo,
      sentinels: sentinelInfo
    };
  } catch (error) {
    return { status: 'error', mode: 'sentinel', error: error.message };
  }
}

/**
 * Gracefully shutdown cluster connections
 */
async function shutdown() {
  try {
    if (clusterClient) {
      await clusterClient.quit();
      logger.info('[redisCluster] Cluster connection closed');
    }
    if (sentinelClient) {
      await sentinelClient.quit();
      logger.info('[redisCluster] Sentinel connection closed');
    }
  } catch (error) {
    logger.error('[redisCluster] Error during shutdown:', error);
  }
}

/**
 * Handle process shutdown
 */
process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

module.exports = {
  initialize,
  getClient,
  isReady,
  getClusterInfo,
  getSentinelInfo,
  executeCommand,
  executeCommandOnNode,
  getHealthStatus,
  getClusterHealth,
  getSentinelHealth,
  shutdown,
  isClusterMode: () => isClusterMode,
  isSentinelMode: () => isSentinelMode
};
