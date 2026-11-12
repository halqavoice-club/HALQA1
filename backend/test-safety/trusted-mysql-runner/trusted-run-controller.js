/**
 * Trusted Run Controller
 * 
 * Coordinates trusted runtime adapter, durable authority store, immutable artifact snapshot,
 * and state machine for fail-closed offline MySQL runner lifecycle.
 * 
 * RESPONSIBILITIES:
 * - Generate runner-owned runId and attemptId
 * - Bind canonical Unit B-6 artifact-set identity
 * - Establish immutable per-run policy
 * - Coordinate lifecycle transitions through state machine
 * - Obtain observations only through trusted provider interfaces
 * - Reject invalid or stale observations
 * - Integrate HMAC-protected durable authorization
 * - Integrate verified artifact snapshots
 * - Reject unauthorized caller requests
 * - Trigger recovery and cleanup on failure
 * 
 * NO SQL EXECUTION CAPABILITY - Stage 2 offline verification only.
 * 
 * @module trusted-run-controller
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { STATES, transitionTo, isTerminalState } = require('./state-machine');
const { createTrustedRuntimeAdapter, ARTIFACT_SET_ID } = require('./runtime-adapter');
const { DurableAuthorityStore } = require('./durable-authority-store');
const { createImmutableArtifactSnapshot } = require('./immutable-artifact-snapshot');
const { verifyArtifactSet } = require('./artifact-integrity');

/**
 * Generate runner-owned run identity.
 * 
 * @param {string} [prefix='run'] - Run ID prefix
 * @returns {string} - Unique run ID
 */
function generateRunId(prefix = 'run') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate attempt identity within a run.
 * 
 * @param {string} runId - Parent run ID
 * @param {number} attemptNumber - Attempt sequence number (1-based)
 * @returns {string} - Unique attempt ID
 */
function generateAttemptId(runId, attemptNumber = 1) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error('Invalid run ID');
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 999) {
    throw new Error('Attempt number must be integer 1-999');
  }
  return `${runId}-attempt-${attemptNumber.toString().padStart(3, '0')}`;
}

/**
 * Validate run policy is immutable and bound to canonical artifacts.
 * 
 * @param {object} policy - Run policy
 * @throws {Error} - If policy is invalid or not bound to Unit B-6
 */
function validateRunPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new Error('Run policy required');
  if (policy.artifactSetIdentity !== ARTIFACT_SET_ID) {
    throw new Error(`Run policy must bind canonical Unit B-6 artifact-set: ${ARTIFACT_SET_ID}`);
  }
  if (!Object.isFrozen(policy)) throw new Error('Run policy must be immutable (frozen)');
}

/**
 * Create trusted run controller.
 * 
 * Coordinates all Stage 2 components for offline runner lifecycle verification.
 * 
 * @param {object} options - Configuration
 * @param {object} options.containerRuntime - Trusted container runtime provider (inspect, listOwned, teardown)
 * @param {object} options.mysqlObserver - Trusted MySQL observation provider (observe)
 * @param {string} options.authorityStorePath - Absolute path to durable authority store
 * @param {Buffer} options.authorityKey - HMAC key for durable authority (32+ bytes)
 * @param {string} options.artifactSourceDirectory - Canonical artifact source directory
 * @param {string} options.snapshotBaseDirectory - Base directory for immutable snapshots
 * @returns {object} - Trusted run controller
 */
