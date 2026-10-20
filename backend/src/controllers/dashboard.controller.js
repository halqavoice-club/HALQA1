const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const { isRedisReady, getCache, setCache, deleteCache } = require('../utils/redis');

// ─── PERF-001: Dashboard cache helpers ───────────────────────────────────────
// Dashboard aggregations change slowly (once per attendance mark, grade entry etc.)
// Cache them for 5 minutes per user — eliminates 9 concurrent DB queries on every
// page load from every authenticated user.
//
// TTL: 5 minutes (matches realistic update frequency for school data)
// Invalidation: automatic on TTL expiry; no explicit invalidation needed
//   because stale data here is 5-min-old counts, not real-time critical data.
const DASHBOARD_CACHE_TTL = 5 * 60; // 300 seconds

function dashCacheKey(role, userId, schoolId) {
  return `dashboard:${role}:${userId}:${schoolId || 'none'}`;
}

async function getDashCache(key) {
  try {
    if (!isRedisReady()) return null;
    return await getCache(key);
  } catch { return null; }
}

async function setDashCache(key, data) {
  try {
    if (!isRedisReady()) return;
    await setCache(key, data, DASHBOARD_CACHE_TTL);
  } catch { /* non-fatal — dashboard loads fresh from DB */ }
}

async function getAdminDashboard(req, res, next) {
  try {
    const schoolId = (req.schoolId || req.user.schoolId);

    // PERF-001: Return cached result if available (5-min TTL)
    const cacheKey = dashCacheKey('admin', req.user.id, schoolId);
    const cached = await getDashCache(cacheKey);
    if (cached) return successResponse(res, cached, 'Admin dashboard fetched');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // SUPER_ADMIN has no schoolId — build a safe filter
    // IMPORTANT: only include schoolId in where clause if it has a value.
    // Passing schoolId: undefined to Prisma causes "Argument must not be null" errors
    // because Prisma serialises undefined as null for non-nullable fields.
    const schoolFilter = schoolId ? { schoolId } : {};
    const schoolAttendanceFilter = schoolId ? { schoolId } : {};

    const [
      totalStudents, totalTeachers, totalClasses, totalGuardians,
      todayAttendance, recentBehavior, recentMessages, upcomingEvents,
      weeklyAttendance
    ] = await Promise.all([
      prisma.student.count({ where: { deletedAt: null, ...(schoolId && { schoolId }) } }),
      prisma.teacher.count({ where: { deletedAt: null, ...(schoolId && { schoolId }) } }),
      prisma.class.count({ where: { isActive: true, deletedAt: null, ...(schoolId && { schoolId }) } }),
      prisma.guardian.count({ where: { deletedAt: null, ...(schoolId && { schoolId }) } }),

      prisma.attendance.groupBy({
        by: ['status'],
        where: { ...schoolAttendanceFilter, date: today },
        _count: { status: true }
      }),

      prisma.behaviorLog.findMany({
        where: { student: schoolId ? { schoolId } : {}, deletedAt: null },
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        },
        orderBy: { date: 'desc' },
        take: 5
      }),

      prisma.message.count({
        where: {
          ...(schoolId ? { schoolId } : {}),
          recipients: { some: { recipientId: req.user.id, status: 'SENT' } }
        }
      }),

      prisma.calendarEvent.findMany({
        where: {
          ...(schoolId ? { schoolId } : {}),
          startDate: { gte: today },
          deletedAt: null
        },
        orderBy: { startDate: 'asc' },
        take: 5
      }),

      // Last 7 days attendance trend
      prisma.attendance.groupBy({
        by: ['date', 'status'],
        where: {
          ...schoolAttendanceFilter,
          date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        },
        _count: { status: true },
        orderBy: { date: 'asc' }
      })
    ]);

    // Build weekly trend
    const trendMap = {};
    weeklyAttendance.forEach(r => {
      const d = r.date.toISOString().split('T')[0];
      if (!trendMap[d]) trendMap[d] = { date: d, present: 0, absent: 0, late: 0 };
      if (r.status === 'PRESENT') trendMap[d].present = r._count.status;
      if (r.status === 'ABSENT') trendMap[d].absent = r._count.status;
      if (r.status === 'LATE') trendMap[d].late = r._count.status;
    });
    const attendanceTrend = Object.values(trendMap);

    const attendanceStats = {
      present: 0, absent: 0, late: 0, excused: 0
    };
    todayAttendance.forEach(a => {
      attendanceStats[a.status.toLowerCase()] = a._count.status;
    });
    const totalToday = Object.values(attendanceStats).reduce((a, b) => a + b, 0);
    attendanceStats.percentage = totalToday > 0
      ? Math.round((attendanceStats.present / totalToday) * 100)
      : 0;

    const dashboardData = {
      overview: { totalStudents, totalTeachers, totalClasses, totalGuardians },
      todayAttendance: attendanceStats,
      recentBehavior,
      unreadMessages: recentMessages,
      upcomingEvents,
      attendanceTrend
    };

    // PERF-001: Cache the result
    await setDashCache(cacheKey, dashboardData);

    return successResponse(res, dashboardData, 'Admin dashboard fetched');
  } catch (error) {
    next(error);
  }
}

