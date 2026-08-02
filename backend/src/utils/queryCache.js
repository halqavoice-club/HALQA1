/**
 * Query Result Cache
 * 
 * Caches Prisma query results in Redis to reduce database load.
 * Supports:
 * - Automatic cache key generation
 * - TTL-based expiration
 * - Cache invalidation by pattern
 * - Cache warming
 * - Cache statistics
 * 
 * Usage:
 *   const queryCache = require('./utils/queryCache');
 *   
 *   // Simple cache
 *   const users = await queryCache.getOrSet('users:all', () => {
 *     return prisma.user.findMany();
 *   }, 300);
 *   
 *   // With custom key generator
 *   const user = await queryCache.getOrSet(
 *     `user:${userId}`,
 *     () => prisma.user.findUnique({ where: { id: userId } }),
 *     600
 *   );
 * 
 *   // Invalidate cache
 *   await queryCache.invalidate('users:*');
 */

const crypto = require('crypto');
const { isRedisReady, getCache, setCache, deleteCache } = require('./redis');
const logger = require('./logger');
const prom = require('./prometheus');

const DEFAULT_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'query:';

/**
 * Generate cache key from query parameters
 */
function generateCacheKey(model, action, params = {}) {
  const keyData = {
    model,
    action,
    params
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex');
  return `${CACHE_PREFIX}${model}:${action}:${hash}`;
}

/**
 * Get or set cached query result
 */
async function getOrSet(key, queryFn, ttl = DEFAULT_TTL, options = {}) {
  const { skipCache = false, forceRefresh = false } = options;

  // Skip caching if Redis unavailable or configured to skip
  if (!isRedisReady() || skipCache) {
    return await queryFn();
  }

  // Force refresh if requested
  if (forceRefresh) {
    const result = await queryFn();
    await setCache(key, result, ttl);
    return result;
  }

  try {
    // Try to get from cache
    const cached = await getCache(key);
    if (cached !== null) {
      prom.cacheHitsTotal.inc();
      logger.debug(`[queryCache] Cache hit: ${key}`);
      return cached;
    }

    // Cache miss - execute query
    prom.cacheMissesTotal.inc();
    logger.debug(`[queryCache] Cache miss: ${key}`);
    const result = await queryFn();

    // Cache the result
    await setCache(key, result, ttl);

    return result;
  } catch (error) {
    logger.error('[queryCache] Error:', error);
    // On error, execute query directly (fail-open)
    return await queryFn();
  }
}

/**
 * Get cached result without setting
 */
async function get(key) {
  if (!isRedisReady()) {
    return null;
  }

  try {
    const cached = await getCache(key);
    if (cached !== null) {
      prom.cacheHitsTotal.inc();
    }
    return cached;
  } catch (error) {
    logger.error('[queryCache] Get error:', error);
    return null;
  }
}

/**
 * Set cached result
 */
async function set(key, value, ttl = DEFAULT_TTL) {
  if (!isRedisReady()) {
    return;
  }

  try {
    await setCache(key, value, ttl);
  } catch (error) {
    logger.error('[queryCache] Set error:', error);
  }
}

/**
 * Invalidate cache by key or pattern
 */
async function invalidate(pattern) {
  if (!isRedisReady()) {
    return;
  }

  try {
    const redis = require('./redis').getRedis();
    const keys = await redis.keys(`${CACHE_PREFIX}${pattern}`);

    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`[queryCache] Invalidated ${keys.length} cache entries matching: ${pattern}`);
    }
  } catch (error) {
    logger.error('[queryCache] Invalidate error:', error);
  }
}

/**
 * Invalidate by model
 */
async function invalidateModel(model) {
  await invalidate(`${model}:*`);
}

/**
 * Warm cache by pre-populating frequently accessed data
 */
async function warm(key, queryFn, ttl = DEFAULT_TTL) {
  if (!isRedisReady()) {
    return;
  }

  try {
    const result = await queryFn();
    await setCache(key, result, ttl);
    logger.debug(`[queryCache] Warmed cache for key: ${key}`);
  } catch (error) {
    logger.error('[queryCache] Warm error:', error);
  }
}

/**
 * Get cache statistics
 */
async function getStats() {
  if (!isRedisReady()) {
    return { status: 'unavailable' };
  }

  try {
    const redis = require('./redis').getRedis();
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    
    return {
      status: 'available',
      cachedKeys: keys.length,
      keys: keys.slice(0, 100) // Return first 100 keys
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Prune expired cache entries (Redis handles this automatically, but useful for manual cleanup)
 */
async function prune() {
  if (!isRedisReady()) {
    return;
  }

  try {
    const redis = require('./redis').getRedis();
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    
    let prunedCount = 0;
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl === -2) { // Key exists but has no expiry
        await redis.del(key);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      logger.info(`[queryCache] Pruned ${prunedCount} cache entries without TTL`);
    }
  } catch (error) {
    logger.error('[queryCache] Prune error:', error);
  }
}

/**
 * Cache decorator for Prisma queries
 * 
 * Usage:
 *   const cachedFindMany = queryCache.decorate(prisma.user, 'findMany', 300);
 *   const users = await cachedFindMany({ where: { active: true } });
 */
function decorate(prismaModel, action, ttl = DEFAULT_TTL) {
  return async (params) => {
    const key = generateCacheKey(prismaModel.$name, action, params);
    return await getOrSet(key, () => prismaModel[action](params), ttl);
  };
}

/**
 * Cache middleware for Express routes
 * 
 * Usage:
 *   router.get('/api/v1/users', queryCache.middleware('users', 300), handler);
 */
function middleware(model, ttl = DEFAULT_TTL) {
  return async (req, res, next) => {
    const key = generateCacheKey(model, req.method, {
      path: req.path,
      query: req.query
    });

    try {
      const cached = await get(key);
      if (cached !== null) {
        return res.json(cached);
      }
    } catch (error) {
      // Continue to handler on error
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      // Cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        set(key, body, ttl).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Pre-configured cache strategies
 */

// Short cache (1 minute) - frequently changing data
const shortCache = {
  getOrSet: (key, fn) => getOrSet(key, fn, 60),
  decorate: (model, action) => decorate(model, action, 60)
};

// Medium cache (5 minutes) - moderately changing data
const mediumCache = {
  getOrSet: (key, fn) => getOrSet(key, fn, 300),
  decorate: (model, action) => decorate(model, action, 300)
};

// Long cache (1 hour) - rarely changing data
const longCache = {
  getOrSet: (key, fn) => getOrSet(key, fn, 3600),
  decorate: (model, action) => decorate(model, action, 3600)
};

// Very long cache (1 day) - static data
const veryLongCache = {
  getOrSet: (key, fn) => getOrSet(key, fn, 86400),
  decorate: (model, action) => decorate(model, action, 86400)
};

module.exports = {
  generateCacheKey,
  getOrSet,
  get,
  set,
  invalidate,
  invalidateModel,
  warm,
  getStats,
  prune,
  decorate,
  middleware,
  shortCache,
  mediumCache,
  longCache,
  veryLongCache,
  DEFAULT_TTL
};
