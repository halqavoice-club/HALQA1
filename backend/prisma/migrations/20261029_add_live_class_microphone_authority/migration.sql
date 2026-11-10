-- SEC01-G-BE02-A: Add microphone authority tracking to live_classes
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration policy:
--   1. Add microphone_authorization_mode column with LEGACY default (backfills all
--      existing classes as LEGACY so no existing sessions are disrupted).
--   2. Create live_class_microphone_requests idempotency table.
--   3. Add microphone_intent to live_class_participants (authorization evidence).
--   4. After all existing rows are LEGACY, change the insert default to
--      SFU_AUTHORITATIVE so new classes are created in protected mode.
--   5. Add database triggers to enforce protected-mode invariants:
--        a. Prevent downgrade from SFU_AUTHORITATIVE back to LEGACY.
--        b. Prevent live conversion: a LIVE class cannot switch modes.
--        c. Prevent restart bypass: a non-SCHEDULED class cannot change mode.
--
-- Constraints:
--   - No UPDATE to live_class_participants (historical mute state preserved).
--   - No schema modifications to the participant mute column (append-only).
--   - No DELIMITER keyword (Prisma migrations do not support DELIMITER syntax).

-- ── Step 1: Add mode column to live_classes ───────────────────────────────────

ALTER TABLE `live_classes`
  ADD COLUMN `microphone_authorization_mode`
    ENUM('LEGACY', 'SFU_AUTHORITATIVE') NOT NULL DEFAULT 'LEGACY';

-- All existing rows are now backfilled as LEGACY (the column default handles it).

-- ── Step 2: Idempotency table for microphone authorization requests ────────────

CREATE TABLE IF NOT EXISTS `live_class_microphone_requests` (
  `id`              CHAR(36)     NOT NULL,
  `liveClassId`     CHAR(36)     NOT NULL,
  `actorUserId`     CHAR(36)     NOT NULL,
  `idempotencyKey`  VARCHAR(128) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `enabled`         TINYINT(1)   NOT NULL DEFAULT 0,
  `expectedVersion` BIGINT       NOT NULL DEFAULT 0,
  `processedAt`     DATETIME(3)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `live_class_mic_req_idempotency` (`liveClassId`, `actorUserId`, `idempotencyKey`),
  CONSTRAINT `fk_lcmr_live_class` FOREIGN KEY (`liveClassId`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lcmr_actor` FOREIGN KEY (`actorUserId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: The @@unique([liveClassId, actorUserId, idempotencyKey] constraint above
-- satisfies the Prisma schema unique index required for idempotency enforcement.

-- ── Step 3: Add participant-level authorization evidence ──────────────────────

ALTER TABLE `live_class_participants`
  ADD COLUMN `microphone_intent` ENUM('UNKNOWN', 'OFF', 'ON') NOT NULL DEFAULT 'UNKNOWN';

-- All existing participant rows are marked UNKNOWN (authorization evidence unavailable).
-- historical isMuted values are PRESERVED — no UPDATE to live_class_participants.

-- ── Step 4: Change live_classes insert default to protected mode ──────────────
-- This runs AFTER the backfill so no existing LEGACY rows are disrupted.

ALTER TABLE `live_classes`
  ALTER COLUMN `microphone_authorization_mode` SET DEFAULT 'SFU_AUTHORITATIVE';

-- ── Step 5: Triggers to enforce protected-mode invariants ─────────────────────
-- Prevents:
--   a. Downgrade: SFU_AUTHORITATIVE → LEGACY (irreversible protection)
--   b. Live conversion: mode change on a LIVE class
--   c. Restart bypass: mode change on a non-SCHEDULED, non-new class

CREATE TRIGGER `trg_live_classes_microphone_mode_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  -- (a) Prevent protected-mode downgrade
  IF OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot downgrade microphone_authorization_mode from SFU_AUTHORITATIVE to LEGACY';
  END IF;

  -- (b) Prevent live legacy conversion: a LIVE class cannot change mode
  IF OLD.`status` = 'LIVE'
     AND NEW.`microphone_authorization_mode` <> OLD.`microphone_authorization_mode`
     AND NEW.`microphone_authorization_mode` <> 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot change microphone_authorization_mode on a LIVE class';
  END IF;

  -- (c) Prevent restart bypass: only SCHEDULED classes may transition to protected mode
  IF OLD.`status` <> 'SCHEDULED'
     AND NEW.`microphone_authorization_mode` <> OLD.`microphone_authorization_mode` THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'microphone_authorization_mode may only be changed on SCHEDULED classes';
  END IF;
END;
