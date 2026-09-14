-- Migration: replace seat1Claimed with authoritative seatNumber
-- seatNumber is the single source of truth for a participant's stage seat.
-- Valid values: 1–12 (on stage), NULL (in audience/queue).
-- The unique constraint on (roomId, seatNumber) prevents duplicate seat assignments.

-- Remove the seat1Claimed column added in the previous migration
ALTER TABLE `voice_participants`
  DROP COLUMN IF EXISTS `seat1Claimed`;

-- Add the authoritative seatNumber column
ALTER TABLE `voice_participants`
  ADD COLUMN `seatNumber` INT NULL DEFAULT NULL;

-- Unique constraint: no two active participants in the same room can share a seat.
-- Note: MySQL unique constraints on nullable columns allow multiple NULLs,
-- so audience participants (seatNumber=NULL) are not constrained against each other.
ALTER TABLE `voice_participants`
  ADD UNIQUE KEY `voice_participants_roomId_seatNumber_key` (`roomId`, `seatNumber`);
