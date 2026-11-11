'use strict';

/**
 * Live Class Microphone Authority Service (SEC01-G-BE02-B)
 *
 * Manages microphone authorization modes for live classes.
 * Enforces fail-closed behavior: all SFU authorization capabilities are
 * marked as incomplete until full runtime protection is implemented.
 *
 * Uses raw SQL queries to avoid Prisma client regeneration dependency on new columns.
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

// ─── Mode constants ───────────────────────────────────────────────────────────

const AUTHORITY_MODES = Object.freeze({
  LEGACY: 'LEGACY',
  SFU_AUTHORITATIVE: 'SFU_AUTHORITATIVE',
});

// ─── Protected runtime capabilities ──────────────────────────────────────────
// All values are false — fail-closed until each capability is implemented.
// SFU_AUTHORITATIVE mode cannot be safely used until ALL are true.

const PROTECTED_RUNTIME_CAPABILITIES = Object.freeze({
  microphoneSpecificPermissionResolver: false,
  safeTokenIssuance: false,
  explicitAuthorizationEndpoint: false,
  durableRevocationHandling: false,
  runtimeCapabilityVerified: false,
});

/**
 * Check which protected runtime capabilities are ready.
 * @returns {{ ready: boolean, missingCapabilities: string[] }}
 */
function getProtectedRuntimeReadiness() {
  const missing = Object.entries(PROTECTED_RUNTIME_CAPABILITIES)
    .filter(([, v]) => v === false)
    .map(([k]) => k);
  return { ready: missing.length === 0, missingCapabilities: missing };
}

/**
 * Assert that the protected runtime is fully ready.
 * Throws 503 with MICROPHONE_PROTECTION_NOT_READY if any capability is missing.
 */
function assertProtectedRuntimeReady() {
  const { ready, missingCapabilities } = getProtectedRuntimeReadiness();
  if (!ready) {
    const err = new Error('Microphone protection runtime not ready');
    err.statusCode = 503;
    err.code = 'MICROPHONE_PROTECTION_NOT_READY';
    err.missingCapabilities = missingCapabilities;
    throw err;
  }
}

// ─── Core authority queries ───────────────────────────────────────────────────

/**
 * Get the microphone authorization mode for a live class (fail-closed).
 * Throws if the class is not found, the mode is null/invalid, or if
 * SFU_AUTHORITATIVE mode lacks establishment evidence.
 *
 * @param {string} liveClassId
 * @returns {Promise<{ mode: string, establishedAt: Date|null }>}
 */
