/**
 * layoutTypes.ts
 *
 * Shared TypeScript types and constants for the Dynamic Speaker Layout System.
 * This module has NO React or platform dependencies — it is consumed by both
 * the web (Next.js) and mobile (React Native / Expo) layers as well as the
 * pure `computeLayout` engine.
 *
 * Requirements covered: 1.1–1.10, 2.1–2.10, 3.1–3.9, 5.1–5.2,
 *                        6.1–6.3, 9.1–9.6, 10.1–10.6
 */

// ---------------------------------------------------------------------------
// Primitive union types
// ---------------------------------------------------------------------------

/**
 * The role of a seat occupant.
 * `'empty'` is used exclusively for padding slots produced by the layout engine.
 */
export type SeatRole = 'owner' | 'moderator' | 'speaker' | 'empty';

/**
 * All supported layout modes.
 * - `'auto'`        — grid dimensions chosen by speaker count (uses AUTO_GRID)
 * - `'grid'`        — force a square grid regardless of count
 * - `'focus-host'`  — host seat spans 2 columns × 2 rows
 * - `'podcast'`     — 2 × 3 grid, max 6 speakers shown
 * - `'classroom'`   — host spans full top row; students in 4-column grid below
 * - `'pk'`          — side-by-side VS layout; speakers split into teamA / teamB
 * - `'compact'`     — 4+ columns regardless of count; small fixed-size cards
 * - `'minimal'`     — same grid as auto but badges and gifts are hidden
 */
export type LayoutMode =
  | 'auto'
  | 'grid'
  | 'focus-host'
  | 'podcast'
  | 'classroom'
  | 'pk'
  | 'compact'
  | 'minimal';

// ---------------------------------------------------------------------------
// Core data interfaces
// ---------------------------------------------------------------------------

/**
 * Represents one occupied or reserved seat in the room.
 * This is the canonical seat data model used throughout the system.
 */
export interface SpeakerSlot {
  /** Unique identifier for the participant (LiveKit identity). */
  userId: string;
  /** 0-based position index within the grid. */
  seatIndex: number;
  /** Role of the occupant. */
  role: SeatRole;
  /** Display name shown below the avatar. */
  displayName: string;
  /** Remote avatar image URL. Falls back to initials avatar on load error. */
  avatarUrl?: string;
  /** ISO 3166-1 alpha-2 country code used for the flag badge. */
  countryCode?: string;
  /** User level / rank shown as a numeric badge. */
  level?: number;
  /** Whether the user has VIP status (shows decorative VIP badge). */
  isVip?: boolean;
  /** Whether the user's microphone is currently muted. */
  isMuted: boolean;
  /** Whether the user is currently producing audio above the speaking threshold. */
  isSpeaking: boolean;
  /** Whether the user is currently connected to the room. */
  isOnline: boolean;
  /** LiveKit / WebRTC connection quality indicator. */
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown';
  /** URL of a decorative avatar frame overlay. */
  frameUrl?: string;
  /** URL of a role/achievement badge overlay. */
  badgeUrl?: string;
  /** Whether the user has a verified account badge. */
  isVerified?: boolean;
  /** Whether this seat has been locked by an admin (prevents auto-reassignment). */
  isLocked?: boolean;
  /** Whether this seat is reserved (shows a reserved placeholder). */
  isReserved?: boolean;
}

/**
 * A `SpeakerSlot` extended with display metadata consumed by `SeatCard`.
 * Empty padding slots (produced by the layout engine to fill a page) set
 * `isEmpty === true` and carry zeroed-out defaults for all other fields.
 */
export interface SeatData extends SpeakerSlot {
  /** `true` when this entry is an empty padding slot, `false` when occupied. */
  isEmpty: boolean;
  /**
   * Stable React reconciliation key.
   * Always equals `"seat-${seatIndex}"` and is never reassigned across
   * recomputations for a seat that has not changed its position.
   */
  key: string;
}

/**
 * Describes the column/row structure for a given layout mode and speaker count.
 */
export interface GridDefinition {
  /** Number of seat columns on a single page. */
  columns: number;
  /** Number of seat rows on a single page. */
  rows: number;
  /**
   * Optional span override for the host seat.
   * Used in `focus-host` and `classroom` modes.
   */
  hostSpan?: {
    colSpan: number;
    rowSpan: number;
  };
  /**
   * Seat width-to-height ratio.  Defaults to `1` (square) when omitted.
   */
  seatAspect?: number;
}

