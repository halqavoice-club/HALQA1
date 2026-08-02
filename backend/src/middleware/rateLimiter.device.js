const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { isRedisReady, getCache, setCache } = require('../utils/redis');
const logger = require('../utils/logger');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Generate a device fingerprint from request headers
 * 
 * Creates a consistent identifier for a device based on:
 * - User-Agent
 * - Accept-Language
 * - Accept-Encoding
 * - Screen resolution (if available from client)
 * 
 * Returns a hash that uniquely identifies the device.
 */
function generateDeviceFingerprint(req) {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  // Include client-provided device info if available (from frontend)
  const deviceInfo = req.headers['x-device-info'] || '';
  
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${deviceInfo}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

/**
 * Per-device rate limiter middleware
 * 
 * Limits requests based on device fingerprint.
 * Useful for preventing abuse from compromised accounts across multiple devices.
 * 
 * Usage:
 *   router.get('/api/v1/endpoint', deviceRateLimiter({ max: 100 }), handler);
 * 
 * Options:
 *   - windowMs: Time window in milliseconds (default: 15 minutes)
 *   - max: Maximum requests per window (default: 100)
 *   - maxPerUser: Maximum requests per user across all devices (default: 500)
 *   - message: Custom error message
 */
function createDeviceRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = isDev ? 10000 : 100,
    maxPerUser = isDev ? 50000 : 500,
    message = 'Too many requests from this device, please try again later',
    skipIfAuthenticated = false
  } = options;

  // Redis-based rate limiter
  if (isRedisReady()) {
    return async (req, res, next) => {
      try {
        const deviceFingerprint = generateDeviceFingerprint(req);
        const userId = req.user?.id;

        // Skip if authenticated and skipIfAuthenticated is true
        if (skipIfAuthenticated && userId) {
          return next();
        }

        const now = Date.now();
        const windowStart = now - windowMs;

        // Check device-level limit
        const deviceKey = `ratelimit:device:${deviceFingerprint}`;
        const deviceCurrent = await getCache(deviceKey);

        if (!deviceCurrent || now > deviceCurrent.resetAt) {
          await setCache(deviceKey, { count: 1, resetAt: now + windowMs }, windowMs / 1000);
        } else if (deviceCurrent.count >= max) {
          const retryAfter = Math.ceil((deviceCurrent.resetAt - now) / 1000);
          res.set('Retry-After', retryAfter);
          return res.status(429).json({
            success: false,
            message,
            retryAfter,
            limitType: 'device'
          });
        } else {
          await setCache(deviceKey, { count: deviceCurrent.count + 1, resetAt: deviceCurrent.resetAt }, windowMs / 1000);
        }

        // Check per-user limit across all devices (if authenticated)
        if (userId) {
          const userKey = `ratelimit:user:devices:${userId}`;
          const userCurrent = await getCache(userKey);

          if (!userCurrent || now > userCurrent.resetAt) {
            await setCache(userKey, { count: 1, resetAt: now + windowMs }, windowMs / 1000);
          } else if (userCurrent.count >= maxPerUser) {
            const retryAfter = Math.ceil((userCurrent.resetAt - now) / 1000);
            res.set('Retry-After', retryAfter);
            return res.status(429).json({
              success: false,
              message: 'Too many requests across all your devices, please try again later',
              retryAfter,
              limitType: 'user'
            });
          } else {
            await setCache(userKey, { count: userCurrent.count + 1, resetAt: userCurrent.resetAt }, windowMs / 1000);
          }
        }

        // Set rate limit headers
        res.set('X-RateLimit-Limit', max);
        res.set('X-RateLimit-Limit-User', maxPerUser);
        res.set('X-Device-ID', deviceFingerprint.substring(0, 16));

        next();
      } catch (error) {
        logger.error('[deviceRateLimiter] Redis error:', error);
        // On Redis error, allow request to proceed (fail-open)
        next();
      }
    };
  }

  // Fallback to in-memory rate limiter
  logger.warn('[deviceRateLimiter] Redis unavailable, using in-memory limiter');
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
    keyGenerator: (req) => generateDeviceFingerprint(req)
  });
}

/**
 * Pre-configured device rate limiters
 */

// Strict device limiter for sensitive operations
const strictDeviceLimiter = createDeviceRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 3,
  maxPerUser: isDev ? 5000 : 10,
  message: 'Too many sensitive operations from this device'
});

// Moderate device limiter for regular operations
const moderateDeviceLimiter = createDeviceRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 50,
  maxPerUser: isDev ? 25000 : 200,
  message: 'Rate limit exceeded for this device'
});

// Lenient device limiter for read operations
const lenientDeviceLimiter = createDeviceRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 200,
  maxPerUser: isDev ? 50000 : 1000,
  message: 'Too many read requests from this device',
  skipIfAuthenticated: true // Skip for authenticated users on read operations
});

module.exports = {
  createDeviceRateLimiter,
  generateDeviceFingerprint,
  strictDeviceLimiter,
  moderateDeviceLimiter,
  lenientDeviceLimiter,
  middleware: moderateDeviceLimiter // Default middleware for app.use
};
