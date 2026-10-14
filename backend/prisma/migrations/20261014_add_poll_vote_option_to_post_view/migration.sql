-- Migration: 20261014_add_poll_vote_option_to_post_view
-- FIND-009 FIX: Add votedOptionId column to post_views table.
-- The votePoll controller uses PostView as a combined view+vote record.
-- This column stores which poll option the user selected (NULL for regular views).
-- Nullable column — no data migration needed; existing rows default to NULL.

ALTER TABLE `post_views` ADD COLUMN `votedOptionId` VARCHAR(191) NULL;
