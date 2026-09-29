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
    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { status: true, deletedAt: true, micLocked: true }
    });
    if (!room || room.deletedAt) return errorResponse(res, 'Room not found', 404);
    // PERMANENT ROOMS: Only archived rooms (ENDED) cannot issue tokens.
    // IDLE rooms can issue tokens — joining them re-activates them to LIVE.
    if (room.status === 'ENDED') return errorResponse(res, 'This room has been archived', 400);

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
      ttl: '1h'
    });

    // PH17-001 / mic-lock token gate:
    //
    // When the room is NOT mic-locked:
    //   All roles get canPublish:true (original contract preserved).
    //   SFU enforcement relies on role changes + sfuRevokePublish() at runtime.
    //
    // When the room IS mic-locked:
    //   Only HOST and MODERATOR get canPublish:true.
    //   SPEAKER and AUDIENCE get canPublish:false — the token gate prevents
    //   a reconnecting SPEAKER from bypassing the mic-lock at the SFU level.
    //   This closes the "reconnect gap" where a SPEAKER whose token was
    //   issued before the lock could still publish after reconnecting.
    const micLocked = Boolean(room.micLocked);
    const canPublishAudio = micLocked
      ? (role === 'HOST' || role === 'MODERATOR')          // locked: privileged only
      : true;                                               // unlocked: all can publish

    at.addGrant({
      roomJoin:             true,
      room:                 roomId,
      canPublish:           canPublishAudio,
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

      // 2. School isolation — enforced for ALL users including SUPER_ADMIN.
      // LTSV-001 FIX: The previous code skipped school isolation for SUPER_ADMIN
      // (if (req.user.role !== 'SUPER_ADMIN')). While the participant check below
      // still blocked SA from getting a token (no active liveClassParticipant),
      // the bypass was unnecessary defence-in-depth gap. Removing it ensures
      // school isolation is uniformly enforced at every layer.
      //
      // Uses SchoolMembership table (H-10 FIX) — authoritative for MEMBER users.
      // Legacy user.schoolId used as fast-path for matching school; if mismatch,
      // membership table is checked as fallback.
      {
        const legacyMatch = req.user.schoolId === lc.schoolId;

        if (!legacyMatch) {
          // schoolId mismatch — check SchoolMembership as fallback for MEMBER users
          const membership = await prisma.schoolMembership.findUnique({
            where: { userId_schoolId: { userId, schoolId: lc.schoolId } },
            select: { status: true }
          });
          if (!membership || membership.status !== 'ACTIVE') {
            return errorResponse(res, 'Access denied to this school\'s resource', 403);
          }
        } else {
          // schoolId matches — verify membership is ACTIVE.
          // VULN-LIVE-005 FIX: A null membership (record deleted, not just
          // suspended) must also be rejected here. The previous condition
          //   if (membership && membership.status !== 'ACTIVE')
          // treated a null membership as passing (null is falsy), which
          // allowed a user with a matching legacy user.schoolId but no active
          // SchoolMembership record to proceed past this layer.
          // Fix: require membership to exist AND be ACTIVE.
          const membership = await prisma.schoolMembership.findUnique({
            where: { userId_schoolId: { userId, schoolId: lc.schoolId } },
            select: { status: true }
          });
          if (!membership || membership.status !== 'ACTIVE') {
            return errorResponse(res, 'Access denied — your school membership is not active', 403);
          }
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

    // ── SEC-CRIT-003 FIX: Voice room participant check ─────────────────────
    // Room names for voice rooms follow the pattern: "voice-{uuid}" OR just the
    // raw UUID that was used when creating the VoiceRoom in LiveKit.
    // The dedicated /voice/:id/livekit-token endpoint already verifies active
    // VoiceParticipant membership. This generic endpoint must enforce the same
    // check to prevent:
    //   1. Kicked users reconnecting to the SFU using a cached generic token
    //   2. Any authenticated user joining a PRIVATE/INVITE_ONLY voice room
    //      they were never admitted to
    //
    // Detection: roomId is the voice room's DB id (UUID), which LiveKit uses
    // directly as the room name in createRoom() and joinRoom().
    // We check VoiceRoom existence first so non-existent IDs fail fast.
    //
    // Non-voice, non-liveclass rooms (e.g. PK rooms, custom rooms) are NOT
    // subject to this check — they use their own authorization paths.
    if (roomId && !roomId.startsWith('liveclass-')) {
      // Check if this is a voice room by looking it up in the DB
      // Only apply restriction when the room exists in the voice_rooms table
      let voiceRoom = null;
      try {
        voiceRoom = await prisma.voiceRoom.findUnique({
          where: { id: roomId },
          select: { id: true, status: true, deletedAt: true },
        });
      } catch {
        // DB lookup failed — skip voice room check (graceful degradation)
        // The dedicated /voice/:id/livekit-token endpoint is always the recommended path
        voiceRoom = null;
      }

      if (voiceRoom) {
        // It IS a voice room — enforce active participant check
        if (voiceRoom.deletedAt) {
          return errorResponse(res, 'Room not found', 404);
        }
        if (voiceRoom.status === 'ENDED') {
          return errorResponse(res, 'Room has ended', 400);
        }

        let voiceParticipant = null;
        try {
          voiceParticipant = await prisma.voiceParticipant.findUnique({
            where: { roomId_userId: { roomId, userId } },
            select: { isActive: true },
          });
        } catch {
          voiceParticipant = null;
        }

        if (!voiceParticipant?.isActive) {
          return errorResponse(
            res,
            'You are not an active participant in this voice room. Use POST /voice/:id/livekit-token instead.',
            403
          );
        }
      }
      // Not a voice room (PK, custom, etc.) — allow through (no DB restriction applies)
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
