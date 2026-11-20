/**
 * INV-002: Integration test for autoPromote concurrent seat allocation
 *
 * Tests the retry loop against a real MySQL database with real concurrent
 * transactions racing for the same seat.
 *
 * REQUIRES: MySQL + Redis running
 * SAFE: Uses a dedicated test voice room, cleaned up after test
 */

const { autoPromoteNext } = require("../../utils/autoPromote");
const prisma = require("../../utils/prisma");
const { enqueue, clearQueue } = require("../../utils/voiceQueue");
const { v4: uuidv4 } = require("uuid");

// Skip if DATABASE_URL not set (CI without MySQL)
const canRun = !!(process.env.DATABASE_URL || process.env.DB_HOST);
const describeIfDB = canRun ? describe : describe.skip;

describeIfDB(
  "INV-002: autoPromote integration — concurrent seat allocation",
  () => {
    let testSchoolId;
    let testRoomId;
    let testHostId;
    let testUserIds = [];

    beforeAll(async () => {
      if (!canRun) return;

      try {
        await prisma.$connect();
      } catch (err) {
        console.warn("⚠️ Skipping integration test: MySQL unavailable");
        throw err;
      }

      // Create test school
      testSchoolId = uuidv4();
      await prisma.school.create({
        data: {
          id: testSchoolId,
          name: "INV-002 Test School",
          slug: `inv-002-test-${Date.now()}`,
          isActive: true,
        },
      });

      // Create test host
      testHostId = uuidv4();
      await prisma.user.create({
        data: {
          id: testHostId,
          schoolId: testSchoolId,
          email: `inv002-host-${Date.now()}@test.local`,
          passwordHash: "dummy",
          role: "TEACHER",
          status: "ACTIVE",
          firstName: "Test",
          lastName: "Host",
        },
      });

      // Create 5 test users
      for (let i = 1; i <= 5; i++) {
        const userId = uuidv4();
        testUserIds.push(userId);
        await prisma.user.create({
          data: {
            id: userId,
            schoolId: testSchoolId,
            email: `inv002-user${i}-${Date.now()}@test.local`,
            passwordHash: "dummy",
            role: "STUDENT",
            status: "ACTIVE",
            firstName: `User${i}`,
            lastName: "Test",
          },
        });
      }

      // Create test voice room (maxSpeakers=2: host in seat 1, one SPEAKER in seat 2 — room full)
      testRoomId = uuidv4();
      await prisma.voiceRoom.create({
        data: {
          id: testRoomId,
          schoolId: testSchoolId,
          title: "INV-002 Test Room",
          hostId: testHostId,
          status: "LIVE", // FIX: "ACTIVE" is not a valid VoiceRoomStatus; use "LIVE"
          maxSpeakers: 2,
          micLocked: false,
          allMuted: false,
          lockedSeats: [],
        },
      });

      // Add host as HOST (seat 1)
      await prisma.voiceParticipant.create({
        data: {
          userId: testHostId,
          roomId: testRoomId,
          role: "HOST",
          seatNumber: 1,
          isActive: true,
          isMuted: false,
          mutedByModerator: false,
          handRaised: false,
          wasKicked: false,
          joinedAt: new Date(),
        },
      });

      // Add first test user as SPEAKER (seat 2 — room is now FULL)
      await prisma.voiceParticipant.create({
        data: {
          userId: testUserIds[0],
          roomId: testRoomId,
          role: "SPEAKER",
          seatNumber: 2,
          isActive: true,
          isMuted: false,
          mutedByModerator: false,
          handRaised: false,
          wasKicked: false,
          joinedAt: new Date(),
        },
      });

      // Add remaining 4 users as AUDIENCE with handRaised=true (queued)
      for (let i = 1; i < 5; i++) {
        await prisma.voiceParticipant.create({
          data: {
            userId: testUserIds[i],
            roomId: testRoomId,
            role: "AUDIENCE",
            seatNumber: null,
            isActive: true,
            isMuted: false,
            mutedByModerator: false,
            handRaised: true,
            handRaisedAt: new Date(),
            wasKicked: false,
            joinedAt: new Date(),
          },
        });

        // Enqueue in Redis (if available)
        try {
          await enqueue(testRoomId, {
            id: testUserIds[i],
            firstName: `User${i + 1}`,
            lastName: "Test",
            avatarUrl: null,
          });
        } catch (err) {
          // Redis may not be available in test environment
          console.warn("Redis enqueue failed (non-fatal):", err.message);
        }
      }
    });

    afterAll(async () => {
      if (!canRun) return;

      // Clean up Redis queue
      try {
        await clearQueue(testRoomId);
      } catch (err) {
        // Non-fatal
      }

      // Clean up DB (delete in reverse dependency order)
      await prisma.voiceParticipant.deleteMany({
        where: { roomId: testRoomId },
      });
      await prisma.voiceRoom.delete({ where: { id: testRoomId } });
      await prisma.user.deleteMany({
        where: { id: { in: [...testUserIds, testHostId] } },
      });
      await prisma.school.delete({ where: { id: testSchoolId } });

      await prisma.$disconnect();
    });

    it("should handle concurrent autoPromoteNext calls and promote exactly 1 user", async () => {
      // FREE one seat: set existing SPEAKER (seat 2) to seatNumber=null
      await prisma.voiceParticipant.update({
        where: {
          roomId_userId: { roomId: testRoomId, userId: testUserIds[0] },
        },
        data: { seatNumber: null },
      });

      // Call autoPromoteNext 5 times concurrently (simulates 5 simultaneous speaker drops)
      const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(autoPromoteNext(testRoomId, io));
      }

      const results = await Promise.allSettled(promises);

      // Verify: exactly 1 promotion succeeded (maxSpeakers=2, host in seat 1, 1 free seat)
      const successfulPromotions = results.filter(
        (r) => r.status === "fulfilled" && r.value !== null,
      );
      expect(successfulPromotions.length).toBe(1);

      // Verify DB: exactly 2 participants with seatNumber (host + 1 promoted user)
      const onStage = await prisma.voiceParticipant.findMany({
        where: {
          roomId: testRoomId,
          isActive: true,
          seatNumber: { not: null },
        },
      });
      expect(onStage.length).toBe(2);
      expect(
        onStage.some((p) => p.userId === testHostId && p.seatNumber === 1),
      ).toBe(true); // host still in seat 1
      expect(onStage.some((p) => p.seatNumber === 2)).toBe(true); // one promoted user in seat 2

      // Verify: 4 users remain AUDIENCE (not promoted)
      const audienceCount = await prisma.voiceParticipant.count({
        where: {
          roomId: testRoomId,
          isActive: true,
          seatNumber: null,
        },
      });
      expect(audienceCount).toBe(4);

      // Verify: no exceptions were thrown
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures.length).toBe(0);
    });
  },
);
