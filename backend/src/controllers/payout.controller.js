'use strict';
/**
 * Payout Controller — Diamond → Cash withdrawals
 * ─────────────────────────────────────────────────────────────────────────────
 * Hosts earn diamonds by receiving gifts during live sessions.
 * This controller handles their payout requests to withdraw earnings.
 *
 * Economy (see backend/src/services/economy.config.js for authoritative values):
 *   1 diamond = $0.005 (0.5 cents)  [DIAMOND_TO_USD]
 *   Minimum payout: 2,000 diamonds ($10)  [PAYOUT_MIN_DIAMONDS]
 *   Platform processes payouts manually via Stripe Transfer or bank transfer.
 *   Status flow: PENDING → APPROVED → PROCESSING → COMPLETED | REJECTED
 *
 * Security:
 *   - Diamond balance is checked atomically inside a transaction
 *   - Diamonds are held (deducted immediately on request) so double-requests
 *     cannot succeed
 *   - TOTP_ENCRYPTION_KEY / JWT auth required
 *   - Admin-only approval endpoints are protected by SCHOOL_ADMIN / SUPER_ADMIN role
 */

const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination } = require('../utils/response');
const logger = require('../utils/logger');
const { PAYOUT_MIN_DIAMONDS, toUsd } = require('../services/economy.config');
const { encrypt, decrypt, maskAccountDetails, isEncrypted } = require('../utils/encryption');

// Convenience alias so the rest of this file reads naturally
const MIN_PAYOUT_DIAMONDS = PAYOUT_MIN_DIAMONDS;

// ─── Startup guard: block payout creation if encryption key is missing ─────────
// We check at module load time so a misconfigured deployment fails fast rather
// than storing plaintext on the first real payout request.
let _encryptionReady = false;
try {
  // Attempt a trivial encrypt to validate the key is usable
  encrypt('halqa_payout_key_check');
  _encryptionReady = true;
} catch (err) {
  logger.error(
    '[payout] PAYOUT_ENCRYPTION_KEY is missing or invalid — payout requests will be BLOCKED until the key is set. ' +
    `Error: ${err.message}`
  );
}

// ─── GET /wallet/payout/info ─────────────────────────────────────────────────
/**
 * Returns server-calculated payout eligibility and economy rates.
 * Replaces the deprecated GET /api/v1/creators/me/payout-info.
 * All values are calculated server-side — frontend must NEVER hardcode these.
 */
