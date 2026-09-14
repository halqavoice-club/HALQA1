/**
 * Analytics Routes
 * 
 * API endpoints for analytics data
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
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

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/daily-stats
 * @desc    Get daily school statistics
 * @access  Private
 */
router.get('/schools/:schoolId/daily-stats', analyticsController.getDailySchoolStats);

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/daily-stats/:date
 * @desc    Get or create daily school stats for a specific date
 * @access  Private (admin only)
 */
router.get('/schools/:schoolId/daily-stats/:date', analyticsController.getOrCreateDailySchoolStats);

/**
 * @route   PUT /api/v1/analytics/schools/:schoolId/daily-stats/:date
 * @desc    Update daily school statistics
 * @access  Private (admin only)
 */
router.put('/schools/:schoolId/daily-stats/:date', analyticsController.updateDailySchoolStats);

/**
 * @route   GET /api/v1/analytics/users/:userId/daily-stats
 * @desc    Get daily user statistics
 * @access  Private
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
 * @access  Private (admin only)
 */
router.put('/users/:userId/daily-stats/:date', analyticsController.updateDailyUserStats);

/**
 * @route   POST /api/v1/analytics/users/:userId/daily-stats/:date/increment/:stat
 * @desc    Increment a user stat counter
 * @access  Private (system use)
 */
router.post('/users/:userId/daily-stats/:date/increment/:stat', analyticsController.incrementUserStat);

/**
 * @route   GET /api/v1/analytics/schools/:schoolId/analytics
 * @desc    Get aggregated school analytics
 * @access  Private
 */
router.get('/schools/:schoolId/analytics', analyticsController.getSchoolAnalytics);

/**
 * @route   GET /api/v1/analytics/users/:userId/analytics
 * @desc    Get aggregated user analytics
 * @access  Private
 */
router.get('/users/:userId/analytics', analyticsController.getUserAnalytics);

module.exports = router;
