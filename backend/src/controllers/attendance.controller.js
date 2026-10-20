const prisma = require('../utils/prisma');
const { successResponse, errorResponse, paginatedResponse, getPagination, buildPaginationMeta } = require('../utils/response');
const { sendAttendanceAlert } = require('../utils/email');
const { getIo } = require('../sockets');

async function markAttendance(req, res, next) {
  try {
    const {
      classId, studentId, date, status, checkInTime, checkOutTime,
      checkInMethod, checkInLat, checkInLng, notes
    } = req.body;

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Resolve the Teacher record for the authenticated user (if they are a TEACHER)
    // Use school membership role (effectiveRole) — NOT req.user.role — so MEMBER users
    // with a TEACHER school membership are correctly identified.
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    let teacherId = null;
    if (effectiveRole === 'TEACHER' || effectiveRole === 'SCHOOL_ADMIN') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id, deletedAt: null }, select: { id: true } });
      teacherId = teacher?.id ?? null;
    }

    // P2-002 FIX: Verify classId and studentId both belong to the caller's school.
    const schoolId = req.schoolId || req.user.schoolId;
    if (schoolId) {
      const [cls, student] = await Promise.all([
        prisma.class.findFirst({ where: { id: classId, schoolId, deletedAt: null }, select: { id: true } }),
        prisma.student.findFirst({ where: { id: studentId, schoolId, deletedAt: null }, select: { id: true } })
      ]);
      if (!cls)     return errorResponse(res, 'Class not found in your school', 403);
      if (!student) return errorResponse(res, 'Student not found in your school', 403);
    }

    // Upsert attendance record — handle concurrent requests gracefully
    let attendance;
    try {
      attendance = await prisma.attendance.upsert({
        where: {
          classId_studentId_date: {
            classId,
            studentId,
            date: attendanceDate
          }
        },
        update: {
          status,
          checkInTime: checkInTime ? new Date(checkInTime) : undefined,
          checkOutTime: checkOutTime ? new Date(checkOutTime) : undefined,
          checkInMethod,
          checkInLat,
          checkInLng,
          notes,
          teacherId: teacherId ?? undefined
        },
        create: {
          classId,
          studentId,
          date: attendanceDate,
          status,
          checkInTime: checkInTime ? new Date(checkInTime) : null,
          checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
          checkInMethod: checkInMethod || 'manual',
          checkInLat,
          checkInLng,
          notes,
          teacherId,
          schoolId: (req.schoolId || req.user.schoolId)
        },
        include: {
          student: {
            include: {
              user: { select: { firstName: true, lastName: true } },
              guardianLinks: {
                include: {
                  guardian: {
                    include: { user: { select: { email: true, firstName: true } } }
                  }
                }
              }
            }
          }
        }
      });
    } catch (upsertError) {
      // P2002 = unique constraint violated by concurrent request (race condition)
      // P2025 = record not found in update fallback (also race condition)
      if (upsertError.code === 'P2002' || upsertError.code === 'P2025') {
        // Retry upsert once — the conflicting record now exists so upsert will take the update path
        try {
          attendance = await prisma.attendance.upsert({
            where: {
              classId_studentId_date: {
                classId,
                studentId,
                date: attendanceDate
              }
            },
            update: {
              status,
              checkInTime: checkInTime ? new Date(checkInTime) : undefined,
              checkOutTime: checkOutTime ? new Date(checkOutTime) : undefined,
              checkInMethod,
              checkInLat,
              checkInLng,
              notes,
              teacherId: teacherId ?? undefined
            },
            create: {
              classId,
              studentId,
              date: attendanceDate,
              status,
              checkInTime: checkInTime ? new Date(checkInTime) : null,
              checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
              checkInMethod: checkInMethod || 'manual',
              checkInLat,
              checkInLng,
              notes,
              teacherId,
              schoolId: (req.schoolId || req.user.schoolId)
            },
            include: {
              student: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                  guardianLinks: {
                    include: {
                      guardian: {
                        include: { user: { select: { email: true, firstName: true } } }
                      }
                    }
                  }
                }
              }
            }
          });
        } catch (retryError) {
          // If the retry also fails with P2002 fall back to a plain update
          if (retryError.code === 'P2002') {
            attendance = await prisma.attendance.update({
              where: {
                classId_studentId_date: { classId, studentId, date: attendanceDate }
              },
              data: {
                status,
                checkInTime: checkInTime ? new Date(checkInTime) : undefined,
                checkOutTime: checkOutTime ? new Date(checkOutTime) : undefined,
                checkInMethod,
                notes
              },
              include: {
                student: {
                  include: {
                    user: { select: { firstName: true, lastName: true } },
                    guardianLinks: {
                      include: {
                        guardian: {
                          include: { user: { select: { email: true, firstName: true } } }
                        }
                      }
                    }
                  }
                }
              }
            });
          } else {
            throw retryError;
          }
        }
      } else {
        throw upsertError;
      }
    }

    // Log the action
    await prisma.attendanceLog.create({
      data: {
        attendanceId: attendance.id,
        action: 'status_change',
        newStatus: status,
        performedBy: req.user.id,
        notes
      }
    });

    // Notify parents for absences/late
    if (['ABSENT', 'LATE'].includes(status) && !attendance.notifiedParent) {
      const studentName = `${attendance.student.user.firstName} ${attendance.student.user.lastName}`;

      for (const link of attendance.student.guardianLinks) {
        const guardianEmail = link.guardian.user.email;
        if (guardianEmail) {
          await sendAttendanceAlert(guardianEmail, studentName, status, date);
        }
      }

      await prisma.attendance.update({
        where: { id: attendance.id },
        data: { notifiedParent: true }
      });

      // Real-time notification via socket
      const io = getIo();
      if (io) {
        for (const link of attendance.student.guardianLinks) {
          io.to(`user:${link.guardian.userId}`).emit('attendance:alert', {
            studentName,
            status,
            date,
            classId
          });
        }
      }
    }

    return successResponse(res, attendance, 'Attendance marked successfully');
  } catch (error) {
    next(error);
  }
}

