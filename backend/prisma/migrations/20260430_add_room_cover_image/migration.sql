-- Add coverImageUrl to voice_rooms for room avatar/banner upload
ALTER TABLE `voice_rooms`
  ADD COLUMN `coverImageUrl` VARCHAR(500) NULL;
