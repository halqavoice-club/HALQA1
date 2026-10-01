/**
 * roomResolver.js — Universal Room Adapter for the Gift Engine
 *
 * Abstracts room/participant lookups across all live product types.
 * Add new room types here without touching gift.controller.js.
 *
 * Supported roomTypes: voice | live_class | pk | community
 * Unknown roomTypes: return null (never throw) — caller returns 404/403.
 */

'use strict';

const prisma = require('./prisma');

const userSelect = { id: true, firstName: true, lastName: true, avatarUrl: true };

/**
 * Resolve any room type to { id, status } or null if not found.
 * Status is normalised: 'LIVE' | 'ENDED' | 'SCHEDULED' | 'CANCELLED'
 *
 * @param {'voice'|'live_class'|'pk'|'community'} roomType
 * @param {string} roomId
 * @returns {{ id: string, status: string } | null}
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
    const status = lc.status === 'LIVE' ? 'LIVE'
      : lc.status === 'ENDED'     ? 'ENDED'
      : lc.status === 'CANCELLED' ? 'CANCELLED'
      : 'SCHEDULED';
    return { id: lc.id, status };
  }

  if (roomType === 'pk') {
    // Task 9.2: PK battle rooms — active match in PENDING or LIVE state
    const match = await prisma.pKMatch.findFirst({
      where:  { id: roomId, state: { in: ['PENDING', 'LIVE'] } },
      select: { id: true, state: true },
    }).catch(() => null);
    if (!match) return null;
    const status = match.state === 'LIVE' ? 'LIVE' : 'SCHEDULED';
    return { id: match.id, status };
  }

  if (roomType === 'community') {
    // Task 9.2: Community rooms — active community treated as always LIVE
    const community = await prisma.community.findFirst({
      where:  { id: roomId, deletedAt: null },
      select: { id: true },
    }).catch(() => null);
    return community ? { id: community.id, status: 'LIVE' } : null;
  }

  // Unknown roomType → null (never throw; caller handles 404/403)
  return null;
}

/**
 * Resolve a single participant in any room type.
 * Returns { userId, role, isActive, user } or null.
 *
 * @param {'voice'|'live_class'|'pk'|'community'} roomType
 * @param {string} roomId
 * @param {string} userId
 * @returns {{ userId: string, role: string, isActive: boolean, user: object } | null}
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

  if (roomType === 'pk') {
    // Task 9.2: PK participants
    const p = await prisma.pKParticipant.findFirst({
      where:   { pkMatchId: roomId, userId },
      include: { user: { select: userSelect } },
    }).catch(() => null);
    if (!p) return null;
    return { userId: p.userId, role: p.role || 'PARTICIPANT', isActive: true, user: p.user };
  }

  if (roomType === 'community') {
    // Task 9.2: Community members
    const m = await prisma.communityMember.findFirst({
      where:   { communityId: roomId, userId, status: 'ACTIVE' },
      include: { user: { select: userSelect } },
    }).catch(() => null);
    if (!m) return null;
    return { userId: m.userId, role: m.role || 'MEMBER', isActive: true, user: m.user };
  }

  // Unknown roomType → null
  return null;
}

/**
 * Get all active eligible gift recipients in a room (excludes excludeUserId).
 * Returns array of { userId, role, user }
 *
 * @param {'voice'|'live_class'|'pk'|'community'} roomType
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

  if (roomType === 'pk') {
    // Task 9.2: All active PK participants except sender are eligible recipients
    const rows = await prisma.pKParticipant.findMany({
      where:   { pkMatchId: roomId, userId: { not: excludeUserId } },
      include: { user: { select: userSelect } },
    }).catch(() => []);
    return rows.map(r => ({ userId: r.userId, role: r.role || 'PARTICIPANT', user: r.user }));
  }

  if (roomType === 'community') {
    // Task 9.2: Active community members except sender
    const rows = await prisma.communityMember.findMany({
      where: {
        communityId: roomId,
        status:      'ACTIVE',
        userId:      { not: excludeUserId },
      },
      include: { user: { select: userSelect } },
    }).catch(() => []);
    return rows.map(r => ({ userId: r.userId, role: r.role || 'MEMBER', user: r.user }));
  }

  // Unknown roomType → empty array (caller handles gracefully)
  return [];
}

module.exports = { resolveRoom, resolveParticipant, resolveActiveRecipients };
