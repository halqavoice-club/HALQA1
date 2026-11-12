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
  normalizeMicrophoneAuthorizationMode,
  isSfuAuthoritativeMode,
  classifyMicrophoneAuthorization,
};
