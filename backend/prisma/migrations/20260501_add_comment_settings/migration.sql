-- Add comment/chat settings to voice_rooms
ALTER TABLE `voice_rooms`
  ADD COLUMN `commentsEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `slowMode`        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `messageType`     VARCHAR(20) NOT NULL DEFAULT 'all';
