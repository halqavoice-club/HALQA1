/**
 * computeLayout.ts
 *
 * Pure layout computation engine for the Dynamic Speaker Layout System.
 * No React, no I/O, no side effects — fully testable in any environment.
 *
 * Requirements: 1.1–1.8, 2.1–2.8, 3.1–3.9, 5.1–5.2, 6.1–6.3, 9.1–9.6, 10.1–10.6
 */

import {
  AUTO_GRID,
  type GridDefinition,
  type LayoutMode,
  type LayoutOptions,
  type LayoutResult,
  type PKConfig,
  type SeatData,
  type SpeakerSlot,
} from './layoutTypes';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Clamp `value` to the inclusive range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// resolveGridDef
// ---------------------------------------------------------------------------

/**
 * Returns the `GridDefinition` that corresponds to the given `manualMode`
 * (or `'auto'` when `manualMode` is `null`) for a room with `count` speakers.
 *
 * This is a pure function — it has no I/O and never mutates its inputs.
 *
 * | mode         | grid behaviour                                                    |
 * |--------------|-------------------------------------------------------------------|
 * | `auto`       | Lookup `AUTO_GRID[clamp(count, 1, 16)]`; 4×4 for counts > 16     |
 * | `minimal`    | Delegates to the `auto` path (same grid, badges/gifts hidden)    |
 * | `grid`       | Smallest square grid that fits `count`: ceil(√n) × ceil(√n)      |
 * | `focus-host` | Fixed 2×2 base with `hostSpan: { colSpan: 2, rowSpan: 2 }`       |
 * | `podcast`    | Fixed `{ columns: 2, rows: 3 }` — caps visible speakers at 6     |
 * | `classroom`  | 4 columns; host spans full top row; rows = ceil((n-1)/4) + 1     |
 * | `compact`    | `{ columns: max(4, ceil(n/3)), rows: 3, seatAspect: 0.75 }`      |
 * | `pk`         | `{ columns: 2, rows: ceil(n/2) }` — split VS layout               |
 *
 * Requirements: 1.1–1.8, 2.1–2.8
 *
 * @param count      Number of active speakers (may be 0).
 * @param manualMode Manually selected mode, or `null` for automatic selection.
 * @returns          A `GridDefinition` describing columns, rows, and optional
 *                   host-span / seat-aspect overrides.
 */
