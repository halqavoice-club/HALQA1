-- Migration: 20260829_add_moderator_role_to_live_class_participants
--
-- Adds MODERATOR as a valid role in live_class_participants.
--
-- OWNERSHIP RULE: Only the live class creator manages their session.
-- The creator can promote any active participant to MODERATOR, granting
-- them the same management rights (mute, kick, approve hands, polls, etc.)
-- without giving them end/delete authority over the class itself.
--
-- Changes (additive / fully backward-compatible):
--   1. live_class_participants.role column: allow 'MODERATOR' value
--      MySQL ENUM — add new value without touching existing rows.
--
-- Existing rows with role = 'HOST' or 'STUDENT' or 'OBSERVER' are unaffected.
-- Default remains 'STUDENT'.

ALTER TABLE `live_class_participants`
  MODIFY COLUMN `role` ENUM('HOST', 'MODERATOR', 'STUDENT', 'OBSERVER') NOT NULL DEFAULT 'STUDENT';
