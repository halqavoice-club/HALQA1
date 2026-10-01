'use strict';
/**
 * encryption.js — Unit Tests (Task 4.2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-dependency pure unit tests. No DB, no Prisma, no Redis.
 * Uses Node.js built-in crypto only.
 *
 * Covered:
 *   - encrypt() → decrypt() round-trip
 *   - IV randomness: same plaintext produces different ciphertexts
 *   - Tamper detection: mutated ciphertext throws on decrypt
 *   - Missing key: throws descriptive error
 *   - Short key: throws descriptive error
 *   - Wrong key: throws on decrypt
 *   - Type guards on encrypt/decrypt inputs
 *   - maskAccountDetails: correct extraction and masking
 *   - isEncrypted: correctly identifies encrypted vs plaintext strings
 */

const { encrypt, decrypt, maskAccountDetails, isEncrypted } = require('../utils/encryption');

// ─── Test key management helpers ──────────────────────────────────────────────

const VALID_KEY = 'halqa-test-payout-key-32-bytes!!'; // exactly 32 bytes

function withKey(key, fn) {
  const original = process.env.PAYOUT_ENCRYPTION_KEY;
  process.env.PAYOUT_ENCRYPTION_KEY = key;
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env.PAYOUT_ENCRYPTION_KEY;
    } else {
      process.env.PAYOUT_ENCRYPTION_KEY = original;
    }
  }
}

function withoutKey(fn) {
  const original = process.env.PAYOUT_ENCRYPTION_KEY;
  delete process.env.PAYOUT_ENCRYPTION_KEY;
  try {
    fn();
  } finally {
    if (original !== undefined) {
      process.env.PAYOUT_ENCRYPTION_KEY = original;
    }
  }
}

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('encrypt() → decrypt() round-trip', () => {
  test('decrypted output equals original plaintext', () => {
    withKey(VALID_KEY, () => {
      const plaintext = JSON.stringify({ accountHolder: 'Jane Doe', account: 'GB29NWBK60161331926819' });
      const ciphertext = encrypt(plaintext);
      const result = decrypt(ciphertext);
      expect(result).toBe(plaintext);
    });
  });

  test('round-trip preserves unicode characters', () => {
    withKey(VALID_KEY, () => {
      const plaintext = '{"accountHolder":"محمد عبدالله","account":"SA44 2000 0001 2345 6789 1234"}';
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });
  });

  test('round-trip preserves empty string', () => {
    withKey(VALID_KEY, () => {
      expect(decrypt(encrypt(''))).toBe('');
    });
  });

  test('round-trip preserves long strings', () => {
    withKey(VALID_KEY, () => {
      const plaintext = 'x'.repeat(10000);
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    });
  });

  test('ciphertext format is ivBase64:tagBase64:ciphertextBase64 (3 colon-separated parts)', () => {
    withKey(VALID_KEY, () => {
      const ciphertext = encrypt('hello');
      const parts = ciphertext.split(':');
      expect(parts).toHaveLength(3);
      parts.forEach(p => {
        expect(p.length).toBeGreaterThan(0);
        expect(p).toMatch(/^[A-Za-z0-9+/=]+$/);
      });
    });
  });
});

// ─── IV randomness ────────────────────────────────────────────────────────────

describe('IV randomness', () => {
  test('same plaintext produces different ciphertexts on each call', () => {
    withKey(VALID_KEY, () => {
      const plaintext = 'same input every time';
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      const c3 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
      expect(c2).not.toBe(c3);
      expect(c1).not.toBe(c3);
    });
  });

  test('all ciphertexts from same plaintext decrypt to same value', () => {
    withKey(VALID_KEY, () => {
      const plaintext = 'same input every time';
      const ciphertexts = Array.from({ length: 5 }, () => encrypt(plaintext));
      ciphertexts.forEach(c => expect(decrypt(c)).toBe(plaintext));
    });
  });
});

// ─── Tamper detection ─────────────────────────────────────────────────────────

