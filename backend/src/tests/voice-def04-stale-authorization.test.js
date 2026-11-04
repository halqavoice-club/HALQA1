"use strict";
/**
 * DEF-04 / PHASE 3A-2: STALE PARTICIPANT AUTHORIZATION REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence class: CONTROLLER-EXECUTING UNIT TESTS
 *
 * Verifies that repeated self-unmute (idempotent / retry path) re-fetches
 * fresh participant and room authorization state before evaluating LiveKit
 * publishing permissions and never restores canPublish:true against stale state.
 *
 * Scenarios tested:
 * 1. Concurrent demotion: SPEAKER demoted to AUDIENCE → 403 ROLE_NOT_ELIGIBLE, no SFU call
 * 2. Concurrent seat release: Participant loses seat (seatNumber: null) → 403 NOT_ON_STAGE, no SFU call
 * 3. Concurrent departure: Participant leaves/kicked (isActive: false) → 403 not in room, no SFU call
 * 4. Concurrent deletion: Participant record deleted (null) → 403 not in room, no SFU call
 * 5. Concurrent moderator mute: Moderator mutes participant (mutedByModerator: true) → 403, no SFU call
 * 6. Concurrent voluntary mute: Participant muted concurrently (isMuted: true) → 409 conflict, no SFU call
 * 7. Concurrent Mute All: Room allMuted becomes true → 403 ALL_MUTED, no SFU call
 * 8. Concurrent Mic Lock: Room micLocked becomes true → 403 MIC_LOCKED, no SFU call
 * 9. Concurrent role privilege loss: MODERATOR demoted to SPEAKER under allMuted → 403 ALL_MUTED, no SFU call
 * 10. Authorized repeated self-unmute: All conditions met → 200, canPublishAudio: true, SFU called
 * 11. Authorized repeated self-unmute with SFU TIMEOUT → 200, sfuEnforced: false, TIMEOUT surfaced
 * 12. Authorized repeated self-unmute with SFU UPDATE_FAILED → 200, sfuEnforced: false, UPDATE_FAILED surfaced
 * 13. HOST privilege under allMuted/micLocked preserved if seated → 200, canPublishAudio: true
 * 14. Unseated HOST denied audio publication → 403 NOT_ON_STAGE, no SFU call
 */

// ─── Mocks (declared before controller import) ────────────────────────────────

jest.mock("../utils/prisma", () => {
  const mockPrisma = {
    voiceRoom: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    voiceParticipant: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn(),
    },
    voiceRoomMember: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ status: "ACTIVE" }) },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ acquired: 1 }]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fns) => {
      if (Array.isArray(fns)) return Promise.all(fns);
      return fns(mockPrisma);
    }),
  };
  return mockPrisma;
});

jest.mock("../utils/redis", () => ({
  setCache: jest.fn().mockResolvedValue(undefined),
  getCache: jest.fn().mockResolvedValue(null),
  deleteCache: jest.fn().mockResolvedValue(undefined),
  deleteCachePattern: jest.fn().mockResolvedValue(undefined),
  isRedisReady: jest.fn().mockReturnValue(false),
}));

jest.mock("../sockets", () => {
  const emitFn = jest.fn();
  const toFn = jest.fn().mockReturnValue({ emit: emitFn });
  const io = { to: toFn, emit: emitFn };
  return { getIo: jest.fn().mockReturnValue(io) };
});

jest.mock("../utils/livekitService", () => ({
  sfuRevokePublish: jest
    .fn()
    .mockResolvedValue({ enforced: true, reason: "UPDATED" }),
  sfuEvict: jest.fn().mockResolvedValue(undefined),
  getLivekitRoomService: jest.fn().mockReturnValue(null),
}));

jest.mock("../utils/voiceRoomCache", () => ({
  invalidateRoomCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/feedLive", () => ({
  broadcastLiveStart: jest.fn(),
  broadcastLiveEnd: jest.fn(),
  broadcastLiveUpdate: jest.fn(),
}));

jest.mock("../services/queue.service", () => ({
  queueBulkNotifications: jest.fn(),
  scheduleRoomReminder: jest.fn(),
  cancelRoomReminder: jest.fn(),
  scheduleRoomSleep: jest.fn().mockResolvedValue(undefined),
  cancelRoomSleep: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/voiceQueue", () => ({
  clearQueue: jest.fn(),
  enqueue: jest.fn(),
  getQueue: jest.fn().mockResolvedValue([]),
  isInQueue: jest.fn().mockResolvedValue(false),
  dequeue: jest.fn(),
}));

jest.mock("../utils/autoPromote", () => ({
  autoPromoteNext: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../utils/search", () => ({
  searchVoiceRooms: jest.fn().mockResolvedValue([]),
}));

jest.mock("../controllers/voice-stats.controller", () => ({
  upsertDailyStats: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/response", () => ({
  successResponse: (res, data, msg, code) => {
    res.statusCode = code || 200;
    res.body = { success: true, data, message: msg };
    return res;
  },
  errorResponse: (res, msg, code, data) => {
    res.statusCode = code || 400;
    res.body = { success: false, message: msg, ...(data || {}) };
    return res;
  },
  paginatedResponse: jest.fn(),
  getPagination: jest.fn().mockReturnValue({ skip: 0, page: 1, limit: 20 }),
  buildPaginationMeta: jest.fn(),
}));

const voiceCtrl = require("../controllers/voice.controller");
const prisma = require("../utils/prisma");
const { sfuRevokePublish } = require("../utils/livekitService");

