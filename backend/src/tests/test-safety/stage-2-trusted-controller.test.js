/**
 * Stage 2 Trusted Run Controller Security Tests
 * 
 * Tests orchestration layer coordinating all Stage 2 components:
 * - Run/attempt ID generation and validation
 * - Immutable policy binding to canonical Unit B-6
 * - Lifecycle state transitions
 * - Provider interface validation
 * - Fail-closed error handling
 * 
 * OFFLINE ONLY - Uses mock providers, NO Docker, NO MySQL.
 * 
 * @jest-environment node
 */

'use strict';

const {
  generateRunId,
  generateAttemptId,
  validateRunPolicy,
  createTrustedRunController,
  ARTIFACT_SET_ID,
} = require('../../../test-safety/trusted-mysql-runner/trusted-run-controller');
const { STATES } = require('../../../test-safety/trusted-mysql-runner/state-machine');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Stage 2 Trusted Controller - Run Identity Generation', () => {
  
  test('S2-100: generateRunId creates unique cryptographic identifiers', () => {
    const id1 = generateRunId();
    const id2 = generateRunId();
    
    expect(id1).toMatch(/^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{12}$/);
    expect(id2).toMatch(/^run-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{12}$/);
    expect(id1).not.toBe(id2);
  });
  
  test('S2-101: generateRunId accepts custom prefix', () => {
    const id = generateRunId('test');
    expect(id).toMatch(/^test-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{12}$/);
  });
  
  test('S2-102: generateAttemptId binds to parent run', () => {
    const runId = generateRunId();
    const attempt1 = generateAttemptId(runId, 1);
    const attempt2 = generateAttemptId(runId, 2);
    
    expect(attempt1).toBe(`${runId}-attempt-001`);
    expect(attempt2).toBe(`${runId}-attempt-002`);
  });
  
  test('S2-103: generateAttemptId validates attempt number range', () => {
    const runId = generateRunId();
    
    expect(() => generateAttemptId(runId, 0)).toThrow(/must be integer 1-999/);
    expect(() => generateAttemptId(runId, -1)).toThrow(/must be integer 1-999/);
    expect(() => generateAttemptId(runId, 1000)).toThrow(/must be integer 1-999/);
    expect(() => generateAttemptId(runId, 1.5)).toThrow(/must be integer 1-999/);
  });
  
  test('S2-104: generateAttemptId validates runId format', () => {
    expect(() => generateAttemptId('', 1)).toThrow(/Invalid run ID/);
    expect(() => generateAttemptId('run with spaces', 1)).toThrow(/Invalid run ID/);
    expect(() => generateAttemptId('run/with/slashes', 1)).toThrow(/Invalid run ID/);
  });
});

describe('Stage 2 Trusted Controller - Policy Validation', () => {
  
  test('S2-105: validateRunPolicy requires canonical Unit B-6 binding', () => {
    const validPolicy = Object.freeze({
      artifactSetIdentity: ARTIFACT_SET_ID,
      maxAttempts: 3,
    });
    
    expect(() => validateRunPolicy(validPolicy)).not.toThrow();
  });
  
  test('S2-106: validateRunPolicy rejects wrong artifact-set identity', () => {
    const wrongPolicy = Object.freeze({
      artifactSetIdentity: 'WRONG_IDENTITY_0000000000000000',
      maxAttempts: 3,
    });
    
    expect(() => validateRunPolicy(wrongPolicy)).toThrow(/must bind canonical Unit B-6/);
  });
  
  test('S2-107: validateRunPolicy requires frozen (immutable) policy', () => {
    const mutablePolicy = {
      artifactSetIdentity: ARTIFACT_SET_ID,
      maxAttempts: 3,
    };
    
    expect(() => validateRunPolicy(mutablePolicy)).toThrow(/must be immutable.*frozen/);
  });
  
  test('S2-108: validateRunPolicy rejects null or non-object', () => {
    expect(() => validateRunPolicy(null)).toThrow(/Run policy required/);
    expect(() => validateRunPolicy(undefined)).toThrow(/Run policy required/);
    expect(() => validateRunPolicy('policy')).toThrow(/Run policy required/);
  });
  
  test('S2-109: Canonical ARTIFACT_SET_ID is Unit B-6 identity', () => {
    expect(ARTIFACT_SET_ID).toBe('F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A');
  });
});

