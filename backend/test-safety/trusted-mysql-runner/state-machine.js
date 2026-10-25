/**
 * Fail-Closed State Machine
 * 
 * Implements fail-closed pure state-transition logic for trusted MySQL runner lifecycle.
 * 
 * LIFECYCLE STATES (8 states + 1 terminal rejection state):
 * 1. CREATED - Initial state after runner instantiation
 * 2. PROVISIONING - Docker container provisioning in progress
 * 3. IDENTITY_PENDING - Waiting for service identity attestation
 * 4. IDENTITY_VERIFIED - Service identity verified (serverUuid, containerId, etc.)
 * 5. ACCOUNTS_PENDING - MySQL accounts being created
 * 6. ACCOUNTS_VERIFIED - Account privileges verified
 * 7. SERVICE_READY - Service ready for use
 * 8. TEARDOWN_PENDING - Teardown in progress
 * 9. DESTROYED - Service destroyed and cleaned up
 * 10. REJECTED - Terminal failure state (fail-closed)
 * 
 * C-1B STAGE 1 RESTRICTION:
 * - NO enabled SQL execution state in Stage 1
 * - State machine ends at SERVICE_READY
 * - Baseline loading states (BASELINE_LOADING, RE_VERIFYING, BASELINE_COMPLETE) are C-2 scope
 * 
 * FAIL-CLOSED BEHAVIOR:
 * - No unexpected transitions allowed
 * - No caller-created VERIFIED state
 * - No reuse of expired authorization
 * - Any identity/image/artifact/privilege mismatch causes REJECTED
 * - No authorization carryover between attempts
 * - Terminal failure does not permit execution
 * 
 * @module state-machine
 */

'use strict';

/**
 * Runner lifecycle states.
 * 
 * @constant {object}
 */
const STATES = Object.freeze({
  CREATED: 'CREATED',
  PROVISIONING: 'PROVISIONING',
  IDENTITY_PENDING: 'IDENTITY_PENDING',
  IDENTITY_VERIFIED: 'IDENTITY_VERIFIED',
  ACCOUNTS_PENDING: 'ACCOUNTS_PENDING',
  ACCOUNTS_VERIFIED: 'ACCOUNTS_VERIFIED',
  SERVICE_READY: 'SERVICE_READY',
  TEARDOWN_PENDING: 'TEARDOWN_PENDING',
  DESTROYED: 'DESTROYED',
  REJECTED: 'REJECTED', // Terminal failure state
});

/**
 * Valid state transitions (fail-closed).
 * 
 * @constant {Map<string, Set<string>>}
 */
const VALID_TRANSITIONS = new Map([
  [STATES.CREATED, new Set([STATES.PROVISIONING, STATES.REJECTED])],
  [STATES.PROVISIONING, new Set([STATES.IDENTITY_PENDING, STATES.REJECTED])],
  [STATES.IDENTITY_PENDING, new Set([STATES.IDENTITY_VERIFIED, STATES.REJECTED])],
  [STATES.IDENTITY_VERIFIED, new Set([STATES.ACCOUNTS_PENDING, STATES.REJECTED])],
  [STATES.ACCOUNTS_PENDING, new Set([STATES.ACCOUNTS_VERIFIED, STATES.REJECTED])],
  [STATES.ACCOUNTS_VERIFIED, new Set([STATES.SERVICE_READY, STATES.REJECTED])],
  [STATES.SERVICE_READY, new Set([STATES.TEARDOWN_PENDING, STATES.REJECTED])],
  [STATES.TEARDOWN_PENDING, new Set([STATES.DESTROYED, STATES.REJECTED])],
  [STATES.DESTROYED, new Set()], // Terminal state (success path)
  [STATES.REJECTED, new Set([STATES.DESTROYED])], // Terminal state (failure path), can only transition to cleanup
]);

/**
 * Terminal states (no further transitions except cleanup).
 * 
 * @constant {Set<string>}
 */
const TERMINAL_STATES = new Set([STATES.DESTROYED, STATES.REJECTED]);

/**
 * Transition to a new state with validation.
 * 
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @param {object} [trigger] - Transition trigger metadata
 * @returns {object} - Transition result {success, fromState, toState, timestamp}
 * @throws {Error} - If transition is invalid
 */
function transitionTo(fromState, toState, trigger = {}) {
  if (!fromState || !toState) {
    throw new Error('fromState and toState are required');
  }
  
  if (!STATES[fromState]) {
    throw new Error(`Invalid fromState: ${fromState}`);
  }
  
  if (!STATES[toState]) {
    throw new Error(`Invalid toState: ${toState}`);
  }
  
  // Validate transition
  validateTransition(fromState, toState);
  
  return {
    success: true,
    fromState,
    toState,
    timestamp: new Date().toISOString(),
    trigger: trigger.reason || 'explicit',
  };
}

/**
 * Validate a state transition.
 * 
 * @param {string} from - Current state
 * @param {string} to - Target state
 * @throws {Error} - If transition is invalid
 */
