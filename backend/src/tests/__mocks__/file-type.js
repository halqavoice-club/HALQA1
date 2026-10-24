'use strict';
/**
 * file-type Mock for Jest CJS Environment
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides minimal CommonJS mock of file-type@21.3.4 (ESM-only package)
 * to unblock Jest unit tests that use jest.mock('file-type').
 *
 * This mock provides default JPEG responses to allow tests to execute.
 * Tests that need specific MIME types should override with suite-level mocks.
 *
 * SECURITY NOTE:
 * This mock does NOT perform real file-type validation. Production code uses
 * dynamic import('file-type') at runtime and validates actual file signatures.
 * Tests using this mock are testing authorization/access control, NOT upload
 * validation logic.
 *
 * Production validation tests (e.g., phase2b-file-type-migration.test.js) use
 * child_process.execSync with real file-type module to verify actual behavior.
 */

/**
 * Mock fileTypeFromBuffer matching file-type@21.x API.
 * Returns JPEG by default (most common in test fixtures).
 */
async function fileTypeFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return null; // file-type v21 returns null for invalid input
  }
  // Default mock response: JPEG
  return { mime: 'image/jpeg', ext: 'jpg' };
}

/**
 * Mock fileTypeFromStream matching file-type@21.x API.
 */
async function fileTypeFromStream(stream) {
  // Default mock response: JPEG
  return { mime: 'image/jpeg', ext: 'jpg' };
}

module.exports = {
  fileTypeFromBuffer,
  fileTypeFromStream,
};