describe('tamper detection', () => {
  test('mutating a single byte of ciphertext throws on decrypt', () => {
    withKey(VALID_KEY, () => {
      const ciphertext = encrypt('sensitive bank account data');
      const parts = ciphertext.split(':');
      // Flip last character of ciphertext part
      const tampered = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
      const tamperedFull = [parts[0], parts[1], tampered].join(':');
      expect(() => decrypt(tamperedFull)).toThrow();
    });
  });

  test('mutating the auth tag throws on decrypt', () => {
    withKey(VALID_KEY, () => {
      const ciphertext = encrypt('sensitive data');
      const parts = ciphertext.split(':');
      // Decode the tag, flip the first byte (deterministic and always effective),
      // re-encode. This guarantees the auth tag is actually wrong, not just
      // a different base64 encoding of the same bytes.
      const tagBuf = Buffer.from(parts[1], 'base64');
      tagBuf[0] = tagBuf[0] ^ 0xFF; // XOR flip — always changes the byte
      const tamperedTag = tagBuf.toString('base64');
      expect(() => decrypt([parts[0], tamperedTag, parts[2]].join(':'))).toThrow();
    });
  });

  test('mutating the IV throws or produces garbled output (not original plaintext)', () => {
    withKey(VALID_KEY, () => {
      const plaintext = 'important data';
      const ciphertext = encrypt(plaintext);
      const parts = ciphertext.split(':');
      const tamperedIv = parts[0].slice(0, -1) + (parts[0].slice(-1) === 'A' ? 'B' : 'A');
      const tamperedFull = [tamperedIv, parts[1], parts[2]].join(':');
      // May throw OR return garbled output — either is acceptable as tamper protection
      try {
        const result = decrypt(tamperedFull);
        expect(result).not.toBe(plaintext);
      } catch {
        // Threw — also acceptable
      }
    });
  });

  test('completely different ciphertext throws on decrypt', () => {
    withKey(VALID_KEY, () => {
      expect(() => decrypt('aGVsbG8=:d29ybGQ=:Zm9v')).toThrow();
    });
  });

  test('empty string throws on decrypt', () => {
    withKey(VALID_KEY, () => {
      expect(() => decrypt('')).toThrow();
    });
  });

  test('plaintext JSON passed to decrypt throws (wrong format)', () => {
    withKey(VALID_KEY, () => {
      expect(() => decrypt('{"accountHolder":"Jane"}')).toThrow();
    });
  });
});

// ─── Key management ───────────────────────────────────────────────────────────

describe('key management', () => {
  test('missing PAYOUT_ENCRYPTION_KEY throws descriptive error on encrypt', () => {
    withoutKey(() => {
      expect(() => encrypt('data')).toThrow(/PAYOUT_ENCRYPTION_KEY/);
    });
  });

  test('missing PAYOUT_ENCRYPTION_KEY throws descriptive error on decrypt', () => {
    let ciphertext;
    withKey(VALID_KEY, () => { ciphertext = encrypt('data'); });
    withoutKey(() => {
      expect(() => decrypt(ciphertext)).toThrow(/PAYOUT_ENCRYPTION_KEY/);
    });
  });

  test('key shorter than 32 bytes throws descriptive error', () => {
    withKey('short-key', () => {
      expect(() => encrypt('data')).toThrow(/32 bytes/);
    });
  });

  test('key of exactly 32 bytes works', () => {
    withKey(VALID_KEY, () => {
      expect(Buffer.from(VALID_KEY, 'utf8').length).toBe(32);
      expect(() => encrypt('data')).not.toThrow();
    });
  });

  test('key longer than 32 bytes works (only first 32 used)', () => {
    const longKey = 'a'.repeat(64); // 64 bytes, only first 32 used
    withKey(longKey, () => {
      const c = encrypt('test data');
      expect(decrypt(c)).toBe('test data');
    });
  });

  test('wrong key throws on decrypt (auth tag verification fails)', () => {
    let ciphertext;
    withKey(VALID_KEY, () => { ciphertext = encrypt('secret data'); });

    const wrongKey = 'different-key-of-exactly-32-bytes';
    withKey(wrongKey, () => {
      expect(() => decrypt(ciphertext)).toThrow();
    });
  });
});

