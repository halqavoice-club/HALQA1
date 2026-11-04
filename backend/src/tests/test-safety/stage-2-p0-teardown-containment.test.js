"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DurableAuthorityStore,
} = require("../../../test-safety/trusted-mysql-runner/durable-authority-store");
const {
  createTrustedRuntimeAdapter,
} = require("../../../test-safety/trusted-mysql-runner/runtime-adapter");
const {
  createTrustedRunController,
} = require("../../../test-safety/trusted-mysql-runner/trusted-run-controller");
const {
  createRecoveryCoordinator,
} = require("../../../test-safety/trusted-mysql-runner/recovery-coordinator");

describe("P0 destructive teardown containment", () => {
  let tempDir;
  let authorityPath;
  let authorityKey;
  let store;
  let containerRuntime;
  let mysqlObserver;
  let adapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "halqa-p0-containment-"));
    authorityPath = path.join(tempDir, "authority.json");
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    containerRuntime = {
      inspect: jest.fn(),
      listOwned: jest.fn().mockResolvedValue([]),
      teardown: jest.fn().mockResolvedValue(true),
    };
    mysqlObserver = { observe: jest.fn() };
    adapter = createTrustedRuntimeAdapter({
      containerRuntime,
      mysqlObserver,
      authorityStore: store,
      authorityKey,
      runId: "adapter-run",
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function register(runId) {
    return store.registerRun(runId, `sha256:${"a".repeat(64)}`);
  }

  async function expectBlocked(request) {
    await expect(adapter.teardown(request)).rejects.toMatchObject({
      code: "UNVERIFIED_RESOURCE_OWNERSHIP",
    });
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  }

  test("unknown run plus arbitrary container is rejected without provider deletion", async () => {
    await expect(
      adapter.teardown({ runId: "unknown-run", containerId: "victim" }),
    ).rejects.toThrow(/unknown run/);
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("valid Run A plus Run B container is blocked", async () => {
    register("run-A");
    register("run-B");
    await expectBlocked({ runId: "run-A", containerId: "container-B" });
  });

  test("revoked Run A plus Run B container is blocked", async () => {
    register("run-A");
    register("run-B");
    store.revokeRun("run-A", "test");
    await expectBlocked({ runId: "run-A", containerId: "container-B" });
  });

  test("legacy version-1 run plus its claimed container is blocked", async () => {
    register("legacy-run");
    expect(store.state.version).toBe(1);
    await expectBlocked({
      runId: "legacy-run",
      containerId: "claimed-container",
    });
  });

  test("two concurrent cleanup requests both fail before provider deletion", async () => {
    register("run-race");
    const requests = await Promise.allSettled([
      adapter.teardown({ runId: "run-race", containerId: "container-race" }),
      adapter.teardown({ runId: "run-race", containerId: "container-race" }),
    ]);
    expect(requests.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(
      requests.every(
        (result) => result.reason.code === "UNVERIFIED_RESOURCE_OWNERSHIP",
      ),
    ).toBe(true);
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("failed authorization is not returned as success", async () => {
    register("run-result");
    const result = await adapter
      .teardown({ runId: "run-result", containerId: "container-result" })
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, code: error.code }),
      );
    expect(result).toEqual({
      ok: false,
      code: "UNVERIFIED_RESOURCE_OWNERSHIP",
    });
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("controller does not mark blocked cleanup DESTROYED", async () => {
    const controller = createTrustedRunController({
      containerRuntime,
      mysqlObserver,
      authorityStorePath: authorityPath,
      authorityKey,
      artifactSourceDirectory: tempDir,
      snapshotBaseDirectory: tempDir,
    });
    const context = await controller.initializeRun({
      containerId: "controller-container",
      networkId: "net",
    });
    controller.authorityStore.registerRun(
      context.runId,
      `sha256:${"b".repeat(64)}`,
    );
    const runAdapter = createTrustedRuntimeAdapter({
      containerRuntime,
      mysqlObserver,
      authorityStore: controller.authorityStore,
      authorityKey,
      runId: context.runId,
    });
    const ready = {
      ...context,
      state: "SERVICE_READY",
      adapter: runAdapter,
      stateHistory: [...context.stateHistory],
    };

    await expect(controller.teardownRun(ready)).rejects.toMatchObject({
      code: "UNVERIFIED_RESOURCE_OWNERSHIP",
    });
    expect(ready.state).toBe("SERVICE_READY");
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  });

  test("recovery discovery cannot delete an unverified resource", async () => {
    const recovery = createRecoveryCoordinator({
      authorityStore: store,
      containerRuntime,
      snapshotBaseDirectory: tempDir,
    });
    containerRuntime.listOwned.mockResolvedValue([
      { id: "foreign", labels: { runId: "unverified-run" } },
    ]);
    const result = await recovery.detectAndRevokeOrphans();
    expect(result.orphansDetected).toBe(1);
    expect(containerRuntime.teardown).toHaveBeenCalledTimes(0);
  });
});
