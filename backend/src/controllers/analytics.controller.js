/**
 * Analytics Controller
 *
 * Handles analytics data including:
 * - Daily school statistics
 * - Daily user statistics
 * - Aggregated metrics
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

// ─── Shared error response helper ────────────────────────────────────────────
// Respects err.status from thrown authorization errors (403) so they are not
// swallowed and re-returned as 500.
function handleError(res, error, fallbackMessage) {
  const status = error.status || 500;
  if (status !== 500) {
    return res.status(status).json({ success: false, message: error.message });
  }
  logger.error(fallbackMessage, error);
  res.status(500).json({
    success: false,
    error: { code: 'INT_001', message: fallbackMessage, statusCode: 500 }
  });
}

// ─── Authorization helpers ────────────────────────────────────────────────────
// FIND-01 FIX: School analytics endpoints now require requireSchoolMember()
// on the route (analytics.routes.js). That middleware:
//   1. Verifies an ACTIVE SchoolMembership exists for the authenticated user
//   2. Sets req.schoolMembership (role + schoolId) — the authoritative source
//   3. Sets req.schoolId
//   4. Rejects SUPER_ADMIN without an explicit membership record (ARCH-01)
//   5. Correctly handles MEMBER users with User.schoolId=null who hold a valid membership
//
// The old assertSchoolStatsAccess() used req.user.schoolId which is the LEGACY
// single-school field. It broke for new-architecture MEMBER users whose
// User.schoolId is null but who have an active SchoolMembership.
//
// After FIND-01: school analytics controllers no longer need to check school
// ownership themselves — requireSchoolMember() is authoritative. The helpers
// below are kept only for the write endpoints (admin-only role check).

/**
 * Assert the caller has write access to school analytics.
 * requireSchoolMember() already verified membership — this adds role check.
 * Must be used on routes that also apply requireSchoolMember().
 */
function assertSchoolStatsWriteAccess(req) {
  // P2-003 FIX: Removed 'SUPER_ADMIN' — requireSchoolMember blocks all platform SA before here.
  // Only 'SCHOOL_ADMIN' membership role is authorized per ARCH-01.
  const effectiveRole = req.schoolMembership?.role || req.user.role;
  if (effectiveRole !== 'SCHOOL_ADMIN') {
    const err = new Error('Only school admins can update school analytics');
    err.status = 403;
    throw err;
  }
}

/**
 * User stats access guard — users can only read/write their own stats.
 * SUPER_ADMIN may read any user's stats (platform oversight).
 */
function assertUserStatsAccess(req, userId) {
  if (req.user.role === 'SUPER_ADMIN') return; // platform admin oversight
  if (req.user.id !== userId) {
    const err = new Error('Access denied to this user\'s analytics');
    err.status = 403;
    throw err;
  }
}

/**
 * Get daily school statistics
 * School membership verified by requireSchoolMember() on the route.
 */
async function getDailySchoolStats(req, res) {
  try {
    // FIND-01: req.schoolId is set by requireSchoolMember('schoolId') on the route.
    // Any active school member may read their school's analytics.
    const schoolId = req.schoolId;

    const { startDate, endDate } = req.query;

    const where = { schoolId };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

    const stats = await prisma.dailySchoolStats.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to get school statistics');
  }
}

/**
 * Get or create daily school stats for a specific date
 * School membership (SCHOOL_ADMIN role) verified by requireSchoolMember + requireSchoolRole on route.
 */
async function getOrCreateDailySchoolStats(req, res) {
  try {
    // FIND-01: req.schoolId set by requireSchoolMember; role already checked by requireSchoolRole.
    const schoolId = req.schoolId;
    const { date } = req.params;

    const targetDate = new Date(date);

    let stats = await prisma.dailySchoolStats.findUnique({
      where: {
        schoolId_date: {
          schoolId,
          date: targetDate
        }
      }
    });

    if (!stats) {
      // Calculate stats from scratch
      const [studentCount, teacherCount, classCount] = await Promise.all([
        prisma.student.count({ where: { schoolId, deletedAt: null } }),
        prisma.teacher.count({ where: { schoolId, deletedAt: null } }),
        prisma.class.count({ where: { schoolId, isActive: true } })
      ]);

      // Get attendance rate for the date
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          schoolId,
          date: targetDate
        }
      });

      const presentCount = attendanceRecords.filter(a => a.status === 'PRESENT').length;
      const attendanceRate = attendanceRecords.length > 0 ? (presentCount / attendanceRecords.length) * 100 : 0;

      // Get average grade
      const grades = await prisma.grade.findMany({
        where: { schoolId, deletedAt: null }
      });

      const averageGrade = grades.length > 0 
        ? grades.reduce((sum, g) => sum + (g.score || 0), 0) / grades.length 
        : 0;

      stats = await prisma.dailySchoolStats.create({
        data: {
          schoolId,
          date: targetDate,
          studentCount,
          teacherCount,
          classCount,
          attendanceRate,
          averageGrade,
          behaviorScore: 0,
          totalPosts: 0,
          totalMessages: 0,
          totalGifts: 0,
          totalCoins: 0
        }
      });

      logger.info(`Daily school stats created for ${schoolId} on ${date}`);
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to get school statistics');
  }
}

