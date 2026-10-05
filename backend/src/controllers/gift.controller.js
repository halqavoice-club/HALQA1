/**
 * Gift Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the full virtual gift flow:
 *   1. Validate room, sender balance, receiver eligibility
 *   2. Atomic DB transaction: deduct coins → credit diamonds → record ledger
 *   3. Update room leaderboard
 *   4. Emit real-time WebSocket event to room
 *
 * Economy:
 *   100 coins = $1
 *   Platform cut = 50%
 *   1 coin sent → 0.5 diamonds earned (integer floor)
 *   Example: 20-coin gift → sender loses 20 coins, receiver gains 10 diamonds
 *
 * Anti-abuse:
 *   - Idempotency key prevents duplicate sends
 *   - Rate limit: 10 gifts/10s per user (via rateLimiter middleware)
 *   - Daily spend cap: 50,000 coins (configurable via GIFT_DAILY_CAP env)
 */

const { v4: uuidv4 } = require('uuid');
const prisma  = require('../utils/prisma');
const { getIo } = require('../sockets');
const { getCache, setCache } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { resolveRoom, resolveParticipant, resolveActiveRecipients } = require('../utils/roomResolver');
const logger = require('../utils/logger');
const { toDiamonds } = require('../services/economy.config');
const { writePlatformRevenueFromSpend } = require('../utils/platformRevenue');

// Safe cache wrappers — a cache failure must never abort a gift transaction.
// The daily spend cap and combo counter are best-effort; the DB transaction
// is the authoritative record.
async function safeGetCache(key) {
  try { return await getCache(key); }
  catch (err) { logger.error(`[gift] Cache GET failed for "${key}": ${err.message}`); return null; }
}
async function safeSetCache(key, value, ttl) {
  try { await setCache(key, value, ttl); }
  catch (err) { logger.error(`[gift] Cache SET failed for "${key}": ${err.message}`); }
}

// ─── Constants ────────────────────────────────────────────────────────────────
// PLATFORM_CUT and toDiamonds are imported from economy.config.js (single source of truth)
const DAILY_CAP      = parseInt(process.env.GIFT_DAILY_CAP || '50000', 10);
const COMBO_WINDOW   = 5000;  // ms — rapid sends within this window count as combo

// Priority tiers — controls frontend animation interruption
const PRIORITY = {
  NORMAL: 'normal',
  HIGH:   'high',   // Lion, Horse
  ULTRA:  'ultra',  // Burj Khalifa
};

// Animation durations by priority (ms) — frontend uses these to hold the stage
const PRIORITY_HOLD_MS = {
  normal: 0,
  high:   10000,  // Lion = 10s cinematic
  ultra:  8000,   // Burj Khalifa = 8s cinematic
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Redis key for daily spend tracking */
const dailySpendKey = (userId) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `gift:daily:${userId}:${today}`;
};

/** Redis key for combo tracking */
const comboKey = (userId, receiverId, giftId) =>
  `gift:combo:${userId}:${receiverId}:${giftId}`;

