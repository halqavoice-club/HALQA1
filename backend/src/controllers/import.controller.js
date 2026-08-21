const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Import students from Excel/CSV
 * Expected columns: firstName, lastName, email, studentId, phone, dateOfBirth, gender, classId
 */
async function importStudents(req, res, next) {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    const schoolId = (req.schoolId || req.user.schoolId);
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return errorResponse(res, 'File is empty', 400);
    if (rows.length > 1000) return errorResponse(res, 'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.', 400);

    const results = { created: 0, skipped: 0, errors: [] };
    const defaultPassword = await bcrypt.hash('Halqa@2024', 12);

    for (const row of rows) {
      try {
        const email = String(row.email || '').trim().toLowerCase();
        const studentId = String(row.studentId || row['Student ID'] || '').trim();
        const firstName = String(row.firstName || row['First Name'] || '').trim();
        const lastName = String(row.lastName || row['Last Name'] || '').trim();

        if (!email || !studentId || !firstName || !lastName) {
          results.errors.push(`Row skipped: missing required fields (${email || 'no email'})`);
          results.skipped++;
          continue;
        }

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.errors.push(`${email}: invalid email format`);
          results.skipped++;
          continue;
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          results.errors.push(`${email}: already exists`);
          results.skipped++;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              firstName,
              lastName,
              phone: String(row.phone || '').trim() || null,
              dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : null,
              gender: String(row.gender || '').trim().toLowerCase() || null,
              passwordHash: defaultPassword,
              role: 'STUDENT',
              schoolId,
              status: 'ACTIVE',
              emailVerified: true
            }
          });

          const student = await tx.student.create({
            data: {
              userId: user.id,
              schoolId,
              studentId,
              qrCode: `QR-${uuidv4().split('-')[0].toUpperCase()}`
            }
          });

          const classId = String(row.classId || row['Class ID'] || '').trim();
          if (classId) {
            const cls = await tx.class.findFirst({ where: { id: classId, schoolId } });
            if (cls) {
              await tx.enrollment.create({ data: { studentId: student.id, classId } });
            }
          }
          // GAP FIX: Create SchoolMembership so requireSchoolMember sets effectiveRole.
          await tx.schoolMembership.upsert({
            where: { userId_schoolId: { userId: user.id, schoolId } },
            create: { userId: user.id, schoolId, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() },
            update: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null }
          });
        });

        results.created++;
      } catch (err) {
        results.errors.push(`Row error: ${err.message}`);
        results.skipped++;
      }
    }

    return successResponse(res, results, `Import complete: ${results.created} created, ${results.skipped} skipped`);
  } catch (error) {
    next(error);
  }
}

/**
 * Export students to Excel
 */