/**
 * The output object produced by `computeLayout()`.
 */
export interface LayoutResult {
  /**
   * The resolved layout mode.
   * May differ from the requested manual mode when the mode is invalid for
   * the current speaker count (in which case the engine falls back to `'auto'`).
   */
  mode: LayoutMode;
  /** Column/row definition used for the current layout. */
  gridDef: GridDefinition;
  /**
   * Paginated seat arrays.
   * `pages[0]` contains the first `pageSize` seats (including the host at
   * `pages[0][0]`).  Every page has exactly `gridDef.columns × gridDef.rows`
   * entries; empty `SeatData` padding fills incomplete pages.
   */
  pages: SeatData[][];
  /** Total number of pages.  Never less than 1. */
  totalPages: number;
  /** Number of non-empty (occupied) speakers in the current layout. */
  totalSpeakers: number;
  /** `true` when the layout was produced by a manually selected mode. */
  isManual: boolean;
  /**
   * Team assignment for PK mode.
   * Only populated when `mode === 'pk'`.
   */
  pkConfig?: PKConfig;
}

/**
 * Team assignment configuration for PK (battle) mode.
 * `|teamA.length - teamB.length| ≤ 1` always holds.
 * When the total speaker count is odd, `teamA` receives the extra speaker.
 */
export interface PKConfig {
  /** Speakers assigned to the left column (primary-color border). */
  teamA: SpeakerSlot[];
  /** Speakers assigned to the right column (accent-color border). */
  teamB: SpeakerSlot[];
  /**
   * Match format derived from team sizes:
   * - `'1v1'`   — 1 speaker per team
   * - `'2v2'`   — 2 speakers per team
   * - `'3v3'`   — 3 speakers per team
   * - `'club'`  — 4+ speakers per team
   */
  format: '1v1' | '2v2' | '3v3' | 'club';
}

/**
 * Optional tuning parameters accepted by `computeLayout()`.
 */
export interface LayoutOptions {
  /**
   * Maximum number of seats per page.
   * @default 16
   */
  pageSize?: number;
  /**
   * When `true`, the owner is always placed at `pages[0][0]`.
   * @default true
   */
  hostAlwaysFirst?: boolean;
  /**
   * When `true`, active (speaking, unmuted) speakers are promoted ahead of
   * muted speakers in the sort order.
   * @default true
   */
  prioritizeActive?: boolean;
}

/**
 * Width/height dimensions for a single seat card, in pixels (web) or dp (mobile).
 */
export interface SeatSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Zustand store interface
// ---------------------------------------------------------------------------

/**
 * The Zustand slice that holds all seat data, layout results, and user
 * preferences for the Dynamic Speaker Layout System.
 *
 * This interface is implemented by both:
 * - `frontend/src/components/live-class/layout/useDynamicLayoutStore.ts` (web)
 * - `mobile/src/components/voice/layout/useDynamicLayoutStore.ts` (mobile)
 */
export interface DynamicLayoutState {
  // -------------------------------------------------------------------------
  // Seat data (source of truth)
  // -------------------------------------------------------------------------

  /** Canonical array of all active / reserved speaker slots. */
  speakers: SpeakerSlot[];

  // -------------------------------------------------------------------------
  // Computed output (derived by computeLayout on every mutation)
  // -------------------------------------------------------------------------

  /** The most recently computed layout result. Re-derived on every mutation. */
  layout: LayoutResult;

  // -------------------------------------------------------------------------
  // User preferences
  // -------------------------------------------------------------------------

  /**
   * The currently selected manual layout mode, or `null` when the engine is
   * running in fully automatic mode.
   */
  manualMode: LayoutMode | null;

  /** 0-based index of the currently visible page. Always in `[0, totalPages-1]`. */
  currentPage: number;

  // -------------------------------------------------------------------------
  // Admin state
  // -------------------------------------------------------------------------

  /**
   * Set of seat indices that have been locked by a moderator.
   * Locked seats are not reassigned by the auto-sort algorithm.
   */
  lockedSeats: Set<number>;

  /**
   * Set of seat indices that have been reserved by a moderator.
   * Reserved seats show a placeholder card instead of an empty slot.
   */
  reservedSeats: Set<number>;

