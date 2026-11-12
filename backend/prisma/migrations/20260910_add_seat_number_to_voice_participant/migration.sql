-- Migration: replace seat1Claimed with authoritative seatNumber
-- seatNumber is the single source of truth for a participant's stage seat.
-- Valid values: 1–12 (on stage), NULL (in audience/queue).
-- The unique constraint on (roomId, seatNumber) prevents duplicate seat assignments.

-- Remove the seat1Claimed column if it exists (information_schema guard for MySQL 8.0 < 8.0.29)
SET @col_seat1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='voice_participants' AND COLUMN_NAME='seat1Claimed');
SET @sql_drop = IF(@col_seat1>0, 'ALTER TABLE `voice_participants` DROP COLUMN `seat1Claimed`', 'SELECT 1');
PREPARE stmt_drop FROM @sql_drop; EXECUTE stmt_drop; DEALLOCATE PREPARE stmt_drop;

-- Add the authoritative seatNumber column (guard against duplicate)
SET @col_seat = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='voice_participants' AND COLUMN_NAME='seatNumber');
SET @sql_seat = IF(@col_seat=0, 'ALTER TABLE `voice_participants` ADD COLUMN `seatNumber` INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt_seat FROM @sql_seat; EXECUTE stmt_seat; DEALLOCATE PREPARE stmt_seat;

-- Unique constraint: no two active participants in the same room can share a seat.
-- Guard against duplicate key name (error 1061)
SET @uk_seat = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='voice_participants' AND INDEX_NAME='voice_participants_roomId_seatNumber_key');
SET @sql_uk = IF(@uk_seat=0, 'ALTER TABLE `voice_participants` ADD UNIQUE KEY `voice_participants_roomId_seatNumber_key` (`roomId`, `seatNumber`)', 'SELECT 1');
PREPARE stmt_uk FROM @sql_uk; EXECUTE stmt_uk; DEALLOCATE PREPARE stmt_uk;
