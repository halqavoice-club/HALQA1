"use strict";

const fs = require("fs");
const path = require("path");
const {
  LIVE_CLASS_MICROPHONE_API_CONTRACT,
  MICROPHONE_AUTHORIZATION_MODES,
  MICROPHONE_AUTHORIZATION_REASONS,
  LEGACY_SESSION_START_REJECTION_MESSAGE,
  normalizeMicrophoneAuthorizationMode,
  isSfuAuthoritativeMode,
  classifyMicrophoneAuthorization,
  isTriggerLegacyStartRejection,
} = require("../utils/liveClassMicrophoneContract");
const {
  liveClassMicrophoneSchema,
} = require("../middleware/validators/liveClass.validator");

const root = path.resolve(__dirname, "..", "..");
const schema = fs.readFileSync(
  path.join(root, "prisma", "schema.prisma"),
  "utf8",
);
const migration = fs.readFileSync(
  path.join(
    root,
    "prisma",
    "migrations",
    "20261029_add_live_class_microphone_authority",
    "migration.sql",
  ),
  "utf8",
);
const controller = fs.readFileSync(
  path.join(root, "src", "controllers", "live-class.controller.js"),
  "utf8",
);

describe("SEC01-G-BE02-A Live Class microphone contract", () => {
  test("defines the self-service endpoint and durable idempotency boundary", () => {
    expect(LIVE_CLASS_MICROPHONE_API_CONTRACT).toEqual({
      method: "PATCH",
      path: "/live-classes/:id/microphone",
      idempotencyHeader: "Idempotency-Key",
      maximumIdempotencyKeyLength: 128,
    });
    expect(schema).toContain(
      "@@unique([liveClassId, actorUserId, idempotencyKey]",
    );
    expect(migration).toContain("`requestFingerprint` CHAR(64) NOT NULL");
  });

  test.each([
    { enabled: true, expectedVersion: 0 },
    { enabled: false, expectedVersion: "42" },
    { enabled: true, expectedVersion: 7n },
  ])("accepts the strict request contract: %p", (request) => {
    expect(liveClassMicrophoneSchema.safeParse(request).success).toBe(true);
  });

  test.each([
    {},
    { enabled: "true", expectedVersion: 0 },
    { enabled: true, expectedVersion: -1 },
    { enabled: true, expectedVersion: "1.5" },
    { enabled: true, expectedVersion: 1, userId: "caller-selected-target" },
  ])("rejects malformed or caller-targeted requests: %p", (request) => {
    expect(liveClassMicrophoneSchema.safeParse(request).success).toBe(false);
  });

  test("unknown and legacy modes fail closed and cannot claim SFU enforcement", () => {
    for (const mode of [
      undefined,
      null,
      "",
      "UNKNOWN",
      MICROPHONE_AUTHORIZATION_MODES.LEGACY,
    ]) {
      expect(normalizeMicrophoneAuthorizationMode(mode)).toBe(
        MICROPHONE_AUTHORIZATION_MODES.LEGACY,
      );
      expect(isSfuAuthoritativeMode(mode)).toBe(false);
      expect(classifyMicrophoneAuthorization(mode)).toEqual({
        canPublishAudio: false,
        sfuEnforced: false,
        authorizationReason:
          MICROPHONE_AUTHORIZATION_REASONS.LEGACY_STATE_UNKNOWN,
      });
    }
  });

  test("protected mode still fails closed until Unit B supplies current authorization and confirmed SFU evidence", () => {
    expect(
      classifyMicrophoneAuthorization(
        MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE,
      ),
    ).toEqual({
      canPublishAudio: false,
      sfuEnforced: false,
      authorizationReason:
        MICROPHONE_AUTHORIZATION_REASONS.AUTHORIZATION_STATE_UNKNOWN,
    });
  });
});

