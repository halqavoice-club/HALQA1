const { AccessToken } = require('livekit-server-sdk');
const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { successResponse, errorResponse } = require('../utils/response');
const { getVoiceAudioPermission } = require('../utils/voiceAudioPermission');

/**
 * POST /voice/rooms/:id/livekit-token
 *
 * Issues a LiveKit access token for the caller.
 *
 * Publish permission is derived from fresh room and participant state. Socket.IO
 * and client UI are synchronization layers, never authorization boundaries.
 */
async function getLiveKitToken(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const userId = req.user.id;

    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return errorResponse(res, 'LiveKit is not configured on this server', 503);
    }

    // SEC-BAN-01: fast pre-check before acquiring any lock.
    // req.user is JWT-derived and may be stale — always query fresh from DB.
    const freshUser = await prisma.user.findUnique({
      where:  { id: userId },
      select: { status: true },
    });
    if (freshUser?.status === 'BANNED') {
      return errorResponse(res, 'Your account has been suspended', 403);
    }

    // INV-001-7C: DB lifecycle lock serializes token signing against room termination.
    // NOTE: This lock orders token signing against concurrent termination.
    // It does NOT cryptographically revoke JWTs already signed before this call.
    // Self-hosted LiveKit has no server-side token revocation capability.
    let tokenResult;
    try {
      tokenResult = await prisma.$transaction(
        async (tx) => {
          // 1. Acquire room row lock — same order as joinRoom() and terminateVoiceRoom().
          await tx.$queryRaw`SELECT id FROM voice_rooms WHERE id = ${roomId} FOR UPDATE`;

          // 2. Re-read room state inside the lock.
          const room = await tx.voiceRoom.findUnique({
            where: { id: roomId },
            select: { status: true, deletedAt: true, micLocked: true, allMuted: true },
          });
          if (!room || room.deletedAt) {
            const err = new Error('Room not found');
            err.statusCode = 404;
            throw err;
          }
          // PERMANENT ROOMS: only archived rooms (ENDED) cannot issue tokens.
          if (room.status === 'ENDED') {
            const err = new Error('This room has been archived');
            err.statusCode = 400;
            throw err;
          }

          // 3. Re-read participant inside the lock.
          const participant = await tx.voiceParticipant.findUnique({
            where: { roomId_userId: { roomId, userId } },
            select: {
              role: true,
              isActive: true,
              isMuted: true,
              mutedByModerator: true,
              seatNumber: true,
            },
          });
          if (!participant || !participant.isActive) {
            const err = new Error('You are not an active participant in this room');
            err.statusCode = 403;
            throw err;
          }

          // 4. Sign JWT while the lifecycle lock is held.
          const at = new AccessToken(apiKey, apiSecret, {
            identity: userId,
            name: `${req.user.firstName} ${req.user.lastName}`,
            // INV-001: Voice Club token TTL reduced 1h → 10m (room ends revoke SFU).
            ttl: '10m',
          });

          const permission = getVoiceAudioPermission({ participant, room });
          at.addGrant({
            roomJoin:             true,
            room:                 roomId,
            canPublish:           permission.canPublishAudio,
            canSubscribe:         true,
            canPublishData:       true,
            canUpdateOwnMetadata: true,
          });

          const token = await at.toJwt();
          return {
            token,
            role:                 participant.role,
            micEnabled:           permission.canPublishAudio,
            audioPermissionReason: permission.reason,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (txErr) {
      if (txErr.statusCode === 404) return errorResponse(res, 'Room not found', 404);
      if (txErr.statusCode === 400) return errorResponse(res, 'This room has been archived', 400);
      if (txErr.statusCode === 403) return errorResponse(res, txErr.message, 403);
      throw txErr;
    }

    return successResponse(res, {
      token:                 tokenResult.token,
      livekitUrl:            process.env.LIVEKIT_URL || 'wss://your-livekit-server.livekit.cloud',
      roomId,
      role:                  tokenResult.role,
      micEnabled:            tokenResult.micEnabled,
      audioPermissionReason: tokenResult.audioPermissionReason,
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

    const { roomId, canSubscribe = true } = req.body;
    const userId = req.user.id;

    // P24M-02 FIX: Fresh platform ban check for ALL room types.
    // A platform-banned user must not obtain any LiveKit token via this endpoint.
    // Mirrors getLiveKitToken() (voice) fresh ban check pattern (SEC-BAN-01).
    // req.user is JWT-derived and may be stale if the ban was applied after the
    // current access token was issued — always query fresh from DB.
    const freshUser = await prisma.user.findUnique({
      where:  { id: userId },
      select: { status: true },
    });
    if (freshUser?.status === 'BANNED') {
      return errorResponse(res, 'Your account has been suspended', 403);
    }

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
            select: { status: true, deletedAt: true }
          });
          // G-4 FIX: also reject soft-deleted memberships (deletedAt is set).
          // Previously only status was checked; a membership deleted while still
          // ACTIVE at deletion time would incorrectly pass this guard.
          if (!membership || membership.deletedAt || membership.status !== 'ACTIVE') {
            return errorResponse(res, 'Access denied to this school\'s resource', 403);
          }
        } else {
          // schoolId matches — verify membership is not suspended or deleted
          const membership = await prisma.schoolMembership.findUnique({
            where: { userId_schoolId: { userId, schoolId: lc.schoolId } },
            select: { status: true, deletedAt: true }
          });
          // G-4 FIX: also reject soft-deleted memberships.
          // VULN-LIVE-005 FIX: A null membership (record deleted, not just suspended)
          // must also be rejected. Require membership to exist AND be ACTIVE and NOT deleted.
          if (!membership || membership.deletedAt || membership.status !== 'ACTIVE') {
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
    // INV-001: hoist voiceRoom so the TTL decision below can read it.
    let voiceRoom = null;
    if (roomId && !roomId.startsWith('liveclass-')) {
      // Check if this is a voice room by looking it up in the DB
      // Only apply restriction when the room exists in the voice_rooms table
      try {
        voiceRoom = await prisma.voiceRoom.findUnique({
          where: { id: roomId },
          select: { id: true, status: true, deletedAt: true },
        });
      } catch (dbErr) {
        // INV-001: fail-closed — a DB outage must not mint tokens for unknown rooms.
        return errorResponse(res, 'Unable to verify room status', 503);
      }

      if (voiceRoom) {
        // It IS a voice room — wrap participant check + JWT signing in lifecycle lock.
        // INV-001-7C: DB lock serializes token signing against termination.
        // It does NOT revoke already-issued JWTs. Self-hosted LiveKit has no token revocation.
        let voiceTokenResult;
        try {
          voiceTokenResult = await prisma.$transaction(
            async (tx) => {
              // 1. Acquire room row lock — same order as joinRoom() and terminateVoiceRoom().
              await tx.$queryRaw`SELECT id FROM voice_rooms WHERE id = ${roomId} FOR UPDATE`;
              // 2. Re-read room inside lock.
              const lockedRoom = await tx.voiceRoom.findUnique({
                where: { id: roomId },
                select: { status: true, deletedAt: true },
              });
              if (!lockedRoom || lockedRoom.deletedAt) {
                const err = new Error('Room not found');
                err.statusCode = 404;
                throw err;
              }
              if (lockedRoom.status === 'ENDED') {
                const err = new Error('Room has ended');
                err.statusCode = 400;
                throw err;
              }
              // 3. Re-read participant inside lock.
              let voiceParticipant = null;
              try {
                voiceParticipant = await tx.voiceParticipant.findUnique({
                  where: { roomId_userId: { roomId, userId } },
                  select: { isActive: true },
                });
              } catch (dbErr) {
                // INV-001-7E: fail-closed — DB error must not silently issue a token.
                const err = new Error('Unable to verify participant status');
                err.statusCode = 503;
                throw err;
              }
              if (!voiceParticipant?.isActive) {
                const err = new Error('You are not an active participant in this voice room. Use POST /voice/:id/livekit-token instead.');
                err.statusCode = 403;
                throw err;
              }
              // 4. Sign token inside lock — ttl is '10m' for voice rooms (INV-001).
              const at = new AccessToken(apiKey, apiSecret, {
                identity: userId,
                name:     `${req.user.firstName} ${req.user.lastName}`,
                ttl:      '10m',
              });
              at.addGrant({
                roomJoin:             true,
                room:                 roomId,
                canPublish:           false,              // P24M-01: subscribe-only for generic endpoint
                canSubscribe:         Boolean(canSubscribe),
                canPublishData:       false,
                canUpdateOwnMetadata: true,
              });
              const token = await at.toJwt();
              return { token };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
          );
        } catch (txErr) {
          if (txErr.statusCode === 404) return errorResponse(res, 'Room not found', 404);
          if (txErr.statusCode === 400) return errorResponse(res, txErr.message, 400);
          if (txErr.statusCode === 403) return errorResponse(res, txErr.message, 403);
          if (txErr.statusCode === 503) return errorResponse(res, txErr.message, 503);
          throw txErr;
        }
        return successResponse(res, {
          token:      voiceTokenResult.token,
          livekitUrl: process.env.LIVEKIT_URL || 'wss://your-livekit-server.livekit.cloud',
          roomId,
          identity:   userId,
        });
      }
      // Not a voice room (PK, custom, etc.) — allow through (no DB restriction applies)
    }

    // Non-voice room path (PK, custom, etc.) — existing behavior unchanged, no lock.
    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name:     `${req.user.firstName} ${req.user.lastName}`,
      // INV-001: Voice Club rooms get 10m TTL; all others stay 1h.
      // Voice rooms return early above — this path is for non-voice rooms only.
      ttl:      '1h',
    });

    // P24M-01 FIX: Never honor client-supplied canPublish for unknown/non-HALQA room types.
    at.addGrant({
      roomJoin:             true,
      room:                 roomId,
      canPublish:           false,              // P24M-01: always false for unknown/non-HALQA rooms
      canSubscribe:         Boolean(canSubscribe),
      canPublishData:       false,              // consistent with canPublish:false
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
