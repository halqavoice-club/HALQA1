/**
 * SEC01-G-BE02-B: Unit tests for microphone authority service
 *
 * Tests the service layer that enforces microphone authorization modes
 * in live classes (LEGACY vs SFU_AUTHORITATIVE).
 */

const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const {
  AUTHORITY_MODES,
  getMicrophoneAuthority,
  getAuthoritySafe,
  canUseLiveKitAPI,
  canUseLiveKitAPISafe,
  enforceSFUMode,
  upgradeToSFU,
  isLegacyMode,
  isSFUMode,
  PROTECTED_RUNTIME_CAPABILITIES,
  getProtectedRuntimeReadiness,
  assertProtectedRuntimeReady,
} = require("../../services/liveclass-microphone-authority.service");

jest.mock("../../utils/prisma");
jest.mock("../../utils/logger");

describe("SEC01-G-BE02-B: Microphone Authority Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("protected runtime readiness", () => {
    it("fails closed while any required SFU authorization capability is incomplete", () => {
      expect(Object.values(PROTECTED_RUNTIME_CAPABILITIES)).toContain(false);
      expect(getProtectedRuntimeReadiness()).toEqual({
        ready: false,
        missingCapabilities: expect.arrayContaining([
          "microphoneSpecificPermissionResolver",
          "safeTokenIssuance",
          "explicitAuthorizationEndpoint",
          "durableRevocationHandling",
          "runtimeCapabilityVerified",
        ]),
      });
      expect(() => assertProtectedRuntimeReady()).toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "MICROPHONE_PROTECTION_NOT_READY",
        }),
      );
    });
  });

  describe("getMicrophoneAuthority", () => {
    it("should return LEGACY mode for a LEGACY live class", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await getMicrophoneAuthority("lc-1");

      expect(result).toEqual({
        mode: "LEGACY",
        establishedAt: null,
      });
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("SELECT microphone_authorization_mode"),
        "lc-1",
      );
    });

    it("should return SFU_AUTHORITATIVE mode with timestamp", async () => {
      const timestamp = new Date("2026-10-29T12:00:00Z");
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: timestamp,
        },
      ]);

      const result = await getMicrophoneAuthority("lc-2");

      expect(result).toEqual({
        mode: "SFU_AUTHORITATIVE",
        establishedAt: timestamp,
      });
    });

    it("should throw CLASS_NOT_FOUND when class not found (fail-closed)", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await expect(getMicrophoneAuthority("lc-404")).rejects.toMatchObject({
        message: "Live class lc-404 not found",
        statusCode: 404,
        code: "CLASS_NOT_FOUND",
      });
    });

    it("should throw on database error (fail-closed)", async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce(
        new Error("DB connection lost"),
      );

      await expect(getMicrophoneAuthority("lc-error")).rejects.toThrow(
        "DB connection lost",
      );
    });

    it("should throw INVALID_AUTHORITY_MODE for null mode (fail-closed)", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: null,
          microphone_mode_established_at: null,
        },
      ]);

      await expect(getMicrophoneAuthority("lc-null")).rejects.toMatchObject({
        message: expect.stringContaining(
          "Invalid or missing microphone authority mode",
        ),
        statusCode: 500,
        code: "INVALID_AUTHORITY_MODE",
      });
    });

    it("should reject protected mode without establishment evidence", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: null,
        },
      ]);

      await expect(getMicrophoneAuthority("lc-unproven")).rejects.toMatchObject(
        {
          statusCode: 500,
          code: "INVALID_AUTHORITY_EVIDENCE",
        },
      );
    });
  });

  describe("getAuthoritySafe", () => {
    it("should return authority for valid class (same as fail-closed version)", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await getAuthoritySafe("lc-1");

      expect(result).toEqual({
        mode: "LEGACY",
        establishedAt: null,
      });
    });

    it("should return null when class not found (fail-safe)", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const result = await getAuthoritySafe("lc-404");

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to query authority"),
      );
    });

    it("should return null on database error (fail-safe)", async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce(
        new Error("DB connection lost"),
      );

      const result = await getAuthoritySafe("lc-error");

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to query authority"),
      );
    });
  });

  describe("canUseLiveKitAPISafe", () => {
    it("should return true for SFU_AUTHORITATIVE mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: new Date(),
        },
      ]);

      const result = await canUseLiveKitAPISafe("lc-sfu");

      expect(result).toBe(true);
    });

    it("should return false for LEGACY mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await canUseLiveKitAPISafe("lc-legacy");

      expect(result).toBe(false);
    });

    it("should return false on database error (fail-safe)", async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error("DB error"));

      const result = await canUseLiveKitAPISafe("lc-error");

      expect(result).toBe(false);
    });

    it("should return false when class not found (fail-safe)", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const result = await canUseLiveKitAPISafe("lc-404");

      expect(result).toBe(false);
    });
  });

  describe("canUseLiveKitAPI", () => {
    it("should return true for SFU_AUTHORITATIVE mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: new Date(),
        },
      ]);

      const result = await canUseLiveKitAPI("lc-sfu");

      expect(result).toBe(true);
    });

    it("should return false for LEGACY mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await canUseLiveKitAPI("lc-legacy");

      expect(result).toBe(false);
    });
  });

  describe("enforceSFUMode", () => {
    it("should not throw for SFU_AUTHORITATIVE mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: new Date(),
        },
      ]);

      await expect(
        enforceSFUMode("lc-sfu", "test operation"),
      ).resolves.toBeUndefined();
    });

    it("should throw 409 for LEGACY mode", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      await expect(
        enforceSFUMode("lc-legacy", "speaker demotion"),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Cannot perform speaker demotion"),
        statusCode: 409,
        code: "LEGACY_MODE_VIOLATION",
      });
    });

    it("should include operation name in error message", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      try {
        await enforceSFUMode("lc-legacy", "mic revocation");
        fail("Should have thrown");
      } catch (err) {
        expect(err.message).toContain("mic revocation");
        expect(err.message).toContain("LEGACY mode");
      }
    });
  });

  describe("upgradeToSFU", () => {
    it("should upgrade SCHEDULED LEGACY class to SFU_AUTHORITATIVE", async () => {
      const mockDate = new Date("2026-10-29T12:00:00Z");
      jest.spyOn(global, "Date").mockImplementation(() => mockDate);

      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-scheduled",
        status: "SCHEDULED",
        microphoneAuthorizationMode: "LEGACY",
      });

      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const result = await upgradeToSFU("lc-scheduled");

      expect(result).toEqual({
        success: true,
        mode: "SFU_AUTHORITATIVE",
        establishedAt: mockDate,
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          "SET microphone_authorization_mode = 'SFU_AUTHORITATIVE'",
        ),
        mockDate,
        "lc-scheduled",
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "Upgraded class lc-scheduled to SFU_AUTHORITATIVE",
        ),
      );

      global.Date.mockRestore();
    });

    it("should be idempotent - return success if already SFU_AUTHORITATIVE", async () => {
      const timestamp = new Date("2026-10-29T10:00:00Z");

      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-already",
        status: "SCHEDULED",
        microphoneAuthorizationMode: "SFU_AUTHORITATIVE",
      });

      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: timestamp,
        },
      ]);

      const result = await upgradeToSFU("lc-already");

      expect(result).toEqual({
        success: true,
        mode: "SFU_AUTHORITATIVE",
        establishedAt: timestamp,
      });

      // Should NOT execute UPDATE
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("already in SFU_AUTHORITATIVE mode"),
      );
    });

    it("should reject upgrade for LIVE class (409)", async () => {
      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-live",
        status: "LIVE",
        microphoneAuthorizationMode: "LEGACY",
      });

      await expect(upgradeToSFU("lc-live")).rejects.toMatchObject({
        message: expect.stringContaining("must be SCHEDULED"),
        statusCode: 409,
        code: "INVALID_STATUS_FOR_UPGRADE",
      });

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it("should reject upgrade for ENDED class (409)", async () => {
      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-ended",
        status: "ENDED",
        microphoneAuthorizationMode: "LEGACY",
      });

      await expect(upgradeToSFU("lc-ended")).rejects.toMatchObject({
        message: expect.stringContaining("must be SCHEDULED"),
        statusCode: 409,
      });
    });

    it("should reject upgrade for non-existent class (404)", async () => {
      prisma.liveClass.findFirst.mockResolvedValueOnce(null);

      await expect(upgradeToSFU("lc-404")).rejects.toMatchObject({
        message: expect.stringContaining("not found"),
        statusCode: 404,
      });
    });

    it("should handle database errors gracefully", async () => {
      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-error",
        status: "SCHEDULED",
        microphoneAuthorizationMode: "LEGACY",
      });

      prisma.$executeRawUnsafe.mockRejectedValueOnce(
        new Error("DB write failed"),
      );

      await expect(upgradeToSFU("lc-error")).rejects.toMatchObject({
        message: expect.stringContaining("Failed to upgrade"),
        statusCode: 500,
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to upgrade class"),
      );
    });

    it("should reject a raced upgrade when the conditional update changes no row", async () => {
      prisma.liveClass.findFirst.mockResolvedValueOnce({
        id: "lc-raced",
        status: "SCHEDULED",
        microphoneAuthorizationMode: "LEGACY",
      });
      prisma.$executeRawUnsafe.mockResolvedValueOnce(0);

      await expect(upgradeToSFU("lc-raced")).rejects.toMatchObject({
        statusCode: 409,
        code: "STALE_AUTHORITY_UPGRADE",
      });
    });
  });

  describe("isLegacyMode", () => {
    it("should return true for LEGACY class", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await isLegacyMode("lc-legacy");

      expect(result).toBe(true);
    });

    it("should return false for SFU_AUTHORITATIVE class", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: new Date(),
        },
      ]);

      const result = await isLegacyMode("lc-sfu");

      expect(result).toBe(false);
    });
  });

  describe("isSFUMode", () => {
    it("should return true for SFU_AUTHORITATIVE class", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "SFU_AUTHORITATIVE",
          microphone_mode_established_at: new Date(),
        },
      ]);

      const result = await isSFUMode("lc-sfu");

      expect(result).toBe(true);
    });

    it("should return false for LEGACY class", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          microphone_authorization_mode: "LEGACY",
          microphone_mode_established_at: null,
        },
      ]);

      const result = await isSFUMode("lc-legacy");

      expect(result).toBe(false);
    });
  });

  describe("AUTHORITY_MODES constant", () => {
    it("should export correct mode constants", () => {
      expect(AUTHORITY_MODES.LEGACY).toBe("LEGACY");
      expect(AUTHORITY_MODES.SFU_AUTHORITATIVE).toBe("SFU_AUTHORITATIVE");
    });
  });
});
