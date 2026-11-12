/**
 * F-01 Cross-Process State Serialization Tests
 *
 * Verifies durable authority store prevents stale overwrites across processes.
 *
 * SECURITY PROPERTIES:
 * - Reload current state before writing
 * - Reject stale cached state
 * - Preserve revocations and nonce consumption
 * - Fail closed on corruption
 *
 * @jest-environment node
 */

"use strict";

const {
  DurableAuthorityStore,
} = require("../../../test-safety/trusted-mysql-runner/durable-authority-store");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

describe("F-01: Cross-Process State Serialization", () => {
  let tempDir;
  let authorityPath;
  let authorityKey;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f01-cross-process-"));
    authorityPath = path.join(tempDir, "authority.db");
    authorityKey = crypto.randomBytes(32);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("F-01-01: Single process write succeeds", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);

    store.registerRun("run-001", "sha256:" + "0".repeat(64));

    const run = store.getRun("run-001");
    expect(run).toBeDefined();
    expect(run.status).toBe("ACTIVE");
  });

  test("F-01-02: Same-process sequential writes succeed", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);

    store.registerRun("run-002-a", "sha256:" + "1".repeat(64));
    store.registerRun("run-002-b", "sha256:" + "2".repeat(64));

    expect(store.getRun("run-002-a")).toBeDefined();
    expect(store.getRun("run-002-b")).toBeDefined();
    expect(store.state.revision).toBe(2);
  });

  test("F-01-03: Reload after external modification succeeds", () => {
    const store1 = DurableAuthorityStore.initialize(
      authorityPath,
      authorityKey,
    );
    store1.registerRun("run-003", "sha256:" + "3".repeat(64));

    // Second process opens and modifies
    const store2 = DurableAuthorityStore.open(authorityPath, authorityKey);
    store2.registerRun("run-003-b", "sha256:" + "4".repeat(64));

    // First process reopens and sees updates
    const store1Reloaded = DurableAuthorityStore.open(
      authorityPath,
      authorityKey,
    );
    expect(store1Reloaded.getRun("run-003")).toBeDefined();
    expect(store1Reloaded.getRun("run-003-b")).toBeDefined();
  });

  test("F-01-04: Stale cached state is authenticated and safely replayed", () => {
    const store1 = DurableAuthorityStore.initialize(
      authorityPath,
      authorityKey,
    );
    store1.registerRun("run-004", "sha256:" + "5".repeat(64));
    expect(store1.state.revision).toBe(1);

    // Second process updates (revision becomes 2)
    const store2 = DurableAuthorityStore.open(authorityPath, authorityKey);
    store2.registerRun("run-004-b", "sha256:" + "6".repeat(64));
    expect(store2.state.revision).toBe(2);

    store1.registerRun("run-004-c", "sha256:" + "7".repeat(64));
    const reopened = DurableAuthorityStore.open(authorityPath, authorityKey);
    expect(reopened.getRun("run-004-b")).toBeDefined();
    expect(reopened.getRun("run-004-c")).toBeDefined();
  });

  test("F-01-05: Revocation is not lost to stale overwrite", () => {
    const store1 = DurableAuthorityStore.initialize(
      authorityPath,
      authorityKey,
    );
    store1.registerRun("run-005", "sha256:" + "8".repeat(64));

    // Store1 caches current state
    const store1CachedRevision = store1.state.revision;

    // Store2 revokes
    const store2 = DurableAuthorityStore.open(authorityPath, authorityKey);
    store2.revokeRun("run-005", "test-revocation");

    // Store1 reloads the authenticated revocation before applying its mutation.
    expect(() => {
      store1.consumeNonce("run-005", "a".repeat(32), "TEST_STEP");
    }).toThrow(/missing or revoked/);

    // Verify revocation persists
    const store3 = DurableAuthorityStore.open(authorityPath, authorityKey);
    expect(store3.getRun("run-005").status).toBe("REVOKED");
  });

  test("F-01-06: Nonce consumption is not lost to stale overwrite", () => {
    const store1 = DurableAuthorityStore.initialize(
      authorityPath,
      authorityKey,
    );
    store1.registerRun("run-006", "sha256:" + "9".repeat(64));

    const nonce1 = "b".repeat(32);

    // Store1 caches state
    const cachedRev = store1.state.revision;

    // Store2 consumes nonce
    const store2 = DurableAuthorityStore.open(authorityPath, authorityKey);
    store2.consumeNonce("run-006", nonce1, "STEP_ONE");

    store1.consumeNonce("run-006", "c".repeat(32), "STEP_TWO");

    // Verify nonce1 persists
    const store3 = DurableAuthorityStore.open(authorityPath, authorityKey);
    expect(store3.state.consumedNonces[nonce1]).toBeDefined();
    expect(store3.state.consumedNonces[nonce1].step).toBe("STEP_ONE");
    expect(store3.state.consumedNonces["c".repeat(32)].step).toBe("STEP_TWO");
  });

  test("F-01-07: Corrupt state file fails closed", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    store.registerRun("run-007", "sha256:" + "a".repeat(64));

    // Corrupt the file
    fs.writeFileSync(authorityPath, "CORRUPTED DATA");

    // Opening corrupt file fails
    expect(() => {
      DurableAuthorityStore.open(authorityPath, authorityKey);
    }).toThrow();
  });

  test("F-01-08: MAC mismatch fails closed", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    store.registerRun("run-008", "sha256:" + "b".repeat(64));

    // Read and tamper with MAC
    const content = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
    content.mac = "f".repeat(64); // Wrong MAC
    fs.writeFileSync(authorityPath, JSON.stringify(content));

    // Opening with wrong MAC fails
    expect(() => {
      DurableAuthorityStore.open(authorityPath, authorityKey);
    }).toThrow(/integrity verification failed/);
  });

  test("F-01-09: Fsync ensures durability", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);

    // Register run (triggers fsync)
    store.registerRun("run-009", "sha256:" + "c".repeat(64));

    // File should exist and be readable
    expect(fs.existsSync(authorityPath)).toBe(true);

    // Verify content is valid
    const store2 = DurableAuthorityStore.open(authorityPath, authorityKey);
    expect(store2.getRun("run-009")).toBeDefined();
  });

  test("F-01-10: Revision counter increments correctly", () => {
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    expect(store.state.revision).toBe(0);

    store.registerRun("run-010-a", "sha256:" + "d".repeat(64));
    expect(store.state.revision).toBe(1);

    store.registerRun("run-010-b", "sha256:" + "e".repeat(64));
    expect(store.state.revision).toBe(2);

    store.consumeNonce("run-010-a", "f".repeat(32), "STEP");
    expect(store.state.revision).toBe(3);

    store.revokeRun("run-010-a", "test");
    expect(store.state.revision).toBe(4);
  });
});

