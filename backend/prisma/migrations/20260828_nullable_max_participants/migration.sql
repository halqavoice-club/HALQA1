-- Migration: 20260828_nullable_max_participants
--
-- Makes maxParticipants nullable in live_classes.
-- Previously NOT NULL DEFAULT 100 ΓÇö this forced a viewer cap even for PUBLIC
-- streams where unlimited viewers should be allowed (TikTok Live behaviour).
--
-- NULL means no limit. A positive integer means the stream has a cap.
-- All existing rows retain their current value (100 or whatever was set).

ALTER TABLE `live_classes`
  MODIFY COLUMN `maxParticipants` INT NULL;
