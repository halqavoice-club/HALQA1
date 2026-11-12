"use strict";

const fs = require("fs");
const path = require("path");
const {
  LIVE_CLASS_MICROPHONE_API_CONTRACT,
  MICROPHONE_AUTHORIZATION_MODES,
  MICROPHONE_AUTHORIZATION_REASONS,
  normalizeMicrophoneAuthorizationMode,
  isSfuAuthoritativeMode,
  classifyMicrophoneAuthorization,
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
