-- CF-03: enforce one PENDING post_report per (reporterId, postId) at the DB level.
-- This closes the race window that the application-level Serializable transaction
-- cannot close alone: without a unique constraint two concurrent inserts of the
-- same (reporterId, postId, PENDING) triple both commit because the storage engine
-- has no uniqueness conflict to abort on.
--
-- IMPLEMENTATION NOTE (MariaDB 10.11 compatibility):
-- A STORED generated column using IF() was originally used here but MariaDB 10.11
-- rejects the expression with error 1901 ("Function or expression is not allowed
-- for column 'pendingKey'"). Generated columns in MariaDB 10.x have restrictions on
-- the functions that can be used in STORED columns referencing other columns.
--
-- REPLACEMENT DESIGN: Use a regular (non-generated) nullable column maintained
-- explicitly by the application:
--   - reportPost() sets pendingKey = CONCAT(reporterId, '-', postId) on INSERT
--   - Status transitions (PENDING → terminal) set pendingKey = NULL via UPDATE
--   - The UNIQUE KEY on pendingKey enforces the one-PENDING-per-pair invariant
--   - Multiple NULL values are allowed (MariaDB UNIQUE allows multiple NULLs)
--     so historical REVIEWED/DISMISSED/ACTION_TAKEN rows coexist without conflict
--
-- This is semantically identical to the generated-column approach but is fully
-- compatible with MariaDB 10.11 InnoDB.

-- Step 1: Collapse any pre-existing duplicate PENDING rows so the unique key can
-- be added without failing on legacy data. Keep the oldest row per pair.
DELETE pr1 FROM `post_reports` pr1
  JOIN `post_reports` pr2
    ON pr1.reporterId = pr2.reporterId
   AND pr1.postId    = pr2.postId
   AND pr1.status    = 'PENDING'
   AND pr2.status    = 'PENDING'
   AND pr1.createdAt > pr2.createdAt;

-- Step 2: Add a regular nullable pendingKey column.
ALTER TABLE `post_reports`
  ADD COLUMN `pendingKey` VARCHAR(191) NULL DEFAULT NULL;

-- Step 3: Back-fill pendingKey for all existing PENDING rows.
UPDATE `post_reports`
  SET `pendingKey` = CONCAT(`reporterId`, '-', `postId`)
  WHERE `status` = 'PENDING';

-- Step 4: Add the unique constraint (NULLs do not conflict with each other).
ALTER TABLE `post_reports`
  ADD UNIQUE KEY `post_reports_pending_unique` (`pendingKey`);
