/**
 * useDynamicLayoutStore.ts  (mobile — React Native / Expo)
 *
 * Zustand v5 slice for the Dynamic Speaker Layout System on mobile.
 * Mirrors the web store exactly; the only platform difference is batching:
 *   • web  → 32 ms setTimeout
 *   • mobile → InteractionManager.runAfterInteractions (lets the JS bridge
 *              finish the current interaction before applying mutations)
 *
 * No 'use client' directive — not applicable to React Native.
 *
 * Requirements: 2.9, 3.3–3.7, 7.8, 8.5
 */

import { InteractionManager } from 'react-native';
import { create } from 'zustand';

import { computeLayout } from '../../../../../src/lib/layout/computeLayout';
import type {
  DynamicLayoutState,
  LayoutMode,
  LayoutResult,
  SpeakerSlot
} from '../../../../../src/lib/layout/layoutTypes';

// ---------------------------------------------------------------------------
// Module-level mutation batch (outside Zustand state to avoid re-renders)
// ---------------------------------------------------------------------------

type Mutation =
  | { type: 'add'; speaker: SpeakerSlot }
  | { type: 'remove'; userId: string };

/** Pending add/remove mutations waiting for the next interaction frame. */
const _pendingMutations: Mutation[] = [];

/** Handle returned by InteractionManager so we can cancel if a new mutation arrives. */
let _interactionHandle: ReturnType<
  typeof InteractionManager.runAfterInteractions
> | null = null;

// ---------------------------------------------------------------------------
// Per-seat isSpeaking debounce timers (50 ms)
// ---------------------------------------------------------------------------

const _speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Initial layout (zero speakers)
// ---------------------------------------------------------------------------

const _initialLayout: LayoutResult = computeLayout([], null);

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDynamicLayoutStore = create<DynamicLayoutState>(
  (set, get) => ({
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    speakers: [],
    layout: _initialLayout,
    manualMode: null,
    currentPage: 0,
    lockedSeats: new Set<number>(),
    reservedSeats: new Set<number>(),
    pinnedUserId: null,

    // -----------------------------------------------------------------------
    // Internal recompute helper — called after every state mutation
    // -----------------------------------------------------------------------

    // NOTE: _recompute is NOT part of DynamicLayoutState (it's a local helper),
    // so we call it inline rather than storing it on the slice.

    // -----------------------------------------------------------------------
    // addSpeaker — upsert, batched via InteractionManager
    // -----------------------------------------------------------------------
    addSpeaker: (s: SpeakerSlot) => {
      // If the userId already exists, delegate to updateSpeaker (upsert semantics).
      const existing = get().speakers.find((sp) => sp.userId === s.userId);
      if (existing) {
        // Full replace — treat as a complete upsert
        const speakers = get().speakers.map((sp) =>
          sp.userId === s.userId ? { ...sp, ...s } : sp,
        );
        const layout = computeLayout(speakers, get().manualMode, {
          pinnedUserId: get().pinnedUserId,
        });
        set({ speakers, layout });
        return;
      }

      // Queue a batched add
      _pendingMutations.push({ type: 'add', speaker: s });
      _scheduleInteraction(set, get);
    },

    // -----------------------------------------------------------------------
    // removeSpeaker — batched via InteractionManager
    // -----------------------------------------------------------------------
    removeSpeaker: (userId: string) => {
      _pendingMutations.push({ type: 'remove', userId });
      _scheduleInteraction(set, get);
    },

    // -----------------------------------------------------------------------
    // updateSpeaker — immediate except isSpeaking which is debounced 50 ms
    // -----------------------------------------------------------------------
    updateSpeaker: (userId: string, patch: Partial<SpeakerSlot>) => {
      if ('isSpeaking' in patch) {
        // Debounce isSpeaking changes per seat
        const existing = _speakingTimers.get(userId);
        if (existing !== undefined) clearTimeout(existing);

        const timer = setTimeout(() => {
          _speakingTimers.delete(userId);
          _applyPatch(set, get, userId, patch);
        }, 50);
        _speakingTimers.set(userId, timer);

        // Apply non-isSpeaking fields immediately if any co-exist in the patch
        const { isSpeaking: _ignored, ...rest } = patch;
        if (Object.keys(rest).length > 0) {
          _applyPatch(set, get, userId, rest);
        }
      } else {
        _applyPatch(set, get, userId, patch);
      }
    },

    // -----------------------------------------------------------------------
    // setSpeakers — immediate full replace
    // -----------------------------------------------------------------------
    setSpeakers: (speakers: SpeakerSlot[]) => {
      const layout = computeLayout(speakers, get().manualMode, {
        pinnedUserId: get().pinnedUserId,
      });
      const totalPages = layout.totalPages;
      const currentPage = Math.min(get().currentPage, totalPages - 1);
      set({ speakers, layout, currentPage });
    },

    // -----------------------------------------------------------------------
    // setManualMode
    // -----------------------------------------------------------------------
    setManualMode: (mode: LayoutMode) => {
      const { speakers, pinnedUserId } = get();
      const layout = computeLayout(speakers, mode, { pinnedUserId });
      set({ manualMode: mode, layout });
    },

    // -----------------------------------------------------------------------
    // clearManualMode
    // -----------------------------------------------------------------------
    clearManualMode: () => {
      const { speakers, pinnedUserId } = get();
      const layout = computeLayout(speakers, null, { pinnedUserId });
      set({ manualMode: null, layout });
    },

    // -----------------------------------------------------------------------
    // setCurrentPage — clamp to [0, totalPages-1]
    // -----------------------------------------------------------------------
    setCurrentPage: (page: number) => {
      const { layout } = get();
      const clamped = Math.max(0, Math.min(page, layout.totalPages - 1));
      set({ currentPage: clamped });
    },

    // -----------------------------------------------------------------------
    // pinSpeaker
    // -----------------------------------------------------------------------
    pinSpeaker: (userId: string | null) => {
      const { speakers, manualMode } = get();
      const layout = computeLayout(speakers, manualMode, { pinnedUserId: userId });
      set({ pinnedUserId: userId, layout });
    },

    // -----------------------------------------------------------------------
    // lockSeat
    // -----------------------------------------------------------------------
    lockSeat: (seatIndex: number, locked: boolean) => {
      const lockedSeats = new Set(get().lockedSeats);
      if (locked) {
        lockedSeats.add(seatIndex);
      } else {
        lockedSeats.delete(seatIndex);
      }
      const { speakers, manualMode, pinnedUserId } = get();
      const layout = computeLayout(speakers, manualMode, { pinnedUserId });
      set({ lockedSeats, layout });
    },

    // -----------------------------------------------------------------------
    // reserveSeat
    // -----------------------------------------------------------------------
    reserveSeat: (seatIndex: number, reserved: boolean) => {
      const reservedSeats = new Set(get().reservedSeats);
      if (reserved) {
        reservedSeats.add(seatIndex);
      } else {
        reservedSeats.delete(seatIndex);
      }
      const { speakers, manualMode, pinnedUserId } = get();
      const layout = computeLayout(speakers, manualMode, { pinnedUserId });
      set({ reservedSeats, layout });
    },

    // -----------------------------------------------------------------------
    // swapSeats — exchange occupants at indexA and indexB, then recompute
    // -----------------------------------------------------------------------
    swapSeats: (indexA: number, indexB: number) => {
      const speakers = get().speakers.map((sp) => {
        if (sp.seatIndex === indexA) return { ...sp, seatIndex: indexB };
        if (sp.seatIndex === indexB) return { ...sp, seatIndex: indexA };
        return sp;
      });
      const layout = computeLayout(speakers, get().manualMode, {
        pinnedUserId: get().pinnedUserId,
      });
      set({ speakers, layout });
    },
  }),
);

