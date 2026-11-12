/**
 * MySQL Account Policy Validation
 * 
 * Pure validation of Bootstrap/Migrator/Reader privilege profiles.
 * Addresses PRIV-ESC-01 HIGH finding: Bootstrap self-revocation MANDATORY.
 * 
 * ACCOUNT PROFILES:
 * 
 * Bootstrap (privileged, temporary):
 * - Global privileges: CREATE USER, GRANT OPTION, RELOAD
 * - Purpose: Create Migrator and Reader accounts
 * - MANDATORY self-revocation after Migrator/Reader creation
 * - Fail-closed: If revocation fails, transition to REJECTED state
 * 
 * Migrator (schema-scoped, DDL/DML):
 * - 9 privileges on disposable schema only
 * - SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
 * - NO global privileges
 * - NO cross-schema grants
 * - NO GRANT OPTION
 * 
 * Reader (schema-scoped, read-only):
 * - SELECT only on disposable schema
 * - NO write privileges
 * - NO DDL privileges
 * - NO global privileges
 * 
 * OFFLINE IMPLEMENTATION: Pure grant parsing and validation.
 * Account creation/revocation DISABLED in C-1B Stage 1 (C-2 runtime requirement).
 * 
 * @module account-policy
 */

'use strict';

/**
 * Expected Bootstrap global privileges.
 * 
 * @constant {Set<string>}
 */
const BOOTSTRAP_REQUIRED_PRIVILEGES = new Set([
  'CREATE USER',
  'RELOAD',
  'GRANT OPTION',
]);

/**
 * Expected Migrator schema-scoped privileges.
 * 
 * @constant {Set<string>}
 */
const MIGRATOR_REQUIRED_PRIVILEGES = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'INDEX',
  'REFERENCES',
]);

/**
 * Expected Reader schema-scoped privileges.
 * 
 * @constant {Set<string>}
 */
const READER_REQUIRED_PRIVILEGES = new Set([
  'SELECT',
]);

/**
 * Forbidden global privileges for non-Bootstrap accounts.
 * 
 * @constant {Set<string>}
 */
const FORBIDDEN_GLOBAL_PRIVILEGES = new Set([
  'ALL',
  'ALL PRIVILEGES',
  'SUPER',
  'CREATE USER',
  'RELOAD',
  'SHUTDOWN',
  'PROCESS',
  'FILE',
  'REPLICATION SLAVE',
  'REPLICATION CLIENT',
  'GRANT OPTION',
  'SYSTEM_USER',
  'PROXY',
]);

const ACCOUNT_NAME_PATTERN = "(?:'[^'\\r\\n]+'|`[^`\\r\\n]+`|[A-Za-z0-9_$.-]+)@(?:'[^'\\r\\n]+'|`[^`\\r\\n]+`|[A-Za-z0-9_$.%:-]+)";

