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

const PLATFORM_CUT = 0.5;
const toDiamonds   = (coins) => Math.floor(coins * (1 - PLATFORM_CUT));

const CREATOR_SELECT = {
  id: true, userId: true, displayName: true, tagline: true,
  isActive: true, isVerified: true, totalEarned: true,
  subscriberCount: true, tipCount: true, links: true, createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, bio: true } }
};

// ─── BECOME A CREATOR ─────────────────────────────────────────────────────────
async function becomeCreator(req, res, next) {
  try {
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

    // Check existing active subscription
    const existing = await prisma.creatorSubscription.findUnique({
      where: { subscriberId_creatorId: { subscriberId, creatorId: profile.id } }
    });
    if (existing?.status === 'ACTIVE' && existing.expiresAt > new Date()) {
      return successResponse(res, existing, 'Already subscribed');
    }

    // Deduct coins from subscriber
    const wallet = await prisma.wallet.findUnique({ where: { userId: subscriberId } });
    if (!wallet || wallet.coins < tier.priceCoins) {
      return errorResponse(res, `Not enough coins. Need ${tier.priceCoins}, have ${wallet?.coins ?? 0}`, 402);
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const diamonds  = toDiamonds(tier.priceCoins);

    await prisma.$transaction(async (tx) => {
      // Deduct coins from subscriber
      await tx.wallet.update({ where: { userId: subscriberId }, data: { coins: { decrement: tier.priceCoins }, totalSpent: { increment: tier.priceCoins } } });
      // Credit diamonds to creator
      await tx.wallet.upsert({ where: { userId: creatorUserId }, create: { userId: creatorUserId, coins: 0, diamonds, totalSpent: 0, totalEarned: diamonds }, update: { diamonds: { increment: diamonds }, totalEarned: { increment: diamonds } } });
      // Create/update subscription
      const sub = await tx.creatorSubscription.upsert({
        where:  { subscriberId_creatorId: { subscriberId, creatorId: profile.id } },
        create: { id: uuidv4(), subscriberId, creatorId: profile.id, tierId, status: 'ACTIVE', expiresAt, coinsCharged: tier.priceCoins },
        update: { tierId, status: 'ACTIVE', expiresAt, renewedAt: new Date(), coinsCharged: { increment: tier.priceCoins } }
      });
      // Increment subscriber count
      await tx.creatorProfile.update({ where: { id: profile.id }, data: { subscriberCount: { increment: existing ? 0 : 1 }, totalEarned: { increment: diamonds } } });
      // Wallet ledger entry
      await tx.walletTransaction.create({
        data: {
          userId:         subscriberId,
          type:           'SUBSCRIPTION',
          coins:          -tier.priceCoins,
          description:    `Subscribed to ${tier.name} tier of creator ${creatorUserId}`,
          subscriptionId: sub.id
        }
      }).catch(() => {}); // non-fatal
    });

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

    const wallet = await prisma.wallet.findUnique({ where: { userId: senderId } });
    if (!wallet || wallet.coins < amount) {
      return errorResponse(res, `Not enough coins. Need ${amount}, have ${wallet?.coins ?? 0}`, 402);
    }

    const diamonds = toDiamonds(amount);

    const tip = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({ where: { userId: senderId }, data: { coins: { decrement: amount }, totalSpent: { increment: amount } } });
      await tx.wallet.upsert({ where: { userId: creatorUserId }, create: { userId: creatorUserId, coins: 0, diamonds, totalSpent: 0, totalEarned: diamonds }, update: { diamonds: { increment: diamonds }, totalEarned: { increment: diamonds } } });
      const t = await tx.creatorTip.create({
        data: { id: uuidv4(), senderId, creatorId: profile.id, amount, diamondsEarned: diamonds, message: message?.trim() || null, postId: postId || null, idempotencyKey: iKey }
      });
      await tx.creatorProfile.update({ where: { id: profile.id }, data: { tipCount: { increment: 1 }, totalEarned: { increment: diamonds } } });

      // Wallet ledger entry — records coin debit for audit trail
      await tx.walletTransaction.create({
        data: {
          userId:      senderId,
          type:        'TIP_SEND',
          coins:       -amount,
          description: `Tip to creator ${creatorUserId}${message ? ': ' + message.substring(0, 50) : ''}`,
          tipId:       t.id
        }
      }).catch(() => {}); // non-fatal

      return t;
    });

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

// ─── PAYOUT REQUEST ───────────────────────────────────────────────────────────
// Creators can request to withdraw their diamond balance.
// Diamonds are converted to USD at a configurable rate (default: 100 diamonds = $1).
// Payout requests are recorded and processed manually by platform admins,
// or automatically via Stripe Connect (future integration).
//
// Conversion rate: DIAMOND_TO_USD env var (default: 100 diamonds per $1)
// Minimum payout: MIN_PAYOUT_DIAMONDS env var (default: 1000 diamonds = $10)

const DIAMOND_TO_USD   = parseFloat(process.env.DIAMOND_TO_USD   || '100');  // diamonds per $1
const MIN_PAYOUT       = parseInt(process.env.MIN_PAYOUT_DIAMONDS || '1000', 10);

async function requestPayout(req, res, next) {
  try {
    const { diamonds, paymentMethod = 'bank_transfer', paymentDetails } = req.body;

    if (!diamonds || diamonds < MIN_PAYOUT) {
      return errorResponse(res, `Minimum payout is ${MIN_PAYOUT} diamonds ($${(MIN_PAYOUT / DIAMOND_TO_USD).toFixed(2)})`, 400);
    }
    if (!paymentDetails?.accountHolder) {
      return errorResponse(res, 'paymentDetails.accountHolder is required', 400);
    }

    // Verify creator profile
    const profile = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile || !profile.isActive) return errorResponse(res, 'Creator profile not found', 404);

    // Check diamond balance
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet || wallet.diamonds < diamonds) {
      return errorResponse(res, `Insufficient diamonds. You have ${wallet?.diamonds ?? 0}, requested ${diamonds}`, 400);
    }

    const usdAmount   = parseFloat((diamonds / DIAMOND_TO_USD).toFixed(2));
    const platformFee = parseFloat((usdAmount * 0.1).toFixed(2));  // 10% platform fee
    const netAmount   = parseFloat((usdAmount - platformFee).toFixed(2));

    // Atomically deduct diamonds and create payout record
    await prisma.$transaction([
      // Deduct diamonds from wallet
      prisma.wallet.update({
        where: { userId: req.user.id },
        data:  { diamonds: { decrement: diamonds } }
      }),
      // Record the payout request as a WalletTransaction (REFUND type = outgoing)
      prisma.walletTransaction.create({
        data: {
          userId:      req.user.id,
          type:        'REFUND',
          coins:       0,
          description: `Payout request: ${diamonds} diamonds → $${netAmount} (after ${platformFee} platform fee)`,
        }
      })
    ]);

    // Notify platform admins about the payout request
    const { getIo } = require('../sockets');
    const io = getIo();
    if (io) {
      io.to('role:SUPER_ADMIN').emit('creator:payout_requested', {
        userId:          req.user.id,
        creatorName:     `${req.user.firstName} ${req.user.lastName}`,
        diamonds,
        usdAmount,
        platformFee,
        netAmount,
        paymentMethod,
        // Don't log full payment details — just flag that they exist
        hasPaymentDetails: true,
        requestedAt:     new Date().toISOString()
      });
    }

    logger.info(`[creator:payout] ${req.user.id} requested ${diamonds} diamonds ($${netAmount} net)`);

    return successResponse(res, {
      diamonds,
      usdAmount,
      platformFee,
      netAmount,
      paymentMethod,
      status: 'PENDING',
      message: 'Payout request submitted. Processing takes 3-5 business days.'
    }, 'Payout request submitted successfully');
  } catch (e) { next(e); }
}

