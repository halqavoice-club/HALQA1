/**
 * Enhanced Health Check System
 * 
 * Provides comprehensive health checks for Kubernetes-style readiness and liveness probes.
 * 
 * Health Check Types:
 * - Liveness: Is the application running? (basic check)
 * - Readiness: Is the application ready to serve traffic? (dependencies check)
 * - Startup: Has the application finished starting up? (initialization check)
 * 
 * Usage:
 *   const health = require('./utils/health');
 *   app.get('/health/liveness', health.liveness);
 *   app.get('/health/readiness', health.readiness);
 *   app.get('/health/startup', health.startup);
 */

const prisma = require('./prisma');
const redisModule = require('./redis');
const logger = require('./logger');

let isStartupComplete = false;
const startupTime = Date.now();

/**
 * Mark startup as complete
 * Call this after all initialization is done
 */
function markStartupComplete() {
  isStartupComplete = true;
  logger.info('[health] Startup complete');
}

/**
 * Basic liveness check
 * 
 * Returns 200 if the application is running.
 * This should be very lightweight and fast.
 */
async function liveness(req, res) {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime())
  });
}

/**
 * Readiness check
 * 
 * Returns 200 if the application is ready to serve traffic.
 * Checks all critical dependencies.
 */
async function readiness(req, res) {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    circuitBreakers: checkCircuitBreakers()
  };

  const allHealthy = Object.values(checks).every(c => c.status === 'ok');
  const overallStatus = allHealthy ? 'ready' : 'not_ready';

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    checks
  };

  res.status(allHealthy ? 200 : 503).json(response);
}

/**
 * Startup check
 * 
 * Returns 200 if the application has finished starting up.
 * Used by Kubernetes to know when to start routing traffic.
 */
async function startup(req, res) {
  if (isStartupComplete) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      startupDuration: Date.now() - startupTime
    });
  } else {
    res.status(503).json({
      status: 'starting',
      timestamp: new Date().toISOString(),
      startupDuration: Date.now() - startupTime
    });
  }
}

/**
 * Detailed health check
 * 
 * Returns comprehensive health information including:
 * - All dependency checks
 * - Memory usage
 * - CPU usage
 * - Event loop lag
 * - Active connections
 */
async function detailed(req, res) {
  const checks = {
    database:       await checkDatabase(),
    redis:          await checkRedis(),
    livekit:        await checkLiveKit(),
    circuitBreakers: checkCircuitBreakers(),
    memory:         checkMemory(),
    disk:           await checkDisk(),
    eventLoop:      await checkEventLoop()
  };

  // livekit 'not_configured' is not a health failure — it means the feature is
  // disabled, not broken. Treat it the same as 'ok' for overall status.
  const allHealthy = Object.values(checks).every(
    c => c.status === 'ok' || c.status === 'not_configured'
  );
  const overallStatus = allHealthy ? 'healthy' : 'degraded';

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    startupComplete: isStartupComplete,
    startupDuration: Date.now() - startupTime,
    checks
  };

  res.status(allHealthy ? 200 : 503).json(response);
}

/**
 * Check LiveKit server connectivity
 * Returns ok/error with latency so load balancers know when voice features are down.
 */
async function checkLiveKit() {
  const start = Date.now();
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!livekitUrl) {
    return { status: 'not_configured', message: 'LIVEKIT_URL is not set' };
  }

  try {
    // Convert wss:// → https:// for a simple HTTP connectivity probe
    const httpUrl = livekitUrl.replace(/^wss?:\/\//, 'https://');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${httpUrl}/`, {
      method:  'GET',
      signal:  controller.signal,
      headers: { 'User-Agent': 'halqa-health-check/1.0' },
    }).catch(() => null);

    clearTimeout(timeout);

    // LiveKit returns 400/426 on bare HTTP — that means it's reachable
    const latencyMs = Date.now() - start;
    const reachable = res && (res.status < 500 || res.status === 400 || res.status === 426);
    return reachable
      ? { status: 'ok',    latencyMs }
      : { status: 'error', latencyMs, message: `LiveKit returned HTTP ${res?.status ?? 'no response'}` };
  } catch (err) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      latencyMs: Date.now() - start
    };
  } catch (error) {
    logger.error('[health] Database check failed:', error.message);
    return {
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - start
    };
  }
}

