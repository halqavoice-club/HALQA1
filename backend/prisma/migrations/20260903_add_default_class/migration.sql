-- Add isDefault flag to classes table
-- This marks the auto-created "General" class that is created when a school is founded.
-- New students who join the school are automatically enrolled in this class.
-- Admins and teachers can later assign students to additional specific classes.

ALTER TABLE `classes`
  ADD COLUMN `isDefault` TINYINT(1) NOT NULL DEFAULT 0;

-- Index for quickly finding the default class of a school
CREATE INDEX `classes_schoolId_isDefault_idx` ON `classes`(`schoolId`, `isDefault`);
