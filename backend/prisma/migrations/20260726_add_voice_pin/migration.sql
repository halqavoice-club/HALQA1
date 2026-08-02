-- Add isPinned field to VoiceParticipant
-- Allows HOST/MOD to pin a speaker to the front of the stage grid

ALTER TABLE `voice_participants` ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient pinned query per room
CREATE INDEX `voice_participants_roomId_isPinned_idx` ON `voice_participants`(`roomId`, `isPinned`);
