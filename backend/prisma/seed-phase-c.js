// Phase C Seed Data
// This file seeds the new Phase C database features
// Run with: npx prisma db seed --file prisma/seed-phase-c.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Phase C seed data...');

  // ─── GROUP CHAT SEED DATA ─────────────────────────────────────────────────────
  console.log('📝 Seeding Group Chat data...');
  
  // Get existing users and schools
  const schools = await prisma.school.findMany({ take: 2 });
  const users = await prisma.user.findMany({ take: 5 });
  
  if (schools.length > 0 && users.length > 0) {
    const school = schools[0];
    const user1 = users[0];
    const user2 = users[1];
    const user3 = users[2];

    // Create a group conversation
    const groupConv = await prisma.groupConversation.create({
      data: {
        schoolId: school.id,
        name: 'Grade 5A Parents',
        description: 'Communication group for Grade 5A parents',
        privacy: 'SCHOOL_ONLY',
        maxMembers: 50,
        createdBy: user1.id,
        memberCount: 3,
        members: {
          create: [
            { userId: user1.id, role: 'OWNER' },
            { userId: user2.id, role: 'MEMBER' },
            { userId: user3.id, role: 'MEMBER' },
          ]
        }
      }
    });

    // Add some messages
    await prisma.groupMessage.createMany({
      data: [
        {
          conversationId: groupConv.id,
          senderId: user1.id,
          type: 'TEXT',
          body: 'Welcome to the Grade 5A parents group!',
        },
        {
          conversationId: groupConv.id,
          senderId: user2.id,
          type: 'TEXT',
          body: 'Thank you for creating this group.',
        },
      ]
    });

    console.log('✅ Group Chat data seeded');
  }

  // ─── MARKETPLACE SEED DATA ─────────────────────────────────────────────────────
  console.log('📝 Seeding Marketplace data...');
  
  if (users.length > 0) {
    const seller = users[0];
    const buyer = users[1];

    // Create products
    const product1 = await prisma.product.create({
      data: {
        schoolId: schools[0]?.id,
        sellerId: seller.id,
        title: 'Quran - Arabic Text with Translation',
        description: 'Used but in good condition. Arabic text with English translation.',
        category: 'BOOKS',
        condition: 'GOOD',
        price: 15.00,
        negotiable: true,
        stock: 1,
        images: ['https://example.com/quran.jpg'],
      }
    });

    const product2 = await prisma.product.create({
      data: {
        schoolId: schools[0]?.id,
        sellerId: seller.id,
        title: 'School Uniform - Size M',
        description: 'Brand new school uniform, never worn.',
        category: 'UNIFORMS',
        condition: 'NEW',
        price: 25.00,
        negotiable: false,
        stock: 2,
        images: ['https://example.com/uniform.jpg'],
      }
    });

    // Create an order
    const order = await prisma.order.create({
      data: {
        schoolId: schools[0]?.id,
        productId: product1.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        quantity: 1,
        totalPrice: 15.00,
        status: 'CONFIRMED',
        shippingAddress: { street: '123 Main St', city: 'Springfield', zip: '12345' },
        confirmedAt: new Date(),
      }
    });

    // Create a review
    await prisma.review.create({
      data: {
        productId: product1.id,
        orderId: order.id,
        reviewerId: buyer.id,
        sellerId: seller.id,
        rating: 5,
        title: 'Great condition!',
        body: 'The Quran was exactly as described. Very happy with the purchase.',
        isVerified: true,
      }
    });

    console.log('✅ Marketplace data seeded');
  }

  // ─── TRANSPORT SEED DATA ───────────────────────────────────────────────────────
  console.log('📝 Seeding Transport data...');
  
  if (schools.length > 0 && users.length > 0) {
    const school = schools[0];
    const driverUser = users[0];
    const student = await prisma.student.findFirst();

    // Create a driver
    const driver = await prisma.driver.create({
      data: {
        schoolId: school.id,
        userId: driverUser.id,
        firstName: 'Ahmed',
        lastName: 'Mohammed',
        phone: '+1234567890',
        licenseNumber: 'DL-12345678',
        licenseExpiry: new Date('2025-12-31'),
        status: 'ACTIVE',
        hiredAt: new Date('2023-01-15'),
      }
    });

    // Create a school bus
    const bus = await prisma.schoolBus.create({
      data: {
        schoolId: school.id,
        plateNumber: 'ABC-1234',
        busNumber: 'BUS-01',
        capacity: 40,
        make: 'Ford',
        model: 'Transit',
        year: 2020,
        color: 'Yellow',
        fuelType: 'DIESEL',
        status: 'ACTIVE',
      }
    });

    // Create a bus route
    const route = await prisma.busRoute.create({
      data: {
        schoolId: school.id,
        busId: bus.id,
        name: 'Route 1 - North Side',
        description: 'Morning and afternoon route for north side students',
        routeNumber: 'R-001',
        startTime: '07:30',
        endTime: '16:30',
        distanceKm: 15.5,
        durationMin: 45,
        isActive: true,
      }
    });

    // Create bus stops
    await prisma.busStop.createMany({
      data: [
        {
          routeId: route.id,
          name: 'Main Street Station',
          address: '123 Main Street',
          latitude: 40.7128,
          longitude: -74.0060,
          sequence: 1,
          estimatedTime: '07:30',
        },
        {
          routeId: route.id,
          name: 'Oak Park',
          address: '456 Oak Avenue',
          latitude: 40.7138,
          longitude: -74.0070,
          sequence: 2,
          estimatedTime: '07:40',
        },
      ]
    });

    // Create a bus assignment
    if (student) {
      await prisma.busAssignment.create({
        data: {
          schoolId: school.id,
          busId: bus.id,
          routeId: route.id,
          stopId: (await prisma.busStop.findFirst({ where: { routeId: route.id } }))?.id,
          driverId: driver.id,
          studentId: student.id,
          pickupTime: '07:35',
          dropoffTime: '16:15',
          isMorning: true,
          isAfternoon: true,
          isActive: true,
        }
      });
    }

    console.log('✅ Transport data seeded');
  }

  // ─── ANALYTICS SEED DATA ────────────────────────────────────────────────────────
  console.log('📝 Seeding Analytics data...');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Daily school stats
  if (schools.length > 0) {
    await prisma.dailySchoolStats.create({
      data: {
        schoolId: schools[0].id,
        date: today,
        studentCount: 150,
        teacherCount: 20,
        classCount: 10,
        attendanceRate: 95.5,
        averageGrade: 85.2,
        behaviorScore: 4.5,
        totalPosts: 25,
        totalMessages: 150,
        totalGifts: 10,
        totalCoins: 5000,
      }
    });
  }

  // Daily user stats
  if (users.length > 0) {
    await prisma.dailyUserStats.create({
      data: {
        userId: users[0].id,
        date: today,
        loginCount: 3,
        postsCreated: 2,
        commentsCreated: 5,
        likesGiven: 10,
        likesReceived: 8,
        messagesSent: 15,
        voiceMinutes: 30,
        giftsSent: 2,
        giftsReceived: 5,
        coinsSpent: 100,
        coinsEarned: 50,
      }
    });
  }

  console.log('✅ Analytics data seeded');

  // ─── LEADERBOARD SEED DATA ───────────────────────────────────────────────────────
  console.log('📝 Seeding Leaderboard data...');
  
  if (users.length > 0) {
    await prisma.globalLeaderboard.create({
      data: {
        userId: users[0].id,
        totalCoins: 10000,
        totalDiamonds: 500,
        totalGifts: 100,
        totalPosts: 50,
        totalFollowers: 25,
        rank: 1,
        previousRank: 2,
        period: 'ALL_TIME',
      }
    });

    if (schools.length > 0) {
      await prisma.schoolLeaderboard.create({
        data: {
          schoolId: schools[0].id,
          userId: users[0].id,
          totalCoins: 5000,
          totalDiamonds: 250,
          totalGifts: 50,
          totalPosts: 25,
          rank: 1,
          previousRank: 1,
          period: 'ALL_TIME',
        }
      });
    }
  }

  console.log('✅ Leaderboard data seeded');

  // ─── SEARCH INDEX SEED DATA ────────────────────────────────────────────────────────
  console.log('📝 Seeding Search Index data...');
  
  if (users.length > 0 && schools.length > 0) {
    await prisma.searchIndex.create({
      data: {
        entityType: 'user',
        entityId: users[0].id,
        title: `${users[0].firstName} ${users[0].lastName}`,
        content: users[0].bio,
        tags: ['teacher', 'quran', 'arabic'],
        schoolId: schools[0].id,
        userId: users[0].id,
        popularity: 5.0,
      }
    });
  }

  // Trending hashtags
  await prisma.trendingHashtag.createMany({
    data: [
      { hashtag: '#quran', count: 100, rank: 1, period: 'HOURLY' },
      { hashtag: '#islamic', count: 85, rank: 2, period: 'HOURLY' },
      { hashtag: '#education', count: 70, rank: 3, period: 'HOURLY' },
    ]
  });

  console.log('✅ Search Index data seeded');

  // ─── BACKUP METADATA SEED DATA ───────────────────────────────────────────────────
  console.log('📝 Seeding Backup Metadata data...');
  
  await prisma.backupMetadata.create({
    data: {
      backupType: 'FULL',
      backupMethod: 'AUTOMATED',
      fileName: 'halqa_backup_20240722_000000.sql.gz',
      fileSize: BigInt(52428800), // 50MB
      filePath: '/backups/halqa_backup_20240722_000000.sql.gz',
      checksum: 'a1b2c3d4e5f6',
      status: 'COMPLETED',
      startedAt: new Date('2024-07-22T00:00:00Z'),
      completedAt: new Date('2024-07-22T00:05:00Z'),
      retentionDays: 30,
      createdBy: 'system',
    }
  });

  console.log('✅ Backup Metadata data seeded');

  console.log('🎉 Phase C seed data completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding Phase C data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
