/**
 * XAMPP and Wrong-Database Protection
 * 
 * Reject unverified localhost targets, developer XAMPP endpoints, production databases.
 * Addresses XAMPP-BYPASS-01 HIGH finding: Add port verification to runtime checks.
 * 
 * PROTECTION CONTROLS:
 * - Reject unverified localhost targets
 * - Reject developer MySQL/XAMPP endpoints (port 3306 on 127.0.0.1)
 * - Reject production/staging database names
 * - Reject unexpected host/internal MySQL ports
 * - Reject caller-supplied DATABASE_URL
 * - Reject unapproved networks
 * - Reject untrusted container identity
 * - Reject missing server UUID attestation
 * 
 * OFFLINE IMPLEMENTATION: Pure validation logic, no MySQL connection required.
 * 
 * @module xampp-protection
 */

'use strict';

/**
 * Expected disposable endpoint configuration.
 * 
 * @constant {object}
 */
const EXPECTED_DISPOSABLE_ENDPOINT = {
  host: '127.0.0.1',
  mappedPort: '3307', // Host-side port (mapped from container)
  internalPort: '3306', // Container-side MySQL port
};

/**
 * Production/staging database name patterns (MUST be rejected).
 * 
 * @constant {RegExp[]}
 */
const FORBIDDEN_DATABASE_PATTERNS = [
  /^halqa_db$/i,
  /^halqa_staging$/i,
  /^mysql$/i,
  /^information_schema$/i,
  /^performance_schema$/i,
  /^sys$/i,
  /production/i,
  /staging/i,
  /^prod_/i,
];

/**
 * Expected disposable database name pattern.
 * 
 * @constant {RegExp}
 */
const DISPOSABLE_DATABASE_PATTERN = /^halqa_mysql8_ci_[a-f0-9-]{36}$/;

/**
 * Reject unverified endpoint (XAMPP protection).
 * 
 * @param {object} endpoint - Endpoint configuration
 * @param {string} endpoint.host - Host address
 * @param {string} endpoint.port - Mapped port
 * @param {object} profile - TrustedProfile for verification
 * @throws {Error} - If endpoint is unverified or matches XAMPP
 */
function rejectUnverifiedEndpoint(endpoint, profile) {
  if (!endpoint || typeof endpoint !== 'object') {
    throw new Error('Endpoint must be an object');
  }
  
  const { host, port } = endpoint;
  
  if (!host || !port) {
    throw new Error('Endpoint must have host and port');
  }
  
  // Check if this looks like XAMPP (localhost:3306)
  if (host === '127.0.0.1' && port === '3306') {
    throw new Error(
      'XAMPP endpoint detected (127.0.0.1:3306). ' +
      'XAMPP-BYPASS-01 protection: Cannot use developer MySQL instance. ' +
      'Expected disposable endpoint: 127.0.0.1:3307 (mapped from container port 3306).'
    );
  }
  
  if (host === 'localhost' && port === '3306') {
    throw new Error(
      'XAMPP endpoint detected (localhost:3306). ' +
      'Cannot use developer MySQL instance. ' +
      'Expected disposable endpoint: 127.0.0.1:3307.'
    );
  }
  
  // Verify endpoint matches expected disposable configuration
  if (host !== EXPECTED_DISPOSABLE_ENDPOINT.host) {
    throw new Error(
      `Unexpected endpoint host: ${host}. ` +
      `Expected: ${EXPECTED_DISPOSABLE_ENDPOINT.host}`
    );
  }
  
  if (port !== EXPECTED_DISPOSABLE_ENDPOINT.mappedPort) {
    throw new Error(
      `Unexpected endpoint port: ${port}. ` +
      `Expected: ${EXPECTED_DISPOSABLE_ENDPOINT.mappedPort} (mapped from container)`
    );
  }
  
  if (!profile || typeof profile !== 'object') {
    throw new Error('Trusted profile is required; endpoint coordinates alone do not prove a disposable service.');
  }
  if (!profile.expectedContainerId) {
    throw new Error('Profile missing container identity. Cannot verify endpoint is disposable.');
  }
  if (!profile.expectedServerUuid) {
    throw new Error('Profile missing server UUID. Cannot verify endpoint identity.');
  }
}

/**
 * Reject production/staging database names.
 * 
 * @param {string} databaseName - Database name to check
 * @throws {Error} - If database name matches forbidden pattern
 */
function rejectProductionDatabase(databaseName) {
  if (!databaseName || typeof databaseName !== 'string') {
    throw new Error('Database name must be a non-empty string');
  }
  
  for (const pattern of FORBIDDEN_DATABASE_PATTERNS) {
    if (pattern.test(databaseName)) {
      throw new Error(
        `Production/system database detected: "${databaseName}". ` +
        `Forbidden pattern: ${pattern}. ` +
        `Only disposable databases matching ${DISPOSABLE_DATABASE_PATTERN} are allowed.`
      );
    }
  }
  
  // Verify database name matches expected disposable pattern
  if (!DISPOSABLE_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(
      `Invalid disposable database name: "${databaseName}". ` +
      `Expected pattern: halqa_mysql8_ci_[uuid]`
    );
  }
}

