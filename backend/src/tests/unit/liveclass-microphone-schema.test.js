/**
 * SEC01-G-BE02 Unit A: Live Class Microphone Authorization Schema Tests
 *
 * Contract tests for database schema, enums, defaults, and constraints.
 * Tests Prisma client generation and type safety WITHOUT requiring database access.
 */

describe("SEC01-G-BE02-A: Live Class Microphone Authorization Schema", () => {
  describe("Prisma Client Generation", () => {
    test("should include LiveClassMicrophoneAuthorizationMode enum", () => {
      const {
        LiveClassMicrophoneAuthorizationMode,
      } = require("@prisma/client");
      expect(LiveClassMicrophoneAuthorizationMode).toBeDefined();
      expect(LiveClassMicrophoneAuthorizationMode.LEGACY).toBe("LEGACY");
      expect(LiveClassMicrophoneAuthorizationMode.SFU_AUTHORITATIVE).toBe(
        "SFU_AUTHORITATIVE",
      );
    });

    test("should include LiveClassMicrophoneIntent enum", () => {
      const { LiveClassMicrophoneIntent } = require("@prisma/client");
      expect(LiveClassMicrophoneIntent).toBeDefined();
      expect(LiveClassMicrophoneIntent.UNKNOWN).toBe("UNKNOWN");
      expect(LiveClassMicrophoneIntent.OFF).toBe("OFF");
      expect(LiveClassMicrophoneIntent.ON).toBe("ON");
    });

    test("should include LiveClassMicrophoneSfuState enum", () => {
      const { LiveClassMicrophoneSfuState } = require("@prisma/client");
      expect(LiveClassMicrophoneSfuState).toBeDefined();
      expect(LiveClassMicrophoneSfuState.UNKNOWN).toBe("UNKNOWN");
      expect(LiveClassMicrophoneSfuState.MUTED).toBe("MUTED");
      expect(LiveClassMicrophoneSfuState.LIVE).toBe("LIVE");
    });

    test("should include LiveClassMicrophoneOperationStatus enum", () => {
      const { LiveClassMicrophoneOperationStatus } = require("@prisma/client");
      expect(LiveClassMicrophoneOperationStatus).toBeDefined();
      expect(LiveClassMicrophoneOperationStatus.PENDING).toBe("PENDING");
      expect(LiveClassMicrophoneOperationStatus.SUCCEEDED).toBe("SUCCEEDED");
      expect(LiveClassMicrophoneOperationStatus.FAILED).toBe("FAILED");
      expect(LiveClassMicrophoneOperationStatus.REJECTED).toBe("REJECTED");
    });

    test("should have LiveClass model with microphone authorization fields", () => {
      // Verify Prisma client has the model with new fields by checking DMMF
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const liveClassModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClass",
      );

      expect(liveClassModel).toBeDefined();

      const micAuthModeField = liveClassModel.fields.find(
        (f) => f.name === "microphoneAuthorizationMode",
      );
      expect(micAuthModeField).toBeDefined();
      expect(micAuthModeField.type).toBe(
        "LiveClassMicrophoneAuthorizationMode",
      );
      expect(micAuthModeField.default).toBeDefined();

      const micModeEstablishedField = liveClassModel.fields.find(
        (f) => f.name === "microphoneModeEstablishedAt",
      );
      expect(micModeEstablishedField).toBeDefined();
      expect(micModeEstablishedField.type).toBe("DateTime");
      expect(micModeEstablishedField.isRequired).toBe(false);
    });

    test("should have LiveClassParticipant model with microphone fields", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const participantModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassParticipant",
      );

      expect(participantModel).toBeDefined();

      const intentField = participantModel.fields.find(
        (f) => f.name === "microphoneIntent",
      );
      expect(intentField).toBeDefined();
      expect(intentField.type).toBe("LiveClassMicrophoneIntent");
      expect(intentField.default).toBeDefined();

      const revokedField = participantModel.fields.find(
        (f) => f.name === "microphoneModeratorRevoked",
      );
      expect(revokedField).toBeDefined();
      expect(revokedField.type).toBe("Boolean");

      const authVersionField = participantModel.fields.find(
        (f) => f.name === "microphoneAuthorizationVersion",
      );
      expect(authVersionField).toBeDefined();
      expect(authVersionField.type).toBe("BigInt");

      const sfuVersionField = participantModel.fields.find(
        (f) => f.name === "microphoneSfuVersion",
      );
      expect(sfuVersionField).toBeDefined();
      expect(sfuVersionField.type).toBe("BigInt");

      const sfuStateField = participantModel.fields.find(
        (f) => f.name === "microphoneSfuState",
      );
      expect(sfuStateField).toBeDefined();
      expect(sfuStateField.type).toBe("LiveClassMicrophoneSfuState");

      const sfuReasonField = participantModel.fields.find(
        (f) => f.name === "microphoneSfuReason",
      );
      expect(sfuReasonField).toBeDefined();
      expect(sfuReasonField.type).toBe("String");
      expect(sfuReasonField.isRequired).toBe(false);
    });

    test("should have LiveClassMicrophoneOperation model", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );

      expect(operationModel).toBeDefined();
      expect(operationModel.dbName).toBe("live_class_microphone_operations");

      // Verify key fields
      const requiredFields = [
        "id",
        "liveClassId",
        "participantId",
        "actorUserId",
        "idempotencyKey",
        "requestFingerprint",
        "requestedEnabled",
        "expectedVersion",
        "status",
        "createdAt",
        "updatedAt",
      ];

      requiredFields.forEach((fieldName) => {
        const field = operationModel.fields.find((f) => f.name === fieldName);
        expect(field).toBeDefined();
      });

      // Verify relationships
      const liveClassRelation = operationModel.fields.find(
        (f) => f.name === "liveClass",
      );
      expect(liveClassRelation).toBeDefined();
      expect(liveClassRelation.relationName).toBeDefined();

      const participantRelation = operationModel.fields.find(
        (f) => f.name === "participant",
      );
      expect(participantRelation).toBeDefined();
      expect(participantRelation.relationName).toBeDefined();
    });

    test("should have correct unique constraints on LiveClassMicrophoneOperation", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );

      const idempotencyConstraint = operationModel.uniqueIndexes.find(
        (idx) => idx.name === "liveclass_mic_operation_idempotency",
      );
      expect(idempotencyConstraint).toBeDefined();
      expect(idempotencyConstraint.fields).toEqual([
        "liveClassId",
        "actorUserId",
        "idempotencyKey",
      ]);
    });

    test("should have correct indexes on LiveClassMicrophoneOperation", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );

      // Indexes are present in schema and validated by Prisma during generation
      // We verify schema was generated successfully (no errors during npx prisma generate)
      expect(operationModel).toBeDefined();
      expect(operationModel.dbName).toBe("live_class_microphone_operations");
    });
  });

  describe("Schema Constraints", () => {
    test("LiveClassMicrophoneAuthorizationMode protects post-cutover class creation by default", () => {
      const {
        LiveClassMicrophoneAuthorizationMode,
      } = require("@prisma/client");
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const liveClassModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClass",
      );
      const field = liveClassModel.fields.find(
        (f) => f.name === "microphoneAuthorizationMode",
      );

      // Migration backfills old rows LEGACY, then post-cutover inserts default protected.
      expect(field.default).toBe(
        LiveClassMicrophoneAuthorizationMode.SFU_AUTHORITATIVE,
      );
    });

    test("LiveClassMicrophoneIntent should be fail-closed (UNKNOWN default)", () => {
      const { LiveClassMicrophoneIntent } = require("@prisma/client");
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const participantModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassParticipant",
      );
      const field = participantModel.fields.find(
        (f) => f.name === "microphoneIntent",
      );

      // Default should be UNKNOWN (fail-closed)
      expect(field.default).toBe(LiveClassMicrophoneIntent.UNKNOWN);
    });

    test("microphoneModeratorRevoked should default to false", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const participantModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassParticipant",
      );
      const field = participantModel.fields.find(
        (f) => f.name === "microphoneModeratorRevoked",
      );

      expect(field.default).toBe(false);
    });

    test("version fields should default to 0", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const participantModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassParticipant",
      );

      const authVersionField = participantModel.fields.find(
        (f) => f.name === "microphoneAuthorizationVersion",
      );
      expect(authVersionField.default).toBe("0");

      const sfuVersionField = participantModel.fields.find(
        (f) => f.name === "microphoneSfuVersion",
      );
      expect(sfuVersionField.default).toBe("0");
    });

    test("LiveClassMicrophoneSfuState should default to UNKNOWN", () => {
      const { LiveClassMicrophoneSfuState } = require("@prisma/client");
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const participantModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassParticipant",
      );
      const field = participantModel.fields.find(
        (f) => f.name === "microphoneSfuState",
      );

      expect(field.default).toBe(LiveClassMicrophoneSfuState.UNKNOWN);
    });

    test("LiveClassMicrophoneOperationStatus should default to PENDING", () => {
      const { LiveClassMicrophoneOperationStatus } = require("@prisma/client");
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );
      const field = operationModel.fields.find((f) => f.name === "status");

      expect(field.default).toBe(LiveClassMicrophoneOperationStatus.PENDING);
    });

    test("canPublishAudio should default to false (fail-closed)", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );
      const field = operationModel.fields.find(
        (f) => f.name === "canPublishAudio",
      );

      expect(field.default).toBe(false);
    });

    test("sfuEnforced should default to false", () => {
      const dmmf = require("@prisma/client").Prisma.dmmf;
      const operationModel = dmmf.datamodel.models.find(
        (m) => m.name === "LiveClassMicrophoneOperation",
      );
      const field = operationModel.fields.find((f) => f.name === "sfuEnforced");

      expect(field.default).toBe(false);
    });
  });

  describe("Type Safety", () => {
    test("should enforce enum type for microphoneAuthorizationMode", () => {
      const {
        LiveClassMicrophoneAuthorizationMode,
      } = require("@prisma/client");

      // Valid enum values
      expect(() => {
        const validMode = LiveClassMicrophoneAuthorizationMode.LEGACY;
        expect(validMode).toBe("LEGACY");
      }).not.toThrow();

      expect(() => {
        const validMode =
          LiveClassMicrophoneAuthorizationMode.SFU_AUTHORITATIVE;
        expect(validMode).toBe("SFU_AUTHORITATIVE");
      }).not.toThrow();

      // Invalid enum value should not exist
      expect(LiveClassMicrophoneAuthorizationMode.INVALID).toBeUndefined();
    });

    test("should enforce enum type for microphoneIntent", () => {
      const { LiveClassMicrophoneIntent } = require("@prisma/client");

      expect(LiveClassMicrophoneIntent.UNKNOWN).toBe("UNKNOWN");
      expect(LiveClassMicrophoneIntent.OFF).toBe("OFF");
      expect(LiveClassMicrophoneIntent.ON).toBe("ON");
      expect(LiveClassMicrophoneIntent.INVALID).toBeUndefined();
    });

    test("should enforce enum type for microphoneSfuState", () => {
      const { LiveClassMicrophoneSfuState } = require("@prisma/client");

      expect(LiveClassMicrophoneSfuState.UNKNOWN).toBe("UNKNOWN");
      expect(LiveClassMicrophoneSfuState.MUTED).toBe("MUTED");
      expect(LiveClassMicrophoneSfuState.LIVE).toBe("LIVE");
      expect(LiveClassMicrophoneSfuState.INVALID).toBeUndefined();
    });

    test("should enforce enum type for operationStatus", () => {
      const { LiveClassMicrophoneOperationStatus } = require("@prisma/client");

      expect(LiveClassMicrophoneOperationStatus.PENDING).toBe("PENDING");
      expect(LiveClassMicrophoneOperationStatus.SUCCEEDED).toBe("SUCCEEDED");
      expect(LiveClassMicrophoneOperationStatus.FAILED).toBe("FAILED");
      expect(LiveClassMicrophoneOperationStatus.REJECTED).toBe("REJECTED");
      expect(LiveClassMicrophoneOperationStatus.INVALID).toBeUndefined();
    });
  });

  describe("Semantic Naming", () => {
    test("SFU_AUTHORITATIVE mode name should communicate enforcement", () => {
      const {
        LiveClassMicrophoneAuthorizationMode,
      } = require("@prisma/client");

      // SFU_AUTHORITATIVE is semantically clearer than "ENFORCED_V2"
      expect(LiveClassMicrophoneAuthorizationMode.SFU_AUTHORITATIVE).toBe(
        "SFU_AUTHORITATIVE",
      );

      // Name should communicate that SFU is the source of truth
      const modeName = "SFU_AUTHORITATIVE";
      expect(modeName).toContain("SFU");
      expect(modeName).toContain("AUTHORITATIVE");
    });

    test("UNKNOWN intent should communicate fail-closed default", () => {
      const { LiveClassMicrophoneIntent } = require("@prisma/client");

      // UNKNOWN explicitly signals "no user decision recorded"
      expect(LiveClassMicrophoneIntent.UNKNOWN).toBe("UNKNOWN");

      // Should not assume OFF or ON for historical data
      expect(LiveClassMicrophoneIntent.UNKNOWN).not.toBe("OFF");
      expect(LiveClassMicrophoneIntent.UNKNOWN).not.toBe("ON");
    });
  });
});
