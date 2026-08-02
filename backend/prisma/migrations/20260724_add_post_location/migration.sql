-- Add location label field to posts table (Phase B-1 gap fix)
-- No GPS data stored — display label only (max 120 chars)
ALTER TABLE `posts`
  ADD COLUMN `location` VARCHAR(120) NULL AFTER `tierRequired`;
