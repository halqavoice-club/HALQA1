'use strict';
/**
 * Analytics Routes
 *
 * API endpoints for analytics data
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
const { requireSchoolMember, requireSchoolRole } = require('../middleware/schoolAuth.middleware');
const analyticsController = require('../controllers/analytics.controller');

// Restrict to IP allowlist before any other checks (Requirements: 10.1, 10.2)
router.use(ipAllowlist);

/**
 * @route   POST /api/v1/analytics/events
 * @desc    Track a client-side analytics event (fire-and-forget, always 202)
 * @access  Public — auth is optional. Authenticated users get stat tracking;
 *          unauthenticated requests are silently accepted and discarded.
 *          This route must be declared BEFORE router.use(authenticate) so it
 *          doesn't produce 401 noise when fired before login or after token expiry.
 */
router.post('/events', analyticsController.trackEvent);

// All remaining routes require authentication
router.use(authenticate);

// ─── School analytics — FIND-01 FIX ──────────────────────────────────────────
// School analytics endpoints previously used assertSchoolStatsAccess() which
// relied on req.user.schoolId (legacy field) for isolation. This was inconsistent
// with ARCH-01 and broke for new-architecture MEMBER users whose User.schoolId
// is null but who have an active SchoolMembership.
//
// Fix: mount requireSchoolMember('schoolId') on all school-scoped analytics routes.
// This enforces the authoritative SchoolMembership check, sets req.schoolMembership
// and req.schoolId, and rejects SUPER_ADMIN without an explicit membership record.
// It correctly handles MEMBER users with User.schoolId=null who hold a valid membership.

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/daily-stats
 * @desc    Get daily school statistics
 * @access  Private — any active school member
 */
router.get(
  '/schools/:schoolId/daily-stats',
  requireSchoolMember('schoolId'),
  analyticsController.getDailySchoolStats
);

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/daily-stats/:date
 * @desc    Get or create daily school stats for a specific date
 * @access  Private — school admin only (creates data)
 */
router.get(
  '/schools/:schoolId/daily-stats/:date',
  requireSchoolMember('schoolId'),
  // SA-ANALYTICS-001 FIX: Removed 'SUPER_ADMIN' from allowed roles.
  // SUPER_ADMIN is a platform-admin role and must NOT access school-scoped data.
  // requireSchoolMember() above already rejects SUPER_ADMIN without a membership,
  // but even with a legacy SchoolMembership, SUPER_ADMIN must not reach school endpoints.
  // This is enforced by not listing SUPER_ADMIN as an allowed school role here.
  requireSchoolRole('SCHOOL_ADMIN'),
  analyticsController.getOrCreateDailySchoolStats
);

/**
 * @route   PUT /api/v1/analytics/schools/:schoolId/daily-stats/:date
 * @desc    Update daily school statistics
 * @access  Private — school admin only
 */
router.put(
  '/schools/:schoolId/daily-stats/:date',
  requireSchoolMember('schoolId'),
  // SA-ANALYTICS-001 FIX: Removed 'SUPER_ADMIN' from allowed roles.
  requireSchoolRole('SCHOOL_ADMIN'),
  analyticsController.updateDailySchoolStats
);

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/analytics
 * @desc    Get aggregated school analytics
 * @access  Private — any active school member
 */
router.get(
  '/schools/:schoolId/analytics',
  requireSchoolMember('schoolId'),
  analyticsController.getSchoolAnalytics
);

// ─── User analytics — no school membership required ───────────────────────────

/**
 * @route   GET /api/v1/analytics/users/:userId/daily-stats
 * @desc    Get daily user statistics
 * @access  Private — own stats only (SUPER_ADMIN sees any)
 */
router.get('/users/:userId/daily-stats', analyticsController.getDailyUserStats);

/**
 * @route   GET /api/v1/analytics/users/:userId/daily-stats/:date
 * @desc    Get or create daily user stats for a specific date
 * @access  Private
 */
router.get('/users/:userId/daily-stats/:date', analyticsController.getOrCreateDailyUserStats);

/**
 * @route   PUT /api/v1/analytics/users/:userId/daily-stats/:date
 * @desc    Update daily user statistics
 * @access  Private — own stats only
 */
router.put('/users/:userId/daily-stats/:date', analyticsController.updateDailyUserStats);

/**
 * @route   POST /api/v1/analytics/users/:userId/daily-stats/:date/increment/:stat
 * @desc    Increment a user stat counter
 * @access  Private (system use — own user only)
 */
router.post('/users/:userId/daily-stats/:date/increment/:stat', analyticsController.incrementUserStat);

/**
 * @route   GET /api/v1/analytics/users/:userId/analytics
 * @desc    Get aggregated user analytics
 * @access  Private — own stats only
 */
router.get('/users/:userId/analytics', analyticsController.getUserAnalytics);

module.exports = router;
