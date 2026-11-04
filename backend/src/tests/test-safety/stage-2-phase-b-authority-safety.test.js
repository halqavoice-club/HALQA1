"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  DurableAuthorityStore,
} = require("../../../test-safety/trusted-mysql-runner/durable-authority-store");
const {
  createTrustedRuntimeAdapter,
} = require("../../../test-safety/trusted-mysql-runner/runtime-adapter");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function writeAuthenticatedState(statePath, key, state) {
  const mac = crypto
    .createHmac("sha256", key)
    .update(canonical(state))
    .digest("hex");
  fs.writeFileSync(statePath, `${canonical({ state, mac })}\n`);
}

function runChild(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
  });
}

describe("Phase B durable authority safety", () => {
  let tempDir;
  let statePath;
  let keyPath;
  let key;
  let store;
  const modulePath = path.resolve(
    __dirname,
    "../../../test-safety/trusted-mysql-runner/durable-authority-store.js",
  );

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "halqa-phase-b-"));
    statePath = path.join(tempDir, "authority.json");
    keyPath = path.join(tempDir, "authority.key");
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key);
    store = DurableAuthorityStore.initialize(statePath, key);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function worker(operation) {
    return `
      const fs = require('fs');
      const { DurableAuthorityStore } = require(${JSON.stringify(modulePath)});
      const statePath = ${JSON.stringify(statePath)};
      const key = fs.readFileSync(${JSON.stringify(keyPath)});
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const s = DurableAuthorityStore.open(statePath, key);
          ${operation}
          process.stdout.write('SUCCESS');
          process.exit(0);
        } catch (error) {
          if (/lock exists/.test(error.message)) continue;
          process.stdout.write('ERROR:' + error.message);
          process.exit(0);
        }
      }
      process.stdout.write('LOCK_TIMEOUT');
    `;
  }

  test("B-TEST-001/009: separate processes register without lost updates and revisions stay consistent", async () => {
    const [a, b] = await Promise.all([
      runChild(worker("s.registerRun('child-a', 'sha256:' + 'a'.repeat(64));")),
      runChild(worker("s.registerRun('child-b', 'sha256:' + 'b'.repeat(64));")),
    ]);
    expect([a.stdout, b.stdout]).toEqual(["SUCCESS", "SUCCESS"]);
    const reopened = DurableAuthorityStore.open(statePath, key);
    expect(reopened.getRun("child-a")).not.toBeNull();
    expect(reopened.getRun("child-b")).not.toBeNull();
    expect(reopened.getStateSnapshot().revision).toBe(2);
  });

  test("B-TEST-002: concurrent nonce consumption succeeds only once", async () => {
    store.registerRun("nonce-run", `sha256:${"c".repeat(64)}`);
    const operation =
      "s.consumeNonce('nonce-run', 'd'.repeat(32), 'VERIFY_ACCOUNTS');";
    const [a, b] = await Promise.all([
      runChild(worker(operation)),
      runChild(worker(operation)),
    ]);
    const outputs = [a.stdout, b.stdout];
    expect(outputs.filter((value) => value === "SUCCESS")).toHaveLength(1);
    expect(
      outputs.filter(
        (value) => value !== "SUCCESS" && /^(ERROR:|LOCK_TIMEOUT)/.test(value),
      ),
    ).toHaveLength(1);
    expect(
      Object.keys(
        DurableAuthorityStore.open(statePath, key).getStateSnapshot()
          .consumedNonces,
      ),
    ).toEqual(["d".repeat(32)]);
  });

  test("B-TEST-003/004: revocation survives restart and stale writer cannot resurrect it", () => {
    store.registerRun("revoked-run", `sha256:${"e".repeat(64)}`);
    const stale = DurableAuthorityStore.open(statePath, key);
    store.revokeRun("revoked-run", "phase-b");
    expect(
      DurableAuthorityStore.open(statePath, key).getRun("revoked-run").status,
    ).toBe("REVOKED");
    expect(() =>
      stale.consumeNonce("revoked-run", "f".repeat(32), "VERIFY_ACCOUNTS"),
    ).toThrow(/missing or revoked/);
    expect(
      DurableAuthorityStore.open(statePath, key).getRun("revoked-run").status,
    ).toBe("REVOKED");
  });

  test("B-TEST-005: HMAC corruption is rejected before mutation", () => {
    const envelope = JSON.parse(fs.readFileSync(statePath, "utf8"));
    envelope.mac = "0".repeat(64);
    fs.writeFileSync(statePath, JSON.stringify(envelope));
    expect(() =>
      store.registerRun("blocked", `sha256:${"1".repeat(64)}`),
    ).toThrow(/integrity verification failed/);
    expect(store.state.runs.blocked).toBeUndefined();
  });

  test.each([
    [
      "B-TEST-006 invalid schema",
      (state) => {
        state.runs = [];
      },
      /schema malformed/,
    ],
    [
      "B-TEST-007 unsupported version",
      (state) => {
        state.version = 2;
      },
      /version unsupported/,
    ],
  ])("%s is rejected even with a valid HMAC", (_name, mutate, expected) => {
    const envelope = JSON.parse(fs.readFileSync(statePath, "utf8"));
    mutate(envelope.state);
    writeAuthenticatedState(statePath, key, envelope.state);
    expect(() => DurableAuthorityStore.open(statePath, key)).toThrow(expected);
  });

  test("B-TEST-008/016: rename failure does not publish candidate and cleans its temporary file", () => {
    const before = store.getStateSnapshot();
    jest.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });
    expect(() =>
      store.registerRun("not-persisted", `sha256:${"2".repeat(64)}`),
    ).toThrow(/simulated rename failure/);
    expect(store.state).toEqual(before);
    expect(
      DurableAuthorityStore.open(statePath, key).getRun("not-persisted"),
    ).toBeNull();
    expect(
      fs.readdirSync(tempDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  test("B-TEST-010: concurrent initialization creates one authoritative store", async () => {
    const otherPath = path.join(tempDir, "concurrent.json");
    const initWorker = `
      const fs = require('fs');
      const { DurableAuthorityStore } = require(${JSON.stringify(modulePath)});
      try {
        DurableAuthorityStore.initialize(${JSON.stringify(otherPath)}, fs.readFileSync(${JSON.stringify(keyPath)}));
        process.stdout.write('SUCCESS');
      } catch (error) { process.stdout.write('ERROR:' + error.message); }
    `;
    const [a, b] = await Promise.all([
      runChild(initWorker),
      runChild(initWorker),
    ]);
    expect(
      [a.stdout, b.stdout].filter((value) => value === "SUCCESS"),
    ).toHaveLength(1);
    expect(
      [a.stdout, b.stdout].filter((value) => /^ERROR:/.test(value)),
    ).toHaveLength(1);
    expect(
      DurableAuthorityStore.open(otherPath, key).getStateSnapshot().revision,
    ).toBe(0);
  });

  test("B-TEST-011: initialization cannot overwrite an existing authority store", () => {
    store.registerRun("preserved", `sha256:${"3".repeat(64)}`);
    expect(() => DurableAuthorityStore.initialize(statePath, key)).toThrow(
      /already exists/,
    );
    expect(
      DurableAuthorityStore.open(statePath, key).getRun("preserved"),
    ).not.toBeNull();
  });

  test("B-TEST-012/013: lock contention fails closed and preserves another owner lock", () => {
    const lockPath = `${statePath}.lock`;
    fs.writeFileSync(lockPath, "other-owner");
    expect(() => store.getRun("anything")).toThrow(/lock exists/);
    expect(fs.readFileSync(lockPath, "utf8")).toBe("other-owner");
    fs.unlinkSync(lockPath);
  });

  test("B-TEST-014: reopen verifies HMAC and preserves authorization", () => {
    store.registerRun("reopen-run", `sha256:${"4".repeat(64)}`);
    store.revokeRun("reopen-run", "verified");
    const reopened = DurableAuthorityStore.open(statePath, key);
    expect(reopened.getRun("reopen-run")).toMatchObject({
      status: "REVOKED",
      revocationReason: "verified",
    });
  });

  test("B-TEST-015: security-critical fresh read rejects corruption instead of using cache", () => {
    store.registerRun("cached-run", `sha256:${"5".repeat(64)}`);
    const envelope = JSON.parse(fs.readFileSync(statePath, "utf8"));
    envelope.state.revision += 1;
    fs.writeFileSync(statePath, JSON.stringify(envelope));
    expect(() => store.getRun("cached-run")).toThrow(
      /integrity verification failed/,
    );
  });

  test("B-TEST-017/018: legacy and cross-run teardown remain blocked with zero provider calls", async () => {
    store.registerRun("run-a", `sha256:${"6".repeat(64)}`);
    store.registerRun("run-b", `sha256:${"7".repeat(64)}`);
    const runtime = {
      inspect: jest.fn(),
      listOwned: jest.fn(),
      teardown: jest.fn(),
    };
    const adapter = createTrustedRuntimeAdapter({
      containerRuntime: runtime,
      mysqlObserver: { observe: jest.fn() },
      authorityStore: store,
      authorityKey: key,
      runId: "run-a",
    });
    await expect(
      adapter.teardown({ runId: "run-a", containerId: "container-a" }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    await expect(
      adapter.teardown({ runId: "run-a", containerId: "container-b" }),
    ).rejects.toMatchObject({ code: "UNVERIFIED_RESOURCE_OWNERSHIP" });
    expect(runtime.teardown).toHaveBeenCalledTimes(0);
  });
});
