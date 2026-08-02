/**
 * Wallet Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages user coin/diamond balances.
 *
 * Coins  — purchased with real money, spent on gifts
 * Diamonds — earned by receiving gifts (50% platform cut applied at send time)
 *
 * Conversion: 100 coins = $1 | 1 coin sent → 0.5 diamonds earned
 */

const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

// ─── Ensure wallet exists (upsert) ───────────────────────────────────────────
async function ensureWallet(userId) {
  return prisma.wallet.upsert({
    where:  { userId },
    create: { userId, coins: 0, diamonds: 0, totalSpent: 0, totalEarned: 0 },
    update: {}
  });
}

// ─── GET /wallet/me ───────────────────────────────────────────────────────────
async function getMyWallet(req, res) {
  try {
    const wallet = await ensureWallet(req.user.id);
    return successResponse(res, wallet);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /wallet/packages ─────────────────────────────────────────────────────
async function getCoinPackages(req, res) {
  try {
    const packages = await prisma.coinPackage.findMany({
      where:   { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });
    return successResponse(res, packages);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/**
 * POST /wallet/purchase
 * Body: { packageId }
 *
 * DEV MODE ONLY — grants coins directly without payment for local testing.
 * In production, use POST /api/v1/stripe/checkout instead.
 */
async function purchaseCoins(req, res) {
  // SECURITY: This endpoint grants coins without real payment.
  // It is only available in development / test environments.
  if (process.env.NODE_ENV === 'production') {
    return errorResponse(
      res,
      'Direct coin purchase is disabled in production. Use /api/v1/stripe/checkout instead.',
      403
    );
  }

  try {
    const { packageId } = req.body;
    if (!packageId) return errorResponse(res, 'packageId is required', 400);

    const pkg = await prisma.coinPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) return errorResponse(res, 'Package not found', 404);

    const totalCoins = pkg.coins + pkg.bonusCoins;

    const wallet = await prisma.wallet.upsert({
      where:  { userId: req.user.id },
      create: { userId: req.user.id, coins: totalCoins, diamonds: 0, totalSpent: 0, totalEarned: 0 },
      update: { coins: { increment: totalCoins } }
    });

    return successResponse(res, {
      wallet,
      purchased: { coins: pkg.coins, bonus: pkg.bonusCoins, total: totalCoins }
    }, `${totalCoins} coins added to your wallet`);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /wallet/history ──────────────────────────────────────────────────────
async function getTransactionHistory(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [sent, received, total] = await Promise.all([
      prisma.giftTransaction.findMany({
        where:   { senderId: req.user.id },
        include: {
          gift:     { select: { name: true, emoji: true, priceCoins: true } },
          receiver: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          room:     { select: { id: true, title: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.giftTransaction.findMany({
        where:   { receiverId: req.user.id },
        include: {
          gift:   { select: { name: true, emoji: true, priceCoins: true } },
          sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          room:   { select: { id: true, title: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.giftTransaction.count({
        where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] }
      })
    ]);

    return successResponse(res, { sent, received, total, page: parseInt(page), limit: take });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

module.exports = { getMyWallet, getCoinPackages, purchaseCoins, getTransactionHistory, ensureWallet };