async function getPayoutInfo(req, res) {
  try {
    const wallet = await prisma.wallet.findUnique({
      where:  { userId: req.user.id },
      select: { diamonds: true, totalEarned: true }
    });

    const diamonds = wallet?.diamonds ?? 0;
    const usdValue = toUsd(diamonds);
    const canRequest = diamonds >= MIN_PAYOUT_DIAMONDS;

    // Check for existing pending request
    const pendingRequest = await prisma.payoutRequest.findFirst({
      where:   { userId: req.user.id, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } },
      select:  { id: true, status: true, diamonds: true, usdAmount: true, createdAt: true }
    });

    return successResponse(res, {
      diamonds,
      usdValue:          usdValue.toFixed(2),
      minPayoutDiamonds: MIN_PAYOUT_DIAMONDS,
      minPayoutUsd:      toUsd(MIN_PAYOUT_DIAMONDS).toFixed(2),
      diamondToUsd:      require('../services/economy.config').DIAMOND_TO_USD,
      platformSharePercent: require('../services/economy.config').PLATFORM_SHARE_PERCENT,
      canRequest,
      totalEarned:       wallet?.totalEarned ?? 0,
      pendingRequest:    pendingRequest || null,
      message: canRequest
        ? `You can withdraw $${usdValue.toFixed(2)}`
        : `Minimum ${MIN_PAYOUT_DIAMONDS} diamonds required. You have ${diamonds}.`
    });
  } catch (err) {
    logger.error('[payout:info]', err.message);
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /wallet/payout/history ──────────────────────────────────────────────
async function getPayoutHistory(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const [requests, total] = await Promise.all([
      prisma.payoutRequest.findMany({
        where:   { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pagination.limit,
      }),
      prisma.payoutRequest.count({ where: { userId: req.user.id } })
    ]);

    // Fully redact accountDetails from user-facing response —
    // users must not receive their own stored (encrypted) account details back.
    const redacted = requests.map(r => {
      const { accountDetails: _stripped, ...rest } = r;
      return { ...rest, accountDetails: {} };
    });

    return paginatedResponse(res, redacted, { page: pagination.page, limit: pagination.limit, total });
  } catch (err) {
    logger.error('[payout:history]', err.message);
    return errorResponse(res, err.message, 500);
  }
}

// ─── POST /wallet/payout/request ─────────────────────────────────────────────
/**
 * Submit a diamond-to-cash payout request.
 * Body: { diamonds, method, accountDetails }
 *   diamonds       — how many diamonds to withdraw (min 2000)
 *   method         — 'bank_transfer' | 'paypal' | 'stripe'
 *   accountDetails — object with method-specific fields
 */
async function requestPayout(req, res) {
  try {
    // ── Encryption guard ──────────────────────────────────────────────────
    if (!_encryptionReady) {
      logger.error('[payout:request] Blocked: PAYOUT_ENCRYPTION_KEY is not configured');
      return errorResponse(res, 'Payout service is temporarily unavailable. Please contact support.', 503);
    }

    const { diamonds, method, accountDetails } = req.body;
    const userId = req.user.id;

    // ── Validation ─────────────────────────────────────────────────────────
    const diamondAmount = parseInt(diamonds, 10);
    if (isNaN(diamondAmount) || diamondAmount < MIN_PAYOUT_DIAMONDS) {
      return errorResponse(
        res,
        `Minimum payout is ${MIN_PAYOUT_DIAMONDS} diamonds ($${toUsd(MIN_PAYOUT_DIAMONDS).toFixed(2)})`,
        400
      );
    }

    const validMethods = ['bank_transfer', 'paypal', 'stripe'];
    if (!validMethods.includes(method)) {
      return errorResponse(res, `method must be one of: ${validMethods.join(', ')}`, 400);
    }

    // ── Check for pending requests ─────────────────────────────────────────
    const hasPending = await prisma.payoutRequest.findFirst({
      where: { userId, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } }
    });
    if (hasPending) {
      return errorResponse(res, 'You already have a pending payout request. Wait for it to complete.', 400);
    }

    // ── Atomic: check balance, deduct diamonds, create payout, write ledger ──────
    // Three operations in one transaction:
    //   1. Optimistic-lock wallet update (WHERE diamonds >= amount) — race-safe
    //   2. PayoutRequest.create — the payout record
    //   3. WalletTransaction.create type=PAYOUT — the auditable ledger entry
    //
    // If two concurrent requests race here, only one can win the optimistic lock.
    // The loser gets P2025 (record not found) → rolls back → returns 402.
    let payoutRequest;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Optimistic-lock deduction: only succeeds if diamonds >= diamondAmount
        //    P2025 is thrown if no row matches (insufficient balance under concurrency)
        const updatedWallet = await tx.wallet.update({
          where: { userId, diamonds: { gte: diamondAmount } },
          data:  { diamonds: { decrement: diamondAmount } }
        });

        const usdAmount = toUsd(diamondAmount);

        // 2. Create the payout request record
        const request = await tx.payoutRequest.create({
          data: {
            userId,
            diamonds:       diamondAmount,
            usdAmount,
            method,
            accountDetails: encrypt(JSON.stringify(accountDetails || {})),
            status:         'PENDING',
          }
        });

        // 3. Write PAYOUT ledger entry — fatal (no .catch)
        //    diamonds is negative: diamonds are being reserved/deducted
        await tx.walletTransaction.create({
          data: {
            userId,
            type:        'PAYOUT',
            coins:       0,
            diamonds:    -diamondAmount,
            description: `Payout request ${request.id}: ${diamondAmount} diamonds reserved`,
          }
        });

        return { request, updatedWallet };
      });

      payoutRequest = result.request;
    } catch (txErr) {
      // P2025 = optimistic lock miss (insufficient diamonds at commit time)
      if (txErr.code === 'P2025' || txErr.message?.includes('Record to update not found')) {
        const currentWallet = await prisma.wallet.findUnique({
          where:  { userId },
          select: { diamonds: true }
        });
        return errorResponse(
          res,
          `Insufficient diamonds. You have ${currentWallet?.diamonds ?? 0}, requested ${diamondAmount}`,
          402
        );
      }
      if (txErr.message?.startsWith('INSUFFICIENT_DIAMONDS:')) {
        const [, have, need] = txErr.message.split(':');
        return errorResponse(
          res,
          `Insufficient diamonds. You have ${have}, requested ${need}`,
          402
        );
      }
      throw txErr;
    }

    logger.info(`[payout] Request ${payoutRequest.id} submitted by user ${userId} for ${diamondAmount} diamonds`);

    return successResponse(res, {
      request:    payoutRequest,
      usdAmount:  payoutRequest.usdAmount,
      message:    `Payout request submitted. Processing within 3-5 business days.`
    }, 'Payout request submitted', 201);
  } catch (err) {
    logger.error('[payout:request]', err.message);
    return errorResponse(res, err.message, 500);
  }
}

