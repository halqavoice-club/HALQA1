// Phase C Database Model Tests
// Tests for new Phase C features: Group Chat, Assignment/Exam Submissions, Marketplace, Transport, Analytics
//
// Fix log:
//   - DATABASE_URL was being overridden by jest.setup.js — fixed there to not override when set by caller
//   - afterAll FK violations fixed: use SET FOREIGN_KEY_CHECKS=0/1 around teardown in MySQL
//   - product.price is returned as string by MySQL DECIMAL — use Number() in assertion

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/** Disable FK checks, run cleanup fn, re-enable FK checks */
async function withFkDisabled(fn) {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  try { await fn(); } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Group Chat Models', () => {
  let testSchool, testUser1, testUser2, testGroup;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-group-chat', type: 'school' }
    });
    testUser1 = await prisma.user.create({
      data: {
        email: 'user1@test.com', passwordHash: 'hash', role: 'TEACHER',
        firstName: 'User', lastName: 'One', schoolId: testSchool.id,
      }
    });
    testUser2 = await prisma.user.create({
      data: {
        email: 'user2@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'User', lastName: 'Two', schoolId: testSchool.id,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.groupMessageRead.deleteMany();
      await prisma.groupMessageReaction.deleteMany();
      await prisma.groupMessage.deleteMany();
      await prisma.groupMember.deleteMany();
      await prisma.groupConversation.deleteMany();
      await prisma.user.deleteMany({ where: { email: { in: ['user1@test.com', 'user2@test.com'] } } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-group-chat' } });
    });
  });

  test('should create a group conversation', async () => {
    testGroup = await prisma.groupConversation.create({
      data: {
        schoolId: testSchool.id,
        name: 'Test Group',
        privacy: 'PRIVATE',
        maxMembers: 10,
        createdBy: testUser1.id,
        memberCount: 1,
        members: { create: { userId: testUser1.id, role: 'OWNER' } }
      }
    });
    expect(testGroup).toHaveProperty('id');
    expect(testGroup.name).toBe('Test Group');
    expect(testGroup.privacy).toBe('PRIVATE');
  });

  test('should add members to group', async () => {
    const member = await prisma.groupMember.create({
      data: { conversationId: testGroup.id, userId: testUser2.id, role: 'MEMBER' }
    });
    expect(member).toHaveProperty('id');
    expect(member.role).toBe('MEMBER');
    await prisma.groupConversation.update({
      where: { id: testGroup.id }, data: { memberCount: 2 }
    });
  });

  test('should create group messages', async () => {
    const message = await prisma.groupMessage.create({
      data: { conversationId: testGroup.id, senderId: testUser1.id, type: 'TEXT', body: 'Hello group!' }
    });
    expect(message).toHaveProperty('id');
    expect(message.body).toBe('Hello group!');
    expect(message.type).toBe('TEXT');
  });

  test('should add message reactions', async () => {
    const message = await prisma.groupMessage.findFirst({ where: { conversationId: testGroup.id } });
    const reaction = await prisma.groupMessageReaction.create({
      data: { messageId: message.id, userId: testUser2.id, type: 'LIKE' }
    });
    expect(reaction).toHaveProperty('id');
    expect(reaction.type).toBe('LIKE');
  });

  test('should track message reads', async () => {
    const message = await prisma.groupMessage.findFirst({ where: { conversationId: testGroup.id } });
    const read = await prisma.groupMessageRead.create({
      data: { messageId: message.id, userId: testUser2.id }
    });
    expect(read).toHaveProperty('id');
    expect(read.userId).toBe(testUser2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Assignment Submission Models', () => {
  let testSchool, testClass, testStudent, testTeacher, testGrade, testSubmission;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-assignment', type: 'school' }
    });
    testClass = await prisma.class.create({
      data: { schoolId: testSchool.id, name: 'Test Class' }
    });
    const userStudent = await prisma.user.create({
      data: {
        email: 'student@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'Student', lastName: 'Test', schoolId: testSchool.id,
      }
    });
    testStudent = await prisma.student.create({
      data: { userId: userStudent.id, schoolId: testSchool.id, studentId: 'STU001' }
    });
    const userTeacher = await prisma.user.create({
      data: {
        email: 'teacher@test.com', passwordHash: 'hash', role: 'TEACHER',
        firstName: 'Teacher', lastName: 'Test', schoolId: testSchool.id,
      }
    });
    testTeacher = await prisma.teacher.create({
      data: { userId: userTeacher.id, schoolId: testSchool.id }
    });
    testGrade = await prisma.grade.create({
      data: {
        studentId: testStudent.id, classId: testClass.id, teacherId: testTeacher.id,
        title: 'Test Assignment', type: 'ASSIGNMENT', score: 0, maxScore: 100,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.assignmentSubmission.deleteMany();
      await prisma.grade.deleteMany({ where: { title: 'Test Assignment' } });
      await prisma.student.deleteMany({ where: { studentId: 'STU001' } });
      await prisma.teacher.deleteMany();
      await prisma.user.deleteMany({ where: { email: { in: ['student@test.com', 'teacher@test.com'] } } });
      const school = await prisma.school.findUnique({ where: { slug: 'test-school-assignment' } });
      if (school) await prisma.class.deleteMany({ where: { schoolId: school.id } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-assignment' } });
    });
  });

  test('should create assignment submission', async () => {
    testSubmission = await prisma.assignmentSubmission.create({
      data: {
        schoolId: testSchool.id, classId: testClass.id, gradeId: testGrade.id,
        studentId: testStudent.id, teacherId: testTeacher.id,
        title: 'My Assignment', description: 'Assignment description',
        attachments: ['file1.pdf', 'file2.pdf'], status: 'DRAFT',
      }
    });
    expect(testSubmission).toHaveProperty('id');
    expect(testSubmission.status).toBe('DRAFT');
    expect(testSubmission.attachments).toHaveLength(2);
  });

  test('should update submission status to submitted', async () => {
    const updated = await prisma.assignmentSubmission.update({
      where: { id: testSubmission.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() }
    });
    expect(updated.status).toBe('SUBMITTED');
    expect(updated.submittedAt).not.toBeNull();
  });

  test('should grade submission', async () => {
    const graded = await prisma.assignmentSubmission.update({
      where: { id: testSubmission.id },
      data: { status: 'GRADED', score: 85, maxScore: 100, percentage: 85, feedback: 'Good work!', gradedAt: new Date() }
    });
    expect(graded.status).toBe('GRADED');
    expect(Number(graded.score)).toBe(85);
    expect(Number(graded.percentage)).toBe(85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Exam Submission Models', () => {
  let testSchool, testClass, testStudent, testTeacher, testGrade, testExamSubmission;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-exam', type: 'school' }
    });
    testClass = await prisma.class.create({
      data: { schoolId: testSchool.id, name: 'Test Class' }
    });
    const userStudent = await prisma.user.create({
      data: {
        email: 'student2@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'Student', lastName: 'Two', schoolId: testSchool.id,
      }
    });
    testStudent = await prisma.student.create({
      data: { userId: userStudent.id, schoolId: testSchool.id, studentId: 'STU002' }
    });
    const userTeacher = await prisma.user.create({
      data: {
        email: 'teacher2@test.com', passwordHash: 'hash', role: 'TEACHER',
        firstName: 'Teacher', lastName: 'Two', schoolId: testSchool.id,
      }
    });
    testTeacher = await prisma.teacher.create({
      data: { userId: userTeacher.id, schoolId: testSchool.id }
    });
    testGrade = await prisma.grade.create({
      data: {
        studentId: testStudent.id, classId: testClass.id, teacherId: testTeacher.id,
        title: 'Test Exam', type: 'EXAM', score: 0, maxScore: 100,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.examSubmission.deleteMany();
      await prisma.grade.deleteMany({ where: { title: 'Test Exam' } });
      await prisma.student.deleteMany({ where: { studentId: 'STU002' } });
      await prisma.teacher.deleteMany();
      await prisma.user.deleteMany({ where: { email: { in: ['student2@test.com', 'teacher2@test.com'] } } });
      const school = await prisma.school.findUnique({ where: { slug: 'test-school-exam' } });
      if (school) await prisma.class.deleteMany({ where: { schoolId: school.id } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-exam' } });
    });
  });

  test('should create exam submission with structured answers', async () => {
    testExamSubmission = await prisma.examSubmission.create({
      data: {
        schoolId: testSchool.id, classId: testClass.id, gradeId: testGrade.id,
        studentId: testStudent.id, teacherId: testTeacher.id,
        title: 'Midterm Exam',
        answers: { q1: 'A', q2: 'B', q3: 'Essay answer here...' },
        status: 'SUBMITTED', submittedAt: new Date(),
      }
    });
    expect(testExamSubmission).toHaveProperty('id');
    expect(testExamSubmission.answers).toHaveProperty('q1');
    expect(testExamSubmission.status).toBe('SUBMITTED');
  });

  test('should auto-grade exam', async () => {
    const autoGraded = await prisma.examSubmission.update({
      where: { id: testExamSubmission.id },
      data: { autoGraded: true, score: 90, maxScore: 100, percentage: 90, gradedAt: new Date() }
    });
    expect(autoGraded.autoGraded).toBe(true);
    expect(Number(autoGraded.score)).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Marketplace Models', () => {
  let testSchool, testSeller, testBuyer, testProduct, testOrder, testReview;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-marketplace', type: 'school' }
    });
    testSeller = await prisma.user.create({
      data: {
        email: 'seller@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'Seller', lastName: 'Test', schoolId: testSchool.id,
      }
    });
    testBuyer = await prisma.user.create({
      data: {
        email: 'buyer@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'Buyer', lastName: 'Test', schoolId: testSchool.id,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.review.deleteMany();
      await prisma.order.deleteMany();
      await prisma.product.deleteMany();
      await prisma.user.deleteMany({ where: { email: { in: ['seller@test.com', 'buyer@test.com'] } } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-marketplace' } });
    });
  });

  test('should create product listing', async () => {
    testProduct = await prisma.product.create({
      data: {
        schoolId: testSchool.id, sellerId: testSeller.id,
        title: 'Used Textbook', description: 'Good condition',
        category: 'BOOKS', condition: 'GOOD', price: 20.00, stock: 1, images: ['book.jpg'],
      }
    });
    expect(testProduct).toHaveProperty('id');
    expect(testProduct.title).toBe('Used Textbook');
    // MySQL DECIMAL is returned as string — coerce to number for comparison
    expect(Number(testProduct.price)).toBe(20.00);
  });

  test('should create order', async () => {
    testOrder = await prisma.order.create({
      data: {
        schoolId: testSchool.id, productId: testProduct.id,
        buyerId: testBuyer.id, sellerId: testSeller.id,
        quantity: 1, totalPrice: 20.00, status: 'PENDING',
        shippingAddress: { street: '123 Test St', city: 'Test City' },
      }
    });
    expect(testOrder).toHaveProperty('id');
    expect(testOrder.status).toBe('PENDING');
  });

  test('should create verified review', async () => {
    testReview = await prisma.review.create({
      data: {
        productId: testProduct.id, orderId: testOrder.id,
        reviewerId: testBuyer.id, sellerId: testSeller.id,
        rating: 5, title: 'Great product!', body: 'Exactly as described.', isVerified: true,
      }
    });
    expect(testReview).toHaveProperty('id');
    expect(testReview.rating).toBe(5);
    expect(testReview.isVerified).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Transport Models', () => {
  let testSchool, testDriver, testBus, testRoute, testStop, testStudent, testAssignment;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-transport', type: 'school' }
    });
    const driverUser = await prisma.user.create({
      data: {
        email: 'driver@test.com', passwordHash: 'hash', role: 'TEACHER',
        firstName: 'Driver', lastName: 'Test', schoolId: testSchool.id,
      }
    });
    testDriver = await prisma.driver.create({
      data: {
        schoolId: testSchool.id, userId: driverUser.id,
        firstName: 'Driver', lastName: 'Test',
        phone: '+1234567890', licenseNumber: 'DL-12345', status: 'ACTIVE',
      }
    });
    testBus = await prisma.schoolBus.create({
      data: { schoolId: testSchool.id, plateNumber: 'TEST-123', busNumber: 'BUS-TEST', capacity: 30, status: 'ACTIVE' }
    });
    testRoute = await prisma.busRoute.create({
      data: { schoolId: testSchool.id, busId: testBus.id, name: 'Test Route', startTime: '08:00', endTime: '16:00', isActive: true }
    });
    testStop = await prisma.busStop.create({
      data: { routeId: testRoute.id, name: 'Test Stop', address: '123 Test St', sequence: 1, estimatedTime: '08:00' }
    });
    const userStudent = await prisma.user.create({
      data: {
        email: 'student3@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'Student', lastName: 'Three', schoolId: testSchool.id,
      }
    });
    testStudent = await prisma.student.create({
      data: { userId: userStudent.id, schoolId: testSchool.id, studentId: 'STU003' }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.busAssignment.deleteMany();
      await prisma.busStop.deleteMany();
      await prisma.busRoute.deleteMany();
      await prisma.schoolBus.deleteMany({ where: { plateNumber: 'TEST-123' } });
      await prisma.driver.deleteMany();
      await prisma.student.deleteMany({ where: { studentId: 'STU003' } });
      await prisma.user.deleteMany({ where: { email: { in: ['driver@test.com', 'student3@test.com'] } } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-transport' } });
    });
  });

  test('should create bus assignment', async () => {
    testAssignment = await prisma.busAssignment.create({
      data: {
        schoolId: testSchool.id, busId: testBus.id, routeId: testRoute.id,
        stopId: testStop.id, driverId: testDriver.id, studentId: testStudent.id,
        pickupTime: '08:00', dropoffTime: '16:00',
        isMorning: true, isAfternoon: true, isActive: true,
      }
    });
    expect(testAssignment).toHaveProperty('id');
    expect(testAssignment.isActive).toBe(true);
    expect(testAssignment.pickupTime).toBe('08:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Analytics Models', () => {
  let testSchool, testUser, testSchoolStats, testUserStats;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-analytics', type: 'school' }
    });
    testUser = await prisma.user.create({
      data: {
        email: 'user4@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'User', lastName: 'Four', schoolId: testSchool.id,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.dailyUserStats.deleteMany();
      await prisma.dailySchoolStats.deleteMany();
      await prisma.user.deleteMany({ where: { email: 'user4@test.com' } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-analytics' } });
    });
  });

  test('should create daily school stats', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    testSchoolStats = await prisma.dailySchoolStats.create({
      data: {
        schoolId: testSchool.id, date: today,
        studentCount: 100, teacherCount: 10, classCount: 5,
        attendanceRate: 95.0, averageGrade: 85.5,
      }
    });
    expect(testSchoolStats).toHaveProperty('id');
    expect(testSchoolStats.studentCount).toBe(100);
  });

  test('should create daily user stats', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    testUserStats = await prisma.dailyUserStats.create({
      data: {
        userId: testUser.id, date: today,
        loginCount: 5, postsCreated: 2, commentsCreated: 10, likesGiven: 20,
      }
    });
    expect(testUserStats).toHaveProperty('id');
    expect(testUserStats.loginCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Leaderboard Models', () => {
  let testSchool, testUser, testGlobalLeaderboard, testSchoolLeaderboard;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-leaderboard', type: 'school' }
    });
    testUser = await prisma.user.create({
      data: {
        email: 'user5@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'User', lastName: 'Five', schoolId: testSchool.id,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.schoolLeaderboard.deleteMany();
      await prisma.globalLeaderboard.deleteMany();
      await prisma.user.deleteMany({ where: { email: 'user5@test.com' } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-leaderboard' } });
    });
  });

  test('should create global leaderboard entry', async () => {
    testGlobalLeaderboard = await prisma.globalLeaderboard.create({
      data: {
        userId: testUser.id, totalCoins: 5000, totalDiamonds: 250, totalGifts: 50,
        totalPosts: 25, totalFollowers: 10, rank: 1, period: 'ALL_TIME',
      }
    });
    expect(testGlobalLeaderboard).toHaveProperty('id');
    expect(testGlobalLeaderboard.rank).toBe(1);
  });

  test('should create school leaderboard entry', async () => {
    testSchoolLeaderboard = await prisma.schoolLeaderboard.create({
      data: {
        schoolId: testSchool.id, userId: testUser.id,
        totalCoins: 2500, totalDiamonds: 125, totalGifts: 25, totalPosts: 12,
        rank: 1, period: 'ALL_TIME',
      }
    });
    expect(testSchoolLeaderboard).toHaveProperty('id');
    expect(testSchoolLeaderboard.rank).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Search Optimization Models', () => {
  let testSchool, testUser, testSearchIndex, testTrendingHashtag;

  beforeAll(async () => {
    testSchool = await prisma.school.create({
      data: { name: 'Test School', slug: 'test-school-search', type: 'school' }
    });
    testUser = await prisma.user.create({
      data: {
        email: 'user6@test.com', passwordHash: 'hash', role: 'STUDENT',
        firstName: 'User', lastName: 'Six', schoolId: testSchool.id,
      }
    });
  });

  afterAll(async () => {
    await withFkDisabled(async () => {
      await prisma.trendingHashtag.deleteMany();
      await prisma.searchIndex.deleteMany();
      await prisma.user.deleteMany({ where: { email: 'user6@test.com' } });
      await prisma.school.deleteMany({ where: { slug: 'test-school-search' } });
    });
  });

  test('should create search index entry', async () => {
    testSearchIndex = await prisma.searchIndex.create({
      data: {
        entityType: 'user', entityId: testUser.id,
        title: `${testUser.firstName} ${testUser.lastName}`,
        content: 'Test bio content', tags: ['student', 'test'],
        schoolId: testSchool.id, userId: testUser.id, popularity: 5.0,
      }
    });
    expect(testSearchIndex).toHaveProperty('id');
    expect(testSearchIndex.entityType).toBe('user');
  });

  test('should create trending hashtag', async () => {
    testTrendingHashtag = await prisma.trendingHashtag.create({
      data: { hashtag: '#test', count: 100, rank: 1, period: 'HOURLY' }
    });
    expect(testTrendingHashtag).toHaveProperty('id');
    expect(testTrendingHashtag.hashtag).toBe('#test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase C - Backup Metadata Model', () => {
  let testBackupMetadata;

  afterAll(async () => {
    await withFkDisabled(async () => {
      if (testBackupMetadata) {
        await prisma.backupMetadata.delete({ where: { id: testBackupMetadata.id } });
      }
    });
  });

  test('should create backup metadata', async () => {
    testBackupMetadata = await prisma.backupMetadata.create({
      data: {
        backupType: 'FULL', backupMethod: 'AUTOMATED',
        fileName: 'backup-test.sql.gz',
        fileSize: BigInt(1048576),
        filePath: '/backups/backup-test.sql.gz',
        checksum: 'abc123test', status: 'COMPLETED',
        startedAt: new Date(), completedAt: new Date(),
        retentionDays: 30,
      }
    });
    expect(testBackupMetadata).toHaveProperty('id');
    expect(testBackupMetadata.status).toBe('COMPLETED');
    expect(testBackupMetadata.fileSize).toBe(BigInt(1048576));
  });
});