// ─── GET /gifts ───────────────────────────────────────────────────────────────
async function listGifts(req, res) {
  try {
    const gifts = await prisma.gift.findMany({
      where:   { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });
    return successResponse(res, gifts);
  } catch (err) {
    // Detect schema-out-of-sync (column not found) and give a clear message
    if (err.message?.includes('Unknown column') || err.message?.includes('does not exist') || err.code === 'P2022') {
      return errorResponse(res, 'Database schema is out of sync. Run: npx prisma migrate deploy && npx prisma generate, then restart the server.', 503);
    }
    return errorResponse(res, err.message, 500);
  }
}

// ─── POST /voice/:id/gifts ────────────────────────────────────────────────────
/**
 * Send a gift inside a voice room.
 * Body: { giftId, receiverId, count?, idempotencyKey }
 */
async function sendGift(req, res) {
  try {
    // SUPER_ADMIN isolation (Task 10.1): platform admin cannot send gifts
    if (req.user.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'SUPER_ADMIN cannot send gifts in platform rooms', 403);
    }
    // roomType is injected by the route middleware; defaults to 'voice' for backward compat
    const roomType = req.roomType || 'voice';
    const roomId   = req.params.id;
    const senderId = req.user.id;
    const { giftId, receiverId, count = 1, idempotencyKey } = req.body;

    // ── Basic validation ──────────────────────────────────────────────────
    if (!giftId)      return errorResponse(res, 'giftId is required', 400);
    if (!receiverId)  return errorResponse(res, 'receiverId is required', 400);
    if (senderId === receiverId) return errorResponse(res, 'Cannot gift yourself', 400);

    const giftCount = Math.max(1, Math.min(parseInt(count) || 1, 100));

    // ── Idempotency check ─────────────────────────────────────────────────
    const iKey = idempotencyKey || uuidv4();
    const existing = await prisma.giftTransaction.findUnique({ where: { idempotencyKey: iKey } });
    if (existing) {
      return successResponse(res, { transaction: existing, duplicate: true }, 'Gift already processed');
    }

    // ── Load room via resolver ─────────────────────────────────────────────
    const room = await resolveRoom(roomType, roomId);
    if (!room)                   return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'Room has ended', 400);
    if (room.status === 'CANCELLED') return errorResponse(res, 'Room was cancelled', 400);

    // ── Sender must be active participant ─────────────────────────────────
    const senderParticipant = await resolveParticipant(roomType, roomId, senderId);
    if (!senderParticipant?.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }

    // ── Receiver must be active participant ───────────────────────────────
    const receiverParticipant = await resolveParticipant(roomType, roomId, receiverId);
    if (!receiverParticipant?.isActive) {
      return errorResponse(res, 'Receiver is not in this room', 404);
    }

    // For voice rooms: restrict to HOST/SPEAKER/MODERATOR
    if (roomType === 'voice' && !['HOST', 'SPEAKER', 'MODERATOR'].includes(receiverParticipant.role)) {
      return errorResponse(res, 'Gifts can only be sent to hosts and speakers', 400);
    }

    // ── Load gift ─────────────────────────────────────────────────────────
    const gift = await prisma.gift.findUnique({ where: { id: giftId } });
    if (!gift || !gift.isActive) return errorResponse(res, 'Gift not found', 404);

    const totalCoins    = gift.priceCoins * giftCount;
    const totalDiamonds = toDiamonds(totalCoins);

    // ── Daily spend cap — DB-authoritative with Redis fast-path cache ─────
    // P1-002 FIX: The authoritative cap enforcement has been moved INSIDE the
    // $transaction (see step 4d below) so the check-and-increment are atomic.
    //
    // Redis is used here as a read-only fast path to provide an early 429 before
    // entering the heavier transaction. Redis unavailability is acceptable —
    // the DB-level enforcement inside the transaction is the real gate.
    // A stale Redis read at most allows entering the transaction unnecessarily;
    // the DB check inside the transaction prevents any actual cap violation.
    const rawSpent = await safeGetCache(dailySpendKey(senderId));
    if (rawSpent !== null && rawSpent !== undefined) {
      const cachedSpent = typeof rawSpent === 'number' ? rawSpent : parseInt(rawSpent, 10);
      if (cachedSpent + totalCoins > DAILY_CAP) {
        return errorResponse(res, `Daily spending limit of ${DAILY_CAP} coins reached`, 429);
      }
    }

    // ── Atomic transaction ────────────────────────────────────────────────
    let senderWallet, transaction;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Ensure sender wallet exists and check balance
        const sw = await tx.wallet.upsert({
          where:  { userId: senderId },
          create: { userId: senderId, coins: 0, diamonds: 0, totalSpent: 0, totalEarned: 0 },
          update: {}
        });

        if (sw.coins < totalCoins) {
          throw new Error(`INSUFFICIENT_COINS:${sw.coins}:${totalCoins}`);
        }

        // 2. Deduct coins from sender — optimistic lock prevents race conditions:
        // WHERE coins >= totalCoins means if a concurrent tx already deducted coins,
        // this update affects 0 rows, Prisma throws RecordNotFound, and the tx rolls back.
        const updatedSender = await tx.wallet.update({
          where: { userId: senderId, coins: { gte: totalCoins } },
          data:  {
            coins:      { decrement: totalCoins },
            totalSpent: { increment: totalCoins }
          }
        });

        // 3. Credit diamonds to receiver
        await tx.wallet.upsert({
          where:  { userId: receiverId },
          create: { userId: receiverId, coins: 0, diamonds: totalDiamonds, totalSpent: 0, totalEarned: totalDiamonds },
          update: {
            diamonds:    { increment: totalDiamonds },
            totalEarned: { increment: totalDiamonds }
          }
        });

        // 4. Record gift transaction
        const txn = await tx.giftTransaction.create({
          data: {
            roomId,
            roomType,
            senderId,
            receiverId,
            giftId,
            count:          giftCount,
            combo:          1,
            priority:       gift.priority || 'normal',
            isPremium:      gift.isPremium || false,
            coinsSpent:     totalCoins,
            diamondsEarned: totalDiamonds,
            idempotencyKey: iKey
          }
        });

        // 4b. Write sender wallet ledger entry — FATAL (no .catch)
        await tx.walletTransaction.create({
          data: {
            userId:      senderId,
            type:        'GIFT_SEND',
            coins:       -totalCoins,  // negative = debit
            description: `Sent ${giftCount}x ${gift.name} to room ${roomId}`,
            giftTxId:    txn.id
          }
        });

        // 4b2. P2-003: Write receiver diamond credit ledger entry — FATAL (no .catch)
        // Completes the diamond ledger: sender debit (GIFT_SEND) + receiver credit (GIFT_RECEIVE).
        // Only written if receiver actually earns diamonds (odd-coin edge case: toDiamonds(1)=0).
        if (totalDiamonds > 0) {
          await tx.walletTransaction.create({
            data: {
              userId:      receiverId,
              type:        'GIFT_RECEIVE',
              coins:       0,
              diamonds:    totalDiamonds,  // positive = credit
              description: `Received ${giftCount}x ${gift.name} in room ${roomId}`,
              giftTxId:    txn.id
            }
          });
        }

        // 4c. Write platform revenue entry — FATAL (no .catch)
        await writePlatformRevenueFromSpend(tx, {
          sourceType: 'GIFT',
          sourceId:   txn.id,
          userId:     senderId,
          spendCoins: totalCoins,
        });

        // 4d. P1-002: Atomic daily cap enforcement in DB — FATAL (no .catch)
        // UserDailyGiftSpend is upserted inside this transaction so the cap check
        // and totalSpent increment are committed atomically with the wallet debit.
        // This prevents concurrent requests from bypassing the cap via race conditions.
        const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
        const dailySpend = await tx.userDailyGiftSpend.upsert({
          where:  { userId_date: { userId: senderId, date: today } },
          create: { id: require('uuid').v4(), userId: senderId, date: today, totalSpent: totalCoins },
          update: { totalSpent: { increment: totalCoins } }
        });
        // Check cap AFTER increment — reject if exceeded
        if (dailySpend.totalSpent > DAILY_CAP) {
          throw new Error(`DAILY_CAP_EXCEEDED:${dailySpend.totalSpent - totalCoins}:${totalCoins}`);
        }

        // 5. Upsert room leaderboard
        await tx.roomGiftLeaderboard.upsert({
          where:  { roomId_userId: { roomId, userId: senderId } },
          create: { roomId, roomType, userId: senderId, totalCoins, giftCount: giftCount, updatedAt: new Date() },
          update: {
            totalCoins: { increment: totalCoins },
            giftCount:  { increment: giftCount },
            updatedAt:  new Date()
          }
        });

        // 6. Increment sender's contribution in VoiceRoomMember (non-fatal, voice only)
        if (roomType === 'voice') {
          await tx.voiceRoomMember.updateMany({
            where: { roomId, userId: senderId, status: 'ACTIVE' },
            data:  { contribution: { increment: totalCoins } }
          }).catch(() => {});
        }

        return { updatedSender, txn };
      });

      senderWallet = result.updatedSender;
      transaction  = result.txn;
    } catch (txErr) {
      if (txErr.message?.startsWith('INSUFFICIENT_COINS:')) {
        const parts = txErr.message.split(':');
        return errorResponse(res, `Not enough coins. You have ${parts[1]}, need ${parts[2]}`, 402);
      }
      // P1-002: Daily cap exceeded atomically inside the transaction
      if (txErr.message?.startsWith('DAILY_CAP_EXCEEDED:')) {
        return errorResponse(res, `Daily spending limit of ${DAILY_CAP} coins reached`, 429);
      }
      throw txErr;
    }

    // ── Update daily spend in Redis (cache only — DB is authoritative) ───
    // Warm up or update the Redis fast-path cache so subsequent requests
    // get the early rejection before entering the DB transaction.
    const today = new Date().toISOString().slice(0, 10);
    try {
      const dbSpend = await prisma.userDailyGiftSpend.findUnique({
        where: { userId_date: { userId: senderId, date: today } },
        select: { totalSpent: true }
      });
      if (dbSpend) {
        await safeSetCache(dailySpendKey(senderId), dbSpend.totalSpent, 86400);
      }
    } catch { /* non-fatal — Redis cache miss is acceptable */ }

    // ── Combo detection ───────────────────────────────────────────────────
    let combo = 1;
    if (gift.comboEnabled) {
      const cKey = comboKey(senderId, receiverId, giftId);
      const rawCombo = await safeGetCache(cKey);
      const prev = typeof rawCombo === 'number' ? rawCombo
        : typeof rawCombo === 'string' ? parseInt(rawCombo, 10)
        : 0;
      combo = prev + giftCount;
      await safeSetCache(cKey, combo, Math.ceil(COMBO_WINDOW / 1000));

      // Update combo on transaction record
      await prisma.giftTransaction.update({
        where: { id: transaction.id },
        data:  { combo }
      });
    }

    // ── Emit real-time event ──────────────────────────────────────────────
    const io = getIo();
    if (io) {
      const senderUser = await prisma.user.findUnique({
        where:  { id: senderId },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true }
      });

      const isPremium  = gift.isPremium  || false;
      const priority   = gift.priority   || 'normal';
      const holdMs     = PRIORITY_HOLD_MS[priority] || 0;

      // Premium gifts use PREMIUM_GIFT type; regular use VOICE_GIFT_SENT
      const eventType = isPremium ? 'PREMIUM_GIFT' : 'VOICE_GIFT_SENT';

      const payload = {
        type:          eventType,
        id:            transaction.id,   // required by GiftEvent interface for animation removal
        roomId,
        roomType,
        transactionId: transaction.id,
        sender: {
          id:        senderId,
          firstName: senderUser?.firstName,
          lastName:  senderUser?.lastName,
          avatarUrl: senderUser?.avatarUrl
        },
        receiver: {
          id:        receiverId,
          firstName: receiverParticipant.user.firstName,
          lastName:  receiverParticipant.user.lastName,
          avatarUrl: receiverParticipant.user.avatarUrl,
          role:      receiverParticipant.role
        },
        gift: {
          id:            gift.id,
          name:          gift.name,
          emoji:         gift.emoji,
          animationType: gift.animationType,
          soundEffect:   gift.soundEffect,
          priceCoins:    gift.priceCoins,
          rarity:        gift.rarity,
          priority,
          isPremium,
        },
        count:          giftCount,
        combo,
        coinsSpent:     totalCoins,
        diamondsEarned: totalDiamonds,
        priority,
        isPremium,
        holdMs,          // how long frontend should hold the stage
        timestamp:      Date.now()
      };

      // ── Universal socket emit ─────────────────────────────────────────
      // Always emit to the canonical room channel and the universal `gift:sent` event.
      // Also keep backward-compatible room-type-specific aliases.
      const socketRoom = roomType === 'live_class'
        ? `liveclass:${roomId}`
        : `voice:${roomId}`;

      // Universal event (all room types)
      io.to(socketRoom).emit('gift:sent', payload);

      // Backward-compatible aliases
      if (roomType === 'voice') {
        io.to(`voice:${roomId}`).emit('voice:gift_sent', payload);
        if (isPremium) io.to(`voice:${roomId}`).emit('voice:premium_gift', payload);
      }
      if (roomType === 'live_class') {
        io.to(`liveclass:${roomId}`).emit('liveclass:gift_sent', payload);
      }

      // Notify receiver personally (for diamond balance refresh)
      io.to(`user:${receiverId}`).emit('gift:received', {
        ...payload,
        newDiamondBalance: null,
      });
    }

    // ── PK Gift Scoring Hook ───────────────────────────────────────────────
    // If this gift was sent inside a PK room (roomType = 'pk'), process PK scoring.
    // The gift transaction is already committed — scoring is derived, never financial.
    // Non-fatal: PK scoring failure must never fail the gift response.
    if (roomType === 'pk') {
      try {
        const pkService = require('../services/pk.service');
        // Find the active PK match for this room
        const pkMatch = await prisma.pKMatch.findFirst({
          where: {
            state: 'LIVE',
            OR: [{ roomIdA: roomId }, { roomIdB: roomId }]
          },
          include: { participants: { select: { userId: true, side: true } } }
        });
        if (pkMatch) {
          const recvParticipant = pkMatch.participants.find(p => p.userId === receiverId);
          const side            = recvParticipant?.side || (pkMatch.roomIdA === roomId ? 'A' : 'B');
          await pkService.processPKGift(pkMatch.id, transaction, side, receiverId);
        }
      } catch (pkErr) {
        logger.error(`[gift:pk] PK scoring failed for tx ${transaction.id}: ${pkErr.message}`);
      }
    }

    return successResponse(res, {
      transaction: { ...transaction, combo },
      senderCoinsRemaining: senderWallet.coins,
      diamondsEarned: totalDiamonds,
      combo
    }, `${gift.emoji} ${gift.name} sent!`);

  } catch (err) {
    if (err.code === 'INSUFFICIENT_COINS') {
      return errorResponse(res, `Not enough coins. You have ${err.have}, need ${err.need}`, 402);
    }
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /voice/:id/gifts/leaderboard ─────────────────────────────────────────
async function getRoomLeaderboard(req, res) {
  try {
    const { id: roomId } = req.params;
    const { limit = 10 } = req.query;

    const leaderboard = await prisma.roomGiftLeaderboard.findMany({
      where:   { roomId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: { totalCoins: 'desc' },
      take:    Math.min(parseInt(limit), 50)
    });

    return successResponse(res, leaderboard);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /voice/:id/gifts/history ─────────────────────────────────────────────
async function getRoomGiftHistory(req, res) {
  try {
    const { id: roomId } = req.params;
    const { limit = 50, before } = req.query;

    const where = { roomId };
    if (before) where.createdAt = { lt: new Date(before) };

    const transactions = await prisma.giftTransaction.findMany({
      where,
      include: {
        sender:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        receiver:{ select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        gift:    { select: { id: true, name: true, emoji: true, rarity: true, priceCoins: true } }
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(parseInt(limit), 100)
    });

    return successResponse(res, transactions);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /voice/:id/gifts/top-supporters ──────────────────────────────────────
async function getTopSupporters(req, res) {
  try {
    const { id: roomId } = req.params;

    const supporters = await prisma.roomGiftLeaderboard.findMany({
      where:   { roomId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: { totalCoins: 'desc' },
      take:    3
    });

    return successResponse(res, supporters);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /gifts/leaderboard/daily ─────────────────────────────────────────────
async function getDailyLeaderboard(req, res) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results = await prisma.giftTransaction.groupBy({
      by:      ['senderId'],
      where:   { createdAt: { gte: today } },
      _sum:    { coinsSpent: true },
      _count:  { id: true },
      orderBy: { _sum: { coinsSpent: 'desc' } },
      take:    10
    });

    if (!results.length) return successResponse(res, []);

    // PERFORMANCE FIX: Previously ran prisma.user.findUnique() inside a loop
    // = N+1 queries (1 groupBy + 10 user lookups = 11 DB round-trips).
    // Now: 1 groupBy + 1 user.findMany() = 2 DB round-trips total.
    const senderIds = results.map(r => r.senderId);

    const users = await prisma.user.findMany({
      where:  { id: { in: senderIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true }
    });

    // Build a lookup map for O(1) user resolution
    const userMap = new Map(users.map(u => [u.id, u]));

    const enriched = results.map(r => ({
      user:       userMap.get(r.senderId) ?? null,
      totalCoins: r._sum.coinsSpent,
      giftCount:  r._count.id
    }));

    return successResponse(res, enriched);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── POST /voice/:id/gifts/all ────────────────────────────────────────────────
/**
 * Send the same gift to ALL active speakers (HOST + MODERATOR + SPEAKER) at once.
 * Body: { giftId, count?, idempotencyKey }
 *
 * Coins are deducted once per receiver (total = priceCoins × count × receiverCount).
 * Each receiver gets their own diamond credit and transaction record.
 * One room-wide socket event is emitted with all receivers listed.
 */
async function sendGiftToAll(req, res) {
  try {
    // SUPER_ADMIN isolation (Task 10.1): platform admin cannot send gifts
    if (req.user.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'SUPER_ADMIN cannot send gifts in platform rooms', 403);
    }
    const roomType = req.roomType || 'voice';
    const roomId   = req.params.id;
    const senderId = req.user.id;
    const { giftId, count = 1, idempotencyKey } = req.body;

    if (!giftId) return errorResponse(res, 'giftId is required', 400);

    const giftCount = Math.max(1, Math.min(parseInt(count) || 1, 100));

    // ── Idempotency ───────────────────────────────────────────────────────
    const iKey = idempotencyKey || uuidv4();
    const allKey = `all:${iKey}`;
    const existingAll = await prisma.giftTransaction.findFirst({
      where: { idempotencyKey: { startsWith: allKey } }
    });
    if (existingAll) {
      return successResponse(res, { duplicate: true }, 'Gift already processed');
    }

    // ── Load room via resolver ─────────────────────────────────────────────
    const room = await resolveRoom(roomType, roomId);
    if (!room)                   return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'Room has ended', 400);
    if (room.status === 'CANCELLED') return errorResponse(res, 'Room was cancelled', 400);

    // ── Sender must be active participant ─────────────────────────────────
    const senderParticipant = await resolveParticipant(roomType, roomId, senderId);
    if (!senderParticipant?.isActive) {
      return errorResponse(res, 'You are not in this room', 403);
    }

    // ── Load all eligible receivers via resolver ──────────────────────────
    const receiverParticipants = await resolveActiveRecipients(roomType, roomId, senderId);


    if (receiverParticipants.length === 0) {
      return errorResponse(res, 'No eligible receivers on stage', 400);
    }

    // ── Load gift ─────────────────────────────────────────────────────────
    const gift = await prisma.gift.findUnique({ where: { id: giftId } });
    if (!gift || !gift.isActive) return errorResponse(res, 'Gift not found', 404);

    // Premium no-combo gifts: force count = 1 for "all" sends
    const effectiveCount = gift.comboEnabled ? giftCount : 1;
    const coinsPerReceiver    = gift.priceCoins * effectiveCount;
    const diamondsPerReceiver = toDiamonds(coinsPerReceiver);
    const totalCoinsNeeded    = coinsPerReceiver * receiverParticipants.length;

    // ── Daily spend cap — Redis fast path + DB fallback ──────────────────
    const rawSpent   = await safeGetCache(dailySpendKey(senderId));
    let spentToday;
    if (rawSpent !== null && rawSpent !== undefined) {
      spentToday = typeof rawSpent === 'number' ? rawSpent
        : typeof rawSpent === 'string' ? parseInt(rawSpent, 10) : 0;
    } else {
      try {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const agg = await prisma.giftTransaction.aggregate({
          where: { senderId, createdAt: { gte: startOfDay } },
          _sum:  { coinsSpent: true }
        });
        spentToday = agg._sum.coinsSpent ?? 0;
        logger.warn(`[gift] Redis unavailable — used DB fallback for daily cap (user ${senderId}, spent ${spentToday})`);
      } catch (dbErr) {
        logger.error(`[gift] DB cap fallback failed for user ${senderId}: ${dbErr.message}`);
        return errorResponse(res, 'Service temporarily unavailable — please retry in a moment', 503);
      }
    }
    if (spentToday + totalCoinsNeeded > DAILY_CAP) {
      return errorResponse(res, `Daily spending limit of ${DAILY_CAP} coins reached`, 429);
    }

    // ── Atomic transaction ────────────────────────────────────────────────
    // BE-011: Add explicit timeout to prevent Prisma's 5s default from killing
    // large room sends. 50 receivers × 3 DB ops each = 150 ops — needs headroom.
    // 30s covers rooms up to ~100 receivers safely.
    let senderWallet, transactions;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Check sender balance
        const sw = await tx.wallet.upsert({
          where:  { userId: senderId },
          create: { userId: senderId, coins: 0, diamonds: 0, totalSpent: 0, totalEarned: 0 },
          update: {}
        });
        if (sw.coins < totalCoinsNeeded) {
          throw new Error(`INSUFFICIENT_COINS:${sw.coins}:${totalCoinsNeeded}`);
        }

        // 2. Deduct total coins from sender — optimistic lock prevents race conditions
        const updatedSender = await tx.wallet.update({
          where: { userId: senderId, coins: { gte: totalCoinsNeeded } },
          data:  {
            coins:      { decrement: totalCoinsNeeded },
            totalSpent: { increment: totalCoinsNeeded }
          }
        });

        // 3. Credit each receiver + create transaction record
        const txns = [];
        for (let i = 0; i < receiverParticipants.length; i++) {
          const rp = receiverParticipants[i];

          await tx.wallet.upsert({
            where:  { userId: rp.userId },
            create: { userId: rp.userId, coins: 0, diamonds: diamondsPerReceiver, totalSpent: 0, totalEarned: diamondsPerReceiver },
            update: { diamonds: { increment: diamondsPerReceiver }, totalEarned: { increment: diamondsPerReceiver } }
          });

          const txn = await tx.giftTransaction.create({
            data: {
              roomId,
              roomType,
              senderId,
              receiverId:     rp.userId,
              giftId,
              count:          effectiveCount,
              combo:          1,
              priority:       gift.priority  || 'normal',
              isPremium:      gift.isPremium || false,
              coinsSpent:     coinsPerReceiver,
              diamondsEarned: diamondsPerReceiver,
              idempotencyKey: `${allKey}:${i}`
            }
          });
          txns.push(txn);
        }

        // PERF-FIX: leaderboard upsert moved OUTSIDE the per-receiver loop.
        // Previously this ran N times (once per receiver) with cumulative increments,
        // wasting N-1 round-trips. A single upsert with the total amount is correct
        // and reduces DB ops from O(N) to O(1) for the leaderboard update.
        const totalCoinsForLeaderboard = coinsPerReceiver * receiverParticipants.length;
        const totalGiftCountForLeaderboard = effectiveCount * receiverParticipants.length;
        await tx.roomGiftLeaderboard.upsert({
          where:  { roomId_userId: { roomId, userId: senderId } },
          create: { roomId, roomType, userId: senderId, totalCoins: totalCoinsForLeaderboard, giftCount: totalGiftCountForLeaderboard, updatedAt: new Date() },
          update: { totalCoins: { increment: totalCoinsForLeaderboard }, giftCount: { increment: totalGiftCountForLeaderboard }, updatedAt: new Date() }
        });

        // Write platform revenue entry for the entire send-to-all — FATAL (no .catch)
        // One consolidated entry per send-to-all call (platform takes 50% of total spend).
        await writePlatformRevenueFromSpend(tx, {
          sourceType: 'GIFT',
          sourceId:   txns[0]?.id || uuidv4(), // reference first transaction
          userId:     senderId,
          spendCoins: totalCoinsNeeded,
        });

        return { updatedSender, txns };
      }, {
        // BE-011: Extended timeout — 3 ops/receiver × up to 100 receivers = 300 ops.
        // Default Prisma timeout is 5s which fails for rooms with >15 receivers.
        timeout: 30_000, // 30 seconds
        maxWait:  5_000, // wait up to 5s to acquire connection from pool
      });

      senderWallet = result.updatedSender;
      transactions = result.txns;
    } catch (txErr) {
      if (txErr.message?.startsWith('INSUFFICIENT_COINS:')) {
        const parts = txErr.message.split(':');
        return errorResponse(res, `Not enough coins. You have ${parts[1]}, need ${parts[2]}`, 402);
      }
      throw txErr;
    }

    // ── Update daily spend ────────────────────────────────────────────────
    await safeSetCache(dailySpendKey(senderId), spentToday + totalCoinsNeeded, 86400);

    // ── Emit room-wide event ──────────────────────────────────────────────
    const io = getIo();
    if (io) {
      const senderUser = await prisma.user.findUnique({
        where:  { id: senderId },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true }
      });

      const isPremium = gift.isPremium || false;
      const priority  = gift.priority  || 'normal';
      const holdMs    = PRIORITY_HOLD_MS[priority] || 0;

      const payload = {
        type:     'VOICE_GIFT_ALL',
        id:       `all-${Date.now()}-${senderId}`,   // unique id for animation removal
        roomId,
        roomType,
        sender: {
          id:        senderId,
          firstName: senderUser?.firstName,
          lastName:  senderUser?.lastName,
          avatarUrl: senderUser?.avatarUrl
        },
        receivers: receiverParticipants.map(rp => ({
          id:        rp.userId,
          firstName: rp.user.firstName,
          lastName:  rp.user.lastName,
          avatarUrl: rp.user.avatarUrl,
          role:      rp.role
        })),
        gift: {
          id:            gift.id,
          name:          gift.name,
          emoji:         gift.emoji,
          animationType: gift.animationType,
          soundEffect:   gift.soundEffect,
          priceCoins:    gift.priceCoins,
          rarity:        gift.rarity,
          priority,
          isPremium,
        },
        count:             effectiveCount,
        coinsSpentTotal:   totalCoinsNeeded,
        diamondsPerPerson: diamondsPerReceiver,
        receiverCount:     receiverParticipants.length,
        priority,
        isPremium,
        holdMs,
        timestamp: Date.now()
      };

      // ── Universal socket emit ─────────────────────────────────────────
      const socketRoom = roomType === 'live_class'
        ? `liveclass:${roomId}`
        : `voice:${roomId}`;

      io.to(socketRoom).emit('gift:sent', payload);
      io.to(socketRoom).emit('gift:all', payload);

      // Backward-compatible aliases
      if (roomType === 'voice') {
        io.to(`voice:${roomId}`).emit('voice:gift_sent', payload);
        io.to(`voice:${roomId}`).emit('voice:gift_all', payload);
      }
      if (roomType === 'live_class') {
        io.to(`liveclass:${roomId}`).emit('liveclass:gift_sent', payload);
      }

      // Notify each receiver individually
      receiverParticipants.forEach(rp => {
        io.to(`user:${rp.userId}`).emit('gift:received', {
          ...payload,
          receiver: { id: rp.userId, firstName: rp.user.firstName, lastName: rp.user.lastName, avatarUrl: rp.user.avatarUrl, role: rp.role }
        });
      });
    }

    return successResponse(res, {
      receiverCount:     receiverParticipants.length,
      totalCoinsSpent:   totalCoinsNeeded,
      senderCoinsRemaining: senderWallet.coins,
      transactions:      transactions.length
    }, `${gift.emoji} ${gift.name} sent to all ${receiverParticipants.length} on stage!`);

  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

module.exports = {
  listGifts,
  sendGift,
  sendGiftToAll,
  getRoomLeaderboard,
  getRoomGiftHistory,
  getTopSupporters,
  getDailyLeaderboard
};
