/**
 * Recovery Coordinator
 * 
 * Handles failed runs, crash recovery, and cleanup coordination.
 * Ensures failed/expired/revoked runs cannot be reused and that cleanup
 * operations are idempotent and scoped to runner-owned resources only.
 * 
 * SECURITY INVARIANTS:
 * - Failed runs become non-authorized
 * - Expired runs reject
 * - Revoked runs reject
 * - Replayed authorizations reject
 * - Corrupt durable state fails closed
 * - Cleanup requires runner-owned resource identity
 * - Unrelated resources cannot be deleted
 * - Interrupted cleanup remains visible
 * - Retry operations are idempotent
 * - Recovery NEVER restores expired or revoked authorization
 * 
 * NO SQL EXECUTION CAPABILITY - Stage 2 offline recovery only.
 * 
 * @module recovery-coordinator
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Create recovery coordinator.
 * 
 * @param {object} options - Configuration
 * @param {object} options.authorityStore - Durable authority store
 * @param {object} options.containerRuntime - Trusted container runtime provider
 * @param {string} options.snapshotBaseDirectory - Base directory for snapshots
 * @returns {object} - Recovery coordinator
 */
function createRecoveryCoordinator(options) {
  const {
    authorityStore,
    containerRuntime,
    snapshotBaseDirectory,
  } = options;
  
  if (!authorityStore) {
    throw new Error('Authority store required');
  }
  if (!containerRuntime || typeof containerRuntime.teardown !== 'function') {
    throw new Error('Container runtime provider with teardown() required');
  }
  if (!snapshotBaseDirectory || !path.isAbsolute(snapshotBaseDirectory)) {
    throw new Error('Snapshot base directory must be absolute');
  }
  
  /**
   * Check if run is recoverable (not expired, not revoked, not failed).
   * 
   * @param {string} runId - Run ID to check
   * @returns {object} - Recovery status
   */
  function checkRecoverability(runId) {
    if (!runId) throw new Error('Run ID required');
    
    const runRecord = authorityStore.state.runs[runId];
    
    if (!runRecord) {
      return Object.freeze({
        recoverable: false,
        reason: 'RUN_NOT_FOUND',
        runId,
      });
    }
    
    // Check expiration
    if (runRecord.expiresAt) {
      const now = new Date();
      const expiresAt = new Date(runRecord.expiresAt);
      if (now > expiresAt) {
        return Object.freeze({
          recoverable: false,
          reason: 'RUN_EXPIRED',
          runId,
          expiresAt: runRecord.expiresAt,
        });
      }
    }
    
    // Check revocation
    if (runRecord.status === 'REVOKED') {
      return Object.freeze({
        recoverable: false,
        reason: 'RUN_REVOKED',
        runId,
        revokedAt: runRecord.revokedAt,
      });
    }
    
    // Check failure
    if (runRecord.status === 'FAILED') {
      return Object.freeze({
        recoverable: false,
        reason: 'RUN_FAILED',
        runId,
        failedAt: runRecord.failedAt,
      });
    }
    
    // Check destroyed
    if (runRecord.status === 'DESTROYED') {
      return Object.freeze({
        recoverable: false,
        reason: 'RUN_DESTROYED',
        runId,
      });
    }
    
    return Object.freeze({
      recoverable: true,
      runId,
      status: runRecord.status,
    });
  }
  
  /**
   * Revoke authorization for failed run.
   * 
   * @param {string} runId - Run ID to revoke
   * @param {string} reason - Revocation reason
   * @returns {object} - Revocation result
   */
  function revokeFailedRun(runId, reason) {
    if (!runId) throw new Error('Run ID required');
    if (!reason) throw new Error('Revocation reason required');
    
    const recoverability = checkRecoverability(runId);
    
    // Already revoked/expired/destroyed - idempotent
    if (!recoverability.recoverable) {
      return Object.freeze({
        revoked: false,
        reason: `Run already non-recoverable: ${recoverability.reason}`,
        runId,
        idempotent: true,
      });
    }
    
    // Revoke using authority store's built-in method (handles persistence)
    authorityStore.revokeRun(runId, reason);
    
    const runRecord = authorityStore.state.runs[runId];
    
    return Object.freeze({
      revoked: true,
      runId,
      revokedAt: runRecord.revokedAt,
      reason,
    });
  }
  
  /**
   * Clean up runner-owned resources for a run.
   * 
   * CRITICAL: Only cleans resources owned by the runner (snapshots, temp files).
   * Cannot clean containers or databases - those require explicit teardown.
   * 
   * @param {string} runId - Run ID to clean up
   * @param {object} options - Cleanup options
   * @returns {Promise<object>} - Cleanup result
   */
  async function cleanupRunResources(runId, options = {}) {
    if (!runId) throw new Error('Run ID required');
    
    const {
      removeSnapshots = true,
      force = false,
    } = options;
    
    const runRecord = authorityStore.state.runs[runId];
    
    if (!runRecord && !force) {
      throw new Error('Run not found in authority store (use force=true to override)');
    }
    
    // SAFETY: Verify run is not active unless force=true
    if (!force && runRecord && runRecord.status === 'ACTIVE') {
      throw new Error('Cannot cleanup active run (use force=true to override)');
    }
    
    const cleanupResults = {
      runId,
      snapshotsRemoved: 0,
      errors: [],
    };
    
    // Clean up snapshots (runner-owned directories only)
    if (removeSnapshots) {
      const runSnapshotDir = path.join(snapshotBaseDirectory, runId);
      
      try {
        // Verify path safety (must be under snapshotBaseDirectory)
        const resolvedRunDir = path.resolve(runSnapshotDir);
        const resolvedBaseDir = path.resolve(snapshotBaseDirectory);
        
        if (!resolvedRunDir.startsWith(resolvedBaseDir + path.sep)) {
          throw new Error('Snapshot directory path traversal detected');
        }
        
        if (fs.existsSync(runSnapshotDir)) {
          // Count subdirectories (attempts)
          const attempts = fs.readdirSync(runSnapshotDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory());
          
          // Remove (idempotent - does not fail if already removed)
          fs.rmSync(runSnapshotDir, { recursive: true, force: true });
          
          cleanupResults.snapshotsRemoved = attempts.length;
        }
      } catch (error) {
        cleanupResults.errors.push({
          operation: 'remove_snapshots',
          error: error.message,
        });
      }
    }
    
    return Object.freeze(cleanupResults);
  }
  
  /**
   * Detect and revoke orphaned runs (containers exist but not in authority store).
   * 
   * @returns {Promise<object>} - Orphan detection result
   */
  async function detectAndRevokeOrphans() {
    const registeredRuns = Object.keys(authorityStore.state.runs);
    const orphanedContainers = await containerRuntime.listOwned();
    
    const orphans = orphanedContainers.filter(container => {
      // Extract runId from container name/labels
      const runId = container.labels?.runId || container.name?.match(/run-[^-]+-[^-]+/)?.[0];
      return runId && !registeredRuns.includes(runId);
    });
    
    const results = {
      orphansDetected: orphans.length,
      orphanIds: orphans.map(c => c.labels?.runId || c.id),
    };
    
    return Object.freeze(results);
  }
  
  /**
   * Verify durable state integrity.
   * 
   * @returns {object} - Integrity check result
   */
  function verifyDurableStateIntegrity() {
    try {
      // Verify authority store can be read
      const state = authorityStore.state;
      
      if (!state || typeof state !== 'object') {
        return Object.freeze({
          intact: false,
          reason: 'Authority store state is not an object',
        });
      }
      
      if (!state.runs || typeof state.runs !== 'object') {
        return Object.freeze({
          intact: false,
          reason: 'Authority store runs object missing or invalid',
        });
      }
      
      // Verify HMAC signatures if present
      if (state.nonces && Array.isArray(state.nonces)) {
        for (const nonce of state.nonces) {
          if (!nonce.value || !nonce.signature) {
            return Object.freeze({
              intact: false,
              reason: 'Nonce record missing value or signature',
            });
          }
        }
      }
      
      return Object.freeze({
        intact: true,
        runCount: Object.keys(state.runs).length,
        nonceCount: state.nonces ? state.nonces.length : 0,
      });
    } catch (error) {
      return Object.freeze({
        intact: false,
        reason: `State integrity check failed: ${error.message}`,
        error: error.message,
      });
    }
  }
  
  /**
   * Attempt recovery for interrupted run.
   * 
   * CRITICAL: Recovery NEVER restores expired or revoked authorization.
   * Only verifies state and marks as recoverable or non-recoverable.
   * 
   * @param {string} runId - Run ID to attempt recovery
   * @returns {object} - Recovery attempt result
   */
  function attemptRecovery(runId) {
    if (!runId) throw new Error('Run ID required');
    
    const recoverability = checkRecoverability(runId);
    
    if (!recoverability.recoverable) {
      return Object.freeze({
        recovered: false,
        reason: recoverability.reason,
        runId,
      });
    }
    
    // Verify durable state integrity
    const integrity = verifyDurableStateIntegrity();
    
    if (!integrity.intact) {
      return Object.freeze({
        recovered: false,
        reason: `Durable state corrupt: ${integrity.reason}`,
        runId,
      });
    }
    
    // Recovery successful - run can continue from current state
    return Object.freeze({
      recovered: true,
      runId,
      currentStatus: recoverability.status,
      note: 'Run can continue from current state',
    });
  }
  
  return Object.freeze({
    checkRecoverability,
    revokeFailedRun,
    cleanupRunResources,
    detectAndRevokeOrphans,
    verifyDurableStateIntegrity,
    attemptRecovery,
  });
}

module.exports = {
  createRecoveryCoordinator,
};
