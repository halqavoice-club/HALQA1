-- Migration M-B: Change payout_requests.usd_amount from FLOAT to DECIMAL(10,2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   Eliminate floating-point drift in USD payout amounts.
--   1 diamond = $0.005, minimum payout 2000 diamonds = $10.00 exactly.
--   FLOAT cannot represent $10.00 exactly; DECIMAL(10,2) can.
--
-- Pre-migration verification (run before applying):
--   SELECT id, usd_amount
--   FROM payout_requests
--   WHERE usd_amount != ROUND(usd_amount, 2);
--   -- If any rows found, investigate before proceeding.
--   -- Expected: 0 rows (all existing payout amounts are multiples of 0.005).
--
-- Safety:
--   - MODIFY COLUMN preserves all existing values
--   - DECIMAL cast rounds to 2dp — values like 10.0 become 10.00 (no data loss)
--   - Table is typically small (payout requests are rare), so ALTER is fast
--
-- Rollback: ALTER TABLE payout_requests MODIFY COLUMN usd_amount FLOAT NOT NULL;

ALTER TABLE `payout_requests`
  MODIFY COLUMN `usd_amount` DECIMAL(10, 2) NOT NULL
    COMMENT 'USD value stored as exact decimal (2dp). Replaces FLOAT to eliminate floating-point drift.';