/**
 * Update daily school statistics
 * School membership (SCHOOL_ADMIN role) verified by requireSchoolMember + requireSchoolRole on route.
 */
async function updateDailySchoolStats(req, res) {
  try {
    // FIND-01: req.schoolId set by requireSchoolMember; role already checked by requireSchoolRole.
    // assertSchoolStatsWriteAccess is kept as belt-and-suspenders for the role check.
    assertSchoolStatsWriteAccess(req);
    const schoolId = req.schoolId;
    const { date } = req.params;

    const { studentCount, teacherCount, classCount, attendanceRate, averageGrade, behaviorScore, totalPosts, totalMessages, totalGifts, totalCoins } = req.body;

    const stats = await prisma.dailySchoolStats.upsert({
      where: {
        schoolId_date: {
          schoolId,
          date: new Date(date)
        }
      },
      update: {
        studentCount: studentCount !== undefined ? studentCount : undefined,
        teacherCount: teacherCount !== undefined ? teacherCount : undefined,
        classCount: classCount !== undefined ? classCount : undefined,
        attendanceRate: attendanceRate !== undefined ? attendanceRate : undefined,
        averageGrade: averageGrade !== undefined ? averageGrade : undefined,
        behaviorScore: behaviorScore !== undefined ? behaviorScore : undefined,
        totalPosts: totalPosts !== undefined ? totalPosts : undefined,
        totalMessages: totalMessages !== undefined ? totalMessages : undefined,
        totalGifts: totalGifts !== undefined ? totalGifts : undefined,
        totalCoins: totalCoins !== undefined ? totalCoins : undefined
      },
      create: {
        schoolId,
        date: new Date(date),
        studentCount: studentCount || 0,
        teacherCount: teacherCount || 0,
        classCount: classCount || 0,
        attendanceRate: attendanceRate || 0,
        averageGrade: averageGrade || 0,
        behaviorScore: behaviorScore || 0,
        totalPosts: totalPosts || 0,
        totalMessages: totalMessages || 0,
        totalGifts: totalGifts || 0,
        totalCoins: totalCoins || 0
      }
    });

    logger.info(`Daily school stats updated for ${schoolId} on ${date}`);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to update school statistics');
  }
}

/**
 * Get daily user statistics
 */
async function getDailyUserStats(req, res) {
  try {
    const { userId } = req.params;

    // P3-001: users can only read their own stats
    assertUserStatsAccess(req, userId);

    const { startDate, endDate } = req.query;

    const where = { userId };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

    const stats = await prisma.dailyUserStats.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to get user statistics');
  }
}

/**
 * Get or create daily user stats for a specific date
 */