async function exportStudents(req, res, next) {
  try {
    const schoolId = (req.schoolId || req.user.schoolId);
    const { classId } = req.query;

    const where = { schoolId, deletedAt: null };
    if (classId) where.enrollments = { some: { classId, isActive: true } };

    const students = await prisma.student.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true, dateOfBirth: true, gender: true, status: true } },
        enrollments: {
          where: { isActive: true },
          include: { class: { select: { name: true } } }
        }
      },
      orderBy: { user: { firstName: 'asc' } }
    });

    const data = students.map(s => ({
      'Student ID': s.studentId,
      'First Name': s.user.firstName,
      'Last Name': s.user.lastName,
      'Email': s.user.email,
      'Phone': s.user.phone || '',
      'Date of Birth': s.user.dateOfBirth ? s.user.dateOfBirth.toISOString().split('T')[0] : '',
      'Gender': s.user.gender || '',
      'Status': s.user.status,
      'Classes': s.enrollments.map(e => e.class.name).join(', '),
      'QR Code': s.qrCode || '',
      'Enrolled': s.enrollmentDate.toISOString().split('T')[0]
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 15) }));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=students-${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Download import template
 */
async function downloadTemplate(req, res, next) {
  try {
    const { type = 'students' } = req.params;

    const templates = {
      students: [{
        firstName: 'Ahmad', lastName: 'Hassan', email: 'ahmad@school.com',
        studentId: 'STU-001', phone: '+1 555 0100', dateOfBirth: '2010-01-15',
        gender: 'male', classId: '(optional class ID)'
      }],
      teachers: [{
        firstName: 'Ustaaz', lastName: 'Ibrahim', email: 'teacher@school.com',
        department: 'Quran Studies', specialization: 'Tajweed', employeeId: 'TCH-001'
      }],
      guardians: [{
        firstName: 'Hassan', lastName: 'Ahmed', email: 'parent@email.com',
        phone: '+1 555 0200', relationship: 'father', studentEmail: 'ahmad@school.com'
      }],
      classes: [{
        name: 'Grade 5 - Quran', gradeLevel: 'Grade 5', room: 'Room A',
        capacity: 30,
        description: '(optional)'
      }]
    };

    const data = templates[type] || templates.students;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-template.xlsx`);
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Import teachers from Excel/CSV
 */
async function importTeachers(req, res, next) {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);
    const schoolId = (req.schoolId || req.user.schoolId);
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return errorResponse(res, 'File is empty', 400);
    if (rows.length > 1000) return errorResponse(res, 'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.', 400);

    const results = { created: 0, skipped: 0, errors: [] };
    const defaultPassword = await bcrypt.hash('Halqa@2024', 12);

    for (const row of rows) {
      try {
        const email = String(row.email || '').trim().toLowerCase();
        const firstName = String(row.firstName || row['First Name'] || '').trim();
        const lastName = String(row.lastName || row['Last Name'] || '').trim();

        if (!email || !firstName || !lastName) {
          results.errors.push(`Row skipped: missing required fields (${email || 'no email'})`);
          results.skipped++;
          continue;
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) { results.errors.push(`${email}: already exists`); results.skipped++; continue; }

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email, firstName, lastName,
              phone: String(row.phone || '').trim() || null,
              passwordHash: defaultPassword,
              role: 'TEACHER', schoolId, status: 'ACTIVE', emailVerified: true
            }
          });
          await tx.teacher.create({
            data: {
              userId: user.id, schoolId,
              employeeId: String(row.employeeId || row['Employee ID'] || '').trim() || null,
              department: String(row.department || row['Department'] || '').trim() || null,
              specialization: String(row.specialization || row['Specialization'] || '').trim() || null
            }
          });
          // GAP FIX: Create SchoolMembership so requireSchoolMember sets effectiveRole.
          await tx.schoolMembership.upsert({
            where: { userId_schoolId: { userId: user.id, schoolId } },
            create: { userId: user.id, schoolId, role: 'TEACHER', status: 'ACTIVE', joinedAt: new Date() },
            update: { role: 'TEACHER', status: 'ACTIVE', deletedAt: null }
          });
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Row error: ${err.message}`);
        results.skipped++;
      }
    }

    return successResponse(res, results, `Import complete: ${results.created} created, ${results.skipped} skipped`);
  } catch (error) { next(error); }
}

/**
 * Export teachers to Excel
 */