export function resolveGridDef(
  count: number,
  manualMode: LayoutMode | null,
): GridDefinition {
  // Treat null as 'auto'
  const mode: LayoutMode = manualMode ?? 'auto';

  switch (mode) {
    // -----------------------------------------------------------------------
    // auto / minimal — look up the AUTO_GRID table
    // -----------------------------------------------------------------------
    case 'auto':
    case 'minimal': {
      // For counts above 16 the engine paginates at 16 seats per page and
      // always uses the 4×4 definition (Requirement 1.8).
      if (count > 16) {
        return { columns: 4, rows: 4 };
      }
      // clamp to [1, 16] to guarantee a valid table key even when count === 0
      const key = clamp(count, 1, 16);
      return AUTO_GRID[key];
    }

    // -----------------------------------------------------------------------
    // grid — smallest square that holds all speakers
    // -----------------------------------------------------------------------
    case 'grid': {
      // ceil(√count) × ceil(√count), minimum 1×1 (Requirement 2.2)
      const side = Math.max(1, Math.ceil(Math.sqrt(count)));
      return { columns: side, rows: side };
    }

    // -----------------------------------------------------------------------
    // focus-host — host spans the entire 2×2 area (Requirement 2.3)
    // -----------------------------------------------------------------------
    case 'focus-host': {
      return {
        columns: 2,
        rows: 2,
        hostSpan: { colSpan: 2, rowSpan: 2 },
      };
    }

    // -----------------------------------------------------------------------
    // podcast — fixed 2-column × 3-row grid, max 6 speakers shown
    // (Requirement 2.4)
    // -----------------------------------------------------------------------
    case 'podcast': {
      return { columns: 2, rows: 3 };
    }

    // -----------------------------------------------------------------------
    // classroom — 4 columns; owner spans full top row (colSpan=4, rowSpan=1);
    // remaining rows filled by students
    //
    // rows = 1 (owner row) + ceil((count - 1) / 4) (student rows)
    // Requirement 2.5
    // -----------------------------------------------------------------------
    case 'classroom': {
      const columns = 4;
      // Protect against count === 0 — treat as 1 (the owner seat is always present)
      const studentCount = Math.max(0, count - 1);
      const studentRows = Math.ceil(studentCount / columns);
      const rows = 1 + studentRows; // 1 row for the host + n rows for students
      return {
        columns,
        rows,
        hostSpan: { colSpan: columns, rowSpan: 1 },
      };
    }

    // -----------------------------------------------------------------------
    // compact — minimum 4 columns, fixed 3 rows, small aspect ratio
    // columns = max(4, ceil(count / 3))
    // Requirement 2.6
    // -----------------------------------------------------------------------
    case 'compact': {
      const columns = Math.max(4, Math.ceil(count / 3));
      return {
        columns,
        rows: 3,
        seatAspect: 0.75,
      };
    }

    // -----------------------------------------------------------------------
    // pk — 2-column VS split; rows = ceil(count / 2)
    // Requirement 2.7 / 6.1–6.3
    // -----------------------------------------------------------------------
    case 'pk': {
      const rows = Math.max(1, Math.ceil(count / 2));
      return { columns: 2, rows };
    }

    // Exhaustive check — TypeScript guarantees all modes are handled above,
    // but this guards against future LayoutMode additions at runtime.
    default: {
      const _exhaustive: never = mode;
      // Fall back to auto behaviour at runtime
      void _exhaustive;
      const key = clamp(count, 1, 16);
      return count > 16 ? { columns: 4, rows: 4 } : AUTO_GRID[key];
    }
  }
}

// ---------------------------------------------------------------------------
// buildPKConfig
// ---------------------------------------------------------------------------

/**
 * Builds a `PKConfig` from a sorted list of speakers for PK (battle) mode.
 *
 * Team assignment rules (Requirements 6.1–6.3):
 * - `teamA` receives the first `ceil(n/2)` speakers (the larger half when n is odd).
 * - `teamB` receives the remaining `floor(n/2)` speakers.
 * - `|teamA.length - teamB.length| ≤ 1` always holds.
 * - When n is odd, `teamA.length === ceil(n/2)` (the extra speaker goes to teamA).
 *
 * `format` is derived from the sizes:
 * - `teamA.length === 1 && teamB.length <= 1` → `'1v1'`
 * - `teamA.length === 2 && teamB.length <= 2` → `'2v2'`
 * - `teamA.length === 3 && teamB.length <= 3` → `'3v3'`
 * - otherwise                                 → `'club'`
 *
 * @param speakers Sorted array of active `SpeakerSlot` objects.
 * @returns        A `PKConfig` with `teamA`, `teamB`, and `format`.
 */
export function buildPKConfig(speakers: SpeakerSlot[]): PKConfig {
  const n = speakers.length;
  const teamASize = Math.ceil(n / 2);

  const teamA = speakers.slice(0, teamASize);
  const teamB = speakers.slice(teamASize);

  let format: PKConfig['format'];
  if (teamA.length === 1 && teamB.length <= 1) {
    format = '1v1';
  } else if (teamA.length === 2 && teamB.length <= 2) {
    format = '2v2';
  } else if (teamA.length === 3 && teamB.length <= 3) {
    format = '3v3';
  } else {
    format = 'club';
  }

  return { teamA, teamB, format };
}

// ---------------------------------------------------------------------------
// sortSpeakers
// ---------------------------------------------------------------------------

