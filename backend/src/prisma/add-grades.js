require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const school = await prisma.school.findFirst({ where: { slug: 'halqa-academy' } });
  if (!school) { console.error('School not found'); return; }
  
  const teacher = await prisma.teacher.findFirst({ where: { schoolId: school.id } });
  const students = await prisma.student.findMany({ where: { schoolId: school.id } });

  const gradeItems = [
    { title: 'Surah Al-Baqarah Recitation', type: 'ORAL_TEST', scores: [88, 72, 95, 80, 91] },
    { title: 'Arabic Grammar Test', type: 'QUIZ', scores: [75, 68, 82, 90, 77] },
    { title: 'Islamic History Essay', type: 'ASSIGNMENT', scores: [92, 85, 78, 88, 94] },
    { title: 'Tajweed Rules Exam', type: 'EXAM', scores: [85, 70, 90, 83, 88] },
    { title: 'Quran Memorization - Juz 29', type: 'MEMORIZATION', scores: [96, 80, 98, 75, 92] },
  ];

  let added = 0;
  for (const item of gradeItems) {
    for (let i = 0; i < students.length; i++) {
      const score = item.scores[i % item.scores.length];
      const pct = score;
      const letter = pct >= 97 ? 'A+' : pct >= 93 ? 'A' : pct >= 90 ? 'A-' : pct >= 87 ? 'B+' : pct >= 83 ? 'B' : pct >= 80 ? 'B-' : pct >= 77 ? 'C+' : pct >= 73 ? 'C' : pct >= 70 ? 'C-' : pct >= 60 ? 'D' : 'F';
      try {
        await prisma.grade.create({
          data: {
            studentId: students[i].id,
            classId: 'class-quran-1',
            teacherId: teacher?.id,
            title: item.title,
            type: item.type,
            score,
            maxScore: 100,
            percentage: pct,
            letterGrade: letter
          }
        });
        added++;
      } catch {}
    }
  }
  console.log(`✅ Added ${added} grades`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
