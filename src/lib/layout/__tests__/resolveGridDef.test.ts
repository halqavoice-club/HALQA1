/**
 * resolveGridDef.test.ts
 *
 * Unit tests for the `resolveGridDef` pure function.
 * Covers all 8 layout modes specified in Requirements 1.1–1.8 / 2.1–2.8.
 */

import { describe, it, expect } from 'vitest';
import { resolveGridDef } from '../computeLayout';
import { AUTO_GRID } from '../layoutTypes';

// ---------------------------------------------------------------------------
// auto mode (Requirement 1.1–1.7 + pagination at >16)
// ---------------------------------------------------------------------------
describe('resolveGridDef — auto mode', () => {
  it('null manualMode defaults to auto', () => {
    const result = resolveGridDef(4, null);
    expect(result).toEqual(AUTO_GRID[4]);
  });

  it('count=1 → 1×1', () => {
    expect(resolveGridDef(1, 'auto')).toEqual({ columns: 1, rows: 1 });
  });

  it('count=2 → 2×1', () => {
    expect(resolveGridDef(2, 'auto')).toEqual({ columns: 2, rows: 1 });
  });

  it('count=3 → 2×2', () => {
    expect(resolveGridDef(3, 'auto')).toEqual({ columns: 2, rows: 2 });
  });

  it('count=4 → 2×2', () => {
    expect(resolveGridDef(4, 'auto')).toEqual({ columns: 2, rows: 2 });
  });

  it('count=5 → 3×2', () => {
    expect(resolveGridDef(5, 'auto')).toEqual({ columns: 3, rows: 2 });
  });

  it('count=6 → 3×2', () => {
    expect(resolveGridDef(6, 'auto')).toEqual({ columns: 3, rows: 2 });
  });

  it('count=9 → 3×3', () => {
    expect(resolveGridDef(9, 'auto')).toEqual({ columns: 3, rows: 3 });
  });

  it('count=12 → 4×3', () => {
    expect(resolveGridDef(12, 'auto')).toEqual({ columns: 4, rows: 3 });
  });

  it('count=16 → 4×4', () => {
    expect(resolveGridDef(16, 'auto')).toEqual({ columns: 4, rows: 4 });
  });

  it('count=17 → 4×4 (pagination threshold)', () => {
    expect(resolveGridDef(17, 'auto')).toEqual({ columns: 4, rows: 4 });
  });

  it('count=100 → 4×4 (large audience paginates)', () => {
    expect(resolveGridDef(100, 'auto')).toEqual({ columns: 4, rows: 4 });
  });

  it('count=0 clamps to 1 and uses 1×1 grid', () => {
    expect(resolveGridDef(0, 'auto')).toEqual({ columns: 1, rows: 1 });
  });

  it('matches AUTO_GRID for all counts 1–16', () => {
    for (let n = 1; n <= 16; n++) {
      expect(resolveGridDef(n, 'auto')).toEqual(AUTO_GRID[n]);
    }
  });
});

// ---------------------------------------------------------------------------
// minimal mode — must delegate to auto path (Requirement 2.8)
// ---------------------------------------------------------------------------
describe('resolveGridDef — minimal mode', () => {
  it('minimal with count=9 returns same grid as auto', () => {
    expect(resolveGridDef(9, 'minimal')).toEqual(resolveGridDef(9, 'auto'));
  });

  it('minimal with count=20 returns 4×4 like auto', () => {
    expect(resolveGridDef(20, 'minimal')).toEqual({ columns: 4, rows: 4 });
  });
});

// ---------------------------------------------------------------------------
// grid mode — smallest square (Requirement 2.2)
// ---------------------------------------------------------------------------
describe('resolveGridDef — grid mode', () => {
  it('count=1 → 1×1', () => {
    expect(resolveGridDef(1, 'grid')).toEqual({ columns: 1, rows: 1 });
  });

  it('count=4 → 2×2 (perfect square)', () => {
    expect(resolveGridDef(4, 'grid')).toEqual({ columns: 2, rows: 2 });
  });

  it('count=5 → 3×3 (smallest square that fits)', () => {
    expect(resolveGridDef(5, 'grid')).toEqual({ columns: 3, rows: 3 });
  });

  it('count=9 → 3×3', () => {
    expect(resolveGridDef(9, 'grid')).toEqual({ columns: 3, rows: 3 });
  });

  it('count=10 → 4×4', () => {
    expect(resolveGridDef(10, 'grid')).toEqual({ columns: 4, rows: 4 });
  });

  it('count=16 → 4×4', () => {
    expect(resolveGridDef(16, 'grid')).toEqual({ columns: 4, rows: 4 });
  });

  it('count=17 → 5×5', () => {
    expect(resolveGridDef(17, 'grid')).toEqual({ columns: 5, rows: 5 });
  });

  it('count=0 clamps to 1×1 minimum', () => {
    expect(resolveGridDef(0, 'grid')).toEqual({ columns: 1, rows: 1 });
  });

  it('resulting grid always fits all speakers (columns*rows >= count)', () => {
    for (let n = 1; n <= 50; n++) {
      const def = resolveGridDef(n, 'grid');
      expect(def.columns * def.rows).toBeGreaterThanOrEqual(n);
    }
  });

  it('grid is always square (columns === rows)', () => {
    for (let n = 1; n <= 50; n++) {
      const def = resolveGridDef(n, 'grid');
      expect(def.columns).toBe(def.rows);
    }
  });
});

