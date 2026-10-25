/**
 * Stage 2 Recovery Coordinator Security Tests
 * 
 * Tests recovery, revocation, cleanup, and failure handling.
 * Ensures failed/expired/revoked runs cannot be reused.
 * 
 * OFFLINE ONLY - Uses mock providers and temp files, NO Docker, NO MySQL.
 * 
 * @jest-environment node
 */

'use strict';

const { createRecoveryCoordinator } = require('../../../test-safety/trusted-mysql-runner/recovery-coordinator');
const { DurableAuthorityStore } = require('../../../test-safety/trusted-mysql-runner/durable-authority-store');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Stage 2 Recovery Coordinator - Initialization', () => {
  
  let tempDir;
  let authorityStore;
  let snapshotBaseDir;
  const mockContainerRuntime = {
    teardown: jest.fn(),
    listOwned: jest.fn(),
  };
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-recovery-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    snapshotBaseDir = path.join(tempDir, 'snapshots');
    fs.mkdirSync(snapshotBaseDir);
    
    const authorityKey = crypto.randomBytes(32);
    authorityStore = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-143: createRecoveryCoordinator requires authority store', () => {
    expect(() => createRecoveryCoordinator({
      authorityStore: null,
      containerRuntime: mockContainerRuntime,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Authority store required/);
  });
  
  test('S2-144: createRecoveryCoordinator requires container runtime with teardown', () => {
    expect(() => createRecoveryCoordinator({
      authorityStore,
      containerRuntime: { listOwned: jest.fn() },
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Container runtime provider with teardown\(\) required/);
  });
  
  test('S2-145: createRecoveryCoordinator requires absolute snapshot directory', () => {
    expect(() => createRecoveryCoordinator({
      authorityStore,
      containerRuntime: mockContainerRuntime,
      snapshotBaseDirectory: 'relative/path',
    })).toThrow(/Snapshot base directory must be absolute/);
  });
  
  test('S2-146: createRecoveryCoordinator returns expected functions', () => {
    const coordinator = createRecoveryCoordinator({
      authorityStore,
      containerRuntime: mockContainerRuntime,
      snapshotBaseDirectory: snapshotBaseDir,
    });
    
    expect(typeof coordinator.checkRecoverability).toBe('function');
    expect(typeof coordinator.revokeFailedRun).toBe('function');
    expect(typeof coordinator.cleanupRunResources).toBe('function');
    expect(typeof coordinator.detectAndRevokeOrphans).toBe('function');
    expect(typeof coordinator.verifyDurableStateIntegrity).toBe('function');
    expect(typeof coordinator.attemptRecovery).toBe('function');
  });
});

describe('Stage 2 Recovery Coordinator - Recoverability Checks', () => {
  
  let tempDir;
  let authorityStore;
  let coordinator;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-recovery-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    fs.mkdirSync(snapshotBaseDir);
    
    const authorityKey = crypto.randomBytes(32);
    authorityStore = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    
    coordinator = createRecoveryCoordinator({
      authorityStore,
      containerRuntime: { teardown: jest.fn(), listOwned: jest.fn() },
      snapshotBaseDirectory: snapshotBaseDir,
    });
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-147: Non-existent run is not recoverable', () => {
    const result = coordinator.checkRecoverability('run-nonexistent');
    
    expect(result.recoverable).toBe(false);
    expect(result.reason).toBe('RUN_NOT_FOUND');
  });
  
  test('S2-148: Expired run is not recoverable', () => {
    // Register run with past expiration
    authorityStore.state.runs['run-expired'] = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    
    const result = coordinator.checkRecoverability('run-expired');
    
    expect(result.recoverable).toBe(false);
    expect(result.reason).toBe('RUN_EXPIRED');
  });
  
  test('S2-149: Revoked run is not recoverable', () => {
    authorityStore.state.runs['run-revoked'] = {
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
    };
    
    const result = coordinator.checkRecoverability('run-revoked');
    
    expect(result.recoverable).toBe(false);
    expect(result.reason).toBe('RUN_REVOKED');
  });
  
  test('S2-150: Failed run is not recoverable', () => {
    authorityStore.state.runs['run-failed'] = {
      status: 'FAILED',
      failedAt: new Date().toISOString(),
    };
    
    const result = coordinator.checkRecoverability('run-failed');
    
    expect(result.recoverable).toBe(false);
    expect(result.reason).toBe('RUN_FAILED');
  });
  
  test('S2-151: Destroyed run is not recoverable', () => {
    authorityStore.state.runs['run-destroyed'] = {
      status: 'DESTROYED',
    };
    
    const result = coordinator.checkRecoverability('run-destroyed');
    
    expect(result.recoverable).toBe(false);
    expect(result.reason).toBe('RUN_DESTROYED');
  });
  
  test('S2-152: Active run with future expiration is recoverable', () => {
    authorityStore.state.runs['run-active'] = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    
    const result = coordinator.checkRecoverability('run-active');
    
    expect(result.recoverable).toBe(true);
    expect(result.status).toBe('ACTIVE');
  });
});

