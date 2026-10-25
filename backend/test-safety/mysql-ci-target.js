'use strict';

// ============================================================================
// AUTHORIZATION BOUNDARY AND SECURITY MODEL
// ============================================================================
//
// This module validates runner-supplied policy and evidence for shape, internal
// consistency, and format correctness. It CANNOT establish their provenance or
// guarantee their authenticity. This is validation, not authorization.
//
// WHAT THIS MODULE DOES:
// - Validates policy structure and format
// - Checks policy internal consistency
// - Rejects malformed inputs
// - Prevents accidental misconfiguration
// - Provides fail-closed validation logic
//
// WHAT THIS MODULE DOES NOT DO:
// - Establish policy authenticity (caller can forge)
// - Create or verify cryptographic signatures
// - Prove service identity independently
// - Prevent TOCTOU attacks (requires external runner)
// - Connect to any database or network service
//
// CRITICAL SECURITY NOTE:
// The exported constants (ROLE_USERS, AUTHORIZATION_EVIDENCE_KIND) are PUBLIC
// and can be imported by any caller. A malicious or confused caller can import
// these constants and construct a "valid" profile/evidence pair that passes all
// validation checks in this module. This is NOT a security boundary.
//
// REQUIRED EXTERNAL RUNNER CONTRACT:
// A future trusted runner must:
//
// 1. SERVICE CREATION & BINDING
//    - Create or identify the exact ephemeral MySQL service
//    - Capture container ID, image digest independently
//    - Generate or obtain server UUID and hostname
//    - Never accept service's self-reported identity as expected identity
//    - Bind all identities atomically before exposing credentials
//
// 2. POLICY GENERATION & PROTECTION
//    - Generate policy from trusted configuration
//    - Sign or MAC policy with runner's private key
//    - Include run ID, attempt, timestamp in binding
//    - Compute policy digest from canonical representation
//    - Never allow application code to supply policy
//
// 3. EVIDENCE GENERATION
//    - Generate evidence only after service verification
//    - Include all required identity fields
//    - Sign or MAC evidence independently
//    - Ensure evidence and policy digests match
//    - Time-bound evidence to prevent replay
//
// 4. TOCTOU PROTECTION
//    - Verify service identity immediately before migration
//    - Verify service identity after migration
//    - Use same endpoint for verification and migration
//    - Detect any service replacement between checks
//    - Fail on any identity or image change
//
// 5. CREDENTIAL ISOLATION
//    - Generate unique credentials per run
//    - Never reuse credentials across runs
//    - Revoke credentials after run completion
//    - Keep credentials out of logs and environment
//    - Use credential helper or sealed secret
//
// 6. CONNECTION LIFECYCLE
//    - Own connection creation and cleanup
//    - Use try/finally for guaranteed cleanup
//    - Close connections before credential revocation
//    - Never leave connections open after run
//
// CURRENT LIMITATIONS (MOCKED TESTING ONLY):
// - Policy can be forged by caller (no signature)
// - Evidence can be forged by caller (no MAC)
// - Expected identity supplied by caller (not independent attestation)
// - No protection against service replacement (TOCTOU)
// - No protection against credential reuse
// - No time-bounding or replay prevention
//
// These limitations are ACCEPTABLE for pure unit tests with mocked connections.
// They are NOT acceptable for real database operations.
//
// ============================================================================
const AUTHORIZATION_EVIDENCE_KIND = 'halqa.mysql-ci.external-runner-policy.v1';
const SAFE_INHERITED_ENV = Object.freeze([
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP',
  'LOCALAPPDATA', 'APPDATA', 'HOME', 'USERPROFILE', 'CI', 'TZ', 'LANG',
  'FORCE_COLOR', 'NO_COLOR',
]);
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'mysql']);
const ROLE_USERS = Object.freeze({
  migration: 'halqa_ci_migrator',
  reader: 'halqa_ci_reader',
});
const FORBIDDEN_USERNAMES = new Set(['root', 'halqa_user', 'halqa', 'admin']);
const FORBIDDEN_TARGET_PATTERN = /(?:^|[_-])(halqa_db|prod(?:uction)?|stag(?:e|ing)?|dev(?:elopment|eloper)?)(?:$|[_-])/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;

