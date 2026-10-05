'use strict';
/**
 * admin-actions.routes.js — HALQA Platform Admin Action Endpoints
 * Mounted at: /api/v1/admin/actions
 *
 * SECURITY: SUPER_ADMIN only + IP allowlist
 *
 * Sprint 2 — LS-GAP-001 / UIGAP-007:
 *   Dedicated admin-only termination endpoints that bypass content-participation
 *   authorization. These are PLATFORM ADMINISTRATION actions, not content
 *   participation — SUPER_ADMIN does not join the room as a participant.
 *
 * Sprint 8 — PAY-GAP-001 / PAY-GAP-002:
 *   POST /transactions/:id/refund — refund a coin purchase + optional Stripe refund
 *
 * Routes:
 *   POST /live-classes/:id/terminate     — force-end any live class
 *   POST /voice/:id/terminate            — force-archive any voice room
 *   POST /users/:id/grant-coins          — admin coin grant (UIGAP-005)
 *   GET  /users/:id/sessions             — list active sessions (UIGAP-002)
 *   DELETE /users/:id/sessions           — revoke all sessions (UIGAP-002)
 *   POST /transactions/:id/refund        — refund a coin transaction (PAY-GAP-001/002)
 */

const router  = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
const prisma  = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');
const { getIo } = require('../sockets');
const logger  = require('../utils/logger');

// Three-layer guard: IP allowlist + JWT + SUPER_ADMIN role
router.use(ipAllowlist);
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

// ─── Helper: write audit log (fire-and-forget) ────────────────────────────────
async function adminAudit(actorId, action, entity, entityId, meta = {}, ipAddress) {
  try {
    await prisma.auditLog.create({
      data: {
        id:        uuidv4(),
        userId:    actorId,
        action:    'UPDATE',
        entity,
        entityId,
        newValues: { action, ...meta },
        ipAddress: ipAddress || null,
      }
    });
  } catch (err) {
    logger.warn(`[admin-actions] Audit log failed: ${err.message}`);
  }
}

// ─── POST /api/v1/admin/actions/live-classes/:id/terminate ───────────────────
/**
 * Force-terminate any live class for platform moderation.
 *
 * This is a PLATFORM ADMINISTRATION action — it does NOT create a
 * LiveClassParticipant record for the admin. The admin never joins the room.
 *
 * Effect: same as host calling POST /live-classes/:id/end but without
 * requiring the caller to be HOST or school staff.
 *
 * Writes an audit log entry with the admin's identity.
 */
router.post('/live-classes/:id/terminate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    const lc = await prisma.liveClass.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, title: true }
    });

    if (!lc) return errorResponse(res, 'Live class not found', 404);
    if (lc.status === 'ENDED' || lc.status === 'CANCELLED') {
      return errorResponse(res, 'Live class has already ended', 400);
    }

    const now = new Date();

    // Mark all active participants inactive
    await prisma.liveClassParticipant.updateMany({
      where: { liveClassId: id, isActive: true },
      data:  { isActive: false, leftAt: now }
    });

    // End the class via raw SQL (consistent with existing controller pattern)
    await prisma.$executeRawUnsafe(
      `UPDATE live_classes SET status = 'ENDED', endedAt = ?, updatedAt = ? WHERE id = ?`,
      now, now, id
    );

    // Notify all room participants via Socket.IO
    const io = getIo();
    if (io) {
      io.to(`liveclass:${id}`).emit('liveclass:ended', {
        liveClassId: id,
        reason: 'terminated_by_admin'
      });
    }

    // Write audit log — UIGAP-013 fix: admin terminations are now audited
    await adminAudit(adminId, 'ADMIN_TERMINATE_LIVE_CLASS', 'live_class', id,
      { title: lc.title, reason: reason || null, previousStatus: lc.status },
      req.ip
    );

    logger.info(`[admin-actions] Live class ${id} terminated by admin ${adminId}`);

    return successResponse(res, { liveClassId: id, status: 'ENDED' },
      `Live class "${lc.title}" terminated`);
  } catch (err) { next(err); }
});

// ─── POST /api/v1/admin/actions/voice/:id/terminate ──────────────────────────
/**
 * Force-archive any voice room for platform moderation.
 *
 * This is a PLATFORM ADMINISTRATION action — it does NOT create a
 * VoiceParticipant record for the admin. The admin never joins the room.
 *
 * Effect: same as SUPER_ADMIN calling PATCH /voice/:id/end but through a
 * dedicated admin route with mandatory audit logging.
 *
 * Writes an audit log entry with the admin's identity.
 */
