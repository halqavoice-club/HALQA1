'use strict';
/**
 * Creator Economy Controller — Phase B-6
 * Reuses: prisma, wallet (coins/diamonds), notification service, getIo
 * New file — never modifies existing controllers.
 */
const { v4: uuidv4 } = require('uuid');
const prisma  = require('../utils/prisma');
const { getIo }      = require('../sockets');
const { successResponse, errorResponse } = require('../utils/response');
const { notify }     = require('../services/notification.service');
const logger         = require('../utils/logger');
const { toDiamonds } = require('../services/economy.config');
const { writePlatformRevenueFromSpend } = require('../utils/platformRevenue');

// ─── BECOME A CREATOR ─────────────────────────────────────────────────────────
async function becomeCreator(req, res, next) {
  try {
    // SUPER_ADMIN isolation (Task 10.1): platform admin cannot create a creator profile
    if (req.user.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'SUPER_ADMIN cannot create a creator profile', 403);
    }
    const { displayName, tagline, links } = req.body;
    const existing = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (existing) return successResponse(res, existing, 'Already a creator');

    const profile = await prisma.creatorProfile.create({
      data: {
        id: uuidv4(), userId: req.user.id,
        displayName: displayName?.trim() || `${req.user.firstName} ${req.user.lastName}`,
        tagline: tagline?.trim() || null,
        links: links || null,
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    logger.info(`[creator] ${req.user.id} became a creator`);
    return successResponse(res, profile, 'Creator profile created', 201);
  } catch (e) { next(e); }
}

// ─── GET CREATOR PROFILE (by userId) ─────────────────────────────────────────
async function getCreatorProfile(req, res, next) {
  try {
    const { userId } = req.params;
    const profile = await prisma.creatorProfile.findUnique({
      where: { userId },
      include: {
        user:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true, bio: true } },
        tiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      }
    });
    if (!profile || !profile.isActive) return errorResponse(res, 'Creator not found', 404);

    // Check if viewer is subscribed
    const subscription = await prisma.creatorSubscription.findUnique({
      where: { subscriberId_creatorId: { subscriberId: req.user.id, creatorId: profile.id } }
    });
    const isSubscribed = subscription?.status === 'ACTIVE' && subscription.expiresAt > new Date();

    return successResponse(res, { ...profile, isSubscribed, mySubscription: subscription || null });
  } catch (e) { next(e); }
}

// ─── UPDATE CREATOR PROFILE ───────────────────────────────────────────────────
async function updateCreatorProfile(req, res, next) {
  try {
    const profile = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return errorResponse(res, 'You are not a creator yet', 404);

    const allowed = ['displayName','tagline','links'];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

    const updated = await prisma.creatorProfile.update({ where: { id: profile.id }, data });
    return successResponse(res, updated, 'Profile updated');
  } catch (e) { next(e); }
}

// ─── CREATE TIER ──────────────────────────────────────────────────────────────
async function createTier(req, res, next) {
  try {
    const profile = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return errorResponse(res, 'Become a creator first', 404);

    const { name, description, priceCoins, perks, sortOrder } = req.body;
    if (!name?.trim()) return errorResponse(res, 'Tier name required', 400);
    if (!priceCoins || priceCoins < 1) return errorResponse(res, 'priceCoins must be >= 1', 400);

    const tier = await prisma.creatorTier.create({
      data: {
        id: uuidv4(), creatorId: profile.id,
        name: name.trim(), description: description?.trim() || null,
        priceCoins: parseInt(priceCoins), perks: perks || null,
        sortOrder: sortOrder || 0,
      }
    });
    return successResponse(res, tier, 'Tier created', 201);
  } catch (e) { next(e); }
}

// ─── UPDATE TIER ─────────────────────────────────────────────────────────────
async function updateTier(req, res, next) {
  try {
    const { tierId } = req.params;
    const profile = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return errorResponse(res, 'Not a creator', 404);

    const tier = await prisma.creatorTier.findFirst({ where: { id: tierId, creatorId: profile.id } });
    if (!tier) return errorResponse(res, 'Tier not found', 404);

    const allowed = ['name','description','priceCoins','perks','sortOrder','isActive'];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

    const updated = await prisma.creatorTier.update({ where: { id: tier.id }, data });
    return successResponse(res, updated, 'Tier updated');
  } catch (e) { next(e); }
}

