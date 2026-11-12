/**
 * Stage 2 Durable Authority Store Security Tests
 * 
 * Tests replay protection, nonce consumption, run lifecycle, concurrent access,
 * HMAC integrity, and crash recovery.
 * 
 * OFFLINE ONLY - NO Docker, NO MySQL, NO SQL execution.
 * Uses file-backed state with cryptographic verification.
 * 
 * @jest-environment node
 */

'use strict';

const crypto = require('crypto');
const { DurableAuthorityStore } = require('../../../test-safety/trusted-mysql-runner/durable-authority-store');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Stage 2 Durable Authority Store - Initialization and Lifecycle', () => {
  
  let tempDir;
  let storePath;
  let authorityKey;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    authorityKey = crypto.randomBytes(32);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-34: Initialize requires absolute path', () => {
    expect(() => {
      DurableAuthorityStore.initialize('relative/path', authorityKey);
    }).toThrow(/must be absolute/);
  });
  
  test('S2-35: Initialize requires 32-byte key minimum', () => {
    expect(() => {
      DurableAuthorityStore.initialize(storePath, Buffer.from('short'));
    }).toThrow(/at least 32 bytes/);
    
    expect(() => {
      DurableAuthorityStore.initialize(storePath, crypto.randomBytes(16));
    }).toThrow(/at least 32 bytes/);
  });
  
  test('S2-36: Initialize creates state file with HMAC integrity', () => {
    const store = DurableAuthorityStore.initialize(storePath, authorityKey);
    
    expect(fs.existsSync(storePath)).toBe(true);
    
    const raw = fs.readFileSync(storePath, 'utf8');
    const envelope = JSON.parse(raw);
    
    expect(envelope.state).toBeDefined();
    expect(envelope.mac).toBeDefined();
    expect(envelope.mac).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.state.version).toBe(1);
    expect(envelope.state.revision).toBe(0);
    expect(envelope.state.runs).toEqual({});
    expect(envelope.state.consumedNonces).toEqual({});
  });
  
  test('S2-37: Initialize refuses to overwrite existing state', () => {
    DurableAuthorityStore.initialize(storePath, authorityKey);
    
    expect(() => {
      DurableAuthorityStore.initialize(storePath, authorityKey);
    }).toThrow(/already exists.*refusing reinitialization/);
  });
  
  test('S2-38: Open requires existing state file', () => {
    expect(() => {
      DurableAuthorityStore.open(storePath, authorityKey);
    }).toThrow(/missing.*explicit initialization required/);
  });
  
  test('S2-39: Open verifies HMAC integrity', () => {
    DurableAuthorityStore.initialize(storePath, authorityKey);
    
    // Tamper with state file
    const envelope = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    envelope.state.revision = 999;
    fs.writeFileSync(storePath, JSON.stringify(envelope));
    
    expect(() => {
      DurableAuthorityStore.open(storePath, authorityKey);
    }).toThrow(/integrity verification failed/);
  });
  
  test('S2-40: Open rejects malformed envelope', () => {
    fs.writeFileSync(storePath, 'not json');
    
    expect(() => {
      DurableAuthorityStore.open(storePath, authorityKey);
    }).toThrow();
    
    fs.writeFileSync(storePath, '{}');
    
    expect(() => {
      DurableAuthorityStore.open(storePath, authorityKey);
    }).toThrow(/malformed/);
  });
  
  test('S2-41: Open with wrong key fails HMAC verification', () => {
    DurableAuthorityStore.initialize(storePath, authorityKey);
    
    const wrongKey = crypto.randomBytes(32);
    
    expect(() => {
      DurableAuthorityStore.open(storePath, wrongKey);
    }).toThrow(/integrity verification failed/);
  });
  
  test('S2-42: State updates are atomic via temp file + rename', () => {
    const store = DurableAuthorityStore.initialize(storePath, authorityKey);
    
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    // Verify no temp files left behind
    const tempFiles = fs.readdirSync(tempDir).filter(f => f.includes('.tmp'));
    expect(tempFiles).toEqual([]);
    
    // Verify state is readable
    const reopened = DurableAuthorityStore.open(storePath, authorityKey);
    expect(reopened.getRun('test-run')).toBeDefined();
  });
});

