-- ARCH-GAP-C1: Add mutedByRoom column to voice_participants
-- Distinguishes room-wide mute (muteAll) from individual self-mute (toggleMute).
-- This allows unmuteAll() to target only room-muted participants,
-- preserving voluntary self-mute state.
ALTER TABLE `voice_participants`
  ADD COLUMN `mutedByRoom` BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'TRUE when participant was muted by host/moderator via muteAll(). FALSE for self-mute or moderator-muted.';

-- Backfill: existing isMuted=true, mutedByModerator=false rows are ambiguous.
-- Conservative: treat all as NOT room-muted (mutedByRoom=false).
-- This is the safe default -- it means unmuteAll() won't restore ambiguous rows
-- until they go through a new muteAll() cycle that sets mutedByRoom=true.
-- No data loss: isMuted state is preserved exactly.