/**
 * Reject unexpected ports.
 * 
 * @param {string} mappedPort - Host-side mapped port
 * @param {string} internalPort - Container-side MySQL port
 * @throws {Error} - If ports don't match expected configuration
 */
function rejectUnexpectedPorts(mappedPort, internalPort) {
  if (mappedPort !== EXPECTED_DISPOSABLE_ENDPOINT.mappedPort) {
    throw new Error(
      `Unexpected mapped port: ${mappedPort}. ` +
      `Expected: ${EXPECTED_DISPOSABLE_ENDPOINT.mappedPort}. ` +
      `XAMPP-BYPASS-01 protection: Port must match disposable endpoint.`
    );
  }
  
  if (internalPort !== EXPECTED_DISPOSABLE_ENDPOINT.internalPort) {
    throw new Error(
      `Unexpected internal MySQL port: ${internalPort}. ` +
      `Expected: ${EXPECTED_DISPOSABLE_ENDPOINT.internalPort}`
    );
  }
}

/**
 * Reject caller-supplied DATABASE_URL.
 * 
 * @param {object} env - Environment variables
 * @throws {Error} - If DATABASE_URL or other connection variables are present
 */
function rejectCallerDatabaseUrl(env) {
  if (!env || typeof env !== 'object') {
    return; // No environment to check
  }
  
  const forbiddenVars = [
    'DATABASE_URL',
    'DIRECT_URL',
    'SHADOW_DATABASE_URL',
    'MYSQL_URL',
    'DB_CONNECTION_STRING',
  ];
  
  for (const varName of forbiddenVars) {
    if (env[varName]) {
      throw new Error(
        `Caller-supplied database connection variable detected: ${varName}. ` +
        `Runner must control all database connection parameters. ` +
        `Caller cannot override DATABASE_URL.`
      );
    }
  }
}

/**
 * Validate server UUID format and non-empty.
 * 
 * @param {string} uuid - Server UUID
 * @throws {Error} - If UUID is invalid or missing
 */
function validateServerUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('Server UUID must be a non-empty string');
  }
  
  // MySQL server UUID is typically a standard UUID format
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  
  if (!uuidPattern.test(uuid)) {
    throw new Error(
      `Invalid server UUID format: ${uuid}. ` +
      `Expected UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
    );
  }
}

/**
 * Validate hostname matches expected disposable container hostname.
 * 
 * @param {string} hostname - MySQL hostname (from @@hostname)
 * @param {string} [expectedContainerId] - Expected container ID (for validation)
 * @throws {Error} - If hostname doesn't match expected pattern
 */
function validateHostname(hostname, expectedContainerId) {
  if (!hostname || typeof hostname !== 'string') {
    throw new Error('Hostname must be a non-empty string');
  }
  
  // Disposable MySQL container hostname should be container ID (first 12 chars)
  // or a generated hostname pattern
  
  // Reject production-like hostnames
  const forbiddenHostnamePatterns = [
    /prod/i,
    /production/i,
    /staging/i,
    /mysql-server/i,
    /db-server/i,
  ];
  
  for (const pattern of forbiddenHostnamePatterns) {
    if (pattern.test(hostname)) {
      throw new Error(
        `Production-like hostname detected: ${hostname}. ` +
        `Pattern: ${pattern}. ` +
        `Only disposable container hostnames are allowed.`
      );
    }
  }
  
  // If expected container ID provided, verify hostname matches
  if (expectedContainerId) {
    const shortContainerId = expectedContainerId.substring(0, 12);
    if (hostname !== shortContainerId && !hostname.startsWith(shortContainerId)) {
      throw new Error(
        `Hostname mismatch. Expected: ${shortContainerId} (from container ID), ` +
        `Got: ${hostname}`
      );
    }
  }
}

/**
 * Validate network isolation (future enhancement for C-2).
 * 
 * @param {string} networkId - Docker network ID
 * @param {string} networkName - Docker network name
 * @throws {Error} - If network is not isolated
 */
function validateNetworkIsolation(networkId, networkName) {
  // C-1B Stage 1: Document requirement, implementation in C-2
  // Network isolation verification requires Docker runtime access
  
  if (!networkId || !networkName) {
    throw new Error(
      'Network identity required for isolation verification. ' +
      'C-2 runtime verification pending.'
    );
  }
  
  // Expected: bridge network with no external routes
  // Reject: host network, default bridge with host access
  
  if (networkName === 'host') {
    throw new Error(
      'Host network mode detected. ' +
      'Network isolation required for disposable MySQL runner.'
    );
  }
  
  if (networkName === 'bridge' || networkName === 'default') {
    throw new Error(
      'Default bridge network detected. ' +
      'Custom isolated network required for disposable MySQL runner.'
    );
  }
}

module.exports = {
  rejectUnverifiedEndpoint,
  rejectProductionDatabase,
  rejectUnexpectedPorts,
  rejectCallerDatabaseUrl,
  validateServerUuid,
  validateHostname,
  validateNetworkIsolation,
  EXPECTED_DISPOSABLE_ENDPOINT,
  FORBIDDEN_DATABASE_PATTERNS,
  DISPOSABLE_DATABASE_PATTERN,
};
