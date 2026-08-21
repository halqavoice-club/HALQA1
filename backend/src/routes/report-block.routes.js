/**
 * Report & Block Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes require authentication.
 *
 * Report a user:
 *   POST   /api/v1/report-block/report/:userId      — submit/update a report
 *   GET    /api/v1/report-block/reports             — admin: list all reports
 *   PATCH  /api/v1/report-block/reports/:id/review  — admin: update status
 *
 * Block a user:
 *   POST   /api/v1/report-block/block/:userId        — block a user
 *   DELETE /api/v1/report-block/block/:userId        — unblock a user
 *   GET    /api/v1/report-block/blocked              — list users I blocked
 *   GET    /api/v1/report-block/block/:userId/status — check block status
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/report-block.controller');

router.use(authenticate);

// ─── REPORT ───────────────────────────────────────────────────────────────────
router.post(
  '/report/:userId',
  [
    body('reason').notEmpty().withMessage('reason is required'),
    body('description').optional().isString(),
    body('roomId').optional().isString(),
  ],
  validate,
  ctrl.reportUser
);

// Admin only: view and manage reports
// F-1 FIX: Social report moderation is a PLATFORM-LEVEL operation.
// SCHOOL_ADMIN should NOT have access to reports filed about users at other schools.
// Only SUPER_ADMIN (HALQA platform admin) should moderate platform-wide social reports.
router.get(
  '/reports',
  authorize('SUPER_ADMIN'),
  ctrl.listReports
);

router.patch(
  '/reports/:id/review',
  authorize('SUPER_ADMIN'),
  [body('status').notEmpty().withMessage('status is required')],
  validate,
  ctrl.reviewReport
);

// ─── BLOCK ────────────────────────────────────────────────────────────────────
router.post('/block/:userId',        ctrl.blockUser);
router.delete('/block/:userId',      ctrl.unblockUser);
router.get('/blocked',               ctrl.getBlockedUsers);
router.get('/block/:userId/status',  ctrl.getBlockStatus);

module.exports = router;
