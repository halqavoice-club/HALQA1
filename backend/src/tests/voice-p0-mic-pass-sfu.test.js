"use strict";
/**
 * Phase 3A-3B1B: execute the real Mic Pass controller with in-memory database,
 * Redis, Socket.IO and LiveKit boundaries. No database or media server is used.
 * The database adapter records the controller's raw SQL, models its writes and
 * transaction rollback, and returns committed rows for the stage snapshot.
 */

jest.mock("../utils/prisma", () => ({
  voiceRoom: { findUnique: jest.fn() },
  voiceParticipant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../utils/redis", () => ({
  setCache: jest.fn(),
  getCache: jest.fn(),
  deleteCache: jest.fn(),
}));
jest.mock("../utils/voiceRoomCache", () => ({
  getNextStageVersion: jest.fn(),
}));
jest.mock("../sockets", () => ({ getIo: jest.fn() }));
jest.mock("../utils/livekitService", () => ({
  sfuRevokePublish: jest.fn(),
  sfuEvict: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../utils/response", () => ({
  successResponse: (res, data, message, status = 200) => {
    res.statusCode = status;
    res.body = { success: true, data, message };
    return res;
  },
  errorResponse: (res, message, status = 400) => {
    res.statusCode = status;
    res.body = { success: false, message };
    return res;
  },
}));

const { acceptMicOffer } = require("../controllers/voice-mic.controller");
const prisma = require("../utils/prisma");
const { getCache, deleteCache } = require("../utils/redis");
const { getIo } = require("../sockets");
const { sfuRevokePublish, sfuEvict } = require("../utils/livekitService");
const { getNextStageVersion } = require("../utils/voiceRoomCache");
const { getVoiceAudioPermission } = require("../utils/voiceAudioPermission");

const clone = (value) => JSON.parse(JSON.stringify(value));
const sqlText = (call) => call[0].join("?").replace(/\s+/g, " ").trim();