function createTrustedRunController(options) {
  const {
    containerRuntime,
    mysqlObserver,
    authorityStorePath,
    authorityKey,
    artifactSourceDirectory,
    snapshotBaseDirectory,
  } = options;
  
  // Validate required providers
  if (!containerRuntime || typeof containerRuntime.inspect !== 'function') {
    throw new Error('Container runtime provider must implement inspect()');
  }
  if (!mysqlObserver || typeof mysqlObserver.observe !== 'function') {
    throw new Error('MySQL observer provider must implement observe()');
  }
  if (!authorityStorePath || !path.isAbsolute(authorityStorePath)) {
    throw new Error('Authority store path must be absolute');
  }
  if (!Buffer.isBuffer(authorityKey) || authorityKey.length < 32) {
    throw new Error('Authority key must be Buffer of 32+ bytes');
  }
  if (!artifactSourceDirectory || !path.isAbsolute(artifactSourceDirectory)) {
    throw new Error('Artifact source directory must be absolute');
  }
  if (!snapshotBaseDirectory || !path.isAbsolute(snapshotBaseDirectory)) {
    throw new Error('Snapshot base directory must be absolute');
  }
  
  // Initialize or open durable authority store
  let authorityStore;
  const fs = require('fs');
  if (fs.existsSync(authorityStorePath)) {
    authorityStore = DurableAuthorityStore.open(authorityStorePath, authorityKey);
  } else {
    authorityStore = DurableAuthorityStore.initialize(authorityStorePath, authorityKey);
  }
  
  // Create runtime adapter
  const adapter = createTrustedRuntimeAdapter({
    containerRuntime,
    mysqlObserver,
    authorityStore,
    authorityKey,
    runId: '__CONTROLLER_INIT__', // Placeholder, replaced per-run
  });
  
  /**
   * Initialize a new run.
   * 
   * @param {object} provisioningRecord - Container provisioning record
   * @param {object} [policyOverrides] - Policy overrides (must still bind canonical artifacts)
   * @returns {Promise<object>} - Run context
   */
  async function initializeRun(provisioningRecord, policyOverrides = {}) {
    const runId = generateRunId();
    const attemptId = generateAttemptId(runId, 1);
    
    // Create immutable run policy (bound to Unit B-6)
    const policy = Object.freeze({
      artifactSetIdentity: ARTIFACT_SET_ID,
      maxAttempts: policyOverrides.maxAttempts || 3,
      timeoutSeconds: policyOverrides.timeoutSeconds || 3600,
      ...policyOverrides,
    });
    
    validateRunPolicy(policy);
    
    // Initialize state machine (transition CREATED -> PROVISIONING)
    const initialTimestamp = new Date().toISOString();
    const provisioningTransition = transitionTo(STATES.CREATED, STATES.PROVISIONING, { reason: 'controller-init' });
    
    const context = Object.freeze({
      runId,
      attemptId,
      policy,
      state: STATES.PROVISIONING,
      stateHistory: Object.freeze([
        Object.freeze({ state: STATES.CREATED, timestamp: initialTimestamp, trigger: 'init' }),
        Object.freeze({ state: STATES.PROVISIONING, timestamp: provisioningTransition.timestamp, trigger: 'controller-init' }),
      ]),
      provisioningRecord,
      verified: null,
      snapshot: null,
    });
    
    return context;
  }
  
  /**
   * Attest runtime identity and verify against provisioning record.
   * 
   * @param {object} context - Run context from initializeRun()
   * @returns {Promise<object>} - Updated context with verified identity
   */
  async function attestIdentity(context) {
    if (context.state !== STATES.PROVISIONING) {
      throw new Error(`Cannot attest identity in state ${context.state}`);
    }
    
    // Transition PROVISIONING -> IDENTITY_PENDING
    const pendingTransition = transitionTo(context.state, STATES.IDENTITY_PENDING, { reason: 'attest-start' });
    
    // Create per-run adapter with correct runId
    const runAdapter = createTrustedRuntimeAdapter({
      containerRuntime,
      mysqlObserver,
      authorityStore,
      authorityKey,
      runId: context.runId,
    });
    
    // Attest identity through trusted adapter
    const verified = await runAdapter.attest(context.provisioningRecord);
    
    // Transition IDENTITY_PENDING -> IDENTITY_VERIFIED
    const verifiedTransition = transitionTo(STATES.IDENTITY_PENDING, STATES.IDENTITY_VERIFIED, { reason: 'attest-complete' });
    
    return Object.freeze({
      ...context,
      state: STATES.IDENTITY_VERIFIED,
      stateHistory: Object.freeze([
        ...context.stateHistory,
        Object.freeze({ state: STATES.IDENTITY_PENDING, timestamp: pendingTransition.timestamp, trigger: 'attest-start' }),
        Object.freeze({ state: STATES.IDENTITY_VERIFIED, timestamp: verifiedTransition.timestamp, trigger: 'attest-complete' }),
      ]),
      adapter: runAdapter,
      verified,
    });
  }
  
  /**
   * Create immutable artifact snapshot bound to verified run.
   * 
   * @param {object} context - Run context with verified identity
   * @returns {Promise<object>} - Updated context with artifact snapshot
   */
  async function snapshotArtifacts(context) {
    if (context.state !== STATES.IDENTITY_VERIFIED && context.state !== STATES.ACCOUNTS_PENDING) {
      throw new Error(`Cannot snapshot artifacts in state ${context.state}`);
    }
    
    if (!context.verified || !context.verified.identityDigest) {
      throw new Error('Identity must be verified before snapshotting artifacts');
    }
    
    // Verify artifacts at source before snapshot
    const sourceVerification = verifyArtifactSet(artifactSourceDirectory);
    
    if (sourceVerification.artifactSetIdentity !== ARTIFACT_SET_ID) {
      throw new Error('Source artifact-set identity does not match canonical Unit B-6');
    }
    
    // Create immutable snapshot (runner-owned directory)
    const snapshotDirectory = path.join(
      snapshotBaseDirectory,
      context.runId,
      context.attemptId
    );
    
    const snapshot = createImmutableArtifactSnapshot(
      artifactSourceDirectory,
      snapshotDirectory
    );
    
    if (snapshot.artifactSetIdentity !== ARTIFACT_SET_ID) {
      throw new Error('Snapshot artifact-set identity verification failed');
    }
    
    return Object.freeze({
      ...context,
      snapshot,
    });
  }
  
  /**
   * Teardown run and revoke authorization.
   * 
   * @param {object} context - Run context
   * @param {string} [reason='explicit'] - Teardown reason
   * @returns {Promise<object>} - Final context
   */
  async function teardownRun(context, reason = 'explicit') {
    if (context.state === STATES.DESTROYED) {
      throw new Error('Run already destroyed');
    }
    
    let newState = context.state;
    let newHistory = [...context.stateHistory];
    
    // Transition to TEARDOWN_PENDING
    if (context.state === STATES.SERVICE_READY) {
      const teardownTransition = transitionTo(context.state, STATES.TEARDOWN_PENDING, { reason });
      newState = STATES.TEARDOWN_PENDING;
      newHistory.push(Object.freeze({ state: STATES.TEARDOWN_PENDING, timestamp: teardownTransition.timestamp, trigger: reason }));
    } else if (context.state !== STATES.REJECTED && context.state !== STATES.TEARDOWN_PENDING) {
      const rejectTransition = transitionTo(context.state, STATES.REJECTED, { reason });
      newHistory.push(Object.freeze({ state: STATES.REJECTED, timestamp: rejectTransition.timestamp, trigger: reason }));
      
      const teardownTransition = transitionTo(STATES.REJECTED, STATES.TEARDOWN_PENDING, { reason: 'cleanup-after-rejection' });
      newState = STATES.TEARDOWN_PENDING;
      newHistory.push(Object.freeze({ state: STATES.TEARDOWN_PENDING, timestamp: teardownTransition.timestamp, trigger: 'cleanup-after-rejection' }));
    }
    
    // Revoke authorization in durable store
    if (context.adapter) {
      await context.adapter.teardown(context.provisioningRecord);
    }
    
    // Transition to DESTROYED
    const destroyedTransition = transitionTo(newState, STATES.DESTROYED, { reason: 'teardown-complete' });
    newHistory.push(Object.freeze({ state: STATES.DESTROYED, timestamp: destroyedTransition.timestamp, trigger: 'teardown-complete' }));
    
    return Object.freeze({
      ...context,
      state: STATES.DESTROYED,
      stateHistory: Object.freeze(newHistory),
      destroyedAt: destroyedTransition.timestamp,
      destroyReason: reason,
    });
  }
  
  /**
   * Detect orphaned containers not associated with active runs.
   * 
   * @returns {Promise<Array>} - Orphaned container records
   */
  async function detectOrphans() {
    // Get all registered runs from authority store
    const registeredRuns = Object.keys(authorityStore.state.runs)
      .filter(runId => authorityStore.state.runs[runId].status === 'ACTIVE');
    
    return await adapter.detectOrphans(registeredRuns);
  }
  
  return Object.freeze({
    generateRunId,
    generateAttemptId,
    initializeRun,
    attestIdentity,
    snapshotArtifacts,
    teardownRun,
    detectOrphans,
    authorityStore,
  });
}

module.exports = {
  generateRunId,
  generateAttemptId,
  validateRunPolicy,
  createTrustedRunController,
  ARTIFACT_SET_ID,
};
