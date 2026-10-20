'use strict';
/**
 * admin-stats.routes.js — HALQA Platform Super Admin Statistics
 * Mounted at: /api/v1/admin/stats
 *
 * SECURITY: SUPER_ADMIN only + IP allowlist
 * Provides platform-wide statistics for the admin dashboard.
 */

const router  = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ipAllowlist = require('../middleware/ipAllowlist');
const prisma  = require('../utils/prisma');
const { successResponse } = require('../utils/response');

router.use(ipAllowlist);
router.use(authenticate);
router.use(authorize('SUPER_ADMIN'));

// GET /api/v1/admin/stats — platform-wide summary stats
router.get('/', async (req, res, next) => {
  try {
    const now   = new Date();
    const day7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Use raw SQL for status-enum queries to bypass stale Prisma client binary
    // (Prisma DLL may not know about BANNED until npx prisma generate is re-run
    //  after backend restart — raw SQL always works regardless of client state)
    const suspendedRaw = await prisma.$queryRaw`
      SELECT COUNT(*) as cnt FROM users
      WHERE deletedAt IS NULL AND status IN ('SUSPENDED', 'BANNED')
    `.catch(() => [{ cnt: 0 }]);
    const suspendedUsers = Number(suspendedRaw[0]?.cnt ?? 0);

    const [
      totalUsers,
      activeUsers,
      newUsersLast7,
      newUsersLast30,
      totalSchools,
      activeSchools,
      totalMembers,
      totalClasses,
      totalLiveClasses,
      activeLiveClasses,
      pendingReports,
      totalAuditLogs,
      auditLogs7d,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: day7 } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: day30 } } }),
      prisma.school.count({ where: { deletedAt: null } }),
      prisma.school.count({ where: { deletedAt: null, isActive: true } }),
      prisma.schoolMembership.count({ where: { status: 'ACTIVE' } }),
      prisma.class.count({ where: { deletedAt: null } }),
      prisma.liveClass.count(),
      prisma.liveClass.count({ where: { status: 'LIVE' } }),
      prisma.userReport.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: day7 } } }),
    ]);

    return successResponse(res, {
      users: {
        total:       totalUsers,
        active:      activeUsers,
        suspended:   suspendedUsers,
        newLast7d:   newUsersLast7,
        newLast30d:  newUsersLast30,
      },
      schools: {
        total:        totalSchools,
        active:       activeSchools,
        totalMembers,
        totalClasses,
      },
      liveClasses: {
        total:  totalLiveClasses,
        active: activeLiveClasses,
      },
      moderation: {
        pendingReports,
      },
      audit: {
        total:    totalAuditLogs,
        last7d:   auditLogs7d,
      },
      generatedAt: now.toISOString(),
    });
  } catch (error) { next(error); }
});

// GET /api/v1/admin/stats/users — paginated user list with search/filter
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status, role } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit) || 20, 100);
    const take = Math.min(Number(limit) || 20, 100);

    const where = {
      deletedAt: null,
      ...(status && { status: String(status) }),
      ...(role   && { role:   String(role) }),
      ...(search ? {
        OR: [
          { firstName: { contains: String(search) } },
          { lastName:  { contains: String(search) } },
          { email:     { contains: String(search) } },
        ]
      } : {})
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, avatarUrl: true,
          lastLoginAt: true, createdAt: true,
          _count: { select: { schoolMemberships: true } }
        },
        skip, take,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return successResponse(res, {
      users,
      pagination: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) { next(error); }
});

