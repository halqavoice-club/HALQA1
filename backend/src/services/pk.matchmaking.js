/**
 * PK Matchmaking Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Redis-backed matchmaking queue.
 * Uses atomic operations to prevent duplicate matches.
 * Matchmaking range expands over time when no opponent found.
 *
 * Queue data structure: Redis Sorted Set
 *   Key:   pk:mm:queue:{type}
 *   Score: enteredAt timestamp (for FIFO ordering)
 *   Value: JSON { userId, rating, lang, region, durationSeconds, teamSize, enteredAt }
 */

'use strict';

const { v4: uuidv4 }                             = require('uuid');
const prisma                                     = require('../utils/prisma');
const { getRedis, isRedisReady }                 = require('../utils/redis');
const { createMatch, getConfig, emitPKUser }     = require('./pk.service');
const logger                                     = require('../utils/logger');

const QUEUE_TTL        = 120;  // auto-expire queue entries after 2 minutes
const MATCH_LOCK_TTL   = 10;   // distributed lock TTL for match creation

// Queue key per match type
const queueKey = (type) => `pk:mm:queue:${type || 'ONE_V_ONE'}`;
const entryKey = (userId) => `pk:mm:entry:${userId}`;

// ─── JOIN QUEUE ───────────────────────────────────────────────────────────────
/**
 * Add a user to the matchmaking queue.
 * Returns the queue entry on success.
 * Throws if user is already in queue, already in active PK, or banned.
 */
async function joinQueue(userId, opts = {}) {
  if (!isRedisReady()) throw new Error('Matchmaking temporarily unavailable');

  const config = await getConfig();
  if (!config.pkEnabled || !config.matchmakingEnabled) {
    throw new Error('Matchmaking is currently disabled');
  }

  // Check user is not already in a live PK
  const activePK = await prisma.pKParticipant.findFirst({
    where: {
      userId,
      isActive: true,
      match: { state: { in: ['LIVE', 'COUNTDOWN', 'PREPARING', 'MATCHMAKING'] } }
    }
  });
  if (activePK) throw new Error('You are already in an active PK');

  const redis = getRedis();

  // Check not already in queue
  const existing = await redis.get(entryKey(userId));
  if (existing) throw new Error('You are already in the matchmaking queue');

  // Get user stats for rating
  const stats  = await prisma.pKUserStats.findUnique({ where: { userId } });
  const rating = stats?.rating || 1000;

  const type          = opts.type || 'ONE_V_ONE';
  const durationSecs  = Math.min(Math.max(opts.durationSeconds || config.defaultDurationSeconds, config.minDurationSeconds || 60), config.maxDurationSeconds || 600);
  const enteredAt     = Date.now();

  const entry = {
    userId,
    rating,
    type,
    durationSeconds: durationSecs,
    teamSize:        opts.teamSize || 1,
    lang:            opts.lang || null,
    region:          opts.region || null,
    enteredAt,
  };

  const pipe = redis.pipeline();
  pipe.set(entryKey(userId), JSON.stringify(entry), 'EX', QUEUE_TTL);
  pipe.zadd(queueKey(type), enteredAt, userId);
  await pipe.exec();

  // Persist in DB for audit (non-blocking)
  prisma.pKMatchmakingQueue.upsert({
    where:  { userId },
    create: { id: uuidv4(), userId, type, preferredRating: rating, durationSeconds: durationSecs, teamSize: opts.teamSize || 1, enteredAt: new Date(enteredAt) },
    update: { enteredAt: new Date(enteredAt), cancelledAt: null, matchedAt: null, pkMatchId: null },
  }).catch(() => {});

  // Attempt immediate match
  setTimeout(() => attemptMatch(userId, type).catch(() => {}), 200);

  return entry;
}

// ─── LEAVE QUEUE ──────────────────────────────────────────────────────────────
async function leaveQueue(userId, type) {
  if (!isRedisReady()) return;
  const redis = getRedis();
  const pipe  = redis.pipeline();

  // Always remove the user's personal entry key regardless of type
  pipe.del(entryKey(userId));

  // BUG-002 FIX: When no type is provided by the caller, read the actual type
  // from the stored entry so we remove from the correct sorted set.
  // If the entry is already gone (expired or never set), fall back to
  // removing from all known queue types to guarantee no stale membership.
  let queueType = type;
  try {
    const entryRaw = await redis.get(entryKey(userId));
    if (entryRaw) {
      const entry = JSON.parse(entryRaw);
      queueType = entry.type || type || 'ONE_V_ONE';
    }
  } catch {}

  if (queueType) {
    pipe.zrem(queueKey(queueType), userId);
  } else {
    // Safety net: remove from all queue types to prevent phantom entries
    for (const t of ['ONE_V_ONE', 'ROOM_V_ROOM', 'TEAM_V_TEAM', 'CLUB_V_CLUB']) {
      pipe.zrem(queueKey(t), userId);
    }
  }

  await pipe.exec();

  prisma.pKMatchmakingQueue.updateMany({
    where: { userId, cancelledAt: null },
    data:  { cancelledAt: new Date() }
  }).catch(() => {});
}

