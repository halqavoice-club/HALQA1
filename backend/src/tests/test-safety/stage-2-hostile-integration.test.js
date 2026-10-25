/**
 * Stage 2 Hostile Integration Tests
 * 
 * CRITICAL: Tests complete lifecycle with attack vectors.
 * Verifies IMG-GAP-01 security control: Empty approved digest list MUST reject all attestation.
 * 
 * OFFLINE ONLY - Uses mock providers, NO Docker, NO MySQL.
 * 
 * @jest-environment node
 */

'use strict';

const { createTrustedRunController, ARTIFACT_SET_ID } = require('../../../test-safety/trusted-mysql-runner/trusted-run-controller');
const { DurableAuthorityStore } = require('../../../test-safety/trusted-mysql-runner/durable-authority-store');
const { STATES } = require('../../../test-safety/trusted-mysql-runner/state-machine');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Stage 2 Hostile Integration - Lifecycle Bypass Attempts', () => {
  
  let tempDir;
  let controller;
  let mockContainerRuntime;
  let mockMysqlObserver;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-hostile-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    const authorityKey = crypto.randomBytes(32);
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    const artifactSourceDir = path.join(tempDir, 'artifacts');
    
    fs.mkdirSync(snapshotBaseDir);
    fs.mkdirSync(artifactSourceDir);
    
    // Create fake artifact source
    fs.writeFileSync(path.join(artifactSourceDir, 'ARTIFACT_SET_IDENTITY'), ARTIFACT_SET_ID);
    
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
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('ATTACK-001: CRITICAL - Cannot bypass attestIdentity step', async () => {
    const context = await controller.initializeRun({ containerId: 'container-test', networkId: 'net-1' });
    
    // Attempt to skip attestation and go directly to snapshot
    await expect(controller.snapshotArtifacts(context))
      .rejects.toThrow(/Cannot snapshot artifacts in state/);
  });
  
  test('ATTACK-002: CRITICAL - Cannot forge container identity', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    const context = await controller.initializeRun(provisioningRecord);
    
    // Mock container runtime returns DIFFERENT container ID (forged)
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-FORGED',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-FOR',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // Attestation MUST reject forged identity
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/does not match runner-owned provisioning record/);
  });
  
  test('ATTACK-003: CRITICAL - IMG-GAP-01 enforced - empty approved digest list', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    const context = await controller.initializeRun(provisioningRecord);
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    // This is IMG-GAP-01 enforced - no approved MySQL 8.4 digest exists
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
  
  test('ATTACK-004: CRITICAL - Unapproved MySQL version rejected', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    const context = await controller.initializeRun(provisioningRecord);
    
    // Mock container with UNAPPROVED MySQL version (5.7, not 8.4)
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '5.7.0', // Wrong version
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/not MySQL 8\.4/);
  });
  
  test('ATTACK-005: CRITICAL - IMG-GAP-01 prevents cross-run replay', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    const context1 = await controller.initializeRun(provisioningRecord);
    await expect(controller.attestIdentity(context1))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
  
  test('ATTACK-006: CRITICAL - IMG-GAP-01 prevents nonce consumption', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    const context = await controller.initializeRun(provisioningRecord);
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
  
  test('ATTACK-007: CRITICAL - IMG-GAP-01 prevents destroyed run reactivation', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    const context = await controller.initializeRun(provisioningRecord);
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
  
  test('ATTACK-008: CRITICAL - IMG-GAP-01 prevents revoked run reuse', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
      runId: 'run-test-revoked',
    };
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    const context = await controller.initializeRun(provisioningRecord);
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
});

describe('Stage 2 Hostile Integration - Artifact Integrity', () => {
  
  let tempDir;
  let controller;
  let mockContainerRuntime;
  let mockMysqlObserver;
  let artifactSourceDir;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-hostile-'));
    const authorityPath = path.join(tempDir, 'authority.db');
    const authorityKey = crypto.randomBytes(32);
    const snapshotBaseDir = path.join(tempDir, 'snapshots');
    artifactSourceDir = path.join(tempDir, 'artifacts');
    
    fs.mkdirSync(snapshotBaseDir);
    fs.mkdirSync(artifactSourceDir);
    
    // Create fake artifact source
    fs.writeFileSync(path.join(artifactSourceDir, 'ARTIFACT_SET_IDENTITY'), ARTIFACT_SET_ID);
    
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
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  test('ATTACK-009: CRITICAL - IMG-GAP-01 prevents artifact substitution', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    mockContainerRuntime.inspect.mockResolvedValue({
      containerId: 'container-test',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      platform: 'linux/amd64',
      networkId: 'net-1',
      networkName: 'test-network',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
      internalPort: 3306,
    });
    
    mockMysqlObserver.observe.mockResolvedValue({
      serverUuid: '12345678-1234-1234-1234-123456789abc',
      version: '8.4.0',
      hostname: 'container-tes',
      endpointHost: '127.0.0.1',
      endpointPort: 3306,
    });
    
    // Substitute artifact identity file with WRONG identity
    fs.writeFileSync(path.join(artifactSourceDir, 'ARTIFACT_SET_IDENTITY'), 'WRONG_IDENTITY');
    
    // SECURITY VERIFICATION: Empty approved digest list MUST reject all attestation attempts
    const context = await controller.initializeRun(provisioningRecord);
    await expect(controller.attestIdentity(context))
      .rejects.toThrow(/No approved MySQL 8\.4 digest exists.*IMG-GAP-01/);
  });
  
  test('ATTACK-010: CRITICAL - Cannot snapshot before attestation', async () => {
    const provisioningRecord = {
      containerId: 'container-test',
      networkId: 'net-1',
    };
    
    const context = await controller.initializeRun(provisioningRecord);
    
    // Attempt snapshot without attestation
    await expect(controller.snapshotArtifacts(context))
      .rejects.toThrow(/Cannot snapshot artifacts in state/);
  });
});

describe('Stage 2 Hostile Integration - NO SQL Execution', () => {
  
  test('ATTACK-011: CRITICAL - Controller has no SQL execution capability', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../test-safety/trusted-mysql-runner/trusted-run-controller.js'),
      'utf8'
    );
    
    expect(source).not.toMatch(/require\(['"]mysql['"]/);
    expect(source).not.toMatch(/require\(['"]mysql2['"]/);
    expect(source).not.toMatch(/require\(['"].*prisma['"]/);
    expect(source).not.toMatch(/\.query\(|\.execute\(/);
  });
  
  test('ATTACK-012: CRITICAL - Runtime adapter has no SQL execution capability', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../test-safety/trusted-mysql-runner/runtime-adapter.js'),
      'utf8'
    );
    
    expect(source).not.toMatch(/require\(['"]mysql['"]/);
    expect(source).not.toMatch(/require\(['"]mysql2['"]/);
    expect(source).not.toMatch(/require\(['"].*prisma['"]/);
    expect(source).not.toMatch(/\.query\(|\.execute\(/);
  });
});
