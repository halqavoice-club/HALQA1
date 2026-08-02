-- Add isOpenMic to live_classes (already included in table creation, this is a no-op)
-- When true, all students can publish audio/video freely without hand raise
ALTER TABLE `live_classes` MODIFY COLUMN `isOpenMic` TINYINT(1) NOT NULL DEFAULT 0;