describe('Stage 2 Recovery Coordinator - Revocation', () => {
  
  let tempDir;
  let authorityStore;
  let coordinator;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-recovery-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    fs.mkdirSync(snapshotBaseDir);
    
    const authorityKey = crypto.randomBytes(32);
    authorityStore = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    
    coordinator = createRecoveryCoordinator({
      authorityStore,
      containerRuntime: { teardown: jest.fn(), listOwned: jest.fn() },
      snapshotBaseDirectory: snapshotBaseDir,
    });
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-153: revokeFailedRun marks active run as REVOKED', () => {
    authorityStore.state.runs['run-test'] = { status: 'ACTIVE' };
    
    const result = coordinator.revokeFailedRun('run-test', 'test-failure');
    
    expect(result.revoked).toBe(true);
    expect(authorityStore.state.runs['run-test'].status).toBe('REVOKED');
    expect(authorityStore.state.runs['run-test'].revokedAt).toBeDefined();
    expect(authorityStore.state.runs['run-test'].revocationReason).toBe('test-failure');
  });
  
  test('S2-154: revokeFailedRun is idempotent for already-revoked run', () => {
    authorityStore.state.runs['run-test'] = {
      status: 'REVOKED',
      revokedAt: '2026-01-01T00:00:00.000Z',
    };
    
    const result = coordinator.revokeFailedRun('run-test', 'test-failure');
    
    expect(result.revoked).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(result.reason).toMatch(/already non-recoverable/);
  });
  
  test('S2-155: CRITICAL - Revocation cannot restore expired authorization', () => {
    authorityStore.state.runs['run-expired'] = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    
    const result = coordinator.revokeFailedRun('run-expired', 'test');
    
    // Already expired, revocation is idempotent no-op
    expect(result.revoked).toBe(false);
    expect(result.reason).toMatch(/RUN_EXPIRED/);
  });
});

