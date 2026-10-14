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
 *
 * Ledger: writes a WalletTransaction of type STRIPE_PURCHASE so the reconciliation
 * worker and history endpoint behave the same as the real Stripe path in dev/test.
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

    // Wrap in $transaction so wallet credit and ledger entry are atomic.
    // mirrors the production Stripe path behaviour so the reconciliation worker
    // and GET /wallet/history work correctly in dev/test.
    const wallet = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.upsert({
        where:  { userId: req.user.id },
        create: { userId: req.user.id, coins: totalCoins, diamonds: 0, totalSpent: 0, totalEarned: 0 },
        update: { coins: { increment: totalCoins } }
      });

      // Write STRIPE_PURCHASE ledger entry so history and reconciliation match prod
      await tx.walletTransaction.create({
        data: {
          userId:      req.user.id,
          type:        'STRIPE_PURCHASE',
          coins:       totalCoins,
          description: `Dev mode purchase — ${pkg.name}`,
          packageId:   pkg.id,
          // stripeSessionId intentionally null — this is a dev-only synthetic credit
        }
      });

      return updated;
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
/**
 * Returns a unified paginated list of all WalletTransaction records for the
 * authenticated user. Replaces the old GiftTransaction-only implementation.
 *
 * All types are included: STRIPE_PURCHASE, GIFT_SEND, TIP_SEND, SUBSCRIPTION,
 * ADMIN_GRANT, REFUND, PAYOUT, PAYOUT_REVERSAL, DISPUTED.
 *
 * GIFT_SEND records are enriched with gift name/emoji and receiver details.
 * PAYOUT/PAYOUT_REVERSAL records have accountDetails fully redacted.
 *
 * Security: never returns another user's transaction data.
 */
async function getTransactionHistory(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [records, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where:   { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.walletTransaction.count({ where: { userId: req.user.id } })
    ]);

    // Enrich GIFT_SEND records with gift + receiver details
    // Collect all giftTxIds in one pass to avoid N+1 queries
    const giftTxIds = records
      .filter(r => r.type === 'GIFT_SEND' && r.giftTxId)
      .map(r => r.giftTxId);

    let giftMap = {};
    if (giftTxIds.length > 0) {
      const giftTxs = await prisma.giftTransaction.findMany({
        where:   { id: { in: giftTxIds } },
        select:  {
          id:       true,
          gift:     { select: { name: true, emoji: true, priceCoins: true } },
          receiver: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        }
      });
      giftMap = Object.fromEntries(giftTxs.map(g => [g.id, g]));
    }

    // Build response — enrich and redact as appropriate per type
    const enriched = records.map(r => {
      const base = {
        id:          r.id,
        type:        r.type,
        coins:       r.coins,
        diamonds:    r.diamonds ?? 0,
        description: r.description,
        createdAt:   r.createdAt,
      };

      // GIFT_SEND: include gift details
      if (r.type === 'GIFT_SEND' && r.giftTxId && giftMap[r.giftTxId]) {
        const gx = giftMap[r.giftTxId];
        base.giftDetails = {
          gift:     gx.gift,
          receiver: gx.receiver,
        };
      }

      // STRIPE_PURCHASE: include package reference
      if (r.type === 'STRIPE_PURCHASE' && r.packageId) {
        base.packageId = r.packageId;
      }

      // PAYOUT / PAYOUT_REVERSAL: redact sensitive payout data
      // (accountDetails live on PayoutRequest, not WalletTransaction — nothing to strip here)

      return base;
    });

    return successResponse(res, {
      data:       enriched,
      pagination: { page: parseInt(page), limit: take, total }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

module.exports = { getMyWallet, getCoinPackages, purchaseCoins, getTransactionHistory, ensureWallet };