function makeReq(overrides = {}) {
  return {
    params: { id: "room-1" },
    body: { isMuted: false },
    user: { id: "user-test" },
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

const next = jest.fn();

describe("DEF-04 / Phase 3A-2: Stale Participant Authorization in Repeated Self-Unmute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Concurrent Demotion to AUDIENCE ───────────────────────────────────────
  test("1. Concurrent demotion: SPEAKER demoted to AUDIENCE → 403 ROLE_NOT_ELIGIBLE, no SFU call", async () => {
    // Initial read sees seated SPEAKER (isMuted: false)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    // Pre-check room is clear
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: demoted to AUDIENCE!
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "AUDIENCE",
      seatNumber: null,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain(
      "Microphone unavailable: ROLE_NOT_ELIGIBLE",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 2. Concurrent Seat Release ──────────────────────────────────────────────
  test("2. Concurrent seat release: Participant loses seat (seatNumber: null) → 403 NOT_ON_STAGE, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 3,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: seat released / dropped mic
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: null,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: NOT_ON_STAGE");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 3. Concurrent Departure / Inactivity ────────────────────────────────────
  test("3. Concurrent departure: Participant becomes inactive (isActive: false) → 403 not in room, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: participant left or was kicked (isActive: false)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: false,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("User is not in this room");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 4. Concurrent Deletion / Record Absent ──────────────────────────────────
  test("4. Concurrent deletion: Participant record deleted (null) → 403 not in room, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: record deleted from DB
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce(null);
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("User is not in this room");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 5. Concurrent Moderator Mute ───────────────────────────────────────────
  test("5. Concurrent moderator mute: Moderator mutes participant (mutedByModerator: true) → 403, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: moderator disciplined user
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: true,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain(
      "You were muted by a moderator and cannot unmute yourself",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 6. Concurrent Voluntary Self-Mute ───────────────────────────────────────
  test("6. Concurrent voluntary mute: Participant muted concurrently (isMuted: true) → 409 conflict, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: user muted in another tab/request (isMuted: true, mutedByModerator: false)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain(
      "Mute state changed concurrently; retry with fresh state",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 7. Concurrent Room Mute All ────────────────────────────────────────────
  test("7. Concurrent Mute All: Room allMuted becomes true → 403 ALL_MUTED, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: room muted all
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: true,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: ALL_MUTED");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 8. Concurrent Room Mic Lock ────────────────────────────────────────────
  test("8. Concurrent Mic Lock: Room micLocked becomes true → 403 MIC_LOCKED, no SFU call", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Concurrently: host locked mic
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: true,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: MIC_LOCKED");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 9. Concurrent Role Privilege Loss ───────────────────────────────────────
  test("9. Concurrent role privilege loss: MODERATOR demoted to SPEAKER under allMuted → 403 ALL_MUTED, no SFU call", async () => {
    // Initial read sees unmuted MODERATOR under allMuted (exempt)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "MODERATOR",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: true,
    });

    // Concurrently: demoted to regular SPEAKER (now subject to allMuted)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: true,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: ALL_MUTED");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── 10. Authorized Repeated Self-Unmute ──────────────────────────────────────
  test("10. Authorized repeated self-unmute: All conditions met → 200, canPublishAudio: true, SFU called", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    // Fresh reaffirm check confirms user is still active seated unmuted speaker
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        isMuted: false,
        canPublishAudio: true,
        audioPermissionReason: "ALLOWED",
        sfuEnforced: true,
        sfuEnforcementReason: "UPDATED",
      }),
    );
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "user-test",
      true,
      "[voice:self-unmute]",
    );
  });

  // ── 11. SFU TIMEOUT on Authorized Repeated Self-Unmute ──────────────────────
  test("11. Authorized repeated self-unmute with SFU TIMEOUT → 200, sfuEnforced: false, TIMEOUT surfaced", async () => {
    sfuRevokePublish.mockResolvedValueOnce({
      enforced: false,
      reason: "TIMEOUT",
    });

    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        canPublishAudio: true,
        audioPermissionReason: "ALLOWED",
        sfuEnforced: false,
        sfuEnforcementReason: "TIMEOUT",
      }),
    );
  });

  // ── 12. SFU UPDATE_FAILED on Authorized Repeated Self-Unmute ────────────────
  test("12. Authorized repeated self-unmute with SFU UPDATE_FAILED → 200, sfuEnforced: false, UPDATE_FAILED surfaced", async () => {
    sfuRevokePublish.mockResolvedValueOnce({
      enforced: false,
      reason: "UPDATE_FAILED",
    });

    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "user-test",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq();
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        canPublishAudio: true,
        audioPermissionReason: "ALLOWED",
        sfuEnforced: false,
        sfuEnforcementReason: "UPDATE_FAILED",
      }),
    );
  });

  // ── 13. HOST Privilege Under Room Locks When Seated ─────────────────────────
  test("13. HOST privilege under allMuted/micLocked preserved if seated → 200, canPublishAudio: true", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "host-1",
      role: "HOST",
      seatNumber: 1,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: true,
      allMuted: true,
    });

    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "host-1",
      role: "HOST",
      seatNumber: 1,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: true,
      allMuted: true,
    });

    const req = makeReq({ user: { id: "host-1" } });
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.canPublishAudio).toBe(true);
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "host-1",
      true,
      "[voice:self-unmute]",
    );
  });

  // ── 14. Unseated HOST Denied Publishing ─────────────────────────────────────
  test("14. Unseated HOST denied audio publication → 403 NOT_ON_STAGE, no SFU call", async () => {
    // Host has no seat (off-stage host)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "host-1",
      role: "HOST",
      seatNumber: null,
      isMuted: false,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const req = makeReq({ user: { id: "host-1" } });
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: NOT_ON_STAGE");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });
});
