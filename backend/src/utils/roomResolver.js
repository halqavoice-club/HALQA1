/**
 * roomResolver.js — Universal Room Adapter for the Gift Engine
 *
 * Abstracts room/participant lookups across all live product types.
 * Add new room types here without touching gift.controller.js.
 */

'use strict';

const prisma = require('./prisma');

const userSelect = { id: true, firstName: true, lastName: true, avatarUrl: true };

/**
 * Resolve any room type to { id, status } or null if not found.
 * Status is normalised: 'LIVE' | 'ENDED' | 'SCHEDULED' | 'CANCELLED'
 *
 * @param {'voice'|'live_class'} roomType
 * @param {string} roomId
 */
async function resolveRoom(roomType, roomId) {
  if (roomType === 'voice') {
    const room = await prisma.voiceRoom.findUnique({
      where:  { id: roomId },
      select: { id: true, status: true },
    });
    return room ? { id: room.id, status: room.status } : null;
  }

  if (roomType === 'live_class') {
    const lc = await prisma.liveClass.findFirst({
      where:  { id: roomId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!lc) return null;
    // Normalise status to match voice room conventions
    const status = lc.status === 'LIVE' ? 'LIVE'
      : lc.status === 'ENDED'     ? 'ENDED'
      : lc.status === 'CANCELLED' ? 'CANCELLED'
      : 'SCHEDULED';
    return { id: lc.id, status };
  }

  throw new Error(`Unknown roomType: ${roomType}`);
}

/**
 * Resolve a single participant in any room type.
 * Returns { userId, role, isActive, user } or null.
 *
 * @param {'voice'|'live_class'} roomType
 * @param {string} roomId
 * @param {string} userId
 */
async function resolveParticipant(roomType, roomId, userId) {
  if (roomType === 'voice') {
    const p = await prisma.voiceParticipant.findUnique({
      where:   { roomId_userId: { roomId, userId } },
      include: { user: { select: userSelect } },
    });
    if (!p) return null;
    return { userId: p.userId, role: p.role, isActive: p.isActive, user: p.user };
  }

  if (roomType === 'live_class') {
    const p = await prisma.liveClassParticipant.findFirst({
      where:   { liveClassId: roomId, userId, isActive: true },
      include: { user: { select: userSelect } },
    });
    if (!p) return null;
    return { userId: p.userId, role: p.role, isActive: p.isActive, user: p.user };
  }

  throw new Error(`Unknown roomType: ${roomType}`);
}

/**
 * Get all active eligible gift recipients in a room (excludes excludeUserId).
 * Returns array of { userId, role, user }
 *
 * @param {'voice'|'live_class'} roomType
 * @param {string} roomId
 * @param {string} excludeUserId  — sender's userId
 */
async function resolveActiveRecipients(roomType, roomId, excludeUserId) {
  if (roomType === 'voice') {
    const rows = await prisma.voiceParticipant.findMany({
      where: {
        roomId,
        isActive: true,
        role:     { in: ['HOST', 'MODERATOR', 'SPEAKER'] },
        userId:   { not: excludeUserId },
      },
      include: { user: { select: userSelect } },
    });
    return rows.map(r => ({ userId: r.userId, role: r.role, user: r.user }));
  }

  if (roomType === 'live_class') {
    // In live class every active participant can receive gifts
    const rows = await prisma.liveClassParticipant.findMany({
      where: {
        liveClassId: roomId,
        isActive:    true,
        userId:      { not: excludeUserId },
      },
      include: { user: { select: userSelect } },
    });
    return rows.map(r => ({ userId: r.userId, role: r.role, user: r.user }));
  }

  throw new Error(`Unknown roomType: ${roomType}`);
}

module.exports = { resolveRoom, resolveParticipant, resolveActiveRecipients };
