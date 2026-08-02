-- AddColumn: screenShareEnabled to live_classes
-- Default TRUE — existing classes allow screen sharing by all participants
ALTER TABLE `live_classes` ADD COLUMN `screenShareEnabled` BOOLEAN NOT NULL DEFAULT true;