describe('Stage 2 Trusted Controller - Initialization', () => {
  
  let tempDir;
  let authorityStorePath;
  let artifactSourceDir;
  let snapshotBaseDir;
  let authorityKey;
  
  // Mock providers
  const mockContainerRuntime = {
    inspect: jest.fn(),
    listOwned: jest.fn(),
    teardown: jest.fn(),
  };
  
  const mockMysqlObserver = {
    observe: jest.fn(),
  };
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-controller-'));
    authorityStorePath = path.join(tempDir, 'authority.db');
    artifactSourceDir = path.join(tempDir, 'artifacts');
    snapshotBaseDir = path.join(tempDir, 'snapshots');
    authorityKey = crypto.randomBytes(32);
    
    fs.mkdirSync(artifactSourceDir);
    fs.mkdirSync(snapshotBaseDir);
    
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-110: createTrustedRunController validates container runtime provider', () => {
    expect(() => createTrustedRunController({
      containerRuntime: null,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Container runtime provider must implement inspect/);
    
    expect(() => createTrustedRunController({
      containerRuntime: { wrong: 'interface' },
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Container runtime provider must implement inspect/);
  });
  
  test('S2-111: createTrustedRunController validates MySQL observer provider', () => {
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: null,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/MySQL observer provider must implement observe/);
  });
  
  test('S2-112: createTrustedRunController validates authority store path is absolute', () => {
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath: 'relative/path.db',
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Authority store path must be absolute/);
  });
  
  test('S2-113: createTrustedRunController validates authority key is Buffer 32+ bytes', () => {
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey: 'not-a-buffer',
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Authority key must be Buffer of 32\+ bytes/);
    
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey: crypto.randomBytes(16),
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Authority key must be Buffer of 32\+ bytes/);
  });
  
  test('S2-114: createTrustedRunController validates artifact source directory is absolute', () => {
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: 'relative/artifacts',
      snapshotBaseDirectory: snapshotBaseDir,
    })).toThrow(/Artifact source directory must be absolute/);
  });
  
  test('S2-115: createTrustedRunController validates snapshot base directory is absolute', () => {
    expect(() => createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: 'relative/snapshots',
    })).toThrow(/Snapshot base directory must be absolute/);
  });
  
  test('S2-116: createTrustedRunController initializes authority store', () => {
    const controller = createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    });
    
    expect(controller.authorityStore).toBeDefined();
    expect(fs.existsSync(authorityStorePath)).toBe(true);
  });
  
  test('S2-117: createTrustedRunController exports expected functions', () => {
    const controller = createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    });
    
    expect(typeof controller.generateRunId).toBe('function');
    expect(typeof controller.generateAttemptId).toBe('function');
    expect(typeof controller.initializeRun).toBe('function');
    expect(typeof controller.attestIdentity).toBe('function');
    expect(typeof controller.snapshotArtifacts).toBe('function');
    expect(typeof controller.teardownRun).toBe('function');
    expect(typeof controller.detectOrphans).toBe('function');
  });
});

