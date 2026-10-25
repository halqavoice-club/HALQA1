'use strict';

const { validateTrustedMysqlProfile } = require('./mysql-ci-target');

const IDENTITY_QUERY = `SELECT
  VERSION() AS version,
  @@version_comment AS versionComment,
  @@server_uuid AS serverUuid,
  @@hostname AS hostname,
  @@port AS mysqlServerPort,
  DATABASE() AS databaseName,
  CURRENT_USER() AS currentUser,
  USER() AS connectionUser,
  CURRENT_ROLE() AS currentRole,
  @@GLOBAL.mandatory_roles AS mandatoryRoles,
  @@GLOBAL.activate_all_roles_on_login AS activateAllRolesOnLogin,
  @@GLOBAL.partial_revokes AS partialRevokes,
  @@character_set_server AS charset,
  @@collation_server AS collation,
  @@GLOBAL.sql_mode AS globalSqlMode,
  @@SESSION.sql_mode AS sessionSqlMode`;
const DIRECT_GRANTS_QUERY = 'SHOW GRANTS FOR CURRENT_USER()';
const EFFECTIVE_GRANTS_QUERY = 'SHOW GRANTS';
const FORBIDDEN_RUNTIME_USERS = new Set(['root', 'halqa_user', 'halqa', 'admin']);
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function runtimeError(message) {
  const error = new Error(`MySQL CI runtime verification failed: ${message}`);
  error.code = 'MYSQL_CI_RUNTIME_VERIFICATION_FAILED';
  return error;
}

function rowsFromResult(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw runtimeError('query returned an invalid mysql2 result shape');
  }
  return result[0];
}

function parseSqlModes(value, label) {
  if (typeof value !== 'string' || !value) throw runtimeError(`${label} is missing`);
  const modes = value.split(',').filter(Boolean).map((mode) => mode.trim().toUpperCase()).sort();
  if (!modes.length || new Set(modes).size !== modes.length) throw runtimeError(`${label} is invalid`);
  return modes;
}

function requireDisabled(value, label) {
  if (!(value === 0 || value === '0' || value === false)) throw runtimeError(`${label} must be disabled`);
}

function expectedGrantAccount(trusted) {
  const [username, host] = trusted.effectiveUser.split('@');
  return `\`${username}\`@\`${host}\``;
}