// ─── SUBSCRIBE TO CREATOR ─────────────────────────────────────────────────────
async function subscribe(req, res, next) {
  try {
    // SUPER_ADMIN isolation (Task 10.1): platform admin cannot subscribe to creators
    if (req.user.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'SUPER_ADMIN cannot subscribe to creator tiers', 403);
    }
    const { userId: creatorUserId } = req.params;
    const { tierId } = req.body;
    const subscriberId = req.user.id;

    if (subscriberId === creatorUserId) return errorResponse(res, 'Cannot subscribe to yourself', 400);

    const profile = await prisma.creatorProfile.findUnique({
      where: { userId: creatorUserId },
      include: { tiers: true }
    });
    if (!profile || !profile.isActive) return errorResponse(res, 'Creator not found', 404);

    const tier = profile.tiers.find(t => t.id === tierId && t.isActive);
    if (!tier) return errorResponse(res, 'Tier not found', 404);

    // Check existing active subscription (pre-transaction read is fine — duplicate active check is
    // inside the transaction too via upsert; this just avoids pointless DB work on clear duplicates)
    const existing = await prisma.creatorSubscription.findUnique({
      where: { subscriberId_creatorId: { subscriberId, creatorId: profile.id } }
    });
    if (existing?.status === 'ACTIVE' && existing.expiresAt > new Date()) {
      return successResponse(res, existing, 'Already subscribed');
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const diamonds  = toDiamonds(tier.priceCoins);

    // ── Atomic transaction with optimistic lock ───────────────────────────────
    // The pre-transaction balance check has been REMOVED to eliminate the TOCTOU
    // race condition. The balance is now validated exclusively via the optimistic
    // lock on wallet.update (WHERE coins >= priceCoins).
    //
    // If two concurrent subscribe requests arrive simultaneously:
    //   - Both enter the transaction
    //   - Only one wins the optimistic lock (WHERE coins >= priceCoins)
    //   - The loser gets P2025 → rolls back → returns 402
    //   - Wallet.coins can never go below zero (DB CHECK constraint is the final guard)
    let sub;
    try {
      sub = await prisma.$transaction(async (tx) => {
        // 1. Optimistic-lock coin deduction: only succeeds if coins >= priceCoins
        //    P2025 is thrown if no row matches → insufficient balance under concurrency
        await tx.wallet.update({
          where: { userId: subscriberId, coins: { gte: tier.priceCoins } },
          data:  { coins: { decrement: tier.priceCoins }, totalSpent: { increment: tier.priceCoins } }
        });

        // 2. Credit diamonds to creator
        await tx.wallet.upsert({
          where:  { userId: creatorUserId },
          create: { userId: creatorUserId, coins: 0, diamonds, totalSpent: 0, totalEarned: diamonds },
          update: { diamonds: { increment: diamonds }, totalEarned: { increment: diamonds } }
        });

        // 3. Create/update subscription
        const subscription = await tx.creatorSubscription.upsert({
          where:  { subscriberId_creatorId: { subscriberId, creatorId: profile.id } },
          create: { id: uuidv4(), subscriberId, creatorId: profile.id, tierId, status: 'ACTIVE', expiresAt, coinsCharged: tier.priceCoins },
          update: { tierId, status: 'ACTIVE', expiresAt, renewedAt: new Date(), coinsCharged: { increment: tier.priceCoins } }
        });

        // 4. Increment subscriber count on creator profile
        await tx.creatorProfile.update({
          where: { id: profile.id },
          data:  { subscriberCount: { increment: existing ? 0 : 1 }, totalEarned: { increment: diamonds } }
        });

        // 5. Write SUBSCRIPTION ledger entry — FATAL (no .catch)
        //    Task 6.1: removed .catch(() => {}) — ledger failure rolls back entire transaction
        await tx.walletTransaction.create({
          data: {
            userId:         subscriberId,
            type:           'SUBSCRIPTION',
            coins:          -tier.priceCoins,
            description:    `Subscribed to ${tier.name} tier of creator ${creatorUserId}`,
            subscriptionId: subscription.id
          }
        });

        // 5b. F-05: Creator receiver diamond ledger entry — FATAL (no .catch)
        // Completes the subscription ledger: subscriber debit (SUBSCRIPTION) + creator credit (SUBSCRIPTION_RECEIVE).
        if (diamonds > 0) {
          await tx.walletTransaction.create({
            data: {
              userId:         creatorUserId,
              type:           'SUBSCRIPTION_RECEIVE',
              coins:          0,
              diamonds,
              description:    `Subscription income from ${subscriberId} — ${tier.name}`,
              subscriptionId: subscription.id
            }
          });
        }

        // 6. Write platform revenue entry — FATAL (no .catch)
        //    Platform retains 50% of subscription charge.
        await writePlatformRevenueFromSpend(tx, {
          sourceType: 'SUBSCRIPTION',
          sourceId:   subscription.id,
          userId:     subscriberId,
          spendCoins: tier.priceCoins,
        });

        return subscription;
      });
    } catch (txErr) {
      // P2025 = optimistic lock miss (insufficient coins at commit time)
      if (txErr.code === 'P2025' || txErr.message?.includes('Record to update not found')) {
        const currentWallet = await prisma.wallet.findUnique({
          where:  { userId: subscriberId },
          select: { coins: true }
        });
        return errorResponse(
          res,
          `Not enough coins. Need ${tier.priceCoins}, have ${currentWallet?.coins ?? 0}`,
          402
        );
      }
      throw txErr;
    }

    await notify(creatorUserId, {
      type:  'NEW_SUBSCRIBER',
      title: `${req.user.firstName} subscribed to your ${tier.name} tier!`,
      body:  `You earned ${diamonds} diamonds`,
      data:  { subscriberId, tierId, type: 'new_subscriber' }
    });

    return successResponse(res, { subscribed: true, tier, expiresAt, coinsCharged: tier.priceCoins }, `Subscribed to ${tier.name}`);
  } catch (e) { next(e); }
}

