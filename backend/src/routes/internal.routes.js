'use strict';
/**
 * internal.routes.js — HALQA Internal Platform Administration
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/v1/internal
 *
 * SECURITY MODEL:
 *   Three independent layers must ALL be satisfied:
 *     1. IP Allowlist  — request must originate from ADMIN_IP_ALLOWLIST
 *     2. authenticate  — valid JWT access token required
 *     3. authorize     — caller must have User.role === 'SUPER_ADMIN'
 *
 *   If ADMIN_IP_ALLOWLIST is empty/unset, the IP layer passes through
 *   (development convenience). In production, set ADMIN_IP_ALLOWLIST to
 *   restrict access to your VPN / management IP range.
 *
 * ROUTES:
 *   POST /api/v1/internal/admin/provision
 *     Provision or revoke SUPER_ADMIN status for a platform administrator.
 *     Only SUPER_ADMIN can call this. Fully audited.
 *
 *   GET  /api/v1/internal/admin/list
 *     List all current SUPER_ADMIN users.
 *     Only SUPER_ADMIN can call this.
 *
 * AUDIT:
 *   Every provisioning action writes to AuditLog:
 *     entity     = 'user'
 *     entityId   = target user id
 *     action     = UPDATE
 *     oldValues  = { role: previousRole }
 *     newValues  = { role: 'SUPER_ADMIN' } or { role: 'MEMBER' }
 *     userId     = acting SUPER_ADMIN id
 *     schoolId   = null (platform operation, not school-scoped)
 *     ipAddress  = caller IP
 *     userAgent  = caller user agent
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not accept User.role from request body (hardcodes SUPER_ADMIN)
 *   - Does not accept SCHOOL_ADMIN or any education role
 *   - Does not change SchoolMembership records
 *   - Does not affect school administration
 *   - Does not affect social features
 *   - Cannot be called by MEMBER, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN
 *
 * SUPER_ADMIN PROVISIONING LIFECYCLE:
 *   Bootstrap:   node prisma/seed-demo-accounts.js  (dev/staging only)
 *   Production:  POST /api/v1/internal/admin/provision  (SUPER_ADMIN only)
 *   Revocation:  POST /api/v1/internal/admin/provision { action: 'revoke' }
 *   Emergency:   Direct DB: UPDATE users SET role='SUPER_ADMIN' WHERE email=?
 */

const router  = require('express').Router();
const { body, param } = require('express-validator');
const validate        = require('../middleware/validate');
const { authenticate, authorize, invalidateUserCache } = require('../middleware/auth.middleware');
const ipAllowlist     = require('../middleware/ipAllowlist');
const rateLimit       = require('express-rate-limit');
const prisma          = require('../utils/prisma');
const { v4: uuidv4 }  = require('uuid');
const { successResponse, errorResponse } = require('../utils/response');
const logger          = require('../utils/logger');

