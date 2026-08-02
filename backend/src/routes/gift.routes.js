/**
 * Gift Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/v1/gifts
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const {
  listGifts,
  getDailyLeaderboard
} = require('../controllers/gift.controller');

// Gift-specific rate limiter: 30 requests per 10 seconds per user
const giftRateLimit = rateLimit({
  windowMs: 10 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many gift requests, slow down' }
});

router.use(authenticate);

// ─── Gift catalog ─────────────────────────────────────────────────────────────
router.get('/', listGifts);

// ─── Daily leaderboard ────────────────────────────────────────────────────────
router.get('/leaderboard/daily', getDailyLeaderboard);

module.exports = router;
