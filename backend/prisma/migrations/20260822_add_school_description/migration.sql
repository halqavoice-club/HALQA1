-- Migration: 20260822_add_school_description
-- Adds `description` (TEXT, nullable) to the schools table.
-- Used by the Create School profile form to store a school bio / about text.
-- Fully backward-compatible: all existing rows default to NULL.

ALTER TABLE `schools`
  ADD COLUMN `description` TEXT NULL
  AFTER `type`;