// ─── ATTEMPT MATCH ────────────────────────────────────────────────────────────
/**
 * Try to find an opponent for userId.
 * Expands rating range over time using configurable thresholds.
 */
async function attemptMatch(userId, type) {
  if (!isRedisReady()) return null;

  const redis      = getRedis();
  const entryRaw   = await redis.get(entryKey(userId));
  if (!entryRaw) return null;

  const entry     = JSON.parse(entryRaw);
  const config    = await getConfig();
  const now       = Date.now();
  const elapsed   = Math.floor((now - entry.enteredAt) / 1000);

  // Expanding range
  let ratingDiff = config.maxRatingDiffInitial;
  if (elapsed >= config.matchmakingExpandInterval * 2) ratingDiff = config.maxRatingDiffFinal;
  else if (elapsed >= config.matchmakingExpandInterval) ratingDiff = config.maxRatingDiffExpand;

  const allUserIds = await redis.zrange(queueKey(type), 0, -1);
  const candidates = [];

  for (const candidateId of allUserIds) {
    if (candidateId === userId) continue;
    const raw = await redis.get(entryKey(candidateId));
    if (!raw) continue;
    const candidate = JSON.parse(raw);

    const ratingOk = Math.abs(candidate.rating - entry.rating) <= ratingDiff;
    const durationOk = candidate.durationSeconds === entry.durationSeconds;
    if (ratingOk && durationOk) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    // Re-try after expand interval
    setTimeout(() => attemptMatch(userId, type).catch(() => {}), config.matchmakingExpandInterval * 1000);
    return null;
  }

  // Pick closest rating
  candidates.sort((a, b) => Math.abs(a.rating - entry.rating) - Math.abs(b.rating - entry.rating));
  const opponent = candidates[0];

  // Acquire distributed lock to prevent double-match
  const lockKey = `pk:mm:lock:${[userId, opponent.userId].sort().join(':')}`;
  const acquired = await redis.set(lockKey, '1', 'NX', 'EX', MATCH_LOCK_TTL);
  if (acquired !== 'OK') return null;

  try {
    // Remove both from queue
    const pipe = redis.pipeline();
    pipe.del(entryKey(userId));
    pipe.del(entryKey(opponent.userId));
    pipe.zrem(queueKey(type), userId);
    pipe.zrem(queueKey(type), opponent.userId);
    await pipe.exec();

    // Create match — detect active voice rooms for both users so the banner appears
    const [senderRoom, opponentRoom] = await Promise.all([
      prisma.voiceParticipant.findFirst({
        where: { userId, isActive: true },
        select: { roomId: true },
        orderBy: { joinedAt: 'desc' },
      }),
      prisma.voiceParticipant.findFirst({
        where: { userId: opponent.userId, isActive: true },
        select: { roomId: true },
        orderBy: { joinedAt: 'desc' },
      }),
    ]);

    const { match } = await createMatch({
      type:            entry.type,
      sideAUserId:     userId,
      sideBUserId:     opponent.userId,
      durationSeconds: entry.durationSeconds,
      roomIdA:         senderRoom?.roomId   || null,
      roomIdB:         opponentRoom?.roomId || null,
      idempotencyKey:  `mm:${[userId, opponent.userId].sort().join(':')}:${now}`,
    });

    // Update DB queue records
    prisma.pKMatchmakingQueue.updateMany({
      where: { userId: { in: [userId, opponent.userId] }, matchedAt: null },
      data:  { matchedAt: new Date(), pkMatchId: match.id }
    }).catch(() => {});

    // Notify both users
    emitPKUser(userId,          'pk:matched', { pkMatchId: match.id, opponentId: opponent.userId });
    emitPKUser(opponent.userId, 'pk:matched', { pkMatchId: match.id, opponentId: userId });

    logger.info(`[pk:mm] Matched ${userId} vs ${opponent.userId} → pkMatch ${match.id}`);
    return match;
  } finally {
    await redis.del(lockKey);
  }
}

// ─── QUEUE STATUS ─────────────────────────────────────────────────────────────
async function getQueueStatus(userId) {
  if (!isRedisReady()) return { inQueue: false };
  try {
    const raw = await getRedis().get(entryKey(userId));
    if (!raw) return { inQueue: false };
    const entry = JSON.parse(raw);
    return { inQueue: true, enteredAt: entry.enteredAt, type: entry.type };
  } catch {
    return { inQueue: false };
  }
}

module.exports = { joinQueue, leaveQueue, attemptMatch, getQueueStatus };