async function bulkMarkAttendance(req, res, next) {
  try {
    const { classId, date, records } = req.body;

    if (!classId || !date) return errorResponse(res, 'classId and date are required', 400);
    if (!Array.isArray(records) || records.length === 0) {
      return errorResponse(res, 'records must be a non-empty array', 400);
    }

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;

    // P2-002/P2-003 FIX: Validate classId and all studentIds belong to the caller's school.
    // Removed dead SUPER_ADMIN bypass — requireSchoolMember already blocks SUPER_ADMIN upstream.
    if (schoolId) {
      // Validate classId belongs to this school
      const cls = await prisma.class.findFirst({ where: { id: classId, schoolId, deletedAt: null }, select: { id: true } });
      if (!cls) return errorResponse(res, 'Class not found in your school', 403);

      // Validate all studentIds belong to this school
      const studentIds = [...new Set(records.map(r => r.studentId))];
      const validStudents = await prisma.student.findMany({
        where: { id: { in: studentIds }, schoolId, deletedAt: null },
        select: { id: true }
      });
      const validIds = new Set(validStudents.map(s => s.id));
      const invalid = studentIds.filter(id => !validIds.has(id));
      if (invalid.length > 0) {
        return errorResponse(res, `Students not found in your school: ${invalid.join(', ')}`, 400);
      }
    }

    let teacherId = null;
    if (effectiveRole === 'TEACHER') {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      teacherId = teacher?.id ?? null;
    }

    const results = await Promise.allSettled(
      records.map(record =>
        prisma.attendance.upsert({
          where: {
            classId_studentId_date: {
              classId,
              studentId: record.studentId,
              date: attendanceDate
            }
          },
          update: {
            status: record.status,
            notes: record.notes,
            teacherId: teacherId ?? undefined
          },
          create: {
            classId,
            studentId: record.studentId,
            date: attendanceDate,
            status: record.status,
            notes: record.notes,
            checkInMethod: 'manual',
            teacherId,
            schoolId: (req.schoolId || req.user.schoolId)
          }
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return successResponse(res, { succeeded, failed, total: records.length }, 'Bulk attendance marked');
  } catch (error) {
    next(error);
  }
}

async function qrCheckIn(req, res, next) {
  try {
    const { qrCode, classId } = req.body;

    const student = await prisma.student.findUnique({
      where: { qrCode },
      include: { user: { select: { firstName: true, lastName: true } } }
    });
    if (!student) return errorResponse(res, 'Invalid QR code', 404);

    // H-7 FIX: Verify the student belongs to the same school as the caller,
    // and that the classId also belongs to that school.
    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId) {
      if (student.schoolId !== schoolId) {
        return errorResponse(res, 'QR code does not belong to a student in your school', 403);
      }
      const cls = await prisma.class.findFirst({
        where: { id: classId, schoolId, deletedAt: null },
        select: { id: true }
      });
      if (!cls) return errorResponse(res, 'Class not found in your school', 404);
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const attendance = await prisma.attendance.upsert({
      where: {
        classId_studentId_date: {
          classId,
          studentId: student.id,
          date: today
        }
      },
      update: {
        checkInTime: new Date(),
        checkInMethod: 'qr',
        status: 'PRESENT'
      },
      create: {
        classId,
        studentId: student.id,
        date: today,
        status: 'PRESENT',
        checkInTime: new Date(),
        checkInMethod: 'qr',
        schoolId: student.schoolId
      }
    });

    return successResponse(res, {
      attendance,
      student: {
        id: student.id,
        name: `${student.user.firstName} ${student.user.lastName}`
      }
    }, 'Check-in successful');
  } catch (error) {
    next(error);
  }
}

async function getClassAttendance(req, res, next) {
  try {
    const { classId } = req.params;
    const { date, startDate, endDate, month, status } = req.query;

    // M-2 FIX: Verify classId belongs to the caller's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId) {
      const cls = await prisma.class.findFirst({
        where: { id: classId, schoolId, deletedAt: null },
        select: { id: true }
      });
      if (!cls) return errorResponse(res, 'Class not found in your school', 404);
    }

    const where = { classId };

    if (date) {
      const d = new Date(date);
      d.setUTCHours(0, 0, 0, 0);
      where.date = d;
    } else if (month) {
      const [y, m] = month.split('-').map(Number);
      where.date = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    } else if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (status) where.status = status;

    const records = await prisma.attendance.findMany({
      where,
      include: {
        student: {
          include: {
            user: { select: { firstName: true, lastName: true, avatarUrl: true } }
          }
        }
      },
      orderBy: [{ date: 'desc' }, { student: { user: { firstName: 'asc' } } }]
    });

    return successResponse(res, records, 'Attendance fetched');
  } catch (error) {
    next(error);
  }
}

async function getStudentAttendance(req, res, next) {
  try {
    const { studentId } = req.params;
    const { classId, startDate, endDate, month, page = 1, limit = 30 } = req.query;
    const { skip, ...pagination } = getPagination(page, limit);

    // H-4 FIX: Students can only view their own attendance records.
    // Guardians can only view their linked students' records.
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole === 'STUDENT') {
      const myStudent = await prisma.student.findFirst({
        where: { userId: req.user.id, deletedAt: null },
        select: { id: true }
      });
      if (!myStudent || myStudent.id !== studentId) {
        return errorResponse(res, 'Access denied — you can only view your own attendance', 403);
      }
    }
    if (effectiveRole === 'GUARDIAN') {
      const guardian = await prisma.guardian.findFirst({
        where: { userId: req.user.id, deletedAt: null },
        include: { students: { where: { studentId } } }
      });
      if (!guardian || guardian.students.length === 0) {
        return errorResponse(res, 'Access denied — not your linked student', 403);
      }
    }

    const where = { studentId };
    if (classId) where.classId = classId;
    if (month) {
      // month = 'YYYY-MM' — filter to that calendar month
      const [y, m] = month.split('-').map(Number);
      where.date = {
        gte: new Date(y, m - 1, 1),
        lt:  new Date(y, m, 1),
      };
    } else if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          class: { select: { id: true, name: true } }
        },
        orderBy: { date: 'desc' },
        skip,
        take: pagination.limit
      }),
      prisma.attendance.count({ where })
    ]);

    // Calculate stats
    const stats = {
      total,
      present: records.filter(r => r.status === 'PRESENT').length,
      absent: records.filter(r => r.status === 'ABSENT').length,
      late: records.filter(r => r.status === 'LATE').length,
      excused: records.filter(r => r.status === 'EXCUSED').length,
      percentage: total > 0
        ? Math.round((records.filter(r => r.status === 'PRESENT').length / total) * 100)
        : 0
    };

    return paginatedResponse(res, { records, stats }, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (error) {
    next(error);
  }
}

