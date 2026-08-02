'use strict';

/**
 * Redis Utility — Redis-only, no in-memory fallback
 * ─────────────────────────────────────────────────────────────────────────────
 * Three dedicated ioredis connections:
 *
 *   pubClient   — Socket.IO Redis adapter (publish side)
 *   subClient   — Socket.IO Redis adapter (subscribe side, blocked in sub mode)
 *   cacheClient — All cache operations (setCache / getCache / deleteCache)
 *
 * Design decisions:
 *   • NO in-memory fallback — Redis is required. If it is unavailable the app
 *     refuses to start (fail-fast). This guarantees a single source of truth
 *     across all server instances and prevents split-brain cache state.
 *   • enableOfflineQueue: false — commands are rejected immediately when the
 *     client is not connected instead of silently buffering in memory.
 *   • commandTimeout: 3 s — prevents slow Redis from hanging HTTP requests.
 *   • Exponential back-off retry (200 ms → 30 s, max 10 attempts in prod).
 *   • TLS support via REDIS_TLS=true for Redis Cloud / Upstash / ElastiCache.
 *
 * Environment variables:
 *   REDIS_URL   redis://localhost:6379   (required — no default in production)
 *   REDIS_TLS   true | false             (default: false)
 *   NODE_ENV    development | production
 * ─────────────────────────────────────────────────────────────────────────────
 */

const Redis  = require('ioredis');
const logger = require('./logger');

// ─── Module-level client references ──────────────────────────────────────────
let pubClient   = null;
let subClient   = null;
let cacheClient = null;

// ─── BullMQ connection factory ────────────────────────────────────────────────
/**
 * Create a dedicated ioredis connection for BullMQ.
 *
 * WHY a separate factory:
 *   BullMQ uses blocking Redis commands (BRPOP, BLMOVE) that intentionally
 *   wait longer than the 3-second commandTimeout used by cacheClient.
 *   Sharing cacheClient with BullMQ causes repeated "Command timed out" errors.
 *
 *   This factory creates fresh connections with NO commandTimeout so BullMQ
 *   can block as long as it needs. Each Queue and Worker gets its own
 *   connection via this factory (BullMQ docs recommend this pattern).
 *
 * @returns {object} ioredis connection options accepted by BullMQ
 */
function getBullMQConnection() {
  const url    = process.env.REDIS_URL;
  const isProd = process.env.NODE_ENV === 'production';

  if (!url) throw new Error('REDIS_URL is not set');

  // Return a connection options object — BullMQ creates its own ioredis instances
  // from this config. Each Queue/Worker gets a fresh connection.
  return {
    // Parse the redis:// URL into host/port/password
    ...parseRedisUrl(url),
    maxRetriesPerRequest: null,   // REQUIRED by BullMQ — never stop retrying
    enableOfflineQueue:   false,
    connectTimeout:       5_000,
    // NO commandTimeout — blocking commands must wait indefinitely
    ...(process.env.REDIS_TLS === 'true' && { tls: { rejectUnauthorized: true } }),
  };
}

/**
 * Parse a redis:// URL into ioredis connection options.
 * Handles: redis://host:port, redis://:password@host:port
 */
function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    const opts = {
      host: u.hostname || '127.0.0.1',
      port: parseInt(u.port) || 6379,
    };
    if (u.password) opts.password = decodeURIComponent(u.password);
    if (u.pathname && u.pathname !== '/') opts.db = parseInt(u.pathname.slice(1)) || 0;
    return opts;
  } catch {
    // Fallback: return minimal config
    return { host: '127.0.0.1', port: 6379 };
  }
}
// ─── ioredis client factory ───────────────────────────────────────────────────
/**
 * Create a production-ready ioredis client.
 *
 * @param {string} name  - Label for log messages: 'pub' | 'sub' | 'cache'
 */
