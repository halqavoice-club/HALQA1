'use strict';
/**
 * Encryption Utility — AES-256-GCM
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides authenticated encryption for sensitive payout account details
 * (bank account numbers, IBAN, PayPal addresses, account holder names).
 *
 * Algorithm: AES-256-GCM
 *   - AES-256: 256-bit key provides strong confidentiality
 *   - GCM mode: Galois/Counter Mode provides both encryption AND integrity
 *     authentication. Tampering with the ciphertext is detected and rejected
 *     before any decryption occurs — no silent corruption possible.
 *   - 96-bit (12-byte) random IV per encryption call: prevents IV reuse
 *     attacks even if the same plaintext is encrypted multiple times.
 *
 * Ciphertext format (all parts base64-encoded, colon-separated):
 *   <iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * Key source: PAYOUT_ENCRYPTION_KEY environment variable
 *   - Must be at least 32 bytes (UTF-8 encoded)
 *   - Only the first 32 bytes are used (AES-256 requires exactly 32 bytes)
 *   - NEVER hardcode the key — always read from env var
 *
 * Security invariants:
 *   - The encryption key MUST NOT appear in logs, error messages, or API responses
 *   - The IV MUST be random (crypto.randomBytes) — never a constant or counter
 *   - Auth tag verification MUST precede decryption (enforced by Node.js GCM)
 *   - Encrypted values MUST NOT be logged in plaintext
 *
 * Usage:
 *   const { encrypt, decrypt, maskAccountDetails } = require('./encryption');
 *
 *   // Encrypt before DB write:
 *   const stored = encrypt(JSON.stringify({ accountHolder: 'Jane', account: '1234567890' }));
 *
 *   // Decrypt for admin read (mask before returning to client):
 *   const decrypted = decrypt(stored);
 *   const masked = maskAccountDetails(decrypted);
 *   // → { accountHolder: 'Jane', accountLast4: '7890' }
 */

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const KEY_LENGTH = 32;  // bytes — AES-256 requires exactly 32
const IV_LENGTH  = 12;  // bytes — 96 bits is the recommended GCM IV size

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Reads and validates the encryption key from PAYOUT_ENCRYPTION_KEY env var.
 *
 * Throws if the key is absent or shorter than 32 bytes.
 * Only the first 32 bytes are used; longer keys are silently truncated.
 *
 * @returns {Buffer} 32-byte key buffer
 * @throws {Error} if PAYOUT_ENCRYPTION_KEY is missing or too short
 */
function getEncryptionKey() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[encryption] PAYOUT_ENCRYPTION_KEY environment variable is not set. ' +
      'Set a 32+ byte secret in your .env file before using payout encryption.'
    );
  }
  const keyBuf = Buffer.from(raw, 'utf8');
  if (keyBuf.length < KEY_LENGTH) {
    throw new Error(
      `[encryption] PAYOUT_ENCRYPTION_KEY must be at least ${KEY_LENGTH} bytes (UTF-8). ` +
      `Current length: ${keyBuf.length} bytes.`
    );
  }
  // Slice to exactly 32 bytes — AES-256 key size
  return keyBuf.slice(0, KEY_LENGTH);
}

// ─── Encrypt ──────────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * A fresh random 12-byte IV is generated for every call, ensuring that
 * identical plaintexts produce different ciphertexts (semantic security).
 *
 * @param {string} plaintext — the string to encrypt (e.g. JSON-stringified object)
 * @returns {string} ciphertext in format "ivBase64:tagBase64:ciphertextBase64"
 * @throws {Error} if PAYOUT_ENCRYPTION_KEY is not set or too short
 */
function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError(`[encryption] encrypt() expects a string, got ${typeof plaintext}`);
  }

  const key    = getEncryptionKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv):base64(authTag):base64(ciphertext)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

// ─── Decrypt ──────────────────────────────────────────────────────────────────

/**
 * Decrypts a ciphertext produced by encrypt().
 *
 * The GCM auth tag is verified before any data is returned.
 * If the ciphertext has been tampered with, this throws an error.
 *
 * @param {string} ciphertext — in format "ivBase64:tagBase64:ciphertextBase64"
 * @returns {string} the original plaintext
 * @throws {Error} if the ciphertext is malformed, tampered, or the key is wrong
 */
function decrypt(ciphertext) {
  if (typeof ciphertext !== 'string') {
    throw new TypeError(`[encryption] decrypt() expects a string, got ${typeof ciphertext}`);
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error(
      '[encryption] decrypt() received malformed ciphertext. ' +
      'Expected format: ivBase64:tagBase64:ciphertextBase64'
    );
  }

  const [ivB64, tagB64, encB64] = parts;

  let iv, authTag, encrypted;
  try {
    iv        = Buffer.from(ivB64,  'base64');
    authTag   = Buffer.from(tagB64, 'base64');
    encrypted = Buffer.from(encB64, 'base64');
  } catch {
    throw new Error('[encryption] decrypt() failed to decode base64 components');
  }

  if (iv.length !== IV_LENGTH) {
    throw new Error(`[encryption] IV must be ${IV_LENGTH} bytes, got ${iv.length}`);
  }

  const key      = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // GCM auth tag is verified here — throws if ciphertext was tampered
  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(
      '[encryption] Decryption failed — ciphertext may have been tampered with or the wrong key was used. ' +
      `Original error: ${err.message}`
    );
  }
}

// ─── Masking ──────────────────────────────────────────────────────────────────

/**
 * Parses decrypted JSON account details and returns a masked summary safe
 * to include in admin API responses.
 *
 * Only the account holder name and the last 4 characters of the account
 * number/identifier are returned. The full account number is never exposed.
 *
 * @param {string} decryptedJson — JSON string from decrypt()
 * @returns {{ accountHolder: string, accountLast4: string }}
 */
function maskAccountDetails(decryptedJson) {
  let parsed;
  try {
    parsed = JSON.parse(decryptedJson);
  } catch {
    throw new Error('[encryption] maskAccountDetails() received invalid JSON');
  }

  const accountHolder = (parsed.accountHolder || parsed.account_holder || '').trim();
  const accountRaw    = (parsed.account || parsed.accountNumber || parsed.iban || '').trim();
  const accountLast4  = accountRaw.length >= 4
    ? accountRaw.slice(-4)
    : accountRaw.padStart(4, '*').slice(-4);

  return { accountHolder, accountLast4 };
}

// ─── Legacy detection ─────────────────────────────────────────────────────────

/**
 * Returns true if the value looks like it was encrypted by this module
 * (i.e. it matches the "ivBase64:tagBase64:ciphertextBase64" format).
 *
 * Used during the one-time migration script to skip already-encrypted records.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  // Each part must be valid non-empty base64
  return parts.every(p => p.length > 0 && /^[A-Za-z0-9+/=]+$/.test(p));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  encrypt,
  decrypt,
  maskAccountDetails,
  isEncrypted,
};