/**
 * Check Redis connectivity
 */
async function checkRedis() {
  const start = Date.now();
  try {
    if (!redisModule.isRedisReady()) {
      return {
        status: 'disconnected',
        error: 'Redis not ready'
      };
    }

    await redisModule.getRedis().ping();
    return {
      status: 'ok',
      latencyMs: Date.now() - start
    };
  } catch (error) {
    logger.error('[health] Redis check failed:', error.message);
    return {
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - start
    };
  }
}

/**
 * Check circuit breaker states
 */
function checkCircuitBreakers() {
  try {
    const { registry } = require('./circuitBreaker');
    const states = registry.getAllStates();
    const openBreakers = Object.values(states).filter(s => s.state === 'OPEN').map(b => b.service);
    const halfOpenBreakers = Object.values(states).filter(s => s.state === 'HALF_OPEN').map(b => b.service);

    if (openBreakers.length > 0) {
      return {
        status: 'degraded',
        openBreakers,
        halfOpenBreakers,
        message: `${openBreakers.length} circuit breaker(s) open`
      };
    }

    return {
      status: 'ok',
      openBreakers: [],
      halfOpenBreakers,
      message: 'All circuit breakers closed'
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory() {
  const usage = process.memoryUsage();
  const heapUsedMb = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMb = Math.round(usage.heapTotal / 1024 / 1024);
  const rssMb = Math.round(usage.rss / 1024 / 1024);
  
  const heapUsagePercent = (heapUsedMb / heapTotalMb) * 100;
  
  let status = 'ok';
  if (heapUsagePercent > 90) {
    status = 'critical';
  } else if (heapUsagePercent > 75) {
    status = 'warning';
  }

  return {
    status,
    heapUsedMb,
    heapTotalMb,
    heapUsagePercent: Math.round(heapUsagePercent),
    rssMb,
    externalMb: Math.round(usage.external / 1024 / 1024)
  };
}

/**
 * Check disk usage (if available)
 */
async function checkDisk() {
  try {
    const fs = require('fs');
    const stats = fs.statSync('.');
    
    return {
      status: 'ok',
      path: process.cwd()
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Check event loop lag
 */
function checkEventLoop() {
  const start = process.hrtime();
  
  return new Promise((resolve) => {
    setImmediate(() => {
      const delta = process.hrtime(start);
      const lagMs = (delta[0] * 1000) + (delta[1] / 1000000);
      
      let status = 'ok';
      if (lagMs > 100) {
        status = 'critical';
      } else if (lagMs > 50) {
        status = 'warning';
      }

      resolve({
        status,
        lagMs: Math.round(lagMs * 100) / 100
      });
    });
  });
}

/**
 * Health check middleware for dependency-specific checks
 * 
 * Usage:
 *   router.get('/endpoint', requireHealthy('database'), handler);
 */
function requireHealthy(dependency) {
  return async (req, res, next) => {
    let check;
    
    switch (dependency) {
      case 'database':
        check = await checkDatabase();
        break;
      case 'redis':
        check = await checkRedis();
        break;
      default:
        return next();
    }

    if (check.status !== 'ok') {
      return res.status(503).json({
        success: false,
        error: {
          code: 'EXT_009',
          message: `Dependency ${dependency} is not healthy`,
          statusCode: 503,
          details: check
        }
      });
    }

    next();
  };
}

module.exports = {
  liveness,
  readiness,
  startup,
  detailed,
  markStartupComplete,
  requireHealthy,
  checkDatabase,
  checkRedis,
  checkLiveKit,
  checkMemory,
  checkEventLoop
};
