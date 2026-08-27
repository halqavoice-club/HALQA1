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
 * Routes:
 *   POST /live-classes/:id/terminate  — force-end any live class
 *   POST /voice/:id/terminate         — force-archive any voice room
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

    // Idempotency check — prevents double-grant on client retry
    const iKey = idempotencyKey || uuidv4();
    const existing = await prisma.walletTransaction.findFirst({
      where: { userId: targetUserId, type: 'ADMIN_GRANT', description: { contains: iKey } }
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
          id:          uuidv4(),
          userId:      targetUserId,
          type:        'ADMIN_GRANT',
          coins:       coinsInt,   // positive = credit
          description: `Admin grant by ${adminId} — ${reason.trim()} [ikey:${iKey}]`,
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
