-- DEF-001: Add room-wide mute policy flag to VoiceRoom
-- Existing rooms default to allMuted=FALSE (no behaviour change).
-- New rooms also default to FALSE.
ALTER TABLE `voice_rooms` ADD COLUMN `allMuted` TINYINT(1) NOT NULL DEFAULT 0;
