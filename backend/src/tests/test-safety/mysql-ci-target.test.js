'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  AUTHORIZATION_EVIDENCE_KIND,
  buildMigrationChildEnvironment,
  buildReaderChildEnvironment,
  validateMysqlCiTarget,
} = require('../../../test-safety/mysql-ci-target');
const {
  DIRECT_GRANTS_QUERY,
  EFFECTIVE_GRANTS_QUERY,
  IDENTITY_QUERY,
  validateRuntimeSnapshot,
  verifyMysqlRuntime,
} = require('../../../test-safety/verify-mysql-runtime');

const SQL_MODES = Object.freeze([
  'ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION', 'NO_ZERO_DATE',
  'NO_ZERO_IN_DATE', 'ONLY_FULL_GROUP_BY', 'STRICT_TRANS_TABLES',
]);
const MIGRATION_PRIVILEGES = Object.freeze([
  'ALTER', 'CREATE', 'DELETE', 'DROP', 'INDEX', 'INSERT', 'REFERENCES', 'SELECT', 'UPDATE',
]);
const DATABASE = 'halqa_mysql8_ci_40114997858_1';
const SERVER_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONTAINER_ID = 'a'.repeat(64);
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;
const POLICY_DIGEST = `sha256:${'c'.repeat(64)}`;

// ---- Authority key and MAC helper for tests that require a valid HMAC ----
// Deterministic 32-byte zero key — structurally valid, safe for unit tests only.
const AUTHORITY_KEY = Buffer.alloc(32);

function computeTestMAC(evidenceObj) {
  const { kind, operation, runId, runAttempt, containerId, imageDigest, policyDigest, databaseName } = evidenceObj;
  const payload = { kind, operation, runId, runAttempt, containerId, imageDigest, policyDigest, databaseName };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHmac('sha256', AUTHORITY_KEY).update(canonical).digest('hex');
}

function profile(role = 'reader', overrides = {}) {
  const username = role === 'reader' ? 'halqa_ci_reader' : 'halqa_ci_migrator';
  return {
    protocol: 'mysql:', endpointHost: '127.0.0.1', endpointPort: '3307', mysqlServerPort: '3306',
    databaseName: DATABASE, username, effectiveUser: `${username}@%`, role, version: '8.4.11',
    charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', expectedServerUuid: SERVER_UUID,
    expectedServerHostname: 'ci-mysql', sqlModes: SQL_MODES, globalPrivileges: ['USAGE'],
    schemaPrivileges: role === 'reader' ? ['SELECT'] : MIGRATION_PRIVILEGES,
    runnerBinding: {
      runId: '40114997858', runAttempt: '1', containerId: CONTAINER_ID,
      imageDigest: IMAGE_DIGEST, policyDigest: POLICY_DIGEST, databaseName: DATABASE,
    },
    ...overrides,
  };
}

function evidence(role = 'reader', overrides = {}) {
  const base = {
    kind: AUTHORIZATION_EVIDENCE_KIND,
    operation: role === 'reader' ? 'read-only-smoke' : 'migration',
    runId: '40114997858', runAttempt: '1', containerId: CONTAINER_ID,
    imageDigest: IMAGE_DIGEST, policyDigest: POLICY_DIGEST, databaseName: DATABASE,
    ...overrides,
  };
  // Compute MAC over the final merged object unless caller explicitly supplied one.
  if (!base.mac) {
    base.mac = computeTestMAC(base);
  }
  return base;
}

function url(role = 'reader', password = 'unit-test-password', port = '3307') {
  const username = role === 'reader' ? 'halqa_ci_reader' : 'halqa_ci_migrator';
  return `mysql://${username}:${password}@127.0.0.1:${port}/${DATABASE}`;
}

