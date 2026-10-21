'use strict';

/**
 * Voice Room FIFO Speaker Queue — Redis-backed with graceful fallback
 * ─────────────────────────────────────────────────────────────────────────────
 * P2-1 FIX: All exported functions now return safe values (not throw) when
 * Redis is unavailable. Callers that were already wrapping in try/catch continue
 * to work. Callers that were NOT wrapping no longer crash with 500s.
 *
 * Redis data structures:
 *   ZSET  voice:queue:{roomId}           — member=userId, score=timestamp (ms)
 *   HASH  voice:queue:{roomId}:meta      — field=userId, value=JSON metadata
 * Both keys share an 8-hour TTL and are deleted when the room ends.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getRedis, isRedisReady } = require('./redis');
const logger = require('./logger');

const QUEUE_TTL = 8 * 60 * 60; // 8 hours in seconds

const zsetKey = (roomId) => `voice:queue:${roomId}`;
const metaKey = (roomId) => `voice:queue:${roomId}:meta`;

// ─── enqueue ──────────────────────────────────────────────────────────────────
/**
 * Add a user to the FIFO queue.
 * Returns the user's 1-based position, or 1 if Redis is unavailable.
 */
async function enqueue(roomId, user) {
  if (!isRedisReady()) {
    logger.warn('[voiceQueue] Redis unavailable — enqueue skipped (DB handRaised is fallback)');
    return 1;
  }
  try {
    const redis = getRedis();
    const score = Date.now();
    const meta  = JSON.stringify({
      userId:    user.id,
      firstName: user.firstName,
      lastName:  user.lastName,
      avatarUrl: user.avatarUrl ?? null,
      raisedAt:  new Date(score).toISOString(),
    });

    await redis.zadd(zsetKey(roomId), 'NX', score, user.id);
    await redis.hset(metaKey(roomId), user.id, meta);
    await redis.expire(zsetKey(roomId), QUEUE_TTL);
    await redis.expire(metaKey(roomId), QUEUE_TTL);

    return getPosition(roomId, user.id);
  } catch (err) {
    logger.warn(`[voiceQueue] enqueue failed: ${err.message}`);
    return 1;
  }
}

// ─── requeue ──────────────────────────────────────────────────────────────────
/**
 * Re-add a user to the FIFO queue with their ORIGINAL raisedAt score.
 *
 * Used when a promotion fails after the caller already popped/dequeued the user
 * (P2002 duplicate-seat race, or every free seat is locked). Unlike enqueue() —
 * which stamps Date.now() and sends the user to the back of the queue — requeue()
 * restores the user to their original FIFO position so they don't lose priority.
 *
 * The caller is responsible for having removed the user first (via popNext() or
 * dequeue()); requeue() re-inserts them. Safe — no-op if Redis is unavailable
 * (the DB handRaised flag is the durable fallback and remains untouched).
 *
 * @param {string} roomId
 * @param {{ userId: string, firstName?: string, lastName?: string, avatarUrl?: string|null, raisedAt?: string }} userMeta
 */
async function requeue(roomId, userMeta) {
  if (!isRedisReady()) {
    logger.warn('[voiceQueue] Redis unavailable — requeue skipped (DB handRaised is fallback)');
    return;
  }
  try {
    const redis  = getRedis();
    const userId = userMeta.userId;
    const score  = userMeta.raisedAt ? new Date(userMeta.raisedAt).getTime() : Date.now();
    const meta   = JSON.stringify({
      userId,
      firstName: userMeta.firstName,
      lastName:  userMeta.lastName,
      avatarUrl:  userMeta.avatarUrl ?? null,
      raisedAt:   userMeta.raisedAt ?? new Date(score).toISOString(),
    });
    // 'NX' matches enqueue()/getQueue() re-hydration: only add the member (the
    // caller already removed it), preserving the original score on re-insert.
    await redis.zadd(zsetKey(roomId), 'NX', score, userId);
    await redis.hset(metaKey(roomId), userId, meta);
    await redis.expire(zsetKey(roomId), QUEUE_TTL);
    await redis.expire(metaKey(roomId), QUEUE_TTL);
  } catch (err) {
    logger.warn(`[voiceQueue] requeue failed: ${err.message}`);
  }
}

// ─── dequeue ──────────────────────────────────────────────────────────────────
/**
 * Remove a specific user from the queue. Safe — no-op if Redis unavailable.
 */
async function dequeue(roomId, userId) {
  if (!isRedisReady()) return;
  try {
    const redis = getRedis();
    await Promise.all([
      redis.zrem(zsetKey(roomId), userId),
      redis.hdel(metaKey(roomId), userId),
    ]);
  } catch (err) {
    logger.warn(`[voiceQueue] dequeue failed: ${err.message}`);
  }
}

// ─── peekNext ─────────────────────────────────────────────────────────────────
/** Returns first user without removing. Returns null if empty or Redis unavailable. */
async function peekNext(roomId) {
  if (!isRedisReady()) return null;
  try {
    const redis   = getRedis();
    const results = await redis.zrange(zsetKey(roomId), 0, 0);
    if (!results.length) return null;
    const userId = results[0];
    const raw    = await redis.hget(metaKey(roomId), userId);
    return raw ? JSON.parse(raw) : { userId };
  } catch (err) {
    logger.warn(`[voiceQueue] peekNext failed: ${err.message}`);
    return null;
  }
}