/**
 * Sorts a `SpeakerSlot` array according to the canonical display order:
 *
 * 1. `role === 'owner'`                      → always index 0
 * 2. `role === 'moderator'`                  → sorted by `seatIndex` ascending
 * 3. `isSpeaking === true && isMuted === false` → active speakers (speaking, unmuted)
 * 4. everything else                         → muted / offline speakers
 *
 * After the base sort, if `pinnedUserId` is non-null and matches a speaker in
 * the array, that speaker is moved to index 1 (immediately after the owner).
 *
 * Requirements: 10.1–10.6
 *
 * @param speakers     Unsorted array of active `SpeakerSlot` objects.
 * @param pinnedUserId The `userId` to pin to position 1, or `null` for none.
 * @returns            A new sorted array (does not mutate the input).
 */
export function sortSpeakers(
  speakers: SpeakerSlot[],
  pinnedUserId: string | null,
): SpeakerSlot[] {
  /** Compute an integer sort key for a given slot. */
  function rank(s: SpeakerSlot): number {
    if (s.role === 'owner') return 0;
    if (s.role === 'moderator') return 1;
    if (s.isSpeaking && !s.isMuted) return 2;
    return 3;
  }

  const sorted = [...speakers].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    // Within the same rank group, maintain stable order by original seatIndex.
    return a.seatIndex - b.seatIndex;
  });

  // Apply pinnedUserId: move the matching speaker to index 1 (after owner).
  if (pinnedUserId !== null) {
    const pinnedIdx = sorted.findIndex((s) => s.userId === pinnedUserId);
    if (pinnedIdx > 1) {
      const [pinned] = sorted.splice(pinnedIdx, 1);
      sorted.splice(1, 0, pinned);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// buildPages
// ---------------------------------------------------------------------------

/**
 * Chunks a sorted speaker array into pages and pads each page to
 * `gridDef.columns × gridDef.rows` entries with empty `SeatData` slots.
 *
 * - `pageCapacity = gridDef.columns * gridDef.rows`
 * - Speakers are grouped into pages of `pageSize` entries each.
 * - The last page (and any page shorter than `pageCapacity`) is padded with
 *   empty `SeatData` entries so that every page has exactly `pageCapacity`
 *   entries.
 * - Empty slots: `{ isEmpty: true, isSpeaking: false, isMuted: false,
 *   role: 'empty', userId: '', ... }` with a globally unique `seatIndex` and
 *   `key = "seat-${seatIndex}"`.
 * - If `sortedSpeakers` is empty, one full page of empty entries is returned.
 *
 * Requirements: 3.1–3.2, 3.9, 5.1–5.2, 9.1–9.6
 *
 * @param sortedSpeakers Sorted array of occupied speaker slots.
 * @param gridDef        Grid definition for the current layout.
 * @param pageSize       Maximum number of speakers per page (default 16).
 * @returns              Array of pages; each page has exactly `pageCapacity` entries.
 */
export function buildPages(
  sortedSpeakers: SpeakerSlot[],
  gridDef: GridDefinition,
  pageSize: number,
): SeatData[][] {
  const pageCapacity = gridDef.columns * gridDef.rows;

  // BUG-PBT-001 FIX: clamp pageSize to pageCapacity.
  // When pageSize > pageCapacity (e.g. pageSize=24 with podcast grid capacity=6),
  // a page would get more occupied seats than the grid holds, making padding impossible.
  // Clamping ensures every page is always padded to exactly pageCapacity entries.
  // The production default (pageSize=16 with 4×4 capacity=16) is unaffected.
  const effectivePageSize = Math.min(pageSize, pageCapacity);

  /** Creates an empty padding SeatData at the given global seat index. */
  function emptySlot(seatIndex: number): SeatData {
    return {
      userId: '',
      seatIndex,
      role: 'empty',
      displayName: '',
      isMuted: false,
      isSpeaking: false,
      isOnline: false,
      connectionQuality: 'unknown',
      isEmpty: true,
      key: `seat-${seatIndex}`,
    };
  }

  // Edge case: no speakers → return one page of empty slots.
  if (sortedSpeakers.length === 0) {
    const page: SeatData[] = [];
    for (let i = 0; i < pageCapacity; i++) {
      page.push(emptySlot(i));
    }
    return [page];
  }

  const pages: SeatData[][] = [];
  let globalSeatIndex = 0;

  // Chunk speakers into groups of `effectivePageSize`.
  for (let pageStart = 0; pageStart < sortedSpeakers.length; pageStart += effectivePageSize) {
    const speakersOnPage = sortedSpeakers.slice(pageStart, pageStart + effectivePageSize);
    const page: SeatData[] = [];

    // Add occupied seats.
    for (const speaker of speakersOnPage) {
      page.push({
        ...speaker,
        seatIndex: globalSeatIndex,
        isEmpty: false,
        key: `seat-${globalSeatIndex}`,
      });
      globalSeatIndex++;
    }

    // Pad to pageCapacity with empty slots.
    while (page.length < pageCapacity) {
      page.push(emptySlot(globalSeatIndex));
      globalSeatIndex++;
    }

    pages.push(page);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// resolveSeatConflict
// ---------------------------------------------------------------------------

/**
 * Resolves a seat conflict that arises when an incoming participant claims a
 * `seatIndex` that may already be occupied by a different participant.
 *
 * Algorithm (Requirements 8.8, 8.9, 8.10):
 *
 * 1. Find the current occupant of `incomingSeatIndex`.
 * 2. If there is no occupant, or the occupant is the same `userId` as the
 *    incoming participant → update that participant's `seatIndex` in the
 *    returned array and return immediately.  No relocation occurs.
 * 3. If a *different* `userId` already holds `incomingSeatIndex`:
 *    a. Compare `eventTimestamp` of the existing assignment against the
 *       incoming `eventTimestamp`.
 *    b. The participant with the **higher** (more recent) timestamp wins the
 *       seat.  The loser is relocated to the **lowest available** `seatIndex`
 *       (i.e. `min { i ∈ ℕ≥0 : no participant holds i, i ≠ incomingSeatIndex }`).
 *    c. Only the two involved participants change seats; every other slot is
 *       returned unchanged.
 *
 * Non-seat field updates (`isMuted`, `isSpeaking`, `displayName`, `avatarUrl`,
 * `connectionQuality`, etc.) NEVER call this function — the store only calls
 * `resolveSeatConflict` when the incoming patch contains a `seatIndex` change.
 *
 * The function is **pure and deterministic**: the same inputs always produce
 * the same output, and it never mutates the original `speakers` array.
 *
 * @param speakers          Current array of active `SpeakerSlot` objects.
 * @param incomingUserId    The `userId` of the participant claiming the seat.
 * @param incomingSeatIndex The `seatIndex` being claimed.
 * @param eventTimestamp    Millisecond timestamp of the Socket.IO event that
 *                          triggered this claim (higher = more recent).
 * @returns                 A new `SpeakerSlot[]` with at most two entries
 *                          mutated; all others are identical references.
 */
export function resolveSeatConflict(
  speakers: SpeakerSlot[],
  incomingUserId: string,
  incomingSeatIndex: number,
  eventTimestamp: number,
): SpeakerSlot[] {
  // --- Step 1: locate the current occupant of incomingSeatIndex ----------------
  const occupantIndex = speakers.findIndex(
    (s) => s.seatIndex === incomingSeatIndex,
  );
  const occupant = occupantIndex !== -1 ? speakers[occupantIndex] : null;

  // --- Step 2: no conflict (unoccupied seat or same userId) --------------------
  if (occupant === null || occupant.userId === incomingUserId) {
    // Update the incoming participant's seatIndex in place; no relocation.
    return speakers.map((s) =>
      s.userId === incomingUserId ? { ...s, seatIndex: incomingSeatIndex } : s,
    );
  }

  // --- Step 3: conflict — two different userIds claim the same seatIndex -------

  // Determine the winner and loser based on eventTimestamp.
  // The occupant's "timestamp" is stored on the slot (if present) or treated as
  // 0 (epoch) to ensure the incoming event — which always carries a real
  // timestamp — wins in the absence of prior timestamp data.
  const occupantTimestamp: number =
    (occupant as SpeakerSlot & { _eventTimestamp?: number })
      ._eventTimestamp ?? 0;

  const incomingWins = eventTimestamp >= occupantTimestamp;
  const winnerId = incomingWins ? incomingUserId : occupant.userId;
  const loserId = incomingWins ? occupant.userId : incomingUserId;

  // Compute the set of all seatIndexes currently occupied by everyone other
  // than the two participants involved in the conflict.
  const otherOccupiedIndexes = new Set<number>(
    speakers
      .filter((s) => s.userId !== incomingUserId && s.userId !== occupant.userId)
      .map((s) => s.seatIndex),
  );

  // The winner keeps incomingSeatIndex; it must also be excluded from the
  // available pool so the loser cannot be assigned the same index.
  const lowestAvailable = findLowestAvailable(otherOccupiedIndexes, incomingSeatIndex);

  // Build the result: mutate only the two involved participants.
  return speakers.map((s) => {
    if (s.userId === winnerId) {
      return {
        ...s,
        seatIndex: incomingSeatIndex,
        // Stamp the winner's slot with the winning timestamp so future
        // replays of this event are idempotent.
        _eventTimestamp: eventTimestamp,
      } as SpeakerSlot;
    }
    if (s.userId === loserId) {
      return {
        ...s,
        seatIndex: lowestAvailable,
        // Preserve the loser's original timestamp; they did not win a new event.
        _eventTimestamp: occupantTimestamp,
      } as SpeakerSlot;
    }
    return s; // all other participants are untouched
  });
}

/**
 * Returns the smallest non-negative integer that is not in `occupiedSet`
 * and not equal to `excludeIndex`.
 *
 * Used internally by `resolveSeatConflict` to place the displaced participant.
 */
function findLowestAvailable(
  occupiedSet: Set<number>,
  excludeIndex: number,
): number {
  let candidate = 0;
  while (occupiedSet.has(candidate) || candidate === excludeIndex) {
    candidate++;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// computeLayout  (main entry point)
// ---------------------------------------------------------------------------

/**
 * Computes a complete `LayoutResult` from the given speakers, manual mode, and
 * optional tuning parameters.
 *
 * Algorithm:
 * 1. Sort speakers with `sortSpeakers` (owner first, pinned at index 1, etc.).
 * 2. Resolve the `GridDefinition` with `resolveGridDef`.
 * 3. If `manualMode === 'pk'`, build a `PKConfig` with `buildPKConfig`.
 * 4. Build paginated seat arrays with `buildPages`.
 * 5. Return the assembled `LayoutResult`.
 *
 * Requirements: 1.9–1.10, 3.1–3.2, 3.9, 5.1–5.2, 6.1–6.3, 9.1–9.6, 10.1–10.6
 *
 * @param speakers    Array of active / reserved speaker slots.
 * @param manualMode  Manually selected layout mode, or `null` for automatic.
 * @param options     Optional tuning: `pageSize`, `hostAlwaysFirst`, `prioritizeActive`,
 *                    and `pinnedUserId`.
 * @returns           A fully assembled `LayoutResult`.
 */
export function computeLayout(
  speakers: SpeakerSlot[],
  manualMode: LayoutMode | null,
  options?: LayoutOptions & { pinnedUserId?: string | null },
): LayoutResult {
  const pageSize = options?.pageSize ?? 16;
  const pinnedUserId = options?.pinnedUserId ?? null;

  // 1. Sort speakers.
  const sortedSpeakers = sortSpeakers(speakers, pinnedUserId);

  // 2. Resolve grid definition.
  const gridDef = resolveGridDef(speakers.length, manualMode);

  // 3. Optionally build PK config.
  const pkConfig: PKConfig | undefined =
    manualMode === 'pk' ? buildPKConfig(sortedSpeakers) : undefined;

  // 4. Build paginated pages.
  const pages = buildPages(sortedSpeakers, gridDef, pageSize);

  // 5. Compute totalPages — never less than 1.
  const totalPages = Math.ceil(Math.max(speakers.length, 1) / pageSize);

  // 6. Assemble and return the result.
  return {
    mode: manualMode ?? 'auto',
    gridDef,
    pages,
    totalPages,
    totalSpeakers: speakers.length,
    isManual: manualMode !== null,
    ...(pkConfig !== undefined ? { pkConfig } : {}),
  };
}
