-- Migration: 20260913_live_class_stage_lifecycle
--
-- Adds a database-level safety net for the Live Class stage slot system.
-- Prevents two active participants from being assigned the same speakerSlot
-- within the same live class, closing the concurrency race window.
--
-- MySQL behaviour: a UNIQUE constraint on a nullable column allows multiple
-- NULL values — so audience participants (speakerSlot IS NULL) are unaffected.
-- Only non-null slot values (active speakers) are deduplicated.
--
-- This is a supplementary guard alongside the atomic UPDATE in the controller.
-- Without this, a race between two concurrent promotion requests could produce
-- duplicate slot assignments at the application level before the DB write.

ALTER TABLE `live_class_participants`
  ADD UNIQUE KEY `unique_liveclass_speaker_slot` (`liveClassId`, `speakerSlot`);