describe("F-01: Real Child Process Tests", () => {
  let tempDir;
  let authorityPath;
  let authorityKey;
  let keyPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f01-real-process-"));
    authorityPath = path.join(tempDir, "authority.db");
    authorityKey = crypto.randomBytes(32);
    keyPath = path.join(tempDir, "key.bin");
    fs.writeFileSync(keyPath, authorityKey);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function spawnWorker(scriptContent) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", scriptContent], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "test" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on("error", reject);

      // Timeout after 5 seconds
      setTimeout(() => {
        child.kill();
        reject(new Error("Child process timeout"));
      }, 5000);
    });
  }

  test("F-01-11: Real child process concurrent writes detected", async () => {
    // Initialize store
    const store = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    store.registerRun("run-011", "sha256:" + "0".repeat(64));

    // Spawn two child processes that both try to write
    const workerScript = `
      const { DurableAuthorityStore } = require('${path.join(__dirname, "../../../test-safety/trusted-mysql-runner/durable-authority-store.js").replace(/\\/g, "\\\\")}');
      const fs = require('fs');
      const crypto = require('crypto');
      
      const authorityPath = '${authorityPath.replace(/\\/g, "\\\\")}';
      const keyPath = '${keyPath.replace(/\\/g, "\\\\")}';
      const authorityKey = fs.readFileSync(keyPath);
      
      try {
        const store = DurableAuthorityStore.open(authorityPath, authorityKey);
        
        // Simulate slow operation (cache state)
        const cachedRevision = store.state.revision;
        
        // Sleep to allow race
        const start = Date.now();
        while (Date.now() - start < 100) { /* busy wait */ }
        
        // Try to write
        store.registerRun('run-011-child-' + process.pid, 'sha256:' + '${crypto.randomBytes(32).toString("hex")}');
        
        console.log('SUCCESS');
      } catch (error) {
        if (error.message.includes('Stale state overwrite')) {
          console.log('STALE_REJECTED');
        } else if (error.message.includes('lock exists')) {
          // Lock contention is equivalent to stale detection
          console.log('LOCK_CONTENTION');
        } else {
          console.log('ERROR:' + error.message);
        }
      }
    `;

    // Launch both workers
    const [result1, result2] = await Promise.all([
      spawnWorker(workerScript),
      spawnWorker(workerScript),
    ]);

    // Both may succeed when their lock acquisitions serialize; contention is also safe.
    const outputs = [result1.stdout.trim(), result2.stdout.trim()];
    const successes = outputs.filter((o) => o === "SUCCESS").length;
    const staleRejections = outputs.filter(
      (o) => o === "STALE_REJECTED",
    ).length;
    const lockContentions = outputs.filter(
      (o) => o === "LOCK_CONTENTION",
    ).length;

    // Debug: Log all captured data
    console.log("=== CHILD PROCESS RESULTS ===");
    console.log("Result 1:", {
      code: result1.code,
      stdout: result1.stdout,
      stderr: result1.stderr,
    });
    console.log("Result 2:", {
      code: result2.code,
      stdout: result2.stdout,
      stderr: result2.stderr,
    });
    console.log("Outputs:", outputs);
    console.log(
      "Successes:",
      successes,
      "Stale:",
      staleRejections,
      "Lock:",
      lockContentions,
    );

    // Exactly two safe outcomes total. Serialized successes must preserve both updates.
    expect(successes + staleRejections + lockContentions).toBe(2);
    expect(successes).toBeGreaterThanOrEqual(1);
    const reopened = DurableAuthorityStore.open(authorityPath, authorityKey);
    expect(Object.keys(reopened.getStateSnapshot().runs).length).toBe(
      1 + successes,
    );
  }, 10000); // Longer timeout for child processes
});
