/**
 * Wallet Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/v1/wallet
 */

const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth.middleware');
const {
  getMyWallet,
  getCoinPackages,
  purchaseCoins,
  getTransactionHistory
} = require('../controllers/wallet.controller');

router.use(authenticate);

// ─── Wallet balance ───────────────────────────────────────────────────────────
router.get('/me', getMyWallet);

// ─── Coin packages ────────────────────────────────────────────────────────────
router.get('/packages', getCoinPackages);

// ─── Purchase coins (dev mode — grants directly; prod: integrate payment) ─────
router.post('/purchase',
  [body('packageId').notEmpty().withMessage('packageId is required')],
  validate,
  purchaseCoins
);

// ─── Transaction history ──────────────────────────────────────────────────────
router.get('/history', getTransactionHistory);

module.exports = router;