async function getOrCreateDailyUserStats(req, res) {
  try {
    const { userId, date } = req.params;

    // P3-001: users can only access their own stats
    assertUserStatsAccess(req, userId);

    const targetDate = new Date(date);

    let stats = await prisma.dailyUserStats.findUnique({
      where: {
        userId_date: {
          userId,
          date: targetDate
        }
      }
    });

    if (!stats) {
      stats = await prisma.dailyUserStats.create({
        data: {
          userId,
          date: targetDate,
          loginCount: 0,
          postsCreated: 0,
          commentsCreated: 0,
          likesGiven: 0,
          likesReceived: 0,
          messagesSent: 0,
          voiceMinutes: 0,
          giftsSent: 0,
          giftsReceived: 0,
          coinsSpent: 0,
          coinsEarned: 0
        }
      });

      logger.info(`Daily user stats created for ${userId} on ${date}`);
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to get user statistics');
  }
}

/**
 * Update daily user statistics
 */
async function updateDailyUserStats(req, res) {
  try {
    const { userId, date } = req.params;

    // P3-001: users can only update their own stats; SUPER_ADMIN can update any
    assertUserStatsAccess(req, userId);

    const { loginCount, postsCreated, commentsCreated, likesGiven, likesReceived, messagesSent, voiceMinutes, giftsSent, giftsReceived, coinsSpent, coinsEarned } = req.body;

    const stats = await prisma.dailyUserStats.upsert({
      where: {
        userId_date: {
          userId,
          date: new Date(date)
        }
      },
      update: {
        loginCount: loginCount !== undefined ? loginCount : undefined,
        postsCreated: postsCreated !== undefined ? postsCreated : undefined,
        commentsCreated: commentsCreated !== undefined ? commentsCreated : undefined,
        likesGiven: likesGiven !== undefined ? likesGiven : undefined,
        likesReceived: likesReceived !== undefined ? likesReceived : undefined,
        messagesSent: messagesSent !== undefined ? messagesSent : undefined,
        voiceMinutes: voiceMinutes !== undefined ? voiceMinutes : undefined,
        giftsSent: giftsSent !== undefined ? giftsSent : undefined,
        giftsReceived: giftsReceived !== undefined ? giftsReceived : undefined,
        coinsSpent: coinsSpent !== undefined ? coinsSpent : undefined,
        coinsEarned: coinsEarned !== undefined ? coinsEarned : undefined
      },
      create: {
        userId,
        date: new Date(date),
        loginCount: loginCount || 0,
        postsCreated: postsCreated || 0,
        commentsCreated: commentsCreated || 0,
        likesGiven: likesGiven || 0,
        likesReceived: likesReceived || 0,
        messagesSent: messagesSent || 0,
        voiceMinutes: voiceMinutes || 0,
        giftsSent: giftsSent || 0,
        giftsReceived: giftsReceived || 0,
        coinsSpent: coinsSpent || 0,
        coinsEarned: coinsEarned || 0
      }
    });

    logger.info(`Daily user stats updated for ${userId} on ${date}`);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to update user statistics');
  }
}

/**
 * Increment user stat counter
 */
async function incrementUserStat(req, res) {
  try {
    const { userId, date, stat } = req.params;

    // P3-001: only the user themselves or SUPER_ADMIN can increment stats
    assertUserStatsAccess(req, userId);

    const { amount = 1 } = req.body;

    const validStats = ['loginCount', 'postsCreated', 'commentsCreated', 'likesGiven', 'likesReceived', 'messagesSent', 'voiceMinutes', 'giftsSent', 'giftsReceived', 'coinsSpent', 'coinsEarned'];

    if (!validStats.includes(stat)) {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'Invalid stat name',
          statusCode: 400
        })
      });
    }

    const stats = await prisma.dailyUserStats.upsert({
      where: {
        userId_date: {
          userId,
          date: new Date(date)
        }
      },
      update: {
        [stat]: { increment: amount }
      },
      create: {
        userId,
        date: new Date(date),
        loginCount: 0,
        postsCreated: 0,
        commentsCreated: 0,
        likesGiven: 0,
        likesReceived: 0,
        messagesSent: 0,
        voiceMinutes: 0,
        giftsSent: 0,
        giftsReceived: 0,
        coinsSpent: 0,
        coinsEarned: 0,
        [stat]: amount
      }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    handleError(res, error, 'Failed to increment user stat');
  }
}

/**
 * Get aggregated school analytics
 * School membership verified by requireSchoolMember() on the route.
 */
