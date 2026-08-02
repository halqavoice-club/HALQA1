-- Make LiveClass.duration nullable so permanent rooms can have no time limit.
-- Existing rows keep their current integer value; new permanent rooms will have NULL.

ALTER TABLE `live_classes`
  MODIFY COLUMN `duration` INT NULL;
