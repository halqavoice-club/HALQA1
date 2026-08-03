'use strict';
/**
 * Payout Controller — Diamond → Cash withdrawals
 * ─────────────────────────────────────────────────────────────────────────────
 * Hosts earn diamonds by receiving gifts during live sessions.
 * This controller handles their payout requests to withdraw earnings.
 *
 * Economy:
 *   1 diamond = $0.005 (0.5 cents)
 *   Minimum payout: 2,000 diamonds ($10)
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

const DIAMOND_TO_USD  = 0.005;    // 1 diamond = $0.005
const MIN_PAYOUT_DIAMONDS = 2000; // minimum withdrawal amount
const MIN_PAYOUT_USD  = MIN_PAYOUT_DIAMONDS * DIAMOND_TO_USD; // $10

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

    return paginatedResponse(res, requests, { page: pagination.page, limit: pagination.limit, total });
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
    const { diamonds, method, accountDetails } = req.body;
    const userId = req.user.id;

    // ── Validation ─────────────────────────────────────────────────────────
    const diamondAmount = parseInt(diamonds, 10);
    if (isNaN(diamondAmount) || diamondAmount < MIN_PAYOUT_DIAMONDS) {
      return errorResponse(
        res,
        `Minimum payout is ${MIN_PAYOUT_DIAMONDS} diamonds ($${MIN_PAYOUT_USD.toFixed(2)})`,
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

    // ── Atomic: check balance and deduct diamonds ──────────────────────────
    let payoutRequest;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet || wallet.diamonds < diamondAmount) {
          throw new Error(`INSUFFICIENT_DIAMONDS:${wallet?.diamonds ?? 0}:${diamondAmount}`);
        }

        const updatedWallet = await tx.wallet.update({
          where: { userId },
          data:  { diamonds: { decrement: diamondAmount } }
        });

        const usdAmount = diamondAmount * DIAMOND_TO_USD;

        const request = await tx.payoutRequest.create({
          data: {
            userId,
            diamonds:       diamondAmount,
            usdAmount,
            method,
            accountDetails: JSON.stringify(accountDetails || {}),
            status:         'PENDING',
          }
        });

        return { request, updatedWallet };
      });

      payoutRequest = result.request;
    } catch (txErr) {
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

    // Refund diamonds atomically
    await prisma.$transaction([
      prisma.payoutRequest.update({
        where: { id },
        data:  { status: 'CANCELLED' }
      }),
      prisma.wallet.update({
        where: { userId },
        data:  { diamonds: { increment: request.diamonds } }
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

    return paginatedResponse(res, requests, { page: pagination.page, limit: pagination.limit, total });
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

    // If rejecting, refund diamonds
    if (action === 'reject') {
      await prisma.$transaction([
        prisma.payoutRequest.update({
          where: { id },
          data:  { status: newStatus, adminNote: adminNote || null }
        }),
        prisma.wallet.update({
          where: { userId: request.userId },
          data:  { diamonds: { increment: request.diamonds } }
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
  getPayoutHistory,
  requestPayout,
  cancelPayout,
  listPayoutsAdmin,
  processPayoutAdmin,
};
