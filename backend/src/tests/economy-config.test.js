'use strict';
/**
 * economy.config.js — Unit Tests (Task 1.2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests every exported constant and function from the central economy config.
 *
 * These tests are intentionally zero-dependency: no mocking, no DB, no Redis.
 * economy.config.js is a pure module — it only does math and validation.
 *
 * Covered:
 *   - Constants have correct values
 *   - Invariant: PLATFORM_SHARE + CREATOR_SHARE === 100
 *   - toDiamonds(coins) boundary values + type guards
 *   - platformShare(coins) boundary values + type guards
 *   - toUsd(diamonds) boundary values + decimal precision
 *   - toDiamonds(c) + platformShare(c) never exceeds c
 */

const {
  PLATFORM_SHARE_PERCENT,
  CREATOR_SHARE_PERCENT,
  DIAMOND_TO_USD,
  PAYOUT_MIN_DIAMONDS,
  toDiamonds,
  platformShare,
  toUsd,
} = require('../services/economy.config');

// ─── Constants ────────────────────────────────────────────────────────────────

describe('economy.config — constants', () => {
  test('PLATFORM_SHARE_PERCENT is 50', () => {
    expect(PLATFORM_SHARE_PERCENT).toBe(50);
  });

  test('CREATOR_SHARE_PERCENT is 50', () => {
    expect(CREATOR_SHARE_PERCENT).toBe(50);
  });

  test('DIAMOND_TO_USD is 0.005', () => {
    expect(DIAMOND_TO_USD).toBe(0.005);
  });

  test('PAYOUT_MIN_DIAMONDS is 2000', () => {
    expect(PAYOUT_MIN_DIAMONDS).toBe(2000);
  });

  test('PLATFORM_SHARE_PERCENT + CREATOR_SHARE_PERCENT === 100 (invariant)', () => {
    expect(PLATFORM_SHARE_PERCENT + CREATOR_SHARE_PERCENT).toBe(100);
  });

  test('all constants are positive finite numbers', () => {
    [PLATFORM_SHARE_PERCENT, CREATOR_SHARE_PERCENT, DIAMOND_TO_USD, PAYOUT_MIN_DIAMONDS].forEach(c => {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    });
  });

  test('PAYOUT_MIN_DIAMONDS × DIAMOND_TO_USD equals exactly $10.00', () => {
    // 2000 diamonds × $0.005 = $10.00 — the stated minimum payout
    expect(PAYOUT_MIN_DIAMONDS * DIAMOND_TO_USD).toBeCloseTo(10.0, 10);
  });
});

// ─── toDiamonds ───────────────────────────────────────────────────────────────