// ---------------------------------------------------------------------------
// Private helpers (module-level, not stored on the Zustand state)
// ---------------------------------------------------------------------------

type SetFn = (partial: Partial<DynamicLayoutState>) => void;
type GetFn = () => DynamicLayoutState;

/**
 * Schedule (or reschedule) the InteractionManager batch flush.
 * Cancels any pending handle before creating a new one so that rapid
 * add/remove calls are coalesced into a single recompute.
 */
function _scheduleInteraction(set: SetFn, get: GetFn): void {
  if (_interactionHandle) {
    _interactionHandle.cancel();
    _interactionHandle = null;
  }

  _interactionHandle = InteractionManager.runAfterInteractions(() => {
    _interactionHandle = null;

    // Drain the pending mutations queue
    const mutations = _pendingMutations.splice(0);
    if (mutations.length === 0) return;

    let speakers = [...get().speakers];

    for (const m of mutations) {
      if (m.type === 'add') {
        // Resolve seatIndex conflict: if another speaker already occupies the
        // requested seatIndex, move the newcomer to the next available index.
        const occupiedIndices = new Set(speakers.map((sp) => sp.seatIndex));
        let idx = m.speaker.seatIndex;
        while (occupiedIndices.has(idx)) {
          idx++;
        }
        speakers.push({ ...m.speaker, seatIndex: idx });
      } else {
        // remove
        speakers = speakers.filter((sp) => sp.userId !== m.userId);
      }
    }

    const layout = computeLayout(speakers, get().manualMode, {
      pinnedUserId: get().pinnedUserId,
    });
    const totalPages = layout.totalPages;
    const currentPage = Math.min(get().currentPage, totalPages - 1);

    set({ speakers, layout, currentPage });
  });
}

/**
 * Apply a partial patch to a single speaker and trigger layout recomputation.
 */
function _applyPatch(
  set: SetFn,
  get: GetFn,
  userId: string,
  patch: Partial<SpeakerSlot>,
): void {
  const speakers = get().speakers.map((sp) =>
    sp.userId === userId ? { ...sp, ...patch } : sp,
  );
  const layout = computeLayout(speakers, get().manualMode, {
    pinnedUserId: get().pinnedUserId,
  });
  set({ speakers, layout });
}

