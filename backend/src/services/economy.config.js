'use strict';
/**
 * Economy Configuration — Single Source of Truth
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL economy constants and conversion functions must be imported from here.
 * No controller, service, or worker may declare its own local copy of these
 * values.  Changes to platform economics are made in ONE place: this file.
 *
 * Constants:
 *   PLATFORM_SHARE_PERCENT  — % of monetised value retained by the platform
 *   CREATOR_SHARE_PERCENT   — % of monetised value credited to the creator
 *   DIAMOND_TO_USD          — USD value of one diamond (used for payout)
 *   PAYOUT_MIN_DIAMONDS     — minimum diamonds required to request a payout
 *
 * Invariant (validated at module load):
 *   PLATFORM_SHARE_PERCENT + CREATOR_SHARE_PERCENT === 100
 *
 * Conversion functions:
 *   toDiamonds(coins)    — coins a creator earns as diamonds after platform cut
 *   platformShare(coins) — coins the platform retains
 *   toUsd(diamonds)      — USD value of a diamond balance (for payout display)
 *
 * Security:
 *   These values are fixed platform policy.  They MUST NOT be read from
 *   environment variables at runtime — doing so would allow an attacker who
 *   can influence env vars to alter the platform's revenue split.
 */

// ─── Platform Economy Constants ───────────────────────────────────────────────

/** Percentage of each monetised event retained by the platform (50 = 50%) */
const PLATFORM_SHARE_PERCENT = 50;

/** Percentage of each monetised event credited to the creator (50 = 50%) */
const CREATOR_SHARE_PERCENT = 50;

/** USD value of one diamond. 1000 diamonds = $5.00 */
const DIAMOND_TO_USD = 0.005;

/** Minimum diamond balance required to submit a payout request (2000 = $10) */
const PAYOUT_MIN_DIAMONDS = 2000;

// ─── Startup Validation ───────────────────────────────────────────────────────
// Runs immediately when this module is loaded.
// If any required constant is missing or NaN the application must not start —
// a misconfigured economy would silently corrupt financial data.

const _REQUIRED = {
  PLATFORM_SHARE_PERCENT,
  CREATOR_SHARE_PERCENT,
  DIAMOND_TO_USD,
  PAYOUT_MIN_DIAMONDS,
};

for (const [name, value] of Object.entries(_REQUIRED)) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    throw new Error(
      `[economy.config] Required constant "${name}" is ${value}. ` +
      'Fix economy.config.js before starting the server.'
    );
  }
}

// Invariant: platform + creator shares must sum to exactly 100
if (PLATFORM_SHARE_PERCENT + CREATOR_SHARE_PERCENT !== 100) {
  throw new Error(
    `[economy.config] PLATFORM_SHARE_PERCENT (${PLATFORM_SHARE_PERCENT}) + ` +
    `CREATOR_SHARE_PERCENT (${CREATOR_SHARE_PERCENT}) must equal 100.`
  );
}

// ─── Conversion Functions ─────────────────────────────────────────────────────

/**
 * Calculate how many diamonds a creator earns when `coins` are spent on them.
 *
 * Uses integer floor so that:
 *   - the result is always a safe integer (no fractional diamonds)
 *   - toDiamonds(c) + platformShare(c) ≤ c  (platform never over-distributes)
 *
 * Examples:
 *   toDiamonds(100)  → 50   (50% creator share of 100 coins)
 *   toDiamonds(1)    → 0    (floor of 0.5 = 0; platform keeps the remainder)
 *   toDiamonds(0)    → 0
 *
 * @param {number} coins — non-negative integer coins spent
 * @returns {number} non-negative integer diamonds credited to the creator
 */
function toDiamonds(coins) {
  if (!Number.isFinite(coins) || coins < 0) {
    throw new TypeError(`[economy.config] toDiamonds requires a non-negative finite number, got ${coins}`);
  }
  return Math.floor(coins * CREATOR_SHARE_PERCENT / 100);
}

/**
 * Calculate how many coins the platform retains when `coins` are spent.
 *
 * Note: platformShare(c) + toDiamonds(c) may be < c for odd values due to
 * integer floor rounding.  The 1-coin remainder stays in the sender's
 * transaction debit but is not credited anywhere — this is intentional and
 * prevents over-distribution.
 *
 * Examples:
 *   platformShare(100) → 50
 *   platformShare(1)   → 0   (floor of 0.5 = 0)
 *
 * @param {number} coins — non-negative integer coins spent
 * @returns {number} non-negative integer coins retained by the platform
 */
function platformShare(coins) {
  if (!Number.isFinite(coins) || coins < 0) {
    throw new TypeError(`[economy.config] platformShare requires a non-negative finite number, got ${coins}`);
  }
  return Math.floor(coins * PLATFORM_SHARE_PERCENT / 100);
}

/**
 * Convert a diamond balance to its USD equivalent for display and payout.
 *
 * Returns a number rounded to exactly 2 decimal places.
 * NEVER pass this value to floating-point arithmetic without re-rounding —
 * store payout USD amounts as Decimal(10,2) in the database.
 *
 * Examples:
 *   toUsd(2000)  → 10.00
 *   toUsd(5000)  → 25.00
 *   toUsd(1)     → 0.01  (1 diamond = $0.005 rounds to $0.01 at 2dp)
 *   toUsd(0)     → 0.00
 *
 * @param {number} diamonds — non-negative integer diamond balance
 * @returns {number} USD value rounded to 2 decimal places
 */
function toUsd(diamonds) {
  if (!Number.isFinite(diamonds) || diamonds < 0) {
    throw new TypeError(`[economy.config] toUsd requires a non-negative finite number, got ${diamonds}`);
  }
  return parseFloat((diamonds * DIAMOND_TO_USD).toFixed(2));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  PLATFORM_SHARE_PERCENT,
  CREATOR_SHARE_PERCENT,
  DIAMOND_TO_USD,
  PAYOUT_MIN_DIAMONDS,

  // Conversion functions
  toDiamonds,
  platformShare,
  toUsd,
};
