-- Migration M-A: Add `diamonds` column to wallet_transactions
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   Enables PAYOUT and PAYOUT_REVERSAL transaction types to record diamond
--   movements on the WalletTransaction ledger.  Existing GIFT_SEND, TIP_SEND,
--   STRIPE_PURCHASE etc. records keep diamonds = 0 (the DEFAULT).
--
-- Safety:
--   - ADD COLUMN with DEFAULT 0 — non-breaking, zero downtime
--   - All existing rows are back-filled to 0 automatically by MySQL
--   - No data loss possible (only additive)
--
-- Rollback: ALTER TABLE wallet_transactions DROP COLUMN diamonds;

ALTER TABLE `wallet_transactions`
  ADD COLUMN `diamonds` INT NOT NULL DEFAULT 0
    COMMENT 'Diamond delta for this transaction. 0 for coin-only records. Negative for PAYOUT reservations, positive for PAYOUT_REVERSAL restorations.';