router.post('/voice/:id/terminate', async (req, res, next) => {
  try {
    const { id: roomId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, title: true, hostId: true, deletedAt: true }
    });

    if (!room || room.deletedAt) return errorResponse(res, 'Voice room not found', 404);
    if (room.status === 'ENDED') {
      return errorResponse(res, 'Voice room has already been archived', 400);
    }

    const now = new Date();

    // Mark all active participants inactive
    await prisma.voiceParticipant.updateMany({
      where: { roomId, isActive: true },
      data:  { isActive: false, leftAt: now }
    });

    // Archive the room
    await prisma.voiceRoom.update({
      where: { id: roomId },
      data:  { status: 'ENDED', endedAt: now, updatedAt: now }
    });

    // Notify via Socket.IO
    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:room_ended', { roomId });
      io.to('voice:lobby').emit('voice:room_deleted', { roomId });
    }

    // Write audit log — UIGAP-013 fix: admin terminations are now audited
    await adminAudit(adminId, 'ADMIN_TERMINATE_VOICE_ROOM', 'VoiceRoom', roomId,
      { title: room.title, reason: reason || null, previousStatus: room.status },
      req.ip
    );

    logger.info(`[admin-actions] Voice room ${roomId} terminated by admin ${adminId}`);

    return successResponse(res, { roomId, status: 'ENDED' },
      `Voice room "${room.title}" archived`);
  } catch (err) { next(err); }
});

module.exports = router;

// ─── POST /api/v1/admin/actions/users/:id/grant-coins ────────────────────────
/**
 * Grant coins to a user as a platform administrative action.
 *
 * UIGAP-005 FIX: Implements the ADMIN_GRANT WalletTransaction type that was
 * present in the schema but had no API endpoint.
 *
 * Requirements (INVARIANT-006):
 * - Atomic transaction (wallet update + ledger entry)
 * - Idempotency key to prevent double-grant on retry
 * - Must not result in negative balance (grants are always positive)
 * - Full audit log entry written
 * - User receives a socket notification
 *
 * Body: { coins: number (1–100000), reason: string (required, min 10 chars), idempotencyKey?: string }
 */
router.post('/users/:id/grant-coins', async (req, res, next) => {
  try {
    const { id: targetUserId } = req.params;
    const adminId = req.user.id;
    const { coins, reason, idempotencyKey } = req.body;

    // Validation
    const coinsInt = parseInt(coins, 10);
    if (!coinsInt || coinsInt < 1 || coinsInt > 100_000) {
      return errorResponse(res, 'coins must be an integer between 1 and 100,000', 400);
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return errorResponse(res, 'reason is required (minimum 10 characters)', 400);
    }

    // Find target user
    const target = await prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true }
    });
    if (!target) return errorResponse(res, 'User not found', 404);

    // Idempotency check — P2-004 FIX: Use WalletTransaction.idempotencyKey unique field
    // instead of fragile description.contains() string search.
    // The @unique constraint on idempotencyKey is the authoritative DB-level guard.
    const iKey = idempotencyKey || uuidv4();
    const existing = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: iKey }
    });
    if (existing) {
      return res.status(200).json({
        success: true,
        data: existing,
        message: 'Grant already processed (idempotent)',
        duplicate: true
      });
    }

    // Atomic: credit coins + write ledger entry
    let transaction;
    await prisma.$transaction(async (tx) => {
      // Ensure wallet exists
      await tx.wallet.upsert({
        where:  { userId: targetUserId },
        create: { userId: targetUserId, coins: coinsInt, diamonds: 0, totalSpent: 0, totalEarned: 0 },
        update: { coins: { increment: coinsInt } }
      });

      transaction = await tx.walletTransaction.create({
        data: {
          id:             uuidv4(),
          userId:         targetUserId,
          type:           'ADMIN_GRANT',
          coins:          coinsInt,   // positive = credit
          description:    `Admin grant by ${adminId} — ${reason.trim()}`,
          idempotencyKey: iKey,       // P2-004: unique constraint prevents duplicate grants
        }
      });
    });

    // Notify user via socket
    const io = getIo();
    if (io) {
      io.to(`user:${targetUserId}`).emit('wallet:coins_credited', {
        coins:       coinsInt,
        packageId:   null,
        type:        'ADMIN_GRANT',
        description: `${coinsInt} coins granted by platform admin`,
      });
      io.to(`wallet:${targetUserId}`).emit('wallet:coins_credited', {
        coins:       coinsInt,
        type:        'ADMIN_GRANT',
      });
    }

    // Audit log
    await adminAudit(adminId, 'ADMIN_COIN_GRANT', 'wallet', targetUserId,
      { coins: coinsInt, reason: reason.trim(), targetEmail: target.email },
      req.ip
    );

    logger.info(`[admin-actions] ${coinsInt} coins granted to ${targetUserId} by admin ${adminId}`);

    return successResponse(res, { transaction, coinsGranted: coinsInt, targetUser: target },
      `${coinsInt} coins granted to ${target.firstName} ${target.lastName}`);
  } catch (err) { next(err); }
});

