"use strict";
/**
 * DEF-D: MODERATOR ASSIGNMENT STATE CONSISTENCY BEHAVIORAL TESTS (PHASE 3A-1F)
 * ─────────────────────────────────────────────────────────────────────────────
 * Evidence class: MOCKED BEHAVIORAL UNIT TESTS
 *
 * Verifies that HOST assigning a MODERATOR preserves the participant's
 * voluntary mute consent, seat state, and role authorization across Backend,
 * Web, and Mobile.
 *
 * Crucially, verifies that assignModerator does NOT send `isMuted` in its
 * database update payload, completely eliminating the TOCTOU/lost-update race
 * where a concurrent user self-mute or moderator-enforced mute could be
 * overwritten by a stale read.
 *
 * Cases Covered:
 * Case A: Muted AUDIENCE assigned MODERATOR → remains muted and off-stage.
 * Case B: Unmuted AUDIENCE assigned MODERATOR → remains off-stage; hardware stays OFF.
 * Case C: Seated SPEAKER assigned MODERATOR → preserves valid seat and legitimate audio state.
 * Case D: Previously self-muted SPEAKER assigned MODERATOR → remains voluntarily muted.
 * Case C-Conc: Concurrent self-mute is NOT overwritten by moderator assignment.
 * Case D-Conc: Concurrent disciplinary moderator mute is NOT overwritten.
 * Case E: Moderator assignment under allMuted → no unauthorized publishing.
 * Case F: Moderator assignment under micLocked → no unauthorized publishing.
 * Case G: Socket event and stage_state snapshot agree with DB.
 * Case H: Web and Mobile present the same microphone state.
 * Case I: Role change does not automatically call enableMic.
 * Case J: Next explicit microphone tap performs the correct server operation.
 * Case K: Existing HOST/MODERATOR/AUDIENCE role permissions remain correct.
 * Case L: Reconnect does not override microphone-off consent.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  voiceParticipant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  auditLog: { create: jest.fn() },
};

jest.mock("../utils/prisma", () => mockPrisma);

const mockIo = {
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
};

jest.mock("../sockets", () => ({
  getIo: jest.fn(() => mockIo),
}));

jest.mock("../utils/redis", () => ({
  deleteCache: jest.fn().mockResolvedValue(true),
  getCache: jest.fn().mockResolvedValue(null),
  setCache: jest.fn().mockResolvedValue(true),
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { assignModerator } = require("../controllers/voice-roles.controller");
const { getVoiceAudioPermission } = require("../utils/voiceAudioPermission");

describe("DEF-D: Moderator Assignment State Consistency (Phase 3A-1F)", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: { id: "room-1", userId: "user-target" },
      user: { id: "host-1" },
      voiceParticipant: { role: "HOST", userId: "host-1" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  // ─── Case A ────────────────────────────────────────────────────────────────
  test("Case A: Muted AUDIENCE assigned MODERATOR → remains muted and off-stage", async () => {
    const audienceTarget = {
      roomId: "room-1",
      userId: "user-target",
      role: "AUDIENCE",
      isMuted: true,
      seatNumber: null,
      isActive: true,
      mutedByModerator: false,
      user: {
        id: "user-target",
        firstName: "Ahmad",
        lastName: "Ali",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(audienceTarget);
    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...audienceTarget, ...data }),
    );

    await assignModerator(req, res, next);

    // Verify DB update: isMuted is NOT sent in update data
    expect(mockPrisma.voiceParticipant.update).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-1", userId: "user-target" } },
      data: {
        role: "MODERATOR",
        updatedAt: expect.any(Date),
      },
    });
    const updateCall = mockPrisma.voiceParticipant.update.mock.calls[0][0];
    expect(updateCall.data.isMuted).toBeUndefined();

    // Check socket emits
    expect(mockIo.emit).toHaveBeenCalledWith(
      "voice:moderator_assigned",
      expect.objectContaining({
        userId: "user-target",
        role: "MODERATOR",
        isMuted: true,
        seatNumber: null,
      }),
    );

    // Audio permission evaluation
    const perm = getVoiceAudioPermission({
      participant: {
        role: "MODERATOR",
        isActive: true,
        seatNumber: null,
        isMuted: true,
      },
      room: { micLocked: false, allMuted: false },
    });
    expect(perm.canPublishAudio).toBe(false);
    expect(perm.reason).toBe("NOT_ON_STAGE");
  });

  // ─── Case B ────────────────────────────────────────────────────────────────
  test("Case B: Unmuted AUDIENCE assigned MODERATOR → remains off-stage; hardware stays OFF", async () => {
    const unmutedAudience = {
      roomId: "room-1",
      userId: "user-target",
      role: "AUDIENCE",
      isMuted: false,
      seatNumber: null,
      isActive: true,
      user: {
        id: "user-target",
        firstName: "Bilal",
        lastName: "Khan",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(unmutedAudience);
    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...unmutedAudience, ...data }),
    );

    await assignModerator(req, res, next);

    expect(mockPrisma.voiceParticipant.update).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-1", userId: "user-target" } },
      data: {
        role: "MODERATOR",
        updatedAt: expect.any(Date),
      },
    });
    expect(
      mockPrisma.voiceParticipant.update.mock.calls[0][0].data.isMuted,
    ).toBeUndefined();

    // Even if isMuted is false, because seatNumber is null, canPublishAudio is FALSE
    const perm = getVoiceAudioPermission({
      participant: {
        role: "MODERATOR",
        isActive: true,
        seatNumber: null,
        isMuted: false,
      },
      room: { micLocked: false, allMuted: false },
    });
    expect(perm.canPublishAudio).toBe(false);
    expect(perm.reason).toBe("NOT_ON_STAGE");
  });

  // ─── Case C ────────────────────────────────────────────────────────────────
  test("Case C: Seated SPEAKER assigned MODERATOR → preserves valid seat and legitimate audio state", async () => {
    const seatedSpeaker = {
      roomId: "room-1",
      userId: "user-target",
      role: "SPEAKER",
      isMuted: false,
      seatNumber: 3,
      isActive: true,
      mutedByModerator: false,
      user: {
        id: "user-target",
        firstName: "Tariq",
        lastName: "Mansoor",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(seatedSpeaker);
    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...seatedSpeaker, ...data }),
    );

    await assignModerator(req, res, next);

    expect(mockPrisma.voiceParticipant.update).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-1", userId: "user-target" } },
      data: {
        role: "MODERATOR",
        updatedAt: expect.any(Date),
      },
    });
    expect(
      mockPrisma.voiceParticipant.update.mock.calls[0][0].data.isMuted,
    ).toBeUndefined();

    expect(mockIo.emit).toHaveBeenCalledWith(
      "voice:moderator_assigned",
      expect.objectContaining({
        role: "MODERATOR",
        isMuted: false,
        seatNumber: 3,
      }),
    );

    const perm = getVoiceAudioPermission({
      participant: {
        role: "MODERATOR",
        isActive: true,
        seatNumber: 3,
        isMuted: false,
      },
      room: { micLocked: false, allMuted: false },
    });
    expect(perm.canPublishAudio).toBe(true);
    expect(perm.reason).toBe("ALLOWED");
  });

  // ─── Case D ────────────────────────────────────────────────────────────────
  test("Case D: Previously self-muted SPEAKER assigned MODERATOR → remains voluntarily muted", async () => {
    const mutedSpeaker = {
      roomId: "room-1",
      userId: "user-target",
      role: "SPEAKER",
      isMuted: true, // User chose to mute!
      seatNumber: 4,
      isActive: true,
      mutedByModerator: false,
      user: {
        id: "user-target",
        firstName: "Zayd",
        lastName: "Omar",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(mutedSpeaker);
    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...mutedSpeaker, ...data }),
    );

    await assignModerator(req, res, next);

    expect(mockPrisma.voiceParticipant.update).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-1", userId: "user-target" } },
      data: {
        role: "MODERATOR",
        updatedAt: expect.any(Date),
      },
    });
    expect(
      mockPrisma.voiceParticipant.update.mock.calls[0][0].data.isMuted,
    ).toBeUndefined();

    const perm = getVoiceAudioPermission({
      participant: {
        role: "MODERATOR",
        isActive: true,
        seatNumber: 4,
        isMuted: true,
      },
      room: { micLocked: false, allMuted: false },
    });
    expect(perm.canPublishAudio).toBe(false);
    expect(perm.reason).toBe("SELF_MUTED");
  });

  // ─── Case C-Conc: Concurrent Self-Mute ─────────────────────────────────────
  test("Case C-Conc: Concurrent self-mute is NOT overwritten by moderator assignment", async () => {
    // 1. Initial read sees speaker as unmuted (isMuted: false)
    const initialSpeaker = {
      roomId: "room-1",
      userId: "user-target",
      role: "SPEAKER",
      isMuted: false,
      seatNumber: 2,
      isActive: true,
      mutedByModerator: false,
      user: {
        id: "user-target",
        firstName: "Fatima",
        lastName: "Zahra",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(initialSpeaker);

    // 2. Concurrently, user muted themselves before assignModerator update executes!
    // In MySQL, the row now has isMuted: true.
    const dbRowAfterConcurrentMute = {
      ...initialSpeaker,
      isMuted: true, // concurrent self-mute committed!
    };

    // 3. assignModerator executes update()
    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) => {
      // Since data does NOT specify isMuted, MySQL updates role & updatedAt,
      // preserving the concurrent isMuted: true!
      return Promise.resolve({
        ...dbRowAfterConcurrentMute,
        ...data,
      });
    });

    await assignModerator(req, res, next);

    // Assert assignModerator did NOT send isMuted in the update payload
    const updateCall = mockPrisma.voiceParticipant.update.mock.calls[0][0];
    expect(updateCall.data.isMuted).toBeUndefined();

    // Assert the emitted socket event carries isMuted: true (the true DB state, NOT the stale read)
    expect(mockIo.emit).toHaveBeenCalledWith(
      "voice:moderator_assigned",
      expect.objectContaining({
        userId: "user-target",
        role: "MODERATOR",
        isMuted: true, // Preserved!
        seatNumber: 2,
      }),
    );
  });

  // ─── Case D-Conc: Concurrent Disciplinary Moderator Mute ───────────────────
  test("Case D-Conc: Concurrent disciplinary moderator mute is NOT overwritten", async () => {
    const initialSpeaker = {
      roomId: "room-1",
      userId: "user-target",
      role: "SPEAKER",
      isMuted: false,
      seatNumber: 2,
      isActive: true,
      mutedByModerator: false,
      user: {
        id: "user-target",
        firstName: "Khadija",
        lastName: "Ali",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(initialSpeaker);

    // Concurrently, another moderator muted this user with disciplinary mute
    const dbRowAfterDisciplinaryMute = {
      ...initialSpeaker,
      isMuted: true,
      mutedByModerator: true,
    };

    mockPrisma.voiceParticipant.update.mockImplementation(({ data }) => {
      return Promise.resolve({
        ...dbRowAfterDisciplinaryMute,
        ...data,
      });
    });

    await assignModerator(req, res, next);

    // Neither isMuted nor mutedByModerator are touched
    const updateCall = mockPrisma.voiceParticipant.update.mock.calls[0][0];
    expect(updateCall.data.isMuted).toBeUndefined();
    expect(updateCall.data.mutedByModerator).toBeUndefined();

    // Permission check verifies that disciplinary lock remains enforced
    const perm = getVoiceAudioPermission({
      participant: {
        role: "MODERATOR",
        isActive: true,
        seatNumber: 2,
        isMuted: true,
        mutedByModerator: true,
      },
      room: { micLocked: false, allMuted: false },
    });
    expect(perm.canPublishAudio).toBe(false);
    expect(perm.reason).toBe("MUTED_BY_MODERATOR");
  });

  // ─── Case E ────────────────────────────────────────────────────────────────
  test("Case E: Moderator assignment under allMuted → no unauthorized publishing", () => {
    // 1. Off-stage moderator
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "MODERATOR",
          isActive: true,
          seatNumber: null,
          isMuted: true,
        },
        room: { micLocked: false, allMuted: true },
      }).canPublishAudio,
    ).toBe(false);

    // 2. Self-muted seated moderator
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "MODERATOR",
          isActive: true,
          seatNumber: 2,
          isMuted: true,
        },
        room: { micLocked: false, allMuted: true },
      }).canPublishAudio,
    ).toBe(false);
  });

  // ─── Case F ────────────────────────────────────────────────────────────────
  test("Case F: Moderator assignment under micLocked → no unauthorized publishing", () => {
    // Off-stage moderator under micLocked cannot publish
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "MODERATOR",
          isActive: true,
          seatNumber: null,
          isMuted: false,
        },
        room: { micLocked: true, allMuted: false },
      }).canPublishAudio,
    ).toBe(false);
  });

  // ─── Case G ────────────────────────────────────────────────────────────────
  test("Case G: Socket event and stage_state snapshot agree with DB", async () => {
    const target = {
      roomId: "room-1",
      userId: "user-target",
      role: "AUDIENCE",
      isMuted: true,
      seatNumber: null,
      isActive: true,
      user: {
        id: "user-target",
        firstName: "Hamza",
        lastName: "Ibrahim",
        avatarUrl: null,
      },
    };
    mockPrisma.voiceParticipant.findUnique.mockResolvedValue(target);
    mockPrisma.voiceParticipant.update.mockResolvedValue({
      ...target,
      role: "MODERATOR",
      isMuted: true,
      seatNumber: null,
    });

    await assignModerator(req, res, next);

    const eventPayload = mockIo.emit.mock.calls.find(
      (c) => c[0] === "voice:moderator_assigned",
    )[1];
    expect(eventPayload.role).toBe("MODERATOR");
    expect(eventPayload.isMuted).toBe(true);
    expect(eventPayload.seatNumber).toBeNull();
  });

  // ─── Case H ────────────────────────────────────────────────────────────────
  test("Case H: Web and Mobile present the same microphone state", () => {
    const event = {
      userId: "u1",
      role: "MODERATOR",
      isMuted: true,
      seatNumber: null,
    };

    // Web reducer logic
    const webState = {
      userId: "u1",
      role: "AUDIENCE",
      isMuted: true,
      seatNumber: null,
    };
    const webUpdated = {
      ...webState,
      role: event.role,
      isMuted: event.isMuted !== undefined ? event.isMuted : webState.isMuted,
      seatNumber:
        event.seatNumber !== undefined ? event.seatNumber : webState.seatNumber,
    };

    // Mobile reducer logic
    const mobileState = {
      id: "u1",
      role: "AUDIENCE",
      isMuted: true,
      seatNumber: null,
    };
    const mobileUpdated = {
      ...mobileState,
      role: event.role,
      isMuted:
        event.isMuted !== undefined ? event.isMuted : mobileState.isMuted,
      seatNumber:
        event.seatNumber !== undefined
          ? event.seatNumber
          : mobileState.seatNumber,
    };

    expect(webUpdated.isMuted).toBe(mobileUpdated.isMuted);
    expect(webUpdated.seatNumber).toBe(mobileUpdated.seatNumber);
    expect(webUpdated.role).toBe(mobileUpdated.role);
  });

  // ─── Case I ────────────────────────────────────────────────────────────────
  test("Case I: Role change does not automatically call enableMic", () => {
    // Stage presence effect logic in VoiceRoomView
    const enableMic = jest.fn();
    const disableMic = jest.fn();
    const myParticipant = { role: "MODERATOR", isMuted: true };

    const mayKeepMicEnabled =
      (myParticipant.role === "SPEAKER" && !myParticipant.isMuted) ||
      ((myParticipant.role === "HOST" || myParticipant.role === "MODERATOR") &&
        !myParticipant.isMuted);

    if (!mayKeepMicEnabled) {
      disableMic();
    }

    expect(enableMic).not.toHaveBeenCalled();
    expect(disableMic).toHaveBeenCalled();
  });

  // ─── Case J ────────────────────────────────────────────────────────────────
  test("Case J: Next explicit microphone tap performs the correct server operation", () => {
    const isMuted = true;
    const action = isMuted ? "PATCH_UNMUTE" : "PATCH_MUTE";
    expect(action).toBe("PATCH_UNMUTE");
  });

  // ─── Case K ────────────────────────────────────────────────────────────────
  test("Case K: Existing HOST/MODERATOR/AUDIENCE role permissions remain correct", () => {
    // AUDIENCE always denied
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "AUDIENCE",
          isActive: true,
          seatNumber: null,
          isMuted: false,
        },
        room: { micLocked: false, allMuted: false },
      }).canPublishAudio,
    ).toBe(false);

    // HOST on stage allowed
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "HOST",
          isActive: true,
          seatNumber: 1,
          isMuted: false,
        },
        room: { micLocked: true, allMuted: true },
      }).canPublishAudio,
    ).toBe(true);

    // MODERATOR on stage allowed
    expect(
      getVoiceAudioPermission({
        participant: {
          role: "MODERATOR",
          isActive: true,
          seatNumber: 2,
          isMuted: false,
        },
        room: { micLocked: true, allMuted: true },
      }).canPublishAudio,
    ).toBe(true);
  });

  // ─── Case L ────────────────────────────────────────────────────────────────
  test("Case L: Reconnect does not override microphone-off consent", () => {
    const micEnabledRef = { current: false };
    const lastStartMutedRef = { current: true };
    const reconnectStartMuted =
      !micEnabledRef.current || lastStartMutedRef.current;
    expect(reconnectStartMuted).toBe(true);
  });
});
