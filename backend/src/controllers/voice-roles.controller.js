/**
 * Voice Room Role Management Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints (all require authenticate + checkVoiceRole):
 *
 *   POST   /voice/:id/moderator/:userId    HOST assigns MODERATOR
 *   DELETE /voice/:id/moderator/:userId    HOST removes MODERATOR → AUDIENCE
 *   POST   /voice/:id/transfer/:userId     HOST transfers ownership → new HOST
 *   PATCH  /voice/:id/mute-all             HOST/MOD mutes all speakers
 *   GET    /voice/:id/participants         Get full participant list with roles
 *
 * Socket events emitted:
 *   voice:moderator_assigned   → { roomId, userId, firstName, lastName }
 *   voice:moderator_removed    → { roomId, userId }
 *   voice:admin_transferred    → { roomId, newHostId, prevHostId }
 *   voice:role_changed         → { roomId, userId, role }
 *   voice:mute_changed         → { roomId, userId, isMuted }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const prisma = require('../utils/prisma');
const { v4: uuidv4 } = require('uuid');
const { deleteCache } = require('../utils/redis');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const { VOICE_ROLES } = require('../middleware/voiceRole.middleware');
const logger = require('../utils/logger');
// PH17-003 FIX: SFU capability revocation on demotion/mute
const { sfuEvict, sfuRevokePublish } = require('../utils/livekitService');
// G6 FIX: include stateVersion in voice:stage_state so clients can apply
// version-ordered removal (onStageState isVersionedAndFresh branch).
const { getNextStageVersion } = require('../utils/voiceRoomCache');

// ── Audit helper (fire-and-forget, never throws) ──────────────────────────────
async function _rolesAudit(actorId, action, roomId, meta = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        id: uuidv4(), userId: actorId, action: 'UPDATE',
        entity: 'VoiceRoom', entityId: roomId,
        newValues: { action, ...meta }
      }
    });
  } catch { /* non-fatal */ }
}

function roomCacheKey(roomId) { return `voice:room:${roomId}`; }

async function safeDeleteCache(key) {
  try {
    await deleteCache(key);
  } catch (err) {
    logger.error(`[voice-roles] Cache DEL failed for "${key}": ${err.message}`);
  }
}

// ─── ASSIGN MODERATOR ─────────────────────────────────────────────────────────
/**
 * POST /voice/:id/moderator/:userId
 * HOST assigns a SPEAKER or AUDIENCE member as MODERATOR.
 * Only HOST can do this. Only 1 HOST per room.
 */
async function assignModerator(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    // req.voiceParticipant is the HOST (set by checkVoiceRole middleware)

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found or not active', 404);
    }
    if (target.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'Cannot assign moderator to the host', 400);
    }
    if (target.role === VOICE_ROLES.MODERATOR) {
      return errorResponse(res, 'User is already a moderator', 400);
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: {
        role:    'MODERATOR',
        // MODERATOR EXEMPTION (DEF-002): Moderators are always unmuted on assignment.
        // allMuted (room-wide mute policy) does NOT apply to MODERATOR or HOST roles.
        // A newly assigned moderator must be able to speak immediately to fulfil their
        // moderation duties. This is intentional and correct — do NOT add an allMuted
        // check here. Individual mute via toggleMute() remains available if needed.
        isMuted: false,
        updatedAt: new Date()
      }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:moderator_assigned', {
        roomId,
        userId:    targetUserId,
        firstName: target.user.firstName,
        lastName:  target.user.lastName,
        avatarUrl: target.user.avatarUrl
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId,
        userId: targetUserId,
        role:   VOICE_ROLES.MODERATOR
      });
      // Notify the new moderator directly
      io.to(`user:${targetUserId}`).emit('voice:you_are_moderator', {
        roomId,
        message: "You've been assigned as a moderator!"
      });
    }

    _rolesAudit(req.user.id, 'ASSIGN_MODERATOR', roomId, { targetUserId });
    return successResponse(res, {
      userId: targetUserId,
      role:   VOICE_ROLES.MODERATOR,
      name:   `${target.user.firstName} ${target.user.lastName}`
    }, `${target.user.firstName} is now a moderator`);
  } catch (error) { next(error); }
}
/**
 * DELETE /voice/:id/moderator/:userId
 * HOST removes MODERATOR role → demotes to AUDIENCE.
 */
