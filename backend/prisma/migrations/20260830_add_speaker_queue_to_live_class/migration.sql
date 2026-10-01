-- MIC-02: Live Class Speaker Queue
-- Adds maxSpeakers cap to live_classes and speakerSlot to live_class_participants.
-- Existing rows: maxSpeakers defaults to 20, speakerSlot stays NULL (audience).

ALTER TABLE `live_classes`
  ADD COLUMN `maxSpeakers` INT NOT NULL DEFAULT 20;

ALTER TABLE `live_class_participants`
  ADD COLUMN `speakerSlot` INT NULL DEFAULT NULL;

-- Index for fast "how many active speakers are on stage?" query
CREATE INDEX `idx_lcp_speaker_slot` ON `live_class_participants` (`liveClassId`, `speakerSlot`);
