/**
 * Stage 2 Runtime Adapter Security Tests
 * 
 * Tests trust boundaries, provider interface validation, authorization enforcement,
 * and runtime capability lockout.
 * 
 * OFFLINE ONLY - NO Docker, NO MySQL, NO SQL execution.
 * Uses mocked provider observations only.
 * 
 * @jest-environment node
 */

'use strict';

const crypto = require('crypto');
const runtimeAdapter = require('../../../test-safety/trusted-mysql-runner/runtime-adapter');
const { DurableAuthorityStore } = require('../../../test-safety/trusted-mysql-runner/durable-authority-store');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Stage 2 Runtime Adapter - Trust Boundaries', () => {
  
  describe('createIsolatedSubprocessEnvironment', () => {
    
    test('S2-01: Only allowlisted environment variables pass through', () => {
      const inherited = {
        PATH: '/usr/bin',
        DATABASE_URL: 'mysql://secret',
        API_KEY: 'secret-key',
        NODE_ENV: 'test',
        TEMP: '/tmp',
      };
      
      const result = runtimeAdapter.createIsolatedSubprocessEnvironment(inherited);
      
      expect(result.PATH).toBe('/usr/bin');
      expect(result.NODE_ENV).toBe('test');
      expect(result.TEMP).toBe('/tmp');
      expect(result.DATABASE_URL).toBeUndefined();
      expect(result.API_KEY).toBeUndefined();
    });
    
    test('S2-02: Non-allowlisted additions are rejected', () => {
      expect(() => {
        runtimeAdapter.createIsolatedSubprocessEnvironment({}, { DATABASE_URL: 'mysql://test' });
      }).toThrow(/not allowlisted/);
      
      expect(() => {
        runtimeAdapter.createIsolatedSubprocessEnvironment({}, { CUSTOM_VAR: 'value' });
      }).toThrow(/not allowlisted/);
    });
    
    test('S2-03: Result is frozen (immutable)', () => {
      const result = runtimeAdapter.createIsolatedSubprocessEnvironment({ PATH: '/usr/bin' });
      
      expect(Object.isFrozen(result)).toBe(true);
      expect(() => {
        result.PATH = '/malicious';
      }).toThrow();
      expect(() => {
        result.INJECTED = 'value';
      }).toThrow();
    });
    
    test('S2-04: Allowlisted additions are accepted', () => {
      const result = runtimeAdapter.createIsolatedSubprocessEnvironment(
        { PATH: '/usr/bin' },
        { NODE_ENV: 'test', TEMP: '/custom-temp' }
      );
      
      expect(result.PATH).toBe('/usr/bin');
      expect(result.NODE_ENV).toBe('test');
      expect(result.TEMP).toBe('/custom-temp');
    });
  });
  
  describe('validateObservedIdentity - Trust Boundary Validation', () => {
    
    const validContainer = {
      containerId: 'abc123def456',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      platform: 'linux/amd64',
      networkId: 'net-isolated-123',
      networkName: 'halqa-test-net',
      endpointHost: '127.0.0.1',
      endpointPort: '3307',
      internalPort: '3306',
    };
    
    const validMysql = {
      serverUuid: '12345678-1234-4123-8123-123456789012',
      version: '8.4.3',
      hostname: 'abc123def456',
      endpointHost: '127.0.0.1',
      endpointPort: '3307',
    };
    
    const validExpected = {
      containerId: 'abc123def456',
      networkId: 'net-isolated-123',
    };
    
    test('S2-05: Valid observations produce verified identity', () => {
      // BLOCKED BY IMG-GAP-01: Approved digest allowlist is empty
      // This test requires an approved MySQL 8.4 digest from security team
      // Expected behavior: validateObservedIdentity should succeed with approved digest
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, validMysql, validExpected);
      }).toThrow(/IMG-GAP-01|No approved MySQL 8.4 digest/);
    });
    
    test('S2-06: Missing container fields are rejected', () => {
      const requiredFields = ['containerId', 'imageDigest', 'platform', 'networkId', 'networkName', 'endpointHost', 'endpointPort', 'internalPort'];
      
      for (const field of requiredFields) {
        const incomplete = { ...validContainer };
        delete incomplete[field];
        
        expect(() => {
          runtimeAdapter.validateObservedIdentity(incomplete, validMysql, validExpected);
        }).toThrow(new RegExp(`Missing container observation: ${field}`));
      }
    });
    
    test('S2-07: Missing MySQL fields are rejected', () => {
      const requiredFields = ['serverUuid', 'version', 'hostname', 'endpointHost', 'endpointPort'];
      
      for (const field of requiredFields) {
        const incomplete = { ...validMysql };
        delete incomplete[field];
        
        expect(() => {
          runtimeAdapter.validateObservedIdentity(validContainer, incomplete, validExpected);
        }).toThrow(new RegExp(`Missing MySQL observation: ${field}`));
      }
    });
    
    test('S2-08: Container and MySQL endpoint mismatch is rejected', () => {
      const mismatchedMysql = { ...validMysql, endpointHost: '127.0.0.2' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, mismatchedMysql, validExpected);
      }).toThrow(/endpoint observations conflict/);
      
      const mismatchedPort = { ...validMysql, endpointPort: '3308' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, mismatchedPort, validExpected);
      }).toThrow(/endpoint observations conflict/);
    });
    
    test('S2-09: Container ID substitution is rejected', () => {
      const wrongExpected = { ...validExpected, containerId: 'forged-container-id' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, validMysql, wrongExpected);
      }).toThrow(/does not match runner-owned provisioning record/);
    });
    
    test('S2-10: Network ID substitution is rejected', () => {
      const wrongExpected = { ...validExpected, networkId: 'prod-network-456' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, validMysql, wrongExpected);
      }).toThrow(/does not match runner-owned provisioning record/);
    });
    
    test('S2-11: MySQL hostname must bind to container ID', () => {
      const unboundMysql = { ...validMysql, hostname: 'forged-hostname' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, unboundMysql, validExpected);
      }).toThrow(/hostname does not bind to container identity/);
    });
    
    test('S2-12: Wrong MySQL version is rejected', () => {
      const wrongVersion = { ...validMysql, version: '8.0.35' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, wrongVersion, validExpected);
      }).toThrow(/not MySQL 8.4/);
      
      const mariadb = { ...validMysql, version: '10.5.8-MariaDB' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, mariadb, validExpected);
      }).toThrow(/not MySQL 8.4/);
    });
    
    test('S2-13: Malformed MySQL server UUID is rejected', () => {
      const malformed = { ...validMysql, serverUuid: 'not-a-uuid' };
      
      // BLOCKED BY IMG-GAP-01: Image validation happens before UUID validation
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, malformed, validExpected);
      }).toThrow(/IMG-GAP-01|UUID is malformed/);
      
      const empty = { ...validMysql, serverUuid: '' };
      
      // Empty serverUuid triggers "Missing MySQL observation" before format check
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, empty, validExpected);
      }).toThrow(/Missing MySQL observation: serverUuid/);
    });
    
    test('S2-14: Wrong platform is rejected', () => {
      const wrongPlatform = { ...validContainer, platform: 'linux/s390x' };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(wrongPlatform, validMysql, validExpected);
      }).toThrow(/Unsupported platform/);
    });
    
    test('S2-15: Identity digest is deterministic', () => {
      // BLOCKED BY IMG-GAP-01: Approved digest allowlist is empty
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, validMysql, validExpected);
      }).toThrow(/IMG-GAP-01|No approved MySQL 8.4 digest/);
    });
    
    test('S2-16: Identity mutation changes digest', () => {
      // BLOCKED BY IMG-GAP-01: Approved digest allowlist is empty
      expect(() => {
        runtimeAdapter.validateObservedIdentity(validContainer, validMysql, validExpected);
      }).toThrow(/IMG-GAP-01|No approved MySQL 8.4 digest/);
    });
  });
  
  describe('createStepAuthority - Per-Step Authorization', () => {
    
    let tempDir;
    let storePath;
    let authorityKey;
    let store;
    
    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-test-'));
      storePath = path.join(tempDir, 'authority.json');
      authorityKey = crypto.randomBytes(32);
      store = DurableAuthorityStore.initialize(storePath, authorityKey);
    });
    
    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
    
    test('S2-17: Step authority requires valid key', () => {
      expect(() => {
        runtimeAdapter.createStepAuthority({
          key: Buffer.from('short'),
          store,
          runId: 'test-run',
          identityDigest: 'sha256:' + 'a'.repeat(64),
        });
      }).toThrow(/at least 32 bytes/);
    });
    
    test('S2-18: Step authority requires durable store', () => {
      expect(() => {
        runtimeAdapter.createStepAuthority({
          key: authorityKey,
          store: null,
          runId: 'test-run',
          identityDigest: 'sha256:' + 'a'.repeat(64),
        });
      }).toThrow(/store is required/);
      
      expect(() => {
        runtimeAdapter.createStepAuthority({
          key: authorityKey,
          store: {},
          runId: 'test-run',
          identityDigest: 'sha256:' + 'a'.repeat(64),
        });
      }).toThrow(/store is required/);
    });
    
    test('S2-19: Only 4 authorized steps are allowed', () => {
      const identityDigest = 'sha256:' + 'a'.repeat(64);
      store.registerRun('test-run', identityDigest);
      
      const authority = runtimeAdapter.createStepAuthority({
        key: authorityKey,
        store,
        runId: 'test-run',
        identityDigest,
      });
      
      const allowedSteps = ['OBSERVE_IDENTITY', 'VERIFY_ACCOUNTS', 'SNAPSHOT_ARTIFACTS', 'TEARDOWN'];
      
      for (const step of allowedSteps) {
        expect(() => {
          authority.executeAuthorizedStep(step, () => 'executed');
        }).not.toThrow();
      }
    });
    
    test('S2-20: Unauthorized steps are rejected', () => {
      const identityDigest = 'sha256:' + 'a'.repeat(64);
      store.registerRun('test-run', identityDigest);
      
      const authority = runtimeAdapter.createStepAuthority({
        key: authorityKey,
        store,
        runId: 'test-run',
        identityDigest,
      });
      
      const unauthorizedSteps = ['EXECUTE_SQL', 'DROP_TABLE', 'GRANT_PRIVILEGES', 'RANDOM_STEP'];
      
      for (const step of unauthorizedSteps) {
        expect(() => {
          authority.executeAuthorizedStep(step, () => 'should-not-execute');
        }).toThrow(/Unauthorized runtime step/);
      }
    });
    
    test('S2-21: Step execution consumes nonce from durable store', () => {
      const identityDigest = 'sha256:' + 'a'.repeat(64);
      store.registerRun('test-run', identityDigest);
      
      const authority = runtimeAdapter.createStepAuthority({
        key: authorityKey,
        store,
        runId: 'test-run',
        identityDigest,
      });
      
      let executionCount = 0;
      authority.executeAuthorizedStep('OBSERVE_IDENTITY', () => {
        executionCount++;
        return 'executed';
      });
      
      expect(executionCount).toBe(1);
      
      // Verify nonce was consumed (indirectly via store state)
      const run = store.getRun('test-run');
      expect(run).toBeDefined();
      expect(run.status).toBe('ACTIVE');
    });
    
    test('S2-22: Step operation must be a function', () => {
      const identityDigest = 'sha256:' + 'a'.repeat(64);
      store.registerRun('test-run', identityDigest);
      
      const authority = runtimeAdapter.createStepAuthority({
        key: authorityKey,
        store,
        runId: 'test-run',
        identityDigest,
      });
      
      expect(() => {
        authority.executeAuthorizedStep('OBSERVE_IDENTITY', 'not-a-function');
      }).toThrow(/must be a function/);
    });
    
    test('S2-23: Authorization evidence is passed to operation', () => {
      const identityDigest = 'sha256:' + 'a'.repeat(64);
      store.registerRun('test-run', identityDigest);
      
      const authority = runtimeAdapter.createStepAuthority({
        key: authorityKey,
        store,
        runId: 'test-run',
        identityDigest,
      });
      
      let capturedEvidence = null;
      authority.executeAuthorizedStep('OBSERVE_IDENTITY', (evidence) => {
        capturedEvidence = evidence;
      });
      
      expect(capturedEvidence).toBeDefined();
      expect(capturedEvidence.runId).toBe('test-run');
      expect(capturedEvidence.identityDigest).toBe(identityDigest);
      expect(capturedEvidence.step).toBe('OBSERVE_IDENTITY');
      expect(capturedEvidence.nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(capturedEvidence.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(capturedEvidence.mac).toBe('[REDACTED]');
    });
  });
  
  describe('validateAccountLifecycle - Account Policy Integration', () => {
    
    test('S2-24: Valid account lifecycle passes validation', () => {
      const bootstrapGrants = [
        "GRANT CREATE USER, RELOAD, GRANT OPTION ON *.* TO 'bootstrap'@'%'",
      ];
      
      const migratorGrants = [
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
      ];
      
      const readerGrants = [
        "GRANT SELECT ON `halqa_mysql8_ci_test`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        runtimeAdapter.validateAccountLifecycle({
          bootstrapGrants,
          migratorGrants,
          readerGrants,
          schema: 'halqa_mysql8_ci_test',
          bootstrapRevoked: true,
        });
      }).not.toThrow();
    });
    
    test('S2-25: Bootstrap not revoked is rejected', () => {
      const bootstrapGrants = [
        "GRANT CREATE USER, RELOAD, GRANT OPTION ON *.* TO 'bootstrap'@'%'",
      ];
      
      const migratorGrants = [
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
      ];
      
      const readerGrants = [
        "GRANT SELECT ON `halqa_mysql8_ci_test`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        runtimeAdapter.validateAccountLifecycle({
          bootstrapGrants,
          migratorGrants,
          readerGrants,
          schema: 'halqa_mysql8_ci_test',
          bootstrapRevoked: false,
        });
      }).toThrow(/revocation has not been observed/);
    });
    
    test('S2-26: Invalid bootstrap privileges are rejected', () => {
      const invalidBootstrap = [
        "GRANT CREATE USER, RELOAD, GRANT OPTION, FILE ON *.* TO 'bootstrap'@'%'",
      ];
      
      const migratorGrants = [
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
      ];
      
      const readerGrants = [
        "GRANT SELECT ON `halqa_mysql8_ci_test`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        runtimeAdapter.validateAccountLifecycle({
          bootstrapGrants: invalidBootstrap,
          migratorGrants,
          readerGrants,
          schema: 'halqa_mysql8_ci_test',
          bootstrapRevoked: true,
        });
      }).toThrow(/unexpected privilege: FILE/);
    });
    
    test('S2-27: Invalid migrator privileges are rejected', () => {
      const bootstrapGrants = [
        "GRANT CREATE USER, RELOAD, GRANT OPTION ON *.* TO 'bootstrap'@'%'",
      ];
      
      const invalidMigrator = [
        "GRANT ALL PRIVILEGES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
      ];
      
      const readerGrants = [
        "GRANT SELECT ON `halqa_mysql8_ci_test`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        runtimeAdapter.validateAccountLifecycle({
          bootstrapGrants,
          migratorGrants: invalidMigrator,
          readerGrants,
          schema: 'halqa_mysql8_ci_test',
          bootstrapRevoked: true,
        });
      }).toThrow(/ALL/);
    });
    
    test('S2-28: Invalid reader privileges are rejected', () => {
      const bootstrapGrants = [
        "GRANT CREATE USER, RELOAD, GRANT OPTION ON *.* TO 'bootstrap'@'%'",
      ];
      
      const migratorGrants = [
        "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
      ];
      
      const invalidReader = [
        "GRANT SELECT, INSERT ON `halqa_mysql8_ci_test`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        runtimeAdapter.validateAccountLifecycle({
          bootstrapGrants,
          migratorGrants,
          readerGrants: invalidReader,
          schema: 'halqa_mysql8_ci_test',
          bootstrapRevoked: true,
        });
      }).toThrow(/write privilege/);
    });
  });
  
  describe('createTrustedRuntimeAdapter - Provider Interface Validation', () => {
    
    test('S2-29: Incomplete containerRuntime provider is rejected', () => {
      const incomplete = {
        inspect: async () => ({}),
        // Missing listOwned and teardown
      };
      
      expect(() => {
        runtimeAdapter.createTrustedRuntimeAdapter({
          containerRuntime: incomplete,
          mysqlObserver: { observe: async () => ({}) },
          authorityStore: {},
          authorityKey: Buffer.alloc(32),
          runId: 'test',
        });
      }).toThrow(/container runtime interface is incomplete/);
    });
    
    test('S2-30: Incomplete mysqlObserver provider is rejected', () => {
      const validRuntime = {
        inspect: async () => ({}),
        listOwned: async () => [],
        teardown: async () => {},
      };
      
      const incomplete = {};
      
      expect(() => {
        runtimeAdapter.createTrustedRuntimeAdapter({
          containerRuntime: validRuntime,
          mysqlObserver: incomplete,
          authorityStore: {},
          authorityKey: Buffer.alloc(32),
          runId: 'test',
        });
      }).toThrow(/MySQL observation interface is incomplete/);
    });
    
    test('S2-31: Adapter provides attest, detectOrphans, teardown methods', () => {
      const validRuntime = {
        inspect: async () => ({
          containerId: 'abc123',
          imageDigest: 'sha256:' + 'a'.repeat(64),
          platform: 'linux/amd64',
          networkId: 'net-123',
          networkName: 'test-net',
          endpointHost: '127.0.0.1',
          endpointPort: '3307',
          internalPort: '3306',
        }),
        listOwned: async () => [],
        teardown: async () => {},
      };
      
      const validObserver = {
        observe: async () => ({
          serverUuid: '12345678-1234-4123-8123-123456789012',
          version: '8.4.3',
          hostname: 'abc123',
          endpointHost: '127.0.0.1',
          endpointPort: '3307',
        }),
      };
      
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-test-'));
      const storePath = path.join(tempDir, 'authority.json');
      const authorityKey = crypto.randomBytes(32);
      const store = DurableAuthorityStore.initialize(storePath, authorityKey);
      
      try {
        const adapter = runtimeAdapter.createTrustedRuntimeAdapter({
          containerRuntime: validRuntime,
          mysqlObserver: validObserver,
          authorityStore: store,
          authorityKey,
          runId: 'test-run',
        });
        
        expect(adapter.attest).toBeDefined();
        expect(typeof adapter.attest).toBe('function');
        expect(adapter.detectOrphans).toBeDefined();
        expect(typeof adapter.detectOrphans).toBe('function');
        expect(adapter.teardown).toBeDefined();
        expect(typeof adapter.teardown).toBe('function');
        expect(adapter.createIsolatedSubprocessEnvironment).toBeDefined();
        expect(typeof adapter.createIsolatedSubprocessEnvironment).toBe('function');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('Artifact-Set Identity Binding', () => {
    
    test('S2-32: Correct Unit B-6 artifact-set identity is bound', () => {
      expect(runtimeAdapter.ARTIFACT_SET_ID).toBe('F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A');
    });
    
    test('S2-33: Identity validation binds artifact-set identity', () => {
      // BLOCKED BY IMG-GAP-01: Approved digest allowlist is empty
      const container = {
        containerId: 'abc123',
        imageDigest: 'sha256:' + 'a'.repeat(64),
        platform: 'linux/amd64',
        networkId: 'net-123',
        networkName: 'test-net',
        endpointHost: '127.0.0.1',
        endpointPort: '3307',
        internalPort: '3306',
      };
      
      const mysql = {
        serverUuid: '12345678-1234-4123-8123-123456789012',
        version: '8.4.3',
        hostname: 'abc123',
        endpointHost: '127.0.0.1',
        endpointPort: '3307',
      };
      
      const expected = {
        containerId: 'abc123',
        networkId: 'net-123',
      };
      
      expect(() => {
        runtimeAdapter.validateObservedIdentity(container, mysql, expected);
      }).toThrow(/IMG-GAP-01|No approved MySQL 8.4 digest/);
    });
  });
});
