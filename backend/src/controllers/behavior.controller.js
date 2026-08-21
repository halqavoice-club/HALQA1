const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { getIo } = require('../sockets');

async function createBehaviorLog(req, res, next) {
  try {
    const { studentId, type, category, points, description, date } = req.body;

    // Validate points range
    if (points < -99 || points > 99) {
      return errorResponse(res, 'Points must be between -99 and +99', 400);
    }

    // Get teacher record
    const teacher = await prisma.teacher.findFirst({
      where: { userId: req.user.id }
    });

    // GAP FIX: Use effectiveRole so MEMBER+TEACHER membership users are checked
    // the same as legacy TEACHER global role users.
    const effectiveRoleBehavior = req.schoolMembership?.role || req.user.role;
    if (!teacher && effectiveRoleBehavior === 'TEACHER') {
      return errorResponse(res, 'Teacher profile not found', 404);
    }

    const log = await prisma.behaviorLog.create({
      data: {
        student: { connect: { id: studentId } },
        // H-1 FIX: Remove req.body.teacherId fallback — never accept teacherId from client.
        // The teacher is always resolved from the authenticated user's own teacher record.
        // If the user is SCHOOL_ADMIN/SUPER_ADMIN with no teacher record, the log is
        // created without a teacher link (adminNote can carry context).
        ...(teacher?.id
          ? { teacher: { connect: { id: teacher.id } } }
          : {}
        ),
        type,
        category,
        points: type === 'NEGATIVE' ? -Math.abs(points) : Math.abs(points),
        description,
        date: date ? new Date(date) : new Date()
      },
      include: {
        student: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            guardianLinks: {
              include: {
                guardian: {
                  include: { user: { select: { id: true, email: true } } }
                }
              }
            }
          }
        },
        teacher: {
          include: { user: { select: { firstName: true, lastName: true } } }
        }
      }
    });

    // Notify guardians for negative behavior
    if (type === 'NEGATIVE') {
      const io = getIo();
      const studentName = `${log.student.user.firstName} ${log.student.user.lastName}`;

      for (const link of log.student.guardianLinks) {
        // Create notification
        await prisma.notification.create({
          data: {
            userId: link.guardian.user.id,
            schoolId: (req.schoolId || req.user.schoolId),
            type: 'BEHAVIOR',
            title: 'Behavior Alert',
            body: `${studentName} received a behavior note: ${category} (${points} points)`,
            data: { behaviorLogId: log.id, studentId }
          }
        });

        if (io) {
          io.to(`user:${link.guardian.user.id}`).emit('behavior:alert', {
            studentName,
            category,
            points,
            type,
            description
          });
        }
      }
    }

    return successResponse(res, log, 'Behavior log created', 201);
  } catch (error) {
    next(error);
  }
}

async function getStudentBehavior(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate, type, category, page = 1, limit = 20 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    // Role-based scope: guardians can only view their linked students' behavior
    // Same pattern as getStudentAttendance (H-4 fix)
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole === 'STUDENT') {
      const myStudent = await prisma.student.findFirst({ where: { userId: req.user.id, deletedAt: null }, select: { id: true } });
      if (!myStudent || myStudent.id !== studentId) return errorResponse(res, 'Access denied — you can only view your own behavior', 403);
    }
    if (effectiveRole === 'GUARDIAN') {
      const guardian = await prisma.guardian.findFirst({
        where: { userId: req.user.id, deletedAt: null },
        include: { students: { where: { studentId } } }
      });
      if (!guardian || guardian.students.length === 0) return errorResponse(res, 'Access denied — not your linked student', 403);
    }

    const where = { studentId, deletedAt: null };
    if (type) where.type = type;
    if (category) where.category = category;
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [logs, total] = await Promise.all([
      prisma.behaviorLog.findMany({
        where,
        include: {
          teacher: {
            include: { user: { select: { firstName: true, lastName: true } } }
          }
        },
        orderBy: { date: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.behaviorLog.count({ where })
    ]);

    // Calculate total points
    const pointsSum = await prisma.behaviorLog.aggregate({
      where: { studentId, deletedAt: null },
      _sum: { points: true }
    });

    const stats = {
      totalPoints: pointsSum._sum.points || 0,
      positive: logs.filter(l => l.type === 'POSITIVE').length,
      negative: logs.filter(l => l.type === 'NEGATIVE').length
    };

    return paginatedResponse(res, { logs, stats }, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) {
    next(error);
  }
}

async function getBehaviorSummary(req, res, next) {
  try {
    const { classId, startDate, endDate } = req.query;
    const schoolId = (req.schoolId || req.user.schoolId);

    // Get all students in class
    const enrollments = classId
      ? await prisma.enrollment.findMany({
          where: { classId, isActive: true },
          select: { studentId: true }
        })
      : [];

    const studentIds = enrollments.map(e => e.studentId);

    const where = {
      deletedAt: null,
      ...(studentIds.length > 0 && { studentId: { in: studentIds } }),
      ...(startDate && endDate && {
        date: { gte: new Date(startDate), lte: new Date(endDate) }
      })
    };

    const summary = await prisma.behaviorLog.groupBy({
      by: ['studentId', 'type'],
      where,
      _sum: { points: true },
      _count: { id: true }
    });

    return successResponse(res, summary, 'Behavior summary fetched');
  } catch (error) {
    next(error);
  }
}

async function updateBehaviorLog(req, res, next) {
  try {
    const { id } = req.params;
    const { points, description, category } = req.body;

    // H-6 FIX: Verify the log belongs to the caller's school and teacher owns it.
    const existing = await prisma.behaviorLog.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return errorResponse(res, 'Behavior log not found', 404);

    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    // School isolation: verify the student belongs to the caller's school
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId) {
      const student = await prisma.student.findFirst({
        where: { id: existing.studentId, schoolId },
        select: { id: true }
      });
      if (!student) return errorResponse(res, 'Access denied to this school\'s behavior log', 403);
    }
    // Teacher ownership: teachers can only update their own logs
    if (effectiveRole === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id, deletedAt: null }, select: { id: true } });
      if (!teacher || existing.teacherId !== teacher.id) {
        return errorResponse(res, 'You can only update behavior logs you created', 403);
      }
    }

    const safePoints = points !== undefined
      ? (req.body.type === 'NEGATIVE' ? -Math.abs(points) : Math.abs(points))
      : existing.points;

    const log = await prisma.behaviorLog.update({
      where: { id },
      data: {
        ...(points  !== undefined && { points: safePoints }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
      }
    });

    return successResponse(res, log, 'Behavior log updated');
  } catch (error) {
    next(error);
  }
}

async function deleteBehaviorLog(req, res, next) {
  try {
    const { id } = req.params;

    // H-6 FIX: Verify school isolation and teacher ownership before deleting.
    const existing = await prisma.behaviorLog.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return errorResponse(res, 'Behavior log not found', 404);

    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId) {
      const student = await prisma.student.findFirst({
        where: { id: existing.studentId, schoolId },
        select: { id: true }
      });
      if (!student) return errorResponse(res, 'Access denied to this school\'s behavior log', 403);
    }
    if (effectiveRole === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id, deletedAt: null }, select: { id: true } });
      if (!teacher || existing.teacherId !== teacher.id) {
        return errorResponse(res, 'You can only delete behavior logs you created', 403);
      }
    }

    await prisma.behaviorLog.update({ where: { id }, data: { deletedAt: new Date() } });
    return successResponse(res, null, 'Behavior log deleted');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createBehaviorLog,
  getStudentBehavior,
  getBehaviorSummary,
  updateBehaviorLog,
  deleteBehaviorLog
};
