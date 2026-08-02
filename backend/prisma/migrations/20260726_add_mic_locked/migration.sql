-- Add micLocked field to voice_rooms
ALTER TABLE `voice_rooms` ADD COLUMN `micLocked` TINYINT(1) NOT NULL DEFAULT 0;
