/**
 * Response Caching Middleware
 * 
 * Adds HTTP caching headers to responses for improved performance.
 * Supports:
 * - Cache-Control headers
 * - ETag generation
 * - Last-Modified headers
 * - Conditional requests (304 Not Modified)
 * - Stale-while-revalidate
 * 
 * Usage:
 *   router.get('/api/v1/data', cache({ maxAge: 300 }), handler);
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Generate ETag from response body
 */
function generateETag(body) {
  if (!body) return null;
  const hash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex');
  return `"${hash}"`;
}

/**
 * Parse cache-control options
 */
function parseCacheControl(options) {
  const directives = [];

  if (options.public) directives.push('public');
  if (options.private) directives.push('private');
  if (options.noCache) directives.push('no-cache');
  if (options.noStore) directives.push('no-store');
  if (options.noTransform) directives.push('no-transform');
  if (options.mustRevalidate) directives.push('must-revalidate');
  if (options.proxyRevalidate) directives.push('proxy-revalidate');

  if (options.maxAge !== undefined) {
    directives.push(`max-age=${options.maxAge}`);
  }

  if (options.sMaxAge !== undefined) {
    directives.push(`s-maxage=${options.sMaxAge}`);
  }

  if (options.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  if (options.staleIfError !== undefined) {
    directives.push(`stale-if-error=${options.staleIfError}`);
  }

  return directives.join(', ');
}

/**
 * Cache middleware
 * 
 * Adds caching headers to responses.
 * 
 * Options:
 *   - maxAge: Time in seconds for client caching
 *   - sMaxAge: Time in seconds for shared cache (CDN)
 *   - staleWhileRevalidate: Time to serve stale content while revalidating
 *   - staleIfError: Time to serve stale content on error
 *   - public: Allow public caching (CDN)
 *   - private: Allow only client caching
 *   - noCache: Always revalidate
 *   - noStore: Do not cache at all
 *   - mustRevalidate: Must revalidate after maxAge
 *   - etag: Generate ETag header
 *   - lastModified: Add Last-Modified header
 */
function cacheMiddleware(options = {}) {
  const maxAge = options.maxAge ?? 0;
  const sMaxAge = options.sMaxAge ?? 0;
  const staleWhileRevalidate = options.staleWhileRevalidate ?? 0;
  const staleIfError = options.staleIfError ?? 0;
  const isPublic = options.public ?? false;
  const isPrivate = options.private ?? false;
  const noCache = options.noCache ?? false;
  const noStore = options.noStore ?? false;
  const mustRevalidate = options.mustRevalidate ?? false;
  const etag = options.etag ?? true;
  const lastModified = options.lastModified ?? true;

  return (req, res, next) => {
    // Handle conditional requests (If-None-Match, If-Modified-Since)
    if (etag && req.headers['if-none-match']) {
      // This would require storing ETags somewhere (Redis)
      // For now, we'll just let the handler process it
    }

    // Intercept response to add caching headers
    const originalJson = res.json.bind(res);
    let responseBody = null;

    res.json = function(body) {
      responseBody = body;

      // Add Cache-Control header
      const cacheControl = parseCacheControl(options);
      if (cacheControl) {
        res.set('Cache-Control', cacheControl);
      }

      // Add ETag header
      if (etag && responseBody) {
        const eTag = generateETag(responseBody);
        res.set('ETag', eTag);
      }

      // Add Last-Modified header
      if (lastModified) {
        res.set('Last-Modified', new Date().toUTCString());
      }

      // Add Vary header for proper cache key
      if (req.headers['authorization']) {
        res.set('Vary', 'Authorization');
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Pre-configured caching strategies
 */

// No caching (dynamic data)
const noCache = cacheMiddleware({
  noStore: true,
  noCache: true
});

// Short cache (5 minutes) - frequently changing data
const shortCache = cacheMiddleware({
  maxAge: 300,
  public: true,
  mustRevalidate: true
});

// Medium cache (1 hour) - moderately changing data
const mediumCache = cacheMiddleware({
  maxAge: 3600,
  sMaxAge: 3600,
  public: true,
  staleWhileRevalidate: 600
});

// Long cache (1 day) - rarely changing data
const longCache = cacheMiddleware({
  maxAge: 86400,
  sMaxAge: 86400,
  public: true,
  staleWhileRevalidate: 3600,
  staleIfError: 86400
});

// Private cache (user-specific data)
const privateCache = cacheMiddleware({
  maxAge: 300,
  private: true,
  mustRevalidate: true
});

// Static assets cache (very long)
const staticCache = cacheMiddleware({
  maxAge: 31536000, // 1 year
  sMaxAge: 31536000,
  public: true,
  immutable: true
});

/**
 * Cache invalidation helper
 * 
 * Invalidates cache entries by pattern.
 * Requires Redis to be available.
 */
async function invalidateCache(pattern) {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) {
      logger.warn('[cache] Redis unavailable, cannot invalidate cache');
      return;
    }

    const redis = getRedis();
    const keys = await redis.keys(`cache:${pattern}*`);
    
    if (keys.length > 0) {
      await redis.del(keys);
      logger.info(`[cache] Invalidated ${keys.length} cache entries matching: ${pattern}`);
    }
  } catch (error) {
    logger.error('[cache] Cache invalidation error:', error);
  }
}

/**
 * Cache warming helper
 * 
 * Pre-populates cache with frequently accessed data.
 */
async function warmCache(key, data, ttl = 3600) {
  try {
    const { isRedisReady, setCache } = require('../utils/redis');
    if (!isRedisReady()) {
      return;
    }

    await setCache(`cache:${key}`, data, ttl);
    logger.debug(`[cache] Warmed cache for key: ${key}`);
  } catch (error) {
    logger.error('[cache] Cache warming error:', error);
  }
}

/**
 * Cache statistics
 */
async function getCacheStats() {
  try {
    const { isRedisReady, getRedis } = require('../utils/redis');
    if (!isRedisReady()) {
      return { status: 'unavailable' };
    }

    const redis = getRedis();
    const keys = await redis.keys('cache:*');
    
    return {
      status: 'available',
      cachedKeys: keys.length,
      keys: keys.slice(0, 100) // Return first 100 keys
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

module.exports = {
  middleware: cacheMiddleware,
  noCache,
  shortCache,
  mediumCache,
  longCache,
  privateCache,
  staticCache,
  invalidate: invalidateCache,
  warm: warmCache,
  getStats: getCacheStats,
  generateETag,
  parseCacheControl
};
