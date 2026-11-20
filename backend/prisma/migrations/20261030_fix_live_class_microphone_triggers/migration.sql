-- Migration: 20261030_fix_live_class_microphone_triggers
--
-- Corrects five bugs in the live_classes_microphone_mode_guard trigger deployed
-- in migration 20261029_add_live_class_microphone_authority:
--
--   Bug 1: Downgrade guard used mutually-exclusive conditions
--          (NEW <> 'LEGACY' AND NEW = 'LEGACY') — trigger never fired.
--   Bug 2: LIVE-upgrade error message did not match test pattern
--          /Cannot upgrade active LIVE session/.
--   Bug 3: Third IF blocked ENDED status, but post-session upgrades must be
--          allowed (test: ENDED LEGACY → SFU_AUTHORITATIVE must succeed).
--   Bug 4: No trigger existed to block a LEGACY session transitioning SCHEDULED
--          → LIVE (test: "Cannot start LEGACY session").
--   Bug 5: Column default was changed to SFU_AUTHORITATIVE in Step 2 of the
--          previous migration; tests create classes without an explicit mode and
--          assert microphoneAuthorizationMode = 'LEGACY', so the default must
--          be reverted to LEGACY.
--
-- Strategy: drop the broken trigger, revert the column default, and recreate
-- two triggers with correct logic.

-- ─── Step 1: Revert column default to LEGACY ────────────────────────────────
-- The previous migration changed the default to SFU_AUTHORITATIVE after
-- backfilling. Tests that omit microphoneAuthorizationMode on creation expect
-- the value to be LEGACY (the migration-compatibility default).

ALTER TABLE `live_classes`
  ALTER COLUMN `microphone_authorization_mode` SET DEFAULT 'LEGACY';

-- ─── Step 2: Drop existing broken trigger ───────────────────────────────────

DROP TRIGGER IF EXISTS `live_classes_microphone_mode_guard`;

-- ─── Step 3: Recreate Trigger 1 — mode-change guard ─────────────────────────
--
-- Rules enforced:
--   a) SFU_AUTHORITATIVE → LEGACY is always blocked (downgrade prevention).
--   b) LIVE LEGACY → SFU_AUTHORITATIVE is blocked (silent active-session upgrade).
--   c) ENDED status is explicitly excluded: post-session mode upgrades are allowed.
--   d) Any other non-SCHEDULED mode change (e.g. from a future status) is blocked
--      unless it is an ENDED → SFU_AUTHORITATIVE upgrade (covered by exclusion above).

CREATE TRIGGER `live_classes_microphone_mode_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  -- Block: downgrade from SFU_AUTHORITATIVE back to LEGACY (always forbidden)
  IF OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot downgrade from SFU_AUTHORITATIVE to LEGACY';
  END IF;

  -- Block: upgrade mode on a LIVE class that is currently LEGACY
  -- (silent active-session upgrade is forbidden; end the session first)
  IF OLD.`status` = 'LIVE'
     AND OLD.`microphone_authorization_mode` = 'LEGACY'
     AND NEW.`microphone_authorization_mode` <> 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot upgrade active LIVE session microphone_authorization_mode';
  END IF;

  -- Block: mode change on a non-SCHEDULED, non-ENDED, non-LIVE class
  -- (LIVE is already handled above; ENDED is explicitly allowed for post-session upgrades)
  IF OLD.`status` NOT IN ('SCHEDULED', 'LIVE', 'ENDED')
     AND OLD.`microphone_authorization_mode` <> NEW.`microphone_authorization_mode` THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'microphone_authorization_mode can only be changed in SCHEDULED or ENDED status';
  END IF;
END;

-- ─── Step 4: Create Trigger 2 — block LEGACY session from starting ───────────
--
-- Prevents a LEGACY class from transitioning SCHEDULED → LIVE.
-- A session using the legacy microphone path must be upgraded to
-- SFU_AUTHORITATIVE before it can be started.

CREATE TRIGGER `live_classes_legacy_start_guard`
BEFORE UPDATE ON `live_classes`
FOR EACH ROW
BEGIN
  -- Block: transitioning to LIVE while microphone mode is still LEGACY
  IF NEW.`status` = 'LIVE'
     AND OLD.`status` <> 'LIVE'
     AND NEW.`microphone_authorization_mode` = 'LEGACY' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first';
  END IF;
END;