async function getAttendanceAnalytics(req, res, next) {
  try {
    const { classId, startDate, endDate } = req.query;
    const schoolId = (req.schoolId || req.user.schoolId);

    const where = {};
    if (classId) where.classId = classId;
    // NF-7 FIX: Use effectiveRole for SUPER_ADMIN bypass check.
    const effectiveRoleAnalytics = req.schoolMembership?.role || req.user.role;
    if (schoolId && effectiveRoleAnalytics !== 'SUPER_ADMIN') where.schoolId = schoolId;
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const records = await prisma.attendance.groupBy({
      by: ['status', 'date'],
      where,
      _count: { status: true },
      orderBy: { date: 'asc' }
    });

    // Build heatmap data
    const heatmap = {};
    records.forEach(r => {
      const dateKey = r.date.toISOString().split('T')[0];
      if (!heatmap[dateKey]) heatmap[dateKey] = {};
      heatmap[dateKey][r.status] = r._count.status;
    });

    // Overall stats
    const totals = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { status: true }
    });

    return successResponse(res, { heatmap, totals }, 'Analytics fetched');
  } catch (error) {
    next(error);
  }
}

async function updateAttendance(req, res, next) {
  try {
    const { id } = req.params;
    const { status, notes, checkInTime, checkOutTime } = req.body;

    const existing = await prisma.attendance.findUnique({
      where: { id },
      include: { teacher: true }
    });
    if (!existing) return errorResponse(res, 'Attendance record not found', 404);

    // H-3 FIX: School isolation check — verify the record belongs to the caller's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId && existing.schoolId && existing.schoolId !== schoolId) {
      return errorResponse(res, 'Access denied to this school\'s attendance record', 403);
    }

    // Role-based ownership: teacher can only update their own records
    if (effectiveRole === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (!teacher || existing.teacherId !== teacher.id) {
        return errorResponse(res, 'You can only update your own attendance records', 403);
      }
    }

    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        status,
        notes,
        checkInTime: checkInTime ? new Date(checkInTime) : undefined,
        checkOutTime: checkOutTime ? new Date(checkOutTime) : undefined
      }
    });

    // Log the update
    await prisma.attendanceLog.create({
      data: {
        attendanceId: id,
        action: 'status_change',
        previousStatus: existing.status,
        newStatus: status,
        performedBy: req.user.id,
        notes: `Updated by ${req.user.role}`
      }
    });

    return successResponse(res, updated, 'Attendance updated');
  } catch (error) { next(error); }
}