function createRedisClient(name) {
  const url    = process.env.REDIS_URL;
  const isProd = process.env.NODE_ENV === 'production';

  if (!url) {
    // Caught by connectRedis() before this is called, but guard here too.
    throw new Error('REDIS_URL environment variable is not set');
  }

  const client = new Redis(url, {
    // ── Retry strategy ──────────────────────────────────────────────────────
    // Exponential back-off: 200 ms, 400 ms, 800 ms … capped at 30 s.
    // Stops after 10 attempts in production, 3 in development.
    retryStrategy(times) {
      const maxAttempts = isProd ? 10 : 3;
      if (times > maxAttempts) {
        logger.error(
          `[redis:${name}] Max reconnect attempts (${maxAttempts}) reached — giving up. ` +
          'Restart the process to reconnect.'
        );
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, 30_000);
      logger.warn(`[redis:${name}] Reconnecting in ${delay}ms (attempt ${times}/${maxAttempts})`);
      return delay;
    },

    // ── Connection settings ─────────────────────────────────────────────────
    connectTimeout:       5_000,  // 5 s to establish TCP connection
    commandTimeout:       3_000,  // 3 s per command — prevents hanging requests
    maxRetriesPerRequest: null,   // null = keep retrying (required for BullMQ)
    enableOfflineQueue:   false,  // CRITICAL: reject commands immediately when
                                  // disconnected — no silent memory buffering
    lazyConnect:          true,   // connect only when .connect() is called

    // ── TLS ─────────────────────────────────────────────────────────────────
    ...(process.env.REDIS_TLS === 'true' && {
      tls: { rejectUnauthorized: true }
    }),
  });

  // ── Event handlers ─────────────────────────────────────────────────────────
  client.on('connect',      ()    => logger.info(`[redis:${name}] ✅ Connected`));
  client.on('ready',        ()    => logger.info(`[redis:${name}] ✅ Ready`));
  client.on('reconnecting', ()    => logger.warn(`[redis:${name}] ⏳ Reconnecting…`));
  // In dev without Redis, connection errors are expected — log as warn not error
  // to avoid filling the error log with noise. In production they stay as errors.
  client.on('error', (err) => {
    const isConnectionRefused = err.message?.includes('ECONNREFUSED') ||
                                err.message?.includes('ENOTFOUND') ||
                                err.code === 'ECONNREFUSED';
    if (isConnectionRefused && !isProd) {
      logger.warn(`[redis:${name}] ⚠️ ${err.message} (Redis not running — OK in dev)`);
    } else {
      logger.error(`[redis:${name}] ❌ ${err.message}`);
    }
  });
  client.on('close',        ()    => logger.warn(`[redis:${name}] 🔌 Connection closed`));
  client.on('end',          ()    => logger.warn(`[redis:${name}] 🛑 No more retries`));

  return client;
}

// ─── connectRedis ─────────────────────────────────────────────────────────────
/**
 * Connect all three Redis clients.
 *
 * THROWS if:
 *   - REDIS_URL is not set
 *   - Any client fails to connect within the timeout
 *
 * The app must not start if this throws — Redis is required.
 *
 * Returns { pubClient, subClient } for the Socket.IO adapter.
 */
async function connectRedis() {
  if (!process.env.REDIS_URL) {
    throw new Error(
      'REDIS_URL is not set. Redis is required — set REDIS_URL in your .env file.\n' +
      'Example: REDIS_URL=redis://localhost:6379\n' +
      'To run Redis locally: docker run -d --name halqa-redis -p 6379:6379 redis:7-alpine'
    );
  }

  // ── SECURITY CHECK: warn if Redis has no password in production ─────────────
  // docker-compose.prod.yml sets: --requirepass ${REDIS_PASSWORD:-}
  // If REDIS_PASSWORD is unset the URL contains no password and Redis runs
  // unauthenticated — any container on the Docker network can read/write cache,
  // BullMQ queues, and Socket.IO pub/sub data.
  if (process.env.NODE_ENV === 'production') {
    const parsed = (() => { try { return new URL(process.env.REDIS_URL); } catch { return null; } })();
    const hasPassword = parsed && parsed.password && parsed.password.length > 0;
    if (!hasPassword) {
      // Hard fail in production — Redis without auth is a security risk.
      throw new Error(
        'SECURITY: Redis has no password in production.\n' +
        'Set REDIS_PASSWORD in your environment and include it in REDIS_URL.\n' +
        'Example: REDIS_URL=redis://:yourpassword@redis:6379\n' +
        'docker-compose.prod.yml: command: redis-server --requirepass ${REDIS_PASSWORD}'
      );
    }
  }

  pubClient   = createRedisClient('pub');
  subClient   = createRedisClient('sub');
  cacheClient = createRedisClient('cache');

  // Connect all three in parallel — throws if any fails
  await Promise.all([
    pubClient.connect(),
    subClient.connect(),
    cacheClient.connect(),
  ]);

  logger.info('✅ Redis fully connected (pub + sub + cache)');
  startRedisPing();
  return { pubClient, subClient };
}

// ─── Getters ──────────────────────────────────────────────────────────────────
function getPubClient()  { return pubClient; }
function getSubClient()  { return subClient; }

/**
 * Returns the cache client.
 * Throws if called before connectRedis() has resolved — this is intentional:
 * callers should never reach cache operations before startup completes.
 */
function getRedis() {
  if (!cacheClient) {
    throw new Error('[redis] getRedis() called before connectRedis() completed');
  }
  return cacheClient;
}

function isRedisReady() {
  return !!(cacheClient && cacheClient.status === 'ready');
}

// ─── Periodic Redis health ping ───────────────────────────────────────────────
// Pings Redis every 30 s and logs latency. Detects silent connection drops
// before they affect user requests.
let _pingTimer = null;

