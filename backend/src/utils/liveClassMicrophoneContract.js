'use strict';

/**
 * Live Class Microphone Authorization Contract (SEC01-G-BE02)
 *
 * Defines the API contract, mode constants, and fail-closed classification
 * logic for the live class microphone authorization feature.
 *
 * All classification defaults fail-closed: canPublishAudio=false, sfuEnforced=false.
 * SFU_AUTHORITATIVE mode remains fail-closed until Unit B supplies current
 * authorization and confirmed SFU evidence.
 */

const LIVE_CLASS_MICROPHONE_API_CONTRACT = Object.freeze({
  method: 'PATCH',
  path: '/live-classes/:id/microphone',
  idempotencyHeader: 'Idempotency-Key',
  maximumIdempotencyKeyLength: 128,
});

const MICROPHONE_AUTHORIZATION_MODES = Object.freeze({
  LEGACY: 'LEGACY',
  SFU_AUTHORITATIVE: 'SFU_AUTHORITATIVE',
});

const MICROPHONE_AUTHORIZATION_REASONS = Object.freeze({
  LEGACY_STATE_UNKNOWN: 'LEGACY_STATE_UNKNOWN',
  AUTHORIZATION_STATE_UNKNOWN: 'AUTHORIZATION_STATE_UNKNOWN',
});

/**
 * Message text raised by the live_classes_legacy_start_guard trigger when a
 * LEGACY-mode session attempts to transition to LIVE (SQLSTATE 45000).
 * The controller matches database rejection errors against this text to
 * return a clean HTTP 409 without exposing SQL details.
 */
const LEGACY_SESSION_START_REJECTION_MESSAGE =
  'Cannot start LEGACY session; upgrade microphone_authorization_mode to SFU_AUTHORITATIVE first';

/**
 * Returns true only when the error's message contains the legacy-start-guard
 * trigger rejection text. Anything else (connection failures, unrelated SQL
 * errors, non-error values) returns false and must not be treated as a 409.
 *
 * @param {Error|null|undefined|*} err
 * @returns {boolean}
 */
function isTriggerLegacyStartRejection(err) {
  return Boolean(
    err &&
    err.message &&
    typeof err.message.includes === 'function' &&
    err.message.includes(LEGACY_SESSION_START_REJECTION_MESSAGE),
  );
}

/**
 * Normalize a raw microphone authorization mode value.
 * Returns LEGACY for undefined/null/empty/UNKNOWN/LEGACY.
 * Returns SFU_AUTHORITATIVE only for exact string match.
 *
 * @param {string|null|undefined} mode
 * @returns {'LEGACY'|'SFU_AUTHORITATIVE'}
 */
function normalizeMicrophoneAuthorizationMode(mode) {
  if (!mode || mode === 'UNKNOWN' || mode === 'LEGACY') return 'LEGACY';
  if (mode === 'SFU_AUTHORITATIVE') return 'SFU_AUTHORITATIVE';
  return 'LEGACY';
}

/**
 * Returns true only if mode is exactly SFU_AUTHORITATIVE.
 *
 * @param {string|null|undefined} mode
 * @returns {boolean}
 */
function isSfuAuthoritativeMode(mode) {
  return mode === 'SFU_AUTHORITATIVE';
}

/**
 * Classify microphone authorization for the given mode.
 * Fail-closed: always returns canPublishAudio=false, sfuEnforced=false
 * until Unit B supplies confirmed SFU evidence.
 *
 * @param {string|null|undefined} mode
 * @returns {{ canPublishAudio: boolean, sfuEnforced: boolean, authorizationReason: string }}
 */
function classifyMicrophoneAuthorization(mode) {
  if (mode === MICROPHONE_AUTHORIZATION_MODES.SFU_AUTHORITATIVE) {
    return {
      canPublishAudio: false,
      sfuEnforced: false,
      authorizationReason: MICROPHONE_AUTHORIZATION_REASONS.AUTHORIZATION_STATE_UNKNOWN,
    };
  }
  return {
    canPublishAudio: false,
    sfuEnforced: false,
    authorizationReason: MICROPHONE_AUTHORIZATION_REASONS.LEGACY_STATE_UNKNOWN,
  };
}

module.exports = {
  LIVE_CLASS_MICROPHONE_API_CONTRACT,
  MICROPHONE_AUTHORIZATION_MODES,
  MICROPHONE_AUTHORIZATION_REASONS,
  LEGACY_SESSION_START_REJECTION_MESSAGE,
  normalizeMicrophoneAuthorizationMode,
  isSfuAuthoritativeMode,
  classifyMicrophoneAuthorization,
  isTriggerLegacyStartRejection,
};
