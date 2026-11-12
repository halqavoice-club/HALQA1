/**
 * F-02 Authorization Evidence MAC Verification Tests
 *
 * Verifies cryptographic authenticity of authorization evidence.
 *
 * SECURITY PROPERTIES:
 * - MAC verified before trusting evidence
 * - Forged evidence rejected
 * - Tampered evidence rejected
 * - Missing MAC rejected
 * - Wrong key rejected
 *
 * @jest-environment node
 */

"use strict";

const {
  validateMysqlCiTarget,
  buildMigrationChildEnvironment,
  buildReaderChildEnvironment,
  AUTHORIZATION_EVIDENCE_KIND,
  ROLE_USERS,
} = require("../../../test-safety/mysql-ci-target");
const crypto = require("crypto");

describe("F-02: Authorization Evidence MAC Verification", () => {
  let authorityKey;
  let testProfile;
  let testEvidence;

  beforeEach(() => {
    authorityKey = crypto.randomBytes(32);

    const runnerBinding = {
      runId: "12345",
      runAttempt: "1",
      containerId: "a".repeat(64),
      imageDigest: "sha256:" + "b".repeat(64),
      policyDigest: "sha256:" + "c".repeat(64),
      databaseName: "halqa_mysql8_ci_test_001",
    };

    testProfile = {
      protocol: "mysql:",
      endpointHost: "127.0.0.1",
      endpointPort: "3307",
      mysqlServerPort: "3306",
      databaseName: "halqa_mysql8_ci_test_001",
      username: ROLE_USERS.migration,
      effectiveUser: `${ROLE_USERS.migration}@%`,
      role: "migration",
      version: "8.4.0",
      charset: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
      expectedServerUuid: "dddddddd-dddd-4ddd-addd-dddddddddddd", // Valid UUID v4 format
      expectedServerHostname: "test-hostname",
      sqlModes: ["STRICT_ALL_TABLES"],
      globalPrivileges: ["USAGE"],
      schemaPrivileges: [
        "ALTER",
        "CREATE",
        "DELETE",
        "DROP",
        "INDEX",
        "INSERT",
        "REFERENCES",
        "SELECT",
        "UPDATE",
      ],
      runnerBinding,
    };

    // Create valid evidence with MAC
    const evidencePayload = {
      kind: AUTHORIZATION_EVIDENCE_KIND,
      operation: "migration",
      runId: runnerBinding.runId,
      runAttempt: runnerBinding.runAttempt,
      containerId: runnerBinding.containerId,
      imageDigest: runnerBinding.imageDigest,
      policyDigest: runnerBinding.policyDigest,
      databaseName: runnerBinding.databaseName,
    };

    const canonical = JSON.stringify(
      evidencePayload,
      Object.keys(evidencePayload).sort(),
    );
    const mac = crypto
      .createHmac("sha256", authorityKey)
      .update(canonical)
      .digest("hex");

    testEvidence = {
      ...evidencePayload,
      mac,
    };
  });

  test("F-02-01: Valid evidence with correct MAC succeeds", () => {
    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        authorityKey,
      });
    }).not.toThrow();
  });

  test("F-02-02: Evidence with forged MAC is rejected", () => {
    const forgedEvidence = {
      ...testEvidence,
      mac: "f".repeat(64), // Forged MAC
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: forgedEvidence,
        authorityKey,
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-03: Evidence with missing MAC is rejected", () => {
    const noMacEvidence = {
      kind: AUTHORIZATION_EVIDENCE_KIND,
      operation: "migration",
      runId: testEvidence.runId,
      runAttempt: testEvidence.runAttempt,
      containerId: testEvidence.containerId,
      imageDigest: testEvidence.imageDigest,
      policyDigest: testEvidence.policyDigest,
      databaseName: testEvidence.databaseName,
      // No MAC field
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: noMacEvidence,
        authorityKey,
      });
    }).toThrow(/authorizationEvidence\.mac must be a non-empty/);
  });

  test("F-02-04: Evidence with wrong authority key is rejected", () => {
    const wrongKey = crypto.randomBytes(32);
    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        authorityKey: wrongKey, // Wrong key
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-05: Evidence with tampered runId is rejected", () => {
    const tamperedEvidence = {
      ...testEvidence,
      runId: "99999", // Tampered
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: tamperedEvidence,
        authorityKey,
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-06: Evidence with tampered containerId is rejected", () => {
    const tamperedEvidence = {
      ...testEvidence,
      containerId: "z".repeat(64), // Tampered
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: tamperedEvidence,
        authorityKey,
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-07: Evidence with invalid MAC format is rejected", () => {
    const invalidMacEvidence = {
      ...testEvidence,
      mac: "not-a-valid-hex", // Invalid format
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: invalidMacEvidence,
        authorityKey,
      });
    }).toThrow(/MAC must be 64-character hex string/);
  });

  test("F-02-08: Missing authority key is rejected", () => {
    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        // No authorityKey
      });
    }).toThrow(/authority key required/);
  });

  test("F-02-09: Short authority key is rejected", () => {
    const shortKey = crypto.randomBytes(16); // Too short
    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        authorityKey: shortKey,
      });
    }).toThrow(/authority key required/);
  });

  test("F-02-10: Evidence with extra fields still verifies if MAC correct", () => {
    // Extra fields should not break verification as long as MAC is computed correctly
    const extraFieldEvidence = {
      ...testEvidence,
      extraField: "should-be-ignored",
    };

    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    // Should succeed because MAC matches required fields
    expect(() => {
      validateMysqlCiTarget({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: extraFieldEvidence,
        authorityKey,
      });
    }).not.toThrow();
  });

  test("F-02-11: buildMigrationChildEnvironment requires MAC verification", () => {
    const databaseUrl = `mysql://${ROLE_USERS.migration}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    // Valid with correct key
    expect(() => {
      buildMigrationChildEnvironment({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        authorityKey,
      });
    }).not.toThrow();

    // Fails with wrong key
    const wrongKey = crypto.randomBytes(32);
    expect(() => {
      buildMigrationChildEnvironment({
        databaseUrl,
        profile: testProfile,
        authorizationEvidence: testEvidence,
        authorityKey: wrongKey,
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-12: buildReaderChildEnvironment requires MAC verification", () => {
    // Create reader evidence
    const readerBinding = {
      ...testProfile.runnerBinding,
    };

    const readerProfile = {
      ...testProfile,
      username: ROLE_USERS.reader,
      effectiveUser: `${ROLE_USERS.reader}@%`,
      role: "reader",
      schemaPrivileges: ["SELECT"],
      runnerBinding: readerBinding,
    };

    const readerPayload = {
      kind: AUTHORIZATION_EVIDENCE_KIND,
      operation: "read-only-smoke",
      runId: readerBinding.runId,
      runAttempt: readerBinding.runAttempt,
      containerId: readerBinding.containerId,
      imageDigest: readerBinding.imageDigest,
      policyDigest: readerBinding.policyDigest,
      databaseName: readerBinding.databaseName,
    };

    const canonical = JSON.stringify(
      readerPayload,
      Object.keys(readerPayload).sort(),
    );
    const mac = crypto
      .createHmac("sha256", authorityKey)
      .update(canonical)
      .digest("hex");

    const readerEvidence = {
      ...readerPayload,
      mac,
    };

    const databaseUrl = `mysql://${ROLE_USERS.reader}:password@127.0.0.1:3307/halqa_mysql8_ci_test_001`;

    // Valid with correct key
    expect(() => {
      buildReaderChildEnvironment({
        databaseUrl,
        profile: readerProfile,
        authorizationEvidence: readerEvidence,
        authorityKey,
      });
    }).not.toThrow();

    // Fails with forged MAC
    const forgedReaderEvidence = {
      ...readerEvidence,
      mac: "0".repeat(64),
    };

    expect(() => {
      buildReaderChildEnvironment({
        databaseUrl,
        profile: readerProfile,
        authorizationEvidence: forgedReaderEvidence,
        authorityKey,
      });
    }).toThrow(/MAC verification failed/);
  });

  test("F-02-13: Canonical representation is consistent", () => {
    // Same payload should produce same MAC
    const payload1 = {
      kind: AUTHORIZATION_EVIDENCE_KIND,
      operation: "migration",
      runId: "123",
      runAttempt: "1",
      containerId: "abc",
      imageDigest: "sha256:def",
      policyDigest: "sha256:ghi",
      databaseName: "test_db",
    };

    const canonical1 = JSON.stringify(payload1, Object.keys(payload1).sort());
    const mac1 = crypto
      .createHmac("sha256", authorityKey)
      .update(canonical1)
      .digest("hex");

    // Same fields, different order
    const payload2 = {
      databaseName: "test_db",
      operation: "migration",
      kind: AUTHORIZATION_EVIDENCE_KIND,
      policyDigest: "sha256:ghi",
      runId: "123",
      imageDigest: "sha256:def",
      containerId: "abc",
      runAttempt: "1",
    };

    const canonical2 = JSON.stringify(payload2, Object.keys(payload2).sort());
    const mac2 = crypto
      .createHmac("sha256", authorityKey)
      .update(canonical2)
      .digest("hex");

    // MACs should match (canonical representation is consistent)
    expect(mac1).toBe(mac2);
  });
});