describe("SEC01-G-BE02-A session-bound migration policy", () => {
  test("backfills existing classes as LEGACY before changing the insert default", () => {
    const addLegacy = migration.indexOf("NOT NULL DEFAULT 'LEGACY'");
    const protectedDefault = migration.indexOf(
      "SET DEFAULT 'SFU_AUTHORITATIVE'",
    );
    expect(addLegacy).toBeGreaterThan(-1);
    expect(protectedDefault).toBeGreaterThan(addLegacy);
  });

  test("preserves historical isMuted and marks participant authorization evidence unknown", () => {
    expect(migration).not.toMatch(/UPDATE\s+`?live_class_participants`?/i);
    expect(migration).not.toMatch(/MODIFY(?:\s+COLUMN)?\s+`?isMuted`?/i);
    expect(migration).toContain(
      "`microphone_intent` ENUM('UNKNOWN', 'OFF', 'ON') NOT NULL DEFAULT 'UNKNOWN'",
    );
    expect(migration).toContain("NOT NULL DEFAULT 'UNKNOWN'");
  });

  test("prevents protected downgrade, live legacy conversion, and restart bypasses", () => {
    expect(migration).toContain(
      "OLD.`microphone_authorization_mode` = 'SFU_AUTHORITATIVE'",
    );
    expect(migration).toContain("OLD.`status` = 'LIVE'");
    expect(migration).toContain(
      "NEW.`microphone_authorization_mode` <> 'LEGACY'",
    );
    expect(migration).toContain("OLD.`status` <> 'SCHEDULED'");
    expect(migration).not.toMatch(/^\s*DELIMITER\b/im);
  });

  test("new SCHOOL and PUBLIC creation paths both assign protected mode explicitly", () => {
    const rawCreate = controller.slice(
      controller.indexOf("async function rawCreateLiveClass"),
      controller.indexOf("async function rawFindLiveClass"),
    );
    expect(rawCreate).toContain("microphone_authorization_mode");
    expect(rawCreate).toContain(
      "MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE",
    );

    const create = controller.slice(
      controller.indexOf("async function createLiveClass"),
      controller.indexOf("async function updateLiveClass"),
    );
    expect(create.match(/rawCreateLiveClass\(/g)).toHaveLength(2);
  });

  test("scheduled legacy sessions upgrade explicitly before start while active legacy sessions cannot use that path", () => {
    const helper = controller.slice(
      controller.indexOf(
        "async function ensureProtectedScheduledMicrophoneMode",
      ),
      controller.indexOf("/**\n * Lightweight live class lookup"),
    );
    expect(helper).toContain("status = 'SCHEDULED'");
    expect(helper).toContain("microphone_authorization_mode = 'LEGACY'");
    expect(helper).toContain(
      "microphone_authorization_mode = 'SFU_AUTHORITATIVE'",
    );

    const start = controller.slice(
      controller.indexOf("async function startLiveClass"),
      controller.indexOf("//  END"),
    );
    expect(
      start.indexOf("ensureProtectedScheduledMicrophoneMode"),
    ).toBeLessThan(start.indexOf("status: 'LIVE'"));
    expect(start.indexOf("assertProtectedRuntimeReady")).toBeLessThan(
      start.indexOf("ensureProtectedScheduledMicrophoneMode"),
    );
    expect(start).toContain("lc.status === 'CANCELLED'");
  });
});

describe("SEC01-G-BE02-A isTriggerLegacyStartRejection", () => {
  test("returns true only when the message contains the legacy-start-guard rejection text", () => {
    expect(
      isTriggerLegacyStartRejection(
        new Error(
          `Some driver preamble :: SQLSTATE 45000 — ${LEGACY_SESSION_START_REJECTION_MESSAGE}`,
        ),
      ),
    ).toBe(true);
  });

  test.each([
    new Error("Connection refused"),
    new Error("ER_ROW_IS_REFERENCED_2: Cannot delete or update a parent row"),
    new Error("Cannot downgrade from SFU_AUTHORITATIVE to LEGACY"),
    null,
    undefined,
    {},
    { message: null },
  ])("returns false for unrelated or non-error values: %p", (value) => {
    expect(isTriggerLegacyStartRejection(value)).toBe(false);
  });
});

// The controller closes over the shared prisma client from ../utils/prisma at
// module scope, so the dispatch tests mock that module. The mock mirrors the
// real export shape: utils/prisma exports the PrismaClient instance itself.
jest.mock("../utils/prisma", () => {
  const makeModel = () => {
    const target = {};
    return new Proxy(target, {
      get(obj, prop) {
        if (typeof prop !== "string") return undefined;
        if (!(prop in obj)) obj[prop] = jest.fn();
        return obj[prop];
      },
    });
  };
  const base = {
    $on: jest.fn(),
    $use: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };
  return new Proxy(base, {
    get(obj, prop) {
      if (typeof prop !== "string" || prop.startsWith("$")) {
        return prop in obj ? obj[prop] : undefined;
      }
      if (!(prop in obj)) obj[prop] = makeModel();
      return obj[prop];
    },
  });
});
jest.mock("../sockets", () => ({ getIo: () => null }));
jest.mock("../utils/feedLive", () => ({
  broadcastLiveStart: jest.fn(),
  broadcastLiveEnd: jest.fn(),
}));
jest.mock("../services/liveclass-microphone-authority.service", () => ({
  assertProtectedRuntimeReady: jest.fn(),
}));

describe("SEC01-G-BE02-A startLiveClass error dispatch", () => {
  let prismaMock;
  let startLiveClass;

  beforeAll(() => {
    prismaMock = require("../utils/prisma");
    // eslint-disable-next-line global-require
    ({ startLiveClass } = require("../controllers/live-class.controller"));
  });

  beforeEach(() => {
    prismaMock.$queryRawUnsafe.mockReset();
    prismaMock.$executeRawUnsafe.mockReset();
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);
  });

  function makeReqRes() {
    const req = {
      params: { id: "lc-dispatch-1" },
      user: { id: "host-user-1", role: "TEACHER" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  function enqueueHappyLookup() {
    const rawRow = {
      id: "lc-dispatch-1",
      stream_type: "PUBLIC",
      schoolId: null,
      classId: null,
      teacherId: null,
      host_user_id: null,
      delegated_host_id: null,
      title: "Dispatch test class",
      description: null,
      scheduledAt: null,
      duration: null,
      status: "SCHEDULED",
      livekitRoomName: null,
      recordingUrl: null,
      coverImageUrl: null,
      maxParticipants: null,
      maxSpeakers: 20,
      isRecorded: 0,
      recordingStartedAt: null,
      chatEnabled: 1,
      handRaiseEnabled: 1,
      whiteboardEnabled: 1,
      quranPanelEnabled: 0,
      isOpenMic: 0,
      screenShareEnabled: 0,
      startedAt: null,
      endedAt: null,
      deletedAt: null,
      createdAt: new Date("2026-11-01T00:00:00Z"),
      updatedAt: new Date("2026-11-01T00:00:00Z"),
    };
    // 1st call: rawFindLiveClass — full row shaped by shapeLiveClassRow
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([rawRow]);
    // 2nd call: ensureProtectedScheduledMicrophoneMode — mode already
    // protected, so the helper is a no-op
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      {
        status: "SCHEDULED",
        microphone_authorization_mode: "SFU_AUTHORITATIVE",
      },
    ]);
  }

  test("returns HTTP 409 with a clean message when the legacy-start-guard trigger rejects the start", async () => {
    enqueueHappyLookup();
    prismaMock.$executeRawUnsafe.mockRejectedValueOnce(
      new Error(
        `PrismaClientKnownRequestError :: ${LEGACY_SESSION_START_REJECTION_MESSAGE}`,
      ),
    );

    const { req, res, next } = makeReqRes();
    await startLiveClass(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain("SQLSTATE");
    expect(payload).not.toContain("45000");
    expect(payload).not.toContain("trigger");
    expect(payload).not.toContain("SELECT");
    expect(payload).not.toContain("UPDATE live_classes");
    expect(res.json.mock.calls[0][0].message).toBe(
      "The microphone authorization mode must be upgraded before starting this class.",
    );
  });

  test("passes unrelated database failures through next(e) as 500", async () => {
    enqueueHappyLookup();
    const connectionError = new Error("Connection refused");
    prismaMock.$executeRawUnsafe.mockRejectedValueOnce(connectionError);

    const { req, res, next } = makeReqRes();
    await startLiveClass(req, res, next);

    expect(next).toHaveBeenCalledWith(connectionError);
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.json).not.toHaveBeenCalled();
  });
});