// ─── GET /api/v1/admin/actions/users/:id/sessions ────────────────────────────
/**
 * List a user's active sessions.
 * UIGAP-002 FIX: Platform admin can now inspect session activity.
 */
router.get('/users/:id/sessions', async (req, res, next) => {
  try {
    const { id: targetUserId } = req.params;
    const target = await prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true }
    });
    if (!target) return errorResponse(res, 'User not found', 404);

    const sessions = await prisma.session.findMany({
      where: { userId: targetUserId, isActive: true },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true, deviceName: true, deviceType: true,
        ipAddress: true, lastSeenAt: true, createdAt: true,
      }
    });

    const refreshCount = await prisma.refreshToken.count({
      where: { userId: targetUserId, isRevoked: false, expiresAt: { gt: new Date() } }
    });

    return successResponse(res, {
      user: target,
      sessions,
      activeSessionCount: sessions.length,
      activeRefreshTokens: refreshCount,
    });
  } catch (err) { next(err); }
});

// ─── DELETE /api/v1/admin/actions/users/:id/sessions ─────────────────────────
/**
 * Revoke all active sessions and refresh tokens for a user.
 * UIGAP-002 FIX: Force-logout a user without suspending their account.
 * Use case: compromised credential; security incident; account handover.
 *
 * Effect:
 * 1. Mark all Session records inactive
 * 2. Revoke all active RefreshTokens
 * 3. Invalidate Redis auth cache (next request re-reads from DB)
 * 4. Write audit log
 */
router.delete('/users/:id/sessions', async (req, res, next) => {
  try {
    const { id: targetUserId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    if (adminId === targetUserId) {
      return errorResponse(res, 'Cannot revoke your own sessions via this endpoint', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true, role: true }
    });
    if (!target) return errorResponse(res, 'User not found', 404);
    if (target.role === 'SUPER_ADMIN') {
      return errorResponse(res, 'Cannot revoke sessions of another SUPER_ADMIN', 403);
    }

    const now = new Date();

    // 1. Terminate all active Session records
    const sessionResult = await prisma.session.updateMany({
      where: { userId: targetUserId, isActive: true },
      data:  { isActive: false, terminatedAt: now, terminationReason: 'ADMIN_REVOKE' }
    });

    // 2. Revoke all active RefreshTokens
    const tokenResult = await prisma.refreshToken.updateMany({
      where: { userId: targetUserId, isRevoked: false },
      data:  { isRevoked: true }
    });

    // 3. Invalidate Redis auth cache so next request re-reads from DB
    const { invalidateUserCache } = require('../middleware/auth.middleware');
    await invalidateUserCache(targetUserId);

    // 4. Audit log — INVARIANT-005: privileged admin actions must be audited
    await adminAudit(adminId, 'ADMIN_REVOKE_ALL_SESSIONS', 'user_sessions', targetUserId,
      {
        sessionsTerminated: sessionResult.count,
        tokensRevoked: tokenResult.count,
        reason: reason || null,
        targetEmail: target.email,
      },
      req.ip
    );

    logger.info(`[admin-actions] All sessions revoked for ${targetUserId} by admin ${adminId} — ${sessionResult.count} sessions, ${tokenResult.count} tokens`);

    return successResponse(res, {
      sessionsTerminated: sessionResult.count,
      tokensRevoked:      tokenResult.count,
    }, `All sessions revoked for ${target.firstName} ${target.lastName}. They will be logged out on next request.`);
  } catch (err) { next(err); }
});