function startRedisPing() {
  if (_pingTimer) return;
  _pingTimer = setInterval(async () => {
    if (!cacheClient) return;
    try {
      const t = Date.now();
      await cacheClient.ping();
      const latencyMs = Date.now() - t;

      // Record in Prometheus
      const prom = require('./prometheus');
      prom.redisPingDurationMs.observe(latencyMs);

      if (latencyMs > 100) {
        logger.warn(`[redis:cache] High ping latency: ${latencyMs}ms`);
      } else {
        logger.debug(`[redis:cache] Ping OK (${latencyMs}ms)`);
      }
    } catch (err) {
      logger.error(`[redis:cache] Ping failed: ${err.message}`);
    }
  }, 30_000);
  _pingTimer.unref();
}

// ─── Cache API — Redis-only ───────────────────────────────────────────────────
/**
 * All cache functions:
 *   - Use Redis exclusively (no memory fallback)
 *   - Log cache hits and misses at debug level
 *   - Log errors at error level and re-throw so callers can decide how to handle
 *     (most callers catch and continue without cache — that is acceptable;
 *      what is NOT acceptable is silently writing to a different store)
 */

/**
 * Store a value in Redis with a TTL.
 * @param {string} key
 * @param {*}      value      - Will be JSON-serialised
 * @param {number} ttlSeconds - Default 300 s (5 min)
 */
async function setCache(key, value, ttlSeconds = 300) {
  try {
    await cacheClient.setex(key, ttlSeconds, JSON.stringify(value));
    logger.debug(`[cache] SET  ${key}  (ttl=${ttlSeconds}s)`);
  } catch (err) {
    logger.error(`[cache] SET failed for "${key}": ${err.message}`);
    throw err; // propagate — caller decides whether to continue without cache
  }
}

/**
 * Retrieve a value from Redis.
 * Returns null on cache miss (key not found).
 * Throws on Redis error.
 * @param {string} key
 * @returns {*|null}
 */
async function getCache(key) {
  try {
    const raw = await cacheClient.get(key);
    if (raw === null) {
      logger.debug(`[cache] MISS ${key}`);
      // Prometheus counter (lazy require avoids circular dependency at module load)
      try { require('./prometheus').cacheMissesTotal.inc(); } catch {}
      return null;
    }
    logger.debug(`[cache] HIT  ${key}`);
    try { require('./prometheus').cacheHitsTotal.inc(); } catch {}
    return JSON.parse(raw);
  } catch (err) {
    logger.error(`[cache] GET failed for "${key}": ${err.message}`);
    throw err;
  }
}

/**
 * Delete one or more keys from Redis.
 * @param {...string} keys
 */
async function deleteCache(...keys) {
  if (!keys.length) return;
  try {
    await cacheClient.del(...keys);
    logger.debug(`[cache] DEL  ${keys.join(', ')}`);
  } catch (err) {
    logger.error(`[cache] DEL failed for "${keys.join(', ')}": ${err.message}`);
    throw err;
  }
}

/**
 * Delete all keys matching a glob pattern.
 * Uses SCAN instead of KEYS to avoid blocking Redis in production.
 * @param {string} pattern  e.g. 'voice:room:*'
 */
async function deleteCachePattern(pattern) {
  try {
    const keys = [];
    let cursor = '0';

    // SCAN is non-blocking — safe for production
    do {
      const [nextCursor, batch] = await cacheClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await cacheClient.del(...keys);
      logger.debug(`[cache] DEL pattern "${pattern}" — removed ${keys.length} key(s)`);
    } else {
      logger.debug(`[cache] DEL pattern "${pattern}" — no keys matched`);
    }
  } catch (err) {
    logger.error(`[cache] DEL pattern failed for "${pattern}": ${err.message}`);
    throw err;
  }
}

// ─── Health / stats ───────────────────────────────────────────────────────────
function getCacheStats() {
  return {
    backend:      'redis',
    redisStatus:  cacheClient?.status ?? 'not_connected',
    redisReady:   isRedisReady(),
  };
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function disconnectRedis() {
  for (const [name, client] of [
    ['pub',   pubClient],
    ['sub',   subClient],
    ['cache', cacheClient],
  ]) {
    if (client) {
      try {
        await client.quit();
        logger.info(`[redis:${name}] Disconnected cleanly`);
      } catch {
        client.disconnect();
      }
    }
  }
  pubClient = subClient = cacheClient = null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // Lifecycle
  connectRedis,
  disconnectRedis,

  // Adapter clients (consumed by sockets/index.js)
  getPubClient,
  getSubClient,

  // Raw client getter (used by health routes, voiceQueue)
  getRedis,
  isRedisReady,

  // BullMQ connection factory (dedicated — no commandTimeout)
  getBullMQConnection,

  // Cache API
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
  getCacheStats,
};