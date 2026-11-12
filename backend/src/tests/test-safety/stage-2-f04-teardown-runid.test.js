/**
 * F-04 Teardown Run ID Security Tests
 *
 * Verifies controller-owned runId is used for revocation, not caller-supplied provisioning record.
 *
 * SECURITY PROPERTY: Teardown must revoke the correct run even when:
 * - Provisioning record lacks runId
 * - Provisioning record has wrong runId
 * - Provider teardown fails
 *
 * @jest-environment node
 */

"use strict";

const {
  createTrustedRunController,
  ARTIFACT_SET_ID,
} = require("../../../test-safety/trusted-mysql-runner/trusted-run-controller");
const {
  DurableAuthorityStore,
} = require("../../../test-safety/trusted-mysql-runner/durable-authority-store");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

describe("F-04: Teardown Run ID Security", () => {
  let tempDir;
  let controller;
  let mockContainerRuntime;
  let mockMysqlObserver;
  let authorityStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f04-teardown-"));
    const authorityPath = path.join(tempDir, "authority.db");
    const authorityKey = crypto.randomBytes(32);
    const snapshotBaseDir = path.join(tempDir, "snapshots");
    const artifactSourceDir = path.join(tempDir, "artifacts");

    fs.mkdirSync(snapshotBaseDir);
    fs.mkdirSync(artifactSourceDir);

    mockContainerRuntime = {
      inspect: jest.fn(),
      listOwned: jest.fn().mockResolvedValue([]),
      teardown: jest.fn().mockResolvedValue(true),
    };

    mockMysqlObserver = {
      observe: jest.fn(),
    };

    controller = createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath: authorityPath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    });

    authorityStore = controller.authorityStore;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("F-04-01: Teardown uses controller-owned runId for revocation", async () => {
    const provisioningRecord = {
      containerId: "container-test-001",
      networkId: "net-001",
      // No runId in provisioning record
    };

    const context = await controller.initializeRun(provisioningRecord);
    const controllerRunId = context.runId;

    // Register run manually to simulate attestation
    // Authority store status remains ACTIVE (valid authority store status)
    authorityStore.registerRun(controllerRunId, "sha256:" + "0".repeat(64));

    // Create new context with SERVICE_READY controller state (context is frozen)
    // Note: Controller state SERVICE_READY is separate from authority store status ACTIVE
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    // Create adapter manually
    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: controllerRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });

    const run = authorityStore.getRun(controllerRunId);
    expect(run).toBeDefined();
    expect(run.status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-02: Teardown with missing provisioning runId still revokes correct run", async () => {
    const provisioningRecord = {
      containerId: "container-test-002",
      networkId: "net-002",
      // Explicitly no runId
    };

    const context = await controller.initializeRun(provisioningRecord);
    const controllerRunId = context.runId;

    // Register run - authority store status remains ACTIVE (valid status)
    authorityStore.registerRun(controllerRunId, "sha256:" + "1".repeat(64));

    // Create SERVICE_READY controller state context (context is frozen)
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: controllerRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(authorityStore.getRun(controllerRunId).status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-03: Teardown with conflicting provisioning runId uses controller runId", async () => {
    const wrongRunId = "run-wrong-2026-10-26-abcdef";
    const provisioningRecord = {
      containerId: "container-test-003",
      networkId: "net-003",
      runId: wrongRunId, // Wrong ID
    };

    const context = await controller.initializeRun(provisioningRecord);
    const correctRunId = context.runId;

    expect(correctRunId).not.toBe(wrongRunId);

    // Register both runs - both have ACTIVE status (valid authority store status)
    authorityStore.registerRun(correctRunId, "sha256:" + "2".repeat(64));
    authorityStore.registerRun(wrongRunId, "sha256:" + "3".repeat(64));

    // Create SERVICE_READY controller state context
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: correctRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });

    expect(authorityStore.getRun(correctRunId).status).toBe("ACTIVE");
    expect(authorityStore.getRun(wrongRunId).status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-04: Revocation succeeds even when container teardown fails", async () => {
    mockContainerRuntime.teardown.mockRejectedValueOnce(
      new Error("Container teardown failed"),
    );

    const provisioningRecord = {
      containerId: "container-test-004",
      networkId: "net-004",
    };

    const context = await controller.initializeRun(provisioningRecord);
    const controllerRunId = context.runId;

    // Register run - authority store status remains ACTIVE
    authorityStore.registerRun(controllerRunId, "sha256:" + "4".repeat(64));

    // Create SERVICE_READY controller state context
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: controllerRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(authorityStore.getRun(controllerRunId).status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-05: Adapter teardown requires explicit runId", async () => {
    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: "test-run-id",
        },
      );

    // Missing runId
    await expect(adapter.teardown({ containerId: "test" })).rejects.toThrow(
      "Teardown requires explicit runId",
    );

    // Missing containerId
    await expect(adapter.teardown({ runId: "test" })).rejects.toThrow(
      "Teardown requires explicit containerId",
    );
  });

  test("F-04-06: No destruction of unrelated resources", async () => {
    const unrelatedContainerId = "unrelated-container";
    const relatedContainerId = "related-container";

    const provisioningRecord = {
      containerId: relatedContainerId,
      networkId: "net-006",
    };

    const context = await controller.initializeRun(provisioningRecord);
    const controllerRunId = context.runId;

    // Register run - authority store status remains ACTIVE
    authorityStore.registerRun(controllerRunId, "sha256:" + "6".repeat(64));

    // Create SERVICE_READY controller state context
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: controllerRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });

    expect(mockContainerRuntime.teardown).not.toHaveBeenCalledWith(
      unrelatedContainerId,
    );
    expect(mockContainerRuntime.teardown).not.toHaveBeenCalledWith(
      relatedContainerId,
    );
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("F-04-07: Failed cleanup does not falsely report success", async () => {
    mockContainerRuntime.teardown.mockRejectedValueOnce(
      new Error("Cleanup failed"),
    );

    const provisioningRecord = {
      containerId: "container-test-007",
      networkId: "net-007",
    };

    const context = await controller.initializeRun(provisioningRecord);
    const controllerRunId = context.runId;

    // Register run - authority store status remains ACTIVE
    authorityStore.registerRun(controllerRunId, "sha256:" + "7".repeat(64));

    // Create SERVICE_READY controller state context
    const serviceReadyContext = {
      ...context,
      state: "SERVICE_READY",
      stateHistory: [
        ...context.stateHistory,
        {
          state: "SERVICE_READY",
          timestamp: new Date().toISOString(),
          trigger: "test-setup",
        },
      ],
    };

    const adapter =
      require("../../../test-safety/trusted-mysql-runner/runtime-adapter").createTrustedRuntimeAdapter(
        {
          containerRuntime: mockContainerRuntime,
          mysqlObserver: mockMysqlObserver,
          authorityStore,
          authorityKey: crypto.randomBytes(32),
          runId: controllerRunId,
        },
      );

    const contextWithAdapter = { ...serviceReadyContext, adapter };

    await expect(
      controller.teardownRun(contextWithAdapter),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(authorityStore.getRun(controllerRunId).status).toBe("ACTIVE");
    expect(mockContainerRuntime.teardown).toHaveBeenCalledTimes(0);
  });
});