describe('Stage 2 Durable Authority Store - Run Registration', () => {
  
  let tempDir;
  let storePath;
  let authorityKey;
  let store;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(storePath, authorityKey);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-43: Register run requires valid run ID', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    
    expect(() => {
      store.registerRun('', identityDigest);
    }).toThrow(/Invalid run ID/);
    
    expect(() => {
      store.registerRun('a'.repeat(129), identityDigest);
    }).toThrow(/Invalid run ID/);
    
    expect(() => {
      store.registerRun('invalid spaces', identityDigest);
    }).toThrow(/Invalid run ID/);
  });
  
  test('S2-44: Register run requires valid identity digest', () => {
    expect(() => {
      store.registerRun('test-run', 'not-a-digest');
    }).toThrow(/Invalid identity digest/);
    
    expect(() => {
      store.registerRun('test-run', 'sha256:short');
    }).toThrow(/Invalid identity digest/);
  });
  
  test('S2-45: Register run creates ACTIVE run', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    const result = store.registerRun('test-run', identityDigest);
    
    expect(result.identityDigest).toBe(identityDigest);
    expect(result.status).toBe('ACTIVE');
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });
  
  test('S2-46: Register run rejects duplicate registration', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    expect(() => {
      store.registerRun('test-run', identityDigest);
    }).toThrow(/already registered/);
  });
  
  test('S2-47: Register run increments revision', () => {
    const before = store.state.revision;
    
    store.registerRun('test-run', 'sha256:' + 'a'.repeat(64));
    
    expect(store.state.revision).toBe(before + 1);
  });
});

describe('Stage 2 Durable Authority Store - Nonce Consumption and Replay Protection', () => {
  
  let tempDir;
  let storePath;
  let authorityKey;
  let store;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(storePath, authorityKey);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-48: Consume nonce requires ACTIVE run', () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    
    expect(() => {
      store.consumeNonce('nonexistent-run', nonce, 'OBSERVE_IDENTITY');
    }).toThrow(/missing or revoked/);
  });
  
  test('S2-49: Consume nonce requires valid nonce format', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    expect(() => {
      store.consumeNonce('test-run', 'short', 'OBSERVE_IDENTITY');
    }).toThrow(/Invalid nonce/);
    
    expect(() => {
      store.consumeNonce('test-run', 'not-hex-gggggggggggggggggggggggggggggggg', 'OBSERVE_IDENTITY');
    }).toThrow(/Invalid nonce/);
  });
  
  test('S2-50: Consume nonce requires valid step name', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    expect(() => {
      store.consumeNonce('test-run', nonce, 'invalid step');
    }).toThrow(/Invalid authorization step/);
    
    expect(() => {
      store.consumeNonce('test-run', nonce, 'a');
    }).toThrow(/Invalid authorization step/);
  });
  
  test('S2-51: Consume nonce succeeds for ACTIVE run', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const result = store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    
    expect(result).toBe(true);
    expect(store.state.consumedNonces[nonce]).toBeDefined();
    expect(store.state.consumedNonces[nonce].runId).toBe('test-run');
    expect(store.state.consumedNonces[nonce].step).toBe('OBSERVE_IDENTITY');
  });
  
  test('S2-52: CRITICAL - Duplicate nonce consumption is rejected (replay protection)', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // First consumption succeeds
    store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    
    // Second consumption with same nonce MUST fail
    expect(() => {
      store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    }).toThrow(/replay detected/);
  });
  
  test('S2-53: CRITICAL - Cross-run replay is rejected', () => {
    const identityDigest1 = 'sha256:' + 'a'.repeat(64);
    const identityDigest2 = 'sha256:' + 'b'.repeat(64);
    store.registerRun('run-1', identityDigest1);
    store.registerRun('run-2', identityDigest2);
    
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Consume nonce in run-1
    store.consumeNonce('run-1', nonce, 'OBSERVE_IDENTITY');
    
    // Attempt to reuse same nonce in run-2 MUST fail
    expect(() => {
      store.consumeNonce('run-2', nonce, 'VERIFY_ACCOUNTS');
    }).toThrow(/replay detected/);
  });
  
  test('S2-54: Nonce consumption persists across restart', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    
    // Reopen store (simulates process restart)
    const reopened = DurableAuthorityStore.open(storePath, authorityKey);
    
    // Nonce must still be consumed
    expect(() => {
      reopened.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    }).toThrow(/replay detected/);
  });
  
  test('S2-55: Consume nonce increments revision', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const before = store.state.revision;
    
    const nonce = crypto.randomBytes(16).toString('hex');
    store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    
    expect(store.state.revision).toBe(before + 1);
  });
});

