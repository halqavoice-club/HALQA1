const { AccessToken } = require('livekit-server-sdk');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');

const MAX_SPEAKERS = 10;

/**
 * POST /voice/rooms/:id/livekit-token
 *
 * Issues a LiveKit access token for the caller.
 *
 * ALL participants get canPublish: true — LiveKit does not enforce mic access.
 * The backend controls who actually speaks via Socket.IO (voice:role_changed).
 * The frontend enables/disables the mic track based on role, never reconnects.
 *
 * This gives ONE stable WebRTC connection per session regardless of role changes.
 */
async function getLiveKitToken(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    // ── Validate room ──────────────────────────────────────────────────────
    const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    if (room.status === 'ENDED') return errorResponse(res, 'Room has ended', 400);

    // ── Validate participant ───────────────────────────────────────────────
    const participant = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } }
    });
    if (!participant || !participant.isActive) {
      return errorResponse(res, 'You are not an active participant in this room', 403);
    }

    const role = participant.role; // HOST | MODERATOR | SPEAKER | AUDIENCE

    // ── Build LiveKit token ────────────────────────────────────────────────
    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return errorResponse(res, 'LiveKit is not configured on this server', 503);
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: `${req.user.firstName} ${req.user.lastName}`,
      // LV-002: Reduced TTL from 8h → 1h.
      // An 8h token lets a kicked/banned user re-connect to the LiveKit room
      // directly using the cached token even after being kicked at the DB level.
      // 1h is generous for any single session while limiting post-kick re-entry.
      ttl: '1h'
    });

    // Everyone gets canPublish: true — mic is controlled by the frontend
    // based on Socket.IO role events, not by token re-issuance.
    at.addGrant({
      roomJoin:             true,
      room:                 roomId,
      canPublish:           true,
      canSubscribe:         true,
      canPublishData:       true,
      canUpdateOwnMetadata: true
    });

    const token = await at.toJwt();

    // Tell the frontend whether to start with mic ON or OFF
    const micEnabled = role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER';

    return successResponse(res, {
      token,
      livekitUrl: process.env.LIVEKIT_URL || 'wss://your-livekit-server.livekit.cloud',
      roomId,
      role,
      micEnabled   // frontend uses this to set initial mic state, not canPublish
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /livekit/token
 *
 * Generic token — no DB room/participant checks for non-Live-Class rooms.
 * Identity and display name come from the authenticated user (req.user).
 * Caller controls canPublish / canSubscribe via request body.
 *
 * SECURITY: If roomId starts with "liveclass-" the caller must be an
 * active LiveClassParticipant in that class (Task 1 — P2-A hardening).
 * This prevents any authenticated user from obtaining a LiveKit token for
 * a live class they have not legitimately joined.
 */
async function generateToken(req, res, next) {
  try {
    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return errorResponse(res, 'LiveKit is not configured on this server', 503);
    }

    const { roomId, canPublish = true, canSubscribe = true } = req.body;
    const userId = req.user.id;

    // ── Task 1 (P2-A): Live class room protection ──────────────────────────
    // Room names for live classes follow the pattern: "liveclass-{uuid}"
    // Any request for such a room MUST go through the full Live Class authorization
    // chain: school isolation + enrollment + active participant.
    // The dedicated /live-classes/:id/token endpoint is the correct path and already
    // enforces all of these. The generic endpoint must not bypass that chain.
    if (roomId && roomId.startsWith('liveclass-')) {
      // Extract the live class ID from the room name
      const liveClassId = roomId.replace(/^liveclass-/, '');

      // 1. Verify the live class exists
      const lc = await prisma.liveClass.findFirst({
        where: { id: liveClassId, deletedAt: null },
        select: { id: true, schoolId: true, status: true },
      });
      if (!lc) return errorResponse(res, 'Live class not found', 404);
      if (lc.status === 'ENDED') return errorResponse(res, 'Class has ended', 400);
      if (lc.status === 'CANCELLED') return errorResponse(res, 'Class was cancelled', 400);

      // 2. School isolation (H-10 FIX): use SchoolMembership table instead of
      // legacy user.schoolId. A user whose membership was suspended but whose
      // user.schoolId still points to the school would previously pass this check.
      if (req.user.role !== 'SUPER_ADMIN') {
        // First do the fast legacy check — if schoolId doesn't match at all, reject immediately
        // without hitting the DB (same cost as before for the common cross-school case)
        const legacyMatch = req.user.schoolId === lc.schoolId;

        if (!legacyMatch) {
          // schoolId mismatch — check SchoolMembership as fallback for MEMBER users
          // whose user.schoolId may differ from their active membership schoolId
          const membership = await prisma.schoolMembership.findUnique({
            where: { userId_schoolId: { userId, schoolId: lc.schoolId } },
            select: { status: true }
          });
          if (!membership || membership.status !== 'ACTIVE') {
            return errorResponse(res, 'Access denied to this school\'s resource', 403);
          }
          // membership is ACTIVE — user is allowed through
        } else {
          // schoolId matches — also verify membership is not suspended
          // (only DB-check when Redis cache misses, which is the common production path)
          const membership = await prisma.schoolMembership.findUnique({
            where: { userId_schoolId: { userId, schoolId: lc.schoolId } },
            select: { status: true }
          });
          // If a membership record exists and is suspended/inactive — deny
          if (membership && membership.status !== 'ACTIVE') {
            return errorResponse(res, 'Access denied — your school membership is not active', 403);
          }
          // No membership record + schoolId matches → legacy user, allow through
        }
      }

      // 3. Verify active participant membership
      const participant = await prisma.liveClassParticipant.findFirst({
        where: { liveClassId: lc.id, userId, isActive: true },
        select: { id: true },
      });
      if (!participant) {
        return errorResponse(res, 'You are not an active participant in this live class. Use POST /live-classes/:id/token instead.', 403);
      }
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name:     `${req.user.firstName} ${req.user.lastName}`,
      // LV-002: 1h TTL — consistent with the room-specific token above.
      ttl:      '1h',
    });

    at.addGrant({
      roomJoin:             true,
      room:                 roomId,
      canPublish:           Boolean(canPublish),
      canSubscribe:         Boolean(canSubscribe),
      canPublishData:       Boolean(canPublish),
      canUpdateOwnMetadata: true,
    });

    const token = await at.toJwt();

    return successResponse(res, {
      token,
      livekitUrl: process.env.LIVEKIT_URL || 'wss://your-livekit-server.livekit.cloud',
      roomId,
      identity:   userId,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getLiveKitToken, generateToken };
