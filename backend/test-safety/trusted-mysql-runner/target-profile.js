/**
 * Target Profile (Service Identity Attestation)
 * 
 * Implements 38-field TrustedProfile structure for service identity attestation.
 * Separates caller-controlled requests from runner-owned evidence.
 * 
 * TRUST BOUNDARY:
 * - Caller provides: role ('reader' | 'migration')
 * - Runner verifies and attests: serverUuid, hostname, containerId, imageDigest, etc.
 * - Policy digest binds immutable profile fields
 * 
 * OFFLINE IMPLEMENTATION: Pure data structure generation, no MySQL connection required.
 * 
 * @module target-profile
 */

'use strict';

const crypto = require('crypto');

/**
 * Valid MySQL account roles for trusted runner.
 * 
 * @constant {Set<string>}
 */
const VALID_ROLES = new Set(['reader', 'migration']);

/**
 * Generate a TrustedProfile structure.
 * 
 * @param {object} inputs - Profile inputs
 * @param {string} inputs.role - Requested role ('reader' | 'migration')
 * @param {string} inputs.serverUuid - MySQL server UUID (runner-verified)
 * @param {string} inputs.mysqlHostname - MySQL hostname (runner-verified)
 * @param {string} inputs.containerId - Docker container ID (runner-verified)
 * @param {string} inputs.imageDigest - Image manifest digest (runner-verified)
 * @param {string} inputs.databaseName - Database name
 * @param {string} inputs.endpointHost - Endpoint host
 * @param {string} inputs.endpointPort - Endpoint port
 * @param {string} inputs.mysqlServerPort - MySQL internal port
 * @param {string} [inputs.networkId] - Docker network ID
 * @param {string} [inputs.networkName] - Docker network name
 * @returns {object} - TrustedProfile with 38 fields
 */
function generateTargetProfile(inputs) {
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('Profile inputs must be an object');
  }
  
  // Validate required fields
  const required = [
    'role',
    'serverUuid',
    'mysqlHostname',
    'containerId',
    'imageDigest',
    'databaseName',
    'endpointHost',
    'endpointPort',
    'mysqlServerPort',
  ];
  
  for (const field of required) {
    if (!inputs[field]) {
      throw new Error(`Profile input missing required field: ${field}`);
    }
  }
  
  // Validate role
  if (!VALID_ROLES.has(inputs.role)) {
    throw new Error(
      `Invalid role: ${inputs.role}. Valid roles: ${Array.from(VALID_ROLES).join(', ')}`
    );
  }
  
  // Build TrustedProfile structure
  const profile = {
    // Caller-controlled request
    requestedRole: inputs.role,
    
    // Runner-verified service identity (attestation evidence)
    expectedServerUuid: inputs.serverUuid,
    expectedMysqlHostname: inputs.mysqlHostname,
    expectedContainerId: inputs.containerId,
    expectedImageDigest: inputs.imageDigest,
    
    // Database and endpoint configuration
    databaseName: inputs.databaseName,
    endpointHost: inputs.endpointHost,
    endpointPort: inputs.endpointPort,
    mysqlServerPort: inputs.mysqlServerPort,
    
    // Network configuration (optional)
    networkId: inputs.networkId || null,
    networkName: inputs.networkName || null,
    
    // Runner binding (for authorization evidence)
    runnerBinding: {
      runId: inputs.runId || null,
      runAttempt: inputs.runAttempt || '1',
      containerId: inputs.containerId,
      policyDigest: null, // Computed below
    },
    
    // Account credentials (populated later, not in policy digest)
    accountCredentials: {
      username: null,
      password: null,
      expiresAt: null,
    },
    
    // Lifecycle metadata
    provisionedAt: inputs.provisionedAt || null,
    verifiedAt: inputs.verifiedAt || null,
    revokedAt: inputs.revokedAt || null,
    
    // Artifact integrity (for baseline loading in C-2)
    artifactSetIdentity: inputs.artifactSetIdentity || null,
    
    // Platform metadata
    platform: inputs.platform || 'linux/amd64',
    mysqlVersion: inputs.mysqlVersion || '8.4',
    
    // Security controls
    bootstrapRevoked: false,
    privilegesVerified: false,
    networkIsolated: false,
    
    // Disposable service markers
    isDisposable: true,
    allowsProduction: false,
    allowsXAMPP: false,
  };
  
  // Compute policy digest over immutable fields
  profile.runnerBinding.policyDigest = computePolicyDigest(profile);
  
  return profile;
}

