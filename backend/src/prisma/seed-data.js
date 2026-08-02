/**
 * Seed additional demo data for all modules
 * Run: node src/prisma/seed-data.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding additional demo data...');

  // Get existing records
  const school = await prisma.school.findFirst({ where: { slug: 'halqa-academy' } });
  const admin = await prisma.user.findFirst({ where: { email: 'admin@halqa-academy.com' } });
  const teacher = await prisma.teacher.findFirst({ where: { school: { slug: 'halqa-academy' } } });
  const teacherUser = await prisma.user.findFirst({ where: { email: 'teacher@halqa-academy.com' } });
  const students = await prisma.student.findMany({ where: { schoolId: school.id }, include: { user: true } });
  const guardian = await prisma.guardian.findFirst({ where: { schoolId: school.id } });
  const guardianUser = await prisma.user.findFirst({ where: { email: 'parent@halqa.com' } });
  const studentUser = await prisma.user.findFirst({ where: { email: 'student1@halqa.com' } });

  if (!school || !admin || !teacher) {
    console.error('❌ Base seed data missing. Run seed.js first.');
    return;
  }

  // ─── SECOND CLASS ─────────────────────────────────────────────────────────
  const class2 = await prisma.class.upsert({
    where: { id: 'class-arabic-1' },
    update: {},
    create: {
      id: 'class-arabic-1',
      schoolId: school.id,
      name: 'Arabic Language Level 1',
      description: 'Beginner Arabic reading and writing',
      gradeLevel: '1',
      room: 'Room B',
      capacity: 15
    }
  });

  await prisma.teacherClass.upsert({
    where: { teacherId_classId: { teacherId: teacher.id, classId: class2.id } },
    update: {},
    create: { teacherId: teacher.id, classId: class2.id, isLead: true, subject: 'Arabic' }
  });

  // Enroll students in second class
  for (const student of students.slice(0, 2)) {
    await prisma.enrollment.upsert({
      where: { studentId_classId: { studentId: student.id, classId: class2.id } },
      update: {},
      create: { studentId: student.id, classId: class2.id }
    });
  }
  console.log('✅ Second class created: Arabic Language Level 1');

  // ─── CALENDAR EVENTS ──────────────────────────────────────────────────────
  const events = [
    { title: 'Quran Memorization Exam', type: 'EXAM', startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), color: '#ef4444' },
    { title: 'Parent-Teacher Meeting', type: 'MEETING', startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), color: '#8b5cf6' },
    { title: 'Eid Holiday', type: 'HOLIDAY', startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), allDay: true, color: '#10b981' },
    { title: 'Arabic Assignment Due', type: 'ASSIGNMENT', startDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), color: '#3b82f6' },
    { title: 'Juz 30 Recitation Test', type: 'EXAM', startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), color: '#ef4444' },
    { title: 'School Sports Day', type: 'ACTIVITY', startDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), allDay: true, color: '#f97316' },
    { title: 'Quran Class', type: 'CLASS', startDate: new Date(), color: '#1e40af' },
    { title: 'Arabic Class', type: 'CLASS', startDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), color: '#1e40af' },
  ];

  for (const evt of events) {
    await prisma.calendarEvent.create({
      data: {
        schoolId: school.id,
        createdBy: admin.id,
        title: evt.title,
        type: evt.type,
        startDate: evt.startDate,
        allDay: evt.allDay || false,
        color: evt.color,
        isPublic: true
      }
    });
  }
  console.log(`✅ ${events.length} calendar events created`);

  // ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────
  const announcements = [
    {
      title: '📢 Welcome Back to the New Term!',
      content: 'Assalamu Alaikum dear students and parents. We are excited to welcome everyone back for the new academic term. Please ensure all students arrive on time and bring their materials.',
      isPinned: true,
      targetRoles: ['STUDENT', 'GUARDIAN', 'TEACHER']
    },
    {
      title: '📅 Upcoming Quran Memorization Exam',
      content: 'Dear students, please be reminded that the Juz 30 memorization exam is scheduled for next week. Students should be prepared to recite from Surah An-Naba to Surah An-Nas.',
      isPinned: false,
      targetRoles: ['STUDENT', 'GUARDIAN']
    },
    {
      title: '👨‍👩‍👧 Parent-Teacher Meeting Notice',
      content: 'We invite all parents and guardians to attend our quarterly parent-teacher meeting. This is an excellent opportunity to discuss your child\'s progress and address any concerns.',
      isPinned: false,
      targetRoles: ['GUARDIAN']
    },
    {
      title: '📚 New Arabic Textbooks Available',
      content: 'New Arabic language textbooks are now available for collection from the school office. Please bring your student ID when collecting.',
      isPinned: false,
      targetRoles: ['STUDENT', 'TEACHER']
    },
    {
      title: '🏫 School Timings Reminder',
      content: 'School starts at 8:00 AM and ends at 3:00 PM. Late arrivals after 8:15 AM will be marked as late. Please ensure punctuality.',
      isPinned: false,
      targetRoles: ['STUDENT', 'GUARDIAN', 'TEACHER']
    }
  ];

  for (const ann of announcements) {
    await prisma.announcement.create({
      data: {
        schoolId: school.id,
        authorId: admin.id,
        title: ann.title,
        content: ann.content,
        isPinned: ann.isPinned,
        targetRoles: ann.targetRoles
      }
    });
  }
  console.log(`✅ ${announcements.length} announcements created`);

  // ─── MESSAGES ─────────────────────────────────────────────────────────────
  // Admin → Teacher
  const msg1 = await prisma.message.create({
    data: {
      senderId: admin.id,
      subject: 'Class Schedule Update',
      body: 'Assalamu Alaikum Ustaaz Ibrahim,\n\nPlease note that the Quran class schedule has been updated. The Friday session will now start at 9:00 AM instead of 8:30 AM.\n\nJazakAllah Khair,\nAhmad Al-Rashid',
      schoolId: school.id,
      recipients: { create: [{ recipientId: teacherUser.id }] }
    }
  });

  // Teacher → Student
  const msg2 = await prisma.message.create({
    data: {
      senderId: teacherUser.id,
      subject: 'Excellent Progress!',
      body: 'Assalamu Alaikum Abdullah,\n\nI wanted to let you know that your Quran memorization has been excellent this week. Keep up the great work! Your recitation of Surah Al-Mulk was particularly impressive.\n\nMay Allah bless your efforts.',
      schoolId: school.id,
      recipients: { create: [{ recipientId: studentUser.id }] }
    }
  });

  // Teacher → Guardian
  const msg3 = await prisma.message.create({
    data: {
      senderId: teacherUser.id,
      subject: 'Student Progress Report',
      body: 'Assalamu Alaikum,\n\nI am pleased to inform you that Abdullah has been making excellent progress in his Quran memorization. He has successfully memorized Juz 30 and is now working on Juz 29.\n\nPlease encourage him to continue his daily revision at home.',
      schoolId: school.id,
      recipients: { create: [{ recipientId: guardianUser.id }] }
    }
  });

  // Admin → All teachers (announcement-style)
  const msg4 = await prisma.message.create({
    data: {
      senderId: admin.id,
      subject: 'Staff Meeting - This Friday',
      body: 'Dear Teachers,\n\nThis is a reminder that we have a staff meeting this Friday at 2:00 PM in the conference room. Attendance is mandatory. Please prepare a brief update on your class progress.\n\nJazakAllah Khair.',
      schoolId: school.id,
      isAnnouncement: true,
      recipients: { create: [{ recipientId: teacherUser.id }] }
    }
  });

  console.log('✅ 4 messages created');

  // ─── NOTIFICATIONS ────────────────────────────────────────────────────────
  const notifData = [
    { userId: studentUser.id, type: 'GRADE', title: 'New Grade Posted', body: 'Your Midterm Exam grade has been posted: B+ (88%)' },
    { userId: studentUser.id, type: 'ANNOUNCEMENT', title: '📢 Welcome Back!', body: 'New term announcement from school admin' },
    { userId: guardianUser.id, type: 'ATTENDANCE', title: 'Attendance Alert', body: 'Abdullah was marked as Present today' },
    { userId: guardianUser.id, type: 'GRADE', title: 'Grade Update', body: 'Abdullah received a new grade: Quiz - 90%' },
    { userId: teacherUser.id, type: 'MESSAGE', title: 'New Message', body: 'You have a new message from Ahmad Al-Rashid' },
    { userId: admin.id, type: 'SYSTEM', title: 'System Update', body: 'Halqa Management System has been updated to v1.0.0' },
  ];

  for (const notif of notifData) {
    await prisma.notification.create({
      data: {
        userId: notif.userId,
        schoolId: school.id,
        type: notif.type,
        title: notif.title,
        body: notif.body,
        isRead: false
      }
    });
  }
  console.log(`✅ ${notifData.length} notifications created`);

  // ─── MORE GRADES ──────────────────────────────────────────────────────────
  const student1 = students[0];
  const student2 = students[1];
  const student3 = students[2];

  const gradeData = [
    { studentId: student1.id, title: 'Surah Al-Fatiha Recitation', type: 'ORAL_TEST', score: 95, maxScore: 100 },
    { studentId: student1.id, title: 'Tajweed Rules Quiz', type: 'QUIZ', score: 88, maxScore: 100 },
    { studentId: student1.id, title: 'Juz 30 Memorization', type: 'MEMORIZATION', score: 92, maxScore: 100 },
    { studentId: student2.id, title: 'Surah Al-Fatiha Recitation', type: 'ORAL_TEST', score: 78, maxScore: 100 },
    { studentId: student2.id, title: 'Tajweed Rules Quiz', type: 'QUIZ', score: 82, maxScore: 100 },
    { studentId: student2.id, title: 'Juz 30 Memorization', type: 'MEMORIZATION', score: 75, maxScore: 100 },
    { studentId: student3.id, title: 'Surah Al-Fatiha Recitation', type: 'ORAL_TEST', score: 90, maxScore: 100 },
    { studentId: student3.id, title: 'Tajweed Rules Quiz', type: 'QUIZ', score: 95, maxScore: 100 },
    { studentId: student3.id, title: 'Juz 30 Memorization', type: 'MEMORIZATION', score: 98, maxScore: 100 },
  ];

  for (const g of gradeData) {
    const pct = (g.score / g.maxScore) * 100;
    const letter = pct >= 97 ? 'A+' : pct >= 93 ? 'A' : pct >= 90 ? 'A-' : pct >= 87 ? 'B+' : pct >= 83 ? 'B' : pct >= 80 ? 'B-' : pct >= 77 ? 'C+' : pct >= 73 ? 'C' : pct >= 70 ? 'C-' : pct >= 60 ? 'D' : 'F';
    await prisma.grade.create({
      data: {
        studentId: g.studentId,
        classId: 'class-quran-1',
        teacherId: teacher.id,
        title: g.title,
        type: g.type,
        score: g.score,
        maxScore: g.maxScore,
        percentage: pct,
        letterGrade: letter
      }
    });
  }
  console.log(`✅ ${gradeData.length} grades created`);

  // ─── MORE BEHAVIOR LOGS ───────────────────────────────────────────────────
  const behaviorData = [
    { studentId: student1.id, type: 'POSITIVE', category: 'Quran Memorization', points: 10, description: 'Memorized 5 new ayahs today' },
    { studentId: student1.id, type: 'POSITIVE', category: 'Participation', points: 5, description: 'Actively participated in class discussion' },
    { studentId: student2.id, type: 'NEGATIVE', category: 'Punctuality', points: -3, description: 'Arrived 10 minutes late without excuse' },
    { studentId: student2.id, type: 'POSITIVE', category: 'Effort', points: 7, description: 'Showed great improvement in recitation' },
    { studentId: student3.id, type: 'POSITIVE', category: 'Leadership', points: 8, description: 'Led the class in morning Quran recitation' },
    { studentId: student3.id, type: 'POSITIVE', category: 'Respect', points: 5, description: 'Excellent manners and respect for teachers' },
  ];

  for (const b of behaviorData) {
    await prisma.behaviorLog.create({
      data: {
        studentId: b.studentId,
        teacherId: teacher.id,
        type: b.type,
        category: b.category,
        points: b.type === 'NEGATIVE' ? -Math.abs(b.points) : Math.abs(b.points),
        description: b.description,
        date: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
      }
    });
  }
  console.log(`✅ ${behaviorData.length} behavior logs created`);

  // ─── ATTENDANCE FOR PAST WEEK ─────────────────────────────────────────────
  const statuses = ['PRESENT', 'PRESENT', 'PRESENT', 'LATE', 'ABSENT'];
  for (let i = 1; i <= 5; i++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    date.setUTCHours(0, 0, 0, 0);

    for (const student of students) {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      try {
        await prisma.attendance.upsert({
          where: { classId_studentId_date: { classId: 'class-quran-1', studentId: student.id, date } },
          update: { status },
          create: {
            classId: 'class-quran-1',
            studentId: student.id,
            date,
            status,
            checkInMethod: 'manual',
            teacherId: teacher.id,
            schoolId: school.id
          }
        });
      } catch {}
    }
  }
  console.log('✅ Attendance records for past 5 days created');

  // ─── NOTES ────────────────────────────────────────────────────────────────
  const notes = [
    { title: 'Class Objectives - Quran Level 1', content: 'Students should complete memorization of Juz 30 by end of term. Focus on proper Tajweed rules especially Madd and Ghunna.', isPrivate: false },
    { title: 'Student Progress Notes', content: 'Abdullah Hassan - Excellent progress. Fatima Ali - Needs more practice with Makharij. Omar Khalid - Outstanding memorization skills.', isPrivate: true },
    { title: 'Lesson Plan - Week 3', content: 'Monday: Surah Al-Ghashiyah review\nTuesday: New memorization - Surah Al-Ala\nWednesday: Tajweed rules - Idgham\nThursday: Recitation practice\nFriday: Weekly test', isPrivate: false },
  ];

  for (const note of notes) {
    await prisma.note.create({
      data: {
        userId: teacherUser.id,
        classId: 'class-quran-1',
        title: note.title,
        content: note.content,
        isPrivate: note.isPrivate
      }
    });
  }
  console.log(`✅ ${notes.length} notes created`);

  // ─── TERMS ────────────────────────────────────────────────────────────────
  await prisma.term.upsert({
    where: { id: 'term-2025-spring' },
    update: {},
    create: {
      id: 'term-2025-spring',
      schoolId: school.id,
      name: 'Spring 2025',
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-05-31'),
      isActive: false,
      isCurrent: false
    }
  });

  await prisma.term.upsert({
    where: { id: 'term-2025-fall' },
    update: {},
    create: {
      id: 'term-2025-fall',
      schoolId: school.id,
      name: 'Fall 2025',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-12-31'),
      isActive: false,
      isCurrent: false
    }
  });
  console.log('✅ 2 additional terms created');

  console.log('\n🎉 All demo data seeded successfully!');
  console.log('\n📊 Data Summary:');
  console.log('  Classes: 2 (Quran Level 1, Arabic Language Level 1)');
  console.log('  Students: 3 (enrolled in classes)');
  console.log('  Calendar Events: 8');
  console.log('  Announcements: 5');
  console.log('  Messages: 4');
  console.log('  Notifications: 6');
  console.log('  Grades: 11');
  console.log('  Behavior Logs: 8');
  console.log('  Attendance: 5 days × 3 students');
  console.log('  Notes: 3');
  console.log('  Terms: 3 total');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