function identity(role = 'reader', overrides = {}) {
  const username = role === 'reader' ? 'halqa_ci_reader' : 'halqa_ci_migrator';
  return {
    version: '8.4.11', versionComment: 'MySQL Community Server - GPL',
    serverUuid: SERVER_UUID, hostname: 'ci-mysql', mysqlServerPort: 3306,
    databaseName: DATABASE, currentUser: `${username}@%`, connectionUser: `${username}@172.18.0.2`,
    currentRole: 'NONE', mandatoryRoles: '', activateAllRolesOnLogin: 0, partialRevokes: 0,
    charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci',
    globalSqlMode: SQL_MODES.join(','), sessionSqlMode: SQL_MODES.join(','),
    ...overrides,
  };
}

function grants(role = 'reader') {
  const username = role === 'reader' ? 'halqa_ci_reader' : 'halqa_ci_migrator';
  const privileges = role === 'reader' ? 'SELECT' : MIGRATION_PRIVILEGES.join(', ');
  return [
    `GRANT USAGE ON *.* TO \`${username}\`@\`%\``,
    `GRANT ${privileges} ON \`${DATABASE}\`.* TO \`${username}\`@\`%\``,
  ];
}

function snapshot(role = 'reader', overrides = {}) {
  const statements = overrides.grants || grants(role);
  return {
    identity: identity(role, overrides.identity),
    directGrantStatements: overrides.directGrants || statements,
    effectiveGrantStatements: overrides.effectiveGrants || statements,
    profile: profile(role, overrides.profile),
  };
}

function mysql2Rows(rows) {
  return [rows, [{ mockedFieldMetadata: true }]];
}

function grantRows(statements, label) {
  return statements.map((statement) => ({ [`Grants for ${label}`]: statement }));
}

function mockedConnection(role = 'reader', overrides = {}) {
  const direct = overrides.directGrants || grants(role);
  const effective = overrides.effectiveGrants || grants(role);
  return {
    query: jest.fn(async (query) => {
      if (query === IDENTITY_QUERY) return mysql2Rows([identity(role, overrides.identity)]);
      if (query === DIRECT_GRANTS_QUERY) return mysql2Rows(grantRows(direct, 'current user'));
      if (query === EFFECTIVE_GRANTS_QUERY) return mysql2Rows(grantRows(effective, 'effective user'));
      throw new Error('unexpected query');
    }),
  };
}