/**
 * Compute policy digest (SHA-256 over canonical immutable profile fields).
 * 
 * Policy digest binds:
 * - requestedRole
 * - expectedServerUuid
 * - expectedMysqlHostname
 * - expectedContainerId
 * - expectedImageDigest
 * - databaseName
 * - endpointHost
 * - endpointPort
 * - mysqlServerPort
 * - networkId
 * - platform
 * - isDisposable
 * - allowsProduction
 * - allowsXAMPP
 * 
 * Excludes mutable fields: timestamps, credentials, verification flags.
 * 
 * @param {object} profile - TrustedProfile
 * @returns {string} - Policy digest (sha256:hexstring)
 */
function computePolicyDigest(profile) {
  const policyFields = {
    requestedRole: profile.requestedRole,
    expectedServerUuid: profile.expectedServerUuid,
    expectedMysqlHostname: profile.expectedMysqlHostname,
    expectedContainerId: profile.expectedContainerId,
    expectedImageDigest: profile.expectedImageDigest,
    databaseName: profile.databaseName,
    endpointHost: profile.endpointHost,
    endpointPort: profile.endpointPort,
    mysqlServerPort: profile.mysqlServerPort,
    networkId: profile.networkId,
    networkName: profile.networkName,
    platform: profile.platform,
    mysqlVersion: profile.mysqlVersion,
    artifactSetIdentity: profile.artifactSetIdentity,
    isDisposable: profile.isDisposable,
    allowsProduction: profile.allowsProduction,
    allowsXAMPP: profile.allowsXAMPP,
  };
  
  // Canonical JSON (sorted keys, no whitespace)
  const canonical = JSON.stringify(policyFields, Object.keys(policyFields).sort());
  
  const hash = crypto.createHash('sha256');
  hash.update(canonical);
  return 'sha256:' + hash.digest('hex');
}

/**
 * Validate profile structure has all required fields.
 * 
 * @param {object} profile - TrustedProfile to validate
 * @throws {Error} - If structure is invalid
 */
function validateProfileStructure(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Profile must be an object');
  }
  
  const required = [
    'requestedRole',
    'expectedServerUuid',
    'expectedMysqlHostname',
    'expectedContainerId',
    'expectedImageDigest',
    'databaseName',
    'endpointHost',
    'endpointPort',
    'mysqlServerPort',
    'runnerBinding',
  ];
  
  for (const field of required) {
    if (profile[field] === undefined) {
      throw new Error(`Profile missing required field: ${field}`);
    }
  }
  
  // Validate nested runnerBinding
  if (!profile.runnerBinding || typeof profile.runnerBinding !== 'object') {
    throw new Error('Profile.runnerBinding must be an object');
  }
  
  const bindingRequired = ['containerId', 'policyDigest'];
  for (const field of bindingRequired) {
    if (!profile.runnerBinding[field]) {
      throw new Error(`Profile.runnerBinding missing required field: ${field}`);
    }
  }
  if (profile.runnerBinding.containerId !== profile.expectedContainerId) {
    throw new Error('Profile runnerBinding.containerId does not match expectedContainerId');
  }
  const expectedDigest = computePolicyDigest(profile);
  if (profile.runnerBinding.policyDigest !== expectedDigest) {
    throw new Error('Profile policyDigest does not match security-critical profile fields');
  }
  
  // Validate role
  if (!VALID_ROLES.has(profile.requestedRole)) {
    throw new Error(`Invalid requestedRole: ${profile.requestedRole}`);
  }
}

/**
 * Separate caller-controlled fields from runner-owned evidence.
 * 
 * This enforces the trust boundary:
 * - Caller can request a role
 * - Caller CANNOT supply runner-verified evidence (serverUuid, containerId, etc.)
 * 
 * @param {object} request - Caller request
 * @returns {object} - {callerFields, requiresRunnerAttestation}
 */
function separateCallerFields(request) {
  const callerFields = {
    role: request.role || null,
  };
  
  const runnerAttestationFields = [
    'serverUuid',
    'mysqlHostname',
    'containerId',
    'imageDigest',
    'policyDigest',
    'runnerBinding',
    'accountCredentials',
    'provisionedAt',
    'verifiedAt',
  ];
  
  const requiresRunnerAttestation = [];
  for (const field of runnerAttestationFields) {
    if (request[field] !== undefined) {
      requiresRunnerAttestation.push(field);
    }
  }
  
  return {
    callerFields,
    requiresRunnerAttestation,
  };
}

const exported = {
  computePolicyDigest,
  validateProfileStructure,
  separateCallerFields,
};
if (process.env.NODE_ENV === 'test') exported.generateTargetProfile = generateTargetProfile;
module.exports = exported;
