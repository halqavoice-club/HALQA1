'use strict';

/**
 * schoolAuth.middleware.js
 *
 * School-scoped authorization middleware for the Education domain.
 *
 * CORE RULE: Education roles (TEACHER, STUDENT, GUARDIAN, SCHOOL_ADMIN,
 * SUPER_ADMIN) are stored in the school_memberships table, NOT as global
 * User.role values. This middleware validates school membership and role
 * at the school level.
 *
 * Usage:
 *   router.get('/grades', authenticate, requireSchoolMember('schoolId'), requireSchoolRole('TEACHER', 'SCHOOL_ADMIN'), ctrl.listGrades)
 *
 * The schoolId parameter is resolved (in order of priority) from:
 *   1. req.params.schoolId
 *   2. req.headers['x-school-id']
 *   3. req.body.schoolId
 *   4. req.query.schoolId
 *   5. req.user.schoolId (legacy fallback — single-school users)
 *
 * Security: ALL checks are server-side. Client-supplied schoolId / role values
 * from the request body are NEVER trusted for authorization.
 */

const prisma = require('../utils/prisma');
const { errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── Cache helpers (reuses Redis if available) ────────────────────────────────
const MEMBERSHIP_CACHE_TTL = 30; // seconds — short TTL so role/status changes propagate quickly

function membershipCacheKey(userId, schoolId) {
  return `school:membership:${userId}:${schoolId}`;
}

async function getMembershipFromCache(userId, schoolId) {
  try {
    const { isRedisReady, getCache } = require('../utils/redis');
    if (!isRedisReady()) return null;
    return await getCache(membershipCacheKey(userId, schoolId));
  } catch {
    return null;
  }
}

async function setMembershipInCache(userId, schoolId, membership) {
  try {
    const { isRedisReady, setCache } = require('../utils/redis');
    if (!isRedisReady()) return;
    await setCache(membershipCacheKey(userId, schoolId), membership, MEMBERSHIP_CACHE_TTL);
  } catch {
    // non-fatal — continue without caching
  }
}

/**
 * Invalidate the school membership cache for a user+school combination.
 * Call this whenever a membership is created, updated, or deleted.
 */
async function invalidateMembershipCache(userId, schoolId) {
  try {
    const { isRedisReady, deleteCache } = require('../utils/redis');
    if (!isRedisReady()) return;
    await deleteCache(membershipCacheKey(userId, schoolId));
    logger.debug(`[schoolAuth:cache] Invalidated membership cache for user ${userId} in school ${schoolId}`);
  } catch {
    // non-fatal
  }
}

// ─── Resolve schoolId from request ───────────────────────────────────────────
function resolveSchoolId(req) {
  return (
    req.params.schoolId ||
    req.headers['x-school-id'] ||
    req.body?.schoolId ||
    req.query?.schoolId ||
    req.user?.schoolId ||    // legacy single-school fallback
    null
  );
}

// ─── Load membership record ───────────────────────────────────────────────────
async function loadMembership(userId, schoolId) {
  // Try cache first
  let membership = await getMembershipFromCache(userId, schoolId);
  if (membership !== null) return membership;

  // Cache miss — query DB
  // NF-3 FIX: Filter deletedAt: null so soft-deleted memberships are treated as non-existent.
  // Previously findUnique did not check deletedAt, so a user whose membership was soft-deleted
  // but whose status was still 'ACTIVE' at deletion time could retain school access.
  membership = await prisma.schoolMembership.findFirst({
    where: { userId, schoolId, deletedAt: null },
    select: { id: true, userId: true, schoolId: true, role: true, status: true }
  });

  // Null means no membership — cache the absence too (as false) to prevent DB hammering
  await setMembershipInCache(userId, schoolId, membership || false);

  return membership || null;
}

// ─── requireSchoolMember ─────────────────────────────────────────────────────
/**
 * Ensures the authenticated user has an ACTIVE school membership for the
 * school identified in the request. Attaches req.schoolMembership.
 *
 * Must be used after authenticate().
 *
 * Legacy compatibility: SUPER_ADMIN users with no SchoolMembership record
 * but with user.role === 'SUPER_ADMIN' are allowed through (they have global
 * platform-admin access until fully migrated to school memberships).
 */
function requireSchoolMember(schoolIdParam) {
  return async (req, res, next) => {
    try {
      if (!req.user) return errorResponse(res, 'Authentication required', 401);

      const schoolId = schoolIdParam
        ? (req.params[schoolIdParam] || req.headers['x-school-id'] || req.body?.[schoolIdParam] || req.query?.[schoolIdParam] || req.user?.schoolId)
        : resolveSchoolId(req);

      if (!schoolId) {
        return errorResponse(res, 'School context required', 400);
      }

      // Attach for downstream middleware/controllers
      req.schoolId = schoolId;

      // Legacy SUPER_ADMIN global bypass — platform-level admins can access any school
      // This is the LEGACY behavior. New users should have an explicit SchoolMembership.
      if (req.user.role === 'SUPER_ADMIN') {
        req.schoolMembership = {
          id: null,
          userId: req.user.id,
          schoolId,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          isLegacyGlobal: true
        };
        return next();
      }

      const membership = await loadMembership(req.user.id, schoolId);

      if (!membership) {
        return errorResponse(res, 'You are not a member of this school', 403);
      }

      if (membership.status === 'SUSPENDED') {
        return errorResponse(res, 'Your school membership is suspended', 403);
      }

      if (membership.status === 'PENDING') {
        return errorResponse(res, 'Your school membership is pending approval', 403);
      }

      if (membership.status !== 'ACTIVE') {
        return errorResponse(res, 'Inactive school membership', 403);
      }

      req.schoolMembership = membership;
      next();
    } catch (error) {
      logger.error('[schoolAuth] requireSchoolMember error:', error.message);
      next(error);
    }
  };
}

// ─── requireSchoolRole ────────────────────────────────────────────────────────
/**
 * Ensures the user's school membership role matches one of the allowed roles.
 * Must be used AFTER requireSchoolMember().
 *
 * @param {...string} roles - Allowed school roles (e.g. 'TEACHER', 'SCHOOL_ADMIN')
 */
function requireSchoolRole(...roles) {
  return (req, res, next) => {
    if (!req.schoolMembership) {
      return errorResponse(res, 'School membership context missing — use requireSchoolMember first', 500);
    }

    const { role } = req.schoolMembership;
    if (!roles.includes(role)) {
      return errorResponse(res, 'Insufficient school permissions', 403);
    }

    next();
  };
}

// ─── requireSchoolAccess (enhanced) ──────────────────────────────────────────
/**
 * Backward-compatible school isolation check.
 * For routes that already use the legacy user.schoolId pattern, this replaces
 * the old requireSchoolAccess from auth.middleware.js with a version that also
 * checks the new SchoolMembership table.
 *
 * Checks (in order):
 *   1. If user is legacy SUPER_ADMIN → allow
 *   2. If user has active SchoolMembership for the school → allow
 *   3. If user.schoolId matches AND no membership record exists (pre-migration user) → allow
 *   4. If user.schoolId matches AND membership is SUSPENDED/INACTIVE → DENY (M-8 FIX)
 *   5. Otherwise → deny
 */
async function requireSchoolAccess(req, res, next) {
  try {
    const schoolId = resolveSchoolId(req);
    if (!schoolId) return next(); // no school in request — not a school-scoped route

    const { user } = req;
    if (!user) return errorResponse(res, 'Authentication required', 401);

    // Legacy SUPER_ADMIN bypass
    if (user.role === 'SUPER_ADMIN') return next();

    // Check new SchoolMembership table (authoritative source)
    const membership = await loadMembership(user.id, schoolId);

    if (membership) {
      // Membership record exists — enforce its status
      if (membership.status === 'SUSPENDED') {
        return errorResponse(res, 'Your school membership is suspended', 403);
      }
      if (membership.status === 'PENDING') {
        return errorResponse(res, 'Your school membership is pending approval', 403);
      }
      if (membership.status !== 'ACTIVE') {
        return errorResponse(res, 'Inactive school membership', 403);
      }
      // ACTIVE membership — allow
      req.schoolMembership = membership;
      req.schoolId = schoolId;
      return next();
    }

    // M-8 FIX: No membership record exists — only allow via legacy fallback
    // if user.schoolId matches. This covers pre-migration users who haven't
    // had a SchoolMembership record created yet. Once a membership is created
    // (via backfill or join/invite), the above branch handles it.
    if (user.schoolId === schoolId) {
      req.schoolId = schoolId;
      return next();
    }

    return errorResponse(res, 'Access denied to this school', 403);
  } catch (error) {
    logger.error('[schoolAuth] requireSchoolAccess error:', error.message);
    next(error);
  }
}

// ─── getSchoolMemberships ─────────────────────────────────────────────────────
/**
 * Helper function for controllers: load all active school memberships for a user.
 * Returns an array of { schoolId, school, role, status } objects.
 */
async function getSchoolMemberships(userId) {
  return prisma.schoolMembership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      deletedAt: null
    },
    include: {
      school: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          type: true,
          isActive: true
        }
      }
    },
    orderBy: { joinedAt: 'asc' }
  });
}

module.exports = {
  requireSchoolMember,
  requireSchoolRole,
  requireSchoolAccess,
  getSchoolMemberships,
  invalidateMembershipCache,
  resolveSchoolId,
  loadMembership
};
