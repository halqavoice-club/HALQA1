/**
 * Runner Authorization Authority
 * 
 * HMAC-SHA256 MAC signing and verification for authorization evidence.
 * Addresses AUTH-FORG-01 CRITICAL finding: Prevent attestation forgery.
 * 
 * SECURITY MODEL:
 * - Runner generates internal secret key (crypto.randomBytes(32))
 * - MAC key is NEVER exported, NEVER logged, module-private only
 * - Deterministic JSON serialization (sorted keys)
 * - Constant-time MAC comparison (crypto.timingSafeEqual)
 * - MAC binds: runId, runAttempt, containerId, policyDigest, nonce, timestamps
 * - Nonce prevents replay (16 random bytes)
 * 
 * OFFLINE IMPLEMENTATION: Pure cryptographic operations, no external dependencies.
 * 
 * @module runner-authority
 */

'use strict';

const crypto = require('crypto');

/**
 * Runner-internal MAC secret key.
 * 
 * CRITICAL SECURITY CONTROL:
 * - Generated once per module load
 * - NEVER exported from this module
 * - NEVER logged or transmitted
 * - NEVER passed to SQL subprocesses
 * - Used exclusively for HMAC-SHA256 signing/verification
 * 
 * In production, this should be:
 * - Generated once at runner initialization
 * - Stored in secure memory (not disk)
 * - Rotated on runner restart
 * - Protected by operating system memory isolation
 * 
 * @private
 * @type {Buffer}
 */
let MAC_SECRET_KEY = crypto.randomBytes(32);
let CONSUMED_NONCES = new Set();

/**
 * Authorization evidence validity period (30 minutes).
 * 
 * @constant {number}
 */
const EVIDENCE_VALIDITY_MS = 30 * 60 * 1000;

/**
 * Generate authorization evidence with HMAC-SHA256 MAC.
 * 
 * Evidence structure:
 * - runId: Unique run identifier
 * - runAttempt: Attempt number (for retry scenarios)
 * - containerId: Docker container ID
 * - policyDigest: Hash of target profile policy
 * - nonce: Random 16-byte nonce (replay prevention)
 * - issuedAt: ISO timestamp when evidence was created
 * - expiresAt: ISO timestamp when evidence expires
 * - mac: HMAC-SHA256 over canonical evidence (excluding mac field)
 * 
 * @param {object} runnerBinding - Runner binding data
 * @param {string} runnerBinding.runId - Unique run identifier
 * @param {string} runnerBinding.runAttempt - Attempt number
 * @param {string} runnerBinding.containerId - Container ID
 * @param {string} runnerBinding.policyDigest - Policy digest
 * @param {object} options - Optional parameters
 * @param {Date} [options.now] - Current time (for testing)
 * @returns {object} - Authorization evidence with MAC
 */
