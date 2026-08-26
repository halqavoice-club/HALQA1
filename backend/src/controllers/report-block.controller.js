/**
 * Report & Block Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Report a user:
 *   POST   /social/report/:userId      — submit / update a report
 *   GET    /social/reports             — admin: list all reports
 *   PATCH  /social/reports/:id/review  — admin: update report status
 *
 * Block a user:
 *   POST   /social/block/:userId       — block a user
 *   DELETE /social/block/:userId       — unblock a user
 *   GET    /social/blocked             — list users I've blocked
 *   GET    /social/block/:userId/status — check if I've blocked them or vice versa
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { getIo } = require('../sockets');
const logger = require('../utils/logger');

const USER_SELECT = {
  id: true, firstName: true, lastName: true, avatarUrl: true, role: true
};

const VALID_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'sexual_content',
  'scam',
  'impersonation',
  'underage',
  'other',
];

// ─── REPORT USER ─────────────────────────────────────────────────────────────

async function reportUser(req, res, next) {
  try {
    const reporterId = req.user.id;
    const reportedId = req.params.userId;
    const { reason, description, roomId } = req.body;

    if (reporterId === reportedId) {
      return errorResponse(res, 'Cannot report yourself', 400);
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return errorResponse(res, `reason must be one of: ${VALID_REASONS.join(', ')}`, 400);
    }

    const reported = await prisma.user.findUnique({
      where: { id: reportedId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!reported) return errorResponse(res, 'User not found', 404);

    // Block duplicate PENDING reports — one active report per user pair at a time.
    // Note: the DB unique constraint was relaxed (migration 20260821_fix_user_report_constraint)
    // to allow re-reporting after a prior report was dismissed/resolved.
    // This guard prevents spamming with multiple simultaneous PENDING reports.
    const pendingReport = await prisma.userReport.findFirst({
      where: { reporterId, reportedId, status: 'PENDING' },
      select: { id: true }
    });
    if (pendingReport) {
      return errorResponse(res, 'You already have a pending report against this user. Wait for it to be reviewed.', 409);
    }

    // Create a new report record (allows multiple reports over time, one PENDING at a time)
    const report = await prisma.userReport.create({
      data: {
        id: uuidv4(),
        reporterId,
        reportedId,
        roomId: roomId || null,
        reason,
        description: description?.trim() || null,
        status: 'PENDING',
      },
    });

    // Notify platform admins via socket (they can monitor from a dashboard)
    // SOC-P0-03 FIX: Emit to role:SUPER_ADMIN only.
    // Previously emitted to both role:SUPER_ADMIN and role:SCHOOL_ADMIN, which
    // leaked platform-wide report metadata (reporter ID, reported user ID, reason)
    // to school-scoped administrators who have no jurisdiction over social platform
    // reports. Social moderation is SUPER_ADMIN (HALQA platform) only.
    const io = getIo();
    if (io) {
      io.to('role:SUPER_ADMIN').emit('admin:user_reported', {
        reportId:   report.id,
        reporter:   { id: reporterId, firstName: req.user.firstName, lastName: req.user.lastName },
        reportedId,
        reason,
      });
    }

    return successResponse(res, { reportId: report.id }, 'Report submitted. Our team will review it.', 201);
  } catch (error) { next(error); }
}

// ─── ADMIN: LIST REPORTS ──────────────────────────────────────────────────────

async function listReports(req, res, next) {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = status ? { status } : {};

    const [reports, total] = await Promise.all([
      prisma.userReport.findMany({
        where,
        include: {
          reporter: { select: USER_SELECT },
          reported: { select: USER_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Math.min(parseInt(limit), 100),
      }),
      prisma.userReport.count({ where }),
    ]);

    return successResponse(res, { reports, total, page: parseInt(page) });
  } catch (error) { next(error); }
}

// ─── ADMIN: REVIEW REPORT ─────────────────────────────────────────────────────

async function reviewReport(req, res, next) {
  try {
    const { id } = req.params;
    const { status, action } = req.body;  // action: 'WARN' | 'SUSPEND' | 'BAN' — only with ACTION_TAKEN
    const validStatuses = ['REVIEWED', 'DISMISSED', 'ACTION_TAKEN'];

    if (!validStatuses.includes(status)) {
      return errorResponse(res, `status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const report = await prisma.userReport.findUnique({ where: { id } });
    if (!report) return errorResponse(res, 'Report not found', 404);

    const updated = await prisma.userReport.update({
      where: { id },
      data: {
        status,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        updatedAt:  new Date(),
      },
    });

    // ARCHITECTURE FIX (HALQA-ARCH-05):
    // ACTION_TAKEN now has downstream enforcement.
    // When action is specified, apply the actual moderation action to the reported user.
    // All moderation actions are server-side and create an audit log.
    if (status === 'ACTION_TAKEN' && action && report.reportedId) {
      const validActions = ['WARN', 'SUSPEND', 'BAN'];
      if (validActions.includes(action)) {
        const { v4: uuidv4 } = require('uuid');

        // Determine new user status
        const newUserStatus = action === 'BAN' ? 'BANNED' : action === 'SUSPEND' ? 'SUSPENDED' : null;

        if (newUserStatus) {
          const target = await prisma.user.findUnique({
            where: { id: report.reportedId },
            select: { role: true, status: true }
          });

          // Never suspend/ban another SUPER_ADMIN via the report queue
          if (target && target.role !== 'SUPER_ADMIN') {
            await prisma.$transaction([
              prisma.user.update({
                where: { id: report.reportedId },
                data:  { status: newUserStatus }
              }),
              prisma.auditLog.create({
                data: {
                  id:        uuidv4(),
                  userId:    req.user.id,
                  schoolId:  null,
                  action:    'UPDATE',
                  entity:    'user_moderation',
                  entityId:  report.reportedId,
                  oldValues: { status: target.status },
                  newValues: {
                    status:   newUserStatus,
                    reason:   `Report ${id} reviewed — action: ${action}`,
                    reportId: id,
                  },
                  ipAddress: req.ip || null,
                  userAgent: req.headers['user-agent'] || null,
                }
              })
            ]);

            // Immediately invalidate auth cache so status propagates within 30s
            const { invalidateUserCache } = require('../middleware/auth.middleware');
            await invalidateUserCache(report.reportedId);
          }
        }
      }
    }

    // FS-GAP-003 FIX: Audit log every report review action (UIGAP-013).
    // Previously report reviews had no audit trail. Now every decision is recorded.
    const { v4: uuidv4Audit } = require('uuid');
    prisma.auditLog.create({
      data: {
        id:        uuidv4Audit(),
        userId:    req.user.id,
        action:    'UPDATE',
        entity:    'report_review',
        entityId:  id,
        newValues: {
          reviewDecision:   status,
          moderationAction: (status === 'ACTION_TAKEN' && action) ? action : null,
          reporterId:       report.reporterId,
          reportedId:       report.reportedId,
          reason:           report.reason,
        },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      }
    }).catch(err => logger.warn(`[report] Review audit log failed: ${err.message}`));

    return successResponse(res, updated, 'Report updated');
  } catch (error) { next(error); }
}

async function blockUser(req, res, next) {
  try {
    const blockerId = req.user.id;
    const blockedId = req.params.userId;

    if (blockerId === blockedId) {
      return errorResponse(res, 'Cannot block yourself', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: blockedId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!target) return errorResponse(res, 'User not found', 404);

    // Idempotent — ignore if already blocked
    await prisma.userBlock.upsert({
      where:  { blockerId_blockedId: { blockerId, blockedId } },
      create: { id: uuidv4(), blockerId, blockedId },
      update: {},
    });

    // Side-effects: auto-unfollow both directions + remove friendship
    await Promise.allSettled([
      prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      }),
      prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: blockerId, receiverId: blockedId },
            { senderId: blockedId, receiverId: blockerId },
          ],
        },
      }),
    ]);

    return successResponse(res, { blocked: true }, `${target.firstName} has been blocked`);
  } catch (error) { next(error); }
}

// ─── UNBLOCK USER ─────────────────────────────────────────────────────────────

async function unblockUser(req, res, next) {
  try {
    const blockerId = req.user.id;
    const blockedId = req.params.userId;

    await prisma.userBlock.deleteMany({
      where: { blockerId, blockedId },
    });

    return successResponse(res, { blocked: false }, 'User unblocked');
  } catch (error) { next(error); }
}

// ─── LIST BLOCKED USERS ───────────────────────────────────────────────────────

async function getBlockedUsers(req, res, next) {
  try {
    const blockerId = req.user.id;
    const { limit = 50 } = req.query;

    const blocks = await prisma.userBlock.findMany({
      where: { blockerId },
      include: { blocked: { select: USER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 200),
    });

    return successResponse(res, blocks.map(b => ({
      ...b.blocked,
      blockedAt: b.createdAt,
    })));
  } catch (error) { next(error); }
}

// ─── CHECK BLOCK STATUS ───────────────────────────────────────────────────────

async function getBlockStatus(req, res, next) {
  try {
    const meId     = req.user.id;
    const otherId  = req.params.userId;

    const [iBlocked, theyBlocked] = await Promise.all([
      prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: meId,    blockedId: otherId } },
      }),
      prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: otherId, blockedId: meId    } },
      }),
    ]);

    return successResponse(res, {
      iBlockedThem:    !!iBlocked,
      theyBlockedMe:   !!theyBlocked,
      isBlocked:       !!(iBlocked || theyBlocked),
    });
  } catch (error) { next(error); }
}

module.exports = {
  reportUser,
  listReports,
  reviewReport,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getBlockStatus,
};