// ─── popNext ──────────────────────────────────────────────────────────────────
/** Atomically removes and returns the first user. Returns null if unavailable. */
async function popNext(roomId) {
  if (!isRedisReady()) return null;
  try {
    const redis  = getRedis();
    const result = await redis.zpopmin(zsetKey(roomId), 1);
    if (!result.length) return null;
    const userId = result[0];
    const raw    = await redis.hget(metaKey(roomId), userId);
    await redis.hdel(metaKey(roomId), userId);
    return raw ? JSON.parse(raw) : { userId };
  } catch (err) {
    logger.warn(`[voiceQueue] popNext failed: ${err.message}`);
    return null;
  }
}

// ─── getQueue ─────────────────────────────────────────────────────────────────
/**
 * Returns all queued users in FIFO order.
 *
 * VC-GAP-006 FIX: Redis queue hydration on flush recovery.
 * When Redis is ready but returns an empty queue, we check the DB for
 * VoiceParticipant records with handRaised=true. If found, we re-hydrate
 * the Redis queue from the DB (sorted by handRaisedAt) so subsequent calls
 * return the correct order.
 *
 * This prevents a Redis flush from permanently silencing all pending
 * speaker requests. The FIFO order is best-effort (DB uses handRaisedAt
 * timestamps) but is always better than returning nothing.
 */
async function getQueue(roomId) {
  if (!isRedisReady()) return getQueueFromDB(roomId);
  try {
    const redis   = getRedis();
    const userIds = await redis.zrange(zsetKey(roomId), 0, -1);

    // Redis has queue data — return it directly (normal path)
    if (userIds.length > 0) {
      const metas = await redis.hmget(metaKey(roomId), ...userIds);
      return metas
        .map((raw, i) => (raw ? JSON.parse(raw) : { userId: userIds[i] }))
        .filter(Boolean);
    }

    // Redis is empty — check if DB has raised hands (post-flush recovery)
    const dbQueue = await getQueueFromDB(roomId);
    if (dbQueue.length === 0) return [];

    // Re-hydrate Redis from DB so subsequent getQueue calls use Redis
    logger.info(`[voiceQueue] Redis queue empty after possible flush — re-hydrating from DB for room ${roomId} (${dbQueue.length} entries)`);
    const pipeline = redis.pipeline();
    for (const entry of dbQueue) {
      const score = entry.raisedAt ? new Date(entry.raisedAt).getTime() : Date.now();
      pipeline.zadd(zsetKey(roomId), 'NX', score, entry.userId);
      pipeline.hset(metaKey(roomId), entry.userId, JSON.stringify(entry));
    }
    pipeline.expire(zsetKey(roomId), QUEUE_TTL);
    pipeline.expire(metaKey(roomId), QUEUE_TTL);
    await pipeline.exec().catch(err =>
      logger.warn(`[voiceQueue] Re-hydration pipeline failed: ${err.message}`)
    );

    return dbQueue;
  } catch (err) {
    logger.warn(`[voiceQueue] getQueue failed: ${err.message}`);
    return getQueueFromDB(roomId);
  }
}

/**
 * VC-GAP-006: DB fallback — fetch raised-hand participants ordered by handRaisedAt.
 * Used when Redis is unavailable OR when recovering from a Redis flush.
 */
async function getQueueFromDB(roomId) {
  try {
    const prisma = require('./prisma');
    const participants = await prisma.voiceParticipant.findMany({
      where: { roomId, isActive: true, handRaised: true },
      orderBy: { handRaisedAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });
    return participants.map(p => ({
      userId:    p.userId,
      firstName: p.user?.firstName ?? '',
      lastName:  p.user?.lastName  ?? '',
      avatarUrl: p.user?.avatarUrl ?? null,
      raisedAt:  p.handRaisedAt ? p.handRaisedAt.toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`[voiceQueue] getQueueFromDB failed: ${err.message}`);
    return [];
  }
}

// ─── getPosition ──────────────────────────────────────────────────────────────
/** Returns 1-based position, or 0 if not in queue or Redis unavailable. */
async function getPosition(roomId, userId) {
  if (!isRedisReady()) return 0;
  try {
    const redis = getRedis();
    const rank  = await redis.zrank(zsetKey(roomId), userId);
    return rank === null ? 0 : rank + 1;
  } catch (err) {
    logger.warn(`[voiceQueue] getPosition failed: ${err.message}`);
    return 0;
  }
}

// ─── isInQueue ────────────────────────────────────────────────────────────────
/** Returns false if Redis unavailable rather than throwing. */
async function isInQueue(roomId, userId) {
  if (!isRedisReady()) return false;
  try {
    const redis = getRedis();
    const score = await redis.zscore(zsetKey(roomId), userId);
    return score !== null;
  } catch (err) {
    logger.warn(`[voiceQueue] isInQueue failed: ${err.message}`);
    return false;
  }
}

// ─── queueLength ──────────────────────────────────────────────────────────────
/** Returns 0 if Redis unavailable. */
async function queueLength(roomId) {
  if (!isRedisReady()) return 0;
  try {
    const redis = getRedis();
    return redis.zcard(zsetKey(roomId));
  } catch (err) {
    logger.warn(`[voiceQueue] queueLength failed: ${err.message}`);
    return 0;
  }
}

// ─── clearQueue ───────────────────────────────────────────────────────────────
/** Deletes queue keys. Safe — no-op if Redis unavailable. */
async function clearQueue(roomId) {
  if (!isRedisReady()) return;
  try {
    const redis = getRedis();
    await Promise.all([
      redis.del(zsetKey(roomId)),
      redis.del(metaKey(roomId)),
    ]);
  } catch (err) {
    logger.warn(`[voiceQueue] clearQueue failed: ${err.message}`);
  }
}

module.exports = {
  enqueue,
  requeue,
  dequeue,
  peekNext,
  popNext,
  getQueue,
  getPosition,
  isInQueue,
  queueLength,
  clearQueue,
};