async function removeModerator(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found', 404);
    }
    if (target.role !== VOICE_ROLES.MODERATOR) {
      return errorResponse(res, 'User is not a moderator', 400);
    }

    // ATOMIC FIX: collapse role=AUDIENCE + seatNumber=NULL into one raw SQL statement.
    // The previous two-step approach (ORM update then separate raw SQL) created a
    // race window where role=AUDIENCE but seatNumber was still set. A concurrent
    // drop-mic call during that window would see role=AUDIENCE and be rejected.
    await prisma.$executeRaw`
      UPDATE voice_participants
      SET role = 'AUDIENCE', isMuted = 1, seatNumber = NULL, updatedAt = NOW()
      WHERE id = ${target.id}
    `;

    await safeDeleteCache(roomCacheKey(roomId));

    // PH17-003 FIX: Revoke SFU publish capability when moderator is removed.
    // The demoted user's existing token may still have canPublish:true from
    // when they were assigned moderator. sfuRevokePublish forces canPublish=false
    // on the live SFU connection immediately — no reconnect needed.
    sfuRevokePublish(roomId, targetUserId, false, '[voice:remove-mod]').catch(() => {});

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:moderator_removed', {
        roomId,
        userId: targetUserId
      });
      // RT-FIX-8: Include seatNumber:null so clients clear the stage grid slot.
      io.to(`voice:${roomId}`).emit('voice:role_changed', {
        roomId,
        userId:     targetUserId,
        role:       VOICE_ROLES.AUDIENCE,
        seatNumber: null,
      });
      io.to(`user:${targetUserId}`).emit('voice:moderator_removed', {
        roomId,
        message: 'Your moderator role has been removed.'
      });

      // BUG-2 FIX: Emit authoritative stage snapshot after moderator removal so
      // the stale-seat sweep in onStageState fires and clears the vacated slot on
      // all connected clients — mirrors the fix applied to promoteParticipant().
      try {
        const stageRows = await prisma.$queryRaw`
          SELECT vp.userId, vp.role, vp.isMuted, vp.seatNumber, vp.isPinned,
                 vp.handRaised, vp.mutedByModerator, vp.joinedAt,
                 u.firstName, u.lastName, u.avatarUrl
          FROM voice_participants vp
          LEFT JOIN users u ON u.id = vp.userId
          WHERE vp.roomId = ${roomId} AND vp.isActive = 1
          ORDER BY vp.role ASC, vp.joinedAt ASC
        `;
        const rolesStateVersion = await getNextStageVersion(roomId).catch(() => 0);
        io.to(`voice:${roomId}`).emit('voice:stage_state', {
          roomId,
          stageParticipants: stageRows.map(r => ({
            userId:           r.userId,
            role:             r.role,
            isMuted:          Boolean(r.isMuted),
            seatNumber:       r.seatNumber != null ? Number(r.seatNumber) : null,
            isPinned:         Boolean(r.isPinned),
            handRaised:       Boolean(r.handRaised),
            mutedByModerator: Boolean(r.mutedByModerator),
            joinedAt:         r.joinedAt,
            firstName:        r.firstName ?? null,
            lastName:         r.lastName ?? null,
            avatarUrl:        r.avatarUrl ?? null,
          })),
          stageCount: stageRows.length,
          stateVersion: rolesStateVersion,
        });
      } catch { /* non-fatal */ }
    }

    _rolesAudit(req.user.id, 'REMOVE_MODERATOR', roomId, { targetUserId });
    return successResponse(res, { userId: targetUserId, role: VOICE_ROLES.AUDIENCE },
      `${target.user.firstName} removed from moderators`);
  } catch (error) { next(error); }
}

