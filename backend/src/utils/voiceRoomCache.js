'use strict';
/**
 * voiceRoomCache.js — Shared Voice Club room cache helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracted from voice.controller.js so that background workers (e.g.
 * voice-room-sleep.worker.js) can invalidate the room cache without pulling
 * in the entire controller module (which would create a circular dependency
 * via the sockets/feedLive/queue.service imports).
 *
 * Both the controller and the worker import these helpers so cache keys and
 * invalidation logic stay in one place.
 */

const { deleteCache, deleteCachePattern, getRedis, isRedisReady } = require('./redis');
const logger = require('./logger');

/** Cache key for a single room's cached object. */
function roomCacheKey(roomId) {
  return `voice:room:${roomId}`;
}

/**
 * Invalidate the single-room cache entry plus all paginated room-list cache
 * entries for the room's school (and the global list).
 *
 * Cache errors are non-fatal — a stale cache is preferable to a failed HTTP
 * response or a failed worker job — but errors are always logged.
 *
 * @param {string} roomId
 * @param {string|null} [schoolId] — voice rooms are global (schoolId=null) but
 *   the schoolId is still passed through for list-cache key matching.
 */
async function invalidateRoomCache(roomId, schoolId) {
  try {
    // Invalidate the single-room cache
    await deleteCache(roomCacheKey(roomId));
    // BE-008: Invalidate all room list cache entries for this school using pattern delete.
    // This covers every filter/page combination without needing to enumerate them.
    await deleteCachePattern(`voice:rooms:${schoolId || 'global'}:*`);
    await deleteCachePattern(`voice:rooms:global:*`);
  } catch (err) {
    logger.error(`[voice] Cache DEL failed for room ${roomId}: ${err.message}`);
  }
}

/**
 * Get the next monotonic state version for a room's stage.
 * Uses Redis INCR so every mutation in every server instance increments a
 * shared counter, guaranteeing that any client can compare incoming
 * stateVersion values and discard stale snapshots.
 *
 * Non-fatal: if Redis is unavailable the function returns 0 so callers
 * treat the snapshot as unversioned and fall back to safe update-only behaviour.
 *
 * @param {string} roomId
 * @returns {Promise<number>} monotonic integer >= 1, or 0 on Redis failure
 */
async function getNextStageVersion(roomId) {
  try {
    if (!isRedisReady()) return 0;
    const redis = getRedis();
    const key = `voice:stateVersion:${roomId}`;
    const version = await redis.incr(key);
    // Expire after 24h so keys don't accumulate indefinitely for idle rooms
    await redis.expire(key, 86400);
    return Number(version);
  } catch (err) {
    logger.warn(`[voiceRoomCache] getNextStageVersion failed for room ${roomId}: ${err.message}`);
    return 0;
  }
}

module.exports = { roomCacheKey, invalidateRoomCache, getNextStageVersion };
