-- Migration: 20261007_add_wallet_tx_type_check
-- F-07 (Phase 24I): Add DB-level CHECK constraint to wallet_transactions.type
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   The wallet_transactions.type column is VARCHAR(191) with no DB-level
--   validation. Application code writes a known set of type values, but a
--   typo or an unguarded write path could insert an undocumented type string,
--   creating orphan ledger records that no reader recognises.
--
--   This migration adds a CHECK constraint listing every valid type value,
--   so the DB rejects any undocumented type at insert/update time.
--
-- Valid type values (12 total — original 10 + 2 added by F-05 in Phase 24I):
--   STRIPE_PURCHASE        — Stripe checkout completed; coins credited
--   GIFT_SEND              — Gift sent; coins debited from sender
--   GIFT_RECEIVE           — Gift received; diamonds credited to receiver
--   TIP_SEND               — Creator tip sent; coins debited from sender
--   TIP_RECEIVE            — Creator tip received; diamonds credited to creator (F-05)
--   SUBSCRIPTION           — Creator subscription charged; coins debited
--   SUBSCRIPTION_RECEIVE   — Subscription income; diamonds credited to creator (F-05)
--   ADMIN_GRANT            — Admin coin grant; coins credited
--   REFUND                 — Coin refund; coins debited (admin reversal)
--   PAYOUT                 — Diamond reservation on payout request; diamonds debited
--   PAYOUT_REVERSAL         — Diamond restoration on payout reject/cancel; diamonds credited
--   DISPUTED               — Stripe chargeback flag; no coin/diamond movement
--
-- Safety:
--   - CHECK constraints are additive — they do not modify existing rows.
--   - All existing rows already use one of these type values (verified by
--     source-level type inventory in the Phase 24I audit).
--   - If any existing row has an undocumented type, this migration will FAIL
--     and must be preceded by a data-fix query to correct the orphan rows.
--
-- Pre-flight check (run before migration in production):
--   SELECT type, COUNT(*) FROM wallet_transactions
--   WHERE type NOT IN (
--     'STRIPE_PURCHASE','GIFT_SEND','GIFT_RECEIVE','TIP_SEND','TIP_RECEIVE',
--     'SUBSCRIPTION','SUBSCRIPTION_RECEIVE','ADMIN_GRANT','REFUND',
--     'PAYOUT','PAYOUT_REVERSAL','DISPUTED'
--   ) GROUP BY type;
--   Expected: 0 rows. If rows exist, fix them before applying this migration.
--
-- Rollback: ALTER TABLE wallet_transactions DROP CHECK chk_wallet_tx_type;
--   (MySQL 8+ / MariaDB 10.4+ support DROP CHECK)

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