// ─── TRANSFER ADMIN (OWNERSHIP) ───────────────────────────────────────────────
/**
 * POST /voice/:id/transfer/:userId
 * HOST transfers ownership to another participant.
 * Old HOST becomes MODERATOR. New HOST gets full control.
 *
 * RACE CONDITION FIX: The transaction now re-reads the current hostId inside
 * the transaction and verifies the caller is still the host before committing.
 * Two concurrent transfers can no longer both succeed and leave inconsistent state.
 */
async function transferAdmin(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const prevHostId = req.user.id;

    if (targetUserId === prevHostId) {
      return errorResponse(res, 'Cannot transfer to yourself', 400);
    }

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Target participant not found or not active', 404);
    }
    if (target.role === VOICE_ROLES.HOST) {
      return errorResponse(res, 'Target is already the host', 400);
    }

    // Race-condition protection: re-read current hostId inside transaction.
    // The VoiceRoom update uses a WHERE condition matching the expected hostId
    // so it affects 0 rows if another transaction already changed the host.
    try {
      let transferred = false;
      await prisma.$transaction(async (tx) => {
        // Demote old host → MODERATOR
        await tx.voiceParticipant.update({
          where: { roomId_userId: { roomId, userId: prevHostId } },
          data: { role: VOICE_ROLES.MODERATOR, updatedAt: new Date() }
        });
        // Promote target → HOST
        await tx.voiceParticipant.update({
          where: { id: target.id },
          data: { role: VOICE_ROLES.HOST, isMuted: false, updatedAt: new Date() }
        });
        // Update room hostId — only if current hostId still matches prevHostId
        const updateResult = await tx.voiceRoom.updateMany({
          where: { id: roomId, hostId: prevHostId },   // serialization point
          data: { hostId: targetUserId, updatedAt: new Date() }
        });
        if (updateResult.count === 0) {
          // Another transfer already succeeded — rollback by throwing
          const err = new Error('You are no longer the host of this room');
          err.statusCode = 403;
          throw err;
        }
        transferred = true;
      });
    } catch (txErr) {
      if (txErr.statusCode) return errorResponse(res, txErr.message, txErr.statusCode);
      throw txErr;
    }

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:admin_transferred', {
        roomId, newHostId: targetUserId, prevHostId,
        newHostName: `${target.user.firstName} ${target.user.lastName}`
      });
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: targetUserId, role: VOICE_ROLES.HOST });
      io.to(`voice:${roomId}`).emit('voice:role_changed', { roomId, userId: prevHostId, role: VOICE_ROLES.MODERATOR });
      io.to(`user:${targetUserId}`).emit('voice:you_are_host', { roomId, message: 'You are now the host of this room!' });
    }

    _rolesAudit(prevHostId, 'TRANSFER_OWNERSHIP', roomId, { newHostId: targetUserId });
    return successResponse(res, {
      newHostId: targetUserId, prevHostId,
      newHostRole: VOICE_ROLES.HOST, prevHostRole: VOICE_ROLES.MODERATOR
    }, `Ownership transferred to ${target.user.firstName}`);
  } catch (error) { next(error); }
}

// ─── MUTE ALL ─────────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/mute-all
 * HOST or MODERATOR mutes all speakers (except themselves).
 *
 * DEF-001 FIX: Persist room-wide mute policy (VoiceRoom.allMuted=true) inside
 * the same transaction as the per-participant writes so the policy survives
 * restarts, reconnects, and token re-issuance.
 */