// ─── POST /api/v1/admin/actions/transactions/:id/refund ──────────────────────
/**
 * PAY-GAP-001 FIX: Refund a coin transaction.
 * PAY-GAP-002 FIX: Optionally issue a Stripe refund for STRIPE_PURCHASE transactions.
 *
 * This is a PLATFORM ADMINISTRATION action for:
 *   - Reversing erroneous ADMIN_GRANT coin credits
 *   - Refunding STRIPE_PURCHASE transactions (coins deducted + Stripe refund issued)
 *   - Cannot refund GIFT_SEND / TIP_SEND transactions (gift economy is non-refundable
 *     by platform policy — separate dispute flow required)
 *
 * Safety rules (INVARIANT-006):
 *   1. Transaction must exist and belong to a non-deleted user
 *   2. Transaction must not already be refunded (idempotency — checks for existing REFUND tx)
 *   3. Coin deduction is atomic: REFUND ledger entry + wallet.coins decrement in one tx
 *   4. Wallet.coins cannot go below zero (guard prevents over-refund)
 *   5. Stripe refund is fire-and-forget after the DB tx succeeds:
 *      - If Stripe fails, the coin refund still stands (admin can retry the Stripe part)
 *      - The Stripe refund ID is stored in the audit log
 *   6. Full audit log written
 *   7. User receives a socket + persistent notification
 *
 * Body:
 *   { reason: string (required, min 10 chars), stripeRefund?: boolean (default: true for STRIPE_PURCHASE) }
 *
 * Refundable types:
 *   STRIPE_PURCHASE — coins refunded + Stripe refund attempted
 *   ADMIN_GRANT     — coins reversed only (no Stripe)
 *
 * Non-refundable types (returns 400):
 *   GIFT_SEND, TIP_SEND, SUBSCRIPTION, REFUND (can't refund a refund)
 */
