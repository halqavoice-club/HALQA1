-- G7: Add composite index on (roomId, isActive, seatNumber) for the hot
-- seat-count query used in grabMic and promoteParticipant:
--   COUNT(*) WHERE roomId=X AND isActive=1 AND seatNumber IS NOT NULL
-- Without this index the query does a partial scan of [roomId, isActive, role]
-- followed by a filter on seatNumber, which is suboptimal for a hot path that
-- runs inside a transaction on every seat-claim.

CREATE INDEX `voice_participants_roomId_isActive_seatNumber_idx`
  ON `voice_participants` (`roomId`, `isActive`, `seatNumber`);
