-- Migration: 20260825_add_muted_by_moderator
-- P1-2 FIX: Adds mutedByModerator flag to voice_participants.
-- When true, only HOST/MODERATOR can clear the mute — the participant
-- cannot self-unmute. Prevents muted users from bypassing moderator mute
-- via a direct REST call.

ALTER TABLE `voice_participants`
  ADD COLUMN `mutedByModerator` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'When 1, participant was muted by a moderator and cannot self-unmute';

CREATE INDEX `voice_participants_mutedByModerator_idx`
  ON `voice_participants` (`roomId`, `mutedByModerator`);