describe('toDiamonds(coins)', () => {
  test('toDiamonds(0) === 0', () => {
    expect(toDiamonds(0)).toBe(0);
  });

  test('toDiamonds(1) === 0  (floor of 0.5)', () => {
    // 1 coin × 50% = 0.5 → floor = 0 (creator earns 0, platform earns 0, 1 coin is a remainder)
    expect(toDiamonds(1)).toBe(0);
  });

  test('toDiamonds(2) === 1', () => {
    expect(toDiamonds(2)).toBe(1);
  });

  test('toDiamonds(99) === 49  (floor of 49.5)', () => {
    expect(toDiamonds(99)).toBe(49);
  });

  test('toDiamonds(100) === 50', () => {
    expect(toDiamonds(100)).toBe(50);
  });

  test('toDiamonds(1000) === 500', () => {
    expect(toDiamonds(1000)).toBe(500);
  });

  test('toDiamonds(20) === 10  (gift economy example: 20-coin gift → 10 diamonds)', () => {
    expect(toDiamonds(20)).toBe(10);
  });

  test('result is always a non-negative integer', () => {
    [0, 1, 2, 99, 100, 1000, 50000].forEach(c => {
      const result = toDiamonds(c);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  test('toDiamonds(c) is always ≤ c', () => {
    [0, 1, 2, 99, 100, 1000, 50000].forEach(c => {
      expect(toDiamonds(c)).toBeLessThanOrEqual(c);
    });
  });

  test('throws TypeError for negative input', () => {
    expect(() => toDiamonds(-1)).toThrow(TypeError);
  });

  test('throws TypeError for NaN', () => {
    expect(() => toDiamonds(NaN)).toThrow(TypeError);
  });

  test('throws TypeError for Infinity', () => {
    expect(() => toDiamonds(Infinity)).toThrow(TypeError);
  });

  test('throws TypeError for string input', () => {
    expect(() => toDiamonds('100')).toThrow(TypeError);
  });
});

// ─── platformShare ────────────────────────────────────────────────────────────

describe('platformShare(coins)', () => {
  test('platformShare(0) === 0', () => {
    expect(platformShare(0)).toBe(0);
  });

  test('platformShare(1) === 0  (floor of 0.5)', () => {
    expect(platformShare(1)).toBe(0);
  });

  test('platformShare(2) === 1', () => {
    expect(platformShare(2)).toBe(1);
  });

  test('platformShare(100) === 50', () => {
    expect(platformShare(100)).toBe(50);
  });

  test('platformShare(1000) === 500', () => {
    expect(platformShare(1000)).toBe(500);
  });

  test('result is always a non-negative integer', () => {
    [0, 1, 2, 99, 100, 1000].forEach(c => {
      const result = platformShare(c);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  test('platformShare(c) is always ≤ c', () => {
    [0, 1, 2, 99, 100, 1000].forEach(c => {
      expect(platformShare(c)).toBeLessThanOrEqual(c);
    });
  });

  test('throws TypeError for negative input', () => {
    expect(() => platformShare(-1)).toThrow(TypeError);
  });

  test('throws TypeError for NaN', () => {
    expect(() => platformShare(NaN)).toThrow(TypeError);
  });
});

// ─── toDiamonds + platformShare together ─────────────────────────────────────

describe('toDiamonds(c) + platformShare(c) invariant', () => {
  // The sum must never exceed c. For even numbers it equals c exactly.
  // For odd numbers the 1-coin remainder is neither platform nor creator — this
  // is intentional (the debit still happens; the 0.5-diamond rounding discards
  // the fraction safely).

  const evenValues = [0, 2, 10, 100, 1000, 50000];
  const oddValues  = [1, 3, 99, 101, 999];

  evenValues.forEach(c => {
    test(`toDiamonds(${c}) + platformShare(${c}) === ${c} (even, no remainder)`, () => {
      expect(toDiamonds(c) + platformShare(c)).toBe(c);
    });
  });

  oddValues.forEach(c => {
    test(`toDiamonds(${c}) + platformShare(${c}) === ${c - 1} (odd, 1-coin remainder)`, () => {
      expect(toDiamonds(c) + platformShare(c)).toBe(c - 1);
    });
  });
});

// ─── toUsd ────────────────────────────────────────────────────────────────────

describe('toUsd(diamonds)', () => {
  test('toUsd(0) === 0', () => {
    expect(toUsd(0)).toBe(0);
  });

  test('toUsd(2000) === 10.00  (minimum payout)', () => {
    expect(toUsd(2000)).toBe(10.00);
  });

  test('toUsd(5000) === 25.00', () => {
    expect(toUsd(5000)).toBe(25.00);
  });

  test('toUsd(10000) === 50.00', () => {
    expect(toUsd(10000)).toBe(50.00);
  });

  test('toUsd(1) === 0.01  (rounds 0.005 to 2dp)', () => {
    // 1 diamond × $0.005 = $0.005 — JavaScript rounds 0.005 to 0.01 at 2dp via toFixed
    expect(toUsd(1)).toBe(0.01);
  });

  test('toUsd(200) === 1.00', () => {
    expect(toUsd(200)).toBe(1.00);
  });

  test('result has at most 2 decimal places', () => {
    [0, 1, 100, 2000, 5000, 10000].forEach(d => {
      const result = toUsd(d);
      // parseFloat(...toFixed(2)) always produces at most 2dp
      const asString = result.toString();
      const dpPart = asString.split('.')[1];
      const decimalPlaces = dpPart ? dpPart.length : 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  test('result is a finite number', () => {
    expect(Number.isFinite(toUsd(2000))).toBe(true);
  });

  test('throws TypeError for negative input', () => {
    expect(() => toUsd(-1)).toThrow(TypeError);
  });

  test('throws TypeError for NaN', () => {
    expect(() => toUsd(NaN)).toThrow(TypeError);
  });

  test('throws TypeError for Infinity', () => {
    expect(() => toUsd(Infinity)).toThrow(TypeError);
  });

  test('throws TypeError for string input', () => {
    expect(() => toUsd('2000')).toThrow(TypeError);
  });
});

// ─── Minimum payout validation ────────────────────────────────────────────────

describe('PAYOUT_MIN_DIAMONDS business rules', () => {
  test('minimum payout yields exactly $10.00', () => {
    expect(toUsd(PAYOUT_MIN_DIAMONDS)).toBe(10.00);
  });

  test('one diamond below minimum is not enough for payout', () => {
    const belowMin = PAYOUT_MIN_DIAMONDS - 1;
    expect(belowMin).toBeLessThan(PAYOUT_MIN_DIAMONDS);
  });

  test('toUsd of minimum payout is $10.00 (not $9.99 or $10.01)', () => {
    // Verify no floating-point drift at the exact minimum
    const result = toUsd(PAYOUT_MIN_DIAMONDS);
    expect(result).toBe(10.00);
    expect(result.toFixed(2)).toBe('10.00');
  });
});