// ─── UNSUBSCRIBE ──────────────────────────────────────────────────────────────
async function unsubscribe(req, res, next) {
  try {
    const { userId: creatorUserId } = req.params;
    const subscriberId = req.user.id;

    const profile = await prisma.creatorProfile.findUnique({ where: { userId: creatorUserId } });
    if (!profile) return errorResponse(res, 'Creator not found', 404);

    const sub = await prisma.creatorSubscription.findUnique({
      where: { subscriberId_creatorId: { subscriberId, creatorId: profile.id } }
    });
    if (!sub) return errorResponse(res, 'No active subscription', 400);

    await prisma.$transaction([
      prisma.creatorSubscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } }),
      prisma.creatorProfile.update({ where: { id: profile.id }, data: { subscriberCount: { decrement: 1 } } })
    ]);

    return successResponse(res, null, 'Unsubscribed');
  } catch (e) { next(e); }
}

// ─── SEND TIP ─────────────────────────────────────────────────────────────────
async function sendTip(req, res, next) {
  try {
    // SUPER_ADMIN isolation (Task 10.1): platform admin cannot send tips
    if (req.user.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'SUPER_ADMIN cannot send creator tips', 403);
    }
    const { userId: creatorUserId } = req.params;
    const { amount, message, postId, idempotencyKey } = req.body;
    const senderId = req.user.id;

    if (senderId === creatorUserId) return errorResponse(res, 'Cannot tip yourself', 400);
    if (!amount || amount < 1)      return errorResponse(res, 'amount must be >= 1 coin', 400);

    const profile = await prisma.creatorProfile.findUnique({ where: { userId: creatorUserId } });
    if (!profile || !profile.isActive) return errorResponse(res, 'Creator not found', 404);

    const iKey = idempotencyKey || uuidv4();
    const existing = await prisma.creatorTip.findUnique({ where: { idempotencyKey: iKey } });
    if (existing) return successResponse(res, existing, 'Tip already sent');

    // P1-001 FIX: Removed pre-transaction wallet.findUnique balance check (TOCTOU).
    // The authoritative balance check is now the optimistic lock inside the transaction:
    //   WHERE userId = senderId AND coins >= amount
    // Two concurrent tips can no longer both pass a stale pre-tx read — only the one
    // that wins the optimistic lock will succeed; the other gets P2025 → 402.
    const diamonds = toDiamonds(amount);

    let tip;
    try {
      tip = await prisma.$transaction(async (tx) => {
        // 1. Optimistic-lock coin deduction — only succeeds if coins >= amount.
        //    P2025 thrown if no row matches (insufficient balance under concurrency).
        await tx.wallet.update({
          where: { userId: senderId, coins: { gte: amount } },
          data:  { coins: { decrement: amount }, totalSpent: { increment: amount } }
        });

        // 2. Credit diamonds to creator
        await tx.wallet.upsert({
          where:  { userId: creatorUserId },
          create: { userId: creatorUserId, coins: 0, diamonds, totalSpent: 0, totalEarned: diamonds },
          update: { diamonds: { increment: diamonds }, totalEarned: { increment: diamonds } }
        });

        // 3. Create tip record
        const t = await tx.creatorTip.create({
          data: {
            id: uuidv4(), senderId, creatorId: profile.id, amount,
            diamondsEarned: diamonds, message: message?.trim() || null,
            postId: postId || null, idempotencyKey: iKey
          }
        });

        // 4. Increment creator stats
        await tx.creatorProfile.update({
          where: { id: profile.id },
          data:  { tipCount: { increment: 1 }, totalEarned: { increment: diamonds } }
        });

        // 5. Sender wallet ledger entry — FATAL (no .catch)
        await tx.walletTransaction.create({
          data: {
            userId:      senderId,
            type:        'TIP_SEND',
            coins:       -amount,
            description: `Tip to creator ${creatorUserId}${message ? ': ' + message.substring(0, 50) : ''}`,
            tipId:       t.id
          }
        });

        // 5b. F-05: Creator receiver diamond ledger entry — FATAL (no .catch)
        // Completes the tip ledger: sender debit (TIP_SEND) + receiver credit (TIP_RECEIVE).
        // Only written when diamonds > 0 (mirrors GIFT_RECEIVE pattern for odd-coin floor).
        if (diamonds > 0) {
          await tx.walletTransaction.create({
            data: {
              userId:      creatorUserId,
              type:        'TIP_RECEIVE',
              coins:       0,
              diamonds,
              description: `Tip received from ${senderId}${message ? ': ' + message.substring(0, 50) : ''}`,
              tipId:       t.id
            }
          });
        }

        // 6. Platform revenue entry — FATAL (no .catch)
        await writePlatformRevenueFromSpend(tx, {
          sourceType: 'TIP',
          sourceId:   t.id,
          userId:     senderId,
          spendCoins: amount,
        });

        return t;
      });
    } catch (txErr) {
      // P2025 = optimistic lock miss (insufficient coins at commit time)
      if (txErr.code === 'P2025' || txErr.message?.includes('Record to update not found')) {
        const currentWallet = await prisma.wallet.findUnique({
          where:  { userId: senderId },
          select: { coins: true }
        });
        return errorResponse(
          res,
          `Not enough coins. Need ${amount}, have ${currentWallet?.coins ?? 0}`,
          402
        );
      }
      throw txErr;
    }

    // Notify creator
    await notify(creatorUserId, {
      type:  'TIP_RECEIVED',
      title: `💰 ${req.user.firstName} tipped you ${amount} coins!`,
      body:  message ? `"${message.substring(0, 80)}"` : `You earned ${diamonds} diamonds`,
      data:  { senderId, tipId: tip.id, amount, type: 'tip_received' }
    });

    // Real-time socket
    const io = getIo();
    if (io) io.to(`user:${creatorUserId}`).emit('creator:tip_received', { senderId, amount, diamonds, message, tipId: tip.id });

    return successResponse(res, { tip, coinsSpent: amount, diamondsEarned: diamonds }, `Tipped ${amount} coins!`);
  } catch (e) { next(e); }
}

