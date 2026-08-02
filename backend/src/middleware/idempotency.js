/**
 * Request Deduplication (Idempotency) Middleware
 * 
 * Prevents duplicate requests from being processed multiple times.
 * Useful for:
 * - Payment processing
 * - Resource creation
 * - State-changing operations
 * 
 * Uses idempotency keys to identify duplicate requests.
 * Stores request results in Redis with configurable TTL.
 * 
 * Usage:
 *   router.post('/api/v1/payments', idempotency({ ttl: 3600 }), paymentHandler);
 * 
 * Client must provide:
 *   - Idempotency-Key header (recommended)
 *   - or idempotencyKey in request body
 */

const crypto = require('crypto');
const { isRedisReady, getCache, setCache, deleteCache } = require('../utils/redis');
const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const prom = require('../utils/prometheus');

const DEFAULT_TTL = 3600; // 1 hour
const DEFAULT_KEY_TTL = 86400; // 24 hours for key tracking

/**
 * Generate idempotency key from request
 * Falls back to hash of request body if no key provided
 */
function generateIdempotencyKey(req) {
  // Check header first
  const headerKey = req.headers['idempotency-key'];
  if (headerKey) {
    return headerKey;
  }

  // Check body
  const bodyKey = req.body?.idempotencyKey;
  if (bodyKey) {
    return bodyKey;
  }

  // Generate from request signature
  const signature = `${req.method}:${req.path}:${JSON.stringify(req.body)}`;
  return crypto.createHash('sha256').update(signature).digest('hex');
}

/**
 * Idempotency middleware
 * 
 * Checks if request has already been processed and returns cached result if so.
 * Stores result for future duplicate requests.
 */
function idempotencyMiddleware(options = {}) {
  const {
    ttl = DEFAULT_TTL,
    keyTtl = DEFAULT_KEY_TTL,
    skipSuccessful = false,
    skipFailed = false
  } = options;

  return async (req, res, next) => {
    // Idempotency only applies to state-changing methods — skip GETs entirely
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    // Skip if Redis is not available
    if (!isRedisReady()) {
      logger.warn('[idempotency] Redis unavailable, skipping idempotency check');
      return next();
    }

    const idempotencyKey = generateIdempotencyKey(req);
    const cacheKey = `idempotency:${idempotencyKey}`;

    try {
      // Check if request was already processed
      const cached = await getCache(cacheKey);

      if (cached) {
        logger.info(`[idempotency] Duplicate request detected: ${idempotencyKey}`);

        // Emit Prometheus metric
        prom.idempotencyHitsTotal.inc({ endpoint: req.path });

        // Return cached response
        res.set('X-Idempotency-Key', idempotencyKey);
        res.set('X-Idempotency-Replayed', 'true');
        res.set('X-Cache-Age', Math.round((Date.now() - cached.timestamp) / 1000));

        return res.status(cached.statusCode).json(cached.body);
      }

      // Store original res.json to intercept response
      const originalJson = res.json.bind(res);
      let responseCaptured = false;

      res.json = function(body) {
        if (!responseCaptured) {
          responseCaptured = true;

          // Determine if we should cache this response
          const statusCode = res.statusCode;
          const shouldCache = 
            (skipSuccessful && statusCode >= 200 && statusCode < 300) ||
            (skipFailed && statusCode >= 400) ||
            (!skipSuccessful && !skipFailed);

          if (shouldCache) {
            // Cache the response
            setCache(cacheKey, {
              statusCode,
              body,
              timestamp: Date.now()
            }, ttl).catch(err => {
              logger.error('[idempotency] Failed to cache response:', err);
            });
          }

          res.set('X-Idempotency-Key', idempotencyKey);
        }

        return originalJson(body);
      };

      // Track the key to prevent key reuse
      const keyTrackingKey = `idempotency:keys:${idempotencyKey}`;
      await setCache(keyTrackingKey, true, keyTtl);

      // Emit Prometheus metric for cache miss (new request)
      prom.idempotencyMissesTotal.inc({ endpoint: req.path });

      res.set('X-Idempotency-Key', idempotencyKey);
      next();
    } catch (error) {
      logger.error('[idempotency] Error:', error);
      // On error, allow request to proceed (fail-open)
      next();
    }
  };
}

/**
 * Idempotency key validation middleware
 * 
 * Ensures idempotency keys are not reused across different requests.
 * Prevents accidental key collisions.
 */
function validateIdempotencyKey(options = {}) {
  const { keyTtl = DEFAULT_KEY_TTL } = options;

  return async (req, res, next) => {
    if (!isRedisReady()) {
      return next();
    }

    const idempotencyKey = generateIdempotencyKey(req);
    const keyTrackingKey = `idempotency:keys:${idempotencyKey}`;

    try {
      const keyExists = await getCache(keyTrackingKey);

      if (keyExists) {
        return errorResponse(res, 'Idempotency key has already been used', 400);
      }

      next();
    } catch (error) {
      logger.error('[idempotency] Validation error:', error);
      next();
    }
  };
}

/**
 * Idempotency key generator helper
 * 
 * Generates a unique idempotency key for clients to use.
 */
function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Clear idempotency cache for a specific key
 * 
 * Useful for testing or manual cache invalidation.
 */
async function clearIdempotencyKey(idempotencyKey) {
  if (!isRedisReady()) {
    throw new Error('Redis not available');
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  const keyTrackingKey = `idempotency:keys:${idempotencyKey}`;

  await Promise.all([
    deleteCache(cacheKey),
    deleteCache(keyTrackingKey)
  ]);

  logger.info(`[idempotency] Cleared cache for key: ${idempotencyKey}`);
}

/**
 * Get idempotency cache statistics
 */
async function getIdempotencyStats() {
  if (!isRedisReady()) {
    return { error: 'Redis not available' };
  }

  try {
    // This would require Redis SCAN command which is complex
    // For now, return basic info
    return {
      status: 'available',
      defaultTtl: DEFAULT_TTL,
      defaultKeyTtl: DEFAULT_KEY_TTL
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Pre-configured idempotency middleware for common use cases
 */

// Payment operations (long TTL to prevent duplicate charges)
const paymentIdempotency = idempotencyMiddleware({
  ttl: 86400, // 24 hours
  keyTtl: 86400
});

// Resource creation (medium TTL)
const creationIdempotency = idempotencyMiddleware({
  ttl: 3600, // 1 hour
  keyTtl: 3600
});

// State changes (short TTL)
const stateChangeIdempotency = idempotencyMiddleware({
  ttl: 300, // 5 minutes
  keyTtl: 300
});

// Write operations (skip caching failed requests)
const writeIdempotency = idempotencyMiddleware({
  ttl: 3600,
  skipFailed: true
});

module.exports = {
  middleware: idempotencyMiddleware,
  validate: validateIdempotencyKey,
  generateKey,
  clearKey: clearIdempotencyKey,
  getStats: getIdempotencyStats,
  paymentIdempotency,
  creationIdempotency,
  stateChangeIdempotency,
  writeIdempotency
};
