'use strict';
/**
 * Admin Economy Routes — Task 13.1
 * Mounted at /api/v1/admin/economy
 * Access: SUPER_ADMIN only
 */
const router = require('express').Router();
const { query } = require('express-validator');
const validate   = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/admin-economy.controller');

router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

// GET /api/v1/admin/economy/revenue-report?startDate=2026-01-01&endDate=2026-03-31
router.get('/revenue-report',
  [
    query('startDate').notEmpty().withMessage('startDate is required'),
    query('endDate').notEmpty().withMessage('endDate is required'),
  ],
  validate,
  ctrl.getRevenueReport
);

// GET /api/v1/admin/economy/platform-revenue?startDate=2026-01-01&endDate=2026-03-31
// Returns the explicit PlatformRevenueEntry ledger — authoritative platform earnings.
router.get('/platform-revenue',
  [
    query('startDate').notEmpty().withMessage('startDate is required'),
    query('endDate').notEmpty().withMessage('endDate is required'),
    query('sourceType').optional().isIn(['GIFT', 'TIP', 'SUBSCRIPTION', 'COIN_PURCHASE'])
      .withMessage('sourceType must be GIFT, TIP, SUBSCRIPTION, or COIN_PURCHASE'),
  ],
  validate,
  ctrl.getPlatformRevenue
);

module.exports = router;
