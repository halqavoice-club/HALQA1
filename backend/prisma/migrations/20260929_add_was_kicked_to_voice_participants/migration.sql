-- PH24C-003: Session-scoped kick protection for Voice Club participants.
-- Adds wasKicked column to voice_participants.
-- When a host/moderator kicks a participant, wasKicked is set to TRUE atomically
-- alongside isActive=FALSE and seatNumber=NULL (PH24C-001 fix).
-- joinRoom() checks wasKicked in the same-room reconnect path and returns 403,
-- preventing the kicked user from immediately rejoining the same room.
-- Pattern: mirrors LiveClassParticipant.wasKicked (migration 20260816).
-- Default FALSE — fully backward compatible with all existing participant records.

ALTER TABLE `voice_participants`
  ADD COLUMN `wasKicked` BOOLEAN NOT NULL DEFAULT FALSE;