// ─── Type guards ──────────────────────────────────────────────────────────────

describe('type guards', () => {
  test('encrypt() throws TypeError for non-string input', () => {
    withKey(VALID_KEY, () => {
      expect(() => encrypt(123)).toThrow(TypeError);
      expect(() => encrypt(null)).toThrow(TypeError);
      expect(() => encrypt(undefined)).toThrow(TypeError);
      expect(() => encrypt({ key: 'val' })).toThrow(TypeError);
    });
  });

  test('decrypt() throws TypeError for non-string input', () => {
    withKey(VALID_KEY, () => {
      expect(() => decrypt(123)).toThrow(TypeError);
      expect(() => decrypt(null)).toThrow(TypeError);
      expect(() => decrypt(undefined)).toThrow(TypeError);
    });
  });
});

// ─── maskAccountDetails ───────────────────────────────────────────────────────

describe('maskAccountDetails()', () => {
  test('returns accountHolder and last 4 chars of account', () => {
    const result = maskAccountDetails(
      JSON.stringify({ accountHolder: 'Jane Doe', account: 'GB29NWBK60161331926819' })
    );
    expect(result.accountHolder).toBe('Jane Doe');
    expect(result.accountLast4).toBe('6819');
  });

  test('works with accountNumber field name', () => {
    const result = maskAccountDetails(
      JSON.stringify({ accountHolder: 'Ahmed Ali', accountNumber: '0123456789' })
    );
    expect(result.accountHolder).toBe('Ahmed Ali');
    expect(result.accountLast4).toBe('6789');
  });

  test('works with iban field name', () => {
    const result = maskAccountDetails(
      JSON.stringify({ accountHolder: 'Sara', iban: 'SA44 2000 0001 2345 6789 1234' })
    );
    expect(result.accountLast4).toBe('1234');
  });

  test('pads short account numbers to 4 chars', () => {
    const result = maskAccountDetails(
      JSON.stringify({ accountHolder: 'Test', account: 'AB' })
    );
    // 'AB' is 2 chars, padded to 4 → '**AB', last 4 → '**AB'
    expect(result.accountLast4.length).toBe(4);
    expect(result.accountLast4.endsWith('AB')).toBe(true);
  });

  test('returns empty accountHolder when field missing', () => {
    const result = maskAccountDetails(JSON.stringify({ account: '1234567890' }));
    expect(result.accountHolder).toBe('');
    expect(result.accountLast4).toBe('7890');
  });

  test('throws for invalid JSON', () => {
    expect(() => maskAccountDetails('not json')).toThrow();
  });

  test('end-to-end: encrypt → decrypt → mask', () => {
    withKey(VALID_KEY, () => {
      const original = JSON.stringify({
        accountHolder: 'John Smith',
        account:       '9876543210',
      });
      const ciphertext = encrypt(original);
      const decrypted  = decrypt(ciphertext);
      const masked     = maskAccountDetails(decrypted);

      expect(masked.accountHolder).toBe('John Smith');
      expect(masked.accountLast4).toBe('3210');
      // Original full account must NOT be present in the masked output
      expect(JSON.stringify(masked)).not.toContain('9876543210');
    });
  });
});

// ─── isEncrypted ──────────────────────────────────────────────────────────────

describe('isEncrypted()', () => {
  test('returns true for ciphertext produced by encrypt()', () => {
    withKey(VALID_KEY, () => {
      const c = encrypt('test');
      expect(isEncrypted(c)).toBe(true);
    });
  });

  test('returns false for plain JSON string', () => {
    expect(isEncrypted('{"accountHolder":"Jane"}')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });

  test('returns false for non-string input', () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(123)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  test('returns false for 2-part colon-separated string', () => {
    expect(isEncrypted('abc:def')).toBe(false);
  });

  test('returns false for 4-part colon-separated string', () => {
    expect(isEncrypted('a:b:c:d')).toBe(false);
  });

  test('returns true for valid 3-part base64 string', () => {
    // Valid format even without actually decrypting
    expect(isEncrypted('aGVsbG8=:d29ybGQ=:Zm9v')).toBe(true);
  });
});