// ─── DELETE /wallet/payout/:id — Cancel a pending request ────────────────────
async function cancelPayout(req, res) {
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    const request = await prisma.payoutRequest.findUnique({ where: { id } });
    if (!request || request.userId !== userId) {
      return errorResponse(res, 'Payout request not found', 404);
    }
    if (request.status !== 'PENDING') {
      return errorResponse(res, `Cannot cancel a ${request.status} payout request`, 400);
    }

    // Refund diamonds atomically with PAYOUT_REVERSAL ledger entry
    await prisma.$transaction([
      prisma.payoutRequest.update({
        where: { id },
        data:  { status: 'CANCELLED' }
      }),
      prisma.wallet.update({
        where: { userId },
        data:  { diamonds: { increment: request.diamonds } }
      }),
      prisma.walletTransaction.create({
        data: {
          userId,
          type:        'PAYOUT_REVERSAL',
          coins:       0,
          diamonds:    +request.diamonds,
          description: `Payout request ${id} cancelled by user — diamonds restored`,
        }
      })
    ]);

    return successResponse(res, null, 'Payout request cancelled and diamonds refunded.');
  } catch (err) {
    logger.error('[payout:cancel]', err.message);
    return errorResponse(res, err.message, 500);
  }
}

// ─── GET /admin/payouts — List all pending (admin only) ──────────────────────
async function listPayoutsAdmin(req, res) {
  try {
    const { status = 'PENDING', page = 1, limit = 50 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    const [requests, total] = await Promise.all([
      prisma.payoutRequest.findMany({
        where:   { status },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } }
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pagination.limit,
      }),
      prisma.payoutRequest.count({ where: { status } })
    ]);

    // Decrypt and mask accountDetails for admin — never return full account numbers
    const masked = requests.map(r => {
      let accountSummary = { accountHolder: '', accountLast4: '****' };
      try {
        const raw = r.accountDetails;
        if (raw) {
          // Support both legacy plaintext JSON and new encrypted format
          const decrypted = isEncrypted(raw) ? decrypt(raw) : raw;
          accountSummary = maskAccountDetails(decrypted);
        }
      } catch (err) {
        logger.warn(`[payout:admin] Could not decrypt accountDetails for payout ${r.id}: ${err.message}`);
      }
      // Return record with masked summary, never raw accountDetails
      const { accountDetails: _stripped, ...rest } = r;
      return { ...rest, accountSummary };
    });

    return paginatedResponse(res, masked, { page: pagination.page, limit: pagination.limit, total });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── PATCH /admin/payouts/:id — Approve or reject (admin only) ───────────────
async function processPayoutAdmin(req, res) {
  try {
    const { id } = req.params;
    const { action, adminNote, transactionRef } = req.body;
    // action: 'approve' | 'reject' | 'complete'

    const request = await prisma.payoutRequest.findUnique({
      where:   { id },
      include: { user: { select: { id: true, email: true, firstName: true } } }
    });
    if (!request) return errorResponse(res, 'Payout request not found', 404);

    const VALID_TRANSITIONS = {
      approve:  ['PENDING'],
      reject:   ['PENDING', 'APPROVED'],
      complete: ['PROCESSING', 'APPROVED'],
    };

    if (!VALID_TRANSITIONS[action]) {
      return errorResponse(res, `action must be one of: ${Object.keys(VALID_TRANSITIONS).join(', ')}`, 400);
    }
    if (!VALID_TRANSITIONS[action].includes(request.status)) {
      return errorResponse(res, `Cannot ${action} a ${request.status} payout request`, 400);
    }

    const statusMap = { approve: 'APPROVED', reject: 'REJECTED', complete: 'COMPLETED' };
    const newStatus = statusMap[action];

    // If rejecting, refund diamonds with PAYOUT_REVERSAL ledger entry
    if (action === 'reject') {
      await prisma.$transaction([
        prisma.payoutRequest.update({
          where: { id },
          data:  { status: newStatus, adminNote: adminNote || null }
        }),
        prisma.wallet.update({
          where: { userId: request.userId },
          data:  { diamonds: { increment: request.diamonds } }
        }),
        prisma.walletTransaction.create({
          data: {
            userId:      request.userId,
            type:        'PAYOUT_REVERSAL',
            coins:       0,
            diamonds:    +request.diamonds,
            description: `Payout request ${id} rejected by admin ${req.user.id}${adminNote ? ': ' + adminNote.substring(0, 80) : ''} — diamonds restored`,
          }
        })
      ]);
    } else {
      await prisma.payoutRequest.update({
        where: { id },
        data:  {
          status:         newStatus,
          adminNote:      adminNote || null,
          transactionRef: transactionRef || null,
          processedAt:    new Date()
        }
      });
    }

    logger.info(`[payout] Admin ${req.user.id} ${action}d payout ${id} for user ${request.userId}`);
    return successResponse(res, null, `Payout ${action}d successfully`);
  } catch (err) {
    logger.error('[payout:admin-process]', err.message);
    return errorResponse(res, err.message, 500);
  }
}

module.exports = {
  getPayoutInfo,
  getPayoutHistory,
  requestPayout,
  cancelPayout,
  listPayoutsAdmin,
  processPayoutAdmin,
};