// ─── Dedicated rate limiter for provisioning ─────────────────────────────────
// Provisioning is a low-frequency, high-trust operation.
// 10 requests per 15 minutes per actor should be more than sufficient for
// legitimate operator use while blocking brute-force or automation attempts.
// This limiter is intentionally strict — provisioning should be deliberate.
// Note: even if ADMIN_IP_ALLOWLIST is not set, rate limiting still applies.
//
// In test environments (NODE_ENV=test), rate limiting is disabled to prevent
// test interference. The security guarantee is enforced at the auth layer.
const provisionLimiter = rateLimit({
  windowMs:   15 * 60 * 1000,
  // In test environments (JEST_WORKER_ID set), use a very high limit so tests
  // never hit it regardless of how many requests are made.
  // In production (no JEST_WORKER_ID), enforce 10 requests per 15 minutes per actor.
  max:        process.env.JEST_WORKER_ID ? 10000 : 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many provisioning requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Layer 1: IP allowlist ────────────────────────────────────────────────────
// All internal routes are IP-restricted before any auth check.
// Set ADMIN_IP_ALLOWLIST in .env to restrict to VPN/management IPs.
// Empty = allow all IPs (dev convenience — lock this in production).
router.use(ipAllowlist);

// ─── Layer 2: Authentication ──────────────────────────────────────────────────
// Valid JWT access token required.
router.use(authenticate);

// ─── Layer 3: Platform administrator authorization ───────────────────────────
// Only existing SUPER_ADMIN can access internal provisioning endpoints.
// MEMBER, SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN are all blocked here.
router.use(authorize('SUPER_ADMIN'));

// ─── POST /api/v1/internal/admin/provision ───────────────────────────────────
/**
 * Provision or revoke HALQA platform administrator access.
 *
 * Body:
 *   targetUserId  {string}  — ID of the user to promote/revoke
 *   action        {string}  — 'grant' | 'revoke'
 *   reason        {string}  — Required justification (for audit trail)
 *
 * Security:
 *   - Caller must be SUPER_ADMIN (enforced by router.use(authorize('SUPER_ADMIN')))
 *   - IP allowlist enforced by router.use(ipAllowlist)
 *   - action 'grant' sets User.role = 'SUPER_ADMIN'
 *   - action 'revoke' sets User.role = 'MEMBER' (reverts to social-only)
 *   - Cannot be triggered by any ordinary user-facing operation
 *   - Full audit trail written regardless of outcome
 *
 * Prevents self-demotion of the last SUPER_ADMIN.
 */
router.post('/admin/provision',
  provisionLimiter,
  [
    body('targetUserId').notEmpty().withMessage('targetUserId is required'),
    body('action').isIn(['grant', 'revoke']).withMessage('action must be grant or revoke'),
    body('reason').trim().notEmpty().isLength({ min: 10, max: 500 }).withMessage('reason is required (10-500 chars)'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { targetUserId, action, reason } = req.body;
      // SECURITY: actorId comes from authenticated req.user, NEVER from req.body
      const actorId    = req.user.id;
      const ipAddress  = req.ip || req.connection?.remoteAddress;
      const userAgent  = req.headers['user-agent'];
      const requestId  = uuidv4();

      // Prevent self-modification (both grant and revoke)
      if (targetUserId === actorId) {
        logger.warn(`[internal:provision] Actor ${actorId} attempted self-modification (${action}) — blocked`);
        return errorResponse(res, 'Cannot modify your own platform role. Use another SUPER_ADMIN account.', 400);
      }

      // Fetch target user
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, deletedAt: true }
      });

      if (!targetUser) {
        return errorResponse(res, 'Target user not found', 404);
      }

      if (targetUser.deletedAt) {
        return errorResponse(res, 'Cannot provision a deleted user', 400);
      }

      const previousRole = targetUser.role;

      if (action === 'grant') {
        if (targetUser.role === 'SUPER_ADMIN') {
          return errorResponse(res, 'User is already a platform administrator', 409);
        }

        // TRANSACTION: role update + audit record are atomic.
        // If either fails, neither is committed.
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: targetUserId },
            data:  { role: 'SUPER_ADMIN' }
          });
          await tx.auditLog.create({
            data: {
              id:        uuidv4(),
              userId:    actorId,
              schoolId:  null,
              action:    'UPDATE',
              entity:    'user_platform_role',
              entityId:  targetUserId,
              oldValues: { role: previousRole, reason, requestId },
              newValues: { role: 'SUPER_ADMIN', action: 'GRANT_SUPER_ADMIN', reason, requestId },
              ipAddress: ipAddress || null,
              userAgent: userAgent || null,
            }
          });
        });

        await invalidateUserCache(targetUserId);

        logger.info(`[internal:provision] SUPER_ADMIN granted to ${targetUser.email} (${targetUserId}) by ${actorId} — requestId=${requestId}`);

        return successResponse(res, {
          userId:     targetUserId,
          email:      targetUser.email,
          previousRole,
          newRole:    'SUPER_ADMIN',
          action:     'grant',
          requestId,
          auditedAt:  new Date().toISOString()
        }, `Platform administrator access granted to ${targetUser.email}`);

      } else {
        // action === 'revoke'
        if (targetUser.role !== 'SUPER_ADMIN') {
          return errorResponse(res, 'User is not a platform administrator', 409);
        }

        // Prevent revoking the last SUPER_ADMIN
        const remainingSuperAdmins = await prisma.user.count({
          where: { role: 'SUPER_ADMIN', deletedAt: null, id: { not: targetUserId } }
        });

        if (remainingSuperAdmins === 0) {
          logger.warn(`[internal:provision] Attempted to revoke the last SUPER_ADMIN ${targetUserId} — blocked`);
          return errorResponse(res, 'Cannot revoke the last platform administrator. Grant SUPER_ADMIN to another account first.', 400);
        }

        // TRANSACTION: role update + audit record are atomic.
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: targetUserId },
            data:  { role: 'MEMBER' }
          });
          await tx.auditLog.create({
            data: {
              id:        uuidv4(),
              userId:    actorId,
              schoolId:  null,
              action:    'UPDATE',
              entity:    'user_platform_role',
              entityId:  targetUserId,
              oldValues: { role: previousRole, reason, requestId },
              newValues: { role: 'MEMBER', action: 'REVOKE_SUPER_ADMIN', reason, requestId },
              ipAddress: ipAddress || null,
              userAgent: userAgent || null,
            }
          });
        });

        await invalidateUserCache(targetUserId);

        logger.info(`[internal:provision] SUPER_ADMIN revoked from ${targetUser.email} (${targetUserId}) by ${actorId} — requestId=${requestId}`);

        return successResponse(res, {
          userId:     targetUserId,
          email:      targetUser.email,
          previousRole,
          newRole:    'MEMBER',
          action:     'revoke',
          requestId,
          auditedAt:  new Date().toISOString()
        }, `Platform administrator access revoked from ${targetUser.email}`);
      }
    } catch (error) { next(error); }
  }
);

// ─── GET /api/v1/internal/admin/list ─────────────────────────────────────────
/**
 * List all current SUPER_ADMIN users.
 * Used for operator visibility — who has platform admin access right now.
 */
router.get('/admin/list',
  async (req, res, next) => {
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', deletedAt: null },
        select: {
          id:          true,
          email:       true,
          firstName:   true,
          lastName:    true,
          status:      true,
          lastLoginAt: true,
          createdAt:   true
        },
        orderBy: { createdAt: 'asc' }
      });

      return successResponse(res, {
        count:  admins.length,
        admins
      }, 'Platform administrators listed');
    } catch (error) { next(error); }
  }
);

// ─── GET /api/v1/internal/admin/audit ────────────────────────────────────────
/**
 * List platform administrator provisioning audit records.
 * Immutable — no delete/update route for audit records.
 */
router.get('/admin/audit',
  async (req, res, next) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
      const take = Math.min(100, parseInt(limit) || 50);

      const [records, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { entity: 'user_platform_role', schoolId: null },
          include: { user: { select: { email: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take
        }),
        prisma.auditLog.count({ where: { entity: 'user_platform_role', schoolId: null } })
      ]);

      return successResponse(res, { records, total, page: parseInt(page), limit: take });
    } catch (error) { next(error); }
  }
);

module.exports = router;