router.post('/transactions/:id/refund', async (req, res, next) => {
  try {
    const { id: txId }          = req.params;
    const adminId               = req.user.id;
    const { reason, stripeRefund = true } = req.body;

    // ── Input validation ───────────────────────────────────────────────────────
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return errorResponse(res, 'reason is required (minimum 10 characters)', 400);
    }

    // ── Load transaction ───────────────────────────────────────────────────────
    const tx = await prisma.walletTransaction.findUnique({
      where: { id: txId },
      select: {
        id: true, userId: true, type: true, coins: true,
        description: true, stripeSessionId: true, packageId: true,
        createdAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true } }
      }
    });

    if (!tx)              return errorResponse(res, 'Transaction not found', 404);
    if (tx.user.deletedAt) return errorResponse(res, 'User account has been deleted', 404);

    // ── Non-refundable types ───────────────────────────────────────────────────
    const NON_REFUNDABLE = ['GIFT_SEND', 'TIP_SEND', 'SUBSCRIPTION', 'REFUND'];
    if (NON_REFUNDABLE.includes(tx.type)) {
      return errorResponse(res,
        `Transaction type '${tx.type}' cannot be refunded via this endpoint. Only STRIPE_PURCHASE and ADMIN_GRANT transactions are refundable.`,
        400
      );
    }

    const REFUNDABLE = ['STRIPE_PURCHASE', 'ADMIN_GRANT'];
    if (!REFUNDABLE.includes(tx.type)) {
      return errorResponse(res, `Unknown transaction type '${tx.type}'`, 400);
    }

    // ── Idempotency: check if already refunded ─────────────────────────────────
    const existingRefund = await prisma.walletTransaction.findFirst({
      where: { userId: tx.userId, type: 'REFUND', description: { contains: txId } }
    });
    if (existingRefund) {
      return errorResponse(res,
        `Transaction ${txId} has already been refunded (refund tx: ${existingRefund.id})`,
        409
      );
    }

    // ── Coin amount to reverse ─────────────────────────────────────────────────
    // Original tx.coins is positive (it was a credit). Refund deducts that amount.
    const coinsToDeduct = Math.abs(tx.coins);
    if (coinsToDeduct === 0) {
      return errorResponse(res, 'Transaction has zero coins — nothing to refund', 400);
    }

    // ── Load wallet and check balance ──────────────────────────────────────────
    const wallet = await prisma.wallet.findUnique({
      where:  { userId: tx.userId },
      select: { coins: true }
    });
    const currentCoins = wallet?.coins ?? 0;

    if (currentCoins < coinsToDeduct) {
      return errorResponse(res,
        `User only has ${currentCoins} coins but refund requires ${coinsToDeduct}. Partial refunds are not supported.`,
        400
      );
    }

    // ── Atomic DB transaction: deduct coins + write REFUND ledger entry ────────
    let refundTx;
    await prisma.$transaction(async (db) => {
      // Deduct coins from wallet
      await db.wallet.update({
        where: { userId: tx.userId },
        data:  { coins: { decrement: coinsToDeduct } }
      });

      // Write REFUND ledger entry — negative coins = debit
      refundTx = await db.walletTransaction.create({
        data: {
          id:          uuidv4(),
          userId:      tx.userId,
          type:        'REFUND',
          coins:       -coinsToDeduct,   // negative = debit
          description: `Refund of tx ${txId} by admin ${adminId} — ${reason.trim()}`,
          packageId:   tx.packageId ?? null,
        }
      });
    });

    logger.info(`[admin-actions] Refunded ${coinsToDeduct} coins for tx ${txId} (user ${tx.userId}) by admin ${adminId}`);

    // ── Stripe refund (PAY-GAP-002) ────────────────────────────────────────────
    // Only attempted for STRIPE_PURCHASE transactions with a stripeSessionId.
    // Fire-and-forget after DB commit: if Stripe fails, coins are still refunded;
    // admin can re-trigger the Stripe refund manually from the Stripe dashboard.
    let stripeRefundResult = null;
    if (tx.type === 'STRIPE_PURCHASE' && tx.stripeSessionId && stripeRefund !== false) {
      try {
        const Stripe = require('stripe');
        const key    = process.env.STRIPE_SECRET_KEY;
        // Only init Stripe if key looks real (not a placeholder or dev template)
        const isPlaceholder = !key
          || key.includes('REPLACE')
          || key === 'your_stripe_secret_key'
          || key.length < 20;
        if (!isPlaceholder) {
          const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });

          // Retrieve the Checkout session to get the payment intent ID
          const session = await stripe.checkout.sessions.retrieve(tx.stripeSessionId);
          const paymentIntentId = session.payment_intent;

          if (paymentIntentId) {
            const refund = await stripe.refunds.create({
              payment_intent: paymentIntentId,
              reason:         'requested_by_customer',
            });
            stripeRefundResult = { refundId: refund.id, status: refund.status };
            logger.info(`[admin-actions] Stripe refund ${refund.id} created for session ${tx.stripeSessionId}`);
          } else {
            stripeRefundResult = { error: 'No payment_intent found on Stripe session' };
            logger.warn(`[admin-actions] Stripe session ${tx.stripeSessionId} has no payment_intent`);
          }
        } else {
          stripeRefundResult = { skipped: 'Stripe not configured' };
        }
      } catch (stripeErr) {
        // Non-fatal — DB refund already committed
        stripeRefundResult = { error: stripeErr.message };
        logger.error(`[admin-actions] Stripe refund failed for session ${tx.stripeSessionId}: ${stripeErr.message}`);
      }
    }

    // ── Notify user via socket ─────────────────────────────────────────────────
    const io = getIo();
    if (io) {
      io.to(`user:${tx.userId}`).emit('wallet:coins_deducted', {
        coins:       coinsToDeduct,
        type:        'REFUND',
        description: `${coinsToDeduct} coins refunded by platform admin`,
      });
      io.to(`wallet:${tx.userId}`).emit('wallet:coins_deducted', {
        coins: coinsToDeduct,
        type:  'REFUND',
      });
    }

    // ── Audit log (INVARIANT-005 + INVARIANT-006) ──────────────────────────────
    await adminAudit(adminId, 'ADMIN_REFUND_TRANSACTION', 'wallet_transaction', txId,
      {
        originalTxId:   txId,
        originalType:   tx.type,
        coinsRefunded:  coinsToDeduct,
        refundTxId:     refundTx.id,
        reason:         reason.trim(),
        targetEmail:    tx.user.email,
        stripeSessionId: tx.stripeSessionId ?? null,
        stripeRefund:   stripeRefundResult,
      },
      req.ip
    );

    return successResponse(res, {
      refundTransaction: refundTx,
      coinsRefunded:     coinsToDeduct,
      originalTx: {
        id:   txId,
        type: tx.type,
        stripeSessionId: tx.stripeSessionId ?? null,
      },
      stripeRefund: stripeRefundResult,
      targetUser: {
        id:    tx.user.id,
        email: tx.user.email,
      },
    }, `${coinsToDeduct} coins refunded for transaction ${txId}${stripeRefundResult?.refundId ? ` (Stripe refund ${stripeRefundResult.refundId})` : ''}`);

  } catch (err) { next(err); }
});

