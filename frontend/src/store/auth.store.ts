'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import api from '@/lib/api'

// Lazy import to avoid circular dependency — queryClient is set up in providers.tsx
// We use a getter so the import resolves at call time, not module load time.
function getQueryClient() {
  try {
    // Dynamic require — safe because this only runs client-side
    return (require('@/components/providers') as { queryClient: { clear: () => void } }).queryClient
  } catch {
    return null
  }
}

// ─── In-memory token store (NOT persisted to localStorage) ───────────────────
// FE-001 (SEC): Access tokens must NEVER be stored in localStorage.
// localStorage is accessible to any JavaScript on the page — a single XSS
// vulnerability would leak the token and allow full account takeover.
//
// Strategy:
//   - accessToken lives ONLY in this module-level variable (memory only)
//   - On page refresh: the httpOnly refreshToken cookie silently re-authenticates
//     via POST /auth/refresh in the Providers component on mount
//   - The Zustand persist layer only stores: user metadata + isAuthenticated flag
//     (non-sensitive — used to show correct UI before the silent refresh completes)
//
// This means:
//   - XSS can read user's name/email from localStorage (low impact)
//   - XSS CANNOT steal the access token (high impact prevented)
let _accessTokenMemory: string | null = null;

function getMemoryToken(): string | null {
  return _accessTokenMemory;
}

function setMemoryToken(token: string | null) {
  _accessTokenMemory = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  status: string
  schoolId: string | null
  avatarUrl: string | null
  emailVerified?: boolean
  lastLoginAt?: string | null
  school?: { id: string; name: string; slug: string; logoUrl: string | null }
  student?: { id: string; studentId: string; qrCode: string | null }
  teacher?: { id: string; employeeId: string | null; department: string | null }
  guardian?: { id: string; relationship: string }
  // Education domain: school-scoped memberships
  // Each membership contains the user's role in a specific school.
  // This is the authoritative source for Education authorization.
  schoolMemberships?: SchoolMembership[]
}

export interface SchoolMembership {
  id: string
  userId: string
  schoolId: string
  role: string   // SUPER_ADMIN | SCHOOL_ADMIN | TEACHER | STUDENT | GUARDIAN
  status: string // ACTIVE | PENDING | SUSPENDED
  joinedAt: string
  school: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    type: string
  }
}

interface AuthState {
  user: User | null
  mustChangePassword: boolean
  isLoading: boolean
  isAuthenticated: boolean
  getAccessToken: () => string | null
  login: (email: string, password: string) => Promise<void>
  googleSignIn: (credential: string) => Promise<{ mustChangePassword: boolean; isNewUser: boolean; user: User }>
  logout: () => Promise<void>
  refreshToken: () => Promise<void>
  fetchMe: () => Promise<void>
  setUser: (user: User) => void
  setToken: (token: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      mustChangePassword: false,
      isLoading: false,
      isAuthenticated: false,

      // Accessor for the in-memory token — used by api.ts interceptor
      getAccessToken: () => getMemoryToken(),

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const response = await api.post('/auth/login', { email, password })
          const { user, accessToken, mustChangePassword = false } = response.data.data
          // Clear ALL cached queries before setting new user so stale data
          // from a previous session never leaks into the new account's view.
          getQueryClient()?.clear()
          // FE-001: store token in memory only, never in localStorage
          setMemoryToken(accessToken)
          set({ user, isAuthenticated: true, isLoading: false, mustChangePassword })
        } catch (error: any) {
          set({ isLoading: false })
          throw new Error(error.response?.data?.message || 'Login failed')
        }
      },

      // ── Google Sign-In ─────────────────────────────────────────────────────
      // Sends the Google ID token to HALQA backend for server-side verification.
      // Returns the same session shape as password login — reuses all existing
      // token management (memory-only access token, httpOnly refresh cookie).
      googleSignIn: async (credential: string) => {
        set({ isLoading: true })
        try {
          const response = await api.post('/auth/google', { credential })
          const { user, accessToken, mustChangePassword = false, isNewUser = false } = response.data.data
          getQueryClient()?.clear()
          setMemoryToken(accessToken)
          set({ user, isAuthenticated: true, isLoading: false, mustChangePassword })
          return { mustChangePassword, isNewUser, user }
        } catch (error: any) {
          set({ isLoading: false })
          throw new Error(error.response?.data?.message || 'Google Sign-In failed')
        }
      },

      logout: async () => {
        try {
          await api.post('/auth/logout')
        } catch {}
        // Clear ALL cached queries so the next user starts with a clean slate
        getQueryClient()?.clear()
        // FE-001: wipe memory token on logout
        setMemoryToken(null)
        set({ user: null, isAuthenticated: false, mustChangePassword: false })
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
      },

      refreshToken: async () => {
        try {
          const response = await api.post('/auth/refresh')
          const { accessToken } = response.data.data
          // FE-001: new token goes to memory only
          setMemoryToken(accessToken)
          // FE-010: keep socket auth token in sync so reconnections use fresh token
          try {
            const { updateSocketToken } = require('@/lib/socket')
            updateSocketToken(accessToken)
          } catch {}
        } catch {
          setMemoryToken(null)
          set({ user: null, isAuthenticated: false })
        }
      },

      fetchMe: async () => {
        try {
          const response = await api.get('/auth/me')
          set({ user: response.data.data, isAuthenticated: true })
        } catch {
          set({ user: null, isAuthenticated: false })
        }
      },

      setUser: (user) => set({ user }),
      setToken: (token) => {
        // FE-001: keep token out of Zustand state — store in memory only
        setMemoryToken(token)
        // FE-010: keep socket auth token in sync
        try {
          const { updateSocketToken } = require('@/lib/socket')
          updateSocketToken(token)
        } catch {}
      }
    }),
    {
      name: 'halqa-auth',
      storage: createJSONStorage(() => {
        // Safe localStorage access — returns no-op storage during SSR
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
          }
        }
        return localStorage
      }),
      // FE-001: NEVER include accessToken in persisted state.
      // Only persist user metadata (name, role, avatar) and auth flag.
      // On page refresh, providers.tsx calls refreshToken() to silently
      // restore the memory token using the httpOnly refreshToken cookie.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        mustChangePassword: state.mustChangePassword,
      }),
      skipHydration: true
    }
  )
)