function normalizeSchemaName(schema) {
  if (typeof schema !== 'string' || !/^(?:`[A-Za-z0-9_$-]+`|[A-Za-z0-9_$-]+)$/.test(schema)) {
    throw new Error('Expected schema name is missing or malformed');
  }
  return schema.replace(/`/g, '');
}

function validateExactSchemaGrant(grant, expectedSchema, accountType) {
  if (grant.kind === 'ROLE') {
    throw new Error(`${accountType} account has unexpected role assignment`);
  }
  if (grant.kind !== 'PRIVILEGE') {
    throw new Error(`${accountType} grant syntax is unsupported`);
  }
  if (grant.scope === '*.*') {
    if (grant.privileges.length === 1 && grant.privileges[0] === 'USAGE') return false;
    throw new Error(`${accountType} account has global privileges`);
  }
  if (grant.scopeType !== 'SCHEMA' || grant.schema !== expectedSchema) {
    throw new Error(
      `${accountType} account has cross-schema or non-schema grant: ${grant.scope}. ` +
      `Expected schema: ${expectedSchema}`
    );
  }
  return true;
}

/**
 * Validate Bootstrap account privileges.
 * 
 * @param {string[]} grants - Array of GRANT statements from SHOW GRANTS
 * @returns {object} - Validation result {valid, missingPrivileges, unexpectedPrivileges}
 * @throws {Error} - If validation fails
 */
function validateBootstrapPrivileges(grants) {
  if (!Array.isArray(grants) || grants.length === 0) {
    throw new Error('Bootstrap grants must be a non-empty array');
  }
  
  const parsedGrants = grants.map(parseGrantStatement);
  detectRole(grants);
  
  // Check for required global privileges
  const foundPrivileges = new Set();
  let hasGlobalGrant = false;
  
  for (const grant of parsedGrants) {
    if (grant.kind !== 'PRIVILEGE' || grant.scope !== '*.*') {
      throw new Error(`Bootstrap account has unexpected non-global grant: ${grant.raw}`);
    }
    hasGlobalGrant = true;
    for (const priv of grant.privileges) {
      if (priv !== 'USAGE' && !BOOTSTRAP_REQUIRED_PRIVILEGES.has(priv)) {
        throw new Error(`Bootstrap account has unexpected privilege: ${priv}`);
      }
      if (priv !== 'USAGE') foundPrivileges.add(priv);
    }
  }
  
  if (!hasGlobalGrant) {
    throw new Error(
      'Bootstrap account missing global privileges. ' +
      'Expected global GRANT with CREATE USER, RELOAD, GRANT OPTION.'
    );
  }
  
  const missingPrivileges = [];
  for (const required of BOOTSTRAP_REQUIRED_PRIVILEGES) {
    if (!foundPrivileges.has(required) && !foundPrivileges.has('ALL PRIVILEGES')) {
      missingPrivileges.push(required);
    }
  }
  
  if (missingPrivileges.length > 0) {
    throw new Error(
      `Bootstrap account missing required privileges: ${missingPrivileges.join(', ')}`
    );
  }
  
  return {
    valid: true,
    foundPrivileges: Array.from(foundPrivileges),
    hasGrantOption: foundPrivileges.has('GRANT OPTION') || detectGrantOption(grants.join('\n')),
  };
}

/**
 * Validate Migrator account privileges.
 * 
 * @param {string[]} grants - Array of GRANT statements from SHOW GRANTS
 * @param {string} expectedSchema - Expected schema name
 * @returns {object} - Validation result
 * @throws {Error} - If validation fails
 */
function validateMigratorPrivileges(grants, expectedSchema) {
  if (!Array.isArray(grants) || grants.length === 0) {
    throw new Error('Migrator grants must be a non-empty array');
  }
  
  expectedSchema = normalizeSchemaName(expectedSchema);
  
  const parsedGrants = grants.map(parseGrantStatement);
  
  detectRole(grants);
  
  // Check for GRANT OPTION
  if (detectGrantOption(grants.join('\n'))) {
    throw new Error(
      'Migrator account has GRANT OPTION. ' +
      'PRIV-ESC-01 protection: Migrator cannot grant privileges to others.'
    );
  }
  
  const foundPrivileges = new Set();
  for (const grant of parsedGrants) {
    if (!validateExactSchemaGrant(grant, expectedSchema, 'Migrator')) continue;
    for (const priv of grant.privileges) {
      if (!MIGRATOR_REQUIRED_PRIVILEGES.has(priv)) {
        throw new Error(`Migrator account has unexpected privilege: ${priv}`);
      }
      foundPrivileges.add(priv);
    }
  }
  
  const missingPrivileges = [];
  for (const required of MIGRATOR_REQUIRED_PRIVILEGES) {
    if (!foundPrivileges.has(required)) {
      missingPrivileges.push(required);
    }
  }
  
  if (missingPrivileges.length > 0) {
    throw new Error(
      `Migrator account missing required privileges on ${expectedSchema}: ${missingPrivileges.join(', ')}`
    );
  }
  
  return {
    valid: true,
    foundPrivileges: Array.from(foundPrivileges),
    schema: expectedSchema,
  };
}

/**
 * Validate Reader account privileges.
 * 
 * @param {string[]} grants - Array of GRANT statements from SHOW GRANTS
 * @param {string} expectedSchema - Expected schema name
 * @returns {object} - Validation result
 * @throws {Error} - If validation fails
 */
function validateReaderPrivileges(grants, expectedSchema) {
  if (!Array.isArray(grants) || grants.length === 0) {
    throw new Error('Reader grants must be a non-empty array');
  }
  
  expectedSchema = normalizeSchemaName(expectedSchema);
  
  const parsedGrants = grants.map(parseGrantStatement);
  
  detectRole(grants);
  
  // Check for GRANT OPTION
  if (detectGrantOption(grants.join('\n'))) {
    throw new Error(
      'Reader account has GRANT OPTION. ' +
      'Reader cannot grant privileges to others.'
    );
  }
  
  const foundPrivileges = new Set();
  for (const grant of parsedGrants) {
    if (!validateExactSchemaGrant(grant, expectedSchema, 'Reader')) continue;
    for (const priv of grant.privileges) {
      if (!READER_REQUIRED_PRIVILEGES.has(priv)) {
        throw new Error(`Reader account has write privilege or unexpected privilege: ${priv}`);
      }
      foundPrivileges.add(priv);
    }
  }
  if (!foundPrivileges.has('SELECT')) {
    throw new Error(
      `Reader account missing SELECT privilege on ${expectedSchema}`
    );
  }
  
  return {
    valid: true,
    foundPrivileges: ['SELECT'],
    schema: expectedSchema,
  };
}

/**
 * Enforce Bootstrap self-revocation requirement (PRIV-ESC-01 correction).
 * 
 * After Migrator and Reader accounts are created, Bootstrap MUST execute
 * self-revocation (REVOKE privileges, DROP USER). This is MANDATORY, not optional.
 * 
 * If self-revocation fails, the runner must transition to REJECTED state (fail-closed).
 * 
 * @returns {object} - Self-revocation policy
 */
function enforceSelfRevocationRequirement() {
  return {
    required: true,
    mandatory: true,
    failureAction: 'TRANSITION_TO_REJECTED',
    steps: [
      'REVOKE ALL PRIVILEGES, GRANT OPTION FROM bootstrap_user',
      'DROP USER IF EXISTS bootstrap_user',
      'FLUSH PRIVILEGES',
    ],
    verification: [
      'Query mysql.user for bootstrap_user (expect 0 rows)',
      'Attempt connection with bootstrap credentials (expect authentication failure)',
    ],
    note: 'PRIV-ESC-01 correction: Bootstrap self-revocation changed from optional to MANDATORY. ' +
          'If revocation fails, runner transitions to REJECTED state (fail-closed).',
  };
}

/**
 * Detect GRANT OPTION in grant statements.
 * 
 * @param {string} grantLine - GRANT statement line
 * @returns {boolean} - True if GRANT OPTION detected
 */
function detectGrantOption(grantLine) {
  return /WITH GRANT OPTION/i.test(grantLine);
}

/**
 * Detect role assignments in grants (unexpected for disposable accounts).
 * 
 * @param {string[]} grants - Array of GRANT statements
 * @returns {string[]} - Array of detected role names
 * @throws {Error} - If roles are detected
 */
function detectRole(grants) {
  const roles = [];
  
  for (const grant of grants) {
    // GRANT 'role_name' TO 'user'@'host'
    const roleMatch = grant.match(/GRANT\s+'([^']+)'\s+TO/i);
    if (roleMatch) {
      roles.push(roleMatch[1]);
    }
  }
  
  if (roles.length > 0) {
    throw new Error(
      `Unexpected role assignments detected: ${roles.join(', ')}. ` +
      `Disposable accounts should have explicit privileges, not role inheritance.`
    );
  }
  
  return roles;
}

/**
 * Parse a single GRANT statement.
 * 
 * @param {string} line - GRANT statement line
 * @returns {object} - Parsed grant {privileges, scope, grantOption}
 */
function parseGrantStatement(line) {
  if (typeof line !== 'string' || !line.trim()) throw new Error('Grant statement must be non-empty');
  const sql = line.trim().replace(/;$/, '');
  const rolePattern = new RegExp(`^GRANT\\s+('(?:[^']|'')+'(?:\\s*,\\s*'(?:[^']|'')+')*)\\s+TO\\s+${ACCOUNT_NAME_PATTERN}$`, 'i');
  if (rolePattern.test(sql)) return { kind: 'ROLE', privileges: [], scope: null, raw: line };

  const grantPattern = new RegExp(`^GRANT\\s+(.+?)\\s+ON\\s+([^\\s]+)\\s+TO\\s+${ACCOUNT_NAME_PATTERN}(\\s+WITH\\s+GRANT\\s+OPTION)?$`, 'i');
  const match = sql.match(grantPattern);
  if (!match) throw new Error(`Unsupported or malformed GRANT statement: ${line}`);

  const privileges = match[1].split(',').map(p => p.trim().replace(/\s+/g, ' ').toUpperCase());
  if (privileges.some(p => !/^[A-Z_]+(?: [A-Z_]+)*$/.test(p))) {
    throw new Error(`Unsupported privilege syntax: ${match[1]}`);
  }
  if (privileges.includes('ALL') || privileges.includes('ALL PRIVILEGES')) {
    throw new Error('ALL/ALL PRIVILEGES is forbidden for disposable accounts');
  }

  const scope = match[2];
  let scopeType = 'OTHER';
  let schema = null;
  if (scope === '*.*') scopeType = 'GLOBAL';
  else {
    const schemaMatch = scope.match(/^(?:`([A-Za-z0-9_$-]+)`|([A-Za-z0-9_$-]+))\.\*$/);
    if (schemaMatch) {
      scopeType = 'SCHEMA';
      schema = schemaMatch[1] || schemaMatch[2];
    }
  }
  return { kind: 'PRIVILEGE', privileges, scope, scopeType, schema, grantOption: Boolean(match[3]), raw: line };
}

module.exports = {
  validateBootstrapPrivileges,
  validateMigratorPrivileges,
  validateReaderPrivileges,
  enforceSelfRevocationRequirement,
  detectGrantOption,
  detectRole,
  parseGrantStatement,
};
