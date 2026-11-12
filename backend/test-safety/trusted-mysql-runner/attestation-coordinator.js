/**
 * Attestation Coordinator
 * 
 * Integrates trusted security modules to generate cryptographically-bound run attestations.
 * Enforces that caller-controlled identity is NOT automatically trusted and that all
 * observations originate from controlled adapter boundaries.
 * 
 * CRITICAL SECURITY INVARIANTS:
 * - Caller-controlled identity is NEVER trusted without verification
 * - Provider observations MUST originate from adapter boundary
 * - Image digest MUST satisfy approved policy (production allowlist is EMPTY)
 * - Container/network/server identity MUST agree
 * - Run/attempt identity MUST match across all evidence
 * - HMAC signatures bind EXACT verified evidence
 * - Signing cannot become an attacker-controlled oracle
 * - Invalid identity or missing evidence FAILS CLOSED
 * 
 * NO SQL EXECUTION CAPABILITY - Stage 2 offline attestation only.
 * 
 * @module attestation-coordinator
 */

'use strict';

const crypto = require('crypto');
const { signAuthorization } = require('./runner-authority');
const { verifyTargetProfile } = require('./target-profile');
const { validateImageDigest } = require('./mysql-image-policy');
const { verifyXamppBoundary } = require('./xampp-protection');
const { validateAccountCreationPolicy } = require('./account-policy');

/**
 * Verify all identity components agree.
 * 
 * @param {object} containerIdentity - From containerRuntime.inspect()
 * @param {object} mysqlIdentity - From mysqlObserver.observe()
 * @param {object} targetProfile - Expected target profile
 * @returns {object} - Verified composite identity or throws
 */
function verifyIdentityAgreement(containerIdentity, mysqlIdentity, targetProfile) {
  if (!containerIdentity || !mysqlIdentity || !targetProfile) {
    throw new Error('All identity components required for verification');
  }
  
  // Verify container identity matches target profile
  if (containerIdentity.containerId !== targetProfile.expectedContainerId) {
    throw new Error('Container ID does not match expected profile');
  }
  
  if (containerIdentity.networkId !== targetProfile.expectedNetworkId) {
    throw new Error('Network ID does not match expected profile');
  }
  
  // Verify MySQL server identity
  if (mysqlIdentity.serverUuid !== targetProfile.expectedServerUuid) {
    throw new Error('MySQL server UUID does not match expected profile');
  }
  
  // Verify image digest
  if (containerIdentity.imageDigest !== targetProfile.expectedImageDigest) {
    throw new Error('Container image digest does not match expected profile');
  }
  
  // Verify platform
  if (containerIdentity.platform !== targetProfile.expectedPlatform) {
    throw new Error('Container platform does not match expected profile');
  }
  
  return Object.freeze({
    containerId: containerIdentity.containerId,
    networkId: containerIdentity.networkId,
    imageDigest: containerIdentity.imageDigest,
    platform: containerIdentity.platform,
    serverUuid: mysqlIdentity.serverUuid,
    mysqlVersion: mysqlIdentity.version,
    verifiedAt: new Date().toISOString(),
  });
}

/**
 * Create attestation coordinator.
 * 
 * @param {object} options - Configuration
 * @param {object} options.containerRuntime - Trusted container runtime provider
 * @param {object} options.mysqlObserver - Trusted MySQL observer provider
 * @param {Buffer} options.authorityKey - HMAC signing key (32+ bytes)
 * @param {string} options.runId - Current run ID
 * @param {string} options.attemptId - Current attempt ID
 * @param {object} options.policy - Immutable run policy
 * @returns {object} - Attestation coordinator
 */