function targetError(message) {
  const error = new Error(`Unsafe MySQL CI target: ${message}`);
  error.code = 'UNSAFE_MYSQL_CI_TARGET';
  return error;
}

function requirePlainString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw targetError(`${label} must be a non-empty, unpadded string`);
  }
  return value;
}

function validatePort(value, label) {
  const port = requirePlainString(value, label);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw targetError(`${label} must be an explicit valid port`);
  }
  return port;
}

function normalizeModes(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw targetError(`${label} must be a non-empty array`);
  const modes = value.map((mode) => requirePlainString(mode, label).toUpperCase());
  if (new Set(modes).size !== modes.length || modes.some((mode) => !/^[A-Z0-9_]+$/.test(mode))) {
    throw targetError(`${label} contains a duplicate or invalid SQL mode`);
  }
  return Object.freeze([...modes].sort());
}

function normalizePrivileges(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw targetError(`${label} must be a non-empty array`);
  const privileges = value.map((privilege) => requirePlainString(privilege, label).toUpperCase());
  if (new Set(privileges).size !== privileges.length || privileges.some((item) => !/^[A-Z ]+$/.test(item))) {
    throw targetError(`${label} contains a duplicate or invalid privilege`);
  }
  return Object.freeze([...privileges].sort());
}

function validateRunnerBinding(binding, databaseName) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    throw targetError('profile.runnerBinding is required');
  }
  const runId = requirePlainString(binding.runId, 'profile.runnerBinding.runId');
  const runAttempt = requirePlainString(binding.runAttempt, 'profile.runnerBinding.runAttempt');
  const containerId = requirePlainString(binding.containerId, 'profile.runnerBinding.containerId');
  const imageDigest = requirePlainString(binding.imageDigest, 'profile.runnerBinding.imageDigest');
  const policyDigest = requirePlainString(binding.policyDigest, 'profile.runnerBinding.policyDigest');
  if (!/^\d+$/.test(runId) || !/^[1-9]\d*$/.test(runAttempt)) {
    throw targetError('runner binding run identity is invalid');
  }
  if (!HEX64_PATTERN.test(containerId) || !SHA256_PATTERN.test(imageDigest) || !SHA256_PATTERN.test(policyDigest)) {
    throw targetError('runner binding container or digest identity is invalid');
  }
  if (binding.databaseName !== databaseName) throw targetError('runner binding database identity is inconsistent');
  return Object.freeze({ runId, runAttempt, containerId, imageDigest, policyDigest, databaseName });
}

function validateTrustedMysqlProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw targetError('an externally supplied trusted runner profile is required');
  }
  const protocol = requirePlainString(profile.protocol, 'profile.protocol');
  const endpointHost = requirePlainString(profile.endpointHost, 'profile.endpointHost');
  const endpointPort = validatePort(profile.endpointPort, 'profile.endpointPort');
  const mysqlServerPort = validatePort(profile.mysqlServerPort, 'profile.mysqlServerPort');
  const databaseName = requirePlainString(profile.databaseName, 'profile.databaseName');
  const username = requirePlainString(profile.username, 'profile.username');
  const effectiveUser = requirePlainString(profile.effectiveUser, 'profile.effectiveUser');
  const role = requirePlainString(profile.role, 'profile.role');
  const version = requirePlainString(profile.version, 'profile.version');
  const charset = requirePlainString(profile.charset, 'profile.charset');
  const collation = requirePlainString(profile.collation, 'profile.collation');
  const expectedServerUuid = requirePlainString(profile.expectedServerUuid, 'profile.expectedServerUuid');
  const expectedServerHostname = requirePlainString(profile.expectedServerHostname, 'profile.expectedServerHostname');

  if (protocol !== 'mysql:') throw targetError('profile.protocol must be exactly "mysql:"');
  if (!ALLOWED_HOSTS.has(endpointHost)) throw targetError('profile.endpointHost is not an approved isolated CI host');
  if (mysqlServerPort !== '3306') throw targetError('profile.mysqlServerPort must be exactly 3306');
  if (!/^halqa_mysql8_ci_[a-z0-9_]+$/i.test(databaseName) || FORBIDDEN_TARGET_PATTERN.test(databaseName)) {
    throw targetError('profile.databaseName is not an approved ephemeral CI database');
  }
  if (!Object.hasOwn(ROLE_USERS, role) || ROLE_USERS[role] !== username) {
    throw targetError('profile role and dedicated username do not match');
  }
  if (FORBIDDEN_USERNAMES.has(username.toLowerCase())) throw targetError('profile.username is forbidden');
  if (effectiveUser !== `${username}@%`) throw targetError('profile.effectiveUser must be the exact dedicated account');
  if (!/^8\.4\.\d+$/.test(version)) throw targetError('profile.version must pin an exact approved MySQL 8.4 patch');
  if (charset !== 'utf8mb4' || collation !== 'utf8mb4_unicode_ci') {
    throw targetError('profile charset/collation is not approved');
  }
  if (!UUID_PATTERN.test(expectedServerUuid)) throw targetError('profile.expectedServerUuid is malformed');
  if (!HOSTNAME_PATTERN.test(expectedServerHostname)) throw targetError('profile.expectedServerHostname is malformed');

  const sqlModes = normalizeModes(profile.sqlModes, 'profile.sqlModes');
  const globalPrivileges = normalizePrivileges(profile.globalPrivileges, 'profile.globalPrivileges');
  const schemaPrivileges = normalizePrivileges(profile.schemaPrivileges, 'profile.schemaPrivileges');
  if (globalPrivileges.length !== 1 || globalPrivileges[0] !== 'USAGE') {
    throw targetError('profile global privileges must be exactly USAGE');
  }
  const expectedSchema = role === 'reader'
    ? ['SELECT']
    : ['ALTER', 'CREATE', 'DELETE', 'DROP', 'INDEX', 'INSERT', 'REFERENCES', 'SELECT', 'UPDATE'];
  if (schemaPrivileges.join(',') !== expectedSchema.sort().join(',')) {
    throw targetError(`profile schema privileges do not match the ${role} contract`);
  }
  const runnerBinding = validateRunnerBinding(profile.runnerBinding, databaseName);

  return Object.freeze({
    protocol, endpointHost, endpointPort, mysqlServerPort, databaseName, username,
    effectiveUser, role, version, charset, collation, expectedServerUuid,
    expectedServerHostname, sqlModes, globalPrivileges, schemaPrivileges, runnerBinding,
  });
}

function validateAuthorizationEvidence(evidence, profile) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw targetError('external runner authorization evidence is required');
  }
  const kind = requirePlainString(evidence.kind, 'authorizationEvidence.kind');
  const operation = requirePlainString(evidence.operation, 'authorizationEvidence.operation');
  const runId = requirePlainString(evidence.runId, 'authorizationEvidence.runId');
  const runAttempt = requirePlainString(evidence.runAttempt, 'authorizationEvidence.runAttempt');
  const containerId = requirePlainString(evidence.containerId, 'authorizationEvidence.containerId');
  const imageDigest = requirePlainString(evidence.imageDigest, 'authorizationEvidence.imageDigest');
  const policyDigest = requirePlainString(evidence.policyDigest, 'authorizationEvidence.policyDigest');
  const databaseName = requirePlainString(evidence.databaseName, 'authorizationEvidence.databaseName');
  if (kind !== AUTHORIZATION_EVIDENCE_KIND) throw targetError('authorization evidence kind is not approved');
  const expectedOperation = profile.role === 'migration' ? 'migration' : 'read-only-smoke';
  if (operation !== expectedOperation) throw targetError('authorization evidence operation is not approved');
  const binding = profile.runnerBinding;
  for (const field of ['runId', 'runAttempt', 'containerId', 'imageDigest', 'policyDigest']) {
    if ({ runId, runAttempt, containerId, imageDigest, policyDigest }[field] !== binding[field]) {
      throw targetError(`authorization evidence ${field} does not match the runner policy`);
    }
  }
  if (databaseName !== binding.databaseName) {
    throw targetError('authorization evidence databaseName does not match the runner policy');
  }
  return Object.freeze({
    kind, operation, runId, runAttempt, containerId, imageDigest, policyDigest, databaseName,
  });
}

