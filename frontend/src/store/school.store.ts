'use client'

/**
 * school.store.ts
 *
 * Manages the active school context for the Education domain.
 *
 * When a user belongs to multiple schools, this store tracks which school
 * is currently "active" — i.e. which school's Education features are shown.
 *
 * Changing the active school ONLY affects the Education domain.
 * The Social platform (feed, voice club, communities, etc.) is completely
 * unaffected by this state.
 *
 * The activeSchoolId is persisted to localStorage so it survives page refreshes.
 * On load, if the stored schoolId is no longer in the user's memberships
 * (e.g. they left the school), it is cleared and the first active school is used.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SchoolState {
  // The currently active school ID for Education context.
  // Null means no school selected (Social-only view).
  activeSchoolId: string | null

  // Set the active school (validates against memberships in useSchoolAccess)
  setActiveSchoolId: (schoolId: string | null) => void

  // Clear active school (e.g. on logout)
  clearActiveSchool: () => void
}

export const useSchoolStore = create<SchoolState>()(
  persist(
    (set) => ({
      activeSchoolId: null,

      setActiveSchoolId: (schoolId) => {
        set({ activeSchoolId: schoolId })
      },

      clearActiveSchool: () => {
        set({ activeSchoolId: null })
      },
    }),
    {
      name: 'halqa-active-school',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          }
        }
        return localStorage
      }),
      partialize: (state) => ({
        activeSchoolId: state.activeSchoolId,
      }),
    }
  )
)
