-- Task 3: Session-scoped kick protection
-- Adds wasKicked column to live_class_participants.
-- When a host kicks a participant, wasKicked is set to TRUE.
-- joinLiveClass checks this and returns 403 to prevent immediate rejoin.
-- Default FALSE — fully backward compatible with all existing participant records.

ALTER TABLE `live_class_participants`
  ADD COLUMN `wasKicked` BOOLEAN NOT NULL DEFAULT FALSE;