  /**
   * The `userId` of the speaker who has been pinned to position index 1
   * (immediately after the owner), or `null` when no speaker is pinned.
   */
  pinnedUserId: string | null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Add a speaker to the store.
   * If a speaker with the same `userId` already exists, performs an upsert
   * (calls `updateSpeaker` internally) rather than pushing a duplicate entry.
   * Batched with a 32 ms debounce before triggering layout recomputation.
   */
  addSpeaker: (s: SpeakerSlot) => void;

  /**
   * Remove the speaker identified by `userId` from the store.
   * Batched with a 32 ms debounce before triggering layout recomputation.
   * `currentPage` is clamped to `[0, totalPages-1]` after removal.
   */
  removeSpeaker: (userId: string) => void;

  /**
   * Apply a partial update to an existing speaker identified by `userId`.
   * `isSpeaking` changes are debounced at 50 ms per seat to prevent
   * animation jitter caused by rapidly oscillating audio level events.
   */
  updateSpeaker: (userId: string, patch: Partial<SpeakerSlot>) => void;

  /**
   * Replace the entire `speakers` array in one atomic operation.
   * Used for full resyncs triggered by `voice:room_state` Socket.IO events
   * and LiveKit reconnect events.
   */
  setSpeakers: (speakers: SpeakerSlot[]) => void;

  /**
   * Override the automatic layout with a specific mode.
   * Does NOT modify the `speakers` array.
   */
  setManualMode: (mode: LayoutMode) => void;

  /**
   * Clear any manually selected layout mode.
   * The engine reverts to fully automatic mode based on the current speaker count.
   * Produces the same `LayoutResult` as if `setManualMode` had never been called.
   */
  clearManualMode: () => void;

  /**
   * Navigate to a specific page.
   * The value is automatically clamped to `[0, totalPages-1]`.
   */
  setCurrentPage: (page: number) => void;

  /**
   * Pin a speaker to position index 1 (immediately after the owner).
   * Pass `null` to restore normal sort order for the previously pinned speaker.
   */
  pinSpeaker: (userId: string | null) => void;

  /**
   * Lock or unlock a seat at the given index.
   * `locked === true`  → adds `seatIndex` to `lockedSeats`
   * `locked === false` → removes `seatIndex` from `lockedSeats`
   */
  lockSeat: (seatIndex: number, locked: boolean) => void;

  /**
   * Reserve or un-reserve a seat at the given index.
   * `reserved === true`  → adds `seatIndex` to `reservedSeats`
   * `reserved === false` → removes `seatIndex` from `reservedSeats`
   */
  reserveSeat: (seatIndex: number, reserved: boolean) => void;

  /**
   * Swap the `SpeakerSlot` occupants at `indexA` and `indexB`.
   * Triggers a full layout recomputation after the swap.
   */
  swapSeats: (indexA: number, indexB: number) => void;
}

// ---------------------------------------------------------------------------
// AUTO_GRID lookup table
// ---------------------------------------------------------------------------

/**
 * Maps speaker count (1–16) to the optimal `GridDefinition` for auto mode.
 *
 * For counts above 16 the engine paginates at 16 seats per page and always
 * uses the `{ columns: 4, rows: 4 }` grid definition.
 *
 * ```
 * count │ columns │ rows
 * ------+---------+-----
 *   1   │    1    │  1
 *   2   │    2    │  1
 *  3–4  │    2    │  2
 *  5–6  │    3    │  2
 *  7–9  │    3    │  3
 * 10–12 │    4    │  3
 * 13–16 │    4    │  4
 * > 16  │    4    │  4   (paginate)
 * ```
 *
 * Requirements: 1.1–1.8
 */
export const AUTO_GRID: Record<number, GridDefinition> = {
  1: { columns: 1, rows: 1 },
  2: { columns: 2, rows: 1 },
  3: { columns: 2, rows: 2 },
  4: { columns: 2, rows: 2 },
  5: { columns: 3, rows: 2 },
  6: { columns: 3, rows: 2 },
  7: { columns: 3, rows: 3 },
  8: { columns: 3, rows: 3 },
  9: { columns: 3, rows: 3 },
  10: { columns: 4, rows: 3 },
  11: { columns: 4, rows: 3 },
  12: { columns: 4, rows: 3 },
  13: { columns: 4, rows: 4 },
  14: { columns: 4, rows: 4 },
  15: { columns: 4, rows: 4 },
  16: { columns: 4, rows: 4 },
} as const;