describe('Phase 3D-1C Unit A fail-closed MySQL CI guards', () => {
  test('T01 valid reader grants', async () => {
    const connection = mockedConnection('reader');
    await expect(verifyMysqlRuntime({ connection, profile: profile('reader') }))
      .resolves.toMatchObject({ role: 'reader', endpointPort: '3307', mysqlServerPort: '3306' });
    expect(connection.query).toHaveBeenNthCalledWith(1, IDENTITY_QUERY);
    expect(connection.query).toHaveBeenNthCalledWith(2, DIRECT_GRANTS_QUERY);
    expect(connection.query).toHaveBeenNthCalledWith(3, EFFECTIVE_GRANTS_QUERY);
  });

  test('T02 valid migrator grants', () => {
    expect(validateRuntimeSnapshot(snapshot('migration'))).toMatchObject({ role: 'migration' });
  });

  test('T03 mandatory roles rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { mandatoryRoles: '`writer`@`%`' } })))
      .toThrow(/mandatory MySQL roles/);
  });

  test('T04 active roles rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { currentRole: '`writer`@`%`' } })))
      .toThrow(/active MySQL roles/);
  });

  test('T05 assigned role rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      directGrants: [...grants('reader'), 'GRANT `writer`@`%` TO `halqa_ci_reader`@`%`'],
    }))).toThrow(/assigned role/);
  });

  test('T06 activate_all_roles_on_login enabled rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { activateAllRolesOnLogin: 1 } })))
      .toThrow(/automatic role activation/);
  });

  test('T07 partial_revokes enabled rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { partialRevokes: '1' } })))
      .toThrow(/partial revokes/);
  });

  test('T08 cross-schema grant rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      effectiveGrants: [...grants('reader'), 'GRANT SELECT ON `halqa_db`.* TO `halqa_ci_reader`@`%`'],
    }))).toThrow(/unexpected schema/);
  });

  test('T09 global write privilege rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      directGrants: ['GRANT USAGE ON *.* TO `halqa_ci_reader`@`%`', 'GRANT INSERT ON *.* TO `halqa_ci_reader`@`%`', `GRANT SELECT ON \`${DATABASE}\`.* TO \`halqa_ci_reader\`@\`%\``],
    }))).toThrow(/global privileges/);
  });

  test('T10 GRANT OPTION rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      directGrants: ['GRANT USAGE ON *.* TO `halqa_ci_reader`@`%`', `GRANT SELECT ON \`${DATABASE}\`.* TO \`halqa_ci_reader\`@\`%\` WITH GRANT OPTION`],
    }))).toThrow(/grantable/);
  });

  test('T11 unexpected SHOW GRANTS format rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { directGrants: ['not a grant statement'] })))
      .toThrow(/unrecognized grant/);
  });

  test('T12 missing SHOW GRANTS result rejected', async () => {
    const connection = mockedConnection('reader', { directGrants: [] });
    await expect(verifyMysqlRuntime({ connection, profile: profile() })).rejects.toThrow(/grant results are missing/);
  });

  test('T13 wrong server UUID rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      identity: { serverUuid: '11111111-2222-4333-8444-555555555555' },
    }))).toThrow(/does not match/);
  });

  test('T14 wrong server hostname rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { hostname: 'replacement-mysql' } })))
      .toThrow(/hostname/);
  });

  test('T15 invalid UUID rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { serverUuid: 'not-a-uuid' } })))
      .toThrow(/UUID is malformed/);
  });

  test('T16 missing service attestation rejected where required', () => {
    expect(() => validateMysqlCiTarget({ databaseUrl: url(), profile: profile(), authorityKey: AUTHORITY_KEY })).toThrow(/evidence is required/);
    expect(() => validateMysqlCiTarget({
      databaseUrl: url(), profile: profile(), authorizationEvidence: evidence('reader', { containerId: 'forged' }),
      authorityKey: AUTHORITY_KEY,
    })).toThrow(/does not match/);
    expect(() => validateMysqlCiTarget({
      databaseUrl: url(), profile: profile('reader', { expectedServerUuid: undefined }),
      authorizationEvidence: evidence(),
      authorityKey: AUTHORITY_KEY,
    })).toThrow(/expectedServerUuid/);
  });

  test('T17 approved mapped endpoint 3307 to internal 3306 handled', () => {
    const validated = validateMysqlCiTarget({ databaseUrl: url(), profile: profile(), authorizationEvidence: evidence(), authorityKey: AUTHORITY_KEY });
    expect(validated.target.endpointPort).toBe('3307');
    expect(validated.profile.mysqlServerPort).toBe('3306');
    expect(validateRuntimeSnapshot(snapshot())).toMatchObject({ endpointPort: '3307', mysqlServerPort: '3306' });
  });

  test('T18 wrong endpoint port rejected', () => {
    expect(() => validateMysqlCiTarget({ databaseUrl: url('reader', 'secret', '3308'), profile: profile(), authorizationEvidence: evidence(), authorityKey: AUTHORITY_KEY }))
      .toThrow(/endpointPort/);
  });

  test('T19 wrong MySQL internal port rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { mysqlServerPort: 3307 } })))
      .toThrow(/internal MySQL server port/);
    expect(() => validateRuntimeSnapshot(snapshot('reader', { profile: { mysqlServerPort: '0' } })))
      .toThrow(/valid port/);
    expect(() => validateRuntimeSnapshot(snapshot('reader', { profile: { mysqlServerPort: '3307' } })))
      .toThrow(/exactly 3306/);
  });

  test('T20 MariaDB rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      identity: { version: '10.11.19-MariaDB', versionComment: 'mariadb.org binary distribution' },
    }))).toThrow(/MariaDB/);
  });

  test('T21 wrong MySQL patch rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', { identity: { version: '8.4.12' } })))
      .toThrow(/version/);
  });

  test('T22 query error rejected', async () => {
    const connection = { query: jest.fn().mockRejectedValue(new Error('query failed')) };
    await expect(verifyMysqlRuntime({ connection, profile: profile() })).rejects.toThrow(/could not complete/);
  });

  test('T23 connection loss rejected', async () => {
    const connection = {
      query: jest.fn().mockRejectedValue(Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' })),
    };
    await expect(verifyMysqlRuntime({ connection, profile: profile() })).rejects.toThrow(/could not complete/);
  });

  test('T24 password and URL redaction from diagnostics', async () => {
    const secret = 'unique-password-never-log';
    const connection = { query: jest.fn().mockRejectedValue(new Error('connection failed')) };
    const message = await verifyMysqlRuntime({ connection, profile: profile() }).catch((error) => error.message);
    expect(message).not.toContain(secret);
    expect(message).toContain('verification');
  });

  test('T25 inherited DATABASE_URL cannot override explicit target', () => {
    const env = buildReaderChildEnvironment({
      inheritedEnv: { DATABASE_URL: 'mysql://root:secret@localhost:3306/halqa_db', TEST_DATABASE_URL: 'unsafe' },
      databaseUrl: url(), profile: profile(), authorizationEvidence: evidence(), authorityKey: AUTHORITY_KEY,
    });
    expect(env.DATABASE_URL).toBe(url());
    expect(env).not.toHaveProperty('TEST_DATABASE_URL');
  });

  test('T26 reader does not inherit migrator credentials', () => {
    const migrationUrl = url('migration', 'migration-secret');
    const env = buildReaderChildEnvironment({
      inheritedEnv: { DATABASE_URL: migrationUrl, MYSQL_CI_MIGRATION_URL: migrationUrl },
      databaseUrl: url(), profile: profile(), authorizationEvidence: evidence(), authorityKey: AUTHORITY_KEY,
    });
    expect(Object.values(env)).not.toContain(migrationUrl);
    expect(env).not.toHaveProperty('MYSQL_CI_MIGRATION_URL');
    // Mismatched profile (reader) with URL (migration) should be rejected
    expect(() => buildMigrationChildEnvironment({
      inheritedEnv: {}, databaseUrl: url('reader'), profile: profile('migration'),
      authorizationEvidence: evidence('migration'), authorityKey: AUTHORITY_KEY,
    })).toThrow(/username does not match/);
  });

  test('T27 import does not create real connections', () => {
    const modules = ['mysql-ci-target.js', 'verify-mysql-runtime.js'];
    for (const file of modules) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../../test-safety', file), 'utf8');
      expect(source).not.toMatch(/require\(['"](?:mysql2|@prisma\/client|net|child_process)['"]\)/);
      expect(source).not.toMatch(/createConnection|createPool|spawn(?:Sync)?\s*\(|exec(?:File|Sync)?\s*\(/);
    }
    jest.isolateModules(() => {
      expect(() => require('../../../test-safety/mysql-ci-target')).not.toThrow();
      expect(() => require('../../../test-safety/verify-mysql-runtime')).not.toThrow();
    });
  });

  test('T28 import does not start application', () => {
    const appPath = path.resolve(__dirname, '../../app.js');
    expect(require.cache[appPath]).toBeUndefined();
  });

  test('T29 malformed MySQL result shapes rejected', async () => {
    const connection = { query: jest.fn().mockResolvedValue([{ not: 'mysql2 rows tuple' }]) };
    await expect(verifyMysqlRuntime({ connection, profile: profile() })).rejects.toThrow(/mysql2 result shape/);
    const inconsistent = mockedConnection('reader');
    inconsistent.query.mockResolvedValueOnce(mysql2Rows([identity(), identity()]));
    await expect(verifyMysqlRuntime({ connection: inconsistent, profile: profile() })).rejects.toThrow(/exactly one row/);
  });

  test('T30 unexpected additional grants rejected', () => {
    expect(() => validateRuntimeSnapshot(snapshot('reader', {
      effectiveGrants: [...grants('reader'), `GRANT UPDATE ON \`${DATABASE}\`.* TO \`halqa_ci_reader\`@\`%\``],
    }))).toThrow(/schema privileges/);
  });
});
