'use client'

import { create } from 'zustand'
import { computeLayout } from '../../../../../src/lib/layout/computeLayout'
import type {
  LayoutMode,
  LayoutResult,
  SpeakerSlot,
} from '../../../../../src/lib/layout/layoutTypes'

// ---------------------------------------------------------------------------
// Module-scope debounce state for addSpeaker / removeSpeaker batch (32ms)
// ---------------------------------------------------------------------------

let _addRemoveTimer: ReturnType<typeof setTimeout> | null = null
let _pendingMutations: (() => void)[] = []

// ---------------------------------------------------------------------------
// Module-scope per-seat debounce map for isSpeaking updates (50ms)
// ---------------------------------------------------------------------------

const _speakingDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ---------------------------------------------------------------------------
// Store state interface
// ---------------------------------------------------------------------------

interface DynamicLayoutStoreState {
  speakers: SpeakerSlot[]
  layout: LayoutResult
  manualMode: LayoutMode | null
  currentPage: number
  lockedSeats: Set<number>
  reservedSeats: Set<number>
  pinnedUserId: string | null

  // Actions
  addSpeaker: (s: SpeakerSlot) => void
  removeSpeaker: (userId: string) => void
  updateSpeaker: (userId: string, patch: Partial<SpeakerSlot>) => void
  setSpeakers: (speakers: SpeakerSlot[]) => void
  setManualMode: (mode: LayoutMode) => void
  clearManualMode: () => void
  setCurrentPage: (page: number) => void
  pinSpeaker: (userId: string | null) => void
  lockSeat: (seatIndex: number, locked: boolean) => void
  reserveSeat: (seatIndex: number, reserved: boolean) => void
  swapSeats: (indexA: number, indexB: number) => void
}

// ---------------------------------------------------------------------------
// Helper: clamp a number to [min, max]
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// Initial layout (computed from empty speakers array)
// ---------------------------------------------------------------------------