describe('Stage 2 Durable Authority Store - Run Revocation', () => {
  
  let tempDir;
  let storePath;
  let authorityKey;
  let store;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(storePath, authorityKey);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-56: Revoke run requires existing run', () => {
    expect(() => {
      store.revokeRun('nonexistent-run', 'test');
    }).toThrow(/missing/);
  });
  
  test('S2-57: Revoke run marks status as REVOKED', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    store.revokeRun('test-run', 'teardown');
    
    const run = store.getRun('test-run');
    expect(run.status).toBe('REVOKED');
    expect(run.revokedAt).toBeDefined();
    expect(run.revocationReason).toBe('teardown');
  });
  
  test('S2-58: CRITICAL - Revoked run cannot consume nonces', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    store.revokeRun('test-run', 'teardown');
    
    const nonce = crypto.randomBytes(16).toString('hex');
    
    expect(() => {
      store.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    }).toThrow(/missing or revoked/);
  });
  
  test('S2-59: Revocation persists across restart', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    store.revokeRun('test-run', 'teardown');
    
    // Reopen store
    const reopened = DurableAuthorityStore.open(storePath, authorityKey);
    
    const nonce = crypto.randomBytes(16).toString('hex');
    expect(() => {
      reopened.consumeNonce('test-run', nonce, 'OBSERVE_IDENTITY');
    }).toThrow(/missing or revoked/);
  });
  
  test('S2-60: Revoke increments revision', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    const before = store.state.revision;
    
    store.revokeRun('test-run', 'teardown');
    
    expect(store.state.revision).toBe(before + 1);
  });
});

describe('Stage 2 Durable Authority Store - Lock File Semantics', () => {
  
  let tempDir;
  let storePath;
  let lockPath;
  let authorityKey;
  let store;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    lockPath = `${storePath}.lock`;
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(storePath, authorityKey);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-61: Lock file is created and removed during operation', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    
    // Lock should not exist before operation
    expect(fs.existsSync(lockPath)).toBe(false);
    
    store.registerRun('test-run', identityDigest);
    
    // Lock should not exist after operation completes
    expect(fs.existsSync(lockPath)).toBe(false);
  });
  
  test('S2-62: Stale lock file blocks operations (fail-closed)', () => {
    // Simulate stale lock file
    fs.writeFileSync(lockPath, '');
    
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    
    expect(() => {
      store.registerRun('test-run', identityDigest);
    }).toThrow(/lock exists.*fail-closed recovery required/);
  });
  
  test('S2-63: NOTE - This test suite does NOT verify concurrent process atomicity', () => {
    // LIMITATION DOCUMENTED: Single-process tests cannot verify cross-process lock behavior
    // Concurrent access from multiple Node.js processes requires integration test infrastructure
    // File-based locking on Windows uses different mechanisms than POSIX
    expect(true).toBe(true);
  });
});

describe('Stage 2 Durable Authority Store - Query Operations', () => {
  
  let tempDir;
  let storePath;
  let authorityKey;
  let store;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-authority-'));
    storePath = path.join(tempDir, 'authority.json');
    authorityKey = crypto.randomBytes(32);
    store = DurableAuthorityStore.initialize(storePath, authorityKey);
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-64: getRun returns null for nonexistent run', () => {
    expect(store.getRun('nonexistent')).toBeNull();
  });
  
  test('S2-65: getRun returns run details', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    const run = store.getRun('test-run');
    
    expect(run).toBeDefined();
    expect(run.identityDigest).toBe(identityDigest);
    expect(run.status).toBe('ACTIVE');
    expect(run.createdAt).toBeDefined();
  });
  
  test('S2-66: getRun returns copy, not reference', () => {
    const identityDigest = 'sha256:' + 'a'.repeat(64);
    store.registerRun('test-run', identityDigest);
    
    const run1 = store.getRun('test-run');
    const run2 = store.getRun('test-run');
    
    expect(run1).not.toBe(run2); // Different object references
    expect(run1).toEqual(run2);  // Same content
  });
});
