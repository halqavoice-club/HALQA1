-- Persistent Voice Rooms Migration
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds IDLE status so rooms survive when all participants leave.
-- Lifecycle: SCHEDULED → IDLE → LIVE → IDLE (rooms never auto-end)
-- Only an explicit endRoom() call transitions a room to ENDED.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add IDLE to the status enum
ALTER TABLE `voice_rooms`
  MODIFY COLUMN `status`
    ENUM('LIVE', 'IDLE', 'ENDED', 'SCHEDULED')
    NOT NULL DEFAULT 'IDLE';

-- 2. Rooms that were LIVE with 0 active participants should be IDLE
--    (safety backfill — handles any rooms left in inconsistent state)
UPDATE `voice_rooms` vr
SET vr.`status` = 'IDLE', vr.`updatedAt` = NOW()
WHERE vr.`status` = 'LIVE'
  AND vr.`deletedAt` IS NULL
  AND (
    SELECT COUNT(*) FROM `voice_participants` vp
    WHERE vp.`roomId` = vr.`id` AND vp.`isActive` = TRUE
  ) = 0;

-- 3. Add lastActivityAt — tracks when the room last had a participant
--    Used for sorting "recently active" rooms in the lobby
ALTER TABLE `voice_rooms`
  ADD COLUMN `lastActivityAt` DATETIME(3) NULL;

-- Backfill lastActivityAt from the most recent participant join
UPDATE `voice_rooms` vr
SET vr.`lastActivityAt` = (
  SELECT MAX(vp.`joinedAt`)
  FROM `voice_participants` vp
  WHERE vp.`roomId` = vr.`id`
)
WHERE vr.`deletedAt` IS NULL;
