require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updates = [
    { studentId: 'STU-001', gradeLevel: 'Level 1' },
    { studentId: 'STU-002', gradeLevel: 'Level 2' },
    { studentId: 'STU-003', gradeLevel: 'Level 1' },
  ];

  for (const u of updates) {
    const s = await prisma.student.findFirst({ where: { studentId: u.studentId } });
    if (s) {
      await prisma.student.update({ where: { id: s.id }, data: { gradeLevel: u.gradeLevel } });
      console.log('Updated: ' + u.studentId + ' -> ' + u.gradeLevel);
    }
  }

  const students = await prisma.student.findMany({ select: { studentId: true, gradeLevel: true } });
  console.log('\nAll students:');
  students.forEach(s => console.log('  ' + s.studentId + ': ' + (s.gradeLevel || 'null')));
}

main().catch(console.error).finally(() => prisma.$disconnect());