async function exportTeachers(req, res, next) {
  try {
    const schoolId = (req.schoolId || req.user.schoolId);
    const teachers = await prisma.teacher.findMany({
      where: { schoolId, deletedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true, status: true } },
        teacherClasses: { include: { class: { select: { name: true } } } }
      },
      orderBy: { user: { firstName: 'asc' } }
    });

    const data = teachers.map(t => ({
      'Employee ID': t.employeeId || '',
      'First Name': t.user.firstName,
      'Last Name': t.user.lastName,
      'Email': t.user.email,
      'Phone': t.user.phone || '',
      'Department': t.department || '',
      'Specialization': t.specialization || '',
      'Status': t.user.status,
      'Classes': t.teacherClasses.map(tc => tc.class.name).join(', '),
      'Hire Date': t.hireDate ? new Date(t.hireDate).toISOString().split('T')[0] : ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Teachers');
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 15) }));
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=teachers-${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

/**
 * Export attendance to Excel
 */
async function exportAttendance(req, res, next) {
  try {
    const schoolId = (req.schoolId || req.user.schoolId);
    const { classId, startDate, endDate } = req.query;

    const where = { ...(schoolId && { schoolId }), ...(classId && { classId }) };
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const records = await prisma.attendance.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        class: { select: { name: true } }
      },
      orderBy: [{ date: 'asc' }, { student: { user: { firstName: 'asc' } } }]
    });

    const data = records.map(r => ({
      'Student Name': `${r.student.user.firstName} ${r.student.user.lastName}`,
      'Class': r.class.name,
      'Date': r.date.toISOString().split('T')[0],
      'Status': r.status,
      'Check In': r.checkInTime ? r.checkInTime.toISOString() : '',
      'Check Out': r.checkOutTime ? r.checkOutTime.toISOString() : '',
      'Method': r.checkInMethod || '',
      'Notes': r.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    if (data.length > 0) {
      ws['!cols'] = Object.keys(data[0]).map(k => ({ wch: Math.max(k.length + 2, 15) }));
    }
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance-${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

/**
 * Export grades to Excel
 */
async function exportGrades(req, res, next) {
  try {
    const { classId, termId } = req.query;
    const where = { deletedAt: null, ...(classId && { classId }), ...(termId && { termId }) };

    const grades = await prisma.grade.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        class: { select: { name: true } }
      },
      orderBy: [{ student: { user: { firstName: 'asc' } } }, { gradedAt: 'desc' }]
    });

    const data = grades.map(g => ({
      'Student': `${g.student.user.firstName} ${g.student.user.lastName}`,
      'Class': g.class.name,
      'Title': g.title,
      'Type': g.type,
      'Score': g.score,
      'Max Score': g.maxScore,
      'Percentage': g.percentage ? `${g.percentage.toFixed(1)}%` : '',
      'Letter Grade': g.letterGrade || '',
      'Feedback': g.feedback || '',
      'Date': g.gradedAt.toISOString().split('T')[0]
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Grades');
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 15) }));
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=grades-${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

/**
 * Export behavior logs to Excel
 */
async function exportBehavior(req, res, next) {
  try {
    const schoolId = (req.schoolId || req.user.schoolId);
    const { classId, startDate, endDate } = req.query;

    const where = { deletedAt: null };
    if (startDate && endDate) where.date = { gte: new Date(startDate), lte: new Date(endDate) };

    const logs = await prisma.behaviorLog.findMany({
      where,
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        teacher: { include: { user: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { date: 'desc' }
    });

    const data = logs.map(l => ({
      'Student': `${l.student.user.firstName} ${l.student.user.lastName}`,
      'Teacher': l.teacher ? `${l.teacher.user.firstName} ${l.teacher.user.lastName}` : 'Admin',
      'Type': l.type,
      'Category': l.category,
      'Points': l.points,
      'Description': l.description || '',
      'Date': l.date.toISOString().split('T')[0]
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Behavior');
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 15) }));
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=behavior-${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

module.exports = { importStudents, exportStudents, downloadTemplate, importTeachers, exportTeachers, exportAttendance, exportGrades, exportBehavior, importGuardians, importClasses };

/**
 * Import guardians from Excel/CSV
 * Required columns: firstName, lastName, email
 * Optional: phone, relationship, studentEmail
 */
async function importGuardians(req, res, next) {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);
    const schoolId = (req.schoolId || req.user.schoolId);
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0)   return errorResponse(res, 'File is empty', 400);
    if (rows.length > 1000)  return errorResponse(res, 'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.', 400);

    const results = { created: 0, skipped: 0, errors: [] };
    const defaultPassword = await bcrypt.hash('Halqa@2024', 12);

    for (const row of rows) {
      try {
        const email    = String(row.email    || '').trim().toLowerCase();
        const firstName= String(row.firstName|| row['First Name'] || '').trim();
        const lastName = String(row.lastName || row['Last Name']  || '').trim();
        const phone    = String(row.phone    || '').trim() || null;
        const relationship = String(row.relationship || 'guardian').trim().toLowerCase();

        if (!email || !firstName || !lastName) {
          results.errors.push(`Row skipped: missing required fields (${email || 'no email'})`);
          results.skipped++; continue;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.errors.push(`${email}: invalid email format`);
          results.skipped++; continue;
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) { results.errors.push(`${email}: already exists`); results.skipped++; continue; }

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { email, firstName, lastName, phone, passwordHash: defaultPassword,
              role: 'GUARDIAN', schoolId, status: 'ACTIVE', emailVerified: true }
          });
          const guardian = await tx.guardian.create({
            data: { userId: user.id, schoolId, relationship }
          });

          // Link to student by email if provided
          const studentEmail = String(row.studentEmail || row['Student Email'] || '').trim().toLowerCase();
          if (studentEmail) {
            const sUser = await tx.user.findUnique({ where: { email: studentEmail } });
            if (sUser) {
              const student = await tx.student.findFirst({ where: { userId: sUser.id } });
              if (student) {
                await tx.guardianStudent.upsert({
                  where: { guardianId_studentId: { guardianId: guardian.id, studentId: student.id } },
                  create: { guardianId: guardian.id, studentId: student.id, relationship, isPrimary: true },
                  update: {}
                });
              }
            }
          }
          // GAP FIX: Create SchoolMembership so requireSchoolMember sets effectiveRole.
          await tx.schoolMembership.upsert({
            where: { userId_schoolId: { userId: user.id, schoolId } },
            create: { userId: user.id, schoolId, role: 'GUARDIAN', status: 'ACTIVE', joinedAt: new Date() },
            update: { role: 'GUARDIAN', status: 'ACTIVE', deletedAt: null }
          });
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Row error: ${err.message}`);
        results.skipped++;
      }
    }
    return successResponse(res, results, `Import complete: ${results.created} created, ${results.skipped} skipped`);
  } catch (error) { next(error); }
}

/**
 * Import classes from Excel/CSV
 * Required: name, gradeLevel
 * Optional: room, capacity, description
 *
 * Note: academicYear was removed — the Class model has no such field.
 * Duplicate detection is now by name within the same school.
 */
async function importClasses(req, res, next) {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);
    const schoolId = (req.schoolId || req.user.schoolId);
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return errorResponse(res, 'File is empty', 400);
    if (rows.length > 1000) return errorResponse(res, 'Import exceeds the maximum of 1000 rows. Split into batches of 1000 or fewer.', 400);

    const results = { created: 0, skipped: 0, errors: [] };

    // Get current active term if any
    const activeTerm = await prisma.term.findFirst({
      where: { schoolId, isActive: true }
    });

    for (const row of rows) {
      try {
        const name        = String(row.name        || row['Name']        || '').trim();
        const gradeLevel  = String(row.gradeLevel  || row['Grade Level'] || '').trim();
        const room        = String(row.room        || row['Room']        || '').trim() || null;
        const capacity    = parseInt(row.capacity  || row['Capacity']    || 30) || 30;
        const description = String(row.description || row['Description'] || '').trim() || null;

        if (!name || !gradeLevel) {
          results.errors.push(`Row skipped: name and gradeLevel are required`);
          results.skipped++; continue;
        }

        // Check for duplicate class name within the same school
        const existing = await prisma.class.findFirst({
          where: { schoolId, name, deletedAt: null }
        });
        if (existing) {
          results.errors.push(`"${name}": class already exists in this school`);
          results.skipped++; continue;
        }

        // Only include fields that exist in the Class schema
        await prisma.class.create({
          data: {
            schoolId,
            name,
            gradeLevel,
            room,
            capacity,
            description,
            isActive: true,
            termId: activeTerm?.id || null
          }
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Row error: ${err.message}`);
        results.skipped++;
      }
    }
    return successResponse(res, results, `Import complete: ${results.created} created, ${results.skipped} skipped`);
  } catch (error) { next(error); }
}
