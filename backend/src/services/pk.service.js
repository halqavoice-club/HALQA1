/**
 * PK Service — Core Business Logic
 * ─────────────────────────────────────────────────────────────────────────────
 * All PK state transitions, scoring, and race-condition prevention live here.
 * Controllers call these methods; Socket events also call them for real-time updates.
 *
 * CRITICAL RULES:
 * - The gift engine is the only source of truth for financial transactions.
 * - PK scores are DERIVED from verified GiftTransaction records only.
 * - Never trust client-side scores, gift values, or combo levels.
 * - All state transitions are validated server-side via the state machine.
 * - Distributed locks prevent double-start, double-end, double-gift-count.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { getRedis, isRedisReady, setCache, getCache, deleteCache } = require('../utils/redis');
const { getIo } = require('../sockets');
const { notify } = require('./notification.service');
const logger = require('../utils/logger');

// ─── PK STATE MACHINE ────────────────────────────────────────────────────────
// Valid transitions: from → [to states]
const VALID_TRANSITIONS = {
  IDLE:               ['MATCHMAKING', 'INVITED', 'PREPARING'],
  MATCHMAKING:        ['PREPARING', 'CANCELLED'],
  INVITED:            ['PENDING_ACCEPTANCE', 'CANCELLED'],
  PENDING_ACCEPTANCE: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED:           ['PREPARING', 'CANCELLED'],
  PREPARING:          ['COUNTDOWN', 'CANCELLED'],
  COUNTDOWN:          ['LIVE', 'CANCELLED'],
  LIVE:               ['PAUSED', 'FINISHING', 'ABORTED'],
  PAUSED:             ['LIVE', 'ABORTED'],
  FINISHING:          ['COMPLETED', 'DISPUTED'],
  COMPLETED:          [],
  CANCELLED:          [],
  ABORTED:            [],
  DISPUTED:           ['COMPLETED', 'ABORTED'],
};

/**
 * Validate that a state transition is allowed.
 * Throws if the transition is illegal.
 */
function assertValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`PK state transition ${from} → ${to} is not allowed`);
  }
}

// ─── REDIS KEY HELPERS ────────────────────────────────────────────────────────
const KEYS = {
  lock:         (id)        => `pk:lock:${id}`,
  state:        (id)        => `pk:state:${id}`,
  timer:        (id)        => `pk:timer:${id}`,
  comboA:       (id)        => `pk:combo:${id}:A`,
  comboB:       (id)        => `pk:combo:${id}:B`,
  comboWindowA: (id)        => `pk:combo_win:${id}:A`,
  comboWindowB: (id)        => `pk:combo_win:${id}:B`,
  mmQueue:      (type)      => `pk:mm:queue:${type}`,
  mmEntry:      (userId)    => `pk:mm:entry:${userId}`,
  config:       ()          => 'pk:config',
  leaderboard:  (scope, p)  => `pk:lb:${scope}:${p}`,
};

const LOCK_TTL    = 10;   // seconds — distributed lock TTL
const STATE_TTL   = 3600; // 1 hour — transient state cache
const COMBO_TTL   = 5;    // seconds — combo window

// ─── DISTRIBUTED LOCK ────────────────────────────────────────────────────────
/**
 * Acquire a Redis SET NX EX lock. Returns true if acquired.
 * Uses atomic SET NX EX — safe against Redis disconnects.
 */
async function acquireLock(key, ttl = LOCK_TTL) {
  if (!isRedisReady()) return true; // degrade gracefully in dev without Redis
  try {
    const redis = getRedis();
    const result = await redis.set(key, '1', 'NX', 'EX', ttl);
    return result === 'OK';
  } catch (err) {
    logger.error(`[pk] acquireLock failed: ${err.message}`);
    return false;
  }
}

async function releaseLock(key) {
  if (!isRedisReady()) return;
  try {
    await getRedis().del(key);
  } catch {}
}

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
let _configCache = null;
const DEFAULT_CONFIG = {
  pkEnabled:               true,
  defaultDurationSeconds:  300,
  countdownSeconds:        5,
  comboThresholds:         [5, 10, 20, 50, 100],
  comebackThresholdPercent: 30,
  comebackMultiplier:      1.5,
  audienceVoteWeight:      0.1,
  maxRatingDiffInitial:    50,
  maxRatingDiffExpand:     100,
  maxRatingDiffFinal:      200,
  matchmakingExpandInterval: 10,
  maxGiftVelocityPerMinute: 20,
  minMatchesForRating:     5,
};

