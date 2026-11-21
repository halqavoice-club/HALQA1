-- Migration: 20261115_harden_microphone_trigger_idempotency
--
-- Adds DROP TRIGGER IF EXISTS guards before each trigger CREATE so that the
-- trigger creation step is fully idempotent. Historical migration 20261030 is
-- not modified; this migration is forward-only.
--
-- Authorization invariants are preserved identically:
--   - SFU_AUTHORITATIVE → LEGACY downgrade is blocked.
--   - LIVE LEGACY → SFU_AUTHORITATIVE upgrade is blocked.
--   - Non-SCHEDULED, non-ENDED, non-LIVE mode changes are blocked.
--   - SCHEDULED LEGACY → LIVE status transition is blocked.

-- ─── Trigger 1: mode-change guard ────────────────────────────────────────────
DROP TRIGGER IF EXISTS `live_classes_microphone_mode_guard`;

CREATE TRIGGER `live_classes_microphone_mode_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  IF OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot downgrade from SFU_AUTHORITATIVE to LEGACY';
  END IF;

  IF OLD.`status` = 'LIVE'
     AND OLD.`microphone_authorization_mode` = 'LEGACY'
     AND NEW.`microphone_authorization_mode` <> 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot upgrade active LIVE session microphone_authorization_mode';
  END IF;

  IF OLD.`status` NOT IN ('SCHEDULED', 'LIVE', 'ENDED')
     AND OLD.`microphone_authorization_mode` <> NEW.`microphone_authorization_mode` THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'microphone_authorization_mode can only be changed in SCHEDULED or ENDED status';
  END IF;
END;

-- ─── Trigger 2: start guard ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS `live_classes_legacy_start_guard`;

CREATE TRIGGER `live_classes_legacy_start_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  IF NEW.`status` = 'LIVE'
     AND OLD.`status` <> 'LIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first';
  END IF;
END;