async function muteAll(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const callerId = req.user.id;

    // F-04 FIX: findMany inside the transaction so target selection sees
    // any promotion that committed before this statement runs (READ COMMITTED).
    // The previous pattern read targets outside the transaction, leaving a
    // window where a concurrent promoteParticipant() could commit a new SPEAKER
    // who would not be in the target list and would escape the mute.
    let targets = [];
    let mutedCount = 0;
    await prisma.$transaction(async (tx) => {
      targets = await tx.voiceParticipant.findMany({
        where: {
          roomId,
          isActive: true,
          isMuted:  false,
          userId:   { not: callerId },
          role:     { in: [VOICE_ROLES.SPEAKER, VOICE_ROLES.MODERATOR] }
        },
        select: { id: true, userId: true }
      });

      // F-01 FIX: Set mutedByModerator=false (not true) for room-wide mute targets.
      // Semantic distinction:
      //   mutedByModerator=true  → individual disciplinary mute via toggleMute(); persists
      //                            through the room-wide unmute operation because that
      //                            operation filters mutedByModerator=false targets only.
      //   mutedByModerator=false → room-wide policy mute via muteAll(); eligible for
      //                            batch release by the unmute operation.
      // Using mutedByModerator=true here (original bug) caused the unmute operation
      // to be unable to find and release any participant muted by muteAll(), making
      // the pair non-inverse.
      if (targets.length > 0) {
        const updateResult = await tx.voiceParticipant.updateMany({
          // F-04 Race B: re-check isMuted=false at write time so a concurrent
          // unmute between findMany and updateMany is not overwritten.
          where: { id: { in: targets.map(t => t.id) }, isMuted: false },
          data: { isMuted: true, mutedByModerator: false, updatedAt: new Date() }
        });
        mutedCount = updateResult.count;
        // R1 FIX: Log when concurrent state change caused some rows to be skipped.
        if (mutedCount < targets.length) {
          logger.warn(`[voice:mute-all] ${targets.length - mutedCount} participant(s) not muted due to concurrent state change`);
        }
      }
      // Persist the room-wide mute policy — this is the core DEF-001 fix.
      await tx.voiceRoom.update({
        where: { id: roomId },
        data: { allMuted: true, updatedAt: new Date() }
      });
    });

    await safeDeleteCache(roomCacheKey(roomId));

    // R1 FIX: Re-read only rows that were actually updated (isMuted=true and
    // mutedByModerator=false still), so socket events and SFU calls target only
    // participants whose DB row was actually changed by the conditional updateMany.
    // When mutedCount is 0, skip the DB round-trip entirely.
    const actuallyMuted = mutedCount > 0
      ? await prisma.voiceParticipant.findMany({
          where: {
            id:               { in: targets.map(t => t.id) },
            isMuted:          true,
            mutedByModerator: false,
          },
          select: { userId: true }
        })
      : [];

    const io = getIo();
    if (io) {
      actuallyMuted.forEach(t => {
        // F-01 FIX: emit mutedByModerator=false to match the DB write above.
        // Room-wide mute does not set the individual-mute flag.
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: t.userId, isMuted: true, mutedByModerator: false
        });
      });
      // DEF-001: Emit room policy event so all clients know allMuted=true.
      // Emitted after per-participant events so clients apply participant state first.
      io.to(`voice:${roomId}`).emit('voice:room_policy_changed', {
        roomId, allMuted: true
      });
    }

    _rolesAudit(callerId, 'MUTE_ALL', roomId, { mutedCount });

    // PH17-003 FIX: Revoke SFU publish for each actually-muted speaker — best-effort.
    // A SPEAKER whose token has canPublish:true can still publish until their
    // token expires. sfuRevokePublish sets canPublish=false on the live SFU
    // connection immediately so the revocation takes effect without token expiry.
    actuallyMuted.forEach(t => {
      sfuRevokePublish(roomId, t.userId, false, '[voice:mute-all]').catch(() => {});
    });

    return successResponse(res, { mutedCount, allMuted: true },
      `Muted ${mutedCount} speaker${mutedCount > 1 ? 's' : ''}`);
  } catch (error) { next(error); }
}

// ─── UNMUTE ALL ───────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/unmute-all
 * P1-1 FIX: Unmutes all SPEAKER and MODERATOR participants.
 * HOST/MOD only. Inverse of muteAll.
 * The calling user (HOST/MOD) is excluded from the update — they control their
 * own mic independently. AUDIENCE participants are left alone (they are always
 * muted and are not stage speakers).
 *
 * DEF-001 FIX: Clear the room-wide mute policy (VoiceRoom.allMuted=false) in
 * the same transaction as the per-participant writes.
 *
 * DEF-003/V4 FIX: Only unmute participants whose isMuted=true AND
 * mutedByModerator=false. Participants individually muted by a moderator
 * (mutedByModerator=true) are NOT cleared — their individual mute survives
 * the room-wide unmute operation.
 */
