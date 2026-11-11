-- Add message type enum support to direct_messages
-- Rewritten to use ADD COLUMN (MariaDB 10.x compatible).
-- DELIMITER // syntax is not supported by Prisma's SQL runner — replaced.

-- Ensure msgType column exists (may already be added by 20260906_dm_media_fields)
ALTER TABLE `direct_messages`
  ADD COLUMN `msgType` VARCHAR(20) NOT NULL DEFAULT 'TEXT';
