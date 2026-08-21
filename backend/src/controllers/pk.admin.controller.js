/**
 * PK Admin Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only endpoints for PK management. All actions are audited.
 * Every administrative action records a PKAuditLog entry.
 */

'use strict';

const { v4: uuidv4 }  = require('uuid');
const prisma          = require('../utils/prisma');
const pkService       = require('../services/pk.service');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const logger          = require('../utils/logger');

// ─── List Active PKs ──────────────────────────────────────────────────────────
async function listActivePKs(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(parseInt(limit) || 20, 100);

    const [matches, total] = await Promise.all([
      prisma.pKMatch.findMany({
        where:   { state: { in: ['LIVE', 'COUNTDOWN', 'PREPARING', 'PAUSED', 'MATCHMAKING'] } },
        include: {
          participants: {
            include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.pKMatch.count({
        where: { state: { in: ['LIVE', 'COUNTDOWN', 'PREPARING', 'PAUSED', 'MATCHMAKING'] } }
      })
    ]);

    return paginatedResponse(res, matches, buildPaginationMeta(total, parseInt(page), take));
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── Search PKs ───────────────────────────────────────────────────────────────
async function searchPKs(req, res) {
  try {
    const { q, state, page = 1, limit = 20 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(parseInt(limit) || 20, 100);

    const where = {};
    if (state) where.state = state;
    if (q) where.id = { contains: q };

    const [matches, total] = await Promise.all([
      prisma.pKMatch.findMany({
        where,
        include: {
          participants: {
            include: { user: { select: { id: true, firstName: true, lastName: true } } }
          },
          history: { select: { winnerId: true, winnerSide: true, scoreA: true, scoreB: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip, take
      }),
      prisma.pKMatch.count({ where })
    ]);

    return paginatedResponse(res, matches, buildPaginationMeta(total, parseInt(page), take));
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── Get PK Detail ────────────────────────────────────────────────────────────
async function getPKDetail(req, res) {
  try {
    const match = await prisma.pKMatch.findUnique({
      where:   { id: req.params.id },
      include: {
        participants: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        },
        teams:    true,
        gifts:    { orderBy: { createdAt: 'desc' }, take: 50 },
        votes:    { take: 100 },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        history:  true,
      }
    });

    if (!match) return errorResponse(res, 'PK not found', 404);
    return successResponse(res, match);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── Force End PK ─────────────────────────────────────────────────────────────
async function forceEndPK(req, res) {
  try {
    const { reason } = req.body;
    const result = await pkService.finishPK(req.params.id, { endedByAdmin: true });

    await prisma.pKAuditLog.create({
      data: {
        id:       uuidv4(),
        pkMatchId: req.params.id,
        adminId:  req.user.id,
        action:   'FORCE_END',
        reason:   reason || 'Admin forced end',
      }
    });

    logger.info(`[pk:admin] ${req.user.id} force-ended PK ${req.params.id}`);
    return successResponse(res, result, 'PK force-ended');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Disqualify participant ───────────────────────────────────────────────────
async function disqualify(req, res) {
  try {
    const { userId, reason } = req.body;
    if (!userId) return errorResponse(res, 'userId is required', 400);

    await prisma.pKParticipant.updateMany({
      where: { pkMatchId: req.params.id, userId },
      data:  { isActive: false, leftAt: new Date() }
    });

    await prisma.pKAuditLog.create({
      data: {
        id:        uuidv4(),
        pkMatchId: req.params.id,
        adminId:   req.user.id,
        action:    'DISQUALIFY',
        reason:    reason || 'Admin disqualified participant',
        beforeValue: { userId },
      }
    });

    pkService.emitPK(req.params.id, 'pk:error', { message: `${userId} was disqualified by admin` });
    return successResponse(res, null, 'Participant disqualified');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Mark as Disputed ─────────────────────────────────────────────────────────
async function markDisputed(req, res) {
  try {
    const { reason } = req.body;
    const match = await prisma.pKMatch.findUnique({ where: { id: req.params.id } });
    if (!match) return errorResponse(res, 'PK not found', 404);

    await prisma.pKMatch.update({
      where: { id: req.params.id },
      data:  { state: 'DISPUTED', disputeReason: reason }
    });

    await prisma.pKAuditLog.create({
      data: {
        id:        uuidv4(),
        pkMatchId: req.params.id,
        adminId:   req.user.id,
        action:    'MARK_DISPUTED',
        reason,
      }
    });

    pkService.emitPK(req.params.id, 'pk:error', { message: 'This PK is under review' });
    return successResponse(res, null, 'PK marked as disputed');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Get Suspicious PKs ───────────────────────────────────────────────────────
async function getSuspiciousPKs(req, res) {
  try {
    // Find recently flagged analytics events
    const events = await prisma.pKAnalyticsEvent.findMany({
      where:   { eventType: 'PK_CHEAT_FLAGGED' },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    return successResponse(res, events);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

// ─── PK Config Management ─────────────────────────────────────────────────────
async function getPKConfig(req, res) {
  try {
    const config = await pkService.getConfig();
    return successResponse(res, config);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

async function updatePKConfig(req, res) {
  try {
    // DB-HARDENING: Whitelist allowed PKConfig fields — prevent mass-assignment.
    // PKConfig has no role/user fields, but explicit whitelisting prevents
    // future schema additions from accidentally becoming writable via req.body.
    const {
      pkEnabled, defaultDurationSeconds, maxTeamSize, minBetAmount, maxBetAmount,
      giftMultiplier, winnerRewardMultiplier, matchmakingTimeout, ratingKFactor,
      maxRatingDiff, allowSameSchool, tournamentMode, seasonEnabled
    } = req.body;

    const allowedData = {
      updatedAt: new Date(),
      ...(pkEnabled               !== undefined && { pkEnabled:               Boolean(pkEnabled) }),
      ...(defaultDurationSeconds  !== undefined && { defaultDurationSeconds:  parseInt(defaultDurationSeconds) }),
      ...(maxTeamSize             !== undefined && { maxTeamSize:             parseInt(maxTeamSize) }),
      ...(minBetAmount            !== undefined && { minBetAmount:            parseInt(minBetAmount) }),
      ...(maxBetAmount            !== undefined && { maxBetAmount:            parseInt(maxBetAmount) }),
      ...(giftMultiplier          !== undefined && { giftMultiplier:          parseFloat(giftMultiplier) }),
      ...(winnerRewardMultiplier  !== undefined && { winnerRewardMultiplier:  parseFloat(winnerRewardMultiplier) }),
      ...(matchmakingTimeout      !== undefined && { matchmakingTimeout:      parseInt(matchmakingTimeout) }),
      ...(ratingKFactor           !== undefined && { ratingKFactor:           parseFloat(ratingKFactor) }),
      ...(maxRatingDiff           !== undefined && { maxRatingDiff:           parseInt(maxRatingDiff) }),
      ...(allowSameSchool         !== undefined && { allowSameSchool:         Boolean(allowSameSchool) }),
      ...(tournamentMode          !== undefined && { tournamentMode:          Boolean(tournamentMode) }),
      ...(seasonEnabled           !== undefined && { seasonEnabled:           Boolean(seasonEnabled) }),
    };

    const config = await prisma.pKConfig.findFirst();
    const updated = config
      ? await prisma.pKConfig.update({ where: { id: config.id }, data: allowedData })
      : await prisma.pKConfig.create({ data: { id: uuidv4(), ...allowedData } });

    pkService.clearConfigCache();

    await prisma.pKAuditLog.create({
      data: {
        id:        uuidv4(),
        pkMatchId: 'config',
        adminId:   req.user.id,
        action:    'UPDATE_CONFIG',
        afterValue: allowedData,
      }
    }).catch(() => {});

    return successResponse(res, updated, 'PK config updated');
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Season Management ────────────────────────────────────────────────────────
async function createSeason(req, res) {
  try {
    const { name, startDate, endDate, description, rules } = req.body;
    if (!name || !startDate || !endDate) {
      return errorResponse(res, 'name, startDate and endDate are required', 400);
    }
    const season = await prisma.pKSeason.create({
      data: {
        id:          uuidv4(),
        name,
        startDate:   new Date(startDate),
        endDate:     new Date(endDate),
        status:      'UPCOMING',
        description: description || null,
        rules:       rules || null,
      }
    });
    return successResponse(res, season, 'Season created', 201);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

async function updateSeason(req, res) {
  try {
    // DB-HARDENING: Whitelist allowed PKSeason fields — prevent mass-assignment.
    const { name, startDate, endDate, status, description, rules } = req.body;
    const allowedData = {
      ...(name        !== undefined && { name }),
      ...(startDate   !== undefined && { startDate: new Date(startDate) }),
      ...(endDate     !== undefined && { endDate:   new Date(endDate) }),
      ...(status      !== undefined && { status }),
      ...(description !== undefined && { description: description || null }),
      ...(rules       !== undefined && { rules: rules || null }),
    };
    const season = await prisma.pKSeason.update({
      where: { id: req.params.id },
      data:  allowedData,
    });
    return successResponse(res, season);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Tournament Management ────────────────────────────────────────────────────
async function createTournament(req, res) {
  try {
    const { name, registrationStart, registrationEnd, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) return errorResponse(res, 'name, startDate, endDate required', 400);

    const tournament = await prisma.pKTournament.create({
      data: {
        id:                uuidv4(),
        name,
        registrationStart: new Date(registrationStart || startDate),
        registrationEnd:   new Date(registrationEnd   || startDate),
        startDate:         new Date(startDate),
        endDate:           new Date(endDate),
        createdBy:         req.user.id,
        ...req.body,
      }
    });
    return successResponse(res, tournament, 'Tournament created', 201);
  } catch (err) {
    return errorResponse(res, err.message, 400);
  }
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
async function getPKAuditLog(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const { skip } = getPagination(page, limit);
    const take = Math.min(parseInt(limit) || 50, 200);

    const where = req.params.id ? { pkMatchId: req.params.id } : {};

    const [logs, total] = await Promise.all([
      prisma.pKAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.pKAuditLog.count({ where })
    ]);

    return paginatedResponse(res, logs, buildPaginationMeta(total, parseInt(page), take));
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

module.exports = {
  listActivePKs,
  searchPKs,
  getPKDetail,
  forceEndPK,
  disqualify,
  markDisputed,
  getSuspiciousPKs,
  getPKConfig,
  updatePKConfig,
  createSeason,
  updateSeason,
  createTournament,
  getPKAuditLog,
};
