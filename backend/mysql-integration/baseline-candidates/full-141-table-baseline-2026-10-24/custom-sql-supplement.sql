-- ═══════════════════════════════════════════════════════════════════════════
-- CUSTOM SQL SUPPLEMENT
-- ═══════════════════════════════════════════════════════════════════════════
-- Prisma does not support CHECK constraints. These are manually added
-- to match the production schema created by migrations:
--   - 20260821_add_wallet_balance_checks (4 constraints)
--   - 20260821_add_membership_role_check (1 constraint)
--   - 20261007_add_wallet_tx_type_check (1 constraint)
--
-- Total: 6 CHECK constraints
-- Affected tables: wallets, school_memberships, wallet_transactions
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Wallet Balance Safety (4 constraints) ──────────────────────────────────
-- Ensures all wallet balance fields remain non-negative.
-- Platform financial integrity depends on these constraints.

ALTER TABLE `wallets`
  ADD CONSTRAINT `chk_wallet_coins_positive`    CHECK (`coins`       >= 0),
  ADD CONSTRAINT `chk_wallet_diamonds_positive` CHECK (`diamonds`    >= 0),
  ADD CONSTRAINT `chk_wallet_total_spent`       CHECK (`totalSpent`  >= 0),
  ADD CONSTRAINT `chk_wallet_total_earned`      CHECK (`totalEarned` >= 0);

-- ─── School Membership Role Validation ──────────────────────────────────────
-- Restricts school-scoped roles to Education-only values.
-- SUPER_ADMIN is explicitly excluded — SUPER_ADMIN is a platform role,
-- not a school membership role. This enforces school isolation.

ALTER TABLE `school_memberships`
  ADD CONSTRAINT `chk_membership_role`
  CHECK (`role` IN ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE'));

-- ─── Wallet Transaction Type Validation ─────────────────────────────────────
-- Restricts wallet transaction types to valid enum values.
-- This prevents invalid transaction types from corrupting the wallet ledger.

ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `chk_wallet_tx_type`
  CHECK (`type` IN (
    'STRIPE_PURCHASE',
    'GIFT_SEND',
    'GIFT_RECEIVE',
    'TIP_SEND',
    'TIP_RECEIVE',
    'SUBSCRIPTION',
    'SUBSCRIPTION_RECEIVE',
    'ADMIN_GRANT',
    'REFUND',
    'PAYOUT',
    'PAYOUT_REVERSAL',
    'DISPUTED'
  ));