// GET /api/v1/admin/stats/users/:id/wallet — wallet + recent transactions + school memberships for profile drill-down
// UIGAP-003 FIX: Provides all data needed by the admin user profile page without direct DB access.
router.get('/users/:id/wallet', async (req, res, next) => {
  try {
    const { id: targetId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: targetId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const [wallet, recentTransactions, schoolMemberships] = await Promise.all([
      // Wallet balance
      prisma.wallet.findUnique({
        where:  { userId: targetId },
        select: { coins: true, diamonds: true, totalSpent: true, totalEarned: true, updatedAt: true }
      }),

      // Last 20 wallet transactions
      prisma.walletTransaction.findMany({
        where:   { userId: targetId },
        orderBy: { createdAt: 'desc' },
        take:    20,
        select: {
          id: true, type: true, coins: true, description: true,
          stripeSessionId: true, packageId: true, createdAt: true
        }
      }),

      // Active school memberships
      prisma.schoolMembership.findMany({
        where:   { userId: targetId, deletedAt: null },
        orderBy: { joinedAt: 'desc' },
        include: {
          school: {
            select: { id: true, name: true, slug: true, logoUrl: true, type: true, isActive: true }
          }
        },
        select: {
          id: true, schoolId: true, role: true, status: true, joinedAt: true,
          school: true
        }
      })
    ]);

    return successResponse(res, {
      user,
      wallet: wallet ?? { coins: 0, diamonds: 0, totalSpent: 0, totalEarned: 0 },
      recentTransactions,
      schoolMemberships,
    });
  } catch (error) { next(error); }
});

// PATCH /api/v1/admin/stats/users/:id/status — suspend/ban/activate a user
router.patch('/users/:id/status', async (req, res, next) => {  try {
    const { status, reason } = req.body;
    const allowed = ['ACTIVE', 'SUSPENDED', 'BANNED', 'INACTIVE'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${allowed.join(', ')}` });
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, status: true, email: true }
    });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Cannot change status of another SUPER_ADMIN' });
    }

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: req.params.id },
        data:  { status },
        select: { id: true, email: true, status: true, role: true }
      }),
      prisma.auditLog.create({
        data: {
          id:       require('uuid').v4(),
          userId:   req.user.id,
          schoolId: null,
          action:   'UPDATE',
          entity:   'user_status',
          entityId: req.params.id,
          oldValues: { status: target.status },
          newValues: { status, reason: reason || null },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        }
      })
    ]);

    const { invalidateUserCache } = require('../middleware/auth.middleware');
    await invalidateUserCache(req.params.id);

    return successResponse(res, user, 'User status updated');
  } catch (error) { next(error); }
});

// GET /api/v1/admin/stats/schools — paginated school list
router.get('/schools', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit) || 20, 100);
    const take = Math.min(Number(limit) || 20, 100);

    const where = {
      deletedAt: null,
      ...(isActive !== undefined && { isActive: isActive === 'true' }),
      ...(search ? {
        OR: [
          { name:    { contains: String(search) } },
          { slug:    { contains: String(search) } },
          { city:    { contains: String(search) } },
          { country: { contains: String(search) } },
        ]
      } : {})
    };

    const [schools, total] = await Promise.all([
      prisma.school.findMany({
        where,
        select: {
          id: true, name: true, slug: true, type: true,
          city: true, country: true, isActive: true,
          logoUrl: true, createdAt: true,
          _count: {
            select: {
              memberships: { where: { status: 'ACTIVE' } },
              classes:     { where: { deletedAt: null } },
            }
          }
        },
        skip, take,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.school.count({ where })
    ]);

    return successResponse(res, {
      schools,
      pagination: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) { next(error); }
});

// PATCH /api/v1/admin/stats/schools/:id/status — activate / deactivate school
router.patch('/schools/:id/status', async (req, res, next) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
    }

    const school = await prisma.school.update({
      where: { id: req.params.id },
      data:  { isActive },
      select: { id: true, name: true, isActive: true }
    });

    await prisma.auditLog.create({
      data: {
        id:       require('uuid').v4(),
        userId:   req.user.id,
        schoolId: req.params.id,
        action:   'UPDATE',
        entity:   'school_status',
        entityId: req.params.id,
        oldValues: {},
        newValues: { isActive },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      }
    });

    return successResponse(res, school, `School ${isActive ? 'activated' : 'deactivated'}`);
  } catch (error) { next(error); }
});

// GET /api/v1/admin/stats/audit — platform-wide audit logs (no school filter)
router.get('/audit', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, entity, action, userId, startDate, endDate } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Math.min(Number(limit) || 50, 100);
    const take = Math.min(Number(limit) || 50, 100);

    const where = {
      ...(entity    && { entity:  String(entity) }),
      ...(action    && { action:  String(action) }),
      ...(userId    && { userId:  String(userId) }),
      ...(startDate && endDate && {
        createdAt: { gte: new Date(startDate), lte: new Date(endDate) }
      }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip, take,
      }),
      prisma.auditLog.count({ where })
    ]);

    return successResponse(res, {
      logs,
      pagination: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) { next(error); }
});

// GET /api/v1/admin/stats/announcements — platform-wide announcements
router.get('/announcements', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * 20;
    const take = Math.min(Number(limit) || 20, 100);

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where: { deletedAt: null },
        include: {
          school: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip, take,
      }),
      prisma.announcement.count({ where: { deletedAt: null } })
    ]);

    return successResponse(res, {
      announcements,
      pagination: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) { next(error); }
});

// POST /api/v1/admin/stats/announcements — create platform announcement (SA only)
// UIGAP-012 FIX: Platform admin can now create announcements without school membership.
//
// schoolId behaviour:
//   - Provided:  creates one announcement for that specific school
//   - Omitted:   fans out to ALL active schools (platform-wide broadcast)
//
// Note: The Announcement model requires schoolId (non-nullable FK), so a true
// "schoolless" announcement is not possible without a migration. Fan-out to all
// active schools achieves the same UX effect without a schema change.
router.post('/announcements', async (req, res, next) => {
  try {
    const { title, content, schoolId, targetRoles, isPinned, publishAt, expiresAt } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ success: false, message: 'content is required' });
    }

    const { v4: uuidv4 } = require('uuid');
    const { notifySchool } = require('../services/notification.service');
    const authorId  = req.user.id;
    const pubAt     = publishAt ? new Date(publishAt) : new Date();
    const expAt     = expiresAt  ? new Date(expiresAt) : null;
    const roles     = Array.isArray(targetRoles) && targetRoles.length > 0
      ? targetRoles
      : ['TEACHER', 'STUDENT', 'GUARDIAN'];
    const pinned    = Boolean(isPinned);

    if (schoolId) {
      // Single-school announcement
      const school = await prisma.school.findUnique({ where: { id: String(schoolId), deletedAt: null }, select: { id: true, name: true } });
      if (!school) return res.status(404).json({ success: false, message: 'School not found' });

      const ann = await prisma.announcement.create({
        data: {
          id: uuidv4(), schoolId: school.id, authorId,
          title: String(title).trim(), content: String(content).trim(),
          targetRoles: roles, isPinned: pinned,
          publishAt: pubAt, expiresAt: expAt,
        }
      });

      await notifySchool(school.id, roles, {
        type: 'ANNOUNCEMENT',
        title: `📢 ${String(title).trim()}`,
        body:  String(content).trim().substring(0, 120),
        data:  { announcementId: ann.id, source: 'platform_admin' }
      }).catch(() => {});

      // Audit log
      await prisma.auditLog.create({
        data: {
          id: uuidv4(), userId: authorId, schoolId: school.id,
          action: 'CREATE', entity: 'announcement', entityId: ann.id,
          newValues: { title: ann.title, targetRoles: roles, schoolId: school.id },
          ipAddress: req.ip || null,
        }
      }).catch(() => {});

      return successResponse(res, { announcements: [ann], count: 1 }, 'Announcement created', 201);
    }

    // Platform-wide fan-out: create one announcement per active school
    const schools = await prisma.school.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true }
    });
    if (schools.length === 0) {
      return res.status(400).json({ success: false, message: 'No active schools found for platform-wide announcement' });
    }

    const created = await prisma.$transaction(
      schools.map(sch => prisma.announcement.create({
        data: {
          id: uuidv4(), schoolId: sch.id, authorId,
          title: String(title).trim(), content: String(content).trim(),
          targetRoles: roles, isPinned: pinned,
          publishAt: pubAt, expiresAt: expAt,
        }
      }))
    );

    // Notify all schools in background — non-fatal
    Promise.allSettled(
      schools.map((sch, i) =>
        notifySchool(sch.id, roles, {
          type: 'ANNOUNCEMENT',
          title: `📢 ${String(title).trim()}`,
          body:  String(content).trim().substring(0, 120),
          data:  { announcementId: created[i].id, source: 'platform_admin' }
        })
      )
    ).catch(() => {});

    // Single audit log for the platform broadcast
    await prisma.auditLog.create({
      data: {
        id: uuidv4(), userId: authorId, schoolId: null,
        action: 'CREATE', entity: 'platform_announcement', entityId: created[0].id,
        newValues: { title: String(title).trim(), targetRoles: roles, schoolCount: schools.length },
        ipAddress: req.ip || null,
      }
    }).catch(() => {});

    return successResponse(res,
      { announcements: created, count: created.length },
      `Platform announcement sent to ${created.length} school${created.length !== 1 ? 's' : ''}`,
      201
    );
  } catch (error) { next(error); }
});

// PATCH /api/v1/admin/stats/announcements/:id — update a specific announcement (SA only)
// UIGAP-012: SA can edit any announcement regardless of school membership.
router.patch('/announcements/:id', async (req, res, next) => {
  try {
    const existing = await prisma.announcement.findUnique({
      where: { id: req.params.id, deletedAt: null }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

    const { title, content, isPinned, expiresAt, targetRoles } = req.body;
    const data = {};
    if (title       !== undefined) data.title       = String(title).trim();
    if (content     !== undefined) data.content     = String(content).trim();
    if (isPinned    !== undefined) data.isPinned    = Boolean(isPinned);
    if (expiresAt   !== undefined) data.expiresAt   = expiresAt ? new Date(expiresAt) : null;
    if (targetRoles !== undefined) data.targetRoles = Array.isArray(targetRoles) ? targetRoles : [];

    const announcement = await prisma.announcement.update({ where: { id: req.params.id }, data });
    return successResponse(res, announcement, 'Announcement updated');
  } catch (error) { next(error); }
});

// DELETE /api/v1/admin/stats/announcements/:id — soft-delete (SA only)
router.delete('/announcements/:id', async (req, res, next) => {
  try {
    const existing = await prisma.announcement.findUnique({
      where: { id: req.params.id, deletedAt: null }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });
    await prisma.announcement.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Announcement deleted');
  } catch (error) { next(error); }
});

module.exports = router;

// ─── GET /api/v1/admin/stats/live-voice ──────────────────────────────────────
// Platform-level live class + voice room operational view
router.get('/live-voice', async (req, res, next) => {
  try {
    const [
      activeLive, totalLive,
      activeVoice, totalVoice,
      liveParticipants, voiceParticipants,
    ] = await Promise.all([
      prisma.liveClass.count({ where: { status: 'LIVE' } }),
      prisma.liveClass.count(),
      prisma.voiceRoom.count({ where: { status: 'LIVE', deletedAt: null } }),
      prisma.voiceRoom.count({ where: { deletedAt: null } }),
      prisma.liveClassParticipant.count({ where: { isActive: true } }),
      prisma.voiceParticipant.count({ where: { isActive: true } }),
    ]);

    // Recent active live classes
    const liveSessions = await prisma.liveClass.findMany({
      where: { status: 'LIVE' },
      select: {
        id: true, title: true, status: true, createdAt: true,
        _count: { select: { participants: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Recent active voice rooms
    const voiceRooms = await prisma.voiceRoom.findMany({
      where: { status: 'LIVE', deletedAt: null },
      select: {
        id: true, title: true, status: true, privacy: true, createdAt: true,
        host: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { participants: { where: { isActive: true } } } },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: 20,
    });

    return successResponse(res, {
      live: { active: activeLive, total: totalLive, participants: liveParticipants, sessions: liveSessions },
      voice: { active: activeVoice, total: totalVoice, participants: voiceParticipants, rooms: voiceRooms },
    });
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/gifts ───────────────────────────────────────────
// Platform-level gift economy overview
router.get('/gifts', async (req, res, next) => {
  try {
    const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const day7  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);

    const [
      totalGifts,
      giftsLast7d,
      giftsLast30d,
      totalGiftItems,
    ] = await Promise.all([
      prisma.giftTransaction.count().catch(() => 0),
      prisma.giftTransaction.count({ where: { createdAt: { gte: day7 } } }).catch(() => 0),
      prisma.giftTransaction.count({ where: { createdAt: { gte: day30 } } }).catch(() => 0),
      prisma.gift.count().catch(() => 0),
    ]);

    // Recent gift transactions
    const recentTransactions = await prisma.giftTransaction.findMany({
      include: {
        sender:   { select: { id: true, firstName: true, lastName: true } },
        receiver: { select: { id: true, firstName: true, lastName: true } },
        gift:     { select: { id: true, name: true, priceCoins: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).catch(() => []);

    // Gift catalog
    const catalog = await prisma.gift.findMany({
      orderBy: { priceCoins: 'asc' },
    }).catch(() => []);

    return successResponse(res, {
      stats: {
        total:     totalGifts,
        last7d:    giftsLast7d,
        last30d:   giftsLast30d,
        catalogSize: totalGiftItems,
      },
      recentTransactions,
      catalog,
    });
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/payments ────────────────────────────────────────
// Platform-level wallet / payment overview
router.get('/payments', async (req, res, next) => {
  try {
    const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalWallets,
      totalTransactions,
      transactionsLast30d,
    ] = await Promise.all([
      prisma.wallet.count().catch(() => 0),
      prisma.walletTransaction.count().catch(() => 0),
      prisma.walletTransaction.count({ where: { createdAt: { gte: day30 } } }).catch(() => 0),
    ]);

    // Recent transactions
    const recentTransactions = await prisma.walletTransaction.findMany({
      include: {
        wallet: {
          select: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).catch(() => []);

    return successResponse(res, {
      stats: {
        totalWallets,
        totalTransactions,
        transactionsLast30d,
      },
      recentTransactions,
    });
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/analytics ───────────────────────────────────────
// Platform-wide analytics aggregation
router.get('/analytics', async (req, res, next) => {
  try {
    const now   = new Date();
    const day1  = new Date(now.getTime() - 1  * 24 * 60 * 60 * 1000);
    const day7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      dauApprox, wauApprox, mauApprox,
      newToday, newWeek, newMonth,
      totalPosts, postsWeek,
      totalCommunities,
      totalSchools, activeSchools,
      totalStudents, totalTeachers,
      totalLiveClasses, totalVoiceRooms,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: day1 } } }),
      prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: day7 } } }),
      prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: day30 } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: day1 } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: day7 } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: day30 } } }),
      prisma.post.count({ where: { deletedAt: null } }).catch(() => 0),
      prisma.post.count({ where: { deletedAt: null, createdAt: { gte: day7 } } }).catch(() => 0),
      prisma.community.count().catch(() => 0),
      prisma.school.count({ where: { deletedAt: null } }),
      prisma.school.count({ where: { deletedAt: null, isActive: true } }),
      prisma.schoolMembership.count({ where: { status: 'ACTIVE', role: 'STUDENT' } }),
      prisma.schoolMembership.count({ where: { status: 'ACTIVE', role: 'TEACHER' } }),
      prisma.liveClass.count(),
      prisma.voiceRoom.count({ where: { deletedAt: null } }),
    ]);

    return successResponse(res, {
      users: { dau: dauApprox, wau: wauApprox, mau: mauApprox, newToday, newWeek, newMonth },
      social: { totalPosts, postsWeek, totalCommunities },
      education: { totalSchools, activeSchools, totalStudents, totalTeachers },
      live: { totalLiveClasses, totalVoiceRooms },
    });
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/security ────────────────────────────────────────
// Security event summary — uses audit logs as the source of truth
router.get('/security', async (req, res, next) => {
  try {
    const day7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      suspensions7d,
      bans7d,
      roleChanges7d,
      totalSuspended,
      totalBanned,
    ] = await Promise.all([
      prisma.auditLog.count({ where: { entity: 'user_status', createdAt: { gte: day7 }, newValues: { path: ['status'], equals: 'SUSPENDED' } } }).catch(() => 0),
      prisma.auditLog.count({ where: { entity: 'user_status', createdAt: { gte: day7 }, newValues: { path: ['status'], equals: 'BANNED' } } }).catch(() => 0),
      prisma.auditLog.count({ where: { entity: 'user_platform_role', createdAt: { gte: day7 } } }),
      // Raw SQL to bypass stale Prisma client binary (BANNED added to enum after last generate)
      prisma.$queryRaw`SELECT COUNT(*) as cnt FROM users WHERE status = 'SUSPENDED' AND deletedAt IS NULL`.then(r => Number(r[0]?.cnt ?? 0)).catch(() => 0),
      prisma.$queryRaw`SELECT COUNT(*) as cnt FROM users WHERE status = 'BANNED' AND deletedAt IS NULL`.then(r => Number(r[0]?.cnt ?? 0)).catch(() => 0),
    ]);

    // Recent security audit events
    const recentEvents = await prisma.auditLog.findMany({
      where: {
        entity: { in: ['user_status', 'user_platform_role', 'user_moderation', 'school_status'] },
        createdAt: { gte: day7 },
      },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return successResponse(res, {
      stats: { suspensions7d, bans7d, roleChanges7d, totalSuspended, totalBanned },
      recentEvents,
    });
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/export/users ─────────────────────────────────────
// UIGAP-011 FIX: Export user list as CSV.
// SA can download all platform users as CSV for offline analysis / compliance.
// Columns: id, email, firstName, lastName, role, status, schoolId, createdAt, lastLoginAt
//
// Query params:
//   status (optional): filter by user status
//   role   (optional): filter by user role
//   limit  (optional): max rows, default 10000, max 50000
router.get('/export/users', async (req, res, next) => {
  try {
    const { status, role, limit = 10000 } = req.query;
    const take = Math.min(parseInt(limit) || 10000, 50000);

    const where = {
      deletedAt: null,
      ...(status && { status: String(status) }),
      ...(role   && { role:   String(role) }),
    };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, status: true, schoolId: true,
        createdAt: true, lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    // Build CSV without external library — avoids xlsx dependency for simple flat data
    const header = 'id,email,firstName,lastName,role,status,schoolId,createdAt,lastLoginAt';
    const escape = v => v == null ? '' : String(v).replace(/"/g, '""').includes(',') ? `"${v}"` : String(v).replace(/"/g, '""');
    const rows = users.map(u =>
      [u.id, u.email, u.firstName, u.lastName, u.role, u.status, u.schoolId ?? '',
       u.createdAt ? new Date(u.createdAt).toISOString() : '',
       u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : ''
      ].map(escape).join(',')
    );
    const csv = [header, ...rows].join('\r\n');

    const filename = `halqa-users-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Row-Count',         String(users.length));
    return res.send(csv);
  } catch (error) { next(error); }
});

// ─── GET /api/v1/admin/stats/export/transactions ──────────────────────────────
// UIGAP-011 FIX: Export wallet transaction list as CSV.
// Columns: id, userId, userEmail, type, coins, description, stripeSessionId, createdAt
//
// Query params:
//   type   (optional): filter by transaction type
//   userId (optional): filter by specific user
//   limit  (optional): max rows, default 5000, max 20000
router.get('/export/transactions', async (req, res, next) => {
  try {
    const { type, userId, limit = 5000 } = req.query;
    const take = Math.min(parseInt(limit) || 5000, 20000);

    const where = {
      ...(type   && { type:   String(type) }),
      ...(userId && { userId: String(userId) }),
    };

    const txs = await prisma.walletTransaction.findMany({
      where,
      select: {
        id: true, userId: true, type: true, coins: true,
        description: true, stripeSessionId: true, createdAt: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const header = 'id,userId,userEmail,firstName,lastName,type,coins,description,stripeSessionId,createdAt';
    const escape = v => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
    };
    const rows = txs.map(t =>
      [t.id, t.userId, t.user?.email ?? '', t.user?.firstName ?? '', t.user?.lastName ?? '',
       t.type, t.coins, t.description ?? '', t.stripeSessionId ?? '',
       t.createdAt ? new Date(t.createdAt).toISOString() : ''
      ].map(escape).join(',')
    );
    const csv = [header, ...rows].join('\r\n');

    const filename = `halqa-transactions-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Row-Count',         String(txs.length));
    return res.send(csv);
  } catch (error) { next(error); }
});
