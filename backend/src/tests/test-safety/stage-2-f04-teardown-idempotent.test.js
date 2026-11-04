/**
 * Stage 2 Security Tests: F-04 Teardown Idempotency
 *
 * PHASE A SECURITY FIX: Teardown operations must be idempotent.
 *
 * Tests verify:
 * - F-04-8: revokeRun() is idempotent (repeat calls return false, no throw)
 * - F-04-9: teardown() is idempotent (repeat calls succeed silently)
 * - F-04-10: Missing run returns false (not throw)
 * - F-04-11: Already-revoked run returns false (not throw)
 * - F-04-12: Idempotent behavior preserves state (no resurrection)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const {
  DurableAuthorityStore,
} = require("../../../test-safety/trusted-mysql-runner/durable-authority-store.js");
const {
  createTrustedRuntimeAdapter,
} = require("../../../test-safety/trusted-mysql-runner/runtime-adapter.js");

describe("Stage 2 Security Tests: F-04 Teardown Idempotency", () => {
  let storePath;
  let store;
  let adapter;
  let mockContainerRuntime;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f04-idempotent-"));
    storePath = path.join(tmpDir, "authority.json");

    // 32-byte authority key for MAC
    const authorityKey = Buffer.from(
      "01234567890123456789012345678901",
      "utf-8",
    );

    store = DurableAuthorityStore.initialize(storePath, authorityKey);

    // Create complete mock container runtime
    mockContainerRuntime = {
      inspect: jest.fn().mockResolvedValue({}),
      teardown: jest.fn().mockResolvedValue(true),
      listOwned: jest.fn().mockResolvedValue([]),
    };

    // Create mock MySQL observer
    const mockMysqlObserver = {
      observe: jest.fn().mockResolvedValue({}),
    };

    adapter = createTrustedRuntimeAdapter({
      authorityStore: store,
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityKey,
    });
  });

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
      fs.rmdirSync(path.dirname(storePath));
    }
  });

  test("F-04-8: revokeRun() returns false on repeat calls (idempotent)", () => {
    const runId = "run-f04-8";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    // First revocation succeeds
    const result1 = store.revokeRun(runId, "test-revocation");
    expect(result1).toBe(true);

    const run1 = store.getRun(runId);
    expect(run1.status).toBe("REVOKED");
    expect(run1.revocationReason).toBe("test-revocation");

    // Second revocation returns false (idempotent)
    const result2 = store.revokeRun(runId, "repeat-revocation");
    expect(result2).toBe(false);

    // State unchanged
    const run2 = store.getRun(runId);
    expect(run2.status).toBe("REVOKED");
    expect(run2.revocationReason).toBe("test-revocation"); // Original reason preserved
    expect(run2.revokedAt).toBe(run1.revokedAt); // Timestamp unchanged
  });

  test("F-04-9: repeated legacy teardown remains blocked", async () => {
    const runId = "run-f04-9";
    const containerId = "container-f04-9";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(store.getRun(runId).status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-10: revokeRun() throws for missing run (fail-closed)", () => {
    const runId = "run-f04-10-missing";

    // No run registered - must throw (fail-closed)
    expect(() => {
      store.revokeRun(runId, "missing-run");
    }).toThrow(/Run is missing/);

    // Still no run
    const run = store.getRun(runId);
    expect(run).toBeNull();
  });

  test("F-04-11: revokeRun() returns false for already-revoked run", () => {
    const runId = "run-f04-11";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register and revoke
    store.registerRun(runId, identityDigest);

    store.revokeRun(runId, "first-revocation");

    const run1 = store.getRun(runId);
    expect(run1.status).toBe("REVOKED");
    const originalRevokedAt = run1.revokedAt;

    // Subsequent revocation returns false
    const result = store.revokeRun(runId, "second-revocation");
    expect(result).toBe(false);

    // State unchanged (no resurrection, no reason override)
    const run2 = store.getRun(runId);
    expect(run2.status).toBe("REVOKED");
    expect(run2.revocationReason).toBe("first-revocation"); // Original preserved
    expect(run2.revokedAt).toBe(originalRevokedAt); // Timestamp unchanged
  });

  test("F-04-12: blocked teardown preserves authority state", async () => {
    const runId = "run-f04-12";
    const containerId = "container-f04-12";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    const run1 = store.getRun(runId);
    expect(run1.status).toBe("ACTIVE");
    const revision1 = store.state.revision;
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    const run2 = store.getRun(runId);
    expect(run2.status).toBe("ACTIVE");
    expect(store.state.revision).toBe(revision1);
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-13: Multiple concurrent idempotent revocations are safe", () => {
    const runId = "run-f04-13";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    // Simulate concurrent revocations (all succeed or return false)
    const results = [
      store.revokeRun(runId, "revocation-1"),
      store.revokeRun(runId, "revocation-2"),
      store.revokeRun(runId, "revocation-3"),
    ];

    // Exactly one succeeds
    const successCount = results.filter((r) => r === true).length;
    expect(successCount).toBe(1);

    // All others return false
    const falseCount = results.filter((r) => r === false).length;
    expect(falseCount).toBe(2);

    // Final state is REVOKED with first reason
    const run = store.getRun(runId);
    expect(run.status).toBe("REVOKED");
    expect(run.revocationReason).toBe("revocation-1");
  });
});
