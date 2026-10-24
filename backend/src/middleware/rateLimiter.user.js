const rateLimit = require('express-rate-limit');
const { isRedisReady, getCache, setCache } = require('../utils/redis');
const logger = require('../utils/logger');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Per-user rate limiter middleware
 * 
 * Limits requests based on user ID (from req.user.id after authentication).
 * Uses Redis for distributed rate limiting across multiple server instances.
 * Falls back to in-memory limiter if Redis is unavailable.
 * 
 * Usage:
 *   router.get('/api/v1/endpoint', authenticate, userRateLimiter({ max: 100 }), handler);
 * 
 * Options:
 *   - windowMs: Time window in milliseconds (default: 15 minutes)
 *   - max: Maximum requests per window (default: 100)
 *   - skipSuccessfulRequests: Don't count successful requests (default: false)
 *   - skipFailedRequests: Don't count failed requests (default: false)
 */
function normalizeUserLimiterOptions(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = isDev ? 10000 : 100,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    message = 'Too many requests, please try again later',
    keyGenerator = (req) => req.user?.id || req.ip
  } = options;

  return { windowMs, max, skipSuccessfulRequests, skipFailedRequests, message, keyGenerator };
}

function createRedisUserRateLimiter(config) {
  const { windowMs, max, message, keyGenerator } = config;
  return async (req, res, next) => {
      try {
        const userId = keyGenerator(req);
        if (!userId) return next(); // No user ID, skip rate limiting

        const key = `ratelimit:user:${userId}`;
        const now = Date.now();
        const windowStart = now - windowMs;

        // Get current count from Redis
        const current = await getCache(key);
        
        if (!current) {
          // First request in window
          await setCache(key, { count: 1, resetAt: now + windowMs }, windowMs / 1000);
          return next();
        }

        // Check if window has expired
        if (now > current.resetAt) {
          await setCache(key, { count: 1, resetAt: now + windowMs }, windowMs / 1000);
          return next();
        }

        // Check if limit exceeded
        if (current.count >= max) {
          const retryAfter = Math.ceil((current.resetAt - now) / 1000);
          res.set('Retry-After', retryAfter);
          return res.status(429).json({
            success: false,
            message,
            retryAfter
          });
        }

        // Increment count
        await setCache(key, { count: current.count + 1, resetAt: current.resetAt }, windowMs / 1000);
        
        // Set rate limit headers
        res.set('X-RateLimit-Limit', max);
        res.set('X-RateLimit-Remaining', max - current.count - 1);
        res.set('X-RateLimit-Reset', new Date(current.resetAt).toISOString());

        next();
      } catch (error) {
        logger.error('[userRateLimiter] Redis error:', error);
        // On Redis error, allow request to proceed (fail-open)
        next();
      }
  };
}

function createMemoryUserRateLimiter(config) {
  const { windowMs, max, skipSuccessfulRequests, skipFailedRequests, message, keyGenerator } = config;
  return rateLimit({
    windowMs,
    max,
    skipSuccessfulRequests,
    skipFailedRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    keyGenerator,
    skip: (req) => !keyGenerator(req) // Skip if no user ID
  });
}

function createUserRateLimiter(options = {}) {
  const config = normalizeUserLimiterOptions(options);
  if (isRedisReady()) return createRedisUserRateLimiter(config);

  logger.warn('[userRateLimiter] Redis unavailable, using in-memory limiter');
  return createMemoryUserRateLimiter(config);
}

function createCachedUserRateLimiter(name, options) {
  const config = normalizeUserLimiterOptions(options);
  const memoryLimiter = createMemoryUserRateLimiter(config);
  let selectedLimiter = null;

  return (req, res, next) => {
    if (!selectedLimiter) {
      logger.debug(`[userRateLimiter] Lazy-initializing ${name} instance`);
      if (isRedisReady()) {
        selectedLimiter = createRedisUserRateLimiter(config);
      } else {
        logger.warn('[userRateLimiter] Redis unavailable, using in-memory limiter');
        selectedLimiter = memoryLimiter;
      }
    }
    return selectedLimiter(req, res, next);
  };
}

/**
 * Pre-configured rate limiters for common use cases.
 *
 * Each export pre-constructs its independent in-memory store, then selects and
 * caches Redis or memory on the first request. This preserves first-request
 * backend selection without constructing express-rate-limit during a request.
 */

// Strict limiter for sensitive operations (password change, email update, etc.)
const strictLimiter = createCachedUserRateLimiter('strictLimiter', {
      windowMs: 15 * 60 * 1000,
      max: isDev ? 1000 : 5,
      message: 'Too many sensitive operations, please try again later'
});

// Moderate limiter for regular API calls
const moderateLimiter = createCachedUserRateLimiter('moderateLimiter', {
      windowMs: 15 * 60 * 1000,
      max: isDev ? 5000 : 100,
      message: 'Rate limit exceeded, please try again later'
});

// Lenient limiter for read operations
const lenientLimiter = createCachedUserRateLimiter('lenientLimiter', {
      windowMs: 15 * 60 * 1000,
      max: isDev ? 10000 : 500,
      message: 'Too many read requests, please try again later'
});

// Write operations limiter (create, update, delete)
const writeLimiter = createCachedUserRateLimiter('writeLimiter', {
      windowMs: 15 * 60 * 1000,
      max: isDev ? 2000 : 50,
      message: 'Too many write operations, please try again later'
});

module.exports = {
  createUserRateLimiter,
  strictLimiter,
  moderateLimiter,
  lenientLimiter,
  writeLimiter,
  middleware: moderateLimiter // Default middleware for app.use
};
