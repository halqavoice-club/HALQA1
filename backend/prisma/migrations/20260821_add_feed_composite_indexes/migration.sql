-- Migration: 20260821_add_feed_composite_indexes
-- Adds composite indexes covering the most common social feed query patterns.
-- Without these, feed queries require a full posts table scan + sort,
-- which becomes expensive as post volume grows.

-- ─── posts ───────────────────────────────────────────────────────────────────

-- Personal feed: all posts by a specific user, filtered by visibility, newest first
-- Query: WHERE authorId = ? AND visibility = ? ORDER BY createdAt DESC
CREATE INDEX `posts_authorId_visibility_createdAt_idx`
  ON `posts` (`authorId`, `visibility`, `createdAt`);

-- School-scoped feed: posts visible to a school, newest first
-- Query: WHERE schoolId = ? AND visibility IN ('PUBLIC','SCHOOL_ONLY') ORDER BY createdAt DESC
CREATE INDEX `posts_schoolId_visibility_createdAt_idx`
  ON `posts` (`schoolId`, `visibility`, `createdAt`);

-- Community feed: posts in a specific community, newest first
-- Query: WHERE communityId = ? AND deletedAt IS NULL ORDER BY createdAt DESC
CREATE INDEX `posts_communityId_createdAt_idx`
  ON `posts` (`communityId`, `createdAt`);

-- ─── notifications ───────────────────────────────────────────────────────────

-- Filtered notification inbox (e.g. show only GIFT_RECEIVED, LIKE)
-- Query: WHERE userId = ? AND type = ? ORDER BY createdAt DESC
-- This covers both the existing @@index([userId, isRead, createdAt]) gap
-- and typed notification filtering.
CREATE INDEX `notifications_userId_type_isRead_idx`
  ON `notifications` (`userId`, `type`, `isRead`);

-- ─── global_leaderboard ──────────────────────────────────────────────────────

-- Leaderboard by period, sorted by rank (common: top 100 for a specific period)
-- Query: WHERE period = ? ORDER BY rank ASC LIMIT 100
CREATE INDEX `global_leaderboard_period_rank_idx`
  ON `global_leaderboard` (`period`, `rank`);
