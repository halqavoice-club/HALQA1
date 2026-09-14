-- Add message type enum support to direct_messages
-- Idempotent: only adds columns if they don't already exist

DROP PROCEDURE IF EXISTS `add_dm_type_cols`;
DELIMITER //
CREATE PROCEDURE `add_dm_type_cols`()
BEGIN
  -- Ensure msgType column exists (may already be added by 20260906_dm_media_fields)
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND COLUMN_NAME = 'msgType'
  ) THEN
    ALTER TABLE `direct_messages`
      ADD COLUMN `msgType` VARCHAR(20) NOT NULL DEFAULT 'TEXT';
  END IF;
END //
DELIMITER ;
CALL `add_dm_type_cols`();
DROP PROCEDURE IF EXISTS `add_dm_type_cols`;
