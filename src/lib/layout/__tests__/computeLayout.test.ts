/**
 * computeLayout.test.ts
 *
 * Unit tests for the main `computeLayout` entry point.
 * Covers auto-mode grid dimensions (1–16 speakers + pagination >16),
 * all manual layout modes, and the key invariants defined in the spec.
 *
 * Requirements: 1.1–1.10, 2.1–2.8, 3.1–3.2, 3.9, 5.1–5.2, 9.1–9.6, 10.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout } from '../computeLayout';
import { generateSpeakers, flattenPages, resetSpeakerIndex } from '../layoutTestUtils';

beforeEach(() => resetSpeakerIndex(0));

// ---------------------------------------------------------------------------
// auto mode — grid dimensions (Requirements 1.1–1.8)
// ---------------------------------------------------------------------------
describe('computeLayout — auto mode grid dimensions', () => {
  it('1 speaker → 1×1 grid', () => {
    const result = computeLayout(generateSpeakers(1), null);
    expect(result.gridDef).toEqual({ columns: 1, rows: 1 });
  });

  it('2 speakers → 2×1 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(2), null);
    expect(result.gridDef).toEqual({ columns: 2, rows: 1 });
  });

  it('3 speakers → 2×2 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(3), null);
    expect(result.gridDef).toEqual({ columns: 2, rows: 2 });
  });

  it('4 speakers → 2×2 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(4), null);
    expect(result.gridDef).toEqual({ columns: 2, rows: 2 });
  });

  it('5 speakers → 3×2 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(5), null);
    expect(result.gridDef).toEqual({ columns: 3, rows: 2 });
  });

  it('6 speakers → 3×2 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(6), null);
    expect(result.gridDef).toEqual({ columns: 3, rows: 2 });
  });

  it('7 speakers → 3×3 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(7), null);
    expect(result.gridDef).toEqual({ columns: 3, rows: 3 });
  });

  it('8 speakers → 3×3 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(8), null);
    expect(result.gridDef).toEqual({ columns: 3, rows: 3 });
  });

  it('9 speakers → 3×3 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(9), null);
    expect(result.gridDef).toEqual({ columns: 3, rows: 3 });
  });

  it('10 speakers → 4×3 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(10), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 3 });
  });

  it('12 speakers → 4×3 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(12), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 3 });
  });

  it('13 speakers → 4×4 grid', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(13), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 4 });
  });

  it('16 speakers → 4×4 grid, 1 page', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(16), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 4 });
    expect(result.totalPages).toBe(1);
  });

  it('17 speakers → 4×4 grid, 2 pages (Req 1.8 — pagination)', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(17), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 4 });
    expect(result.totalPages).toBe(2);
  });

  it('33 speakers → 4×4 grid, 3 pages', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(33), null);
    expect(result.gridDef).toEqual({ columns: 4, rows: 4 });
    expect(result.totalPages).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Requirement 1.9 — owner always at pages[0][0]
// ---------------------------------------------------------------------------
describe('computeLayout — owner always at pages[0][0]', () => {
  it('owner is at pages[0][0] for 1 speaker', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(1), null);
    expect(result.pages[0][0].role).toBe('owner');
  });

  it('owner is at pages[0][0] even when not the first element of input', () => {
    const speakers = [
      ...generateSpeakers(3, { withOwner: false }),
    ];
    // manually add owner at the end
    speakers.push({
      userId: 'late-owner',
      seatIndex: 99,
      role: 'owner',
      displayName: 'Late Owner',
      isMuted: false,
      isSpeaking: false,
      isOnline: true,
      connectionQuality: 'good',
    });
    const result = computeLayout(speakers, null);
    expect(result.pages[0][0].role).toBe('owner');
    expect(result.pages[0][0].userId).toBe('late-owner');
  });

  it('host invariant holds for all counts 1–50', () => {
    for (let n = 1; n <= 50; n++) {
      resetSpeakerIndex(0);
      const result = computeLayout(generateSpeakers(n), null);
      expect(result.pages[0][0].role).toBe('owner');
    }
  });

  it('host invariant holds across all layout modes', () => {
    const modes = ['auto', 'grid', 'focus-host', 'podcast', 'classroom', 'pk', 'compact', 'minimal'] as const;
    for (const mode of modes) {
      resetSpeakerIndex(0);
      const result = computeLayout(generateSpeakers(6), mode);
      expect(result.pages[0][0].role).toBe('owner');
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 1.10 — empty input
// ---------------------------------------------------------------------------
describe('computeLayout — empty input', () => {
  it('totalPages === 1', () => {
    expect(computeLayout([], null).totalPages).toBe(1);
  });

  it('pages has exactly 1 page', () => {
    expect(computeLayout([], null).pages).toHaveLength(1);
  });

  it('all seats on the empty page have isEmpty=true', () => {
    const result = computeLayout([], null);
    for (const seat of result.pages[0]) {
      expect(seat.isEmpty).toBe(true);
    }
  });

  it('totalSpeakers === 0', () => {
    expect(computeLayout([], null).totalSpeakers).toBe(0);
  });

  it('mode is "auto"', () => {
    expect(computeLayout([], null).mode).toBe('auto');
  });

  it('isManual is false', () => {
    expect(computeLayout([], null).isManual).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manual modes — basic correctness
// ---------------------------------------------------------------------------
describe('computeLayout — manual mode: focus-host', () => {
  it('gridDef has columns=2, rows=2', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(4), 'focus-host');
    expect(result.gridDef.columns).toBe(2);
    expect(result.gridDef.rows).toBe(2);
  });

  it('hostSpan is colSpan=2, rowSpan=2', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(4), 'focus-host');
    expect(result.gridDef.hostSpan).toEqual({ colSpan: 2, rowSpan: 2 });
  });

  it('isManual is true', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'focus-host').isManual).toBe(true);
  });

  it('mode is "focus-host"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'focus-host').mode).toBe('focus-host');
  });
});

describe('computeLayout — manual mode: podcast', () => {
  it('gridDef is 2×3', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(6), 'podcast');
    expect(result.gridDef).toEqual({ columns: 2, rows: 3 });
  });

  it('page has exactly 6 entries (2×3)', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(6), 'podcast');
    expect(result.pages[0]).toHaveLength(6);
  });

  it('mode is "podcast"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'podcast').mode).toBe('podcast');
  });
});

describe('computeLayout — manual mode: classroom', () => {
  it('hostSpan spans full top row (colSpan=4, rowSpan=1)', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(9), 'classroom');
    expect(result.gridDef.hostSpan).toEqual({ colSpan: 4, rowSpan: 1 });
  });

  it('has 4 columns', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(9), 'classroom');
    expect(result.gridDef.columns).toBe(4);
  });

  it('mode is "classroom"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(5), 'classroom').mode).toBe('classroom');
  });
});

describe('computeLayout — manual mode: compact', () => {
  it('always has 3 rows', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(6), 'compact');
    expect(result.gridDef.rows).toBe(3);
  });

  it('seatAspect is 0.75', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(6), 'compact');
    expect(result.gridDef.seatAspect).toBe(0.75);
  });

  it('minimum 4 columns even for a small count', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(2), 'compact');
    expect(result.gridDef.columns).toBeGreaterThanOrEqual(4);
  });

  it('mode is "compact"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(6), 'compact').mode).toBe('compact');
  });
});

describe('computeLayout — manual mode: minimal', () => {
  it('gridDef matches auto mode for same speaker count', () => {
    resetSpeakerIndex(0);
    const minResult = computeLayout(generateSpeakers(9), 'minimal');
    resetSpeakerIndex(0);
    const autoResult = computeLayout(generateSpeakers(9), 'auto');
    expect(minResult.gridDef).toEqual(autoResult.gridDef);
  });

  it('mode is "minimal"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'minimal').mode).toBe('minimal');
  });

  it('isManual is true', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'minimal').isManual).toBe(true);
  });
});

describe('computeLayout — manual mode: grid', () => {
  it('square grid: columns === rows', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(9), 'grid');
    expect(result.gridDef.columns).toBe(result.gridDef.rows);
  });

  it('grid fits all speakers: columns*rows >= totalSpeakers', () => {
    for (let n = 1; n <= 16; n++) {
      resetSpeakerIndex(0);
      const result = computeLayout(generateSpeakers(n), 'grid');
      expect(result.gridDef.columns * result.gridDef.rows).toBeGreaterThanOrEqual(n);
    }
  });

  it('mode is "grid"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'grid').mode).toBe('grid');
  });
});

describe('computeLayout — manual mode: pk', () => {
  it('gridDef has 2 columns', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'pk').gridDef.columns).toBe(2);
  });

  it('pkConfig is defined', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'pk').pkConfig).toBeDefined();
  });

  it('pkConfig teamA has ceil(n/2) for odd n', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(5), 'pk');
    expect(result.pkConfig!.teamA).toHaveLength(3);
    expect(result.pkConfig!.teamB).toHaveLength(2);
  });

  it('mode is "pk"', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'pk').mode).toBe('pk');
  });

  it('isManual is true', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'pk').isManual).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearManualMode equivalent — null restores auto behaviour
// ---------------------------------------------------------------------------
describe('computeLayout — clearManualMode (null restores auto)', () => {
  it('null mode after focus-host produces auto grid', () => {
    resetSpeakerIndex(0);
    const speakers = generateSpeakers(4);
    const autoResult = computeLayout(speakers, null);
    const manualResult = computeLayout(speakers, 'focus-host');
    // They should differ in gridDef
    expect(manualResult.gridDef).not.toEqual(autoResult.gridDef);
    // Reset to null restores auto
    const restoredResult = computeLayout(speakers, null);
    expect(restoredResult.gridDef).toEqual(autoResult.gridDef);
    expect(restoredResult.isManual).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Key invariant — seat.key === "seat-${seatIndex}" for all seats
// ---------------------------------------------------------------------------
describe('computeLayout — seat key invariant', () => {
  it('every occupied seat has key === "seat-${seatIndex}"', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(9), null);
    const allSeats = flattenPages(result.pages);
    for (const seat of allSeats) {
      expect(seat.key).toBe(`seat-${seat.seatIndex}`);
    }
  });

  it('empty padding seats also have correct keys', () => {
    resetSpeakerIndex(0);
    const result = computeLayout(generateSpeakers(7), null); // 7 speakers, 3×3 = 9 seats
    const empties = flattenPages(result.pages).filter(s => s.isEmpty);
    expect(empties).toHaveLength(2);
    for (const seat of empties) {
      expect(seat.key).toBe(`seat-${seat.seatIndex}`);
    }
  });
});

// ---------------------------------------------------------------------------
// isManual flag
// ---------------------------------------------------------------------------
describe('computeLayout — isManual flag', () => {
  it('null manualMode → isManual is false', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), null).isManual).toBe(false);
  });

  it('"auto" mode → isManual is true (explicitly passed)', () => {
    resetSpeakerIndex(0);
    expect(computeLayout(generateSpeakers(4), 'auto').isManual).toBe(true);
  });

  it('any non-null mode → isManual is true', () => {
    const modes = ['grid', 'focus-host', 'podcast', 'classroom', 'pk', 'compact', 'minimal'] as const;
    for (const mode of modes) {
      resetSpeakerIndex(0);
      expect(computeLayout(generateSpeakers(4), mode).isManual).toBe(true);
    }
  });
});
