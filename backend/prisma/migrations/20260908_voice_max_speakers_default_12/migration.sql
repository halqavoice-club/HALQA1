-- Migration: Update VoiceRoom.maxSpeakers default from 10 to 12
-- This only changes the column DEFAULT for new rooms.
-- Existing rooms keep their current maxSpeakers value unchanged.

ALTER TABLE `voice_rooms`
  MODIFY COLUMN `maxSpeakers` INT NOT NULL DEFAULT 12;
