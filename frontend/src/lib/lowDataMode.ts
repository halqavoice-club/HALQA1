'use client'

/**
 * HALQA — Low Data Mode (Phase 9)
 *
 * When enabled (auto on poor network OR manually by user):
 *   - Disables gift animations (heavy CSS + JS)
 *   - Disables floating emoji reactions
 *   - Reduces avatar image quality (uses initials fallback)
 *   - Increases API poll intervals
 *   - Reduces Socket.IO heartbeat frequency
 *
 * ADDITIVE ONLY — existing code reads this flag and skips non-essential work.
 * No existing behaviour is removed.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface LowDataModeState {
  // true = user explicitly enabled / false = user explicitly disabled / null = auto
  userPreference: boolean | null
  // Derived: effectively on
  isEnabled: boolean
  // Set by network quality monitor
  setAutoEnabled: (on: boolean) => void
  // User toggle
  setUserPreference: (pref: boolean | null) => void
}

export const useLowDataMode = create<LowDataModeState>()(
  persist(
    (set, get) => ({
      userPreference: null,
      isEnabled: false,

      setAutoEnabled: (on: boolean) => {
        const pref = get().userPreference
        // Only auto-enable if user hasn't explicitly overridden
        if (pref === null) {
          set({ isEnabled: on })
        }
      },

      setUserPreference: (pref: boolean | null) => {
        set({
          userPreference: pref,
          isEnabled: pref === null
            ? false    // reset to auto (will be set by setAutoEnabled)
            : pref,
        })
      },
    }),
    {
      name: 'halqa-low-data-mode',
      partialize: (s) => ({ userPreference: s.userPreference }),
    }
  )
)

// React hook for reading Low Data Mode in components
export function useLowData() {
  return useLowDataMode((s) => s.isEnabled)
}
