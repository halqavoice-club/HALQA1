'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { eduMember, eduStaff } = require('../middleware/educationAuth');
const prisma = require('../utils/prisma');
const { successResponse } = require('../utils/response');
const XLSX = require('xlsx');

router.use(authenticate);

// Attendance report — staff only
router.get('/attendance', ...eduStaff, async (req, res, next) => {
  try {
    const { classId, startDate, endDate, format = 'json' } = req.query;
    const schoolId = req.schoolId || req.user.schoolId;
    const where = {
      ...(schoolId && { schoolId }),
      ...(classId  && { classId }),
      ...(startDate && endDate && { date: { gte: new Date(startDate), lte: new Date(endDate) } })
    };
    const records = await prisma.attendance.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        class: { select: { name: true } }
      },
      orderBy: [{ date: 'asc' }, { student: { user: { firstName: 'asc' } } }]
    });
    if (format === 'xlsx') {
      const data = records.map(r => ({
        'Student Name': `${r.student.user.firstName} ${r.student.user.lastName}`,
        'Class': r.class.name, 'Date': r.date.toISOString().split('T')[0],
        'Status': r.status, 'Check In': r.checkInTime?.toISOString() || '',
        'Check Out': r.checkOutTime?.toISOString() || '', 'Notes': r.notes || ''
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=attendance-report.xlsx');
      return res.send(buffer);
    }
    return successResponse(res, records, 'Attendance report generated');
  } catch (error) { next(error); }
});

// Grades report — staff only
router.get('/grades', ...eduStaff, async (req, res, next) => {
  try {
    const { classId, termId, format = 'json' } = req.query;
    const where = {
      deletedAt: null,
      ...(classId && { classId }),
      ...(termId  && { termId })
    };
    const grades = await prisma.grade.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        class: { select: { name: true } },
        category: true
      },
      orderBy: [{ student: { user: { firstName: 'asc' } } }, { gradedAt: 'desc' }]
    });
    if (format === 'xlsx') {
      const data = grades.map(g => ({
        'Student': `${g.student.user.firstName} ${g.student.user.lastName}`,
        'Class': g.class.name, 'Title': g.title, 'Type': g.type,
        'Score': g.score, 'Max Score': g.maxScore,
        'Percentage': g.percentage?.toFixed(1) + '%',
        'Letter Grade': g.letterGrade,
        'Date': g.gradedAt.toISOString().split('T')[0]
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Grades');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=grades-report.xlsx');
      return res.send(buffer);
    }
    return successResponse(res, grades, 'Grades report generated');
  } catch (error) { next(error); }
});

// Behavior report — staff only
router.get('/behavior', ...eduStaff, async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, format = 'json' } = req.query;
    const where = {
      deletedAt: null,
      ...(studentId && { studentId }),
      ...(startDate && endDate && { date: { gte: new Date(startDate), lte: new Date(endDate) } })
    };
    const logs = await prisma.behaviorLog.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { date: 'desc' }
    });
    if (format === 'xlsx') {
      const data = logs.map(l => ({
        'Student': `${l.student.user.firstName} ${l.student.user.lastName}`,
        'Teacher': l.teacher ? `${l.teacher.user.firstName} ${l.teacher.user.lastName}` : 'Admin',
        'Type': l.type, 'Category': l.category, 'Points': l.points,
        'Description': l.description || '', 'Date': l.date.toISOString().split('T')[0]
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Behavior');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=behavior-report.xlsx');
      return res.send(buffer);
    }
    return successResponse(res, logs, 'Behavior report generated');
  } catch (error) { next(error); }
});

module.exports = router;
