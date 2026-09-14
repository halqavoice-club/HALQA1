/**
 * PK Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API handlers for the PK battle system.
 * All financial/scoring operations delegate to pk.service.js.
 * Never trusts client-supplied score or gift values.
 */

'use strict';

const { v4: uuidv4 }        = require('uuid');
const prisma                = require('../utils/prisma');
const pkService             = require('../services/pk.service');
const { joinQueue,
        leaveQueue,
        getQueueStatus }    = require('../services/pk.matchmaking');
const { successResponse,
        errorResponse,
        paginatedResponse,
        getPagination,
        buildPaginationMeta } = require('../utils/response');
const { notify }            = require('../services/notification.service');
const logger                = require('../utils/logger');

// ─── MATCH CRUD ───────────────────────────────────────────────────────────────

/** POST /api/v1/pk — create a PK (direct / admin) */
async function createPK(req, res) {
  try {
    const { type, sideBUserId, durationSeconds, seasonId, tournamentId, roomIdA, roomIdB, idempotencyKey } = req.body;
    if (!sideBUserId) return errorResponse(res, 'sideBUserId is required', 400);
    if (req.user.id === sideBUserId) return errorResponse(res, 'Cannot PK yourself', 400);

    const { match, duplicate } = await pkService.createMatch({
      type: type || 'ONE_V_ONE',
      sideAUserId: req.user.id,
      sideBUserId,
      durationSeconds,
      seasonId,
      tournamentId,
      roomIdA,
      roomIdB,
      idempotencyKey: idempotencyKey || uuidv4(),
    });

    return successResponse(res, { match, duplicate }, duplicate ? 'Already created' : 'PK created', duplicate ? 200 : 201);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** GET /api/v1/pk/:id */
async function getPK(req, res) {
  try {
    const { id } = req.params;
    const match = await prisma.pKMatch.findUnique({
      where:   { id },
      include: {
        participants: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        },
        teams: true,
        history: { select: { id: true, winnerId: true, winnerSide: true, scoreA: true, scoreB: true, durationSeconds: true } }
      }
    });
    if (!match) return errorResponse(res, 'PK not found', 404);

    // BUG-005 FIX: Only participants may fetch PREPARING/COUNTDOWN matches.
    // LIVE, PAUSED, and terminal matches are publicly viewable (spectators need state).
    const RESTRICTED_STATES = ['PREPARING', 'INVITED', 'PENDING_ACCEPTANCE', 'ACCEPTED'];
    if (RESTRICTED_STATES.includes(match.state)) {
      const isParticipant = match.participants.some(p => p.userId === req.user.id);
      const isAdmin       = req.user.role === 'SUPER_ADMIN';
      if (!isParticipant && !isAdmin) return errorResponse(res, 'Not authorized', 403);
    }

    return successResponse(res, match);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** POST /api/v1/pk/:id/start */
async function startPK(req, res) {
  try {
    const result = await pkService.startCountdown(req.params.id, req.user.id);
    return successResponse(res, result, 'PK countdown started');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/:id/end — admin force end */
async function endPK(req, res) {
  try {
    // NF-1 FIX: isAdmin must be SUPER_ADMIN only — not SCHOOL_ADMIN.
    // SCHOOL_ADMIN is a school-scoped role and must not force-end PK battles
    // between users from other schools or social-only users.
    const isAdmin = req.user.role === 'SUPER_ADMIN';
    const match   = await prisma.pKMatch.findUnique({ where: { id: req.params.id } });
    if (!match) return errorResponse(res, 'PK not found', 404);

    // BUG-003 FIX: return a clear 409 for already-terminal states rather than
    // letting the service throw a generic 400. This prevents confusing error
    // messages when a participant double-submits end after a network retry.
    const TERMINAL = ['COMPLETED', 'ABORTED', 'CANCELLED'];
    if (TERMINAL.includes(match.state)) {
      return errorResponse(res, `PK already ${match.state.toLowerCase()}`, 409);
    }

    const isParticipant = await prisma.pKParticipant.findUnique({
      where: { pkMatchId_userId: { pkMatchId: req.params.id, userId: req.user.id } }
    });
    if (!isAdmin && !isParticipant) return errorResponse(res, 'Not authorized', 403);

    const result = await pkService.finishPK(req.params.id, { endedByAdmin: isAdmin });
    return successResponse(res, result, 'PK ended');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/:id/abort — admin only */
async function abortPK(req, res) {
  try {
    // NF-1 FIX: SUPER_ADMIN only — mirrors the route-level authorize('SUPER_ADMIN') guard.
    // Previously allowed SCHOOL_ADMIN, which could abort PK battles between users from other schools.
    if (req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(res, 'Admin only', 403);
    }
    await pkService.abortPK(req.params.id, req.user.id, req.body.reason);
    return successResponse(res, null, 'PK aborted');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/:id/pause — admin */
async function pausePK(req, res) {
  try {
    // NF-1 FIX: SUPER_ADMIN only — mirrors the route-level authorize('SUPER_ADMIN') guard.
    if (req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(res, 'Admin only', 403);
    }
    await pkService.pausePK(req.params.id, req.user.id);
    return successResponse(res, null, 'PK paused');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/:id/resume — admin */
async function resumePK(req, res) {
  try {
    // NF-1 FIX: SUPER_ADMIN only — mirrors the route-level authorize('SUPER_ADMIN') guard.
    if (req.user.role !== 'SUPER_ADMIN') {
      return errorResponse(res, 'Admin only', 403);
    }
    await pkService.resumePK(req.params.id, req.user.id);
    return successResponse(res, null, 'PK resumed');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── REMATCH ──────────────────────────────────────────────────────────────────
/** POST /api/v1/pk/:id/rematch */
async function rematch(req, res) {
  try {
    const original = await prisma.pKMatch.findUnique({
      where:   { id: req.params.id },
      include: { participants: true }
    });
    if (!original) return errorResponse(res, 'PK not found', 404);
    if (original.state !== 'COMPLETED') return errorResponse(res, 'Can only rematch a completed PK', 400);

    const sideA = original.participants.find(p => p.side === 'A');
    const sideB = original.participants.find(p => p.side === 'B');
    if (!sideA || !sideB) return errorResponse(res, 'Invalid match participants', 400);

    // Requester must be a participant
    const isParticipant = sideA.userId === req.user.id || sideB.userId === req.user.id;
    if (!isParticipant) return errorResponse(res, 'Not a participant', 403);

    const { match } = await pkService.createMatch({
      type:           original.type,
      sideAUserId:    sideA.userId,
      sideBUserId:    sideB.userId,
      durationSeconds: original.durationSeconds,
      idempotencyKey: `rematch:${original.id}:${Date.now()}`,
    });

    // Link as rematch
    await prisma.pKMatch.update({
      where: { id: match.id },
      data:  { isRematch: true, previousMatchId: original.id }
    });

    return successResponse(res, match, 'Rematch created', 201);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── INVITATIONS ─────────────────────────────────────────────────────────────

/** GET /api/v1/pk/active-by-room?roomId=xxx — find active PK for a voice room */
async function getActiveByRoom(req, res) {
  try {
    const { roomId } = req.query;
    if (!roomId) return successResponse(res, []);

    const matches = await prisma.pKMatch.findMany({
      where: {
        state:  { in: ['LIVE', 'COUNTDOWN', 'PREPARING'] },
        OR: [{ roomIdA: roomId }, { roomIdB: roomId }],
      },
      include: {
        participants: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      },
      take: 1,
      orderBy: { createdAt: 'desc' },
    });

    return successResponse(res, matches);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** GET /api/v1/pk/invitations — list pending invitations for the current user */
async function getInvitations(req, res) {
  try {
    const { status = 'PENDING' } = req.query;
    const validStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'];
    const statusFilter = validStatuses.includes(status) ? status : 'PENDING';

    const invitations = await prisma.pKInvitation.findMany({
      where: {
        receiverId: req.user.id,
        status: statusFilter,
        // For PENDING, also filter out expired ones
        ...(statusFilter === 'PENDING' && { expiresAt: { gt: new Date() } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Enrich with sender user data
    const senderIds = [...new Set(invitations.map(i => i.senderId))];
    const senders   = await prisma.user.findMany({
      where:  { id: { in: senderIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, username: true },
    });
    const senderMap = new Map(senders.map(s => [s.id, s]));
    const enriched  = invitations.map(inv => ({
      ...inv,
      sender: senderMap.get(inv.senderId) || null,
    }));

    return successResponse(res, enriched);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** POST /api/v1/pk/invitations */
async function sendInvitation(req, res) {  try {
    const { receiverId, type, durationSeconds, message, teamSize } = req.body;
    const senderId = req.user.id;

    if (!receiverId) return errorResponse(res, 'receiverId is required', 400);
    if (senderId === receiverId) return errorResponse(res, 'Cannot invite yourself', 400);

    const config = await pkService.getConfig();
    if (!config.pkEnabled) return errorResponse(res, 'PK is currently disabled', 503);

    // Check receiver exists
    const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true, status: true } });
    if (!receiver || receiver.status !== 'ACTIVE') return errorResponse(res, 'Receiver not found', 404);

    // Prevent duplicate pending invitations — only block if there is a PENDING
    // invitation that has NOT yet expired. Expired invitations that were never
    // explicitly rejected stay PENDING in the DB until the receiver tries to
    // accept them; we must not let them block a fresh re-invitation.
    const existing = await prisma.pKInvitation.findFirst({
      where: {
        senderId,
        receiverId,
        status:    'PENDING',
        expiresAt: { gt: new Date() },   // only block if still within the 5-min window
      }
    });
    if (existing) {
      return errorResponse(res, 'You already have a pending challenge to this player', 409);
    }

    // Auto-expire any stale PENDING invitations between these two users
    // so the DB stays clean (fire-and-forget, non-fatal)
    prisma.pKInvitation.updateMany({
      where: {
        senderId,
        receiverId,
        status:    'PENDING',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED' }
    }).catch(() => {});

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const invitation = await prisma.pKInvitation.create({
      data: {
        id:              uuidv4(),
        senderId,
        receiverId,
        type:            type || 'ONE_V_ONE',
        durationSeconds: durationSeconds || config.defaultDurationSeconds,
        teamSize:        teamSize || 1,
        message:         message || null,
        status:          'PENDING',
        expiresAt,
      }
    });

    // Notify receiver
    await notify(receiverId, {
      type:  'PK_INVITATION',
      title: '⚔️ PK Challenge!',
      body:  `${req.user.firstName} challenged you to a PK battle!`,
      data:  { invitationId: invitation.id, senderId, type: invitation.type },
      channels: ['push']
    });

    pkService.emitPKUser(receiverId, 'pk:invitation', {
      invitation,
      sender: { id: senderId, firstName: req.user.firstName, lastName: req.user.lastName, avatarUrl: req.user.avatarUrl }
    });

    return successResponse(res, invitation, 'Invitation sent', 201);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/invitations/:id/accept */
async function acceptInvitation(req, res) {
  try {
    const invitation = await prisma.pKInvitation.findUnique({ where: { id: req.params.id } });
    if (!invitation) return errorResponse(res, 'Invitation not found', 404);
    if (invitation.receiverId !== req.user.id) return errorResponse(res, 'Not authorized', 403);
    if (invitation.status !== 'PENDING') return errorResponse(res, 'Invitation is no longer pending', 400);
    if (invitation.expiresAt < new Date()) {
      await prisma.pKInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
      return errorResponse(res, 'Invitation expired', 400);
    }

    // BUG-004 FIX: Prevent accepting while already in an active PK.
    // Without this check, a user could accept two simultaneous invitations
    // and appear as a participant in two concurrent matches.
    const activePK = await prisma.pKParticipant.findFirst({
      where: {
        userId: req.user.id,
        isActive: true,
        match: { state: { in: ['LIVE', 'COUNTDOWN', 'PREPARING', 'MATCHMAKING'] } }
      }
    });
    if (activePK) return errorResponse(res, 'You are already in an active PK', 409);

    const config = await pkService.getConfig();

    // FIX: Detect which voice room each participant is currently in.
    // This is how roomIdA/roomIdB gets populated so the PK banner appears
    // in the correct voice rooms. We look up each user's active VoiceParticipant.
    const [senderRoom, receiverRoom] = await Promise.all([
      prisma.voiceParticipant.findFirst({
        where: { userId: invitation.senderId, isActive: true },
        select: { roomId: true },
        orderBy: { joinedAt: 'desc' },
      }),
      prisma.voiceParticipant.findFirst({
        where: { userId: req.user.id, isActive: true },
        select: { roomId: true },
        orderBy: { joinedAt: 'desc' },
      }),
    ]);

    const { match } = await pkService.createMatch({
      type:           invitation.type,
      sideAUserId:    invitation.senderId,
      sideBUserId:    req.user.id,
      durationSeconds: invitation.durationSeconds,
      // Pass the voice room IDs so pk:room:started is emitted and the banner appears
      roomIdA:        senderRoom?.roomId   || null,
      roomIdB:        receiverRoom?.roomId || null,
      idempotencyKey: `inv:${invitation.id}`,
    });

    await prisma.pKInvitation.update({
      where: { id: invitation.id },
      data:  { status: 'ACCEPTED', acceptedAt: new Date(), pkMatchId: match.id }
    });

    // Notify sender
    pkService.emitPKUser(invitation.senderId, 'pk:accepted', { pkMatchId: match.id, acceptedBy: req.user.id });
    await notify(invitation.senderId, {
      type: 'PK_ACCEPTED', title: '⚔️ Challenge Accepted!',
      body: `${req.user.firstName} accepted your PK challenge!`,
      data: { pkMatchId: match.id }, channels: ['push']
    });

    return successResponse(res, { match, invitation }, 'Invitation accepted');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/invitations/:id/reject */
async function rejectInvitation(req, res) {
  try {
    const invitation = await prisma.pKInvitation.findUnique({ where: { id: req.params.id } });
    if (!invitation) return errorResponse(res, 'Invitation not found', 404);
    if (invitation.receiverId !== req.user.id) return errorResponse(res, 'Not authorized', 403);
    if (invitation.status !== 'PENDING') return errorResponse(res, 'Invitation is no longer pending', 400);

    await prisma.pKInvitation.update({
      where: { id: invitation.id },
      data:  { status: 'REJECTED', rejectedAt: new Date() }
    });

    pkService.emitPKUser(invitation.senderId, 'pk:rejected', { invitationId: invitation.id });

    return successResponse(res, null, 'Invitation rejected');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/invitations/:id/cancel — sender cancels their own pending invitation */
async function cancelInvitation(req, res) {
  try {
    const invitation = await prisma.pKInvitation.findUnique({ where: { id: req.params.id } });
    if (!invitation) return errorResponse(res, 'Invitation not found', 404);

    // Only the sender can cancel
    if (invitation.senderId !== req.user.id) return errorResponse(res, 'Not authorized', 403);
    if (invitation.status !== 'PENDING') return errorResponse(res, 'Invitation is no longer pending', 400);

    await prisma.pKInvitation.update({
      where: { id: invitation.id },
      data:  { status: 'CANCELLED', cancelledAt: new Date() }
    });

    // Notify receiver that the challenge was withdrawn
    pkService.emitPKUser(invitation.receiverId, 'pk:cancelled', { invitationId: invitation.id });

    return successResponse(res, null, 'Invitation cancelled');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── MATCHMAKING ─────────────────────────────────────────────────────────────
/** POST /api/v1/pk/matchmaking/join */
async function joinMatchmaking(req, res) {
  try {
    const entry = await joinQueue(req.user.id, req.body);
    return successResponse(res, entry, 'Joined matchmaking queue');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** POST /api/v1/pk/matchmaking/leave */
async function leaveMatchmaking(req, res) {
  try {
    await leaveQueue(req.user.id, req.body.type);
    return successResponse(res, null, 'Left matchmaking queue');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

/** GET /api/v1/pk/matchmaking/status */
async function matchmakingStatus(req, res) {
  try {
    const status = await getQueueStatus(req.user.id);
    return successResponse(res, status);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── VOTE ─────────────────────────────────────────────────────────────────────
/** POST /api/v1/pk/:id/vote */
async function vote(req, res) {
  try {
    const { side } = req.body;
    if (!['A', 'B'].includes(side)) return errorResponse(res, 'side must be A or B', 400);
    await pkService.castVote(req.params.id, req.user.id, side);
    return successResponse(res, null, 'Vote cast');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
/** GET /api/v1/pk/history */
async function getHistory(req, res) {
  try {
    const { page = 1, limit = 20, userId } = req.query;
    const { skip } = getPagination(page, limit);
    const take     = Math.min(parseInt(limit) || 20, 50);
    const targetId = userId || req.user.id;

    const where = {
      participantIds: { path: '$', array_contains: targetId }
    };

    const [history, total] = await Promise.all([
      prisma.pKHistory.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.pKHistory.count({ where })
    ]);

    return paginatedResponse(res, history, buildPaginationMeta(total, parseInt(page), take));
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** GET /api/v1/pk/stats/:userId */
async function getUserStats(req, res) {
  try {
    const userId = req.params.userId || req.user.id;
    const stats  = await prisma.pKUserStats.findUnique({ where: { userId } });
    return successResponse(res, stats || {});
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── LEADERBOARDS ─────────────────────────────────────────────────────────────
/** GET /api/v1/pk/leaderboards */
async function getLeaderboards(req, res) {
  try {
    const { scope = 'weekly', limit = 50 } = req.query;
    const validScopes = ['daily', 'weekly', 'monthly', 'season', 'all_time'];
    if (!validScopes.includes(scope)) return errorResponse(res, 'Invalid scope', 400);

    const period = buildPeriod(scope);
    const take   = Math.min(parseInt(limit) || 50, 100);

    let entries = await prisma.pKLeaderboardEntry.findMany({
      where:   { scope, period },
      orderBy: { rank: 'asc' },
      take,
    });

    // If no cached entries, compute from stats
    if (entries.length === 0) {
      const stats = await prisma.pKUserStats.findMany({
        orderBy: { rating: 'desc' },
        take,
        select:  { userId: true, rating: true, wins: true, totalScore: true }
      });
      entries = stats.map((s, i) => ({ ...s, rank: i + 1, scope, period }));
    }

    // Enrich with user data
    const userIds = entries.map(e => e.userId);
    const users   = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));
    const enriched = entries.map(e => ({ ...e, user: userMap.get(e.userId) || null }));

    return successResponse(res, { scope, period, leaderboard: enriched });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

function buildPeriod(scope) {
  const now  = new Date();
  const y    = now.getUTCFullYear();
  const m    = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d    = String(now.getUTCDate()).padStart(2, '0');
  const week = getISOWeek(now);
  switch (scope) {
    case 'daily':    return `${y}-${m}-${d}`;
    case 'weekly':   return `${y}-W${week}`;
    case 'monthly':  return `${y}-${m}`;
    case 'all_time': return 'all';
    default:         return `${y}-${m}`;
  }
}

function getISOWeek(date) {
  const d   = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const jan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return String(Math.ceil((((d - jan) / 86400000) + 1) / 7)).padStart(2, '0');
}

// ─── SEASONS / TOURNAMENTS ────────────────────────────────────────────────────
/** GET /api/v1/pk/seasons */
async function getSeasons(req, res) {
  try {
    const seasons = await prisma.pKSeason.findMany({
      orderBy: { startDate: 'desc' },
      take:    10
    });
    return successResponse(res, seasons);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** GET /api/v1/pk/tournaments */
async function getTournaments(req, res) {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    const tournaments = await prisma.pKTournament.findMany({
      where,
      orderBy: { startDate: 'desc' },
      take: 20
    });
    return successResponse(res, tournaments);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── RECONNECT ────────────────────────────────────────────────────────────────
/** GET /api/v1/pk/:id/reconnect */
async function reconnect(req, res) {
  try {
    const state = await pkService.getReconnectState(req.params.id, req.user.id);
    if (!state) return errorResponse(res, 'PK not found', 404);
    return successResponse(res, state);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── ACHIEVEMENTS / MISSIONS ──────────────────────────────────────────────────
/** GET /api/v1/pk/achievements */
async function getAchievements(req, res) {
  try {
    const achievements = await prisma.pKAchievement.findMany({ where: { isActive: true } });
    const userAchs     = await prisma.pKUserAchievement.findMany({
      where: { userId: req.user.id },
      select: { achievementId: true, unlockedAt: true }
    });
    const unlocked = new Map(userAchs.map(a => [a.achievementId, a.unlockedAt]));
    const enriched = achievements.map(a => ({
      ...a, unlockedAt: unlocked.get(a.id) || null, isUnlocked: unlocked.has(a.id)
    }));
    return successResponse(res, enriched);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

/** GET /api/v1/pk/missions */
async function getMissions(req, res) {
  try {
    const missions  = await prisma.pKMission.findMany({ where: { isActive: true } });
    const today     = startOfDay(new Date());
    const progress  = await prisma.pKMissionProgress.findMany({
      where: { userId: req.user.id, periodStart: { gte: today } },
      select: { missionId: true, progress: true, target: true, completed: true }
    });
    const progMap = new Map(progress.map(p => [p.missionId, p]));
    const enriched = missions.map(m => ({
      ...m,
      progress:  progMap.get(m.id)?.progress || 0,
      target:    progMap.get(m.id)?.target || 1,
      completed: progMap.get(m.id)?.completed || false,
    }));
    return successResponse(res, enriched);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

module.exports = {
  createPK, getPK, startPK, endPK, abortPK, pausePK, resumePK, rematch,
  getActiveByRoom,
  getInvitations, sendInvitation, acceptInvitation, rejectInvitation, cancelInvitation,
  joinMatchmaking, leaveMatchmaking, matchmakingStatus,
  vote,
  getHistory, getUserStats,
  getLeaderboards, getSeasons, getTournaments,
  reconnect,
  getAchievements, getMissions,
};