async function deleteAttendance(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.attendance.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Attendance record not found', 404);

    // H-3 FIX: School isolation — verify record belongs to caller's school.
    const schoolId = req.schoolId || req.user.schoolId;
    const effectiveRole = req.schoolMembership?.role || req.user.role;
    if (effectiveRole !== 'SUPER_ADMIN' && schoolId && existing.schoolId && existing.schoolId !== schoolId) {
      return errorResponse(res, 'Access denied to this school\'s attendance record', 403);
    }

    // Role-based ownership: teacher can only delete their own records
    if (effectiveRole === 'TEACHER') {
      const teacher = await prisma.teacher.findFirst({ where: { userId: req.user.id } });
      if (!teacher || existing.teacherId !== teacher.id) {
        return errorResponse(res, 'You can only delete your own attendance records', 403);
      }
    }

    await prisma.attendance.delete({ where: { id } });

    return successResponse(res, null, 'Attendance record deleted');
  } catch (error) { next(error); }
}

async function getAttendanceReport(req, res, next) {
  try {
    const { classId, studentId, startDate, endDate, status } = req.query;
    const schoolId = (req.schoolId || req.user.schoolId);

    const where = {};
    const effectiveRoleReport2 = req.schoolMembership?.role || req.user.role;
    if (schoolId && effectiveRoleReport2 !== 'SUPER_ADMIN') where.schoolId = schoolId;
    if (classId) where.classId = classId;
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // For students — only their own records
    // NF-7 FIX: Use effectiveRole so MEMBER users with STUDENT membership are correctly scoped.
    const effectiveRoleReport = req.schoolMembership?.role || req.user.role;
    if (effectiveRoleReport === 'STUDENT') {
      const student = await prisma.student.findFirst({ where: { userId: req.user.id } });
      if (!student) return errorResponse(res, 'Student profile not found', 404);
      where.studentId = student.id;
    }

    // For guardians — only linked students
    // NF-7 FIX: Use effectiveRole for guardian check too.
    if (effectiveRoleReport === 'GUARDIAN') {
      const guardian = await prisma.guardian.findFirst({
        where: { userId: req.user.id },
        include: { students: { select: { studentId: true } } }
      });
      if (!guardian) return errorResponse(res, 'Guardian profile not found', 404);
      const linkedIds = guardian.students.map(s => s.studentId);
      if (studentId && !linkedIds.includes(studentId)) {
        return errorResponse(res, 'Access denied to this student', 403);
      }
      if (!studentId) where.studentId = { in: linkedIds };
    }

    const records = await prisma.attendance.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        class: { select: { id: true, name: true } }
      },
      orderBy: [{ date: 'desc' }, { student: { user: { firstName: 'asc' } } }]
    });

    // Summary stats
    const summary = {
      total: records.length,
      present: records.filter(r => r.status === 'PRESENT').length,
      absent: records.filter(r => r.status === 'ABSENT').length,
      late: records.filter(r => r.status === 'LATE').length,
      excused: records.filter(r => r.status === 'EXCUSED').length,
      leftEarly: records.filter(r => r.status === 'LEFT_EARLY').length,
    };
    summary.percentage = summary.total > 0
      ? Math.round((summary.present / summary.total) * 100)
      : 0;

    return successResponse(res, { records, summary }, 'Attendance report fetched');
  } catch (error) { next(error); }
}

module.exports = {
  markAttendance,
  bulkMarkAttendance,
  qrCheckIn,
  getClassAttendance,
  getStudentAttendance,
  getAttendanceAnalytics,
  updateAttendance,
  deleteAttendance,
  getAttendanceReport
};
