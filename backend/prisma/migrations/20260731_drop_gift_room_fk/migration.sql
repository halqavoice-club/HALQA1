-- Drop the VoiceRoom FK constraints from gift tables so any room type can be used.
-- FK names confirmed via information_schema query.

ALTER TABLE `gift_transactions`
  DROP FOREIGN KEY `gift_transactions_roomId_fkey`;

ALTER TABLE `room_gift_leaderboard`
  DROP FOREIGN KEY `room_gift_leaderboard_roomId_fkey`;
