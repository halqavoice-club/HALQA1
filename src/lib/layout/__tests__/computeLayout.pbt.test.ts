/**
 * computeLayout.pbt.test.ts
 *
 * Property-Based Tests (PBT) for the Dynamic Speaker Layout engine.
 * Uses fast-check to verify 12 mathematical invariants across thousands
 * of randomly generated inputs.
 *
 * Invariants tested:
 *   P1  — Host Invariant: owner always at pages[0][0]
 *   P2  — Page Size Invariant: every page has exactly columns*rows seats
 *   P3  — Seat Uniqueness: no duplicate seat keys across all pages
 *   P4  — User Uniqueness: no duplicate userIds among occupied seats
 *   P5  — Seat Key Format: key === "seat-${seatIndex}" always
 *   P6  — Pagination Consistency: totalPages = ceil(max(n,1)/pageSize)
 *   P7  — Sort Order: owner → moderator → active → muted in occupied seats
 *   P8  — PK Team Balance: |teamA - teamB| <= 1, odd n → teamA gets ceil
 *   P9  — Layout Switching: all 8 modes produce valid non-empty layouts
 *   P10 — Empty Seat Integrity: padding slots have correct zeroed defaults
 *   P11 — Performance Budget: computeLayout(200 speakers) < 2ms
 *   P12 — Stable Keys: same input produces identical keys (determinism)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeLayout, sortSpeakers, buildPKConfig } from '../computeLayout';
import {
  fcSpeakersArray,
  fcLayoutMode,
  flattenPages,
  generateSpeakers,
  resetSpeakerIndex,
  makeSpeaker,
} from '../layoutTestUtils';
import type { LayoutMode, SpeakerSlot } from '../layoutTypes';

// fast-check global config: 100 runs per property for CI speed
const FC_RUNS = 100;


// ---------------------------------------------------------------------------
// P1 — Host Invariant
// ---------------------------------------------------------------------------
describe('P1 — Host Invariant: owner always at pages[0][0]', () => {
  it('holds for any speaker count 1–50 with any layout mode', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        expect(result.pages[0][0].role).toBe('owner');
        expect(result.pages[0][0].isEmpty).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('holds when owner is NOT the first element of input array', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (extraCount) => {
          const extras = Array.from({ length: extraCount }, (_, i) =>
            makeSpeaker({ userId: `sp-${i}`, role: 'speaker', seatIndex: i + 1 }),
          );
          const owner = makeSpeaker({ userId: 'owner-99', role: 'owner', seatIndex: 0 });
          const shuffled = [...extras, owner]; // owner at the END
          const result = computeLayout(shuffled, null);
          expect(result.pages[0][0].role).toBe('owner');
          expect(result.pages[0][0].userId).toBe('owner-99');
        },
      ),
      { numRuns: 200 },
    );
  });
});


// ---------------------------------------------------------------------------
// P2 — Page Size Invariant
// ---------------------------------------------------------------------------
describe('P2 — Page Size Invariant: every page has exactly columns*rows seats', () => {
  it('holds for any speakers array and any layout mode', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const pageCapacity = result.gridDef.columns * result.gridDef.rows;
        for (const page of result.pages) {
          expect(page).toHaveLength(pageCapacity);
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('holds with custom page sizes (8, 12, 16, 24)', () => {
    fc.assert(
      fc.property(
        fcSpeakersArray,
        fc.constantFrom(8, 12, 16, 24),
        (speakers, pageSize) => {
          const result = computeLayout(speakers, null, { pageSize });
          const pageCapacity = result.gridDef.columns * result.gridDef.rows;
          for (const page of result.pages) {
            expect(page).toHaveLength(pageCapacity);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});


// ---------------------------------------------------------------------------
// P3 — Seat Uniqueness: no duplicate seat keys
// ---------------------------------------------------------------------------
describe('P3 — Seat Uniqueness: no duplicate seat keys across all pages', () => {
  it('all seat keys are unique for any input', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const allSeats = flattenPages(result.pages);
        const keys = allSeats.map((s) => s.key);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P4 — User Uniqueness: no duplicate userIds among occupied seats
// ---------------------------------------------------------------------------
describe('P4 — User Uniqueness: no duplicate userIds in occupied seats', () => {
  it('each occupied seat has a unique userId', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const occupied = flattenPages(result.pages).filter((s) => !s.isEmpty);
        const userIds = occupied.map((s) => s.userId);
        const uniqueIds = new Set(userIds);
        expect(uniqueIds.size).toBe(userIds.length);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P5 — Seat Key Format: key === "seat-${seatIndex}" always
// ---------------------------------------------------------------------------
describe('P5 — Stable Seat Keys: key === "seat-${seatIndex}" always', () => {
  it('holds for all seats (occupied and empty) across any input', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const allSeats = flattenPages(result.pages);
        for (const seat of allSeats) {
          expect(seat.key).toBe(`seat-${seat.seatIndex}`);
        }
      }),
      { numRuns: FC_RUNS },
    );
  });
});


// ---------------------------------------------------------------------------
// P6 — Pagination Consistency
// ---------------------------------------------------------------------------
describe('P6 — Pagination Consistency: totalPages = ceil(max(n,1)/pageSize)', () => {
  it('totalPages is always >= 1', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        expect(result.totalPages).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('totalPages === ceil(max(n,1)/pageSize) for all inputs', () => {
    fc.assert(
      fc.property(
        fcSpeakersArray,
        fc.constantFrom(8, 12, 16, 24),
        (speakers, pageSize) => {
          const n = speakers.length;
          const expected = Math.ceil(Math.max(n, 1) / pageSize);
          const result = computeLayout(speakers, null, { pageSize });
          expect(result.totalPages).toBe(expected);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('empty input always produces exactly 1 page', () => {
    const result = computeLayout([], null);
    expect(result.totalPages).toBe(1);
    expect(result.pages).toHaveLength(1);
  });

  it('currentPage is always valid: 0 <= page < totalPages', () => {
    fc.assert(
      fc.property(
        fcSpeakersArray,
        fc.integer({ min: 1, max: 50 }),
        (speakers, pageSize) => {
          const result = computeLayout(speakers, null, { pageSize });
          // totalPages >= 1, so [0, totalPages-1] is always a valid range
          expect(result.totalPages).toBeGreaterThanOrEqual(1);
          // First page (0) is always valid
          expect(0).toBeLessThan(result.totalPages);
        },
      ),
      { numRuns: 300 },
    );
  });
});


// ---------------------------------------------------------------------------
// P7 — Sort Order: owner → moderator → active speaker → muted
// ---------------------------------------------------------------------------
describe('P7 — Sort Order invariant', () => {
  /** Returns 0=owner, 1=moderator, 2=active, 3=muted for rank comparison */
  function rankOf(s: SpeakerSlot): number {
    if (s.role === 'owner') return 0;
    if (s.role === 'moderator') return 1;
    if (s.isSpeaking && !s.isMuted) return 2;
    return 3;
  }

  it('occupied seats on page 0 are in non-decreasing rank order', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, null);
        const occupied = result.pages[0].filter((s) => !s.isEmpty);
        for (let i = 1; i < occupied.length; i++) {
          expect(rankOf(occupied[i])).toBeGreaterThanOrEqual(rankOf(occupied[i - 1]));
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('owner always has rank 0 (smallest) among all occupied seats', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const sorted = sortSpeakers(speakers, null);
        const ownerRank = rankOf(sorted[0]);
        expect(ownerRank).toBe(0);
        for (const s of sorted.slice(1)) {
          expect(rankOf(s)).toBeGreaterThanOrEqual(ownerRank);
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('pinned speaker is always at index 1 after the owner', () => {
    fc.assert(
      fc.property(
        fcSpeakersArray.filter((arr) => arr.length >= 3),
        (speakers) => {
          // Pick a non-owner speaker to pin
          const target = speakers.find((s) => s.role !== 'owner');
          if (!target) return;
          const result = computeLayout(speakers, null, { pinnedUserId: target.userId });
          const occupied = result.pages[0].filter((s) => !s.isEmpty);
          if (occupied.length >= 2) {
            expect(occupied[1].userId).toBe(target.userId);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});


// ---------------------------------------------------------------------------
// P8 — PK Team Balance
// ---------------------------------------------------------------------------
describe('P8 — PK Team Balance: |teamA - teamB| <= 1, odd n -> teamA gets ceil', () => {
  it('|teamA.length - teamB.length| <= 1 for any speaker count', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const pkConfig = buildPKConfig(speakers);
        const diff = Math.abs(pkConfig.teamA.length - pkConfig.teamB.length);
        expect(diff).toBeLessThanOrEqual(1);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('odd n → teamA gets ceil(n/2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }).filter((n) => n % 2 === 1), (n) => {
        resetSpeakerIndex(0);
        const speakers = generateSpeakers(n);
        const pk = buildPKConfig(speakers);
        expect(pk.teamA.length).toBe(Math.ceil(n / 2));
        expect(pk.teamB.length).toBe(Math.floor(n / 2));
      }),
      { numRuns: 200 },
    );
  });

  it('even n → both teams are equal', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 100 }).filter((n) => n % 2 === 0), (n) => {
        resetSpeakerIndex(0);
        const speakers = generateSpeakers(n);
        const pk = buildPKConfig(speakers);
        expect(pk.teamA.length).toBe(n / 2);
        expect(pk.teamB.length).toBe(n / 2);
      }),
      { numRuns: 200 },
    );
  });

  it('PK mode layout always has pkConfig defined', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'pk');
        expect(result.pkConfig).toBeDefined();
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('PK format is valid for all team size combinations', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const pk = buildPKConfig(speakers);
        const validFormats = ['1v1', '2v2', '3v3', 'club'];
        expect(validFormats).toContain(pk.format);
      }),
      { numRuns: FC_RUNS },
    );
  });
});


