const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Halqa Management System...');

  // Create school
  const school = await prisma.school.upsert({
    where: { slug: 'halqa-academy' },
    update: {},
    create: {
      name: 'Halqa Academy',
      slug: 'halqa-academy',
      type: 'academy',
      address: '123 Knowledge Street',
      city: 'New York',
      state: 'NY',
      country: 'US',
      phone: '+1-555-0100',
      email: 'info@halqa-academy.com',
      timezone: 'America/New_York',
      settings: {
        create: {
          workingDays: [1, 2, 3, 4, 5],
          schoolStartTime: '08:00',
          schoolEndTime: '15:00',
          allowSelfCheckIn: true,
          parentNotifications: true,
          emailEnabled: true
        }
      }
    }
  });

  console.log(`✅ School created: ${school.name}`);

  // Create Super Admin
  const superAdminHash = await bcrypt.hash('Admin@2024', 12);
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@halqa.com' },
    update: {},
    create: {
      email: 'superadmin@halqa.com',
      passwordHash: superAdminHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  // Create School Admin
  const adminHash = await bcrypt.hash('Admin@2024', 12);
  const schoolAdmin = await prisma.user.upsert({
    where: { email: 'admin@halqa-academy.com' },
    update: {},
    create: {
      email: 'admin@halqa-academy.com',
      passwordHash: adminHash,
      firstName: 'Ahmad',
      lastName: 'Al-Rashid',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  // School Admin membership
  await prisma.schoolMembership.upsert({
    where: { userId_schoolId: { userId: schoolAdmin.id, schoolId: school.id } },
    update: { role: 'SCHOOL_ADMIN', status: 'ACTIVE', deletedAt: null },
    create: { userId: schoolAdmin.id, schoolId: school.id, role: 'SCHOOL_ADMIN', status: 'ACTIVE', joinedAt: new Date() }
  });

  // Create Teacher
  const teacherHash = await bcrypt.hash('Teacher@2024', 12);
  const teacherUser = await prisma.user.upsert({
    where: { email: 'teacher@halqa-academy.com' },
    update: {},
    create: {
      email: 'teacher@halqa-academy.com',
      passwordHash: teacherHash,
      firstName: 'Ustaaz',
      lastName: 'Ibrahim',
      role: 'TEACHER',
      schoolId: school.id,
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  const teacher = await prisma.teacher.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: {
      userId: teacherUser.id,
      schoolId: school.id,
      employeeId: 'TCH-001',
      department: 'Quran Studies',
      specialization: 'Tajweed & Memorization'
    }
  });

  // Teacher membership
  await prisma.schoolMembership.upsert({
    where: { userId_schoolId: { userId: teacherUser.id, schoolId: school.id } },
    update: { role: 'TEACHER', status: 'ACTIVE', deletedAt: null },
    create: { userId: teacherUser.id, schoolId: school.id, role: 'TEACHER', status: 'ACTIVE', joinedAt: new Date() }
  });

  // Create Term
  const term = await prisma.term.upsert({
    where: { id: 'term-2024-fall' },
    update: {},
    create: {
      id: 'term-2024-fall',
      schoolId: school.id,
      name: 'Fall 2024',
      startDate: new Date('2024-09-01'),
      endDate: new Date('2024-12-31'),
      isActive: true,
      isCurrent: true
    }
  });

  // Create Classes
  const class1 = await prisma.class.upsert({
    where: { id: 'class-quran-1' },
    update: {},
    create: {
      id: 'class-quran-1',
      schoolId: school.id,
      termId: term.id,
      name: 'Quran Level 1',
      description: 'Beginner Quran memorization class',
      gradeLevel: '1',
      room: 'Room A',
      capacity: 20
    }
  });

  // Assign teacher to class
  await prisma.teacherClass.upsert({
    where: { teacherId_classId: { teacherId: teacher.id, classId: class1.id } },
    update: {},
    create: { teacherId: teacher.id, classId: class1.id, isLead: true, subject: 'Quran' }
  });

  // Create Students
  const studentData = [
    { email: 'student1@halqa.com', firstName: 'Abdullah', lastName: 'Hassan', studentId: 'STU-001', gradeLevel: 'Level 1' },
    { email: 'student2@halqa.com', firstName: 'Fatima', lastName: 'Ali', studentId: 'STU-002', gradeLevel: 'Level 2' },
    { email: 'student3@halqa.com', firstName: 'Omar', lastName: 'Khalid', studentId: 'STU-003', gradeLevel: 'Level 1' }
  ];

  for (const sd of studentData) {
    const hash = await bcrypt.hash('Student@2024', 12);
    const existing = await prisma.user.findUnique({ where: { email: sd.email } });
    if (!existing) {
      const sUser = await prisma.user.create({
        data: {
          email: sd.email,
          passwordHash: hash,
          firstName: sd.firstName,
          lastName: sd.lastName,
          role: 'STUDENT',
          schoolId: school.id,
          status: 'ACTIVE',
          emailVerified: true
        }
      });

      // gradeLevel column may not exist in all DB states (migration gap).
      // Probe the information schema first, then insert accordingly.
      const colCheck = await prisma.$queryRaw`
        SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'students'
          AND COLUMN_NAME  = 'gradeLevel'
      `;
      const hasGradeLevel = Number(colCheck[0].cnt) > 0;
      const studentId = uuidv4();
      const qrCode = `QR-${uuidv4().split('-')[0].toUpperCase()}`;
      if (hasGradeLevel) {
        await prisma.$executeRaw`INSERT INTO students (id, userId, schoolId, studentId, gradeLevel, qrCode, enrollmentDate, createdAt, updatedAt, deletedAt)
          VALUES (${studentId}, ${sUser.id}, ${school.id}, ${sd.studentId}, ${sd.gradeLevel || null}, ${qrCode}, ${new Date()}, ${new Date()}, ${new Date()}, ${null})`;
      } else {
        await prisma.$executeRaw`INSERT INTO students (id, userId, schoolId, studentId, qrCode, enrollmentDate, createdAt, updatedAt, deletedAt)
          VALUES (${studentId}, ${sUser.id}, ${school.id}, ${sd.studentId}, ${qrCode}, ${new Date()}, ${new Date()}, ${new Date()}, ${null})`;
      }
      const student = { id: studentId, userId: sUser.id, schoolId: school.id, studentId: sd.studentId, qrCode };

      await prisma.enrollment.create({
        data: { studentId: student.id, classId: class1.id }
      });

      // Student membership — required for Education access in new architecture
      await prisma.schoolMembership.upsert({
        where: { userId_schoolId: { userId: sUser.id, schoolId: school.id } },
        update: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null },
        create: { userId: sUser.id, schoolId: school.id, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() }
      });
    } else {
      // Ensure existing student users also have a SchoolMembership record
      await prisma.schoolMembership.upsert({
        where: { userId_schoolId: { userId: existing.id, schoolId: school.id } },
        update: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null },
        create: { userId: existing.id, schoolId: school.id, role: 'STUDENT', status: 'ACTIVE', joinedAt: new Date() }
      });
    }
  }

  // Create Guardian
  const guardianHash = await bcrypt.hash('Guardian@2024', 12);
  const guardianUser = await prisma.user.upsert({
    where: { email: 'parent@halqa.com' },
    update: {},
    create: {
      email: 'parent@halqa.com',
      passwordHash: guardianHash,
      firstName: 'Hassan',
      lastName: 'Abdullah',
      role: 'GUARDIAN',
      schoolId: school.id,
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  await prisma.guardian.upsert({
    where: { userId: guardianUser.id },
    update: {},
    create: {
      userId: guardianUser.id,
      schoolId: school.id,
      relationship: 'parent'
    }
  });

  // Guardian membership — required for Education access in new architecture
  await prisma.schoolMembership.upsert({
    where: { userId_schoolId: { userId: guardianUser.id, schoolId: school.id } },
    update: { role: 'GUARDIAN', status: 'ACTIVE', deletedAt: null },
    create: { userId: guardianUser.id, schoolId: school.id, role: 'GUARDIAN', status: 'ACTIVE', joinedAt: new Date() }
  });

  // Link guardian to first student (Abdullah Hassan)
  const firstStudent = await prisma.student.findFirst({
    where: { schoolId: school.id, studentId: 'STU-001' },
    select: { id: true }
  });
  if (firstStudent) {
    await prisma.guardianStudent.upsert({
      where: { guardianId_studentId: { guardianId: (await prisma.guardian.findFirst({ where: { userId: guardianUser.id } })).id, studentId: firstStudent.id } },
      update: {},
      create: {
        guardianId: (await prisma.guardian.findFirst({ where: { userId: guardianUser.id } })).id,
        studentId: firstStudent.id,
        isPrimary: true
      }
    }).catch(() => {}); // non-fatal if already linked
  }

  console.log('✅ Seed data created successfully!');
  console.log('\n📋 Test Credentials:');
  console.log('Super Admin: superadmin@halqa.com / Admin@2024');
  console.log('School Admin: admin@halqa-academy.com / Admin@2024');
  console.log('Teacher: teacher@halqa-academy.com / Teacher@2024');
  console.log('Student: student1@halqa.com / Student@2024');
  console.log('Guardian: parent@halqa.com / Guardian@2024');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
