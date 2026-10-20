'use strict';
/**
 * Payout Routes — Diamond → Cash withdrawals
 * Mounted at /api/v1/wallet/payout  (user) and /api/v1/admin/payouts (admin)
 */
const router = require('express').Router();
const { body, query } = require('express-validator');
const validate  = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/payout.controller');

// Strict rate limit — payout requests are high-value actions
const payoutLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many payout requests — try again later' }
});

router.use(authenticate);

// ── User endpoints ────────────────────────────────────────────────────────────
router.get('/info',    ctrl.getPayoutInfo);
router.get('/history', ctrl.getPayoutHistory);

router.post('/request',
  payoutLimit,
  [
    body('diamonds').isInt({ min: 2000 }).withMessage('Minimum payout is 2000 diamonds'),
    body('method').isIn(['bank_transfer', 'paypal', 'stripe']),
    body('accountDetails').optional().isObject(),
  ],
  validate,
  ctrl.requestPayout
);

router.delete('/:id/cancel', ctrl.cancelPayout);

// ── Admin endpoints (SUPER_ADMIN only — platform-wide financial operations) ───
// H-8 FIX: SCHOOL_ADMIN can no longer approve platform-wide payout requests.
// Payout processing is a platform-level financial operation, not a school-scoped
// Education operation. Only SUPER_ADMIN (platform owner) should approve payouts.
router.get('/admin/list',
  authorize('SUPER_ADMIN'),
  [query('status').optional().isIn(['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED'])],
  validate,
  ctrl.listPayoutsAdmin
);

router.patch('/admin/:id',
  authorize('SUPER_ADMIN'),
  [
    body('action').isIn(['approve', 'reject', 'processing', 'complete']),
    body('adminNote').optional().isString().isLength({ max: 500 }),
    body('transactionRef').optional().isString().isLength({ max: 200 }),
  ],
  validate,
  ctrl.processPayoutAdmin
);

module.exports = router;
