'use strict';
/**
 * Platform Revenue Ledger — Write Utility
 * ─────────────────────────────────────────────────────────────────────────────
 * Single helper used by gift, creator, and stripe controllers to write an
 * explicit platform revenue entry inside an existing Prisma transaction.
 *
 * The platform retains 50% of every monetised event (PLATFORM_SHARE_PERCENT).
 * Previously this 50% was implicit — coins were deducted from senders but
 * the platform's share was never recorded anywhere. This utility makes it
 * explicit and auditable.
 *
 * Usage (inside a prisma.$transaction callback):
 *
 *   await writePlatformRevenue(tx, {
 *     sourceType: 'GIFT',
 *     sourceId:   giftTransaction.id,
 *     userId:     senderId,
 *     coins:      platformShare(totalCoins),  // e.g. 50 for a 100-coin gift
 *   });
 *
 * This write is FATAL — it must not be wrapped in .catch(() => {}).
 * If the revenue ledger fails, the entire transaction rolls back.
 * This guarantees consistency: no revenue without a record, no record without revenue.
 *
 * Source types:
 *   GIFT         — platform share of a gift send (50% of coinsSpent)
 *   TIP          — platform share of a creator tip (50% of amount)
 *   SUBSCRIPTION — platform share of a subscription charge (50% of priceCoins)
 *   COIN_PURCHASE— full gross inflow of a Stripe coin purchase (100% of coins)
 */

const { v4: uuidv4 }     = require('uuid');
const { platformShare }  = require('../services/economy.config');

// 100 coins = $1.00, so 1 coin = $0.01 in USD equivalent for revenue reporting
const COINS_TO_USD = 0.01;

/**
 * Write a platform revenue entry inside an existing Prisma transaction.
 *
 * @param {object} tx         — Prisma interactive transaction client
 * @param {object} opts
 * @param {'GIFT'|'TIP'|'SUBSCRIPTION'|'COIN_PURCHASE'} opts.sourceType
 * @param {string} opts.sourceId   — ID of the originating record
 * @param {string} opts.userId     — user whose action generated the revenue
 * @param {number} opts.coins      — platform coins retained (positive integer)
 * @returns {Promise<object>}      — the created PlatformRevenueEntry record
 */
async function writePlatformRevenue(tx, { sourceType, sourceId, userId, coins }) {
  if (!coins || coins <= 0) return null; // nothing to record (e.g. toDiamonds(1) = 0)

  const usdEquiv = parseFloat((coins * COINS_TO_USD).toFixed(2));

  return tx.platformRevenueEntry.create({
    data: {
      id:         uuidv4(),
      sourceType,
      sourceId,
      userId,
      coins,
      usdEquiv,
    },
  });
}

/**
 * Calculate platform share from a spend amount and write the revenue entry.
 * Convenience wrapper that calls platformShare() then writePlatformRevenue().
 *
 * @param {object} tx
 * @param {object} opts
 * @param {'GIFT'|'TIP'|'SUBSCRIPTION'|'COIN_PURCHASE'} opts.sourceType
 * @param {string} opts.sourceId
 * @param {string} opts.userId
 * @param {number} opts.spendCoins  — total coins spent by user (platform takes 50%)
 * @returns {Promise<object|null>}
 */
async function writePlatformRevenueFromSpend(tx, { sourceType, sourceId, userId, spendCoins }) {
  const share = platformShare(spendCoins);
  return writePlatformRevenue(tx, { sourceType, sourceId, userId, coins: share });
}

module.exports = { writePlatformRevenue, writePlatformRevenueFromSpend };
