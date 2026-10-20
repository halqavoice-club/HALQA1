
const prisma = require('../utils/prisma');
const { buildMultiSheetWorkbook } = require('../utils/excel');
const PDFDocument = require('pdfkit');
const { successResponse, errorResponse } = require('../utils/response');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
  LEFT_EARLY: 'Left Early'
};

const STATUS_COLORS_HEX = {
  PRESENT: '#16a34a',
  ABSENT: '#dc2626',
  LATE: '#d97706',
  EXCUSED: '#2563eb',
  LEFT_EARLY: '#ea580c'
};

function getLetterGrade(pct) {
  if (pct >= 97) return 'A+';
  if (pct >= 93) return 'A';
  if (pct >= 90) return 'A-';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

async function getStudentWithAttendance(studentId, startDate, endDate) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
      school: { select: { name: true, logoUrl: true } },
      enrollments: {
        where: { isActive: true },
        include: { class: { select: { id: true, name: true } } }
      }
    }
  });

  if (!student) return null;

  const where = { studentId };
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) };
  }

  const records = await prisma.attendance.findMany({
    where,
    include: {
      class: { select: { name: true } }
    },
    orderBy: { date: 'desc' }
  });

  return { student, records };
}

// ─── 1. SUMMARY ───────────────────────────────────────────────────────────────

async function getStudentSummary(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate, classId } = req.query;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
        school: { select: { name: true } },
        enrollments: {
          where: { isActive: true },
          include: { class: { select: { id: true, name: true } } }
        }
      }
    });

    if (!student) return errorResponse(res, 'Student not found', 404);

    const where = { studentId };
    if (classId) where.classId = classId;
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    // Aggregate counts using raw groupBy
    const counts = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { status: true }
    });

    const summary = {
      PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0
    };
    counts.forEach(c => { summary[c.status] = c._count.status; });

    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    const presentEquivalent = summary.PRESENT + (summary.LATE * 0.5);
    const percentage = total > 0 ? Math.round((presentEquivalent / total) * 100) : 0;

    // Recent streak
    const recentRecords = await prisma.attendance.findMany({
      where: { studentId },
      orderBy: { date: 'desc' },
      take: 10,
      select: { status: true, date: true }
    });

    let currentStreak = 0;
    for (const r of recentRecords) {
      if (r.status === 'PRESENT') currentStreak++;
      else break;
    }

    return successResponse(res, {
      student: {
        id: student.id,
        studentId: student.studentId,
        name: `${student.user.firstName} ${student.user.lastName}`,
        email: student.user.email,
        avatarUrl: student.user.avatarUrl,
        school: student.school?.name,
        classes: student.enrollments.map(e => e.class.name)
      },
      summary: {
        total,
        present: summary.PRESENT,
        absent: summary.ABSENT,
        late: summary.LATE,
        excused: summary.EXCUSED,
        leftEarly: summary.LEFT_EARLY,
        percentage,
        letterGrade: getLetterGrade(percentage),
        currentStreak,
        status: percentage >= 90 ? 'excellent' : percentage >= 75 ? 'good' : percentage >= 60 ? 'warning' : 'critical'
      }
    }, 'Student attendance summary');
  } catch (error) { next(error); }
}

// ─── 2. DAILY HISTORY ─────────────────────────────────────────────────────────

async function getStudentHistory(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate, classId, status, page = 1, limit = 30 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { studentId };
    if (classId) where.classId = classId;
    if (status) where.status = status;
    if (startDate && endDate) {
      where.date = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          class: { select: { name: true } },
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
        },
        orderBy: { date: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.attendance.count({ where })
    ]);

    const history = records.map(r => ({
      id: r.id,
      date: r.date,
      dateFormatted: formatDate(r.date),
      dayOfWeek: new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' }),
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] || r.status,
      checkIn: r.checkInTime ? formatTime(r.checkInTime) : null,
      checkOut: r.checkOutTime ? formatTime(r.checkOutTime) : null,
      checkInMethod: r.checkInMethod,
      notes: r.notes,
      class: r.class?.name,
      markedBy: r.teacher ? `${r.teacher.user.firstName} ${r.teacher.user.lastName}` : null
    }));

    return successResponse(res, {
      history,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
        hasPrev: parseInt(page) > 1
      }
    }, 'Attendance history');
  } catch (error) { next(error); }
}