async function unmuteAll(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const callerId = req.user.id;

    // F-04 FIX: findMany inside the transaction so target selection sees
    // any concurrent individual mute that committed before this statement
    // runs (READ COMMITTED). The previous pattern read targets outside the
    // transaction, leaving a window where a concurrent toggleMute() could
    // set mutedByModerator=true on a participant who was still in the old
    // target list (with mutedByModerator=false at read time), and the
    // updateMany would then erase that individual mute.
    let targets = [];
    let unmutedCount = 0;
    await prisma.$transaction(async (tx) => {
      // DEF-003 FIX: Filter on mutedByModerator=false so individually muted
      // participants are excluded from the room-wide unmute.
      // ARCH-GAP-C1: self-muted (isMuted=true, mutedByModerator=false set by toggleMute())
      // and room-muted (muteAll → isMuted=true, mutedByModerator=false) are indistinguishable
      // in the current schema. A participant who self-muted while room-wide mute was active
      // will have the same DB state as one muted only by muteAll(), so unmuteAll() will
      // inadvertently restore them. Resolution requires a dedicated mutedByRoom boolean column
      // (default false): muteAll() sets it true; unmuteAll() targets mutedByRoom=true only.
      // This schema change is out of scope for F3.1 — tracked as ARCH-GAP-C1.
      targets = await tx.voiceParticipant.findMany({
        where: {
          roomId,
          isActive:         true,
          isMuted:          true,
          mutedByModerator: false,   // DEF-003: skip individually mod-muted participants
          userId:           { not: callerId },
          role:             { in: [VOICE_ROLES.SPEAKER, VOICE_ROLES.MODERATOR] }
        },
        select: { id: true, userId: true }
      });

      if (targets.length > 0) {
        const updateResult = await tx.voiceParticipant.updateMany({
          // F-04 Race B: re-check mutedByModerator=false at write time so a
          // concurrent individual toggleMute() between findMany and updateMany
          // is NOT overwritten. If toggleMute sets mutedByModerator=true before
          // this updateMany runs, the WHERE clause won't match that row, and
          // the individual disciplinary mute is preserved.
          where: { id: { in: targets.map(t => t.id) }, mutedByModerator: false },
          data: { isMuted: false, mutedByModerator: false, updatedAt: new Date() }
        });
        unmutedCount = updateResult.count;
      }
      // DEF-001: Clear the room-wide mute policy.
      await tx.voiceRoom.update({
        where: { id: roomId },
        data: { allMuted: false, updatedAt: new Date() }
      });
    });

    await safeDeleteCache(roomCacheKey(roomId));

    // R1 FIX: Re-read only rows that were actually updated (isMuted=false and
    // mutedByModerator=false still), so socket events are emitted only for
    // participants whose DB row was actually changed by updateMany.
    // When updateMany.count is 0, skip the DB round-trip entirely.
    const actuallyUnmuted = unmutedCount > 0
      ? await prisma.voiceParticipant.findMany({
          where: {
            id:               { in: targets.map(t => t.id) },
            isMuted:          false,
            mutedByModerator: false,
          },
          select: { userId: true }
        })
      : [];

    const io = getIo();
    if (io) {
      actuallyUnmuted.forEach(t => {
        io.to(`voice:${roomId}`).emit('voice:mute_changed', {
          roomId, userId: t.userId, isMuted: false, mutedByModerator: false
        });
      });
      // DEF-001: Emit room policy event so all clients know allMuted=false.
      io.to(`voice:${roomId}`).emit('voice:room_policy_changed', {
        roomId, allMuted: false
      });
    }

    // P3a FIX: Restore SFU canPublish for participants actually unmuted.
    // muteAll() called sfuRevokePublish(canPublish=false) per target; without
    // this restore, those participants cannot publish until their token expires (~1h).
    // Best-effort only — catch swallows SFU errors.
    actuallyUnmuted.forEach(t => {
      sfuRevokePublish(roomId, t.userId, true, '[voice:unmute-all]').catch(() => {});
    });

    _rolesAudit(callerId, 'UNMUTE_ALL', roomId, { unmutedCount });
    return successResponse(res, { unmutedCount, allMuted: false },
      `Unmuted ${unmutedCount} speaker${unmutedCount > 1 ? 's' : ''}`);
  } catch (error) { next(error); }
}