function generateAuthorizationEvidence(runnerBinding, options = {}) {
  if (!runnerBinding || typeof runnerBinding !== 'object') {
    throw new Error('runnerBinding must be an object');
  }
  
  const required = ['runId', 'runAttempt', 'containerId', 'policyDigest'];
  for (const field of required) {
    if (!runnerBinding[field]) {
      throw new Error(`runnerBinding.${field} is required`);
    }
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(runnerBinding.runId))) throw new Error('runnerBinding.runId has invalid format');
  if (!/^[1-9][0-9]*$/.test(String(runnerBinding.runAttempt))) throw new Error('runnerBinding.runAttempt must be a positive integer');
  if (!/^sha256:[a-f0-9]{64}$/.test(String(runnerBinding.policyDigest))) throw new Error('runnerBinding.policyDigest has invalid format');
  
  const now = options.now || new Date();
  const expiresAt = new Date(now.getTime() + EVIDENCE_VALIDITY_MS);
  
  const evidence = {
    runId: runnerBinding.runId,
    runAttempt: runnerBinding.runAttempt,
    containerId: runnerBinding.containerId,
    policyDigest: runnerBinding.policyDigest,
    nonce: generateNonce(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  
  // Compute MAC over canonical evidence (sorted keys, no mac field)
  const mac = computeEvidenceMAC(evidence, MAC_SECRET_KEY).toString('hex');
  evidence.mac = mac;
  
  return evidence;
}

/**
 * Validate authorization evidence MAC and fields.
 * 
 * Validation checks:
 * 1. Evidence structure is valid
 * 2. MAC signature is valid (constant-time comparison)
 * 3. Evidence has not expired
 * 4. Evidence bindings match expected profile
 * 
 * @param {object} evidence - Authorization evidence to validate
 * @param {object} expectedBinding - Expected runner binding
 * @param {string} expectedBinding.runId - Expected run ID
 * @param {string} expectedBinding.runAttempt - Expected attempt number
 * @param {string} expectedBinding.containerId - Expected container ID
 * @param {string} expectedBinding.policyDigest - Expected policy digest
 * @param {Date} [currentTime] - Current time (for testing)
 * @throws {Error} - If validation fails
 */
function validateAuthorizationEvidence(evidence, expectedBinding, currentTime) {
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('Authorization evidence must be an object');
  }
  
  if (!expectedBinding || typeof expectedBinding !== 'object') {
    throw new Error('Expected runner binding is required');
  }

  const required = ['runId', 'runAttempt', 'containerId', 'policyDigest', 'nonce', 'issuedAt', 'expiresAt', 'mac'];
  for (const field of required) {
    if (!evidence[field]) {
      throw new Error(`Evidence missing required field: ${field}`);
    }
  }
  const extras = Object.keys(evidence).filter(field => !required.includes(field));
  if (extras.length) throw new Error(`Authorization evidence has unexpected fields: ${extras.join(', ')}`);
  if (!/^[a-f0-9]{32}$/.test(evidence.nonce)) throw new Error('Evidence nonce has invalid format');
  if (!/^[a-f0-9]{64}$/.test(evidence.mac)) throw new Error('MAC verification failed: invalid encoding');
  
  // Check expiration
  if (currentTime !== undefined && process.env.NODE_ENV !== 'test') {
    throw new Error('Caller-supplied validation time is forbidden outside tests');
  }
  const now = currentTime || new Date();
  const issuedAt = new Date(evidence.issuedAt);
  const expiresAt = new Date(evidence.expiresAt);
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error('Authorization evidence timestamps are invalid');
  }
  if (issuedAt > now) throw new Error('Authorization evidence was issued in the future');
  if (expiresAt.getTime() - issuedAt.getTime() !== EVIDENCE_VALIDITY_MS) {
    throw new Error('Authorization evidence validity interval is invalid');
  }
  if (now >= expiresAt) {
    throw new Error(
      `Authorization evidence expired at ${evidence.expiresAt}. ` +
      `Current time: ${now.toISOString()}`
    );
  }
  
  // Verify MAC (constant-time comparison)
  const evidenceWithoutMAC = { ...evidence };
  delete evidenceWithoutMAC.mac;
  
  const expectedMAC = computeEvidenceMAC(evidenceWithoutMAC, MAC_SECRET_KEY);
  const providedMAC = Buffer.from(evidence.mac, 'hex');
  
  if (expectedMAC.length !== providedMAC.length) {
    throw new Error('MAC verification failed: length mismatch');
  }
  
  if (!crypto.timingSafeEqual(expectedMAC, providedMAC)) {
    throw new Error(
      'MAC verification failed. Evidence may be forged or tampered. ' +
      'AUTH-FORG-01 protection: Only runner-signed evidence is accepted.'
    );
  }
  
  // Verify bindings match expected profile
  if (evidence.runId !== expectedBinding.runId) {
    throw new Error(
      `Evidence runId mismatch. Expected: ${expectedBinding.runId}, Got: ${evidence.runId}`
    );
  }
  
  if (evidence.runAttempt !== expectedBinding.runAttempt) {
    throw new Error(
      `Evidence runAttempt mismatch. Expected: ${expectedBinding.runAttempt}, Got: ${evidence.runAttempt}`
    );
  }
  
  if (evidence.containerId !== expectedBinding.containerId) {
    throw new Error(
      `Evidence containerId mismatch. Expected: ${expectedBinding.containerId}, Got: ${evidence.containerId}`
    );
  }
  
  if (evidence.policyDigest !== expectedBinding.policyDigest) {
    throw new Error(
      `Evidence policyDigest mismatch. Expected: ${expectedBinding.policyDigest}, Got: ${evidence.policyDigest}`
    );
  }

  if (CONSUMED_NONCES.has(evidence.nonce)) {
    throw new Error('Authorization evidence replay detected: nonce already consumed');
  }
  CONSUMED_NONCES.add(evidence.nonce);
  return true;
}

/**
 * Compute HMAC-SHA256 over canonical evidence representation.
 * 
 * Canonical representation:
 * - Sort object keys alphabetically
 * - JSON.stringify with no whitespace
 * - Exclude 'mac' field from signing input
 * 
 * @private
 * @param {object} evidence - Evidence object (without mac field)
 * @param {Buffer} key - HMAC secret key
 * @returns {Buffer} - HMAC-SHA256 digest
 */
function computeEvidenceMAC(evidence, key) {
  // Deterministic serialization: sorted keys
  const canonical = canonicalizeJSON(evidence);
  
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(canonical);
  return hmac.digest();
}

/**
 * Canonicalize JSON for deterministic serialization.
 * 
 * @private
 * @param {object} obj - Object to canonicalize
 * @returns {string} - Canonical JSON string
 */
function canonicalizeJSON(obj) {
  // Sort keys alphabetically
  const sorted = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

/**
 * Generate cryptographically random nonce (16 bytes).
 * 
 * @returns {string} - Hex-encoded nonce
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Reset MAC secret key (for testing only).
 * 
 * WARNING: This function is ONLY for testing. Do NOT use in production.
 * In production, the MAC key should be generated once and never reset.
 * 
 * @private
 * @param {Buffer} [newKey] - New key to use (or generate random if not provided)
 */
function _resetMACKeyForTesting(newKey) {
  MAC_SECRET_KEY = newKey || crypto.randomBytes(32);
  CONSUMED_NONCES = new Set();
}

const exported = {
  validateAuthorizationEvidence,
  generateNonce,
};
if (process.env.NODE_ENV === 'test') {
  exported.generateAuthorizationEvidence = generateAuthorizationEvidence;
  exported._resetMACKeyForTesting = _resetMACKeyForTesting;
}
module.exports = exported;
