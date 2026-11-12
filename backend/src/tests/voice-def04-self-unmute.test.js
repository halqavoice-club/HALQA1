"use strict";
/**
 * DEF-04: SELF-UNMUTE LIVEKIT SFU GRANT RESTORATION REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence class: MOCKED UNIT TESTS
 *
 * Verifies that explicit self-unmute restores canPublish on LiveKit SFU only
 * when authorized by authoritative room and participant state.
 *
 * Scenarios covered:
 * A. muteAll → unmuteAll → explicit self-unmute: authorized publishing grant restored.
 * B. Moderator mute → release → explicit self-unmute: publishing restored only after authorized local action.
 * C. Self-unmute during allMuted: publishing remains denied.
 * D. Self-unmute during micLocked: publishing remains denied.
 * E. mutedByModerator=true: self-unmute blocked.
 * F. AUDIENCE and unseated users cannot publish.
 * G. No auto-enable from Socket.IO events or unmuteAll.
 * H. SFU error/enforced:false is surfaced accurately.
 * I. Repeated self-unmute is safe and does not introduce incorrect grants.
 */

const fs = require("fs");
const path = require("path");

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
    $transaction: jest.fn(async (fns, _opts) => {
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
const voiceRolesCtrl = require("../controllers/voice-roles.controller");
const prisma = require("../utils/prisma");
const { sfuRevokePublish } = require("../utils/livekitService");
const { getIo } = require("../sockets");

function makeReq(overrides = {}) {
  return {
    params: {},
    body: {},
    query: {},
    user: { id: "caller-id", role: "USER" },
    ...overrides,
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
}

const next = jest.fn();

describe("DEF-04: Self-unmute LiveKit SFU Grant Restoration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.voiceParticipant.findUnique.mockReset();
    prisma.voiceParticipant.findMany.mockReset();
    prisma.voiceParticipant.update.mockReset().mockResolvedValue({});
    prisma.voiceParticipant.updateMany
      .mockReset()
      .mockResolvedValue({ count: 1 });
    prisma.voiceRoom.findUnique
      .mockReset()
      .mockResolvedValue({ micLocked: false, allMuted: false });
    prisma.voiceRoom.update.mockReset().mockResolvedValue({});
    const emitFn = jest.fn();
    const toFn = jest.fn().mockReturnValue({ emit: emitFn });
    getIo.mockReturnValue({ to: toFn, emit: emitFn });
    sfuRevokePublish.mockResolvedValue({ enforced: true, reason: "UPDATED" });
  });

  // ── A. muteAll → unmuteAll → explicit self-unmute ─────────────────────────
  test("A. muteAll → unmuteAll → explicit self-unmute: authorized publishing grant restored", async () => {
    // 1. muteAll() sets allMuted=true, mutes speaker in DB, calls sfuRevokePublish(false)
    prisma.voiceParticipant.findMany
      .mockResolvedValueOnce([{ id: "p1", userId: "speaker-1" }]) // inside $transaction
      .mockResolvedValueOnce([{ id: "p1", userId: "speaker-1" }]); // post-transaction re-read

    const reqMuteAll = makeReq({
      params: { id: "room-1" },
      user: { id: "mod-1", role: "USER" },
    });
    const resMuteAll = makeRes();
    await voiceRolesCtrl.muteAll(reqMuteAll, resMuteAll, next);

    expect(resMuteAll.statusCode).toBe(200);
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      false,
      "[voice:mute-all]",
    );

    // 2. unmuteAll() clears allMuted policy AND restores SFU canPublish for actually-unmuted
    //    participants (F3.1/P3a fix). Supply mocks for the in-tx findMany and post-tx re-read.
    sfuRevokePublish.mockClear();
    // in-tx findMany: speaker-1 was muted by muteAll (mutedByModerator=false)
    prisma.voiceParticipant.findMany
      .mockResolvedValueOnce([{ id: "p1", userId: "speaker-1" }]) // in-transaction targets
      .mockResolvedValueOnce([{ userId: "speaker-1" }]); // post-tx re-read (actually unmuted)
    prisma.voiceParticipant.updateMany.mockResolvedValueOnce({ count: 1 });
    const reqUnmuteAll = makeReq({
      params: { id: "room-1" },
      user: { id: "mod-1", role: "USER" },
    });
    const resUnmuteAll = makeRes();
    await voiceRolesCtrl.unmuteAll(reqUnmuteAll, resUnmuteAll, next);

    expect(resUnmuteAll.statusCode).toBe(200);
    // F3.1/P3a: SFU canPublish IS restored for speaker-1 (canPublish=true)
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      true,
      "[voice:unmute-all]",
    );

    // 3. Speaker explicitly calls toggleMute({ isMuted: false })
    // Pre-check reads: participant (isMuted: true, seat: 2), room (allMuted: false)
    // Post-update reads: updated participant (isMuted: false, seat: 2), room (allMuted: false)
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        id: "p1",
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      })
      .mockResolvedValueOnce({
        id: "p1",
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      });
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false }) // pre-check
      .mockResolvedValueOnce({ micLocked: false, allMuted: false }); // post-update check

    const reqSelfUnmute = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1", role: "USER" },
    });
    const resSelfUnmute = makeRes();
    await voiceCtrl.toggleMute(reqSelfUnmute, resSelfUnmute, next);

    expect(resSelfUnmute.statusCode).toBe(200);
    expect(resSelfUnmute.body.data).toEqual(
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
      "speaker-1",
      true,
      "[voice:self-unmute]",
    );
  });

  // ── B. Moderator mute → release → explicit self-unmute ─────────────────────
  test("B. Moderator mute → release → explicit self-unmute: publishing restored only after authorized local action", async () => {
    // 1. Moderator mutes speaker
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "mod-1",
        role: "MODERATOR",
        isActive: true,
      }) // caller
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      }) // target
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: true,
        isActive: true,
      }); // post-update
    prisma.voiceRoom.findUnique.mockResolvedValue({
      micLocked: false,
      allMuted: false,
    });

    const reqModMute = makeReq({
      params: { id: "room-1" },
      body: { targetUserId: "speaker-1", isMuted: true },
      user: { id: "mod-1" },
    });
    const resModMute = makeRes();
    await voiceCtrl.toggleMute(reqModMute, resModMute, next);

    expect(resModMute.statusCode).toBe(200);
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      false,
      "[voice:mod-mute]",
    );

    // 2. Moderator releases mute (unmute target)
    // DEF-02: target remains isMuted=true, mutedByModerator becomes false
    sfuRevokePublish.mockClear();
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "mod-1",
        role: "MODERATOR",
        isActive: true,
      }) // caller
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: true,
        isActive: true,
      }) // target
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      }); // post-update

    const reqModRelease = makeReq({
      params: { id: "room-1" },
      body: { targetUserId: "speaker-1", isMuted: false },
      user: { id: "mod-1" },
    });
    const resModRelease = makeRes();
    await voiceCtrl.toggleMute(reqModRelease, resModRelease, next);

    expect(resModRelease.statusCode).toBe(200);
    expect(resModRelease.body.data).toEqual(
      expect.objectContaining({
        isMuted: true,
        mutedByModerator: false,
        restrictionReleased: true,
        canPublishAudio: false,
        audioPermissionReason: "SELF_MUTED",
      }),
    );
    // Crucial: moderator release called sfuRevokePublish with false (no auto-activation)
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      false,
      "[voice:mod-unmute]",
    );

    // 3. Speaker explicitly self-unmutes
    sfuRevokePublish.mockClear();
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      }) // pre-check
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      }); // post-update
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false })
      .mockResolvedValueOnce({ micLocked: false, allMuted: false });

    const reqSelfUnmute = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resSelfUnmute = makeRes();
    await voiceCtrl.toggleMute(reqSelfUnmute, resSelfUnmute, next);

    expect(resSelfUnmute.statusCode).toBe(200);
    expect(resSelfUnmute.body.data).toEqual(
      expect.objectContaining({
        isMuted: false,
        canPublishAudio: true,
        sfuEnforced: true,
      }),
    );
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      true,
      "[voice:self-unmute]",
    );
  });

  // ── C. Self-unmute during allMuted ────────────────────────────────────────
  test("C. Self-unmute during allMuted: publishing remains denied", async () => {
    // Participant is on stage, room is allMuted=true
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "speaker-1",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: true,
    });

    const req = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: ALL_MUTED");
    expect(sfuRevokePublish).not.toHaveBeenCalled();

    // Concurrent race defense: pre-check passes (allMuted was false), but post-update check sees allMuted=true
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      }) // pre-check
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      }); // post-update
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false }) // pre-check: room not muted
      .mockResolvedValueOnce({ micLocked: false, allMuted: true }); // post-update: concurrent muteAll occurred!

    const reqRace = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resRace = makeRes();
    await voiceCtrl.toggleMute(reqRace, resRace, next);

    expect(resRace.statusCode).toBe(200);
    expect(resRace.body.data).toEqual(
      expect.objectContaining({
        isMuted: false,
        canPublishAudio: false,
        audioPermissionReason: "ALL_MUTED",
        sfuEnforced: false,
        sfuEnforcementReason: "ALL_MUTED",
      }),
    );
    // Crucial: sfuRevokePublish(canPublish=true) must NOT have been called!
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── D. Self-unmute during micLocked ───────────────────────────────────────
  test("D. Self-unmute during micLocked: publishing remains denied", async () => {
    // Non-privileged SPEAKER during micLocked
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "speaker-1",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: true,
      allMuted: false,
    });

    const req = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("Microphone unavailable: MIC_LOCKED");
    expect(sfuRevokePublish).not.toHaveBeenCalled();

    // Privileged HOST on stage during micLocked CAN self-unmute
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "host-1",
        role: "HOST",
        seatNumber: 1,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      })
      .mockResolvedValueOnce({
        userId: "host-1",
        role: "HOST",
        seatNumber: 1,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      });
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: true, allMuted: false })
      .mockResolvedValueOnce({ micLocked: true, allMuted: false });

    const reqHost = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "host-1" },
    });
    const resHost = makeRes();
    await voiceCtrl.toggleMute(reqHost, resHost, next);

    expect(resHost.statusCode).toBe(200);
    expect(resHost.body.data.canPublishAudio).toBe(true);
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "host-1",
      true,
      "[voice:self-unmute]",
    );
  });

  // ── E. mutedByModerator=true: self-unmute blocked ─────────────────────────
  test("E. mutedByModerator=true: self-unmute blocked", async () => {
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "speaker-1",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: true,
      isActive: true,
    });

    const req = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const res = makeRes();
    await voiceCtrl.toggleMute(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain(
      "You were muted by a moderator and cannot unmute yourself",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── F. AUDIENCE and unseated users cannot publish ─────────────────────────
  test("F. AUDIENCE and unseated users cannot publish", async () => {
    // 1. AUDIENCE user
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "aud-1",
      role: "AUDIENCE",
      seatNumber: null,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const reqAud = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "aud-1" },
    });
    const resAud = makeRes();
    await voiceCtrl.toggleMute(reqAud, resAud, next);

    expect(resAud.statusCode).toBe(403);
    expect(resAud.body.message).toContain(
      "Microphone unavailable: ROLE_NOT_ELIGIBLE",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();

    // 2. SPEAKER without seat (not on stage)
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "unseated-spk",
      role: "SPEAKER",
      seatNumber: null,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });
    prisma.voiceRoom.findUnique.mockResolvedValueOnce({
      micLocked: false,
      allMuted: false,
    });

    const reqUnseated = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "unseated-spk" },
    });
    const resUnseated = makeRes();
    await voiceCtrl.toggleMute(reqUnseated, resUnseated, next);

    expect(resUnseated.statusCode).toBe(403);
    expect(resUnseated.body.message).toContain(
      "Microphone unavailable: NOT_ON_STAGE",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();

    // 3. Inactive participant
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "inactive-user",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: false,
      isActive: false,
    });

    const reqInactive = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "inactive-user" },
    });
    const resInactive = makeRes();
    await voiceCtrl.toggleMute(reqInactive, resInactive, next);

    expect(resInactive.statusCode).toBe(403);
    expect(resInactive.body.message).toContain("User is not in this room");
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });

  // ── G. No auto-enable from Socket.IO events or unmuteAll ───────────────────
  test("G. No auto-enable from Socket.IO events or unmuteAll", () => {
    const rolesSource = fs.readFileSync(
      path.join(__dirname, "../controllers/voice-roles.controller.js"),
      "utf8",
    );
    const webViewSource = fs.readFileSync(
      path.join(
        __dirname,
        "../../../frontend/src/components/voice/VoiceRoomView.tsx",
      ),
      "utf8",
    );
    const mobileSource = fs.readFileSync(
      path.join(__dirname, "../../../mobile/app/voice/[id].tsx"),
      "utf8",
    );

    // F3.1 behavior: unmuteAll DOES restore SFU (P3a fix) and emit voice:mute_changed
    // per actually-unmuted participant. It also emits voice:room_policy_changed.
    // Auto-enable must NOT happen from socket events on the client side (disable-only
    // server-sync) — but the server correctly restores canPublish on the SFU.
    const unmuteAllFn = rolesSource.slice(
      rolesSource.indexOf("async function unmuteAll"),
      rolesSource.indexOf(
        "async function getParticipants",
        rolesSource.indexOf("async function unmuteAll"),
      ),
    );
    // F3.1: unmuteAll clears allMuted flag (DEF-001)
    expect(unmuteAllFn).toMatch(/allMuted:\s*false/);
    // F3.1/P3a: unmuteAll restores SFU canPublish for actually-unmuted participants
    expect(unmuteAllFn).toMatch(/sfuRevokePublish/);
    // F3.1: socket events emitted for per-participant state changes
    expect(unmuteAllFn).toMatch(/voice:mute_changed/);
    // F3.1: room policy event broadcast
    expect(unmuteAllFn).toMatch(/voice:room_policy_changed/);

    // Web VoiceRoomView stage presence effect is disable-only
    const micEffectStart = webViewSource.indexOf(
      "// Server state may revoke local capture",
    );
    const micEffect = webViewSource.slice(
      micEffectStart,
      webViewSource.indexOf(
        "useEffect(() => {",
        webViewSource.indexOf("useEffect(() => {", micEffectStart) + 1,
      ),
    );
    expect(micEffect).toMatch(/disableMic/);
    expect(micEffect).not.toMatch(/enableMic/);

    // Mobile event handlers are disable-only
    const onMuteChanged = mobileSource.slice(
      mobileSource.indexOf("const onMuteChanged"),
      mobileSource.indexOf(
        "// Role changed",
        mobileSource.indexOf("const onMuteChanged"),
      ),
    );
    expect(onMuteChanged).toMatch(/if \(d\.isMuted\) lk\.disableMic/);
    expect(onMuteChanged).not.toMatch(/enableMic/);
  });

  // ── H. SFU error/enforced:false is surfaced accurately ─────────────────────
  test("H. SFU error/enforced:false is surfaced accurately", async () => {
    // 1. Timeout failure
    sfuRevokePublish.mockResolvedValueOnce({
      enforced: false,
      reason: "TIMEOUT",
    });
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      })
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      });
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false })
      .mockResolvedValueOnce({ micLocked: false, allMuted: false });

    const reqTimeout = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resTimeout = makeRes();
    await voiceCtrl.toggleMute(reqTimeout, resTimeout, next);

    expect(resTimeout.statusCode).toBe(200);
    expect(resTimeout.body.data).toEqual(
      expect.objectContaining({
        isMuted: false,
        canPublishAudio: true,
        audioPermissionReason: "ALLOWED",
        sfuEnforced: false,
        sfuEnforcementReason: "TIMEOUT",
      }),
    );

    // 2. LiveKit not configured
    sfuRevokePublish.mockResolvedValueOnce({
      enforced: false,
      reason: "NOT_CONFIGURED",
    });
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      })
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      });
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false })
      .mockResolvedValueOnce({ micLocked: false, allMuted: false });

    const reqNoConfig = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resNoConfig = makeRes();
    await voiceCtrl.toggleMute(reqNoConfig, resNoConfig, next);

    expect(resNoConfig.statusCode).toBe(200);
    expect(resNoConfig.body.data.sfuEnforced).toBe(false);
    expect(resNoConfig.body.data.sfuEnforcementReason).toBe("NOT_CONFIGURED");

    // 3. Participant not found in LiveKit SFU
    sfuRevokePublish.mockResolvedValueOnce({
      enforced: false,
      reason: "NOT_FOUND",
    });
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: false,
        isActive: true,
      })
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      });
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false })
      .mockResolvedValueOnce({ micLocked: false, allMuted: false });

    const reqNotFound = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resNotFound = makeRes();
    await voiceCtrl.toggleMute(reqNotFound, resNotFound, next);

    expect(resNotFound.statusCode).toBe(200);
    expect(resNotFound.body.data.sfuEnforced).toBe(false);
    expect(resNotFound.body.data.sfuEnforcementReason).toBe("NOT_FOUND");
  });

  // ── I. Repeated self-unmute is safe and does not introduce incorrect grants ─
  test("I. Repeated self-unmute is safe and does not introduce incorrect grants", async () => {
    // 1. Participant is ALREADY unmuted in DB, calls self-unmute again
    prisma.voiceParticipant.findUnique
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      }) // initial pre-check
      .mockResolvedValueOnce({
        userId: "speaker-1",
        role: "SPEAKER",
        seatNumber: 2,
        isMuted: false,
        mutedByModerator: false,
        isActive: true,
      }); // idempotent fresh reaffirmation check
    prisma.voiceRoom.findUnique
      .mockResolvedValueOnce({ micLocked: false, allMuted: false }) // pre-check
      .mockResolvedValueOnce({ micLocked: false, allMuted: false }); // idempotent reaffirm check

    const reqIdempotent = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resIdempotent = makeRes();
    await voiceCtrl.toggleMute(reqIdempotent, resIdempotent, next);

    expect(resIdempotent.statusCode).toBe(200);
    expect(resIdempotent.body.data).toEqual(
      expect.objectContaining({
        isMuted: false,
        canPublishAudio: true,
        sfuEnforced: true,
      }),
    );
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "speaker-1",
      true,
      "[voice:self-unmute]",
    );

    // 2. Repeated self-unmute when room became allMuted=true: rejected at pre-check
    sfuRevokePublish.mockClear();
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "speaker-1",
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

    const reqBlocked = makeReq({
      params: { id: "room-1" },
      body: { isMuted: false },
      user: { id: "speaker-1" },
    });
    const resBlocked = makeRes();
    await voiceCtrl.toggleMute(reqBlocked, resBlocked, next);

    expect(resBlocked.statusCode).toBe(403);
    expect(resBlocked.body.message).toContain(
      "Microphone unavailable: ALL_MUTED",
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();

    // 3. Repeated self-mute (participant isMuted=true, calls isMuted=true)
    sfuRevokePublish.mockClear();
    prisma.voiceParticipant.findUnique.mockResolvedValueOnce({
      userId: "speaker-1",
      role: "SPEAKER",
      seatNumber: 2,
      isMuted: true,
      mutedByModerator: false,
      isActive: true,
    });

    const reqSelfMute = makeReq({
      params: { id: "room-1" },
      body: { isMuted: true },
      user: { id: "speaker-1" },
    });
    const resSelfMute = makeRes();
    await voiceCtrl.toggleMute(reqSelfMute, resSelfMute, next);

    expect(resSelfMute.statusCode).toBe(200);
    expect(resSelfMute.body.data.isMuted).toBe(true);
    expect(sfuRevokePublish).not.toHaveBeenCalled();
  });
});