// ---------------------------------------------------------------------------
// focus-host mode (Requirement 2.3)
// ---------------------------------------------------------------------------
describe('resolveGridDef — focus-host mode', () => {
  it('returns 2×2 base grid', () => {
    const def = resolveGridDef(4, 'focus-host');
    expect(def.columns).toBe(2);
    expect(def.rows).toBe(2);
  });

  it('includes hostSpan colSpan=2 rowSpan=2', () => {
    const def = resolveGridDef(4, 'focus-host');
    expect(def.hostSpan).toEqual({ colSpan: 2, rowSpan: 2 });
  });

  it('grid is the same regardless of speaker count', () => {
    const defSmall = resolveGridDef(1, 'focus-host');
    const defLarge = resolveGridDef(50, 'focus-host');
    expect(defSmall).toEqual(defLarge);
  });
});

// ---------------------------------------------------------------------------
// podcast mode (Requirement 2.4)
// ---------------------------------------------------------------------------
describe('resolveGridDef — podcast mode', () => {
  it('always returns 2×3 grid', () => {
    expect(resolveGridDef(6, 'podcast')).toEqual({ columns: 2, rows: 3 });
  });

  it('grid capacity is exactly 6 (caps display at 6 speakers)', () => {
    const def = resolveGridDef(10, 'podcast');
    expect(def.columns * def.rows).toBe(6);
  });

  it('same grid for any count', () => {
    const def1 = resolveGridDef(1, 'podcast');
    const def2 = resolveGridDef(100, 'podcast');
    expect(def1).toEqual(def2);
  });
});

// ---------------------------------------------------------------------------
// classroom mode (Requirement 2.5)
// ---------------------------------------------------------------------------
describe('resolveGridDef — classroom mode', () => {
  it('always uses 4 columns', () => {
    for (const n of [1, 5, 9, 20]) {
      expect(resolveGridDef(n, 'classroom').columns).toBe(4);
    }
  });

  it('hostSpan spans full top row (colSpan=4, rowSpan=1)', () => {
    const def = resolveGridDef(9, 'classroom');
    expect(def.hostSpan).toEqual({ colSpan: 4, rowSpan: 1 });
  });

  it('count=1 (owner only) → 1 row', () => {
    // 0 students → ceil(0/4)=0 student rows + 1 host row = 1
    expect(resolveGridDef(1, 'classroom').rows).toBe(1);
  });

  it('count=5 (1 owner + 4 students) → 2 rows', () => {
    // ceil(4/4)=1 student row + 1 host row = 2
    expect(resolveGridDef(5, 'classroom').rows).toBe(2);
  });

  it('count=9 (1 owner + 8 students) → 3 rows', () => {
    // ceil(8/4)=2 student rows + 1 = 3
    expect(resolveGridDef(9, 'classroom').rows).toBe(3);
  });

  it('count=13 (1 owner + 12 students) → 4 rows', () => {
    // ceil(12/4)=3 + 1 = 4
    expect(resolveGridDef(13, 'classroom').rows).toBe(4);
  });

  it('rows formula = ceil((count-1)/4) + 1 for arbitrary counts', () => {
    for (const n of [2, 6, 10, 17, 25]) {
      const expected = Math.ceil((n - 1) / 4) + 1;
      expect(resolveGridDef(n, 'classroom').rows).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// compact mode (Requirement 2.6)
// ---------------------------------------------------------------------------
describe('resolveGridDef — compact mode', () => {
  it('always has 3 rows', () => {
    for (const n of [1, 6, 12, 30]) {
      expect(resolveGridDef(n, 'compact').rows).toBe(3);
    }
  });

  it('seatAspect is 0.75', () => {
    expect(resolveGridDef(6, 'compact').seatAspect).toBe(0.75);
  });

  it('columns minimum is 4 even for small counts', () => {
    expect(resolveGridDef(1, 'compact').columns).toBe(4);
    expect(resolveGridDef(3, 'compact').columns).toBe(4);
  });

  it('count=12 → ceil(12/3)=4 columns', () => {
    expect(resolveGridDef(12, 'compact').columns).toBe(4);
  });

  it('count=13 → ceil(13/3)=5 columns', () => {
    expect(resolveGridDef(13, 'compact').columns).toBe(5);
  });

  it('count=30 → ceil(30/3)=10 columns', () => {
    expect(resolveGridDef(30, 'compact').columns).toBe(10);
  });

  it('columns = max(4, ceil(count/3)) for various counts', () => {
    for (const n of [0, 1, 6, 9, 12, 15, 24]) {
      const expected = Math.max(4, Math.ceil(n / 3));
      expect(resolveGridDef(n, 'compact').columns).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// pk mode (Requirement 2.7 / 6.1–6.3)
// ---------------------------------------------------------------------------
describe('resolveGridDef — pk mode', () => {
  it('always has 2 columns', () => {
    for (const n of [1, 2, 6, 10]) {
      expect(resolveGridDef(n, 'pk').columns).toBe(2);
    }
  });

  it('count=2 → 1 row', () => {
    expect(resolveGridDef(2, 'pk').rows).toBe(1);
  });

  it('count=4 → 2 rows', () => {
    expect(resolveGridDef(4, 'pk').rows).toBe(2);
  });

  it('count=5 → 3 rows (ceil(5/2))', () => {
    expect(resolveGridDef(5, 'pk').rows).toBe(3);
  });

  it('count=6 → 3 rows', () => {
    expect(resolveGridDef(6, 'pk').rows).toBe(3);
  });

  it('minimum 1 row when count=0', () => {
    expect(resolveGridDef(0, 'pk').rows).toBe(1);
  });

  it('rows = ceil(count/2) for all counts 1–20', () => {
    for (let n = 1; n <= 20; n++) {
      expect(resolveGridDef(n, 'pk').rows).toBe(Math.ceil(n / 2));
    }
  });
});
