-- Migration: 20261029_add_live_class_microphone_authority
-- Adds microphone authorization mode tracking to live classes and participants.
--
-- Safety strategy:
--   1. Add microphone_authorization_mode as NOT NULL DEFAULT 'LEGACY' to backfill
--      all existing rows with LEGACY before changing the insert default.
--   2. After backfill, ALTER COLUMN to change the default to 'SFU_AUTHORITATIVE'
--      so all new classes created after cutover are protected by default.
--   3. Add microphone_intent, microphone_moderator_revoked, etc. to participants.
--   4. Create the live_class_microphone_operations table.
--   5. Add a BEFORE UPDATE trigger that prevents:
--        - Downgrade from SFU_AUTHORITATIVE back to LEGACY
--        - Live legacy conversion (status=LIVE cannot change mode)
--        - Restart bypasses (non-SCHEDULED status changes restricted)

-- ─── Step 1: Add microphone_authorization_mode to live_classes (backfill-safe) ──

ALTER TABLE `live_classes`
  ADD COLUMN `microphone_authorization_mode` ENUM('LEGACY', 'SFU_AUTHORITATIVE') NOT NULL DEFAULT 'LEGACY' AFTER `updatedAt`,
  ADD COLUMN `microphone_mode_established_at` DATETIME(3) NULL AFTER `microphone_authorization_mode`;

-- ─── Step 2: Backfill complete — change default to SFU_AUTHORITATIVE ────────────

ALTER TABLE `live_classes`
  ALTER COLUMN `microphone_authorization_mode` SET DEFAULT 'SFU_AUTHORITATIVE';

-- ─── Step 3: Add microphone fields to live_class_participants ────────────────────
-- NOTE: Does NOT modify or touch isMuted — historical mute state is preserved.

ALTER TABLE `live_class_participants`
  ADD COLUMN `microphone_intent` ENUM('UNKNOWN', 'OFF', 'ON') NOT NULL DEFAULT 'UNKNOWN' AFTER `updatedAt`,
  ADD COLUMN `microphone_moderator_revoked` TINYINT(1) NOT NULL DEFAULT 0 AFTER `microphone_intent`,
  ADD COLUMN `microphone_authorization_version` BIGINT NOT NULL DEFAULT 0 AFTER `microphone_moderator_revoked`,
  ADD COLUMN `microphone_sfu_version` BIGINT NOT NULL DEFAULT 0 AFTER `microphone_authorization_version`,
  ADD COLUMN `microphone_sfu_state` ENUM('UNKNOWN', 'MUTED', 'LIVE') NOT NULL DEFAULT 'UNKNOWN' AFTER `microphone_sfu_version`,
  ADD COLUMN `microphone_sfu_reason` VARCHAR(255) NULL AFTER `microphone_sfu_state`;

-- ─── Step 4: Create live_class_microphone_operations table ──────────────────────

CREATE TABLE `live_class_microphone_operations` (
  `id` VARCHAR(191) NOT NULL,
  `live_class_id` VARCHAR(191) NOT NULL,
  `participant_id` VARCHAR(191) NOT NULL,
  `actor_user_id` VARCHAR(191) NOT NULL,
  `target_user_id` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `requested_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `expected_version` BIGINT NOT NULL DEFAULT 0,
  `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `can_publish_audio` TINYINT(1) NOT NULL DEFAULT 0,
  `sfu_enforced` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `liveclass_mic_operation_idempotency` (`live_class_id`, `actor_user_id`, `idempotency_key`),
  INDEX `live_class_microphone_operations_live_class_id_idx` (`live_class_id`),
  INDEX `live_class_microphone_operations_participant_id_idx` (`participant_id`),
  INDEX `live_class_microphone_operations_actor_user_id_idx` (`actor_user_id`),

  CONSTRAINT `live_class_microphone_operations_live_class_id_fkey`
    FOREIGN KEY (`live_class_id`) REFERENCES `live_classes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `live_class_microphone_operations_participant_id_fkey`
    FOREIGN KEY (`participant_id`) REFERENCES `live_class_participants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Step 5: Add trigger to prevent protected mode downgrade ────────────────────
-- Uses compound BEGIN/END block without DELIMITER statements (compatible with
-- Prisma migrations and most MySQL clients that handle multi-statement SQL).

CREATE TRIGGER `live_classes_microphone_mode_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  -- Block: downgrade from SFU_AUTHORITATIVE back to LEGACY
  IF OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'
     AND NEW.`microphone_authorization_mode` <> 'LEGACY'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot downgrade microphone_authorization_mode from SFU_AUTHORITATIVE';
  END IF;

  -- Block: changing mode on a LIVE class with LEGACY mode (live legacy conversion)
  IF OLD.`status` = 'LIVE'
     AND OLD.`microphone_authorization_mode` = 'LEGACY'
     AND NEW.`microphone_authorization_mode` <> 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot change microphone_authorization_mode on a LIVE LEGACY class';
  END IF;

  -- Block: changing mode from non-SCHEDULED status (restart bypass prevention)
  IF OLD.`status` <> 'SCHEDULED'
     AND OLD.`microphone_authorization_mode` <> NEW.`microphone_authorization_mode` THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'microphone_authorization_mode can only be changed in SCHEDULED status';
  END IF;
END;
