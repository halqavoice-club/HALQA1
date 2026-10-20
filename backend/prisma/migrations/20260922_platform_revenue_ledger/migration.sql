-- Migration: Platform Revenue Ledger
-- Creates the platform_revenue_entries table to explicitly track the platform's
-- 50% share of every monetised event (gift, tip, subscription, coin purchase).
--
-- Previously the platform's cut was implicit — coins were deducted from senders
-- but only 50% was credited to creators; the other 50% was never recorded.
-- This table makes platform revenue auditable and queryable in real time.
--
-- Columns:
--   source_type  — type of event: GIFT | TIP | SUBSCRIPTION | COIN_PURCHASE
--   source_id    — FK to the originating record (GiftTransaction, CreatorTip, etc.)
--   user_id      — the user whose action generated the revenue
--   coins        — platform share in coins (positive integer)
--   usd_equiv    — USD equivalent at time of event (DECIMAL 10,2)
--   created_at   — timestamp of the event

CREATE TABLE IF NOT EXISTS platform_revenue_entries (
  id           VARCHAR(36)    NOT NULL PRIMARY KEY,
  source_type  VARCHAR(50)    NOT NULL COMMENT 'GIFT | TIP | SUBSCRIPTION | COIN_PURCHASE',
  source_id    VARCHAR(36)    NOT NULL COMMENT 'ID of the originating transaction record',
  user_id      VARCHAR(36)    NOT NULL COMMENT 'User whose action generated the revenue',
  coins        INT            NOT NULL COMMENT 'Platform share in coins (floor of 50% of spend)',
  usd_equiv    DECIMAL(10,2)  NOT NULL DEFAULT 0.00 COMMENT 'USD equivalent (coins / 100)',
  created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX idx_pre_source_type  (source_type),
  INDEX idx_pre_user_id      (user_id),
  INDEX idx_pre_created_at   (created_at),
  INDEX idx_pre_source       (source_type, source_id),
  -- For revenue reporting by date range
  INDEX idx_pre_type_date    (source_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Platform revenue ledger — explicit 50% share per monetised event';