function setup(options = {}) {
  const passer = {
    userId: "passer-1",
    role: "SPEAKER",
    seatNumber: 3,
    isActive: true,
    isMuted: false,
    mutedByModerator: false,
    handRaised: false,
    user: {
      id: "passer-1",
      firstName: "Passer",
      lastName: "One",
      avatarUrl: null,
    },
    ...options.passer,
  };
  const target = {
    userId: "acceptor-1",
    role: "AUDIENCE",
    seatNumber: null,
    isActive: true,
    isMuted: true,
    mutedByModerator: false,
    handRaised: true,
    user: {
      id: "acceptor-1",
      firstName: "Recipient",
      lastName: "One",
      avatarUrl: null,
    },
    ...options.target,
  };
  const state = { participants: [passer, target, ...(options.others || [])] };
  const room = {
    status: "LIVE",
    micLocked: false,
    allMuted: false,
    maxSpeakers: 12,
    lockedSeats: [],
    ...options.room,
  };
  const current = (id) => state.participants.find((row) => row.userId === id);
  getCache.mockResolvedValue({
    offerId: "offer-123",
    roomId: "room-1",
    passerId: "passer-1",
    targetId: "acceptor-1",
    passerRole: passer.role,
    ...options.offer,
  });
  deleteCache.mockResolvedValue(undefined);
  sfuRevokePublish.mockResolvedValue({ enforced: true, reason: "UPDATED" });
  getNextStageVersion.mockResolvedValue(7);
  prisma.voiceRoom.findUnique.mockImplementation(async () => clone(room));
  prisma.voiceParticipant.findUnique.mockImplementation(async ({ where }) => {
    const row = current(where.roomId_userId.userId);
    return row ? clone(row) : null;
  });
  prisma.voiceParticipant.findMany.mockImplementation(async () =>
    clone(state.participants),
  );
  prisma.$queryRaw.mockImplementation(async (strings) => {
    const text = strings.join("?");
    if (/SELECT seatNumber, role FROM/.test(text)) {
      if (options.noPasserRow) return [];
      const row = current("passer-1");
      return row?.isActive
        ? [{ role: row.role, seatNumber: row.seatNumber }]
        : [];
    }
    if (/SELECT seatNumber FROM/.test(text)) {
      return state.participants
        .filter((row) => row.isActive && row.seatNumber != null)
        .map((row) => ({ seatNumber: row.seatNumber }));
    }
    if (/FROM voice_participants/.test(text)) {
      return state.participants
        .filter((row) => row.isActive)
        .map((row) => ({
          ...clone(row),
          firstName: row.user?.firstName,
          lastName: row.user?.lastName,
          avatarUrl: row.user?.avatarUrl,
        }));
    }
    throw new Error(`Unexpected raw query: ${text}`);
  });
  prisma.$executeRaw.mockImplementation(async (strings, ...values) => {
    const text = strings.join("?");
    if (/SELECT 1/.test(text)) return 1;
    if (/SET seatNumber = \?/.test(text)) {
      if (options.targetUpdateCount !== undefined)
        return options.targetUpdateCount;
      Object.assign(current("acceptor-1"), {
        seatNumber: values[0],
        role: "SPEAKER",
        // Read the actual SQL assignment, not a copy of room policy.
        isMuted: /isMuted = 1/.test(text) ? true : Boolean(values[1]),
        handRaised: false,
      });
      return 1;
    }
    if (/SET seatNumber = NULL/.test(text)) {
      if (options.passerUpdateCount !== undefined)
        return options.passerUpdateCount;
      Object.assign(current("passer-1"), {
        seatNumber: null,
        isMuted: true,
        ...(/role = 'AUDIENCE'/.test(text) ? { role: "AUDIENCE" } : {}),
      });
      return 1;
    }
    throw new Error(`Unexpected raw write: ${text}`);
  });
  prisma.$transaction.mockImplementation(async (callback) => {
    if (options.targetAtTransaction === null) {
      state.participants = state.participants.filter(
        (row) => row.userId !== "acceptor-1",
      );
    } else if (options.targetAtTransaction) {
      Object.assign(current("acceptor-1"), options.targetAtTransaction);
    }
    const before = clone(state.participants);
    try {
      if (typeof callback !== "function")
        throw new Error("Expected callback transaction");
      return await callback(prisma);
    } catch (error) {
      state.participants = before;
      throw error;
    }
  });
  const req = {
    params: { id: "room-1", offerId: "offer-123" },
    user: { id: "acceptor-1" },
  };
  const res = {};
  const next = jest.fn();
  return {
    room,
    state,
    current,
    req,
    res,
    next,
    accept: async () => {
      await acceptMicOffer(req, res, next);
      expect(next).not.toHaveBeenCalled();
      return res;
    },
  };
}

function expectNoExternalMutation() {
  expect(prisma.$executeRaw).not.toHaveBeenCalled();
  expect(sfuRevokePublish).not.toHaveBeenCalled();
  expect(sfuEvict).not.toHaveBeenCalled();
  expect(getIo().emit).not.toHaveBeenCalled();
}

