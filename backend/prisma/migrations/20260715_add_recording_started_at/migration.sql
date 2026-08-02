-- Add recordingStartedAt to track active recording sessions
ALTER TABLE `live_classes`
  ADD COLUMN `recordingStartedAt` DATETIME(3) NULL AFTER `recordingUrl`;
