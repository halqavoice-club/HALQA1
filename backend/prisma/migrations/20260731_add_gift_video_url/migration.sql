-- Add videoUrl column to gifts table for video-based gift animations (WebM/MP4)
-- animationType 'video' uses this URL for TikTok-style fullscreen animations

ALTER TABLE `gifts`
  ADD COLUMN `videoUrl` VARCHAR(512) NULL
  COMMENT 'Optional video animation file path or URL (webm/mp4)';

-- Update animationType to include 'video' as a valid type (no constraint needed since it is a string)
-- Gifts with videoUrl set automatically use video animation when played

-- Sample: update Golden Trophy and Wisdom Crown to use video animation type
-- (actual video files must be placed in frontend/public/gifts/ directory)
UPDATE `gifts` SET `animationType` = 'video' WHERE `name` IN ('Golden Trophy', 'Wisdom Crown', 'Scholarship', 'Diamond Book') AND `videoUrl` IS NULL;
