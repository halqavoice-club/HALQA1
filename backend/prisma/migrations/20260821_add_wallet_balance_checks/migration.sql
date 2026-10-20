-- Migration: 20260821_add_wallet_balance_checks
-- Adds CHECK constraints to prevent negative wallet balances at the database
-- level. The application already validates this in transactions, but a direct
-- DB write or race condition could bypass application-layer checks.
--
-- coins       >= 0 : coins are spendable currency; can never be negative
-- diamonds    >= 0 : diamonds are earned by receiving gifts; can never be negative
-- totalSpent  >= 0 : lifetime counter; cannot decrease
-- totalEarned >= 0 : lifetime counter; cannot decrease
--
-- Impact: zero for existing data (all wallet balances should already be >= 0).
-- If any row has a negative balance (data corruption), this migration will fail
-- and must be preceded by a data-fix query.

ALTER TABLE `wallets`
  ADD CONSTRAINT `chk_wallet_coins_positive`    CHECK (`coins`       >= 0),
  ADD CONSTRAINT `chk_wallet_diamonds_positive` CHECK (`diamonds`    >= 0),
  ADD CONSTRAINT `chk_wallet_total_spent`       CHECK (`totalSpent`  >= 0),
  ADD CONSTRAINT `chk_wallet_total_earned`      CHECK (`totalEarned` >= 0);
