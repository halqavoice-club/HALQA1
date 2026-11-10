'use strict';
/**
 * SEC01-G-BE02-A — Live Class Microphone Authorization Contract
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the stable API contract, authorization modes, reasons, and helpers
 * for the live class self-service microphone authorization endpoint.
 *
 * Unit A: contract constants and stateless classification helpers.
 * Unit B (future): live SFU authorization evidence (track presence, grants).
 */

// ─── API Contract ─────────────────────────────────────────────────────────────

const LIVE_CLASS_MICROPHONE_API_CONTRACT = {
  method: 'PATCH',
  path: '/live-classes/:id/microphone',
  idempotencyHeader: 'Idempotency-Key',
  maximumIdempotencyKeyLength: 128,
};

// ─── Authorization Modes ──────────────────────────────────────────────────────

const MICROPHONE_AUTHORIZATION_MODES = {
  /** Legacy mode: microphone state tracked only via isMuted in the DB.
   *  SFU enforcement is unavailable; callers cannot claim SFU-confirmed state. */
  LEGACY: 'LEGACY',
  /** Protected mode: microphone authorization is enforced at the SFU layer.
   *  New sessions must be created in this mode; old SCHEDULED sessions upgrade on start. */
  SFU_AUTHORITATIVE: 'SFU_AUTHORITATIVE',
};

// ─── Authorization Reasons ────────────────────────────────────────────────────

const MICROPHONE_AUTHORIZATION_REASONS = {
  /** Mode is LEGACY — SFU state is unknown and cannot be asserted. */
  LEGACY_STATE_UNKNOWN: 'LEGACY_STATE_UNKNOWN',
  /** Mode is SFU_AUTHORITATIVE but no current authorization evidence is available yet.
   *  Unit B must supply confirmed SFU evidence before canPublishAudio can be true. */
  AUTHORIZATION_STATE_UNKNOWN: 'AUTHORIZATION_STATE_UNKNOWN',
  /** SFU confirmed publish capability for this participant. */
  SFU_AUTHORIZED: 'SFU_AUTHORIZED',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize a raw microphone_authorization_mode value from DB or request.
 * Any value other than SFU_AUTHORITATIVE falls back to LEGACY (fail-closed).
 */
function normalizeMicrophoneAuthorizationMode(mode) {
  if (mode === MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE) {
    return MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE;
  }
  return MICROPHONE_AUTHORIZATION_MODES.LEGACY;
}

/**
 * Returns true only when the mode is SFU_AUTHORITATIVE.
 */
function isSfuAuthoritativeMode(mode) {
  return mode === MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE;
}

/**
 * Classify microphone authorization for a participant given the session mode.
 * Fails closed in both modes until Unit B provides confirmed SFU evidence.
 *
 * @param {string|undefined} mode - microphone_authorization_mode for the session
 * @returns {{ canPublishAudio: boolean, sfuEnforced: boolean, authorizationReason: string }}
 */
function classifyMicrophoneAuthorization(mode) {
  if (!isSfuAuthoritativeMode(mode)) {
    return {
      canPublishAudio: false,
      sfuEnforced: false,
      authorizationReason: MICROPHONE_AUTHORIZATION_REASONS.LEGACY_STATE_UNKNOWN,
    };
  }
  // SFU_AUTHORITATIVE mode: fail closed until Unit B supplies confirmed evidence
  return {
    canPublishAudio: false,
    sfuEnforced: false,
    authorizationReason: MICROPHONE_AUTHORIZATION_REASONS.AUTHORIZATION_STATE_UNKNOWN,
  };
}

module.exports = {
  LIVE_CLASS_MICROPHONE_API_CONTRACT,
  MICROPHONE_AUTHORIZATION_MODES,
  MICROPHONE_AUTHORIZATION_REASONS,
  normalizeMicrophoneAuthorizationMode,
  isSfuAuthoritativeMode,
  classifyMicrophoneAuthorization,
};