function parseMysqlCiUrl(databaseUrl) {
  requirePlainString(databaseUrl, 'database URL');
  if (/\s|\\/.test(databaseUrl)) throw targetError('database URL contains ambiguous characters');
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw targetError('database URL is invalid'); }
  if (parsed.protocol !== 'mysql:') throw targetError('database URL must use mysql protocol');
  if (!parsed.hostname || !parsed.port) throw targetError('database URL requires an exact host and explicit endpoint port');
  if (!parsed.username || !parsed.password) throw targetError('database URL requires dedicated credentials');
  if (parsed.search || parsed.hash) throw targetError('database URL parameters and fragments are forbidden');
  const databaseName = parsed.pathname.slice(1);
  if (!databaseName || databaseName.includes('/') || databaseName.includes('%') ||
      parsed.username.includes('%') || parsed.hostname.includes('%')) {
    throw targetError('database URL contains an ambiguous encoded identity');
  }
  if (FORBIDDEN_USERNAMES.has(parsed.username.toLowerCase())) throw targetError('database URL username is forbidden');
  if (databaseName.toLowerCase() === 'halqa_db' || FORBIDDEN_TARGET_PATTERN.test(databaseName)) {
    throw targetError('database URL identifies a forbidden database');
  }
  return Object.freeze({
    protocol: parsed.protocol,
    endpointHost: parsed.hostname,
    endpointPort: parsed.port,
    databaseName,
    username: parsed.username,
  });
}

function validateMysqlCiTarget({ databaseUrl, profile, authorizationEvidence } = {}) {
  const trusted = validateTrustedMysqlProfile(profile);
  const evidence = validateAuthorizationEvidence(authorizationEvidence, trusted);
  const target = parseMysqlCiUrl(databaseUrl);
  const expected = {
    protocol: trusted.protocol,
    endpointHost: trusted.endpointHost,
    endpointPort: trusted.endpointPort,
    databaseName: trusted.databaseName,
    username: trusted.username,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (target[field] !== value) throw targetError(`database URL ${field} does not match the runner policy`);
  }
  return Object.freeze({ target, profile: trusted, authorizationEvidence: evidence });
}

function copyAllowedEnvironment(inheritedEnv) {
  const childEnv = {};
  for (const allowed of SAFE_INHERITED_ENV) {
    const actual = Object.keys(inheritedEnv || {}).find((name) => name.toLowerCase() === allowed.toLowerCase());
    if (actual && inheritedEnv[actual] !== undefined) childEnv[allowed] = inheritedEnv[actual];
  }
  childEnv.NODE_ENV = 'test';
  return childEnv;
}

function buildChildEnvironment({ inheritedEnv = {}, databaseUrl, profile, authorizationEvidence, role } = {}) {
  if (role !== 'migration' && role !== 'reader') throw targetError('an explicit child role is required');
  const validated = validateMysqlCiTarget({ databaseUrl, profile, authorizationEvidence });
  if (validated.profile.role !== role) throw targetError('child role does not match the runner policy');
  const childEnv = copyAllowedEnvironment(inheritedEnv);
  childEnv.DATABASE_URL = databaseUrl;
  childEnv.HALQA_TEST_MODE = role === 'reader' ? 'mysql-readonly-smoke' : 'mysql-migration';
  return Object.freeze(childEnv);
}

function buildMigrationChildEnvironment(options) {
  return buildChildEnvironment({ ...options, role: 'migration' });
}

function buildReaderChildEnvironment(options) {
  return buildChildEnvironment({ ...options, role: 'reader' });
}

module.exports = {
  AUTHORIZATION_EVIDENCE_KIND,
  ROLE_USERS,
  SAFE_INHERITED_ENV,
  buildMigrationChildEnvironment,
  buildReaderChildEnvironment,
  parseMysqlCiUrl,
  targetError,
  validateAuthorizationEvidence,
  validateMysqlCiTarget,
  validateTrustedMysqlProfile,
};
