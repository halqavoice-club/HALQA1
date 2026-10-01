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

const DEFAULT_TTL = 3600;     // 1 hour
const DEFAULT_KEY_TTL = 86400; // 24 hours for key tracking

/**
 * Generate idempotency key from request.
 *
 * SECURITY: For auto-generated keys (no explicit header/body key), the cache key
 * includes the authenticated user's identity (req.user?.id).  This prevents
 * cross-user cache collisions where user A's cached 200 response could be
 * returned to user B (e.g. a SUPER_ADMIN receiving a normal-user's cached 200
 * for a route that should return 403 for the SA).
 *
 * Identity source: req.user?.id — populated server-side by authenticate()
 * middleware from the verified JWT.  Never use client-supplied userId.
 *
 * NOTE: This function must only be called after authenticate() has run so that
 * req.user is populated.  For the early-cache-read path (explicit keys only),
 * the client-supplied key is used directly — the client owns uniqueness there.
 * For auto-generated keys, key generation is deferred to response-intercept time
 * (inside res.json) where req.user is guaranteed to be set.
 */
function generateIdempotencyKey(req) {
  // Check header first — client-supplied explicit key used as-is.
  const headerKey = req.headers['idempotency-key'];
  if (headerKey) return headerKey;

  // Check body
  const bodyKey = req.body?.idempotencyKey;
  if (bodyKey) return bodyKey;

  // Auto-generate from request signature scoped to the authenticated user.
  // 'anon' for unauthenticated requests (separate namespace from any user).
  const userId    = req.user?.id || 'anon';
  const signature = `${userId}:${req.method}:${req.path}:${JSON.stringify(req.body)}`;
  return crypto.createHash('sha256').update(signature).digest('hex');
}

/**
 * Idempotency middleware
 *
 * Two-phase key strategy:
 *
 * 1. Explicit keys (Idempotency-Key header or body.idempotencyKey):
 *    - Cache lookup happens immediately at middleware entry (fast-path replay).
 *    - Cache write happens at response-intercept time.
 *    - Used for payment retries, PK battles, etc. where the client manages keys.
 *
 * 2. Auto-generated keys (no explicit client key):
 *    - Cache lookup is SKIPPED at middleware entry because req.user is not yet
 *      set (authenticate() middleware runs later inside the route handlers).
 *    - Cache write happens at response-intercept time, AFTER authenticate() has
 *      run, so req.user.id is available and the key is user-scoped.
 *    - This prevents cross-user cache collisions on authorization-sensitive routes.
 */
function idempotencyMiddleware(options = {}) {
  const {
    ttl = DEFAULT_TTL,
    keyTtl = DEFAULT_KEY_TTL,
    skipSuccessful = false,
    skipFailed = false
  } = options;

  return async (req, res, next) => {
    // Idempotency only applies to state-changing methods
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    // Skip if Redis is not available
    if (!isRedisReady()) {
      logger.warn('[idempotency] Redis unavailable, skipping idempotency check');
      return next();
    }

    // ── Determine if client provided an explicit key ──────────────────────
    const explicitKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;

    if (explicitKey) {
      // ── Explicit-key path: early cache lookup ─────────────────────────
      const cacheKey = `idempotency:${explicitKey}`;

      try {
        const cached = await getCache(cacheKey);

        if (cached) {
          logger.info(`[idempotency] Duplicate request detected: ${explicitKey}`);
          prom.idempotencyHitsTotal.inc({ endpoint: req.path });

          res.set('X-Idempotency-Key', explicitKey);
          res.set('X-Idempotency-Replayed', 'true');
          res.set('X-Cache-Age', Math.round((Date.now() - cached.timestamp) / 1000));
          return res.status(cached.statusCode).json(cached.body);
        }
      } catch (err) {
        logger.error('[idempotency] Cache read error:', err);
        // Fail-open: allow request to proceed
      }

      // Intercept response to cache under explicit key
      const originalJson = res.json.bind(res);
      let captured = false;

      res.json = function(body) {
        if (!captured) {
          captured = true;
          const statusCode = res.statusCode;
          const isSuccess  = statusCode >= 200 && statusCode < 300;
          const isFailed   = statusCode >= 400;
          const shouldCache = !(skipSuccessful && isSuccess) && !(skipFailed && isFailed);

          if (shouldCache) {
            setCache(cacheKey, { statusCode, body, timestamp: Date.now() }, ttl)
              .catch(err => logger.error('[idempotency] Failed to cache response:', err));
            setCache(`idempotency:keys:${explicitKey}`, true, keyTtl).catch(() => {});
          }
          res.set('X-Idempotency-Key', explicitKey);
        }
        return originalJson(body);
      };

      prom.idempotencyMissesTotal.inc({ endpoint: req.path });
      res.set('X-Idempotency-Key', explicitKey);
      return next();
    }

    // ── Auto-generated key path: deferred key generation ──────────────────
    // req.user is NOT yet set here — authenticate() runs later inside the router.
    // We skip the early cache-read to avoid cross-user collisions.
    // The key is generated lazily inside res.json after auth has populated req.user.

    const originalJson = res.json.bind(res);
    let responseCaptured = false;

    res.json = function(body) {
      if (!responseCaptured) {
        responseCaptured = true;

        // At this point authenticate() has run — req.user is populated.
        const idempotencyKey = generateIdempotencyKey(req); // now user-scoped
        const cacheKey = `idempotency:${idempotencyKey}`;

        const statusCode = res.statusCode;
        const isSuccess  = statusCode >= 200 && statusCode < 300;
        const isFailed   = statusCode >= 400;

        const shouldCache =
          !(skipSuccessful && isSuccess) &&
          !(skipFailed    && isFailed);

        if (shouldCache) {
          setCache(cacheKey, {
            statusCode,
            body,
            timestamp: Date.now()
          }, ttl).catch(err => {
            logger.error('[idempotency] Failed to cache response:', err);
          });

          const keyTrackingKey = `idempotency:keys:${idempotencyKey}`;
          setCache(keyTrackingKey, true, keyTtl).catch(() => {});
        }

        res.set('X-Idempotency-Key', idempotencyKey);
      }

      return originalJson(body);
    };

    prom.idempotencyMissesTotal.inc({ endpoint: req.path });
    next();
  };
}

/**
 * Idempotency key validation middleware
 *
 * Ensures idempotency keys are not reused across different requests.
 * Prevents accidental key collisions.
 */
function validateIdempotencyKey(options = {}) {
  const { keyTtl: _keyTtl = DEFAULT_KEY_TTL } = options; // eslint-disable-line no-unused-vars

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
