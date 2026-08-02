'use strict';
/**
 * Creator Economy Routes — Phase B-6
 * Mounted at /api/v1/creators
 */
const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validate  = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/creator.controller');

const tipLimit = rateLimit({
  windowMs: 60 * 1000, max: 20,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many tips, slow down' }
});

router.use(authenticate);

// ── My creator profile ────────────────────────────────────────────────────────
router.post('/me/become', ctrl.becomeCreator);
router.patch('/me',       ctrl.updateCreatorProfile);
router.get('/me/dashboard', ctrl.getDashboard);

// ── Tiers ─────────────────────────────────────────────────────────────────────
router.post('/me/tiers',
  [body('name').trim().notEmpty(), body('priceCoins').isInt({ min: 1 })],
  validate, ctrl.createTier
);
router.patch('/me/tiers/:tierId', ctrl.updateTier);

// ── Public creator profile (by userId) ────────────────────────────────────────
router.get('/featured', async (req, res, next) => {
  // Returns top creator profiles by subscriber count — used by Explore page
  try {
    const prisma = require('../utils/prisma');
    const { successResponse } = require('../utils/response');
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const creators = await prisma.creatorProfile.findMany({
      where:   { isActive: true },
      orderBy: { subscriberCount: 'desc' },
      take:    limit,
      select: {
        id: true, userId: true, displayName: true, tagline: true,
        subscriberCount: true, totalEarned: true, isVerified: true,
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, username: true } }
      }
    });
    return successResponse(res, creators);
  } catch (e) { next(e); }
});

router.get('/:userId', ctrl.getCreatorProfile);

// ── Subscribe / unsubscribe ───────────────────────────────────────────────────
router.post('/:userId/subscribe',
  [body('tierId').notEmpty()], validate, ctrl.subscribe
);
router.post('/:userId/unsubscribe', ctrl.unsubscribe);

// ── Tips ──────────────────────────────────────────────────────────────────────
router.post('/:userId/tip',
  tipLimit,
  [body('amount').isInt({ min: 1 }), body('message').optional().isString().isLength({ max: 280 })],
  validate, ctrl.sendTip
);

// ── My subscriptions ──────────────────────────────────────────────────────────
router.get('/my/subscriptions', ctrl.getMySubscriptions);

// ── Payout (L9 fix) ────────────────────────────────────────────────────────────
// GET  /creators/me/payout-info    — show balance, conversion rate, min payout
// POST /creators/me/payout-request — submit a withdrawal request
router.get('/me/payout-info', ctrl.getPayoutInfo);

router.post('/me/payout-request',
  [
    body('diamonds').isInt({ min: 1 }).withMessage('diamonds must be a positive integer'),
    body('paymentMethod').optional().isIn(['bank_transfer', 'paypal', 'stripe_connect']),
    body('paymentDetails').isObject().withMessage('paymentDetails is required'),
    body('paymentDetails.accountHolder').notEmpty().withMessage('paymentDetails.accountHolder is required'),
  ],
  validate,
  ctrl.requestPayout
);

module.exports = router;
