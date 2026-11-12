/**
 * SEC01-G-BE02-A: Live Class Microphone Authorization Trigger Integration Tests
 *
 * Tests MySQL triggers for SESSION-BOUND ROLLOUT migration policy.
 * Requires real MySQL database (destructive test classification).
 *
 * IMPORTANT: These tests use the trusted MySQL runner infrastructure
 * and require explicit authorization to run against a disposable test database.
 */

const { PrismaClient } = require("@prisma/client");

describe("SEC01-G-BE02-A: Microphone Authorization Triggers (MySQL Integration)", () => {
  let prisma;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Trigger 1: Prevent protected-to-legacy downgrade", () => {
    test("should block SFU_AUTHORITATIVE → LEGACY downgrade", async () => {
      // Create a protected class
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Protected Class",
          livekitRoomName: `test-protected-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "SFU_AUTHORITATIVE",
        },
      });

      // Attempt downgrade should fail
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { microphoneAuthorizationMode: "LEGACY" },
        }),
      ).rejects.toThrow(/Cannot downgrade from SFU_AUTHORITATIVE to LEGACY/);

      // Cleanup
      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow LEGACY → LEGACY (no-op)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Legacy Class",
          livekitRoomName: `test-legacy-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // No-op update should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { microphoneAuthorizationMode: "LEGACY" },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });
  });

  describe("Trigger 2: Prevent silent active-session upgrade", () => {
    test("should allow SCHEDULED LEGACY → SFU_AUTHORITATIVE (operator migration)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Scheduled Legacy",
          livekitRoomName: `test-sched-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // SCHEDULED → protected should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { microphoneAuthorizationMode: "SFU_AUTHORITATIVE" },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should block LIVE LEGACY → SFU_AUTHORITATIVE (silent active upgrade)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Live Legacy",
          livekitRoomName: `test-live-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "LIVE",
          startedAt: new Date(),
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // LIVE → protected should fail
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { microphoneAuthorizationMode: "SFU_AUTHORITATIVE" },
        }),
      ).rejects.toThrow(/Cannot upgrade active LIVE session/);

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow ENDED LEGACY → SFU_AUTHORITATIVE (post-session upgrade)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Ended Legacy",
          livekitRoomName: `test-ended-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "ENDED",
          startedAt: new Date(Date.now() - 3600000),
          endedAt: new Date(),
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // ENDED → protected should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { microphoneAuthorizationMode: "SFU_AUTHORITATIVE" },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });
  });

  describe("Trigger 3: Prevent legacy session from starting", () => {
    test("should block SCHEDULED LEGACY → LIVE (status transition)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Scheduled Legacy",
          livekitRoomName: `test-start-block-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // Starting legacy session should fail
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { status: "LIVE", startedAt: new Date() },
        }),
      ).rejects.toThrow(/Cannot start LEGACY session/);

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow SCHEDULED SFU_AUTHORITATIVE → LIVE", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Scheduled Protected",
          livekitRoomName: `test-start-allow-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "SFU_AUTHORITATIVE",
        },
      });

      // Starting protected session should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { status: "LIVE", startedAt: new Date() },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow updates to existing LIVE LEGACY sessions (no status transition)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Live Legacy",
          livekitRoomName: `test-live-update-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "LIVE",
          startedAt: new Date(),
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // Updating title (not status) should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { title: "Updated Live Legacy" },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow LIVE LEGACY → ENDED (ending session)", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Live Legacy",
          livekitRoomName: `test-end-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "LIVE",
          startedAt: new Date(),
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "LEGACY",
        },
      });

      // Ending legacy session should succeed
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { status: "ENDED", endedAt: new Date() },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });
  });

  describe("Runtime Protection: LEGACY classes cannot go LIVE", () => {
    test("should allow LEGACY class creation (for migration compatibility)", async () => {
      // LEGACY default is permissible - application layer enforces protection
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Legacy Class",
          livekitRoomName: `test-legacy-create-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          // microphoneAuthorizationMode defaults to LEGACY
        },
      });

      expect(liveClass.microphoneAuthorizationMode).toBe("LEGACY");

      // But cannot start
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { status: "LIVE", startedAt: new Date() },
        }),
      ).rejects.toThrow(/Cannot start LEGACY session/);

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });

    test("should allow explicit SFU_AUTHORITATIVE class creation", async () => {
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Protected Class",
          livekitRoomName: `test-protected-create-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "SFU_AUTHORITATIVE",
        },
      });

      expect(liveClass.microphoneAuthorizationMode).toBe("SFU_AUTHORITATIVE");

      // And can start
      await expect(
        prisma.liveClass.update({
          where: { id: liveClass.id },
          data: { status: "LIVE", startedAt: new Date() },
        }),
      ).resolves.toBeDefined();

      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });
  });

  describe("Migration Safety: Existing Data Preservation", () => {
    test("should preserve existing participant data", async () => {
      // Create a class with participant
      const liveClass = await prisma.liveClass.create({
        data: {
          title: "Data Preservation Test",
          livekitRoomName: `test-preserve-${Date.now()}`,
          maxParticipants: 50,
          streamType: "CLASS",
          status: "SCHEDULED",
          schoolId: (await prisma.school.findFirst()).id,
          hostUserId: (
            await prisma.user.findFirst({ where: { role: "TEACHER" } })
          ).id,
          microphoneAuthorizationMode: "SFU_AUTHORITATIVE",
        },
      });

      const student = await prisma.user.findFirst({
        where: { role: "STUDENT" },
      });
      const participant = await prisma.liveClassParticipant.create({
        data: {
          liveClassId: liveClass.id,
          userId: student.id,
          role: "STUDENT",
        },
      });

      // Verify new microphone fields have correct defaults
      expect(participant.microphoneIntent).toBe("UNKNOWN");
      expect(participant.microphoneModeratorRevoked).toBe(false);
      expect(participant.microphoneAuthorizationVersion).toBe(BigInt(0));
      expect(participant.microphoneSfuVersion).toBe(BigInt(0));
      expect(participant.microphoneSfuState).toBe("UNKNOWN");

      // Cleanup
      await prisma.liveClassParticipant.delete({
        where: { id: participant.id },
      });
      await prisma.liveClass.delete({ where: { id: liveClass.id } });
    });
  });
});
