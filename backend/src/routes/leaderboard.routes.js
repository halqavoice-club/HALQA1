/**
 * Leaderboard Routes
 * 
 * API endpoints for leaderboard functionality
 */

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const leaderboardController = require('../controllers/leaderboard.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/leaderboard/global
 * @desc    Get global leaderboard
 * @access  Private
 */
router.get('/global', leaderboardController.getGlobalLeaderboard);

/**
 * @route   GET /api/v1/leaderboard/users/:userId/global
 * @desc    Get user's global leaderboard position
 * @access  Private
 */
router.get('/users/:userId/global', leaderboardController.getUserGlobalPosition);

/**
 * @route   GET /api/v1/leaderboard/schools/:schoolId
 * @desc    Get school leaderboard
 * @access  Private
 */
router.get('/schools/:schoolId', leaderboardController.getSchoolLeaderboard);

/**
 * @route   GET /api/v1/leaderboard/schools/:schoolId/users/:userId
 * @desc    Get user's school leaderboard position
 * @access  Private
 */
router.get('/schools/:schoolId/users/:userId', leaderboardController.getUserSchoolPosition);

/**
 * @route   POST /api/v1/leaderboard/global/recalculate
 * @desc    Recalculate global leaderboard
 * @access  Private (SUPER_ADMIN only — heavy DB operation)
 * SOC-P1-03 FIX: Added authorize('SUPER_ADMIN'). Previously any authenticated
 * user could trigger a full leaderboard recalculation, a heavy DB operation
 * that could be abused for DoS via CPU/DB exhaustion.
 */
router.post('/global/recalculate', authorize('SUPER_ADMIN'), leaderboardController.recalculateGlobalLeaderboard);

/**
 * @route   POST /api/v1/leaderboard/schools/:schoolId/recalculate
 * @desc    Recalculate school leaderboard
 * @access  Private (SUPER_ADMIN only)
 * SOC-P1-03 FIX: Same guard applied for consistency.
 */
router.post('/schools/:schoolId/recalculate', authorize('SUPER_ADMIN'), leaderboardController.recalculateSchoolLeaderboard);

/**
 * @route   GET /api/v1/leaderboard/periods
 * @desc    Get available leaderboard periods
 * @access  Private
 */
router.get('/periods', leaderboardController.getLeaderboardPeriods);

module.exports = router;