// ─── CREATOR DASHBOARD ───────────────────────────────────────────────────────
async function getDashboard(req, res, next) {
  try {
    const profile = await prisma.creatorProfile.findUnique({
      where: { userId: req.user.id },
      include: { tiers: { orderBy: { sortOrder: 'asc' } } }
    });
    if (!profile) return errorResponse(res, 'Not a creator', 404);

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [recentTips, recentSubs, activeSubs, wallet] = await Promise.all([
      prisma.creatorTip.findMany({
        where: { creatorId: profile.id, createdAt: { gte: since30d } },
        include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' }, take: 10
      }),
      prisma.creatorSubscription.findMany({
        where: { creatorId: profile.id, createdAt: { gte: since30d } },
        include: { subscriber: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }, tier: { select: { id: true, name: true, priceCoins: true } } },
        orderBy: { createdAt: 'desc' }, take: 10
      }),
      prisma.creatorSubscription.count({ where: { creatorId: profile.id, status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
      prisma.wallet.findUnique({ where: { userId: req.user.id } })
    ]);

    const tipsTotal30d = recentTips.reduce((s, t) => s + t.amount, 0);

    return successResponse(res, {
      profile,
      wallet: { coins: wallet?.coins ?? 0, diamonds: wallet?.diamonds ?? 0 },
      stats: { activeSubs, tipsLast30d: recentTips.length, tipsTotal30d, totalEarned: profile.totalEarned, totalTips: profile.tipCount, subscriberCount: profile.subscriberCount },
      recentTips,
      recentSubs,
    });
  } catch (e) { next(e); }
}

// ─── MY SUBSCRIPTIONS ─────────────────────────────────────────────────────────
async function getMySubscriptions(req, res, next) {
  try {
    const subs = await prisma.creatorSubscription.findMany({
      where: { subscriberId: req.user.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      include: {
        creator: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
        tier: { select: { id: true, name: true, priceCoins: true } }
      },
      orderBy: { startedAt: 'desc' }
    });
    return successResponse(res, subs);
  } catch (e) { next(e); }
}

module.exports = {
  becomeCreator, getCreatorProfile, updateCreatorProfile,
  createTier, updateTier,
  subscribe, unsubscribe,
  sendTip,
  getDashboard, getMySubscriptions,
};