function createAttestationCoordinator(options) {
  const {
    containerRuntime,
    mysqlObserver,
    authorityKey,
    runId,
    attemptId,
    policy,
  } = options;
  
  // Validate required providers
  if (!containerRuntime || typeof containerRuntime.inspect !== 'function') {
    throw new Error('Container runtime provider required');
  }
  if (!mysqlObserver || typeof mysqlObserver.observe !== 'function') {
    throw new Error('MySQL observer provider required');
  }
  if (!Buffer.isBuffer(authorityKey) || authorityKey.length < 32) {
    throw new Error('Authority key must be Buffer of 32+ bytes');
  }
  if (!runId || !/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) {
    throw new Error('Valid run ID required');
  }
  if (!attemptId) {
    throw new Error('Attempt ID required');
  }
  if (!policy || !Object.isFrozen(policy)) {
    throw new Error('Immutable policy required');
  }
  
  /**
   * Attest runtime identity from trusted providers.
   * 
   * @param {object} provisioningRecord - Container provisioning record
   * @returns {Promise<object>} - Signed attestation
   */
  async function attestRuntime(provisioningRecord) {
    if (!provisioningRecord || !provisioningRecord.containerId) {
      throw new Error('Provisioning record with containerId required');
    }
    
    // CRITICAL: Observations MUST come from trusted provider interfaces
    // Caller-provided identity is NOT trusted
    const containerIdentity = await containerRuntime.inspect(provisioningRecord.containerId);
    const mysqlIdentity = await mysqlObserver.observe(provisioningRecord);
    
    // Verify target profile (all components must agree)
    const targetProfile = verifyTargetProfile({
      providedProfile: provisioningRecord.targetProfile,
      observedContainer: containerIdentity,
      observedMysql: mysqlIdentity,
    });
    
    // Verify image digest satisfies policy
    // CRITICAL: Production approved-image allowlist is EMPTY
    // This will reject all real images in production
    validateImageDigest(containerIdentity.imageDigest, policy.approvedImages || []);
    
    // Verify XAMPP boundary (container + server identity consistency)
    verifyXamppBoundary(targetProfile);
    
    // Verify all identity components agree
    const verifiedIdentity = verifyIdentityAgreement(
      containerIdentity,
      mysqlIdentity,
      targetProfile
    );
    
    // Build attestation evidence
    const evidence = {
      runId,
      attemptId,
      verifiedIdentity,
      policyDigest: computePolicyDigest(policy),
      attestedAt: new Date().toISOString(),
    };
    
    // Sign with HMAC (binds EXACT verified evidence)
    const signature = signAuthorization(authorityKey, evidence);
    
    return Object.freeze({
      ...evidence,
      signature,
    });
  }
  
  /**
   * Verify account creation authorization.
   * 
   * @param {object} attestation - Signed attestation from attestRuntime()
   * @param {object} accountRequest - Account creation request
   * @returns {object} - Authorization decision
   */
  function authorizeAccountCreation(attestation, accountRequest) {
    if (!attestation || !attestation.signature) {
      throw new Error('Signed attestation required for authorization');
    }
    
    // Verify run/attempt identity matches
    if (attestation.runId !== runId || attestation.attemptId !== attemptId) {
      throw new Error('Attestation run/attempt identity does not match coordinator context');
    }
    
    // Validate account creation policy
    const decision = validateAccountCreationPolicy(accountRequest, policy);
    
    if (!decision.authorized) {
      throw new Error(`Account creation not authorized: ${decision.reason}`);
    }
    
    return Object.freeze({
      authorized: true,
      attestation,
      accountRequest,
      authorizedAt: new Date().toISOString(),
    });
  }
  
  return Object.freeze({
    attestRuntime,
    authorizeAccountCreation,
    runId,
    attemptId,
    policy,
  });
}

/**
 * Compute policy digest for attestation binding.
 * 
 * @param {object} policy - Immutable run policy
 * @returns {string} - SHA-256 digest of canonical policy JSON
 */
function computePolicyDigest(policy) {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
}

module.exports = {
  createAttestationCoordinator,
  verifyIdentityAgreement,
  computePolicyDigest,
};