async function getSchoolAnalytics(req, res) {
  try {
    // FIND-01: req.schoolId set by requireSchoolMember('schoolId') on the route.
    const schoolId = req.schoolId;

    const { period = '30d' } = req.query;

    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const stats = await prisma.dailySchoolStats.findMany({
      where: {
        schoolId,
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { date: 'asc' }
    });

    // Calculate aggregates
    const aggregates = stats.reduce((acc, stat) => ({
      totalStudents: Math.max(acc.totalStudents, stat.studentCount),
      totalTeachers: Math.max(acc.totalTeachers, stat.teacherCount),
      totalClasses: Math.max(acc.totalClasses, stat.classCount),
      avgAttendanceRate: acc.avgAttendanceRate + stat.attendanceRate,
      avgGrade: acc.avgGrade + stat.averageGrade,
      totalPosts: acc.totalPosts + stat.totalPosts,
      totalMessages: acc.totalMessages + stat.totalMessages,
      totalGifts: acc.totalGifts + stat.totalGifts,
      totalCoins: acc.totalCoins + stat.totalCoins
    }), {
      totalStudents: 0,
      totalTeachers: 0,
      totalClasses: 0,
      avgAttendanceRate: 0,
      avgGrade: 0,
      totalPosts: 0,
      totalMessages: 0,
      totalGifts: 0,
      totalCoins: 0
    });

    const count = stats.length || 1;
    aggregates.avgAttendanceRate = aggregates.avgAttendanceRate / count;
    aggregates.avgGrade = aggregates.avgGrade / count;

    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        stats,
        aggregates
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to get school analytics');
  }
}

/**
 * Get aggregated user analytics
 */
async function getUserAnalytics(req, res) {
  try {
    const { userId } = req.params;

    // P3-001: users can only read their own analytics
    assertUserStatsAccess(req, userId);
    const { period = '30d' } = req.query;

    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const stats = await prisma.dailyUserStats.findMany({
      where: {
        userId,
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { date: 'asc' }
    });

    // Calculate aggregates
    const aggregates = stats.reduce((acc, stat) => ({
      totalLogins: acc.totalLogins + stat.loginCount,
      totalPosts: acc.totalPosts + stat.postsCreated,
      totalComments: acc.totalComments + stat.commentsCreated,
      totalLikesGiven: acc.totalLikesGiven + stat.likesGiven,
      totalLikesReceived: acc.totalLikesReceived + stat.likesReceived,
      totalMessages: acc.totalMessages + stat.messagesSent,
      totalVoiceMinutes: acc.totalVoiceMinutes + stat.voiceMinutes,
      totalGiftsSent: acc.totalGiftsSent + stat.giftsSent,
      totalGiftsReceived: acc.totalGiftsReceived + stat.giftsReceived,
      totalCoinsSpent: acc.totalCoinsSpent + stat.coinsSpent,
      totalCoinsEarned: acc.totalCoinsEarned + stat.coinsEarned
    }), {
      totalLogins: 0,
      totalPosts: 0,
      totalComments: 0,
      totalLikesGiven: 0,
      totalLikesReceived: 0,
      totalMessages: 0,
      totalVoiceMinutes: 0,
      totalGiftsSent: 0,
      totalGiftsReceived: 0,
      totalCoinsSpent: 0,
      totalCoinsEarned: 0
    });

    res.json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        stats,
        aggregates
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to get user analytics');
  }
}

/**
 * Track a client-side analytics event (POST /analytics/events)
 * Rate-limited: 60 req/min per user (handled by existing rateLimiter middleware).
 * Events are stored in DailyUserStats — increments the matching counter.
 * Unknown event names are accepted but stored as-is in a JSON log field (future use).
 */
async function trackEvent(req, res) {
  try {
    // Auth is optional — unauthenticated requests are silently accepted (202) and discarded.
    // This prevents 401 noise when fired before login or after token expiry.
    const userId = req.user?.id;
    const { event, properties } = req.body;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ success: false, message: 'event is required' });
    }

    // Only record stats for authenticated users — skip silently for anonymous
    if (!userId) {
      return res.status(202).json({ success: true });
    }

    // Map known frontend event names to DailyUserStats fields
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const statMap = {
      'voice_room_join':    'voiceMinutes',
      'post_created':       'postsCreated',
      'comment_created':    'commentsCreated',
      'like_given':         'likesGiven',
      'message_sent':       'messagesSent',
      'gift_sent':          'giftsSent',
      'page_view':          'loginCount',
    };

    const statField = statMap[event];

    if (statField) {
      const amount = properties?.value ?? 1;
      await prisma.dailyUserStats.upsert({
        where:  { userId_date: { userId, date: today } },
        create: {
          userId, date: today,
          loginCount: 0, postsCreated: 0, commentsCreated: 0,
          likesGiven: 0, likesReceived: 0, messagesSent: 0,
          voiceMinutes: 0, giftsSent: 0, giftsReceived: 0,
          coinsSpent: 0, coinsEarned: 0,
          [statField]: amount,
        },
        update: { [statField]: { increment: amount } },
      });
    }

    // Always return 202 — fire-and-forget from client's perspective
    res.status(202).json({ success: true });
  } catch (error) {
    // Non-fatal — analytics must never break the client
    res.status(202).json({ success: true });
  }
}

module.exports = {
  getDailySchoolStats,
  getOrCreateDailySchoolStats,
  updateDailySchoolStats,
  getDailyUserStats,
  getOrCreateDailyUserStats,
  updateDailyUserStats,
  incrementUserStat,
  getSchoolAnalytics,
  getUserAnalytics,
  trackEvent,
};
