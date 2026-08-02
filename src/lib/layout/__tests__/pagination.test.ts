/**
 * pagination.test.ts
 *
 * Unit tests for `buildPages` and the pagination behaviour of `computeLayout`.
 * Covers Requirements 3.1–3.2, 3.9, 5.1–5.2, 9.1–9.6.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildPages, computeLayout } from '../computeLayout';
import { generateSpeakers, flattenPages, resetSpeakerIndex } from '../layoutTestUtils';
import type { GridDefinition } from '../layoutTypes';

beforeEach(() => resetSpeakerIndex(0));

// ---------------------------------------------------------------------------
// buildPages — page size / capacity
// ---------------------------------------------------------------------------
describe('buildPages — every page is exactly pageCapacity entries', () => {
  it('2×2 grid, 4 speakers → 1 page of 4 entries', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(4);
    const gridDef: GridDefinition = { columns: 2, rows: 2 };
    const pages = buildPages(speakers, gridDef, 16);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(4); // 2*2
  });

  it('4×4 grid, 16 speakers → 1 page of 16 entries', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(16);
    const gridDef: GridDefinition = { columns: 4, rows: 4 };
    const pages = buildPages(speakers, gridDef, 16);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(16);
  });

  it('4×4 grid, 17 speakers → 2 pages of 16 entries each', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(17);
    const gridDef: GridDefinition = { columns: 4, rows: 4 };
    const pages = buildPages(speakers, gridDef, 16);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(16);
    expect(pages[1]).toHaveLength(16);
  });

  it('3×3 grid, 7 speakers → 1 page of 9 (2 empty padding)', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(7);
    const gridDef: GridDefinition = { columns: 3, rows: 3 };
    const pages = buildPages(speakers, gridDef, 16);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(9); // 3*3
    const emptyCount = pages[0].filter(s => s.isEmpty).length;
    expect(emptyCount).toBe(2);
  });

  it('every page has exactly gridDef.columns * gridDef.rows entries for various sizes', () => {
    const cases: [number, GridDefinition][] = [
      [1,  { columns: 1, rows: 1 }],
      [5,  { columns: 3, rows: 2 }],
      [9,  { columns: 3, rows: 3 }],
      [20, { columns: 4, rows: 4 }],
    ];
    for (const [count, gridDef] of cases) {
      resetSpeakerIndex(0);
      const speakers = generateSpeakers(count);
      const pages = buildPages(speakers, gridDef, 16);
      const pageCapacity = gridDef.columns * gridDef.rows;
      for (const page of pages) {
        expect(page).toHaveLength(pageCapacity);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildPages — empty input → one full page of empty slots
// ---------------------------------------------------------------------------
describe('buildPages — empty speaker array', () => {
  it('returns exactly 1 page', () => {
    const gridDef: GridDefinition = { columns: 2, rows: 2 };
    const pages = buildPages([], gridDef, 16);
    expect(pages).toHaveLength(1);
  });

  it('the single page has pageCapacity entries', () => {
    const gridDef: GridDefinition = { columns: 3, rows: 3 };
    const pages = buildPages([], gridDef, 16);
    expect(pages[0]).toHaveLength(9);
  });

  it('all entries are empty slots', () => {
    const gridDef: GridDefinition = { columns: 2, rows: 2 };
    const pages = buildPages([], gridDef, 16);
    for (const seat of pages[0]) {
      expect(seat.isEmpty).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty SeatData integrity (Req 9.1–9.6)
// ---------------------------------------------------------------------------
describe('buildPages — empty SeatData fields', () => {
  it('isEmpty === true for every padding slot', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(5);
    const gridDef: GridDefinition = { columns: 3, rows: 2 }; // capacity 6, 1 empty
    const pages = buildPages(speakers, gridDef, 16);
    const empties = pages[0].filter(s => s.isEmpty);
    expect(empties).toHaveLength(1);
    expect(empties[0].isEmpty).toBe(true);
  });

  it('isSpeaking === false for every empty slot', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(3);
    const gridDef: GridDefinition = { columns: 2, rows: 2 };
    const pages = buildPages(speakers, gridDef, 16);
    const empties = flattenPages(pages).filter(s => s.isEmpty);
    for (const seat of empties) {
      expect(seat.isSpeaking).toBe(false);
    }
  });

  it('isMuted === false for every empty slot', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(3);
    const gridDef: GridDefinition = { columns: 2, rows: 2 };
    const pages = buildPages(speakers, gridDef, 16);
    const empties = flattenPages(pages).filter(s => s.isEmpty);
    for (const seat of empties) {
      expect(seat.isMuted).toBe(false);
    }
  });

  it('role === "empty" for every empty slot', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(5);
    const gridDef: GridDefinition = { columns: 3, rows: 2 };
    const pages = buildPages(speakers, gridDef, 16);
    const empties = flattenPages(pages).filter(s => s.isEmpty);
    for (const seat of empties) {
      expect(seat.role).toBe('empty');
    }
  });

  it('userId === "" for every empty slot', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(5);
    const gridDef: GridDefinition = { columns: 3, rows: 2 };
    const pages = buildPages(speakers, gridDef, 16);
    const empties = flattenPages(pages).filter(s => s.isEmpty);
    for (const seat of empties) {
      expect(seat.userId).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Stable seat keys (Req 5.1–5.2)
// ---------------------------------------------------------------------------
describe('buildPages — stable seat keys', () => {
  it('every seat has key === "seat-${seatIndex}"', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(9);
    const gridDef: GridDefinition = { columns: 3, rows: 3 };
    const pages = buildPages(speakers, gridDef, 16);
    const allSeats = flattenPages(pages);
    for (const seat of allSeats) {
      expect(seat.key).toBe(`seat-${seat.seatIndex}`);
    }
  });

  it('empty slot keys follow the same pattern', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(7);
    const gridDef: GridDefinition = { columns: 3, rows: 3 };
    const pages = buildPages(speakers, gridDef, 16);
    const empties = flattenPages(pages).filter(s => s.isEmpty);
    for (const seat of empties) {
      expect(seat.key).toBe(`seat-${seat.seatIndex}`);
    }
  });

  it('no two seats share the same key across all pages', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(20);
    const gridDef: GridDefinition = { columns: 4, rows: 4 };
    const pages = buildPages(speakers, gridDef, 16);
    const keys = flattenPages(pages).map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// computeLayout — totalPages
// ---------------------------------------------------------------------------
describe('computeLayout — totalPages', () => {
  it('empty speakers → totalPages === 1', () => {
    const result = computeLayout([], null);
    expect(result.totalPages).toBe(1);
  });

  it('1 speaker → totalPages === 1', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(1), null);
    expect(result.totalPages).toBe(1);
  });

  it('16 speakers → totalPages === 1 (fills exactly one page)', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(16), null);
    expect(result.totalPages).toBe(1);
  });

  it('17 speakers → totalPages === 2', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(17), null);
    expect(result.totalPages).toBe(2);
  });

  it('32 speakers → totalPages === 2', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(32), null);
    expect(result.totalPages).toBe(2);
  });

  it('33 speakers → totalPages === 3', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(33), null);
    expect(result.totalPages).toBe(3);
  });

  it('totalPages is never less than 1 for any speaker count ≥ 0', () => {
    for (let n = 0; n <= 50; n++) {
      resetSpeakerIndex(0);
      const result = computeLayout(generateSpeakers(n, { withOwner: n > 0 }), null);
      expect(result.totalPages).toBeGreaterThanOrEqual(1);
    }
  });

  it('custom pageSize=4: 8 speakers → 2 pages', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(8), null, { pageSize: 4 });
    expect(result.totalPages).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeLayout — pages array integrity
// ---------------------------------------------------------------------------
describe('computeLayout — pages array', () => {
  it('empty input → pages[0] exists and is non-empty', () => {
    const result = computeLayout([], null);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].length).toBeGreaterThan(0);
  });

  it('all pages have exactly gridDef.columns * gridDef.rows entries', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(20), null);
    const { gridDef, pages } = result;
    const capacity = gridDef.columns * gridDef.rows;
    for (const page of pages) {
      expect(page).toHaveLength(capacity);
    }
  });

  it('totalSpeakers matches the number of non-empty seats in the result', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(7);
    const result = computeLayout(speakers, null);
    expect(result.totalSpeakers).toBe(7);
  });
});
