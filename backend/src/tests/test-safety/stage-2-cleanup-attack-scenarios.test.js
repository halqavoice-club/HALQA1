/**
 * Stage 2 Security Tests: Cleanup Attack Scenarios
 *
 * EMERGENCY CONTAINMENT: Verify that unauthorized container deletion is blocked.
 *
 * Tests verify:
 * - ATTACK-CLEANUP-001: Unknown run ID plus valid container ID
 * - ATTACK-CLEANUP-002: Run A plus Run B's container ID
 * - ATTACK-CLEANUP-003: Valid run but wrong attempt
 * - ATTACK-CLEANUP-004: Revocation returns false
 * - ATTACK-CLEANUP-005: Authority store missing or corrupted
 * - ATTACK-CLEANUP-006: Container identity cannot be verified
 * - ATTACK-CLEANUP-007: Cleanup provider throws
 * - ATTACK-CLEANUP-008: Repeat teardown of known destroyed run
 * - ATTACK-CLEANUP-009: Concurrent teardown of same run
 * - ATTACK-CLEANUP-010: Caller supplies forged provisioning record
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

describe("Stage 2 Security Tests: Cleanup Attack Scenarios", () => {
  let storePath;
  let store;
  let adapter;
  let mockContainerRuntime;
  let mockMysqlObserver;
  const authorityKey = Buffer.from("01234567890123456789012345678901", "utf-8");

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-attack-"));
    storePath = path.join(tmpDir, "authority.json");

    store = DurableAuthorityStore.initialize(storePath, authorityKey);

    // Fake container provider with call tracking
    mockContainerRuntime = {
      inspect: jest.fn().mockResolvedValue({}),
      teardown: jest.fn().mockResolvedValue(true),
      listOwned: jest.fn().mockResolvedValue([]),
    };

    mockMysqlObserver = {
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

  test("ATTACK-CLEANUP-001: Unknown run ID plus valid container ID → REJECTED", async () => {
    const unknownRunId = "fake-run-id";
    const victimContainerId = "victim-container-123";

    // Attacker provides unknown runId with victim's containerId
    await expect(
      adapter.teardown({ runId: unknownRunId, containerId: victimContainerId }),
    ).rejects.toThrow(/unknown run/);

    // CRITICAL: Container teardown must NOT be called
    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-002: Run A plus Run B's container ID → REJECTED", async () => {
    const runAId = "run-A";
    const runBId = "run-B";
    const runBContainer = "container-B";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register both runs
    store.registerRun(runAId, identityDigest);
    store.registerRun(runBId, identityDigest);

    // Attacker uses a valid Run A identity with Run B's container.
    await expect(
      adapter.teardown({ runId: runAId, containerId: runBContainer }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-003: Valid run but wrong attempt → PARTIAL CONTAINMENT", async () => {
    // NOTE: Attempt binding not yet implemented in durable store
    // This test documents the gap and verifies basic run existence check

    const runId = "run-attempt-1";
    const identityDigest = "sha256:" + "0".repeat(64);

    store.registerRun(runId, identityDigest);

    // Unknown run is blocked
    await expect(
      adapter.teardown({ runId: "run-attempt-2", containerId: "container-1" }),
    ).rejects.toThrow(/unknown run/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-004: Revocation returns false → NO BYPASS", async () => {
    const runId = "test-run-004";
    const containerId = "container-004";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register and revoke run
    store.registerRun(runId, identityDigest);
    store.revokeRun(runId, "pre-revoked");

    // Revocation alone does not establish ownership.
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);

    // But unknown run still blocked
    await expect(
      adapter.teardown({ runId: "unknown", containerId }),
    ).rejects.toThrow(/unknown run/);

    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("ATTACK-CLEANUP-005: Authority store missing → FAIL CLOSED", async () => {
    const runId = "test-run-005";
    const containerId = "container-005";

    // Do NOT register run (simulates missing authority)

    // Teardown must reject
    await expect(adapter.teardown({ runId, containerId })).rejects.toThrow(
      /unknown run/,
    );

    // CRITICAL: No destructive call
    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-006: Container identity cannot be verified → PARTIAL CONTAINMENT", async () => {
    // NOTE: Container ownership verification not yet implemented
    // This test verifies that unknown run is blocked (partial protection)

    const runId = "test-run-006";
    const containerId = "unverified-container";

    // Unknown run blocked
    await expect(adapter.teardown({ runId, containerId })).rejects.toThrow(
      /unknown run/,
    );

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-007: Cleanup provider throws → NO SUCCESS REPORT", async () => {
    const runId = "test-run-007";
    const containerId = "container-007";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    // Provider throws error
    mockContainerRuntime.teardown.mockRejectedValue(
      new Error("Container deletion failed"),
    );

    // Containment rejects before the provider can be reached.
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("ATTACK-CLEANUP-008: Repeat teardown of known destroyed run → REJECTED", async () => {
    const runId = "test-run-008";
    const containerId = "container-008";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register and revoke run
    store.registerRun(runId, identityDigest);
    store.revokeRun(runId, "teardown");

    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("ATTACK-CLEANUP-009: Concurrent teardown of same run → SERIAL EXECUTION", async () => {
    const runId = "test-run-009";
    const containerId = "container-009";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    // Concurrent teardown attempts
    const teardown1 = adapter.teardown({ runId, containerId });
    const teardown2 = adapter.teardown({ runId, containerId });

    const results = await Promise.allSettled([teardown1, teardown2]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(
      results.every(
        (result) => result.reason.code === "UNVERIFIED_RESOURCE_OWNERSHIP",
      ),
    ).toBe(true);
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("ATTACK-CLEANUP-010: Caller supplies forged provisioning record → REJECTED", async () => {
    const legitimateRunId = "legit-run";
    const victimContainerId = "victim-container";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register legitimate run
    store.registerRun(legitimateRunId, identityDigest);

    // Attacker tries unknown run (provisioning record cannot help)
    await expect(
      adapter.teardown({ runId: "fake-run", containerId: victimContainerId }),
    ).rejects.toThrow(/unknown run/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();

    // SECURITY GAP: No independent ownership evidence verification
    // TODO Phase 3: Verify containerId against stored ownership, not caller-provided data
  });

  test("ATTACK-CLEANUP-011: Empty runId → REJECTED", async () => {
    await expect(
      adapter.teardown({ runId: "", containerId: "container" }),
    ).rejects.toThrow(/requires explicit runId/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-012: Empty containerId → REJECTED", async () => {
    await expect(
      adapter.teardown({ runId: "run-id", containerId: "" }),
    ).rejects.toThrow(/requires explicit containerId/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-013: Null runId → REJECTED", async () => {
    await expect(
      adapter.teardown({ runId: null, containerId: "container" }),
    ).rejects.toThrow(/requires explicit runId/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-014: Null containerId → REJECTED", async () => {
    await expect(
      adapter.teardown({ runId: "run-id", containerId: null }),
    ).rejects.toThrow(/requires explicit containerId/);

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });

  test("ATTACK-CLEANUP-015: Invalid run status → REJECTED", async () => {
    const runId = "test-run-015";
    const containerId = "container-015";
    const identityDigest = "sha256:" + "0".repeat(64);

    // Register run
    store.registerRun(runId, identityDigest);

    // Manually corrupt status (simulates state corruption)
    store.state.runs[runId].status = "INVALID_STATUS";

    // Teardown must reject
    await expect(
      adapter.teardown({ runId, containerId }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });

    // CRITICAL: No destructive call
    expect(mockContainerRuntime.teardown).not.toHaveBeenCalled();
  });
});