const _initialLayout = computeLayout([], null)

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDynamicLayoutStore = create<DynamicLayoutStoreState>((set, get) => {

  /**
   * Internal recompute helper.
   * Reads current state, calls computeLayout, updates layout and clamps currentPage.
   */
  function _recompute(): void {
    const { speakers, manualMode, pinnedUserId, currentPage } = get()
    const layout = computeLayout(speakers, manualMode, { pinnedUserId })
    const maxPage = Math.max(0, layout.totalPages - 1)
    set({
      layout,
      currentPage: clamp(currentPage, 0, maxPage),
    })
  }

  /**
   * Flush all pending add/remove mutations, then recompute.
   */
  function _flushBatch(): void {
    _addRemoveTimer = null
    const mutations = _pendingMutations.splice(0)
    for (const mutation of mutations) {
      mutation()
    }
    _recompute()
  }

  /**
   * Schedule a batched mutation.
   * Cancels any existing 32ms timer and resets it.
   */
  function _scheduleBatch(mutation: () => void): void {
    _pendingMutations.push(mutation)
    if (_addRemoveTimer !== null) {
      clearTimeout(_addRemoveTimer)
    }
    _addRemoveTimer = setTimeout(_flushBatch, 32)
  }

  return {
    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    speakers: [],
    layout: _initialLayout,
    manualMode: null,
    currentPage: 0,
    lockedSeats: new Set<number>(),
    reservedSeats: new Set<number>(),
    pinnedUserId: null,

    // -----------------------------------------------------------------------
    // addSpeaker — upsert with seat-conflict resolution + 32ms batch debounce
    // -----------------------------------------------------------------------
    addSpeaker(s: SpeakerSlot): void {
      _scheduleBatch(() => {
        const { speakers } = get()

        // Upsert: if userId already exists, merge the patch instead of duplicating
        const existingIndex = speakers.findIndex((sp) => sp.userId === s.userId)
        if (existingIndex !== -1) {
          // Perform updateSpeaker logic inline to avoid debounce confusion
          set({
            speakers: speakers.map((sp) =>
              sp.userId === s.userId ? { ...sp, ...s } : sp
            ),
          })
          return
        }

        // Seat conflict resolution (Req 8.8):
        // If seatIndex is already occupied by a different userId, displace that occupant.
        let newSpeakers = [...speakers]
        const conflictIndex = newSpeakers.findIndex(
          (sp) => sp.seatIndex === s.seatIndex && sp.userId !== s.userId
        )

        if (conflictIndex !== -1) {
          const existingIndices = newSpeakers.map((sp) => sp.seatIndex)
          const displaced = newSpeakers[conflictIndex]
          const nextSeatIndex =
            existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0
          newSpeakers[conflictIndex] = { ...displaced, seatIndex: nextSeatIndex }
        }

        newSpeakers.push(s)
        set({ speakers: newSpeakers })
      })
    },

    // -----------------------------------------------------------------------
    // removeSpeaker — filter + 32ms batch debounce; clamp currentPage after recompute
    // -----------------------------------------------------------------------
    removeSpeaker(userId: string): void {
      _scheduleBatch(() => {
        const { speakers } = get()
        set({ speakers: speakers.filter((sp) => sp.userId !== userId) })
        // currentPage clamping is handled inside _recompute() via _flushBatch
      })
    },

    // -----------------------------------------------------------------------
    // updateSpeaker — immediate for non-isSpeaking patches; 50ms debounce for isSpeaking
    // -----------------------------------------------------------------------
    updateSpeaker(userId: string, patch: Partial<SpeakerSlot>): void {
      const { isSpeaking, ...otherPatch } = patch as Partial<SpeakerSlot> & {
        isSpeaking?: boolean
      }
      const hasOtherChanges = Object.keys(otherPatch).length > 0
      const hasSpeakingChange = isSpeaking !== undefined

      if (hasOtherChanges) {
        // Apply non-isSpeaking patches immediately
        const { speakers } = get()
        set({
          speakers: speakers.map((sp) =>
            sp.userId === userId ? { ...sp, ...otherPatch } : sp
          ),
        })
        _recompute()
      }

      if (hasSpeakingChange) {
        // Cancel existing debounce timer for this seat
        const existingTimer = _speakingDebounceTimers.get(userId)
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer)
        }
        // Set new 50ms timer
        const timer = setTimeout(() => {
          _speakingDebounceTimers.delete(userId)
          const { speakers: currentSpeakers } = get()
          set({
            speakers: currentSpeakers.map((sp) =>
              sp.userId === userId ? { ...sp, isSpeaking: isSpeaking as boolean } : sp
            ),
          })
          _recompute()
        }, 50)
        _speakingDebounceTimers.set(userId, timer)
      }
    },

    // -----------------------------------------------------------------------
    // setSpeakers — full replacement, immediate recompute
    // -----------------------------------------------------------------------
    setSpeakers(speakers: SpeakerSlot[]): void {
      set({ speakers })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // setManualMode — set mode, recompute; does NOT modify speakers
    // -----------------------------------------------------------------------
    setManualMode(mode: LayoutMode): void {
      set({ manualMode: mode })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // clearManualMode — revert to auto, recompute
    // -----------------------------------------------------------------------
    clearManualMode(): void {
      set({ manualMode: null })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // setCurrentPage — clamp to [0, totalPages-1]
    // -----------------------------------------------------------------------
    setCurrentPage(page: number): void {
      const { layout } = get()
      const maxPage = Math.max(0, layout.totalPages - 1)
      set({ currentPage: clamp(page, 0, maxPage) })
    },

    // -----------------------------------------------------------------------
    // pinSpeaker — set pinnedUserId, recompute
    // -----------------------------------------------------------------------
    pinSpeaker(userId: string | null): void {
      set({ pinnedUserId: userId })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // lockSeat — add/remove from lockedSeats Set (new Set for immutability), recompute
    // -----------------------------------------------------------------------
    lockSeat(seatIndex: number, locked: boolean): void {
      const { lockedSeats } = get()
      const next = new Set(lockedSeats)
      if (locked) {
        next.add(seatIndex)
      } else {
        next.delete(seatIndex)
      }
      set({ lockedSeats: next })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // reserveSeat — add/remove from reservedSeats Set (new Set for immutability), recompute
    // -----------------------------------------------------------------------
    reserveSeat(seatIndex: number, reserved: boolean): void {
      const { reservedSeats } = get()
      const next = new Set(reservedSeats)
      if (reserved) {
        next.add(seatIndex)
      } else {
        next.delete(seatIndex)
      }
      set({ reservedSeats: next })
      _recompute()
    },

    // -----------------------------------------------------------------------
    // swapSeats — exchange SpeakerSlot occupants at indexA and indexB, recompute
    // -----------------------------------------------------------------------
    swapSeats(indexA: number, indexB: number): void {
      const { speakers } = get()

      // Find speakers that currently occupy these seat indices
      const speakerAtA = speakers.find((sp) => sp.seatIndex === indexA)
      const speakerAtB = speakers.find((sp) => sp.seatIndex === indexB)

      if (speakerAtA === undefined && speakerAtB === undefined) return

      set({
        speakers: speakers.map((sp) => {
          if (sp.seatIndex === indexA) {
            return { ...sp, seatIndex: indexB }
          }
          if (sp.seatIndex === indexB) {
            return { ...sp, seatIndex: indexA }
          }
          return sp
        }),
      })
      _recompute()
    },
  }
})
