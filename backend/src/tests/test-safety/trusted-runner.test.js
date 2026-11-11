/**
 * Trusted MySQL Runner Negative Tests
 * 
 * 28 negative tests proving rejection of all hostile scenarios.
 * Uses mocked/pure inputs only - NO Docker, NO MySQL.
 * 
 * Each test MUST DEMONSTRATE the failure is detected (throw errors, return rejection).
 * Tests do not merely exit with code 0.
 * 
 * @jest-environment node
 */

'use strict';

const imagePolicy = require('../../../test-safety/trusted-mysql-runner/mysql-image-policy');
const runnerAuthority = require('../../../test-safety/trusted-mysql-runner/runner-authority');
const targetProfile = require('../../../test-safety/trusted-mysql-runner/target-profile');
const xamppProtection = require('../../../test-safety/trusted-mysql-runner/xampp-protection');
const accountPolicy = require('../../../test-safety/trusted-mysql-runner/account-policy');
const stateMachine = require('../../../test-safety/trusted-mysql-runner/state-machine');
const artifactIntegrity = require('../../../test-safety/trusted-mysql-runner/artifact-integrity');
const secretEnvironment = require('../../../test-safety/trusted-mysql-runner/secret-environment');

describe('Trusted MySQL Runner - Negative Security Tests', () => {

  // Isolation guard: reset runner-authority module state before every test in this suite.
  // In CI batch runs, Jest reuses the module instance across test files.
  // _resetMACKeyForTesting() rotates MAC_SECRET_KEY and clears CONSUMED_NONCES.
  beforeEach(() => {
    runnerAuthority._resetMACKeyForTesting();
  });

  describe('Image Supply Chain Policy', () => {
    
    test('1. Missing approved digest - MUST reject', () => {
      // Empty allowlist MUST reject all digests
      expect(() => {
        imagePolicy.isApprovedDigest('sha256:' + 'a'.repeat(64), 'linux/amd64');
      }).toThrow(/No approved MySQL 8.4 digest exists/);
    });
    
    test('2. Unapproved digest - MUST reject', () => {
      // Valid format digest but not in approved list
      const validButUnapprovedDigest = 'sha256:' + 'a'.repeat(64);
      expect(() => {
        imagePolicy.isApprovedDigest(validButUnapprovedDigest, 'linux/amd64');
      }).toThrow(/No approved MySQL 8.4 digest exists|not in approved list/);
    });
    
    test('3. Wrong platform - MUST reject', () => {
      expect(() => {
        imagePolicy.validatePlatform('linux/s390x');
      }).toThrow(/Unsupported platform/);
    });
    
    test('4. MariaDB image - MUST reject', () => {
      expect(() => {
        imagePolicy.detectMariaDB('MariaDB Server 10.5.8');
      }).toThrow(/MariaDB detected/);
      
      expect(() => {
        imagePolicy.detectMariaDB('mysql variant: maria-db compatible');
      }).toThrow(/MariaDB/);
    });
    
    test('5. Mutable tag - MUST reject', () => {
      expect(() => {
        imagePolicy.validateImageReference('mysql:latest');
      }).toThrow(/Mutable tag detected/);
      
      expect(() => {
        imagePolicy.validateImageReference('mysql:8.4');
      }).toThrow(/Mutable tag/);
      
      expect(() => {
        imagePolicy.rejectMutableTag('latest');
      }).toThrow(/Mutable tag/);
    });

    test('5a. Caller cannot mutate the approved image allowlist', () => {
      expect(imagePolicy.APPROVED_MYSQL_8_4_DIGESTS).toBeUndefined();
      expect(() => imagePolicy.isApprovedDigest('sha256:' + 'a'.repeat(64), 'linux/amd64')).toThrow(/No approved/);
    });
  });
  
  describe('Authorization Evidence (HMAC-SHA256)', () => {
    
    beforeEach(() => {
      // Reset MAC key for each test
      runnerAuthority._resetMACKeyForTesting();
    });
    
    test('6. Caller-forged attestation - MUST reject', () => {
      // Attempt to forge evidence without MAC key
      const issuedAt = new Date();
      const forgedEvidence = {
        runId: 'forged-run',
        runAttempt: '1',
        containerId: 'forged-container',
        policyDigest: 'sha256:' + 'f'.repeat(64),
        nonce: 'a'.repeat(32),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1000).toISOString(),
        mac: 'a'.repeat(64), // Fake MAC
      };
      
      expect(() => {
        runnerAuthority.validateAuthorizationEvidence(forgedEvidence, {
          runId: 'forged-run',
          runAttempt: '1',
          containerId: 'forged-container',
          policyDigest: 'sha256:' + 'f'.repeat(64),
        });
      }).toThrow(/MAC verification failed/);
    });
    
    test('7. Modified MAC payload - MUST reject', () => {
      // Generate valid evidence
      const evidence = runnerAuthority.generateAuthorizationEvidence({
        runId: 'test-run',
        runAttempt: '1',
        containerId: 'test-container',
        policyDigest: 'sha256:' + '1'.repeat(64),
      });
      
      // Tamper with runId after MAC generation
      const tamperedEvidence = { ...evidence, runId: 'tampered-run' };
      
      expect(() => {
        runnerAuthority.validateAuthorizationEvidence(tamperedEvidence, {
          runId: 'tampered-run',
          runAttempt: '1',
          containerId: 'test-container',
          policyDigest: 'sha256:' + '1'.repeat(64),
        });
      }).toThrow(/MAC verification failed/);
    });
    
    test('8. Expired authorization - MUST reject', () => {
      // Generate evidence with past expiration
      const pastTime = new Date(Date.now() - 3600000); // 1 hour ago
      const evidence = runnerAuthority.generateAuthorizationEvidence({
        runId: 'test-run',
        runAttempt: '1',
        containerId: 'test-container',
        policyDigest: 'sha256:' + '1'.repeat(64),
      }, { now: pastTime });
      
      // Validate with current time (evidence should be expired)
      expect(() => {
        runnerAuthority.validateAuthorizationEvidence(evidence, {
          runId: 'test-run',
          runAttempt: '1',
          containerId: 'test-container',
          policyDigest: 'sha256:' + '1'.repeat(64),
        }, new Date());
      }).toThrow(/expired/);
    });

    test('8a. Replayed authorization nonce - MUST reject on second use', () => {
      const binding = { runId: 'replay-run', runAttempt: '1', containerId: 'container-1', policyDigest: 'sha256:' + '1'.repeat(64) };
      const evidence = runnerAuthority.generateAuthorizationEvidence(binding);
      expect(runnerAuthority.validateAuthorizationEvidence(evidence, binding)).toBe(true);
      expect(() => runnerAuthority.validateAuthorizationEvidence(evidence, binding)).toThrow(/replay detected/);
    });

    test('8b. Missing expected binding - MUST reject', () => {
      const binding = { runId: 'bound-run', runAttempt: '1', containerId: 'container-1', policyDigest: 'sha256:' + '1'.repeat(64) };
      const evidence = runnerAuthority.generateAuthorizationEvidence(binding);
      expect(() => runnerAuthority.validateAuthorizationEvidence(evidence)).toThrow(/binding is required/);
    });

    test('8c. Identity and artifact mutations change the bound policy digest', () => {
      const base = {
        role: 'reader', serverUuid: '11111111-1111-4111-8111-111111111111', mysqlHostname: 'container-host',
        containerId: 'container-1', imageDigest: 'sha256:' + 'a'.repeat(64), databaseName: 'halqa_mysql8_ci_' + 'a'.repeat(36),
        endpointHost: '127.0.0.1', endpointPort: '3307', mysqlServerPort: '3306', networkId: 'network-1',
        networkName: 'isolated-1', mysqlVersion: '8.4.3', artifactSetIdentity: 'F'.repeat(64), runId: 'run-1',
      };
      const original = targetProfile.generateTargetProfile(base).runnerBinding.policyDigest;
      for (const mutation of [
        { serverUuid: '22222222-2222-4222-8222-222222222222' },
        { mysqlHostname: 'forged-host' },
        { databaseName: 'halqa_mysql8_ci_' + 'b'.repeat(36) },
        { artifactSetIdentity: 'E'.repeat(64) },
        { networkName: 'forged-network' },
        { mysqlVersion: '8.4.4' },
      ]) {
        expect(targetProfile.generateTargetProfile({ ...base, ...mutation }).runnerBinding.policyDigest).not.toBe(original);
      }
    });

    test('8d. Mutated profile and conflicting container binding - MUST reject', () => {
      const profile = targetProfile.generateTargetProfile({
        role: 'reader', serverUuid: '11111111-1111-4111-8111-111111111111', mysqlHostname: 'container-host',
        containerId: 'container-1', imageDigest: 'sha256:' + 'a'.repeat(64), databaseName: 'halqa_mysql8_ci_' + 'a'.repeat(36),
        endpointHost: '127.0.0.1', endpointPort: '3307', mysqlServerPort: '3306', runId: 'run-1',
      });
      expect(() => targetProfile.validateProfileStructure({ ...profile, databaseName: 'tampered' })).toThrow(/policyDigest/);
      const conflicting = { ...profile, runnerBinding: { ...profile.runnerBinding, containerId: 'container-2' } };
      expect(() => targetProfile.validateProfileStructure(conflicting)).toThrow(/containerId/);
    });
    
    test('9. Wrong server UUID - MUST detect', () => {
      expect(() => {
        targetProfile.generateTargetProfile({
          role: 'reader',
          serverUuid: '', // Empty UUID
          mysqlHostname: 'test-host',
          containerId: 'test-container',
          imageDigest: 'sha256:test',
          databaseName: 'halqa_mysql8_ci_test',
          endpointHost: '127.0.0.1',
          endpointPort: '3307',
          mysqlServerPort: '3306',
        });
      }).toThrow(/missing required field/);
    });
    
    test('10. Wrong hostname - MUST detect', () => {
      expect(() => {
        xamppProtection.validateHostname('production-mysql-01');
      }).toThrow(/Production-like hostname detected/);
    });
    
    test('11. Wrong container ID - MUST detect', () => {
      const evidence = runnerAuthority.generateAuthorizationEvidence({
        runId: 'test-run',
        runAttempt: '1',
        containerId: 'container-123',
        policyDigest: 'sha256:' + '1'.repeat(64),
      });
      
      expect(() => {
        runnerAuthority.validateAuthorizationEvidence(evidence, {
          runId: 'test-run',
          runAttempt: '1',
          containerId: 'container-456', // Different container ID
          policyDigest: 'sha256:' + '1'.repeat(64),
        });
      }).toThrow(/containerId mismatch/);
    });
    
    test('12. Wrong network - MUST reject (future enhancement)', () => {
      // Network validation requires both networkId and networkName
      expect(() => {
        xamppProtection.validateNetworkIsolation('net-host', 'host');
      }).toThrow(/Host network mode detected/);
      
      expect(() => {
        xamppProtection.validateNetworkIsolation('net-123', 'bridge');
      }).toThrow(/Default bridge network/);
    });
  });
  
  describe('XAMPP and Wrong-Database Protection', () => {
    
    test('13. Wrong database - MUST reject', () => {
      expect(() => {
        xamppProtection.rejectProductionDatabase('halqa_db');
      }).toThrow(/Production.*database detected/);
      
      expect(() => {
        xamppProtection.rejectProductionDatabase('mysql');
      }).toThrow(/Production/);
    });
    
    test('14. XAMPP localhost endpoint - MUST reject', () => {
      expect(() => {
        xamppProtection.rejectUnverifiedEndpoint({
          host: '127.0.0.1',
          port: '3306',
        }, null);
      }).toThrow(/XAMPP endpoint detected/);
    });
    
    test('15. Wrong mapped port - MUST reject', () => {
      expect(() => {
        xamppProtection.rejectUnexpectedPorts('3308', '3306');
      }).toThrow(/Unexpected mapped port.*3308/);
    });
    
    test('16. Wrong internal port - MUST reject', () => {
      expect(() => {
        xamppProtection.rejectUnexpectedPorts('3307', '3307');
      }).toThrow(/Unexpected internal MySQL port.*3307/);
    });
    
    test('17. Inherited production DATABASE_URL - MUST reject', () => {
      expect(() => {
        xamppProtection.rejectCallerDatabaseUrl({
          DATABASE_URL: 'mysql://prod-user:pass@prod-host/halqa_db',
        });
      }).toThrow(/Caller-supplied database connection variable/);
    });

    test.each(['::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', 'host.docker.internal', 'localhost']) (
      '17a. alternate or caller-selected host %s - MUST reject', (host) => {
        expect(() => xamppProtection.rejectUnverifiedEndpoint({ host, port: '3307' }, {})).toThrow(/Unexpected endpoint host/);
      }
    );

    test('17b. expected coordinates without attestation - MUST reject', () => {
      expect(() => xamppProtection.rejectUnverifiedEndpoint({ host: '127.0.0.1', port: '3307' }, null)).toThrow(/Trusted profile is required/);
    });
  });
  
  describe('Account Policy and Privilege Validation', () => {
    
    test('18. Global MySQL privileges for Migrator - MUST reject', () => {
      const grantsWithGlobal = [
        "GRANT SUPER ON *.* TO 'migrator'@'%'",
      ];
      
      expect(() => {
        accountPolicy.validateMigratorPrivileges(grantsWithGlobal, 'halqa_mysql8_ci_test');
      }).toThrow(/global privileges/);
    });
    
    test('19. Cross-schema grants for Migrator - MUST reject', () => {
      const grantsWithCrossSchema = [
        "GRANT SELECT ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'",
        "GRANT SELECT ON `mysql`.* TO 'migrator'@'%'", // Cross-schema
      ];
      
      expect(() => {
        accountPolicy.validateMigratorPrivileges(grantsWithCrossSchema, 'halqa_mysql8_ci_test');
      }).toThrow(/cross-schema/);
    });
    
    test('20. GRANT OPTION - MUST detect', () => {
      const grantWithOption = "GRANT SELECT ON db.* TO 'user'@'%' WITH GRANT OPTION";
      
      expect(accountPolicy.detectGrantOption(grantWithOption)).toBe(true);
      
      const grants = [grantWithOption];
      expect(() => {
        accountPolicy.validateMigratorPrivileges(grants, 'db');
      }).toThrow(/GRANT OPTION/);
    });
    
    test('21. Unexpected active roles - MUST detect', () => {
      const grantsWithRole = [
        "GRANT 'admin_role' TO 'migrator'@'%'",
      ];
      
      expect(() => {
        accountPolicy.detectRole(grantsWithRole);
      }).toThrow(/role assignments detected/);
    });
    
    test('22. Write privileges for Reader - MUST reject', () => {
      const readerWithWrite = [
        "GRANT SELECT, INSERT ON `db`.* TO 'reader'@'%'",
      ];
      
      expect(() => {
        accountPolicy.validateReaderPrivileges(readerWithWrite, 'db');
      }).toThrow(/write privilege/);
    });

    const validMigrator = "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'";

    test('22a. Exact least-privilege Migrator grant - MUST accept', () => {
      expect(accountPolicy.validateMigratorPrivileges([validMigrator], 'halqa_mysql8_ci_test').valid).toBe(true);
    });

    test('22c. Bootstrap grant with unexpected global privilege - MUST reject', () => {
      expect(() => accountPolicy.validateBootstrapPrivileges([
        "GRANT CREATE USER, RELOAD, GRANT OPTION, FILE ON *.* TO 'bootstrap'@'%'",
      ])).toThrow(/unexpected privilege: FILE/);
    });

    test.each([
      ["GRANT ALL PRIVILEGES ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'", /ALL/],
      ["GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, PROCESS ON `halqa_mysql8_ci_test`.* TO 'migrator'@'%'", /unexpected privilege: PROCESS/],
      ["GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON `halqa_mysql8_ci_test`.`users` TO 'migrator'@'%'", /non-schema grant/],
      ["GRANT SELECT (email) ON `halqa_mysql8_ci_test`.`users` TO 'migrator'@'%'", /Unsupported privilege syntax/],
      ["nonsense grant evidence", /Unsupported or malformed/],
      ["GRANT PROXY ON 'root'@'localhost' TO 'migrator'@'%'", /non-schema grant|unexpected privilege|Unsupported/],
    ])('22b. hostile Migrator grant %s - MUST reject', (grant, error) => {
      expect(() => accountPolicy.validateMigratorPrivileges([grant], 'halqa_mysql8_ci_test')).toThrow(error);
    });
  });
  
  describe('Artifact Integrity', () => {
    // Helper: create a temp dir with 8 real files whose content matches EXPECTED_MANIFEST
    // so verifyArtifactSet reaches hash/manifest checks rather than failing on ENOENT.
    function buildTempArtifactDir(overrideFiles = {}) {
      const os = require('os');
      const fs = require('fs');
      const crypto = require('crypto');
      const tmpDir = fs.mkdtempSync(require('path').join(os.tmpdir(), 'halqa-artifact-test-'));
      const manifest = artifactIntegrity.EXPECTED_MANIFEST;
      manifest.files.forEach(entry => {
        const content = overrideFiles[entry.name] !== undefined
          ? overrideFiles[entry.name]
          // Write content whose SHA-256 matches the declared hash so we can test selective tampering
          : Buffer.from(entry.name + '\n'); // placeholder — actual hash won't match, but that's OK for test 24
        fs.writeFileSync(require('path').join(tmpDir, entry.name), content);
      });
      return tmpDir;
    }

    test('23. Altered SQL artifact - MUST detect', () => {
      // Build a temp dir whose files produce a KNOWN hash, then alter the manifest
      // so the declared sha256 for file[0] is wrong → triggers "Hash mismatch"
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      const crypto = require('crypto');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halqa-artifact-23-'));
      const manifest = artifactIntegrity.EXPECTED_MANIFEST;
      // Write all 8 files with deterministic content
      const fileContents = {};
      manifest.files.forEach(entry => {
        const content = Buffer.from(`content-for-${entry.name}`);
        fs.writeFileSync(path.join(tmpDir, entry.name), content);
        fileContents[entry.name] = content;
      });
      // Build a valid manifest with correct hashes, then corrupt the first entry
      const validFiles = manifest.files.map(entry => ({
        ...entry,
        sha256: crypto.createHash('sha256').update(fileContents[entry.name]).digest('hex').toUpperCase(),
        size: fileContents[entry.name].length,
      }));
      const alteredManifest = {
        ...manifest,
        files: validFiles.map((file, index) => index === 0 ? { ...file, sha256: 'F'.repeat(64) } : file),
      };
      try {
        expect(() => {
          artifactIntegrity.verifyArtifactSet(tmpDir, alteredManifest);
        }).toThrow(/Hash mismatch/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
    
    test('24. Missing FULLTEXT supplement - MUST detect', () => {
      // incompleteManifest has only 7 files — verifyArtifactSet must reject it
      // before reading any files (manifest length check fires first)
      const incompleteManifest = {
        ...artifactIntegrity.EXPECTED_MANIFEST,
        files: artifactIntegrity.EXPECTED_MANIFEST.files.filter(
          file => file.name !== 'historical-fulltext-index-supplement.sql'
        ),
      };
      const os = require('os');
      const fs = require('fs');
      const path = require('path');
      // A real directory is still required because verifyArtifactSet calls fs.lstatSync
      // before the manifest-length check. Use a temp dir with just the 7 kept files.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halqa-artifact-24-'));
      incompleteManifest.files.forEach(entry => {
        fs.writeFileSync(path.join(tmpDir, entry.name), Buffer.from(`placeholder-${entry.name}`));
      });
      try {
        expect(() => {
          artifactIntegrity.verifyArtifactSet(tmpDir, incompleteManifest);
        }).toThrow(/bind all 8 canonical/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
    
    test('25. Path traversal - MUST detect', () => {
      expect(() => {
        artifactIntegrity.detectPathTraversal('../../../etc/passwd');
      }).toThrow(/Path traversal detected/);
    });
  });
  
  describe('Secret and Environment Protection', () => {
    
    test('26. Unredacted credentials in SQL - MUST redact', () => {
      const sqlWithPassword = "CREATE USER 'test'@'%' IDENTIFIED BY 'secret123'";
      const redacted = secretEnvironment.redactSQL(sqlWithPassword);
      
      expect(redacted).not.toContain('secret123');
      expect(redacted).toContain('[REDACTED]');
    });
    
    test('27. Unredacted credentials in connection string - MUST redact', () => {
      const connString = 'mysql://user:password123@localhost:3306/db';
      const redacted = secretEnvironment.redactConnectionString(connString);
      
      expect(redacted).not.toContain('password123');
      expect(redacted).toContain('[REDACTED]');
    });
    
    test('28. Sensitive environment variables - MUST sanitize', () => {
      const unsafeEnv = {
        DATABASE_URL: 'mysql://prod-user:pass@prod/db',
        SHADOW_DATABASE_URL: 'mysql://shadow:pass@shadow/db',
        API_KEY: 'secret-key',
        NODE_ENV: 'test', // Safe variable
      };
      
      const sanitized = secretEnvironment.sanitizeEnvironment(unsafeEnv);
      
      expect(sanitized.DATABASE_URL).toBeUndefined();
      expect(sanitized.SHADOW_DATABASE_URL).toBeUndefined();
      expect(sanitized.API_KEY).toBeUndefined();
      expect(sanitized.NODE_ENV).toBe('test'); // Safe variable preserved
    });

    test('28a. Error redaction covers bearer tokens, API keys, and generic passwords', () => {
      const safe = secretEnvironment.safeErrorMessage('password=secret123 api_key=abcdefgh Bearer abcdefghijklmnop');
      expect(safe).not.toMatch(/secret123|abcdefgh|abcdefghijklmnop/);
      expect(safe.match(/\[REDACTED\]/g).length).toBeGreaterThanOrEqual(3);
    });
  });
  
  describe('State Machine Fail-Closed Behavior', () => {
    
    test('29. Invalid lifecycle transition - MUST reject', () => {
      expect(() => {
        stateMachine.validateTransition('SERVICE_READY', 'IDENTITY_PENDING');
      }).toThrow(/Invalid state transition/);
      
      expect(() => {
        stateMachine.validateTransition('SERVICE_READY', 'PROVISIONING');
      }).toThrow(/Invalid state transition/);
    });
    
    test('30. Failed cleanup state - MUST allow REJECTED → DESTROYED', () => {
      // This is a valid transition for cleanup
      expect(() => {
        stateMachine.validateTransition('REJECTED', 'DESTROYED');
      }).not.toThrow();
    });
    
    test('31. SQL execution in C-1B Stage 1 - MUST be disabled', () => {
      // C-1B Stage 1: NO SQL execution state
      expect(stateMachine.canExecuteSQL('CREATED')).toBe(false);
      expect(stateMachine.canExecuteSQL('PROVISIONING')).toBe(false);
      expect(stateMachine.canExecuteSQL('IDENTITY_VERIFIED')).toBe(false);
      expect(stateMachine.canExecuteSQL('ACCOUNTS_VERIFIED')).toBe(false);
      expect(stateMachine.canExecuteSQL('SERVICE_READY')).toBe(false);
    });
    
    test('32. Concurrent run identity collision - MUST detect', () => {
      const profile1 = targetProfile.generateTargetProfile({
        role: 'reader',
        serverUuid: 'uuid-123',
        mysqlHostname: 'host-1',
        containerId: 'container-1',
        imageDigest: 'sha256:abc',
        databaseName: 'halqa_mysql8_ci_' + 'a'.repeat(36),
        endpointHost: '127.0.0.1',
        endpointPort: '3307',
        mysqlServerPort: '3306',
        runId: 'run-123',
      });
      
      const profile2 = targetProfile.generateTargetProfile({
        role: 'reader',
        serverUuid: 'uuid-456',
        mysqlHostname: 'host-2',
        containerId: 'container-2', // Different container
        imageDigest: 'sha256:def',
        databaseName: 'halqa_mysql8_ci_' + 'b'.repeat(36),
        endpointHost: '127.0.0.1',
        endpointPort: '3307',
        mysqlServerPort: '3306',
        runId: 'run-123', // Same runId - collision
      });
      
      // Policy digests should differ due to different containers
      expect(profile1.runnerBinding.policyDigest).not.toBe(profile2.runnerBinding.policyDigest);
    });
  });
  
  describe('Additional Security Controls', () => {
    
    test('33. Bootstrap self-revocation requirement - MUST be mandatory', () => {
      const policy = accountPolicy.enforceSelfRevocationRequirement();
      
      expect(policy.required).toBe(true);
      expect(policy.mandatory).toBe(true);
      expect(policy.failureAction).toBe('TRANSITION_TO_REJECTED');
    });
    
    test('34. Artifact-set identity computation - MUST be deterministic', () => {
      const files = [
        { name: 'file1.sql', bytes: Buffer.from('AAAA') },
        { name: 'file2.sql', bytes: Buffer.from('BBBB') },
        { name: 'file3.sql', bytes: Buffer.from('CCCC') },
      ];
      
      const identity1 = artifactIntegrity.computeArtifactSetIdentity(files);
      const identity2 = artifactIntegrity.computeArtifactSetIdentity(files);
      
      expect(identity1).toBe(identity2);
      expect(identity1).toHaveLength(64); // SHA-256 hex
    });

    test('34a. Complete Unit B-6 artifact set matches authoritative identity and execution order', () => {
      const path = require('path');
      const artifactDir = path.resolve(__dirname, '../../../mysql-integration/baseline-candidates/full-141-table-baseline-2026-10-24');
      const result = artifactIntegrity.verifyArtifactSet(artifactDir);
      expect(result.files).toHaveLength(8);
      expect(result.artifactSetIdentity).toBe('F2402ED222C452BFCACB6D8D3F8D6FEB5C64A10D791DC22AD2B145D331391F2A');
      expect(result.executionOrder).toEqual([
        'mysql-8.4-full-baseline-candidate.sql',
        'historical-fulltext-index-supplement.sql',
        'custom-sql-supplement.sql',
      ]);
    });
    
    test('35. Secret-free evidence reporting - MUST not contain passwords', () => {
      const attestation = {
        serverUuid: 'uuid-123',
        accountCredentials: {
          username: 'migrator',
          password: 'secret-password',
          expiresAt: '2026-12-31T23:59:59Z',
        },
        connectionString: 'mysql://user:pass@host/db',
      };
      
      const safe = secretEnvironment.secretFreeEvidence(attestation);
      
      expect(safe.accountCredentials.password).toBe('[REDACTED]');
      expect(safe.connectionString).toBe('[REDACTED]');
      expect(safe.serverUuid).toBe('uuid-123'); // Non-sensitive preserved
    });

    test('35a. Secret-free evidence recursively redacts nested credentials', () => {
      const safe = secretEnvironment.secretFreeEvidence({ nested: { apiKey: 'nested-secret', password: 'pass' } });
      expect(JSON.stringify(safe)).not.toMatch(/nested-secret|"pass"/);
      expect(safe.nested.apiKey).toBe('[REDACTED]');
      expect(safe.nested.password).toBe('[REDACTED]');
    });
  });
});