// ─── GET PAYOUT INFO ──────────────────────────────────────────────────────────
async function getPayoutInfo(req, res, next) {
  try {
    const profile = await prisma.creatorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return errorResponse(res, 'Creator profile not found', 404);

    const wallet = await prisma.wallet.findUnique({
      where:  { userId: req.user.id },
      select: { diamonds: true, totalEarned: true }
    });

    const diamonds    = wallet?.diamonds ?? 0;
    const usdValue    = parseFloat((diamonds / DIAMOND_TO_USD).toFixed(2));
    const platformFee = parseFloat((usdValue * 0.1).toFixed(2));
    const netValue    = parseFloat((usdValue - platformFee).toFixed(2));
    const canRequest  = diamonds >= MIN_PAYOUT;

    return successResponse(res, {
      diamonds,
      usdValue,
      platformFee,
      netValue,
      minPayout:       MIN_PAYOUT,
      minPayoutUsd:    parseFloat((MIN_PAYOUT / DIAMOND_TO_USD).toFixed(2)),
      conversionRate:  `${DIAMOND_TO_USD} diamonds = $1`,
      platformFeeRate: '10%',
      canRequest,
      totalEarned:     wallet?.totalEarned ?? 0,
      message:         canRequest
        ? `You can withdraw $${netValue} (after 10% platform fee)`
        : `Minimum ${MIN_PAYOUT} diamonds required. You have ${diamonds}.`
    });
  } catch (e) { next(e); }
}

module.exports = {
  becomeCreator, getCreatorProfile, updateCreatorProfile,
  createTier, updateTier,
  subscribe, unsubscribe,
  sendTip,
  getDashboard, getMySubscriptions,
  requestPayout, getPayoutInfo
};
