-- Migration: 20260831_fix_public_stream_max_participants
--
-- BUG FIX: Existing PUBLIC live streams had maxParticipants = 100 because the
-- column defaulted to 100 at insert time (before the 20260828 migration made it
-- nullable). With the join logic now treating NULL as "unlimited", these rows
-- need to be corrected so public streams don't hit a phantom 100-viewer cap.
--
-- SCHOOL streams intentionally keep their explicit value (100 default or whatever
-- the host set). Only PUBLIC (stream_type = 'PUBLIC') rows are reset to NULL.

UPDATE `live_classes`
SET `maxParticipants` = NULL
WHERE `stream_type` = 'PUBLIC'
  AND `maxParticipants` = 100;