function validateTransition(from, to) {
  const allowedTransitions = VALID_TRANSITIONS.get(from);
  
  if (!allowedTransitions) {
    throw new Error(
      `Invalid current state: ${from}. Cannot transition from this state.`
    );
  }
  
  if (!allowedTransitions.has(to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. ` +
      `Valid transitions from ${from}: ${Array.from(allowedTransitions).join(', ')}. ` +
      `Fail-closed behavior: No unexpected transitions allowed.`
    );
  }
}

/**
 * Check if a state is terminal.
 * 
 * @param {string} state - State to check
 * @returns {boolean} - True if terminal
 */
function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if SQL execution is allowed in current state.
 * 
 * C-1B STAGE 1 RESTRICTION:
 * - NO enabled SQL execution state in Stage 1
 * - Always returns false
 * - C-2 will add states: BASELINE_LOADING, RE_VERIFYING, BASELINE_COMPLETE
 * 
 * @param {string} state - Current state
 * @returns {boolean} - True if SQL execution allowed (always false in C-1B Stage 1)
 */
function canExecuteSQL(state) {
  // C-1B Stage 1: NO SQL execution permitted
  // Future C-2 states will enable this for BASELINE_LOADING and later states
  return false;
}

/**
 * Reject invalid transition with detailed error.
 * 
 * @param {string} from - Current state
 * @param {string} to - Attempted target state
 * @throws {Error} - Always throws with detailed rejection reason
 */
function rejectInvalidTransition(from, to) {
  const allowedTransitions = VALID_TRANSITIONS.get(from);
  
  throw new Error(
    `REJECTED: Invalid state transition ${from} → ${to}. ` +
    `Valid transitions from ${from}: ${allowedTransitions ? Array.from(allowedTransitions).join(', ') : 'none'}. ` +
    `Fail-closed protection: Unexpected transitions are not permitted. ` +
    `Runner must transition to REJECTED state.`
  );
}

/**
 * Check if a state allows verification operations.
 * 
 * @param {string} state - State to check
 * @returns {boolean} - True if verification allowed
 */
function canVerify(state) {
  const verificationStates = new Set([
    STATES.IDENTITY_PENDING,
    STATES.IDENTITY_VERIFIED,
    STATES.ACCOUNTS_PENDING,
    STATES.ACCOUNTS_VERIFIED,
  ]);
  
  return verificationStates.has(state);
}

/**
 * Check if a state allows provisioning operations.
 * 
 * @param {string} state - State to check
 * @returns {boolean} - True if provisioning allowed
 */
function canProvision(state) {
  return state === STATES.PROVISIONING;
}

/**
 * Check if a state allows teardown operations.
 * 
 * @param {string} state - State to check
 * @returns {boolean} - True if teardown allowed
 */
function canTeardown(state) {
  return state === STATES.TEARDOWN_PENDING || state === STATES.REJECTED;
}

/**
 * Get state metadata.
 * 
 * @param {string} state - State name
 * @returns {object} - State metadata
 */
function getStateMetadata(state) {
  const metadata = {
    [STATES.CREATED]: {
      description: 'Initial state after runner instantiation',
      allowsProvisioning: false,
      allowsVerification: false,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.PROVISIONING]: {
      description: 'Docker container provisioning in progress',
      allowsProvisioning: true,
      allowsVerification: false,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.IDENTITY_PENDING]: {
      description: 'Waiting for service identity attestation',
      allowsProvisioning: false,
      allowsVerification: true,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.IDENTITY_VERIFIED]: {
      description: 'Service identity verified (serverUuid, containerId, etc.)',
      allowsProvisioning: false,
      allowsVerification: true,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.ACCOUNTS_PENDING]: {
      description: 'MySQL accounts being created',
      allowsProvisioning: false,
      allowsVerification: true,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.ACCOUNTS_VERIFIED]: {
      description: 'Account privileges verified',
      allowsProvisioning: false,
      allowsVerification: true,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.SERVICE_READY]: {
      description: 'Service ready for use (C-1B Stage 1 terminal state)',
      allowsProvisioning: false,
      allowsVerification: false,
      allowsExecution: false, // C-1B Stage 1: NO SQL execution
      allowsTeardown: false,
    },
    [STATES.TEARDOWN_PENDING]: {
      description: 'Teardown in progress',
      allowsProvisioning: false,
      allowsVerification: false,
      allowsExecution: false,
      allowsTeardown: true,
    },
    [STATES.DESTROYED]: {
      description: 'Service destroyed and cleaned up (terminal success state)',
      allowsProvisioning: false,
      allowsVerification: false,
      allowsExecution: false,
      allowsTeardown: false,
    },
    [STATES.REJECTED]: {
      description: 'Terminal failure state (fail-closed)',
      allowsProvisioning: false,
      allowsVerification: false,
      allowsExecution: false,
      allowsTeardown: true,
    },
  };
  
  return metadata[state] || { description: 'Unknown state' };
}

module.exports = {
  STATES,
  transitionTo,
  validateTransition,
  isTerminalState,
  canExecuteSQL,
  rejectInvalidTransition,
  canVerify,
  canProvision,
  canTeardown,
  getStateMetadata,
};