function parseGrant(statement, trusted) {
  if (typeof statement !== 'string' || !statement || /WITH\s+GRANT\s+OPTION/i.test(statement)) {
    throw runtimeError('an invalid or grantable privilege was returned');
  }
  
  // Check for assigned role pattern: GRANT `role`@`host` TO `user`@`host`
  const roleMatch = statement.match(/^GRANT\s+`[^`]+`@`[^`]+`\s+TO\s+`[^`]+`@`[^`]+`/i);
  if (roleMatch) {
    throw runtimeError('an assigned role was returned');
  }
  
  const match = statement.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(`[^`]+`@`[^`]+`)(?:\s+.*)?$/i);
  if (!match) throw runtimeError('an unrecognized grant format was returned');
  if (match[3] !== expectedGrantAccount(trusted)) throw runtimeError('grant account is unexpected');
  const privileges = match[1].split(',').map((item) => item.trim().toUpperCase()).sort();
  if (!privileges.length || privileges.some((item) => !/^[A-Z ]+$/.test(item))) {
    throw runtimeError('grant privileges are malformed');
  }
  const target = match[2].replace(/`/g, '');
  if (target === '*.*') return { scope: 'global', privileges };
  if (target === `${trusted.databaseName}.*`) return { scope: 'schema', privileges };
  throw runtimeError('a grant targets an unexpected schema');
}

function validateGrantSet(statements, trusted, label) {
  if (!Array.isArray(statements) || statements.length === 0) throw runtimeError(`${label} grant results are missing`);
  const grants = statements.map((statement) => parseGrant(statement, trusted));
  const global = grants.filter((grant) => grant.scope === 'global').flatMap((grant) => grant.privileges).sort();
  const schema = grants.filter((grant) => grant.scope === 'schema').flatMap((grant) => grant.privileges).sort();
  if (new Set(global).size !== global.length || global.join(',') !== trusted.globalPrivileges.join(',')) {
    throw runtimeError(`${label} global privileges are unexpected`);
  }
  if (new Set(schema).size !== schema.length || schema.join(',') !== trusted.schemaPrivileges.join(',')) {
    throw runtimeError(`${label} schema privileges are unexpected`);
  }
}

function validateRuntimeSnapshot({ identity, directGrantStatements, effectiveGrantStatements, profile }) {
  const trusted = validateTrustedMysqlProfile(profile);
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw runtimeError('identity result is missing');
  }
  const requiredNonempty = [
    'version', 'versionComment', 'serverUuid', 'hostname', 'mysqlServerPort', 'databaseName',
    'currentUser', 'connectionUser', 'currentRole', 'charset', 'collation',
    'globalSqlMode', 'sessionSqlMode',
  ];
  for (const field of requiredNonempty) {
    if (identity[field] === undefined || identity[field] === null || identity[field] === '') {
      throw runtimeError(`${field} is missing`);
    }
  }
  for (const field of ['mandatoryRoles', 'activateAllRolesOnLogin', 'partialRevokes']) {
    if (identity[field] === undefined || identity[field] === null) throw runtimeError(`${field} is missing`);
  }

  if (/mariadb/i.test(`${identity.version} ${identity.versionComment}`)) throw runtimeError('MariaDB is forbidden');
  if (String(identity.version) !== trusted.version && !String(identity.version).startsWith(`${trusted.version}-`)) {
    throw runtimeError('MySQL version does not match the approved patch');
  }
  if (!/mysql/i.test(String(identity.versionComment))) throw runtimeError('server engine is not verified as MySQL');
  if (!UUID_PATTERN.test(String(identity.serverUuid))) throw runtimeError('server UUID is malformed');
  if (identity.serverUuid.toLowerCase() !== trusted.expectedServerUuid.toLowerCase()) {
    throw runtimeError('server UUID does not match the externally expected identity');
  }
  if (identity.hostname !== trusted.expectedServerHostname) {
    throw runtimeError('server hostname does not match the externally expected identity');
  }
  if (String(identity.mysqlServerPort) !== trusted.mysqlServerPort) {
    throw runtimeError('internal MySQL server port is unexpected');
  }
  if (identity.databaseName !== trusted.databaseName) throw runtimeError('connected database is unexpected');
  if (identity.currentUser !== trusted.effectiveUser) throw runtimeError('effective database user is unexpected');
  const connectionUsername = String(identity.connectionUser).split('@')[0];
  if (connectionUsername !== trusted.username || FORBIDDEN_RUNTIME_USERS.has(connectionUsername.toLowerCase())) {
    throw runtimeError('connection database user is unexpected');
  }
  if (String(identity.currentRole).trim() !== 'NONE') {
    throw runtimeError('active MySQL roles are forbidden');
  }
  if (String(identity.mandatoryRoles).trim() !== '') {
    throw runtimeError('mandatory MySQL roles are forbidden');
  }
  requireDisabled(identity.activateAllRolesOnLogin, 'automatic role activation');
  requireDisabled(identity.partialRevokes, 'partial revokes');
  if (identity.charset !== trusted.charset || identity.collation !== trusted.collation) {
    throw runtimeError('server charset or collation is unexpected');
  }
  const globalModes = parseSqlModes(identity.globalSqlMode, 'global SQL mode');
  const sessionModes = parseSqlModes(identity.sessionSqlMode, 'session SQL mode');
  if (globalModes.join(',') !== trusted.sqlModes.join(',') || sessionModes.join(',') !== trusted.sqlModes.join(',')) {
    throw runtimeError('SQL mode does not match the approved profile');
  }

  validateGrantSet(directGrantStatements, trusted, 'direct');
  validateGrantSet(effectiveGrantStatements, trusted, 'effective');

  return Object.freeze({
    version: identity.version,
    versionComment: identity.versionComment,
    serverUuid: identity.serverUuid,
    hostname: identity.hostname,
    endpointPort: trusted.endpointPort,
    mysqlServerPort: String(identity.mysqlServerPort),
    databaseName: identity.databaseName,
    currentUser: identity.currentUser,
    connectionUser: identity.connectionUser,
    currentRole: identity.currentRole,
    charset: identity.charset,
    collation: identity.collation,
    globalSqlMode: Object.freeze(globalModes),
    sessionSqlMode: Object.freeze(sessionModes),
    role: trusted.role,
  });
}

function grantStatementsFromRows(rows, label) {
  if (rows.length === 0) throw runtimeError(`${label} grant results are missing`);
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw runtimeError(`${label} grant row is invalid`);
    const values = Object.values(row);
    if (values.length !== 1 || typeof values[0] !== 'string') {
      throw runtimeError(`${label} grant row must contain exactly one statement`);
    }
    return values[0];
  });
}

// The caller owns connection creation and must close it in try/finally. This
// verifier intentionally neither creates nor closes the supplied connection.
async function verifyMysqlRuntime({ connection, profile } = {}) {
  if (!connection || typeof connection.query !== 'function') throw runtimeError('a supplied connection object is required');
  try {
    const identityRows = rowsFromResult(await connection.query(IDENTITY_QUERY));
    if (identityRows.length !== 1) throw runtimeError('identity query must return exactly one row');
    const directRows = rowsFromResult(await connection.query(DIRECT_GRANTS_QUERY));
    const effectiveRows = rowsFromResult(await connection.query(EFFECTIVE_GRANTS_QUERY));
    return validateRuntimeSnapshot({
      identity: identityRows[0],
      directGrantStatements: grantStatementsFromRows(directRows, 'direct'),
      effectiveGrantStatements: grantStatementsFromRows(effectiveRows, 'effective'),
      profile,
    });
  } catch (error) {
    if (error && error.code === 'MYSQL_CI_RUNTIME_VERIFICATION_FAILED') throw error;
    throw runtimeError('verification query could not complete');
  }
}

module.exports = {
  DIRECT_GRANTS_QUERY,
  EFFECTIVE_GRANTS_QUERY,
  IDENTITY_QUERY,
  parseGrant,
  validateRuntimeSnapshot,
  verifyMysqlRuntime,
};
