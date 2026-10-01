-- Migration: add seat1Claimed to voice_participants
-- MODERATOR must explicitly grab Seat 1 from audience.
-- seat1Claimed=true means this MOD actively grabbed Seat 1 (not auto-assigned by layout).
-- Cleared when MOD drops mic or leaves stage.

ALTER TABLE `voice_participants`
  ADD COLUMN `seat1Claimed` BOOLEAN NOT NULL DEFAULT false;
