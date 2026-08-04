'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TEST_SLUGS = [
  'test-school-group-chat', 'test-school-assignment', 'test-school-exam',
  'test-school-marketplace', 'test-school-transport', 'test-school-analytics',
  'test-school-leaderboard', 'test-school-search',
];
const TEST_EMAILS = [
  'user1@test.com', 'user2@test.com', 'student@test.com', 'teacher@test.com',
  'student2@test.com', 'teacher2@test.com', 'seller@test.com', 'buyer@test.com',
  'driver@test.com', 'student3@test.com', 'user4@test.com', 'user5@test.com', 'user6@test.com',
];

async function cleanup() {
  console.log('Cleaning up leftover test data...');
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  try {
    await prisma.groupMessageRead.deleteMany();
    await prisma.groupMessageReaction.deleteMany();
    await prisma.groupMessage.deleteMany();
    await prisma.groupMember.deleteMany();
    await prisma.groupConversation.deleteMany();
    await prisma.assignmentSubmission.deleteMany();
    await prisma.examSubmission.deleteMany();
    await prisma.review.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.busAssignment.deleteMany();
    await prisma.busStop.deleteMany();
    await prisma.busRoute.deleteMany();
    await prisma.schoolBus.deleteMany({ where: { plateNumber: 'TEST-123' } });
    await prisma.driver.deleteMany();
    await prisma.dailyUserStats.deleteMany();
    await prisma.dailySchoolStats.deleteMany();
    await prisma.schoolLeaderboard.deleteMany();
    await prisma.globalLeaderboard.deleteMany();
    await prisma.trendingHashtag.deleteMany();
    await prisma.searchIndex.deleteMany();
    await prisma.backupMetadata.deleteMany({ where: { checksum: 'abc123test' } });
    await prisma.grade.deleteMany({ where: { title: { in: ['Test Assignment', 'Test Exam'] } } });
    await prisma.student.deleteMany({ where: { studentId: { in: ['STU001', 'STU002', 'STU003'] } } });
    await prisma.teacher.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: TEST_EMAILS } } });
    await prisma.school.deleteMany({ where: { slug: { in: TEST_SLUGS } } });
    console.log('Cleanup complete.');
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    await prisma.$disconnect();
  }
}

cleanup().catch(e => { console.error('Cleanup failed:', e.message); process.exit(1); });