// ─── GET /api/v1/admin/actions/voice/:id/inspect ─────────────────────────────
/**
 * VC-GAP-003 FIX: Admin voice room inspection without participation.
 *
 * SUPER_ADMIN can inspect any voice room for moderation purposes without
 * joining as a participant or receiving a LiveKit token.
 *
 * This endpoint bypasses the privacy gate that normal users see on GET /voice/:id
 * because platform admins need to be able to inspect PRIVATE/INVITE_ONLY rooms
 * during abuse investigations. The admin NEVER appears in the participant list.
 *
 * Returns:
 *   - Room metadata (title, privacy, status, host, school)
 *   - Active participant list (user info, role, joinedAt, isMuted)
 *   - Banned users list
 *   - Message count (not messages themselves — privacy preserved)
 *   - Room statistics (total joins, peak concurrent, duration)
 *
 * Writes an audit log entry so every admin room inspection is traceable.
 */
router.get('/voice/:id/inspect', async (req, res, next) => {
  try {
    const { id: roomId } = req.params;
    const adminId = req.user.id;

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        school: { select: { id: true, name: true } },
        participants: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } }
          },
          orderBy: { joinedAt: 'asc' },
        },
        _count: {
          select: {
            participants: true,                          // total ever joined
            messages:     true,                          // total messages sent
          }
        }
      }
    });

    if (!room || room.deletedAt) return errorResponse(res, 'Voice room not found', 404);

    // Load banned users separately
    const bannedMembers = await prisma.voiceRoomMember.findMany({
      where: { roomId, isBanned: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } }
      },
      take: 50,
    }).catch(() => []);

    // Count active participants manually from the included relation
    const activeParticipants = room.participants;
    const activeCount = activeParticipants.length;

    // Duration in minutes if room is live
    let durationMinutes = null;
    if (room.status === 'LIVE' && room.startedAt) {
      durationMinutes = Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 60000);
    }
    if (room.status === 'ENDED' && room.startedAt && room.endedAt) {
      durationMinutes = Math.floor((new Date(room.endedAt).getTime() - new Date(room.startedAt).getTime()) / 60000);
    }

    // Write audit log — INVARIANT-005: every admin inspection must be logged
    await adminAudit(adminId, 'ADMIN_INSPECT_VOICE_ROOM', 'VoiceRoom', roomId,
      { title: room.title, privacy: room.privacy, status: room.status, activeCount },
      req.ip
    );

    logger.info(`[admin-actions] Voice room ${roomId} inspected by admin ${adminId}`);

    return successResponse(res, {
      room: {
        id:          room.id,
        title:       room.title,
        description: room.description,
        privacy:     room.privacy,
        status:      room.status,
        schoolId:    room.schoolId,
        school:      room.school,
        host:        room.host,
        maxSpeakers: room.maxSpeakers,
        micLocked:   room.micLocked,
        createdAt:   room.createdAt,
        startedAt:   room.startedAt,
        endedAt:     room.endedAt,
        scheduledAt: room.scheduledAt,
        deletedAt:   room.deletedAt,
      },
      stats: {
        activeParticipants: activeCount,
        totalJoinsEver:     room._count.participants,
        totalMessages:      room._count.messages,
        durationMinutes,
      },
      participants: activeParticipants.map(p => ({
        userId:    p.userId,
        user:      p.user,
        role:      p.role,
        isMuted:   p.isMuted,
        isSpeaker: p.isSpeaker,
        joinedAt:  p.joinedAt,
      })),
      bannedUsers: bannedMembers.map(m => ({
        userId: m.userId,
        user:   m.user,
      })),
    });
  } catch (err) { next(err); }
});
