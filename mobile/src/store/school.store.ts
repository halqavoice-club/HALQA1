/**
 * HALQA Mobile — School Store (Zustand + MMKV)
 *
 * Manages the active school context for the Education domain.
 * Changing activeSchoolId only affects Education navigation.
 * Social features (feed, voice, communities, etc.) are unaffected.
 *
 * Persisted via MMKV so it survives app restarts.
 * On restore, if the stored schoolId is no longer in the user's memberships
 * it should be cleared by the caller (e.g. in useSchoolAccess hook).
 */
import { create } from 'zustand';
import { getStoredString, setStoredString, deleteStoredItem } from '@/lib/storage';

interface SchoolMembership {
  id: string;
  schoolId: string;
  role: 'TEACHER' | 'STUDENT' | 'GUARDIAN' | 'SCHOOL_ADMIN';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  joinedAt: string;
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string;
    type?: string;
  };
}

interface SchoolState {
  /** The currently active school ID for Education context. Null = Social-only. */
  activeSchoolId: string | null;

  /** All memberships for the current user, populated after login / /auth/me */
  memberships: SchoolMembership[];

  /** Set active school — pass null to clear */
  setActiveSchoolId: (schoolId: string | null) => void;

  /** Bulk-replace memberships (call after /auth/me or /school-memberships/me) */
  setMemberships: (memberships: SchoolMembership[]) => void;

  /** Returns the active membership object, or the first active one if none set */
  getActiveMembership: () => SchoolMembership | null;

  /** Clear all — called on logout */
  clear: () => void;
}

const STORAGE_KEY = 'halqa:activeSchoolId';

function loadPersistedSchoolId(): string | null {
  try {
    return getStoredString(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const useSchoolStore = create<SchoolState>((set, get) => ({
  activeSchoolId: loadPersistedSchoolId(),
  memberships: [],

  setActiveSchoolId: (schoolId) => {
    try {
      if (schoolId) {
        setStoredString(STORAGE_KEY, schoolId);
      } else {
        deleteStoredItem(STORAGE_KEY);
      }
    } catch {}
    set({ activeSchoolId: schoolId });
  },

  setMemberships: (memberships) => {
    set({ memberships });
    // If stored school is no longer in memberships, auto-select first active one
    const { activeSchoolId } = get();
    if (activeSchoolId && !memberships.find(m => m.schoolId === activeSchoolId && m.status === 'ACTIVE')) {
      const first = memberships.find(m => m.status === 'ACTIVE') ?? null;
      const newId = first?.schoolId ?? null;
      try {
        if (newId) setStoredString(STORAGE_KEY, newId);
        else deleteStoredItem(STORAGE_KEY);
      } catch {}
      set({ activeSchoolId: newId });
    }
  },

  getActiveMembership: () => {
    const { activeSchoolId, memberships } = get();
    if (activeSchoolId) {
      return memberships.find(m => m.schoolId === activeSchoolId && m.status === 'ACTIVE') ?? null;
    }
    return memberships.find(m => m.status === 'ACTIVE') ?? null;
  },

  clear: () => {
    try { deleteStoredItem(STORAGE_KEY); } catch {}
    set({ activeSchoolId: null, memberships: [] });
  },
}));