describe('Stage 2 Recovery Coordinator - Cleanup', () => {
  
  let tempDir;
  let authorityStore;
  let coordinator;
  let snapshotBaseDir;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-recovery-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    snapshotBaseDir = path.join(tempDir, 'snapshots');
    fs.mkdirSync(snapshotBaseDir);
    
    const authorityKey = crypto.randomBytes(32);
    authorityStore = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    
    coordinator = createRecoveryCoordinator({
      authorityStore,
      containerRuntime: { teardown: jest.fn(), listOwned: jest.fn() },
      snapshotBaseDirectory: snapshotBaseDir,
    });
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-156: cleanupRunResources rejects active run without force', async () => {
    authorityStore.state.runs['run-active'] = { status: 'ACTIVE' };
    
    await expect(coordinator.cleanupRunResources('run-active'))
      .rejects.toThrow(/Cannot cleanup active run/);
  });
  
  test('S2-157: cleanupRunResources removes snapshot directory', async () => {
    authorityStore.state.runs['run-test'] = { status: 'DESTROYED' };
    
    const runSnapshotDir = path.join(snapshotBaseDir, 'run-test');
    fs.mkdirSync(runSnapshotDir);
    fs.mkdirSync(path.join(runSnapshotDir, 'attempt-001'));
    fs.writeFileSync(path.join(runSnapshotDir, 'attempt-001', 'file.txt'), 'test');
    
    const result = await coordinator.cleanupRunResources('run-test');
    
    expect(result.snapshotsRemoved).toBe(1);
    expect(fs.existsSync(runSnapshotDir)).toBe(false);
  });
  
  test('S2-158: CRITICAL - cleanupRunResources detects path traversal', async () => {
    authorityStore.state.runs['../../../etc'] = { status: 'DESTROYED' };
    
    const result = await coordinator.cleanupRunResources('../../../etc');
    
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/path traversal/i);
  });
  
  test('S2-159: cleanupRunResources is idempotent', async () => {
    authorityStore.state.runs['run-test'] = { status: 'DESTROYED' };
    
    // First cleanup
    await coordinator.cleanupRunResources('run-test');
    
    // Second cleanup (no snapshot dir exists)
    const result = await coordinator.cleanupRunResources('run-test');
    
    expect(result.snapshotsRemoved).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Stage 2 Recovery Coordinator - State Integrity', () => {
  
  let tempDir;
  let authorityStore;
  let coordinator;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-recovery-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    fs.mkdirSync(snapshotBaseDir);
    
    const authorityKey = crypto.randomBytes(32);
    authorityStore = DurableAuthorityStore.initialize(authorityPath, authorityKey);
    
    coordinator = createRecoveryCoordinator({
      authorityStore,
      containerRuntime: { teardown: jest.fn(), listOwned: jest.fn() },
      snapshotBaseDirectory: snapshotBaseDir,
    });
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-160: verifyDurableStateIntegrity confirms intact state', () => {
    const result = coordinator.verifyDurableStateIntegrity();
    
    expect(result.intact).toBe(true);
    expect(result.runCount).toBe(0);
  });
  
  test('S2-161: verifyDurableStateIntegrity detects missing runs object', () => {
    delete authorityStore.state.runs;
    
    const result = coordinator.verifyDurableStateIntegrity();
    
    expect(result.intact).toBe(false);
    expect(result.reason).toMatch(/runs object missing/);
  });
  
  test('S2-162: attemptRecovery fails for expired run', () => {
    authorityStore.state.runs['run-expired'] = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    
    const result = coordinator.attemptRecovery('run-expired');
    
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('RUN_EXPIRED');
  });
  
  test('S2-163: CRITICAL - attemptRecovery never restores revoked authorization', () => {
    authorityStore.state.runs['run-revoked'] = {
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
    };
    
    const result = coordinator.attemptRecovery('run-revoked');
    
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('RUN_REVOKED');
  });
  
  test('S2-164: attemptRecovery succeeds for active run with intact state', () => {
    authorityStore.state.runs['run-active'] = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    
    const result = coordinator.attemptRecovery('run-active');
    
    expect(result.recovered).toBe(true);
    expect(result.currentStatus).toBe('ACTIVE');
  });
});

describe('Stage 2 Recovery Coordinator - NO SQL Execution Capability', () => {
  
  test('S2-165: CRITICAL - recovery-coordinator.js contains no SQL execution', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../test-safety/trusted-mysql-runner/recovery-coordinator.js'),
      'utf8'
    );
    
    expect(source).not.toMatch(/require\(['"]mysql['"]/);
    expect(source).not.toMatch(/require\(['"]mysql2['"]/);
    expect(source).not.toMatch(/require\(['"].*prisma['"]/);
    expect(source).not.toMatch(/\.query\(|\.execute\(/);
    
    const codeOnly = source
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '');
    
    expect(codeOnly).not.toMatch(/CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  });
  
  test('S2-166: CRITICAL - recovery-coordinator exports contain NO SQL execution capability', () => {
    const module = require('../../../test-safety/trusted-mysql-runner/recovery-coordinator');
    const exports = Object.keys(module);
    
    expect(exports).toEqual(['createRecoveryCoordinator']);
    
    expect(module).not.toHaveProperty('query');
    expect(module).not.toHaveProperty('execute');
    expect(module).not.toHaveProperty('connection');
    expect(module).not.toHaveProperty('pool');
    expect(module).not.toHaveProperty('prisma');
  });
});