async function getMicrophoneAuthority(liveClassId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT microphone_authorization_mode, microphone_mode_established_at
     FROM live_classes
     WHERE id = ? AND deletedAt IS NULL
     LIMIT 1`,
    liveClassId,
  );

  if (!rows || rows.length === 0) {
    const err = new Error(`Live class ${liveClassId} not found`);
    err.statusCode = 404;
    err.code = 'CLASS_NOT_FOUND';
    throw err;
  }

  const row = rows[0];
  const mode = row.microphone_authorization_mode;
  const establishedAt = row.microphone_mode_established_at ?? null;

  if (!mode) {
    const err = new Error(`Invalid or missing microphone authority mode for class ${liveClassId}`);
    err.statusCode = 500;
    err.code = 'INVALID_AUTHORITY_MODE';
    throw err;
  }

  // SFU_AUTHORITATIVE must have establishment evidence (microphoneModeEstablishedAt not null)
  if (mode === AUTHORITY_MODES.SFU_AUTHORITATIVE && !establishedAt) {
    const err = new Error(`SFU_AUTHORITATIVE mode lacks establishment evidence for class ${liveClassId}`);
    err.statusCode = 500;
    err.code = 'INVALID_AUTHORITY_EVIDENCE';
    throw err;
  }

  return { mode, establishedAt };
}

/**
 * Get the microphone authority safely (fail-safe variant).
 * Returns null on any error instead of throwing.
 *
 * @param {string} liveClassId
 * @returns {Promise<{ mode: string, establishedAt: Date|null }|null>}
 */
async function getAuthoritySafe(liveClassId) {
  try {
    return await getMicrophoneAuthority(liveClassId);
  } catch (err) {
    logger.warn(`Failed to query authority for live class ${liveClassId}: ${err.message}`);
    return null;
  }
}

// ─── LiveKit API authorization ────────────────────────────────────────────────

/**
 * Check if the LiveKit API may be used for a live class (fail-closed).
 * Queries the DB for the current mode; throws on any error.
 *
 * @param {string} liveClassId
 * @returns {Promise<boolean>}
 */
async function canUseLiveKitAPI(liveClassId) {
  const authority = await getMicrophoneAuthority(liveClassId);
  return authority.mode === AUTHORITY_MODES.SFU_AUTHORITATIVE;
}

/**
 * Check if the LiveKit API may be used for a live class (fail-safe).
 * Returns false on any error.
 *
 * @param {string} liveClassId
 * @returns {Promise<boolean>}
 */
async function canUseLiveKitAPISafe(liveClassId) {
  try {
    const authority = await getMicrophoneAuthority(liveClassId);
    return authority.mode === AUTHORITY_MODES.SFU_AUTHORITATIVE;
  } catch {
    return false;
  }
}

// ─── Mode enforcement ─────────────────────────────────────────────────────────

/**
 * Enforce that the live class is in SFU_AUTHORITATIVE mode.
 * Throws 409 LEGACY_MODE_VIOLATION if in LEGACY mode.
 *
 * @param {string} liveClassId
 * @param {string} operationName  Human-readable operation name for the error message
 */
async function enforceSFUMode(liveClassId, operationName) {
  const authority = await getMicrophoneAuthority(liveClassId);
  if (authority.mode !== AUTHORITY_MODES.SFU_AUTHORITATIVE) {
    const err = new Error(
      `Cannot perform ${operationName} in LEGACY mode for class ${liveClassId}. Must be SFU_AUTHORITATIVE.`,
    );
    err.statusCode = 409;
    err.code = 'LEGACY_MODE_VIOLATION';
    throw err;
  }
}

// ─── Mode upgrade ─────────────────────────────────────────────────────────────

/**
 * Upgrade a SCHEDULED live class from LEGACY to SFU_AUTHORITATIVE mode.
 * Idempotent: returns success if already in SFU_AUTHORITATIVE mode.
 * Rejects non-SCHEDULED classes (409) and missing classes (404).
 *
 * @param {string} liveClassId
 * @returns {Promise<{ success: boolean, mode: string, establishedAt: Date }>}
 */
async function upgradeToSFU(liveClassId) {
  const lc = await prisma.liveClass.findFirst({
    where: { id: liveClassId, deletedAt: null },
    select: { id: true, status: true, microphoneAuthorizationMode: true },
  });

  if (!lc) {
    const err = new Error(`Live class ${liveClassId} not found`);
    err.statusCode = 404;
    err.code = 'CLASS_NOT_FOUND';
    throw err;
  }

  if (lc.status !== 'SCHEDULED') {
    const err = new Error(
      `Class ${liveClassId} must be SCHEDULED to upgrade microphone mode (current: ${lc.status})`,
    );
    err.statusCode = 409;
    err.code = 'INVALID_STATUS_FOR_UPGRADE';
    throw err;
  }

  // Idempotent: already in SFU_AUTHORITATIVE mode
  if (lc.microphoneAuthorizationMode === AUTHORITY_MODES.SFU_AUTHORITATIVE) {
    logger.info(`[microphone-authority] Class ${liveClassId} already in SFU_AUTHORITATIVE mode`);
    const current = await getMicrophoneAuthority(liveClassId);
    return { success: true, mode: current.mode, establishedAt: current.establishedAt };
  }

  const now = new Date();
  try {
    // Single ? placeholder for microphone_mode_established_at; updatedAt uses NOW().
    const affected = await prisma.$executeRawUnsafe(
      `UPDATE live_classes
       SET microphone_authorization_mode = 'SFU_AUTHORITATIVE',
           microphone_mode_established_at = ?,
           updatedAt = NOW()
       WHERE id = ?
         AND microphone_authorization_mode = 'LEGACY'
         AND status = 'SCHEDULED'`,
      now,
      liveClassId,
    );

    if (affected === 0) {
      const err = new Error(`Upgrade of class ${liveClassId} was superseded by a concurrent change`);
      err.statusCode = 409;
      err.code = 'STALE_AUTHORITY_UPGRADE';
      throw err;
    }

    logger.info(`[microphone-authority] Upgraded class ${liveClassId} to SFU_AUTHORITATIVE`);
    return { success: true, mode: AUTHORITY_MODES.SFU_AUTHORITATIVE, establishedAt: now };
  } catch (err) {
    if (err.code === 'STALE_AUTHORITY_UPGRADE') throw err;
    logger.error(`[microphone-authority] Failed to upgrade class ${liveClassId}: ${err.message}`);
    const wrapErr = new Error(`Failed to upgrade class ${liveClassId} to SFU_AUTHORITATIVE: ${err.message}`);
    wrapErr.statusCode = 500;
    wrapErr.code = 'UPGRADE_FAILED';
    throw wrapErr;
  }
}

// ─── Mode predicates ──────────────────────────────────────────────────────────

/**
 * Check if a live class is in LEGACY mode (fail-closed).
 * @param {string} liveClassId
 * @returns {Promise<boolean>}
 */
async function isLegacyMode(liveClassId) {
  const authority = await getMicrophoneAuthority(liveClassId);
  return authority.mode === AUTHORITY_MODES.LEGACY;
}

/**
 * Check if a live class is in SFU_AUTHORITATIVE mode (fail-closed).
 * @param {string} liveClassId
 * @returns {Promise<boolean>}
 */
async function isSFUMode(liveClassId) {
  const authority = await getMicrophoneAuthority(liveClassId);
  return authority.mode === AUTHORITY_MODES.SFU_AUTHORITATIVE;
}

module.exports = {
  AUTHORITY_MODES,
  PROTECTED_RUNTIME_CAPABILITIES,
  getProtectedRuntimeReadiness,
  assertProtectedRuntimeReady,
  getMicrophoneAuthority,
  getAuthoritySafe,
  canUseLiveKitAPI,
  canUseLiveKitAPISafe,
  enforceSFUMode,
  upgradeToSFU,
  isLegacyMode,
  isSFUMode,
};
