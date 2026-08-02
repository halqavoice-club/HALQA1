const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { isRedisReady, getCache, setCache, deleteCache } = require('../utils/redis');
const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const prom = require('../utils/prometheus');

/**
 * Session management middleware
 * 
 * Tracks user sessions across devices with device fingerprinting.
 * Supports:
 * - Device tracking (device ID, name, type)
 * - Session limits (max concurrent sessions per user)
 * - Session termination (specific device or all devices)
 * - Session activity tracking (last seen, IP, user agent)
 * 
 * Usage:
 *   router.post('/api/v1/auth/login', trackSession, loginHandler);
 *   router.get('/api/v1/auth/sessions', authenticate, getSessions);
 *   router.delete('/api/v1/auth/sessions/:id', authenticate, terminateSession);
 */

const SESSION_CACHE_TTL = 300; // 5 minutes
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '10');

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Parse device info from user agent
 */
function parseDeviceInfo(userAgent) {
  const ua = userAgent.toLowerCase();
  
  let deviceType = 'desktop';
  let os = 'unknown';
  let browser = 'unknown';

  // Detect device type
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    deviceType = 'tablet';
  }

  // Detect OS
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/ios|iphone|ipad|ipod/i.test(ua)) os = 'iOS';

  // Detect browser
  if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/edge/i.test(ua)) browser = 'Edge';
  else if (/opera/i.test(ua)) browser = 'Opera';

  return { deviceType, os, browser };
}

/**
 * Track session middleware
 * 
 * Creates or updates a session record for the user.
 * Should be used after successful authentication.
 */
async function trackSession(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next();

    const sessionId = generateSessionId();
    const userAgent = req.headers['user-agent'] || '';
    const ipAddress = req.ip;
    const deviceInfo = parseDeviceInfo(userAgent);
    const deviceFingerprint = crypto.createHash('sha256')
      .update(`${userAgent}|${req.headers['accept-language'] || ''}`)
      .digest('hex');

    // Create session in database
    const session = await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        deviceName: `${deviceInfo.os} - ${deviceInfo.browser}`,
        deviceType: deviceInfo.deviceType,
        deviceFingerprint,
        ipAddress,
        userAgent,
        lastSeenAt: new Date(),
        isActive: true
      }
    });

    // Cache session for quick lookup
    if (isRedisReady()) {
      await setCache(`session:${sessionId}`, session, SESSION_CACHE_TTL);
    }

    // Attach session to request
    req.session = session;
    res.setHeader('X-Session-ID', sessionId);

    // Emit Prometheus metric
    prom.sessionCreationsTotal.inc({ device_type: deviceInfo.deviceType });
    prom.activeSessions.inc();

    logger.info(`[session] Created session ${sessionId} for user ${userId}`);
    next();
  } catch (error) {
    logger.error('[session] Error tracking session:', error);
    // Don't block login if session tracking fails
    next();
  }
}

/**
 * Validate session middleware
 * 
 * Checks if the current session is still active.
 * Should be used after authenticate middleware.
 */
async function validateSession(req, res, next) {
  try {
    const sessionId = req.headers['x-session-id'] || req.cookies.sessionId;
    const userId = req.user?.id;

    if (!sessionId || !userId) return next();

    // Check cache first
    let session;
    if (isRedisReady()) {
      session = await getCache(`session:${sessionId}`);
    }

    // Cache miss - fetch from DB
    if (!session) {
      session = await prisma.session.findUnique({
        where: { id: sessionId }
      });
      
      if (session && isRedisReady()) {
        await setCache(`session:${sessionId}`, session, SESSION_CACHE_TTL);
      }
    }

    // Session not found or inactive
    if (!session || !session.isActive || session.userId !== userId) {
      return errorResponse(res, 'Session expired or invalid', 401);
    }

    // Update last seen time
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() }
    });

    // Invalidate cache after update
    if (isRedisReady()) {
      await deleteCache(`session:${sessionId}`);
    }

    req.session = session;
    next();
  } catch (error) {
    logger.error('[session] Error validating session:', error);
    // Don't block request if session validation fails
    next();
  }
}

/**
 * Enforce session limit middleware
 * 
 * Ensures user doesn't exceed max concurrent sessions.
 * Terminates oldest session if limit exceeded.
 */
