-- Migration M-C: Add stripe_session_id with UNIQUE constraint to fee_records
-- ─────────────────────────────────────────────────────────────────────────────
-- Purpose:
--   Adds DB-level idempotency guard to fee payments processed via Stripe.
--   The existing coin-purchase webhook has a @unique stripeSessionId on
--   wallet_transactions; this mirrors the same pattern for fee payments.
--
--   When a fee_payment Stripe webhook fires:
--     1. stripe.controller.js checks for existing record with this stripeSessionId
--     2. If found (status=PAID): returns 200 immediately (idempotent)
--     3. If not found: updates fee record AND sets stripeSessionId
--     4. If concurrent duplicate fires: P2002 unique constraint rejects it
--
-- Safety:
--   - Column is nullable: existing rows get NULL, which does NOT trigger the
--     unique constraint (NULL != NULL in MySQL unique indexes — safe)
--   - Non-breaking: no existing data is modified
--
-- Rollback:
--   ALTER TABLE fee_records DROP INDEX uq_fee_stripe_session;
--   ALTER TABLE fee_records DROP COLUMN stripe_session_id;

ALTER TABLE `fee_records`
  ADD COLUMN `stripe_session_id` VARCHAR(255) NULL
    COMMENT 'Stripe Checkout session ID set when fee is paid via Stripe. Used as DB-level idempotency guard against duplicate webhooks.',
  ADD UNIQUE INDEX `uq_fee_stripe_session` (`stripe_session_id`);
