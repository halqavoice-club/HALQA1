-- Add isOpenMic flag to voice_rooms
-- When true, any audience member can grab the mic directly without host approval

ALTER TABLE `voice_rooms`
  ADD COLUMN `isOpenMic` BOOLEAN NOT NULL DEFAULT FALSE;
