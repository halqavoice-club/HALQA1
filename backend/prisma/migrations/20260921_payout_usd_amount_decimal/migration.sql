-- Migration M-B: Change payout_requests.usdAmount from FLOAT to DECIMAL(10,2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   Eliminate floating-point drift in USD payout amounts.
--   1 diamond = $0.005, minimum payout 2000 diamonds = $10.00 exactly.
--   FLOAT cannot represent $10.00 exactly; DECIMAL(10,2) can.
--
-- Note: Column is named usdAmount (camelCase) as created by Prisma ORM.
--
-- Safety:
--   - MODIFY COLUMN preserves all existing values
--   - DECIMAL cast rounds to 2dp — values like 10.0 become 10.00 (no data loss)
--
-- Rollback: ALTER TABLE payout_requests MODIFY COLUMN `usdAmount` FLOAT NOT NULL;

ALTER TABLE `payout_requests`
  MODIFY COLUMN `usdAmount` DECIMAL(10, 2) NOT NULL
    COMMENT 'USD value stored as exact decimal (2dp). Replaces FLOAT to eliminate floating-point drift.';

