const prisma = require('../utils/prisma');
const XLSX = require('xlsx');
const logger = require('../utils/logger');

/**
 * Generate attendance report data
 */
async function generateAttendanceReport({ schoolId, classId, startDate, endDate, studentId }) {
  const where = {
    ...(schoolId && { schoolId }),
    ...(classId && { classId }),
    ...(studentId && { studentId }),
    ...(startDate && endDate && {
      date: { gte: new Date(startDate), lte: new Date(endDate) }
    })
  };

  const records = await prisma.attendance.findMany({
    where,
    include: {
      student: {
        include: { user: { select: { firstName: true, lastName: true } } }
      },
      class: { select: { name: true } },
      teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
    },
    orderBy: [{ date: 'asc' }, { student: { user: { firstName: 'asc' } } }]
  });

  // Calculate per-student stats
  const studentStats = {};
  records.forEach(r => {
    const sid = r.studentId;
    if (!studentStats[sid]) {
      studentStats[sid] = {
        name: `${r.student.user.firstName} ${r.student.user.lastName}`,
        present: 0, absent: 0, late: 0, excused: 0, total: 0
      };
    }
    studentStats[sid].total++;
    const status = r.status.toLowerCase();
    if (studentStats[sid][status] !== undefined) {
      studentStats[sid][status]++;
    }
  });

  Object.values(studentStats).forEach(s => {
    s.percentage = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
  });

  return { records, studentStats: Object.values(studentStats) };
}

/**
 * Generate grades report data
 */
async function generateGradesReport({ schoolId, classId, termId, studentId }) {
  const where = {
    deletedAt: null,
    ...(classId && { classId }),
    ...(termId && { termId }),
    ...(studentId && { studentId })
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

  // Per-student summary
  const studentSummary = {};
  grades.forEach(g => {
    const sid = g.studentId;
    if (!studentSummary[sid]) {
      studentSummary[sid] = {
        name: `${g.student.user.firstName} ${g.student.user.lastName}`,
        grades: [], totalScore: 0, count: 0
      };
    }
    studentSummary[sid].grades.push(g);
    studentSummary[sid].totalScore += g.percentage || 0;
    studentSummary[sid].count++;
  });

  Object.values(studentSummary).forEach(s => {
    s.average = s.count > 0 ? Math.round(s.totalScore / s.count) : 0;
    s.letterGrade = getLetterGrade(s.average);
    s.gpa = getGpa(s.letterGrade);
  });

  return { grades, studentSummary: Object.values(studentSummary) };
}

/**
 * Export data to Excel buffer
 */
function exportToExcel(data, sheetName = 'Report') {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Auto-width columns
  const colWidths = Object.keys(data[0] || {}).map(key => ({
    wch: Math.max(key.length, ...data.map(row => String(row[key] || '').length))
  }));
  ws['!cols'] = colWidths;

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function getLetterGrade(pct) {
  if (pct >= 97) return 'A+';
  if (pct >= 93) return 'A';
  if (pct >= 90) return 'A-';
  if (pct >= 87) return 'B+';
  if (pct >= 83) return 'B';
  if (pct >= 80) return 'B-';
  if (pct >= 77) return 'C+';
  if (pct >= 73) return 'C';
  if (pct >= 70) return 'C-';
  if (pct >= 67) return 'D+';
  if (pct >= 63) return 'D';
  if (pct >= 60) return 'D-';
  return 'F';
}

function getGpa(letter) {
  const map = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0.0
  };
  return map[letter] ?? 0.0;
}

module.exports = { generateAttendanceReport, generateGradesReport, exportToExcel };