async function getConfig() {
  if (_configCache) return _configCache;
  try {
    const cached = await getCache(KEYS.config());
    if (cached) { _configCache = cached; return cached; }
    const config = await prisma.pKConfig.findFirst();
    const merged = { ...DEFAULT_CONFIG, ...config };
    await setCache(KEYS.config(), merged, 300);
    _configCache = merged;
    return merged;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function clearConfigCache() { _configCache = null; }

// ─── REALTIME SOCKET EMITTER ─────────────────────────────────────────────────
/**
 * Emit an event to the PK match room and optionally to individual user rooms.
 * Socket rooms used: pk:{pkId}, pk:user:{userId}
 */
function emitPK(pkMatchId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(`pk:${pkMatchId}`).emit(event, payload);
}

function emitPKUser(userId, event, payload) {
  const io = getIo();
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

// ─── MATCH STATE HELPERS ─────────────────────────────────────────────────────
async function getMatchState(pkMatchId) {
  try {
    const cached = await getCache(KEYS.state(pkMatchId));
    if (cached) return cached;
  } catch {}
  return prisma.pKMatch.findUnique({
    where:   { id: pkMatchId },
    include: {
      participants: { select: { userId: true, side: true, role: true, isActive: true } },
      teams:        { select: { id: true, side: true, captainId: true, score: true } },
    }
  });
}

async function cacheMatchState(match) {
  try {
    await setCache(KEYS.state(match.id), match, STATE_TTL);
  } catch {}
}

async function invalidateMatchState(pkMatchId) {
  try { await deleteCache(KEYS.state(pkMatchId)); } catch {}
}

// ─── TIMER ───────────────────────────────────────────────────────────────────
/**
 * Store the server-authoritative match timer data in Redis.
 * Client synchronizes from this — never trusts its own countdown.
 */
async function setTimerState(pkMatchId, { startedAt, durationSeconds, pausedAt = null, pausedDuration = 0 }) {
  const data = { startedAt, durationSeconds, pausedAt, pausedDuration };
  await setCache(KEYS.timer(pkMatchId), data, STATE_TTL);
  return data;
}

async function getTimerState(pkMatchId) {
  try { return await getCache(KEYS.timer(pkMatchId)); } catch { return null; }
}

/**
 * Calculate remaining seconds from server-authoritative timer state.
 */
function getRemainingSeconds(timerState) {
  if (!timerState) return 0;
  const { startedAt, durationSeconds, pausedAt, pausedDuration } = timerState;
  const now      = Date.now();
  const started  = new Date(startedAt).getTime();
  const paused   = pausedAt ? new Date(pausedAt).getTime() : now;
  const active   = (paused - started - pausedDuration * 1000);
  const elapsed  = Math.floor(active / 1000);
  return Math.max(0, durationSeconds - elapsed);
}

// ─── CREATE MATCH ─────────────────────────────────────────────────────────────
/**
 * Create a new PK match record.
 * Called from invitation acceptance, matchmaking, or direct admin creation.
 *
 * @param {object} opts
 * @param {string} opts.type         - PKMatchType
 * @param {string} opts.sideAUserId  - userId for side A
 * @param {string} opts.sideBUserId  - userId for side B (null for team PK pre-join)
 * @param {string} [opts.seasonId]
 * @param {string} [opts.tournamentId]
 * @param {number} [opts.durationSeconds]
 * @param {string} [opts.roomIdA]
 * @param {string} [opts.roomIdB]
 * @param {string} [opts.idempotencyKey]
 */
async function createMatch(opts) {
  const config = await getConfig();
  const iKey   = opts.idempotencyKey || uuidv4();

  // Idempotency guard
  const existing = await prisma.pKMatch.findUnique({ where: { idempotencyKey: iKey } });
  if (existing) return { match: existing, duplicate: true };

  const match = await prisma.pKMatch.create({
    data: {
      type:            opts.type || 'ONE_V_ONE',
      state:           'PREPARING',
      seasonId:        opts.seasonId || null,
      tournamentId:    opts.tournamentId || null,
      roomIdA:         opts.roomIdA || null,
      roomIdB:         opts.roomIdB || null,
      durationSeconds: opts.durationSeconds || config.defaultDurationSeconds,
      countdownSeconds: config.countdownSeconds,
      idempotencyKey:  iKey,
      participants: {
        create: [
          {
            id:      uuidv4(),
            userId:  opts.sideAUserId,
            side:    'A',
            role:    'HOST',
            isActive: true,
          },
          ...(opts.sideBUserId ? [{
            id:      uuidv4(),
            userId:  opts.sideBUserId,
            side:    'B',
            role:    'HOST',
            isActive: true,
          }] : [])
        ]
      }
    },
    include: {
      participants: { select: { userId: true, side: true, role: true } }
    }
  });

  await cacheMatchState(match);

  // Record analytics
  recordAnalyticsEvent('PK_CREATED', match.id, opts.sideAUserId, { type: opts.type });

  // Auto-start: if both room IDs are set (room-linked PK), begin countdown immediately.
  // This removes the manual "Start Battle" tap — the banner appears the moment
  // the invitation is accepted.
  if (opts.roomIdA || opts.roomIdB) {
    const io = getIo();
    if (io) {
      const bannerPayload = {
        pkMatchId: match.id,
        durationSeconds: match.durationSeconds,
        participants: match.participants.map(p => ({
          userId: p.userId,
          side:   p.side,
          user:   { firstName: '', lastName: '', avatarUrl: null } // enriched below
        }))
      };
      // Enrich participants with user data
      prisma.pKParticipant.findMany({
        where:   { pkMatchId: match.id },
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
      }).then(parts => {
        const enrichedPayload = {
          ...bannerPayload,
          participants: parts.map(p => ({
            userId: p.userId,
            side:   p.side,
            user:   { firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl }
          }))
        };
        if (opts.roomIdA) io.to(`voice:${opts.roomIdA}`).emit('pk:room:started', enrichedPayload);
        if (opts.roomIdB && opts.roomIdB !== opts.roomIdA) {
          io.to(`voice:${opts.roomIdB}`).emit('pk:room:started', enrichedPayload);
        }
      }).catch(() => {});
    }
    // Auto-start countdown after a short delay to allow both clients to connect
    setTimeout(() => startCountdown(match.id, opts.sideAUserId).catch(() => {}), 2000);
  }

  return { match, duplicate: false };
}

// ─── START COUNTDOWN ─────────────────────────────────────────────────────────
async function startCountdown(pkMatchId, requesterId) {
  const lockKey = KEYS.lock(`start:${pkMatchId}`);
  if (!(await acquireLock(lockKey))) throw new Error('PK start already in progress');

  try {
    const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
    if (!match) throw new Error('PK match not found');
    assertValidTransition(match.state, 'COUNTDOWN');

    // Verify requester is a participant
    const participant = await prisma.pKParticipant.findUnique({
      where: { pkMatchId_userId: { pkMatchId, userId: requesterId } }
    });
    if (!participant) throw new Error('You are not a participant in this PK');

    await prisma.pKMatch.update({
      where: { id: pkMatchId },
      data:  { state: 'COUNTDOWN', updatedAt: new Date() }
    });

    await invalidateMatchState(pkMatchId);

    const config = await getConfig();
    emitPK(pkMatchId, 'pk:countdown', {
      pkMatchId,
      seconds: config.countdownSeconds,
      startAt: Date.now() + config.countdownSeconds * 1000,
    });

    // Auto-advance to LIVE after countdown
    const countdownMs = (config.countdownSeconds || 5) * 1000;
    setTimeout(() => startLive(pkMatchId, requesterId).catch(() => {}), countdownMs);

    return { pkMatchId, state: 'COUNTDOWN' };
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── START LIVE ───────────────────────────────────────────────────────────────
async function startLive(pkMatchId, requesterId) {
  const lockKey = KEYS.lock(`live:${pkMatchId}`);
  if (!(await acquireLock(lockKey, 15))) throw new Error('PK live start already in progress');

  try {
    const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
    if (!match) throw new Error('PK match not found');
    if (match.state === 'LIVE') return { pkMatchId, state: 'LIVE' }; // already live
    assertValidTransition(match.state, 'LIVE');

    const now = new Date();
    await prisma.pKMatch.update({
      where: { id: pkMatchId },
      data:  { state: 'LIVE', startedAt: now, updatedAt: now }
    });

    await invalidateMatchState(pkMatchId);
    const config = await getConfig();

    const timerState = await setTimerState(pkMatchId, {
      startedAt:       now.toISOString(),
      durationSeconds: match.durationSeconds,
      pausedDuration:  0,
    });

    emitPK(pkMatchId, 'pk:started', {
      pkMatchId,
      state:           'LIVE',
      startedAt:       now.toISOString(),
      durationSeconds: match.durationSeconds,
      remainingSeconds: match.durationSeconds,
    });

    recordAnalyticsEvent('PK_STARTED', pkMatchId, requesterId);

    // Broadcast pk:room:started to each linked Voice Club room so the
    // VoiceRoomPKBanner appears automatically for all room participants.
    if (match.roomIdA || match.roomIdB) {
      const io = getIo();
      if (io) {
        // Fetch participants to include in the banner payload
        const participants = await prisma.pKParticipant.findMany({
          where:   { pkMatchId },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        });
        const bannerPayload = {
          pkMatchId,
          durationSeconds: match.durationSeconds,
          participants: participants.map(p => ({
            userId: p.userId,
            side:   p.side,
            user:   { firstName: p.user.firstName, lastName: p.user.lastName, avatarUrl: p.user.avatarUrl }
          }))
        };
        if (match.roomIdA) io.to(`voice:${match.roomIdA}`).emit('pk:room:started', bannerPayload);
        if (match.roomIdB && match.roomIdB !== match.roomIdA) {
          io.to(`voice:${match.roomIdB}`).emit('pk:room:started', bannerPayload);
        }
      }
    }

    // Schedule automatic end
    const durationMs = match.durationSeconds * 1000;
    setTimeout(() => finishPK(pkMatchId).catch(() => {}), durationMs);

    return { pkMatchId, state: 'LIVE', timerState };
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── PAUSE / RESUME ───────────────────────────────────────────────────────────
async function pausePK(pkMatchId, adminId) {
  const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
  if (!match) throw new Error('PK match not found');
  assertValidTransition(match.state, 'PAUSED');

  const now = new Date();
  await prisma.pKMatch.update({
    where: { id: pkMatchId },
    data:  { state: 'PAUSED', pausedAt: now, updatedAt: now }
  });

  // Update timer state
  const timer = await getTimerState(pkMatchId);
  if (timer) {
    await setTimerState(pkMatchId, { ...timer, pausedAt: now.toISOString() });
  }

  await invalidateMatchState(pkMatchId);
  emitPK(pkMatchId, 'pk:paused', { pkMatchId, pausedAt: now.toISOString() });

  await prisma.pKAuditLog.create({
    data: { id: uuidv4(), pkMatchId, adminId, action: 'PAUSE' }
  });
}

async function resumePK(pkMatchId, adminId) {
  const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
  if (!match) throw new Error('PK match not found');
  assertValidTransition(match.state, 'LIVE');

  const now       = new Date();
  const timer     = await getTimerState(pkMatchId);
  let pausedDuration = match.pausedDuration || 0;

  if (timer?.pausedAt) {
    const pausedMs = now.getTime() - new Date(timer.pausedAt).getTime();
    pausedDuration += Math.floor(pausedMs / 1000);
  }

  await prisma.pKMatch.update({
    where: { id: pkMatchId },
    data:  { state: 'LIVE', pausedAt: null, pausedDuration, updatedAt: now }
  });

  if (timer) {
    await setTimerState(pkMatchId, { ...timer, pausedAt: null, pausedDuration });
  }

  await invalidateMatchState(pkMatchId);
  const remaining = timer ? getRemainingSeconds({ ...timer, pausedAt: null, pausedDuration }) : 0;
  emitPK(pkMatchId, 'pk:resumed', { pkMatchId, remainingSeconds: remaining });

  await prisma.pKAuditLog.create({
    data: { id: uuidv4(), pkMatchId, adminId, action: 'RESUME' }
  });
}

// ─── FINISH PK ────────────────────────────────────────────────────────────────
/**
 * Transitions LIVE → FINISHING → COMPLETED.
 * Calculates final scores, determines winner, persists history, updates stats.
 * Protected by distributed lock to prevent double-execution.
 */
async function finishPK(pkMatchId, options = {}) {
  const lockKey = KEYS.lock(`finish:${pkMatchId}`);
  if (!(await acquireLock(lockKey, 30))) {
    logger.warn(`[pk] finishPK lock not acquired for ${pkMatchId} — already processing`);
    return null;
  }

  try {
    const match = await prisma.pKMatch.findUnique({
      where:   { id: pkMatchId },
      include: { participants: true, gifts: true, votes: true, teams: true }
    });
    if (!match) throw new Error('PK match not found');
    if (match.state === 'COMPLETED' || match.state === 'ABORTED') return match;
    if (match.state === 'LIVE' || match.state === 'FINISHING') {
      // Allow finish from LIVE (timer expired) or FINISHING (admin-triggered)
    } else {
      throw new Error(`Cannot finish PK in state ${match.state}`);
    }

    // Move to FINISHING to prevent further scoring
    await prisma.pKMatch.update({ where: { id: pkMatchId }, data: { state: 'FINISHING' } });

    // Aggregate scores from PKGiftEvent records
    const giftEvents = await prisma.pKGiftEvent.findMany({ where: { pkMatchId } });
    let giftScoreA = 0, giftScoreB = 0, bonusA = 0, bonusB = 0;
    for (const ge of giftEvents) {
      if (ge.side === 'A') { giftScoreA += ge.giftScore; bonusA += ge.bonusScore; }
      else                 { giftScoreB += ge.giftScore; bonusB += ge.bonusScore; }
    }

    // Vote scores
    const config         = await getConfig();
    const voteScoreA     = match.voteScoreA || 0;
    const voteScoreB     = match.voteScoreB || 0;
    const voteWeightedA  = Math.floor(voteScoreA * config.audienceVoteWeight);
    const voteWeightedB  = Math.floor(voteScoreB * config.audienceVoteWeight);

    const finalScoreA = giftScoreA + bonusA + voteWeightedA;
    const finalScoreB = giftScoreB + bonusB + voteWeightedB;

    // Determine winner
    let winnerId = null, winnerSide = 'DRAW';
    const sideA = match.participants.find(p => p.side === 'A');
    const sideB = match.participants.find(p => p.side === 'B');

    if (finalScoreA > finalScoreB) {
      winnerSide = 'A';
      winnerId   = sideA?.userId || null;
    } else if (finalScoreB > finalScoreA) {
      winnerSide = 'B';
      winnerId   = sideB?.userId || null;
    }

    const now = new Date();

    // Persist result in a transaction
    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.pKMatch.update({
        where: { id: pkMatchId },
        data:  {
          state:       'COMPLETED',
          endedAt:     now,
          scoreA:      finalScoreA,
          scoreB:      finalScoreB,
          giftScoreA,
          giftScoreB,
          bonusScoreA: bonusA,
          bonusScoreB: bonusB,
          voteScoreA,
          voteScoreB,
          winnerId,
          winnerSide,
          endedByAdmin: options.endedByAdmin || false,
          updatedAt:   now,
        }
      });

      // Create immutable history
      await tx.pKHistory.create({
        data: {
          id:             uuidv4(),
          pkMatchId,
          type:           match.type,
          winnerId,
          winnerSide,
          loserSide:      winnerSide === 'A' ? 'B' : winnerSide === 'B' ? 'A' : null,
          scoreA:         finalScoreA,
          scoreB:         finalScoreB,
          giftScoreA,
          giftScoreB,
          voteScoreA,
          voteScoreB,
          peakComboA:     match.peakComboA,
          peakComboB:     match.peakComboB,
          peakViewers:    match.peakViewers,
          durationSeconds: match.durationSeconds,
          seasonId:       match.seasonId,
          tournamentId:   match.tournamentId,
          participantIds: match.participants.map(p => p.userId),
          sideAIds:       match.participants.filter(p => p.side === 'A').map(p => p.userId),
          sideBIds:       match.participants.filter(p => p.side === 'B').map(p => p.userId),
          totalGifts:     giftEvents.length,
          totalCoins:     giftEvents.reduce((s, g) => s + g.coinsSpent, 0),
        }
      });

      return m;
    });

    await invalidateMatchState(pkMatchId);

    // Update user stats (non-fatal)
    updateUserStats(pkMatchId, { winnerId, winnerSide, sideAUserId: sideA?.userId, sideBUserId: sideB?.userId, scoreA: finalScoreA, scoreB: finalScoreB }).catch(() => {});

    // Notify participants
    if (sideA) notifyPKResult(sideA.userId, updated).catch(() => {});
    if (sideB) notifyPKResult(sideB.userId, updated).catch(() => {});

    emitPK(pkMatchId, 'pk:ended', {
      pkMatchId,
      state:      'COMPLETED',
      scoreA:     finalScoreA,
      scoreB:     finalScoreB,
      winnerId,
      winnerSide,
    });

    emitPK(pkMatchId, 'pk:winner', { pkMatchId, winnerId, winnerSide, scoreA: finalScoreA, scoreB: finalScoreB });

    recordAnalyticsEvent('PK_ENDED', pkMatchId, null, { winnerSide, scoreA: finalScoreA, scoreB: finalScoreB });

    // Broadcast pk:room:ended to linked Voice Club rooms so the banner can dismiss
    const io = getIo();
    if (io && (updated.roomIdA || updated.roomIdB)) {
      const endedPayload = { pkMatchId, winnerId, winnerSide };
      if (updated.roomIdA) io.to(`voice:${updated.roomIdA}`).emit('pk:room:ended', endedPayload);
      if (updated.roomIdB && updated.roomIdB !== updated.roomIdA) {
        io.to(`voice:${updated.roomIdB}`).emit('pk:room:ended', endedPayload);
      }
    }

    // Check achievements (non-fatal)
    if (sideA) checkAchievements(sideA.userId, pkMatchId).catch(() => {});
    if (sideB) checkAchievements(sideB.userId, pkMatchId).catch(() => {});

    return updated;
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── ABORT PK ─────────────────────────────────────────────────────────────────
async function abortPK(pkMatchId, adminId, reason) {
  const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
  if (!match) throw new Error('PK match not found');
  if (['COMPLETED', 'ABORTED', 'CANCELLED'].includes(match.state)) return match;

  const now = new Date();
  await prisma.pKMatch.update({
    where: { id: pkMatchId },
    data:  { state: 'ABORTED', endedAt: now, endedByAdmin: true, adminNote: reason, updatedAt: now }
  });

  await invalidateMatchState(pkMatchId);

  await prisma.pKAuditLog.create({
    data: { id: uuidv4(), pkMatchId, adminId, action: 'ABORT', reason }
  });

  emitPK(pkMatchId, 'pk:ended', { pkMatchId, state: 'ABORTED', reason });
  recordAnalyticsEvent('PK_ENDED', pkMatchId, adminId, { state: 'ABORTED', reason });

  // Broadcast to linked Voice Club rooms
  const abortedMatch = await prisma.pKMatch.findUnique({
    where:  { id: pkMatchId },
    select: { roomIdA: true, roomIdB: true }
  }).catch(() => null);
  const io = getIo();
  if (io && abortedMatch) {
    const endedPayload = { pkMatchId, winnerId: null, winnerSide: null };
    if (abortedMatch.roomIdA) io.to(`voice:${abortedMatch.roomIdA}`).emit('pk:room:ended', endedPayload);
    if (abortedMatch.roomIdB && abortedMatch.roomIdB !== abortedMatch.roomIdA) {
      io.to(`voice:${abortedMatch.roomIdB}`).emit('pk:room:ended', endedPayload);
    }
  }
}

// ─── PROCESS GIFT EVENT ───────────────────────────────────────────────────────
/**
 * Called AFTER the gift engine has verified and committed a GiftTransaction.
 * Creates a PKGiftEvent record and updates live scores.
 *
 * THIS IS THE ONLY WAY a gift counts in PK scoring.
 * The gift engine (gift.controller.js) remains the financial source of truth.
 *
 * @param {string}  pkMatchId
 * @param {object}  giftTx     - verified GiftTransaction from DB
 * @param {string}  side       - 'A' | 'B'
 * @param {string}  beneficiaryId - userId receiving score credit
 */
async function processPKGift(pkMatchId, giftTx, side, beneficiaryId) {
  const lockKey = KEYS.lock(`gift:${giftTx.id}`);
  if (!(await acquireLock(lockKey, 5))) {
    logger.warn(`[pk] gift already processing: ${giftTx.id}`);
    return null;
  }

  try {
    // Idempotency — unique constraint on giftTransactionId prevents double-count
    const existing = await prisma.pKGiftEvent.findUnique({
      where: { giftTransactionId: giftTx.id }
    });
    if (existing) return existing;

    const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
    if (!match || match.state !== 'LIVE') return null; // Only count gifts during LIVE state

    const config      = await getConfig();
    const giftScore   = giftTx.coinsSpent;

    // Combo calculation
    const comboKey    = side === 'A' ? KEYS.comboA(pkMatchId) : KEYS.comboB(pkMatchId);
    const winKey      = side === 'A' ? KEYS.comboWindowA(pkMatchId) : KEYS.comboWindowB(pkMatchId);
    let   comboLevel  = 0;
    let   comboMult   = 1.0;

    if (isRedisReady()) {
      try {
        const redis     = getRedis();
        const comboCount = await redis.incr(comboKey);
        await redis.expire(comboKey, COMBO_TTL);

        const thresholds = config.comboThresholds || [5, 10, 20, 50, 100];
        for (let i = thresholds.length - 1; i >= 0; i--) {
          if (comboCount >= thresholds[i]) {
            comboLevel = i + 1;
            comboMult  = 1 + (comboLevel * 0.2); // 1.2x, 1.4x, 1.6x, 1.8x, 2.0x
            break;
          }
        }
      } catch {}
    }

    // Comeback bonus
    let isComebackBonus = false;
    const trailingThreshold = config.comebackThresholdPercent / 100;
    const leadScore  = side === 'A' ? match.scoreB : match.scoreA;
    const ownScore   = side === 'A' ? match.scoreA : match.scoreB;
    const total      = leadScore + ownScore;

    if (total > 0 && ownScore < leadScore) {
      const gap = (leadScore - ownScore) / leadScore;
      if (gap >= trailingThreshold) {
        isComebackBonus = true;
        comboMult = Math.max(comboMult, config.comebackMultiplier);
      }
    }

    const bonusScore = Math.floor(giftScore * (comboMult - 1));
    const finalScore = giftScore + bonusScore;

    // Persist PKGiftEvent
    const pkGiftEvent = await prisma.pKGiftEvent.create({
      data: {
        id:                uuidv4(),
        pkMatchId,
        giftTransactionId: giftTx.id,
        side,
        beneficiaryId,
        coinsSpent:        giftTx.coinsSpent,
        giftScore,
        comboMultiplier:   comboMult,
        comboLevel,
        isComebackBonus,
        bonusScore,
        finalScore,
      }
    });

    // Update match scores atomically
    const scoreIncA = side === 'A' ? finalScore : 0;
    const scoreIncB = side === 'B' ? finalScore : 0;
    const giftIncA  = side === 'A' ? giftScore  : 0;
    const giftIncB  = side === 'B' ? giftScore  : 0;
    const bonusIncA = side === 'A' ? bonusScore : 0;
    const bonusIncB = side === 'B' ? bonusScore : 0;
    const comboUpdA = side === 'A' && comboLevel > (match.peakComboA || 0) ? comboLevel : undefined;
    const comboUpdB = side === 'B' && comboLevel > (match.peakComboB || 0) ? comboLevel : undefined;

    await prisma.pKMatch.update({
      where: { id: pkMatchId },
      data: {
        scoreA:     { increment: scoreIncA },
        scoreB:     { increment: scoreIncB },
        giftScoreA: { increment: giftIncA },
        giftScoreB: { increment: giftIncB },
        bonusScoreA: { increment: bonusIncA },
        bonusScoreB: { increment: bonusIncB },
        ...(comboUpdA !== undefined && { peakComboA: comboUpdA }),
        ...(comboUpdB !== undefined && { peakComboB: comboUpdB }),
      }
    });

    await invalidateMatchState(pkMatchId);

    // Reload updated scores for broadcast
    const updated = await prisma.pKMatch.findUnique({
      where:  { id: pkMatchId },
      select: { scoreA: true, scoreB: true, giftScoreA: true, giftScoreB: true }
    });

    // Emit realtime events
    emitPK(pkMatchId, 'pk:score', {
      pkMatchId, side,
      scoreA: updated.scoreA, scoreB: updated.scoreB,
      giftScoreA: updated.giftScoreA, giftScoreB: updated.giftScoreB,
    });

    emitPK(pkMatchId, 'pk:gift', {
      pkMatchId, side, beneficiaryId,
      giftScore, bonusScore, finalScore, comboLevel, isComebackBonus,
      giftTransactionId: giftTx.id,
    });

    if (comboLevel > 0) {
      emitPK(pkMatchId, 'pk:combo', { pkMatchId, side, comboLevel, comboMult });
    }

    if (isComebackBonus) {
      emitPK(pkMatchId, 'pk:comeback', { pkMatchId, side, comboMult });
    }

    // Leader change detection
    const prevLeader = match.scoreA >= match.scoreB ? 'A' : 'B';
    const newLeader  = updated.scoreA >= updated.scoreB ? 'A' : 'B';
    if (prevLeader !== newLeader) {
      emitPK(pkMatchId, 'pk:leader-change', { pkMatchId, newLeader });
    }

    // Final-30-seconds warning
    const timer = await getTimerState(pkMatchId);
    if (timer) {
      const remaining = getRemainingSeconds(timer);
      if (remaining <= 30 && remaining > 27) { // emit once in final 30s window
        emitPK(pkMatchId, 'pk:timer', { pkMatchId, remainingSeconds: remaining, finalRound: true });
      }
    }

    recordAnalyticsEvent('PK_GIFT', pkMatchId, beneficiaryId, { side, giftScore, comboLevel });

    return pkGiftEvent;
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── AUDIENCE VOTE ────────────────────────────────────────────────────────────
async function castVote(pkMatchId, userId, side) {
  const match = await prisma.pKMatch.findUnique({ where: { id: pkMatchId } });
  if (!match || match.state !== 'LIVE') throw new Error('PK not live');
  if (!['A', 'B'].includes(side)) throw new Error('Invalid side');

  // Prevent participants from voting for their own match
  const participant = await prisma.pKParticipant.findUnique({
    where: { pkMatchId_userId: { pkMatchId, userId } }
  });
  if (participant) throw new Error('Participants cannot vote');

  // Upsert — one vote per user per match
  await prisma.pKVote.upsert({
    where:  { pkMatchId_userId: { pkMatchId, userId } },
    create: { id: uuidv4(), pkMatchId, userId, side },
    update: { side }
  });

  // Increment vote score on match
  const incA = side === 'A' ? 1 : 0;
  const incB = side === 'B' ? 1 : 0;
  const updated = await prisma.pKMatch.update({
    where: { id: pkMatchId },
    data:  { voteScoreA: { increment: incA }, voteScoreB: { increment: incB } }
  });

  await invalidateMatchState(pkMatchId);
  emitPK(pkMatchId, 'pk:vote', {
    pkMatchId, side,
    voteScoreA: updated.voteScoreA,
    voteScoreB: updated.voteScoreB,
  });

  recordAnalyticsEvent('PK_VOTE', pkMatchId, userId, { side });
}

// ─── USER STATS UPDATE ────────────────────────────────────────────────────────
async function updateUserStats(pkMatchId, { winnerId, winnerSide, sideAUserId, sideBUserId, scoreA, scoreB }) {
  const updates = [];
  const config  = await getConfig();

  for (const { userId, side, score, oppScore } of [
    { userId: sideAUserId, side: 'A', score: scoreA, oppScore: scoreB },
    { userId: sideBUserId, side: 'B', score: scoreB, oppScore: scoreA },
  ]) {
    if (!userId) continue;
    const isWin  = winnerSide === side;
    const isDraw = winnerSide === 'DRAW';
    const isLoss = !isWin && !isDraw;

    updates.push(
      prisma.pKUserStats.upsert({
        where:  { userId },
        create: {
          id: uuidv4(), userId,
          totalPKs: 1,
          wins:   isWin  ? 1 : 0,
          losses: isLoss ? 1 : 0,
          draws:  isDraw ? 1 : 0,
          winRate: isWin ? 1.0 : 0.0,
          currentStreak: isWin ? 1 : isLoss ? -1 : 0,
          bestStreak:    isWin ? 1 : 0,
          totalScore:    score,
          highestScore:  score,
        },
        update: {
          totalPKs:  { increment: 1 },
          wins:      { increment: isWin  ? 1 : 0 },
          losses:    { increment: isLoss ? 1 : 0 },
          draws:     { increment: isDraw ? 1 : 0 },
          totalScore: { increment: score },
          seasonWins: { increment: isWin  ? 1 : 0 },
          seasonLosses: { increment: isLoss ? 1 : 0 },
        }
      })
    );
  }

  await Promise.allSettled(updates);
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function notifyPKResult(userId, match) {
  const side      = match.participants?.find(p => p.userId === userId)?.side;
  const isWinner  = match.winnerId === userId;
  const isDraw    = match.winnerSide === 'DRAW';
  const title     = isWinner ? '🏆 You won the PK!' : isDraw ? '🤝 PK ended in a draw!' : '😅 PK ended';
  const myScore   = side === 'A' ? match.scoreA : match.scoreB;
  const oppScore  = side === 'A' ? match.scoreB : match.scoreA;

  await notify(userId, {
    type:  'PK_RESULT',
    title,
    body:  `Final score: ${myScore} vs ${oppScore}`,
    data:  { pkMatchId: match.id, myScore, oppScore, winnerSide: match.winnerSide },
    channels: ['push']
  });
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────────────────────
async function checkAchievements(userId, pkMatchId) {
  const stats = await prisma.pKUserStats.findUnique({ where: { userId } });
  if (!stats) return;

  const achievements = await prisma.pKAchievement.findMany({ where: { isActive: true } });
  for (const ach of achievements) {
    const already = await prisma.pKUserAchievement.findUnique({
      where: { userId_achievementId: { userId, achievementId: ach.id } }
    });
    if (already) continue;

    if (await evaluateAchievementCondition(ach.condition, stats, pkMatchId)) {
      await prisma.pKUserAchievement.create({
        data: { id: uuidv4(), userId, achievementId: ach.id, pkMatchId }
      });
      await notify(userId, {
        type: 'PK_ACHIEVEMENT', title: `🏅 Achievement Unlocked!`,
        body: ach.name, data: { achievementId: ach.id }, channels: ['push']
      });
      emitPKUser(userId, 'pk:achievement', { userId, achievementKey: ach.key, name: ach.name });
    }
  }
}

async function evaluateAchievementCondition(condition, stats) {
  if (!condition || !condition.type) return false;
  switch (condition.type) {
    case 'wins_gte':     return stats.wins     >= condition.value;
    case 'streak_gte':   return stats.bestStreak >= condition.value;
    case 'pks_gte':      return stats.totalPKs >= condition.value;
    case 'score_gte':    return stats.highestScore >= condition.value;
    default:             return false;
  }
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
function recordAnalyticsEvent(eventType, pkMatchId, userId, data = {}) {
  prisma.pKAnalyticsEvent.create({
    data: { id: uuidv4(), eventType, pkMatchId, userId, data }
  }).catch(() => {});
}

// ─── RECONNECT RECOVERY ───────────────────────────────────────────────────────
/**
 * Called when a participant reconnects mid-PK.
 * Returns the complete authoritative state so the client can re-sync.
 */
async function getReconnectState(pkMatchId, userId) {
  const match = await prisma.pKMatch.findUnique({
    where:   { id: pkMatchId },
    include: {
      participants: { select: { userId: true, side: true, role: true, isActive: true } },
      teams:        true,
    }
  });
  if (!match) return null;

  const timer     = await getTimerState(pkMatchId);
  const remaining = timer ? getRemainingSeconds(timer) : 0;

  // Mark reconnect
  await prisma.pKParticipant.updateMany({
    where: { pkMatchId, userId },
    data:  { reconnectedAt: new Date(), isActive: true }
  });

  return {
    pkMatchId,
    state:           match.state,
    scoreA:          match.scoreA,
    scoreB:          match.scoreB,
    voteScoreA:      match.voteScoreA,
    voteScoreB:      match.voteScoreB,
    remainingSeconds: remaining,
    startedAt:       match.startedAt,
    durationSeconds: match.durationSeconds,
    participants:    match.participants,
    yourSide:        match.participants.find(p => p.userId === userId)?.side,
    winnerId:        match.winnerId,
    winnerSide:      match.winnerSide,
  };
}

// ─── ELO RATING UPDATE ────────────────────────────────────────────────────────
const ELO_K = 32;

async function updateEloRatings(sideAUserId, sideBUserId, winnerSide) {
  try {
    const [statsA, statsB] = await Promise.all([
      prisma.pKUserStats.upsert({ where: { userId: sideAUserId }, create: { id: uuidv4(), userId: sideAUserId }, update: {} }),
      prisma.pKUserStats.upsert({ where: { userId: sideBUserId }, create: { id: uuidv4(), userId: sideBUserId }, update: {} }),
    ]);

    const rA = statsA.rating || 1000;
    const rB = statsB.rating || 1000;
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const eB = 1 - eA;
    const sA = winnerSide === 'A' ? 1 : winnerSide === 'DRAW' ? 0.5 : 0;
    const sB = 1 - sA;
    const newRA = Math.round(rA + ELO_K * (sA - eA));
    const newRB = Math.round(rB + ELO_K * (sB - eB));

    await Promise.all([
      prisma.pKUserStats.update({
        where: { userId: sideAUserId },
        data:  { rating: newRA, peakRating: Math.max(newRA, rA) }
      }),
      prisma.pKUserStats.update({
        where: { userId: sideBUserId },
        data:  { rating: newRB, peakRating: Math.max(newRB, rB) }
      }),
    ]);
  } catch (err) {
    logger.error(`[pk] ELO update failed: ${err.message}`);
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  // State machine
  assertValidTransition,
  createMatch,
  startCountdown,
  startLive,
  pausePK,
  resumePK,
  finishPK,
  abortPK,
  // Scoring
  processPKGift,
  castVote,
  // Stats
  updateUserStats,
  updateEloRatings,
  // Recovery
  getReconnectState,
  // Helpers
  getMatchState,
  getTimerState,
  getRemainingSeconds,
  getConfig,
  clearConfigCache,
  // Emit helpers (for socket layer)
  emitPK,
  emitPKUser,
  // Analytics
  recordAnalyticsEvent,
};
