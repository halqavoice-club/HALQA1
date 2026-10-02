/**
 * Mobile Auth Store — Unit Tests
 *
 * Covers login, logout, session restore, and token storage behaviour.
 * All network calls and SecureStore are mocked.
 */

// ─── Mock SecureStore ─────────────────────────────────────────────────────────
const _secureStore: Record<string, string> = {}
jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(async (k: string) => _secureStore[k] ?? null),
  setItemAsync:    jest.fn(async (k: string, v: string) => { _secureStore[k] = v }),
  deleteItemAsync: jest.fn(async (k: string) => { delete _secureStore[k] }),
}))

// ─── Mock API ─────────────────────────────────────────────────────────────────
const mockPost = jest.fn()
const mockGet  = jest.fn()
const mockPut  = jest.fn()
jest.mock('../lib/api', () => ({
  __esModule: true,
  default: {
    post: (...a: any[]) => mockPost(...a),
    get:  (...a: any[]) => mockGet(...a),
    put:  (...a: any[]) => mockPut(...a),
    request: jest.fn(),
  },
  setAccessToken: jest.fn(),
}))

// ─── Mock expo-notifications ──────────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  getPermissionsAsync:  jest.fn(async () => ({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: null })),
}))

import * as SecureStore from 'expo-secure-store'
import { setAccessToken } from '../lib/api'
import { useAuthStore } from '../store/auth.store'

const REFRESH_TOKEN_KEY = 'halqa_refresh_token'

const mockUser = {
  id: 'u1', email: 'test@halqa.com', role: 'STUDENT',
  firstName: 'Ali', lastName: 'Hassan',
  schoolId: 's1', avatarUrl: null, status: 'ACTIVE',
}

beforeEach(() => {
  jest.clearAllMocks()
  // Reset SecureStore mock
  Object.keys(_secureStore).forEach(k => delete _secureStore[k])
  // Reset store
  useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false })
})

// ─── Login ────────────────────────────────────────────────────────────────────

describe('login()', () => {
  it('sets user, accessToken, and isAuthenticated on success', async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { user: mockUser, accessToken: 'tok_abc', refreshToken: 'ref_xyz' } }
    })

    await useAuthStore.getState().login('test@halqa.com', 'pass123')

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.email).toBe('test@halqa.com')
    expect(state.user?.name).toBe('Ali Hassan')
    expect(setAccessToken).toHaveBeenCalledWith('tok_abc')
  })

  it('persists refresh token in SecureStore', async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { user: mockUser, accessToken: 'tok_abc', refreshToken: 'ref_xyz' } }
    })
    await useAuthStore.getState().login('test@halqa.com', 'pass123')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'ref_xyz')
  })

  it('throws on login failure', async () => {
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'Bad credentials' } } })
    await expect(useAuthStore.getState().login('bad@email.com', 'wrong'))
      .rejects.toBeTruthy()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('logout()', () => {
  it('clears state and SecureStore', async () => {
    _secureStore[REFRESH_TOKEN_KEY] = 'old_token'
    useAuthStore.setState({ user: mockUser as any, accessToken: 'tok', isAuthenticated: true })

    mockPut.mockResolvedValueOnce({})
    mockPost.mockResolvedValueOnce({})

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(setAccessToken).toHaveBeenCalledWith(null)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY)
  })

  it('clears state even when API call fails', async () => {
    _secureStore[REFRESH_TOKEN_KEY] = 'token'
    useAuthStore.setState({ user: mockUser as any, isAuthenticated: true })

    mockPut.mockRejectedValueOnce(new Error('net'))
    mockPost.mockRejectedValueOnce(new Error('net'))

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})

// ─── Session restore ──────────────────────────────────────────────────────────

describe('restoreSession()', () => {
  it('restores session when refresh token is valid', async () => {
    _secureStore[REFRESH_TOKEN_KEY] = 'valid_refresh'
    mockPost.mockResolvedValueOnce({
      data: { data: { accessToken: 'new_tok', refreshToken: 'new_ref', user: mockUser } }
    })
    mockGet.mockResolvedValueOnce({
      data: { data: mockUser }
    })

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(setAccessToken).toHaveBeenCalledWith('new_tok')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'new_ref')
  })

  it('sets isLoading=false when no refresh token stored', async () => {
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isLoading).toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('clears state and SecureStore when refresh token is invalid', async () => {
    _secureStore[REFRESH_TOKEN_KEY] = 'expired'
    mockPost.mockRejectedValueOnce({ response: { status: 401 } })

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(setAccessToken).toHaveBeenCalledWith(null)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('falls back to /auth/me when refresh response has no user', async () => {
    _secureStore[REFRESH_TOKEN_KEY] = 'valid_refresh'
    mockPost.mockResolvedValueOnce({
      data: { data: { accessToken: 'tok', refreshToken: 'ref' } } // no user
    })
    mockGet.mockResolvedValueOnce({ data: { data: mockUser } })

    await useAuthStore.getState().restoreSession()

    expect(mockGet).toHaveBeenCalledWith('/auth/me')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

// ─── updateUser ───────────────────────────────────────────────────────────────

describe('updateUser()', () => {
  it('merges updates into existing user', () => {
    useAuthStore.setState({ user: { ...mockUser, name: 'Ali Hassan' } as any })
    useAuthStore.getState().updateUser({ avatarUrl: 'https://cdn.example.com/avatar.jpg' })
    expect(useAuthStore.getState().user?.avatarUrl).toBe('https://cdn.example.com/avatar.jpg')
    expect(useAuthStore.getState().user?.email).toBe('test@halqa.com') // unchanged
  })

  it('is a no-op when user is null', () => {
    useAuthStore.setState({ user: null })
    expect(() => useAuthStore.getState().updateUser({ avatarUrl: 'x' })).not.toThrow()
    expect(useAuthStore.getState().user).toBeNull()
  })
})
