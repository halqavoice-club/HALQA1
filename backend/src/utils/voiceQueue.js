'use strict';

/**
 * Voice Room FIFO Speaker Queue — Redis-only
 * ─────────────────────────────────────────────────────────────────────────────
 * Redis data structures:
 *
 *   ZSET  voice:queue:{roomId}
 *         member = userId
 *         score  = Unix timestamp (ms) when hand was raised
 *         ZRANGEBYSCORE gives FIFO order (lowest score = first in)
 *
 *   HASH  voice:queue:{roomId}:meta
 *         field = userId
 *         value = JSON { userId, firstName, lastName, avatarUrl, raisedAt }
 *         O(1) lookup of display metadata without hitting the DB
 *
 * Both keys share an 8-hour TTL and are deleted when the room ends.
 *
 * No in-memory fallback — Redis is required. All functions throw if Redis
 * is unavailable so callers can handle the error explicitly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getRedis } = require('./redis');

const QUEUE_TTL = 8 * 60 * 60; // 8 hours in seconds

// ─── Key helpers ──────────────────────────────────────────────────────────────
const zsetKey = (roomId) => `voice:queue:${roomId}`;
const metaKey = (roomId) => `voice:queue:${roomId}:meta`;

// ─── enqueue ──────────────────────────────────────────────────────────────────
/**
 * Add a user to the FIFO queue.
 * Idempotent — calling twice for the same user is a no-op (score unchanged).
 * Returns the user's 1-based position in the queue.
 *
 * @param {string} roomId
 * @param {{ id, firstName, lastName, avatarUrl }} user
 * @returns {Promise<number>} 1-based position
 */
async function enqueue(roomId, user) {
  const redis = getRedis();
  const score = Date.now();
  const meta  = JSON.stringify({
    userId:    user.id,
    firstName: user.firstName,
    lastName:  user.lastName,
    avatarUrl: user.avatarUrl ?? null,
    raisedAt:  new Date(score).toISOString(),
  });

  // NX flag: only add if not already present (preserves original timestamp)
  await redis.zadd(zsetKey(roomId), 'NX', score, user.id);
  await redis.hset(metaKey(roomId), user.id, meta);
  await redis.expire(zsetKey(roomId), QUEUE_TTL);
  await redis.expire(metaKey(roomId), QUEUE_TTL);

  return getPosition(roomId, user.id);
}

// ─── dequeue ──────────────────────────────────────────────────────────────────
/**
 * Remove a specific user from the queue (cancel or reject).
 *
 * @param {string} roomId
 * @param {string} userId
 */
async function dequeue(roomId, userId) {
  const redis = getRedis();
  await Promise.all([
    redis.zrem(zsetKey(roomId), userId),
    redis.hdel(metaKey(roomId), userId),
  ]);
}

// ─── peekNext ─────────────────────────────────────────────────────────────────
/**
 * Return the first user in the queue (lowest score) without removing them.
 * Returns null if the queue is empty.
 *
 * @param {string} roomId
 * @returns {Promise<object|null>}
 */
async function peekNext(roomId) {
  const redis   = getRedis();
  const results = await redis.zrange(zsetKey(roomId), 0, 0);
  if (!results.length) return null;

  const userId = results[0];
  const raw    = await redis.hget(metaKey(roomId), userId);
  return raw ? JSON.parse(raw) : { userId };
}

// ─── popNext ──────────────────────────────────────────────────────────────────
/**
 * Atomically remove and return the first user in the queue.
 * Used when the host approves the next speaker.
 *
 * @param {string} roomId
 * @returns {Promise<object|null>}
 */
async function popNext(roomId) {
  const redis  = getRedis();
  // ZPOPMIN atomically removes the member with the lowest score
  const result = await redis.zpopmin(zsetKey(roomId), 1);
  if (!result.length) return null;

  const userId = result[0]; // [member, score, ...]
  const raw    = await redis.hget(metaKey(roomId), userId);
  await redis.hdel(metaKey(roomId), userId);
  return raw ? JSON.parse(raw) : { userId };
}

// ─── getQueue ─────────────────────────────────────────────────────────────────
/**
 * Return all queued users in FIFO order (oldest first).
 *
 * @param {string} roomId
 * @returns {Promise<object[]>}
 */
async function getQueue(roomId) {
  const redis   = getRedis();
  const userIds = await redis.zrange(zsetKey(roomId), 0, -1);
  if (!userIds.length) return [];

  const metas = await redis.hmget(metaKey(roomId), ...userIds);
  return metas
    .map((raw, i) => (raw ? JSON.parse(raw) : { userId: userIds[i] }))
    .filter(Boolean);
}

// ─── getPosition ──────────────────────────────────────────────────────────────
/**
 * Return the 1-based position of a user in the queue.
 * Returns 0 if the user is not in the queue.
 *
 * @param {string} roomId
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getPosition(roomId, userId) {
  const redis = getRedis();
  const rank  = await redis.zrank(zsetKey(roomId), userId);
  return rank === null ? 0 : rank + 1;
}

// ─── isInQueue ────────────────────────────────────────────────────────────────
/**
 * @param {string} roomId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isInQueue(roomId, userId) {
  const redis = getRedis();
  const score = await redis.zscore(zsetKey(roomId), userId);
  return score !== null;
}

// ─── queueLength ──────────────────────────────────────────────────────────────
/**
 * @param {string} roomId
 * @returns {Promise<number>}
 */
async function queueLength(roomId) {
  const redis = getRedis();
  return redis.zcard(zsetKey(roomId));
}

// ─── clearQueue ───────────────────────────────────────────────────────────────
/**
 * Delete the entire queue for a room (called when the room ends).
 *
 * @param {string} roomId
 */
async function clearQueue(roomId) {
  const redis = getRedis();
  await Promise.all([
    redis.del(zsetKey(roomId)),
    redis.del(metaKey(roomId)),
  ]);
}

module.exports = {
  enqueue,
  dequeue,
  peekNext,
  popNext,
  getQueue,
  getPosition,
  isInQueue,
  queueLength,
  clearQueue,
};