describe("Phase 3A-3B1B: actual Mic Pass recipient consent and role safety", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const channelEmits = {};
    const toEmit = jest.fn();
    const io = {
      emit: jest.fn(),
      to: jest.fn().mockImplementation((channel) => {
        if (!channelEmits[channel]) {
          channelEmits[channel] = jest.fn((...args) => toEmit(...args));
        }
        return { emit: channelEmits[channel] };
      }),
      channelEmits,
      toEmit,
    };
    getIo.mockReturnValue(io);
  });

  test("A/D/L. audience is seated SPEAKER muted; HTTP, role/mute events and snapshot agree", async () => {
    const h = setup();
    await h.accept();
    expect(h.res.statusCode).toBe(200);
    expect(h.current("acceptor-1")).toEqual(
      expect.objectContaining({
        role: "SPEAKER",
        seatNumber: 3,
        isMuted: true,
        handRaised: false,
      }),
    );
    expect(h.res.body.data).toEqual(
      expect.objectContaining({
        targetId: "acceptor-1",
        targetRole: "SPEAKER",
        seatNumber: 3,
        isMuted: true,
        passerRole: "AUDIENCE",
        sfuEnforced: true,
        sfuEnforcementReason: "UPDATED",
      }),
    );
    const targetWrite = prisma.$executeRaw.mock.calls.find((call) =>
      /SET seatNumber = \?/.test(sqlText(call)),
    );
    expect(sqlText(targetWrite)).toMatch(/role = 'SPEAKER', isMuted = 1/);
    expect(sqlText(targetWrite)).toMatch(/isActive = 1/);
    expect(sqlText(targetWrite)).toMatch(/role = 'AUDIENCE'/);
    expect(sqlText(targetWrite)).toMatch(/seatNumber IS NULL/);
    const io = getIo();
    expect(io.emit).not.toHaveBeenCalled();
    expect(io.toEmit).toHaveBeenCalledWith(
      "voice:role_changed",
      expect.objectContaining({
        userId: "acceptor-1",
        role: "SPEAKER",
        seatNumber: 3,
        isMuted: true,
      }),
    );
    expect(io.toEmit).toHaveBeenCalledWith(
      "voice:mute_changed",
      expect.objectContaining({
        userId: "acceptor-1",
        seatNumber: 3,
        isMuted: true,
      }),
    );
    expect(io.toEmit).toHaveBeenCalledWith(
      "voice:mic_received",
      expect.objectContaining({ seatNumber: 3, isMuted: true }),
    );
    // Channel routing assertion: mic_received must go to the user channel, not the room channel
    const ACCEPTOR_ID = 'acceptor-1';
    const ROOM_ID = 'room-1';
    expect(io.to).toHaveBeenCalledWith(`user:${ACCEPTOR_ID}`);
    expect(io.channelEmits[`user:${ACCEPTOR_ID}`]).toHaveBeenCalledWith(
      'voice:mic_received',
      expect.objectContaining({ roomId: ROOM_ID }),
    );
    expect(io.toEmit).toHaveBeenCalledWith(
      "voice:mic_passed",
      expect.objectContaining({
        targetId: "acceptor-1",
        seatNumber: 3,
        isMuted: true,
      }),
    );
    // Room-scoped events must go to the room channel, not the user channel
    expect(io.to).toHaveBeenCalledWith(`voice:${ROOM_ID}`);
    expect(io.channelEmits[`voice:${ROOM_ID}`]).toHaveBeenCalledWith(
      'voice:mic_passed',
      expect.any(Object),
    );
    const snapshot = io.toEmit.mock.calls.find(
      ([event]) => event === "voice:stage_state",
    )[1];
    expect(snapshot).toEqual(
      expect.objectContaining({ roomId: "room-1", stateVersion: 7 }),
    );
    for (const row of snapshot.stageParticipants) {
      expect(row).toEqual(
        expect.objectContaining({
          role: h.current(row.userId).role,
          seatNumber: h.current(row.userId).seatNumber,
          isMuted: h.current(row.userId).isMuted,
        }),
      );
    }
    expect(snapshot.stageParticipants).toHaveLength(2);
    expect(getNextStageVersion).toHaveBeenCalledWith("room-1");
    expect(sfuRevokePublish).toHaveBeenCalledTimes(1);
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "passer-1",
      false,
      "[voice:mic-pass-demote]",
    );
    expect(sfuEvict).not.toHaveBeenCalled();
  });

  test("B. SPEAKER passer releases seat muted and becomes AUDIENCE with guarded update", async () => {
    const h = setup();
    await h.accept();
    expect(h.current("passer-1")).toEqual(
      expect.objectContaining({
        role: "AUDIENCE",
        seatNumber: null,
        isMuted: true,
      }),
    );
    const call = prisma.$executeRaw.mock.calls[0];
    expect(sqlText(call)).toMatch(
      /SET seatNumber = NULL, role = 'AUDIENCE', isMuted = 1/,
    );
    expect(sqlText(call)).toMatch(/isActive = 1/);
    expect(sqlText(call)).toMatch(/AND role = \?/);
    expect(sqlText(call)).toMatch(/AND seatNumber = \?/);
    expect(call).toEqual(expect.arrayContaining(["SPEAKER", 3]));
    expect(getIo().emit).not.toHaveBeenCalled();
    expect(getIo().toEmit).toHaveBeenCalledWith(
      "voice:mute_changed",
      expect.objectContaining({
        userId: "passer-1",
        seatNumber: null,
        isMuted: true,
      }),
    );
  });

  test("H. MODERATOR passer retains role when unseated and revoked", async () => {
    const h = setup({ passer: { role: "MODERATOR", seatNumber: 2 } });
    await h.accept();
    expect(h.res.statusCode).toBe(200);
    expect(h.current("passer-1")).toEqual(
      expect.objectContaining({
        role: "MODERATOR",
        seatNumber: null,
        isMuted: true,
      }),
    );
    expect(h.res.body.data.passerRole).toBe("MODERATOR");
    expect(sqlText(prisma.$executeRaw.mock.calls[0])).not.toContain(
      "role = 'AUDIENCE'",
    );
    expect(getIo().emit).not.toHaveBeenCalled();
    expect(getIo().toEmit).toHaveBeenCalledWith(
      "voice:role_changed",
      expect.objectContaining({
        userId: "passer-1",
        role: "MODERATOR",
        seatNumber: null,
      }),
    );
    expect(sfuRevokePublish).toHaveBeenCalledWith(
      "room-1",
      "passer-1",
      false,
      "[voice:mic-pass-demote]",
    );
  });

  test("G. HOST retains Seat 1; recipient gets lowest free allowed seat without HOST revoke", async () => {
    const h = setup({
      passer: { role: "HOST", seatNumber: 1 },
      room: { lockedSeats: [1] },
    });
    await h.accept();
    expect(h.res.statusCode).toBe(200);
    expect(h.current("passer-1")).toEqual(
      expect.objectContaining({ role: "HOST", seatNumber: 1, isMuted: false }),
    );
    expect(h.current("acceptor-1").seatNumber).toBe(3);
    expect(h.res.body.data).toEqual(
      expect.objectContaining({
        passerRole: "HOST",
        sfuEnforced: true,
        sfuEnforcementReason: "HOST_EXEMPT",
      }),
    );
    expect(sfuRevokePublish).not.toHaveBeenCalled();
    expect(sfuEvict).not.toHaveBeenCalled();
  });

  test("J. allMuted allows seating muted and continues denying recipient publication", async () => {
    const h = setup({ room: { allMuted: true } });
    await h.accept();
    expect(h.res.statusCode).toBe(200);
    expect(h.current("acceptor-1").isMuted).toBe(true);
    expect(
      getVoiceAudioPermission({
        participant: { ...h.current("acceptor-1"), isMuted: false },
        room: h.room,
      }),
    ).toEqual({ canPublishAudio: false, reason: "ALL_MUTED" });
    expect(sfuRevokePublish.mock.calls.every((call) => call[2] === false)).toBe(
      true,
    );
  });

  test("K. micLocked rejects before participant or transaction mutations", async () => {
    const h = setup({ room: { micLocked: true } });
    await h.accept();
    expect(h.res.statusCode).toBe(403);
    expect(h.res.body.message).toMatch(/mic is locked/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoExternalMutation();
  });

  test.each(["MODERATOR", "HOST", "SPEAKER"])(
    "I. pending offer cannot demote current %s recipient",
    async (role) => {
      const h = setup({ target: { role } });
      await h.accept();
      expect(h.res.statusCode).toBe(409);
      expect(h.current("acceptor-1").role).toBe(role);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expectNoExternalMutation();
    },
  );

  test.each([
    ["seated audience", { seatNumber: 5 }],
    ["inactive audience", { isActive: false }],
  ])("I. pending offer rejects %s recipient safely", async (_label, target) => {
    const h = setup({ target });
    await h.accept();
    expect(h.res.statusCode).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoExternalMutation();
  });

  test.each([
    ["new moderator", { role: "MODERATOR" }],
    ["new host", { role: "HOST" }],
    ["new speaker", { role: "SPEAKER" }],
    ["new seat", { seatNumber: 6 }],
    ["departed recipient", { isActive: false }],
    ["deleted recipient", null],
  ])(
    "I. transaction revalidates %s before any seat release",
    async (_label, targetAtTransaction) => {
      const h = setup({ targetAtTransaction });
      await h.accept();
      expect(h.res.statusCode).toBe(409);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.current("passer-1")).toEqual(
        expect.objectContaining({ role: "SPEAKER", seatNumber: 3 }),
      );
      if (targetAtTransaction?.role)
        expect(h.current("acceptor-1").role).toBe(targetAtTransaction.role);
      expectNoExternalMutation();
    },
  );

  test("I. recipient guarded update count zero rolls back outgoing seat release", async () => {
    const h = setup({ targetUpdateCount: 0 });
    await h.accept();
    expect(h.res.statusCode).toBe(409);
    expect(h.current("passer-1")).toEqual(
      expect.objectContaining({
        role: "SPEAKER",
        seatNumber: 3,
        isMuted: false,
      }),
    );
    expect(h.current("acceptor-1")).toEqual(
      expect.objectContaining({
        role: "AUDIENCE",
        seatNumber: null,
        isMuted: true,
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(sfuRevokePublish).not.toHaveBeenCalled();
    expect(getIo().emit).not.toHaveBeenCalled();
  });

  test("outgoing guarded update count zero rejects before seating recipient", async () => {
    const h = setup({ passerUpdateCount: 0 });
    await h.accept();
    expect(h.res.statusCode).toBe(409);
    expect(h.current("acceptor-1").seatNumber).toBeNull();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(sfuRevokePublish).not.toHaveBeenCalled();
    expect(getIo().emit).not.toHaveBeenCalled();
  });

  test.each([
    ["reserved Seat 1", { role: "MODERATOR", seatNumber: 1 }, {}],
    ["locked seat", { seatNumber: 3 }, { lockedSeats: [2] }],
    ["out-of-range seat", { seatNumber: 13 }, {}],
    ["non-integer seat", { seatNumber: 2.5 }, {}],
    ["unseated passer", { seatNumber: null }, {}],
  ])(
    "N. rejects transfer of %s without alternate allocation",
    async (_label, passer, room) => {
      const h = setup({ passer, room });
      await h.accept();
      expect([400, 409]).toContain(h.res.statusCode);
      expect(h.current("acceptor-1").seatNumber).toBeNull();
      expectNoExternalMutation();
    },
  );

  test("N. HOST pass with full stage rejects without eviction", async () => {
    const h = setup({
      passer: { role: "HOST", seatNumber: 1 },
      room: { maxSpeakers: 2 },
      others: [
        { userId: "other", role: "SPEAKER", seatNumber: 2, isActive: true },
      ],
    });
    await h.accept();
    expect(h.res.statusCode).toBe(400);
    expect(h.current("passer-1").seatNumber).toBe(1);
    expect(h.current("other").seatNumber).toBe(2);
    expectNoExternalMutation();
  });

  test("missing current passer row cannot fall back to cached HOST role", async () => {
    const h = setup({ noPasserRow: true, offer: { passerRole: "HOST" } });
    await h.accept();
    expect([400, 409]).toContain(h.res.statusCode);
    expectNoExternalMutation();
  });

  test("inactive outgoing passer rejects without modifying participants", async () => {
    const h = setup({ passer: { isActive: false } });
    await h.accept();
    expect([400, 409]).toContain(h.res.statusCode);
    expectNoExternalMutation();
  });

  test.each(["UPDATE_FAILED", "TIMEOUT", "NOT_CONFIGURED", "NOT_FOUND"])(
    "outgoing SFU %s is unconfirmed while consent state remains muted",
    async (reason) => {
      const h = setup();
      sfuRevokePublish.mockResolvedValue({ enforced: false, reason });
      await h.accept();
      expect(h.res.statusCode).toBe(200);
      expect(h.res.body.data).toEqual(
        expect.objectContaining({
          sfuEnforced: false,
          sfuEnforcementReason: reason,
          isMuted: true,
        }),
      );
      expect(h.current("acceptor-1").isMuted).toBe(true);
      expect(h.current("passer-1").seatNumber).toBeNull();
      expect(sfuEvict).not.toHaveBeenCalled();
    },
  );

  test("empty outgoing SFU result is reported as NO_RESULT rather than enforced", async () => {
    const h = setup();
    sfuRevokePublish.mockResolvedValue(undefined);
    await h.accept();
    expect(h.res.statusCode).toBe(200);
    expect(h.res.body.data).toEqual(
      expect.objectContaining({
        sfuEnforced: false,
        sfuEnforcementReason: "NO_RESULT",
      }),
    );
  });
});