// ─── 3. MONTHLY CALENDAR ──────────────────────────────────────────────────────

async function getStudentCalendar(req, res, next) {
  try {
    const { studentId } = req.params;
    const { month } = req.query; // YYYY-MM

    const targetMonth = month ? new Date(month + '-01') : new Date();
    const year = targetMonth.getFullYear();
    const monthNum = targetMonth.getMonth();

    const startDate = new Date(year, monthNum, 1);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(year, monthNum + 1, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    const records = await prisma.attendance.findMany({
      where: {
        studentId,
        date: { gte: startDate, lte: endDate }
      },
      include: {
        class: { select: { name: true } }
      },
      orderBy: { date: 'asc' }
    });

    // Build calendar grid
    const daysInMonth = new Date(year, monthNum + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, monthNum, 1).getDay(); // 0=Sun

    // Map records by day
    const dayMap = {};
    records.forEach(r => {
      const day = new Date(r.date).getUTCDate();
      dayMap[day] = {
        status: r.status,
        statusLabel: STATUS_LABELS[r.status],
        color: STATUS_COLORS_HEX[r.status] || '#94a3b8',
        checkIn: r.checkInTime ? formatTime(r.checkInTime) : null,
        checkOut: r.checkOutTime ? formatTime(r.checkOutTime) : null,
        notes: r.notes,
        class: r.class?.name
      };
    });

    // Build weeks array
    const weeks = [];
    let week = Array(firstDayOfWeek).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, monthNum, day);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const isToday = new Date().toDateString() === date.toDateString();

      week.push({
        day,
        date: `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        isWeekend,
        isToday,
        isFuture: date > new Date(),
        attendance: dayMap[day] || null
      });

      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }

    // Fill last week
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }

    // Monthly stats
    const stats = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0 };
    records.forEach(r => { if (stats[r.status] !== undefined) stats[r.status]++; });
    const totalMarked = records.length;
    const percentage = totalMarked > 0 ? Math.round(((stats.PRESENT + stats.LATE * 0.5) / totalMarked) * 100) : 0;

    return successResponse(res, {
      month: {
        year,
        month: monthNum + 1,
        monthName: targetMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        daysInMonth,
        firstDayOfWeek
      },
      weeks,
      stats: { ...stats, total: totalMarked, percentage },
      legend: Object.entries(STATUS_COLORS_HEX).map(([status, color]) => ({
        status,
        label: STATUS_LABELS[status],
        color
      }))
    }, 'Monthly calendar');
  } catch (error) { next(error); }
}

// ─── 4a. CSV EXPORT ───────────────────────────────────────────────────────────

async function exportCSV(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const result = await getStudentWithAttendance(studentId, startDate, endDate);
    if (!result) return errorResponse(res, 'Student not found', 404);

    const { student, records } = result;
    const name = `${student.user.firstName} ${student.user.lastName}`;

    const rows = [
      ['Student Attendance Report'],
      [`Student: ${name}`, `ID: ${student.studentId}`, `School: ${student.school?.name || ''}`],
      [''],
      ['Date', 'Day', 'Status', 'Check In', 'Check Out', 'Class', 'Notes']
    ];

    records.forEach(r => {
      rows.push([
        formatDate(r.date),
        new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' }),
        STATUS_LABELS[r.status] || r.status,
        r.checkInTime ? formatTime(r.checkInTime) : '',
        r.checkOutTime ? formatTime(r.checkOutTime) : '',
        r.class?.name || '',
        r.notes || ''
      ]);
    });

    // Summary rows
    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0 };
    records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total = records.length;
    const pct = total > 0 ? Math.round(((counts.PRESENT + counts.LATE * 0.5) / total) * 100) : 0;

    rows.push(['']);
    rows.push(['SUMMARY']);
    rows.push(['Total Days', total]);
    rows.push(['Present', counts.PRESENT]);
    rows.push(['Absent', counts.ABSENT]);
    rows.push(['Late', counts.LATE]);
    rows.push(['Excused', counts.EXCUSED]);
    rows.push(['Left Early', counts.LEFT_EARLY]);
    rows.push(['Attendance Rate', `${pct}%`]);

    const csv = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const filename = `attendance-${student.studentId}-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) { next(error); }
}

// ─── 4b. EXCEL EXPORT ─────────────────────────────────────────────────────────

async function exportExcel(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const result = await getStudentWithAttendance(studentId, startDate, endDate);
    if (!result) return errorResponse(res, 'Student not found', 404);

    const { student, records } = result;
    const name = `${student.user.firstName} ${student.user.lastName}`;

    // ── Sheet 1: Attendance Records ──
    const attendanceData = records.map(r => ({
      'Date': formatDate(r.date),
      'Day': new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' }),
      'Status': STATUS_LABELS[r.status] || r.status,
      'Check In': r.checkInTime ? formatTime(r.checkInTime) : '',
      'Check Out': r.checkOutTime ? formatTime(r.checkOutTime) : '',
      'Class': r.class?.name || '',
      'Method': r.checkInMethod || '',
      'Notes': r.notes || ''
    }));

    // ── Sheet 2: Summary ──
    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0 };
    records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total = records.length;
    const pct = total > 0 ? Math.round(((counts.PRESENT + counts.LATE * 0.5) / total) * 100) : 0;

    const summaryData = [
      { 'Metric': 'Student Name',         'Value': name },
      { 'Metric': 'Student ID',           'Value': student.studentId },
      { 'Metric': 'School',               'Value': student.school?.name || '' },
      { 'Metric': 'Classes',              'Value': student.enrollments.map(e => e.class.name).join(', ') },
      { 'Metric': '',                     'Value': '' },
      { 'Metric': 'Total Days Recorded',  'Value': total },
      { 'Metric': 'Present',              'Value': counts.PRESENT },
      { 'Metric': 'Absent',               'Value': counts.ABSENT },
      { 'Metric': 'Late',                 'Value': counts.LATE },
      { 'Metric': 'Excused',              'Value': counts.EXCUSED },
      { 'Metric': 'Left Early',           'Value': counts.LEFT_EARLY },
      { 'Metric': '',                     'Value': '' },
      { 'Metric': 'Attendance Rate',      'Value': `${pct}%` },
      { 'Metric': 'Letter Grade',         'Value': getLetterGrade(pct) },
      { 'Metric': 'Status',               'Value': pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : pct >= 60 ? 'Warning' : 'Critical' }
    ];

    const buffer = await buildMultiSheetWorkbook([
      {
        name: 'Attendance Records',
        data: attendanceData,
        // Title rows prepended above the data header
        titleRows: [
          [`Student Attendance Report — ${name}`],
          [`Student ID: ${student.studentId}  |  School: ${student.school?.name || ''}  |  Generated: ${new Date().toLocaleDateString()}`],
          ['']
        ],
        colWidths: [
          { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
          { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 30 }
        ]
      },
      {
        name: 'Summary',
        data: summaryData,
        colWidths: [{ wch: 25 }, { wch: 30 }]
      }
    ]);

    const filename = `attendance-${student.studentId}-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

// ─── 4c. PDF EXPORT ───────────────────────────────────────────────────────────

async function exportPDF(req, res, next) {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    const result = await getStudentWithAttendance(studentId, startDate, endDate);
    if (!result) return errorResponse(res, 'Student not found', 404);

    const { student, records } = result;
    const name = `${student.user.firstName} ${student.user.lastName}`;

    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, LEFT_EARLY: 0 };
    records.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total = records.length;
    const pct = total > 0 ? Math.round(((counts.PRESENT + counts.LATE * 0.5) / total) * 100) : 0;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `attendance-${student.studentId}-${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ── HEADER ──
    // Blue header bar
    doc.rect(0, 0, doc.page.width, 80).fill('#1e40af');

    doc.fillColor('white')
      .fontSize(20).font('Helvetica-Bold')
      .text('Halqa Management System', 50, 20);

    doc.fontSize(11).font('Helvetica')
      .text('Student Attendance Report', 50, 46);

    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      doc.page.width - 250, 46, { width: 200, align: 'right' });

    // ── STUDENT INFO BOX ──
    doc.fillColor('#1e293b').rect(50, 100, doc.page.width - 100, 80).fill('#f8fafc');
    doc.rect(50, 100, 4, 80).fill('#1e40af');

    doc.fillColor('#1e293b').fontSize(16).font('Helvetica-Bold')
      .text(name, 65, 112);

    doc.fontSize(10).font('Helvetica').fillColor('#64748b')
      .text(`Student ID: ${student.studentId}`, 65, 134)
      .text(`School: ${student.school?.name || 'N/A'}`, 65, 150)
      .text(`Classes: ${student.enrollments.map(e => e.class.name).join(', ') || 'N/A'}`, 65, 166);

    // Attendance rate badge
    const badgeColor = pct >= 90 ? '#16a34a' : pct >= 75 ? '#2563eb' : pct >= 60 ? '#d97706' : '#dc2626';
    doc.rect(doc.page.width - 160, 110, 110, 60).fill(badgeColor);
    doc.fillColor('white').fontSize(28).font('Helvetica-Bold')
      .text(`${pct}%`, doc.page.width - 155, 118, { width: 100, align: 'center' });
    doc.fontSize(9).font('Helvetica')
      .text('Attendance Rate', doc.page.width - 155, 148, { width: 100, align: 'center' });

    // ── SUMMARY STATS ──
    doc.fillColor('#1e293b').fontSize(13).font('Helvetica-Bold')
      .text('Attendance Summary', 50, 205);

    const statBoxes = [
      { label: 'Total Days', value: total, color: '#1e40af' },
      { label: 'Present', value: counts.PRESENT, color: '#16a34a' },
      { label: 'Absent', value: counts.ABSENT, color: '#dc2626' },
      { label: 'Late', value: counts.LATE, color: '#d97706' },
      { label: 'Excused', value: counts.EXCUSED, color: '#2563eb' },
      { label: 'Left Early', value: counts.LEFT_EARLY, color: '#ea580c' }
    ];

    const boxW = (doc.page.width - 100 - 50) / 6;
    statBoxes.forEach((box, i) => {
      const x = 50 + i * (boxW + 10);
      doc.rect(x, 225, boxW, 55).fill(box.color);
      doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
        .text(String(box.value), x, 233, { width: boxW, align: 'center' });
      doc.fontSize(8).font('Helvetica')
        .text(box.label, x, 255, { width: boxW, align: 'center' });
    });

    // ── ATTENDANCE RECORDS TABLE ──
    doc.fillColor('#1e293b').fontSize(13).font('Helvetica-Bold')
      .text('Daily Attendance Records', 50, 305);

    // Table header
    const tableTop = 325;
    const cols = [
      { label: 'Date', x: 50, w: 90 },
      { label: 'Day', x: 145, w: 75 },
      { label: 'Status', x: 225, w: 75 },
      { label: 'Check In', x: 305, w: 65 },
      { label: 'Check Out', x: 375, w: 65 },
      { label: 'Class', x: 445, w: 100 }
    ];

    doc.rect(50, tableTop, doc.page.width - 100, 20).fill('#1e40af');
    cols.forEach(col => {
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
        .text(col.label, col.x + 3, tableTop + 5, { width: col.w });
    });

    let y = tableTop + 20;
    const rowH = 18;
    let rowIdx = 0;

    for (const r of records) {
      // New page if needed
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
        // Repeat header
        doc.rect(50, y, doc.page.width - 100, 20).fill('#1e40af');
        cols.forEach(col => {
          doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
            .text(col.label, col.x + 3, y + 5, { width: col.w });
        });
        y += 20;
        rowIdx = 0;
      }

      // Alternating row background
      if (rowIdx % 2 === 0) {
        doc.rect(50, y, doc.page.width - 100, rowH).fill('#f8fafc');
      }

      // Status color dot
      const statusColor = STATUS_COLORS_HEX[r.status] || '#94a3b8';
      doc.circle(cols[2].x + 6, y + rowH / 2, 4).fill(statusColor);

      doc.fillColor('#1e293b').fontSize(8).font('Helvetica');
      doc.text(formatDate(r.date), cols[0].x + 3, y + 4, { width: cols[0].w });
      doc.text(new Date(r.date).toLocaleDateString('en-US', { weekday: 'short' }), cols[1].x + 3, y + 4, { width: cols[1].w });
      doc.fillColor(statusColor).text(STATUS_LABELS[r.status] || r.status, cols[2].x + 14, y + 4, { width: cols[2].w - 14 });
      doc.fillColor('#1e293b')
        .text(r.checkInTime ? formatTime(r.checkInTime) : '—', cols[3].x + 3, y + 4, { width: cols[3].w })
        .text(r.checkOutTime ? formatTime(r.checkOutTime) : '—', cols[4].x + 3, y + 4, { width: cols[4].w })
        .text(r.class?.name || '—', cols[5].x + 3, y + 4, { width: cols[5].w });

      y += rowH;
      rowIdx++;
    }

    if (records.length === 0) {
      doc.fillColor('#94a3b8').fontSize(10).font('Helvetica')
        .text('No attendance records found for the selected period.', 50, y + 10, { align: 'center', width: doc.page.width - 100 });
    }

    // ── FOOTER ──
    const footerY = doc.page.height - 40;
    doc.rect(0, footerY - 5, doc.page.width, 45).fill('#f1f5f9');
    doc.fillColor('#64748b').fontSize(8).font('Helvetica')
      .text('Halqa Management System — Confidential Student Report', 50, footerY, { align: 'center', width: doc.page.width - 100 });
    doc.text(`Page 1 | ${new Date().toLocaleDateString()}`, 50, footerY + 12, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  } catch (error) { next(error); }
}

module.exports = {
  getStudentSummary,
  getStudentHistory,
  getStudentCalendar,
  exportCSV,
  exportExcel,
  exportPDF,
  getStudentTrend
};

async function getStudentTrend(req, res, next) {
  try {
    const { studentId } = req.params;
    const { weeks = 8 } = req.query;

    const weeksAgo = new Date();
    weeksAgo.setDate(weeksAgo.getDate() - parseInt(weeks) * 7);

    // Use raw query for week grouping
    const trend = await prisma.$queryRaw`
      SELECT
        YEARWEEK(date, 1) AS weekKey,
        MIN(date) AS weekStart,
        COUNT(*) AS totalDays,
        SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS presentDays,
        SUM(CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END) AS absentDays,
        SUM(CASE WHEN status = 'LATE' THEN 1 ELSE 0 END) AS lateDays,
        ROUND(
          (SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) +
           SUM(CASE WHEN status = 'LATE' THEN 0.5 ELSE 0 END))
          / COUNT(*) * 100
        , 0) AS weeklyRate
      FROM attendance
      WHERE studentId = ${studentId}
        AND date >= ${weeksAgo}
      GROUP BY YEARWEEK(date, 1)
      ORDER BY weekKey ASC
    `;

    // Monthly trend
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthly = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(date, '%Y-%m') AS month,
        COUNT(*) AS totalDays,
        SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS presentDays,
        ROUND(
          (SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) +
           SUM(CASE WHEN status = 'LATE' THEN 0.5 ELSE 0 END))
          / COUNT(*) * 100
        , 0) AS monthlyRate
      FROM attendance
      WHERE studentId = ${studentId}
        AND date >= ${sixMonthsAgo}
      GROUP BY DATE_FORMAT(date, '%Y-%m')
      ORDER BY month ASC
    `;

    return successResponse(res, {
      weekly: trend.map(w => ({
        week: w.weekKey,
        weekStart: w.weekStart,
        total: Number(w.totalDays),
        present: Number(w.presentDays),
        absent: Number(w.absentDays),
        late: Number(w.lateDays),
        rate: Number(w.weeklyRate)
      })),
      monthly: monthly.map(m => ({
        month: m.month,
        total: Number(m.totalDays),
        present: Number(m.presentDays),
        rate: Number(m.monthlyRate)
      }))
    }, 'Attendance trend');
  } catch (error) { next(error); }
}
