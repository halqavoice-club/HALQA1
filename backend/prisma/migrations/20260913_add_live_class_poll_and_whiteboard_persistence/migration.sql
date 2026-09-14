-- Migration: Poll + Whiteboard persistence for live classes
-- Sprint 3 fix for LC-GAP-004 (poll state) and LC-GAP-005 (whiteboard state)
--
-- STRATEGY:
--   Redis remains the hot path (fast reads for active sessions).
--   These tables are the durable fallback: written on create/vote/close
--   and on whiteboard snapshot. On Redis flush or server restart,
--   getPollState() and getWhiteboardState() fall back to these tables.
--
-- Both tables are fully additive — no existing rows or columns touched.

-- ─── live_class_polls ─────────────────────────────────────────────────────────
-- One row per poll created during a live class.
-- options  — JSON array: [{ id, text, votes: string[] }]
-- createdBy — userId of the teacher who created the poll (JWT-verified)
CREATE TABLE `live_class_polls` (
  `id`          VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `question`    VARCHAR(500) NOT NULL,
  `options`     JSON         NOT NULL,   -- [{ id, text, votes: userId[] }]
  `isActive`    TINYINT(1)   NOT NULL DEFAULT 1,
  `createdBy`   VARCHAR(191) NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `live_class_polls_liveClassId_idx` (`liveClassId`),
  INDEX `live_class_polls_isActive_idx`    (`isActive`),

  CONSTRAINT `live_class_polls_liveClassId_fkey`
    FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── live_class_whiteboard_snapshots ──────────────────────────────────────────
-- One row per live class (upserted on each snapshot event).
-- strokes — JSON blob: the full current whiteboard stroke array.
-- Kept to one row per class so storage stays bounded regardless of session length.
CREATE TABLE `live_class_whiteboard_snapshots` (
  `id`          VARCHAR(191) NOT NULL,
  `liveClassId` VARCHAR(191) NOT NULL,
  `strokes`     LONGTEXT     NOT NULL,   -- JSON array of stroke objects
  `snapshotAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `live_class_whiteboard_snapshots_liveClassId_key` (`liveClassId`),

  CONSTRAINT `live_class_whiteboard_snapshots_liveClassId_fkey`
    FOREIGN KEY (`liveClassId`) REFERENCES `live_classes`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