// ─── GET PARTICIPANTS WITH ROLES ──────────────────────────────────────────────
/**
 * GET /voice/:id/participants
 * Returns all active participants grouped by role.
 * P2-2 FIX: Added pagination — ?page=1&limit=100. Default limit 100, max 200.
 */
async function getParticipants(req, res, next) {
  try {
    const { id: roomId } = req.params;
    const { page = 1, limit = 100 } = req.query;
    const take = Math.min(200, parseInt(limit));
    const skip = (Math.max(1, parseInt(page)) - 1) * take;

    const [total, participants] = await Promise.all([
      prisma.voiceParticipant.count({ where: { roomId, isActive: true } }),
      prisma.voiceParticipant.findMany({
        where: { roomId, isActive: true },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        skip,
        take,
      })
    ]);

    // Group by role
    const grouped = {
      host:       participants.filter(p => p.role === VOICE_ROLES.HOST),
      moderators: participants.filter(p => p.role === VOICE_ROLES.MODERATOR),
      speakers:   participants.filter(p => p.role === VOICE_ROLES.SPEAKER),
      audience:   participants.filter(p => p.role === VOICE_ROLES.AUDIENCE),
      total,
      page:       parseInt(page),
      hasMore:    skip + take < total,
    };

    return successResponse(res, grouped);
  } catch (error) { next(error); }
}

// ─── PIN SPEAKER ─────────────────────────────────────────────────────────────
/**
 * PATCH /voice/:id/pin/:userId
 * HOST or MODERATOR pins a speaker to the front of the stage grid.
 * Pinned speaker shows first in the 5×2 grid on all clients.
 * Pinning someone else auto-unpins the previous pinned speaker.
 */
async function pinSpeaker(req, res, next) {
  try {
    const { id: roomId, userId: targetUserId } = req.params;
    const callerId = req.user.id;

    const target = await prisma.voiceParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } }
    });

    if (!target || !target.isActive) {
      return errorResponse(res, 'Participant not found or not active', 404);
    }

    // Can only pin HOST, MODERATOR, or SPEAKER
    if (!['HOST', 'MODERATOR', 'SPEAKER'].includes(target.role)) {
      return errorResponse(res, 'Can only pin speakers, moderators, or the host', 400);
    }

    // Toggle pin: unpin if already pinned, pin if not
    const newPinned = !target.isPinned;

    // Unpin anyone else currently pinned in this room
    if (newPinned) {
      await prisma.voiceParticipant.updateMany({
        where: { roomId, isPinned: true, userId: { not: targetUserId } },
        data: { isPinned: false, updatedAt: new Date() }
      });
    }

    await prisma.voiceParticipant.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { isPinned: newPinned, updatedAt: new Date() }
    });

    await safeDeleteCache(roomCacheKey(roomId));

    const io = getIo();
    if (io) {
      io.to(`voice:${roomId}`).emit('voice:speaker_pinned', {
        roomId,
        userId:    targetUserId,
        isPinned:  newPinned,
        firstName: target.user.firstName,
        lastName:  target.user.lastName,
        pinnedBy:  callerId
      });
    }

    return successResponse(res, {
      userId:   targetUserId,
      isPinned: newPinned
    }, newPinned ? `${target.user.firstName} pinned to stage` : `${target.user.firstName} unpinned`);
  } catch (error) { next(error); }
}

module.exports = { assignModerator, removeModerator, transferAdmin, muteAll, unmuteAll, getParticipants, pinSpeaker };
