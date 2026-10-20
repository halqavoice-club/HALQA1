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

const { deleteCache, deleteCachePattern } = require('./redis');
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

module.exports = { roomCacheKey, invalidateRoomCache };