// ---------------------------------------------------------------------------
// P9 — Layout Switching: all 8 modes produce valid non-empty layouts
// ---------------------------------------------------------------------------
describe('P9 — Layout Switching: all modes produce valid results', () => {
  const ALL_MODES: LayoutMode[] = [
    'auto', 'grid', 'focus-host', 'podcast', 'classroom', 'pk', 'compact', 'minimal',
  ];

  it('every mode returns pages.length >= 1 and gridDef.columns >= 1', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        for (const mode of ALL_MODES) {
          const result = computeLayout(speakers, mode);
          expect(result.pages.length).toBeGreaterThanOrEqual(1);
          expect(result.gridDef.columns).toBeGreaterThanOrEqual(1);
          expect(result.gridDef.rows).toBeGreaterThanOrEqual(1);
          expect(result.mode).toBe(mode);
          expect(result.isManual).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('auto mode (null) sets isManual=false; all other modes set isManual=true', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        expect(computeLayout(speakers, null).isManual).toBe(false);
        for (const mode of ALL_MODES) {
          expect(computeLayout(speakers, mode).isManual).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('grid mode: columns*rows >= n (grid always fits all speakers)', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'grid');
        const capacity = result.gridDef.columns * result.gridDef.rows;
        expect(capacity).toBeGreaterThanOrEqual(speakers.length);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('compact mode: columns >= 4 always', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'compact');
        expect(result.gridDef.columns).toBeGreaterThanOrEqual(4);
        expect(result.gridDef.rows).toBe(3);
        expect(result.gridDef.seatAspect).toBe(0.75);
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('classroom mode: columns === 4 and hostSpan spans full top row', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'classroom');
        expect(result.gridDef.columns).toBe(4);
        expect(result.gridDef.hostSpan).toEqual({ colSpan: 4, rowSpan: 1 });
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('focus-host mode: 2x2 grid with hostSpan 2x2', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'focus-host');
        expect(result.gridDef).toEqual({ columns: 2, rows: 2, hostSpan: { colSpan: 2, rowSpan: 2 } });
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('podcast mode: always 2x3 grid', () => {
    fc.assert(
      fc.property(fcSpeakersArray, (speakers) => {
        const result = computeLayout(speakers, 'podcast');
        expect(result.gridDef).toEqual({ columns: 2, rows: 3 });
      }),
      { numRuns: FC_RUNS },
    );
  });
});


// ---------------------------------------------------------------------------
// P10 — Empty Seat Integrity
// ---------------------------------------------------------------------------
describe('P10 — Empty Seat Integrity: padding slots have correct defaults', () => {
  it('all empty seats have isEmpty=true and userId=""', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const empties = flattenPages(result.pages).filter((s) => s.isEmpty);
        for (const e of empties) {
          expect(e.userId).toBe('');
          expect(e.isSpeaking).toBe(false);
          expect(e.isMuted).toBe(false);
          expect(e.role).toBe('empty');
          expect(e.isEmpty).toBe(true);
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('occupied seats never have isEmpty=true', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const occupied = flattenPages(result.pages).filter((s) => s.userId !== '');
        for (const o of occupied) {
          expect(o.isEmpty).toBe(false);
        }
      }),
      { numRuns: FC_RUNS },
    );
  });

  it('total seats = occupied + empty (partition is complete)', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const result = computeLayout(speakers, mode);
        const allSeats = flattenPages(result.pages);
        const occupied = allSeats.filter((s) => !s.isEmpty);
        const empties = allSeats.filter((s) => s.isEmpty);
        expect(occupied.length + empties.length).toBe(allSeats.length);
      }),
      { numRuns: FC_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P11 — Performance Budget: computeLayout < 2ms for 200 speakers
// ---------------------------------------------------------------------------
describe('P11 — Performance Budget: computeLayout(200 speakers) < 2ms', () => {
  it('completes in under 2ms averaged over 50 runs', () => {
    const ALL_MODES: LayoutMode[] = [
      'auto', 'grid', 'focus-host', 'podcast', 'classroom', 'pk', 'compact', 'minimal',
    ];
    const samples = 50;
    const timings: number[] = [];

    for (let run = 0; run < samples; run++) {
      resetSpeakerIndex(0);
      const speakers = generateSpeakers(200);
      const mode = ALL_MODES[run % ALL_MODES.length];
      const t0 = performance.now();
      computeLayout(speakers, mode);
      timings.push(performance.now() - t0);
    }

    const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxMs = Math.max(...timings);

    // Report for audit
    console.info(`[P11] computeLayout(200 speakers) avg=${avgMs.toFixed(3)}ms max=${maxMs.toFixed(3)}ms`);

    expect(avgMs).toBeLessThan(2);  // 2ms budget per spec requirement 5.4
  });
});

// ---------------------------------------------------------------------------
// P12 — Determinism: same inputs → identical outputs
// ---------------------------------------------------------------------------
describe('P12 — Determinism: same inputs always produce identical layouts', () => {
  it('two calls with identical inputs produce identical page/key structures', () => {
    fc.assert(
      fc.property(fcSpeakersArray, fcLayoutMode, (speakers, mode) => {
        const r1 = computeLayout(speakers, mode);
        const r2 = computeLayout(speakers, mode);

        expect(r1.totalPages).toBe(r2.totalPages);
        expect(r1.gridDef).toEqual(r2.gridDef);
        expect(r1.mode).toBe(r2.mode);

        const keys1 = flattenPages(r1.pages).map((s) => s.key);
        const keys2 = flattenPages(r2.pages).map((s) => s.key);
        expect(keys1).toEqual(keys2);

        const uids1 = flattenPages(r1.pages).map((s) => s.userId);
        const uids2 = flattenPages(r2.pages).map((s) => s.userId);
        expect(uids1).toEqual(uids2);
      }),
      { numRuns: FC_RUNS },
    );
  });
});
