/**
 * Stage 2 Attestation Coordinator Security Tests
 * 
 * CRITICAL SECURITY TESTS - Caller-controlled identity must NEVER be trusted.
 * Provider observations must originate from controlled adapter boundaries.
 * 
 * OFFLINE ONLY - Uses mock providers, NO Docker, NO MySQL.
 * 
 * @jest-environment node
 */

'use strict';

const {
  createAttestationCoordinator,
  verifyIdentityAgreement,
  computePolicyDigest,
} = require('../../../test-safety/trusted-mysql-runner/attestation-coordinator');
const crypto = require('crypto');

describe('Stage 2 Attestation Coordinator - Identity Agreement', () => {
  
  test('S2-127: verifyIdentityAgreement requires all identity components', () => {
    expect(() => verifyIdentityAgreement(null, {}, {})).toThrow(/All identity components required/);
    expect(() => verifyIdentityAgreement({}, null, {})).toThrow(/All identity components required/);
    expect(() => verifyIdentityAgreement({}, {}, null)).toThrow(/All identity components required/);
  });
  
  test('S2-128: Container ID must match target profile', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-1', imageDigest: 'sha256:abc', platform: 'linux/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-1', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-456', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    expect(() => verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile))
      .toThrow(/Container ID does not match expected profile/);
  });
  
  test('S2-129: Network ID must match target profile', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-WRONG', imageDigest: 'sha256:abc', platform: 'linux/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-1', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-123', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    expect(() => verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile))
      .toThrow(/Network ID does not match expected profile/);
  });
  
  test('S2-130: MySQL server UUID must match target profile', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-1', imageDigest: 'sha256:abc', platform: 'linux/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-WRONG', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-123', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    expect(() => verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile))
      .toThrow(/MySQL server UUID does not match expected profile/);
  });
  
  test('S2-131: Image digest must match target profile', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-1', imageDigest: 'sha256:WRONG', platform: 'linux/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-1', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-123', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    expect(() => verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile))
      .toThrow(/image digest does not match expected profile/);
  });
  
  test('S2-132: Platform must match target profile', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-1', imageDigest: 'sha256:abc', platform: 'windows/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-1', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-123', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    expect(() => verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile))
      .toThrow(/platform does not match expected profile/);
  });
  
  test('S2-133: Valid identity agreement returns frozen composite', () => {
    const containerIdentity = { containerId: 'container-123', networkId: 'net-1', imageDigest: 'sha256:abc', platform: 'linux/amd64' };
    const mysqlIdentity = { serverUuid: 'uuid-1', version: '8.4.0' };
    const targetProfile = { expectedContainerId: 'container-123', expectedNetworkId: 'net-1', expectedServerUuid: 'uuid-1', expectedImageDigest: 'sha256:abc', expectedPlatform: 'linux/amd64' };
    
    const verified = verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile);
    
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified.containerId).toBe('container-123');
    expect(verified.serverUuid).toBe('uuid-1');
    expect(verified.verifiedAt).toBeDefined();
  });
});

describe('Stage 2 Attestation Coordinator - Policy Digest', () => {
  
  test('S2-134: Policy digest is deterministic', () => {
    const policy = { artifactSetIdentity: 'ABC', maxAttempts: 3 };
    const digest1 = computePolicyDigest(policy);
    const digest2 = computePolicyDigest(policy);
    
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^[A-F0-9]{64}$/);
  });
  
  test('S2-135: Policy digest changes with different values', () => {
    const policy1 = { artifactSetIdentity: 'ABC', maxAttempts: 3 };
    const policy2 = { artifactSetIdentity: 'ABC', maxAttempts: 5 };
    
    const digest1 = computePolicyDigest(policy1);
    const digest2 = computePolicyDigest(policy2);
    
    expect(digest1).not.toBe(digest2);
  });
});

describe('Stage 2 Attestation Coordinator - Initialization', () => {
  
  const mockContainerRuntime = { inspect: jest.fn() };
  const mockMysqlObserver = { observe: jest.fn() };
  const authorityKey = crypto.randomBytes(32);
  const runId = 'run-2026-10-24T12-00-00-abc123';
  const attemptId = 'run-2026-10-24T12-00-00-abc123-attempt-001';
  const policy = Object.freeze({ artifactSetIdentity: 'F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A' });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('S2-136: createAttestationCoordinator validates container runtime provider', () => {
    expect(() => createAttestationCoordinator({
      containerRuntime: null,
      mysqlObserver: mockMysqlObserver,
      authorityKey,
      runId,
      attemptId,
      policy,
    })).toThrow(/Container runtime provider required/);
  });
  
  test('S2-137: createAttestationCoordinator validates MySQL observer provider', () => {
    expect(() => createAttestationCoordinator({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: null,
      authorityKey,
      runId,
      attemptId,
      policy,
    })).toThrow(/MySQL observer provider required/);
  });
  
  test('S2-138: createAttestationCoordinator validates authority key', () => {
    expect(() => createAttestationCoordinator({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityKey: crypto.randomBytes(16),
      runId,
      attemptId,
      policy,
    })).toThrow(/Authority key must be Buffer of 32\+ bytes/);
  });
  
  test('S2-139: createAttestationCoordinator validates runId format', () => {
    expect(() => createAttestationCoordinator({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityKey,
      runId: 'invalid run id with spaces',
      attemptId,
      policy,
    })).toThrow(/Valid run ID required/);
  });
  
  test('S2-140: createAttestationCoordinator requires immutable policy', () => {
    const mutablePolicy = { artifactSetIdentity: 'ABC' };
    
    expect(() => createAttestationCoordinator({
      containerRuntime: mockContainerRuntime,
      mysqlObserver: mockMysqlObserver,
      authorityKey,
      runId,
      attemptId,
      policy: mutablePolicy,
    })).toThrow(/Immutable policy required/);
  });
});

describe('Stage 2 Attestation Coordinator - NO SQL Execution Capability', () => {
  
  test('S2-141: CRITICAL - attestation-coordinator.js contains no SQL execution', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../../test-safety/trusted-mysql-runner/attestation-coordinator.js'),
      'utf8'
    );
    
    expect(source).not.toMatch(/require\(['"]mysql['"]|require\(['"]mysql2['"]/);
    expect(source).not.toMatch(/require\(['"].*prisma['"]/);
    expect(source).not.toMatch(/\.query\(|\.execute\(/);
    
    const codeOnly = source
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '');
    
    expect(codeOnly).not.toMatch(/CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  });
  
  test('S2-142: CRITICAL - attestation-coordinator exports contain NO SQL execution capability', () => {
    const module = require('../../../test-safety/trusted-mysql-runner/attestation-coordinator');
    const exports = Object.keys(module);
    
    expect(exports.sort()).toEqual([
      'computePolicyDigest',
      'createAttestationCoordinator',
      'verifyIdentityAgreement',
    ].sort());
    
    expect(module).not.toHaveProperty('query');
    expect(module).not.toHaveProperty('execute');
    expect(module).not.toHaveProperty('connection');
    expect(module).not.toHaveProperty('pool');
    expect(module).not.toHaveProperty('prisma');
  });
});