async function enforceSessionLimit(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next();

    const activeSessions = await prisma.session.count({
      where: {
        userId,
        isActive: true
      }
    });

    if (activeSessions >= MAX_SESSIONS_PER_USER) {
      // Terminate oldest session
      const oldestSession = await prisma.session.findFirst({
        where: { userId, isActive: true },
        orderBy: { lastSeenAt: 'asc' }
      });

      if (oldestSession) {
        await prisma.session.update({
          where: { id: oldestSession.id },
          data: { isActive: false, terminatedAt: new Date(), terminationReason: 'SESSION_LIMIT' }
        });

        // Invalidate cache
        if (isRedisReady()) {
          await deleteCache(`session:${oldestSession.id}`);
        }

        // Emit Prometheus metric
        prom.sessionTerminationsTotal.inc({ reason: 'SESSION_LIMIT' });
        prom.activeSessions.dec();

        logger.info(`[session] Terminated oldest session ${oldestSession.id} for user ${userId} (limit reached)`);
      }
    }

    next();
  } catch (error) {
    logger.error('[session] Error enforcing session limit:', error);
    // Don't block request if session limit check fails
    next();
  }
}

/**
 * Get all active sessions for current user
 */
async function getSessions(req, res, next) {
  try {
    const userId = req.user.id;

    const sessions = await prisma.session.findMany({
      where: {
        userId,
        isActive: true
      },
      orderBy: { lastSeenAt: 'desc' }
    });

    return res.json({
      success: true,
      data: sessions.map(s => ({
        id: s.id,
        deviceName: s.deviceName,
        deviceType: s.deviceType,
        ipAddress: s.ipAddress,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        isCurrent: s.id === req.session?.id
      }))
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Terminate a specific session
 */
async function terminateSession(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const session = await prisma.session.findUnique({
      where: { id }
    });

    if (!session) {
      return errorResponse(res, 'Session not found', 404);
    }

    if (session.userId !== userId) {
      return errorResponse(res, 'Access denied', 403);
    }

    await prisma.session.update({
      where: { id },
      data: {
        isActive: false,
        terminatedAt: new Date(),
        terminationReason: 'USER_TERMINATED'
      }
    });

    // Invalidate cache
    if (isRedisReady()) {
      await deleteCache(`session:${id}`);
    }

    // Emit Prometheus metric
    prom.sessionTerminationsTotal.inc({ reason: 'USER_TERMINATED' });
    prom.activeSessions.dec();

    logger.info(`[session] User ${userId} terminated session ${id}`);

    return res.json({
      success: true,
      message: 'Session terminated successfully'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Terminate all sessions except current
 */
async function terminateAllSessions(req, res, next) {
  try {
    const userId = req.user.id;
    const currentSessionId = req.session?.id;

    await prisma.session.updateMany({
      where: {
        userId,
        isActive: true,
        ...(currentSessionId && { id: { not: currentSessionId } })
      },
      data: {
        isActive: false,
        terminatedAt: new Date(),
        terminationReason: 'USER_TERMINATED_ALL'
      }
    });

    // Invalidate all user session caches
    if (isRedisReady()) {
      const sessions = await prisma.session.findMany({
        where: { userId, isActive: false },
        select: { id: true }
      });
      
      await Promise.all(
        sessions.map(s => deleteCache(`session:${s.id}`))
      );
    }

    // Emit Prometheus metric
    const terminatedCount = await prisma.session.count({
      where: { userId, isActive: false, terminatedAt: { gte: new Date(Date.now() - 1000) } }
    });
    if (terminatedCount > 0) {
      prom.sessionTerminationsTotal.inc({ reason: 'USER_TERMINATED_ALL' }, terminatedCount);
      prom.activeSessions.dec(terminatedCount);
    }

    logger.info(`[session] User ${userId} terminated all sessions except ${currentSessionId}`);

    return res.json({
      success: true,
      message: 'All other sessions terminated successfully'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  trackSession,
  validateSession,
  enforceSessionLimit,
  getSessions,
  terminateSession,
  terminateAllSessions,
  parseDeviceInfo,
  generateSessionId,
  middleware: (req, res, next) => next() // Placeholder - session tracking is done per-route
};