async function getTeacherDashboard(req, res, next) {
  try {
    // PERF-001: Cache per teacher
    const cacheKey = dashCacheKey('teacher', req.user.id, (req.schoolId || req.user.schoolId));
    const cached = await getDashCache(cacheKey);
    if (cached) return successResponse(res, cached, 'Teacher dashboard fetched');

    const teacher = await prisma.teacher.findFirst({
      where: { userId: req.user.id },
      include: {
        teacherClasses: {
          include: {
            class: {
              include: {
                enrollments: { where: { isActive: true } }
              }
            }
          }
        }
      }
    });

    if (!teacher) return errorResponse(res, 'Teacher profile not found', 404);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const classIds = teacher.teacherClasses.map(tc => tc.classId);

    const [todayAttendance, pendingGrades, recentBehavior, upcomingEvents] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['status'],
        where: { classId: { in: classIds }, date: today },
        _count: { status: true }
      }),

      prisma.grade.count({
        where: {
          classId: { in: classIds },
          gradedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      }),

      prisma.behaviorLog.findMany({
        where: { teacherId: teacher.id, deletedAt: null },
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } }
        },
        orderBy: { date: 'desc' },
        take: 5
      }),

      prisma.calendarEvent.findMany({
        where: {
          classId: { in: classIds },
          startDate: { gte: today }
        },
        orderBy: { startDate: 'asc' },
        take: 5
      })
    ]);

    const classes = teacher.teacherClasses.map(tc => ({
      id: tc.class.id,
      name: tc.class.name,
      studentCount: tc.class.enrollments.length,
      isLead: tc.isLead
    }));

    const teacherData = {
      teacher: { id: teacher.id, department: teacher.department },
      classes,
      todayAttendance,
      recentGrades: pendingGrades,
      recentBehavior,
      upcomingEvents
    };
    await setDashCache(cacheKey, teacherData);
    return successResponse(res, teacherData, 'Teacher dashboard fetched');
  } catch (error) {
    next(error);
  }
}

async function getStudentDashboard(req, res, next) {
  try {
    // PERF-001: Cache per student
    const cacheKey = dashCacheKey('student', req.user.id, (req.schoolId || req.user.schoolId));
    const cached = await getDashCache(cacheKey);
    if (cached) return successResponse(res, cached, 'Student dashboard fetched');

    const student = await prisma.student.findFirst({
      where: { userId: req.user.id },
      include: {
        enrollments: {
          where: { isActive: true },
          include: { class: true }
        }
      }
    });

    if (!student) return errorResponse(res, 'Student profile not found', 404);

    const classIds = student.enrollments.map(e => e.classId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [attendanceStats, recentGrades, behaviorPoints, upcomingEvents, notifications] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['status'],
        where: {
          studentId: student.id,
          date: { gte: thirtyDaysAgo }
        },
        _count: { status: true }
      }),

      prisma.grade.findMany({
        where: { studentId: student.id, deletedAt: null },
        include: { class: { select: { name: true } } },
        orderBy: { gradedAt: 'desc' },
        take: 5
      }),

      prisma.behaviorLog.aggregate({
        where: { studentId: student.id, deletedAt: null },
        _sum: { points: true }
      }),

      prisma.calendarEvent.findMany({
        where: {
          classId: { in: classIds },
          startDate: { gte: new Date() }
        },
        orderBy: { startDate: 'asc' },
        take: 5
      }),

      prisma.notification.findMany({
        where: { userId: req.user.id, isRead: false },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    const attendance = { present: 0, absent: 0, late: 0, total: 0 };
    attendanceStats.forEach(a => {
      attendance[a.status.toLowerCase()] = a._count.status;
      attendance.total += a._count.status;
    });
    attendance.percentage = attendance.total > 0
      ? Math.round((attendance.present / attendance.total) * 100)
      : 0;

    const studentData = {
      student: { id: student.id, studentId: student.studentId, qrCode: student.qrCode },
      classes: student.enrollments.map(e => e.class),
      attendance,
      recentGrades,
      behaviorPoints: behaviorPoints._sum.points || 0,
      upcomingEvents,
      notifications
    };
    await setDashCache(cacheKey, studentData);
    return successResponse(res, studentData, 'Student dashboard fetched');
  } catch (error) {
    next(error);
  }
}

async function getGuardianDashboard(req, res, next) {
  try {
    // PERF-001: Cache per guardian
    const cacheKey = dashCacheKey('guardian', req.user.id, (req.schoolId || req.user.schoolId));
    const cached = await getDashCache(cacheKey);
    if (cached) return successResponse(res, cached, 'Guardian dashboard fetched');

    const guardian = await prisma.guardian.findFirst({
      where: { userId: req.user.id },
      include: {
        students: {
          include: {
            student: {
              include: {
                user: { select: { firstName: true, lastName: true, avatarUrl: true } },
                enrollments: {
                  where: { isActive: true },
                  include: { class: { select: { id: true, name: true } } }
                }
              }
            }
          }
        }
      }
    });

    if (!guardian) return errorResponse(res, 'Guardian profile not found', 404);

    const studentIds = guardian.students.map(gs => gs.studentId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [attendanceSummary, recentGrades, behaviorSummary, notifications] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['studentId', 'status'],
        where: {
          studentId: { in: studentIds },
          date: { gte: thirtyDaysAgo }
        },
        _count: { status: true }
      }),

      prisma.grade.findMany({
        where: { studentId: { in: studentIds }, deletedAt: null },
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } },
          class: { select: { name: true } }
        },
        orderBy: { gradedAt: 'desc' },
        take: 10
      }),

      prisma.behaviorLog.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, deletedAt: null },
        _sum: { points: true }
      }),

      prisma.notification.findMany({
        where: { userId: req.user.id, isRead: false },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    ]);

    const guardianData = {
      guardian: { id: guardian.id, relationship: guardian.relationship },
      students: guardian.students.map(gs => gs.student),
      attendanceSummary,
      recentGrades,
      behaviorSummary,
      notifications
    };
    await setDashCache(cacheKey, guardianData);
    return successResponse(res, guardianData, 'Guardian dashboard fetched');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAdminDashboard,
  getTeacherDashboard,
  getStudentDashboard,
  getGuardianDashboard
};
