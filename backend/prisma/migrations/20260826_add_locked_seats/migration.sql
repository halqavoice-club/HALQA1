-- Migration: 20260826_add_locked_seats
-- Adds lockedSeats JSON column to voice_rooms.
-- Stores an array of seat indices (0-based) that the host has individually locked.
-- Example: [0, 2] means seat 0 and seat 2 are locked (cannot be occupied).
-- NULL means no seats are individually locked.

ALTER TABLE `voice_rooms`
  ADD COLUMN `lockedSeats` JSON NULL
    COMMENT 'Array of 0-based seat indices locked by host e.g. [0,2,4]';
