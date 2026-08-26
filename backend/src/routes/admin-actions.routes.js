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