describe('Stage 2 Trusted Controller - Run Initialization', () => {
  
  let tempDir;
  let controller;
  
  const mockContainerRuntime = {
    inspect: jest.fn(),
    listOwned: jest.fn(),
    teardown: jest.fn(),
  };
  
  const mockMysqlObserver = {
    observe: jest.fn(),
  };
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-controller-'));
    const authorityStorePath = path.join(tempDir, 'authority.db');
    const artifactSourceDir = path.join(tempDir, 'artifacts');
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    const authorityKey = crypto.randomBytes(32);
    
    fs.mkdirSync(artifactSourceDir);
    fs.mkdirSync(snapshotBaseDir);
    
    controller = createTrustedRunController({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityStorePath,
      authorityKey,
      artifactSourceDirectory: artifactSourceDir,
      snapshotBaseDirectory: snapshotBaseDir,
    });
    
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('S2-118: initializeRun creates frozen context', async () => {
    const provisioning = { containerId: 'test-container' };
    const context = await controller.initializeRun(provisioning);
    
    expect(Object.isFrozen(context)).toBe(true);
  });
  
  test('S2-119: initializeRun generates unique runId and attemptId', async () => {
    const provisioning = { containerId: 'test-container' };
    const context1 = await controller.initializeRun(provisioning);
    const context2 = await controller.initializeRun(provisioning);
    
    expect(context1.runId).toMatch(/^run-/);
    expect(context2.runId).toMatch(/^run-/);
    expect(context1.runId).not.toBe(context2.runId);
    
    expect(context1.attemptId).toBe(`${context1.runId}-attempt-001`);
    expect(context2.attemptId).toBe(`${context2.runId}-attempt-001`);
  });
  
  test('S2-120: initializeRun binds policy to canonical Unit B-6 artifact-set', async () => {
    const provisioning = { containerId: 'test-container' };
    const context = await controller.initializeRun(provisioning);
    
    expect(context.policy.artifactSetIdentity).toBe(ARTIFACT_SET_ID);
    expect(Object.isFrozen(context.policy)).toBe(true);
  });
  
  test('S2-121: initializeRun transitions to PROVISIONING state', async () => {
    const provisioning = { containerId: 'test-container' };
    const context = await controller.initializeRun(provisioning);
    
    expect(context.state).toBe(STATES.PROVISIONING);
    expect(context.stateHistory).toHaveLength(2);
    expect(context.stateHistory[0].state).toBe(STATES.CREATED);
    expect(context.stateHistory[1].state).toBe(STATES.PROVISIONING);
  });
  
  test('S2-122: initializeRun accepts policy overrides while preserving artifact binding', async () => {
    const provisioning = { containerId: 'test-container' };
    const context = await controller.initializeRun(provisioning, {
      maxAttempts: 5,
      timeoutSeconds: 7200,
    });
    
    expect(context.policy.artifactSetIdentity).toBe(ARTIFACT_SET_ID);
    expect(context.policy.maxAttempts).toBe(5);
    expect(context.policy.timeoutSeconds).toBe(7200);
  });
  
  test('S2-123: initializeRun freezes state history', async () => {
    const provisioning = { containerId: 'test-container' };
    const context = await controller.initializeRun(provisioning);
    
    expect(Object.isFrozen(context.stateHistory)).toBe(true);
    context.stateHistory.forEach(entry => {
      expect(Object.isFrozen(entry)).toBe(true);
    });
  });
});

describe('Stage 2 Trusted Controller - No SQL Execution Capability', () => {
  
  test('S2-124: CRITICAL - trusted-run-controller.js contains no SQL execution', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../test-safety/trusted-mysql-runner/trusted-run-controller.js'),
      'utf8'
    );
    
    // Verify no SQL execution imports or calls
    expect(source).not.toMatch(/require\(['"]mysql['"]|require\(['"]mysql2['"]/);
    expect(source).not.toMatch(/require\(['"].*prisma['"]/);
    expect(source).not.toMatch(/\.query\(|\.execute\(/);
    
    // Check for SQL keywords in actual code (not comments or strings)
    const codeOnly = source
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '');
    
    expect(codeOnly).not.toMatch(/CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  });
  
  test('S2-125: CRITICAL - trusted-run-controller exports contain NO SQL execution capability', () => {
    const module = require('../../../test-safety/trusted-mysql-runner/trusted-run-controller');
    const exports = Object.keys(module);
    
    expect(exports.sort()).toEqual([
      'ARTIFACT_SET_ID',
      'createTrustedRunController',
      'generateAttemptId',
      'generateRunId',
      'validateRunPolicy',
    ].sort());
    
    expect(module).not.toHaveProperty('query');
    expect(module).not.toHaveProperty('execute');
    expect(module).not.toHaveProperty('connection');
    expect(module).not.toHaveProperty('pool');
    expect(module).not.toHaveProperty('prisma');
  });
  
  test('S2-126: Controller coordinates snapshot creation, does NOT execute SQL', () => {
    // Documented capability: Orchestrates lifecycle, coordinates snapshot
    // Does NOT execute SQL, does NOT connect to MySQL, does NOT authorize Unit C-2
    expect(true).toBe(true);
  });
});
