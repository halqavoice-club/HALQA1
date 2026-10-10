/**
 * HALQA Mobile — Auth Store (Zustand + SecureStore)
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import api, { setAccessToken } from '@/lib/api';
import { updateSocketToken } from '@/lib/socket';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  schoolId: string | null;
  avatarUrl: string | null;
  username?: string;
  // Convenience aliases (populated during login/restore)
  name: string;
  avatar?: string;
  student?: { id: string } | null;
  guardian?: { id: string } | null;
  lastLoginAt?: string | null;
  emailVerified?: boolean;
  school?: { id: string; name: string } | null;
  schoolMemberships?: SchoolMembershipPreview[];
}

interface SchoolMembershipPreview {
  id: string;
  schoolId: string;
  role: string;
  status: string;
  joinedAt: string;
  school: { id: string; name: string; slug: string; logoUrl?: string; type?: string };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  login:  (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const REFRESH_TOKEN_KEY = 'halqa_refresh_token';

/** Push school memberships from a user object into the school store. */
function syncSchoolMemberships(user: User) {
  if (!user.schoolMemberships?.length) return;
  try {
    // Dynamic import avoids circular dependency
    import('@/store/school.store').then(({ useSchoolStore }) => {
      const activeMemberships = user.schoolMemberships!.filter(m => m.status === 'ACTIVE');
      useSchoolStore.getState().setMemberships(activeMemberships as any);
    }).catch(() => {});
  } catch {}
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,
  mustChangePassword: false,

  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user, mustChangePassword } = res.data.data;
    setAccessToken(accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    const enriched = { ...user, name: `${user.firstName} ${user.lastName}`.trim(), avatar: user.avatarUrl ?? undefined };
    set({ user: enriched, accessToken, isAuthenticated: true, mustChangePassword: !!mustChangePassword });
    // VC-SYNC-001: keep socket auth in sync so reconnections use the current token
    updateSocketToken(accessToken);

    // Populate school store so Education nav shows correct role immediately
    syncSchoolMemberships(enriched);
  },

  logout: async () => {
    // Clear access token FIRST so any subsequent API calls don't trigger
    // the 401 interceptor and cause an infinite logout loop.
    setAccessToken(null);
    set({ user: null, accessToken: null, isAuthenticated: false, mustChangePassword: false });

    try {
      // Best-effort: clear FCM token and invalidate session on server.
      // These calls intentionally use no auth token (cleared above) — failures are ignored.
      await api.put('/users/fcm-token', { token: null }).catch(() => {});
      await api.post('/auth/logout').catch(() => {});
    } catch {}

    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
    // Clear school context on logout
    try {
      const { useSchoolStore } = await import('@/store/school.store');
      useSchoolStore.getState().clear();
    } catch {}
  },

  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const storedRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!storedRefresh) { set({ isLoading: false }); return; }

      // Mobile can't use httpOnly cookies — send refreshToken in body
      const res = await api.post('/auth/refresh', { refreshToken: storedRefresh });
      const { accessToken, refreshToken: newRefreshToken, user: refreshedUser } = res.data.data;

      setAccessToken(accessToken);
      // VC-SYNC-001: keep socket auth in sync so reconnections use the current token
      updateSocketToken(accessToken);

      // Rotate stored refresh token if backend returned a new one
      if (newRefreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);

      // Always fetch /auth/me after restore — it includes schoolMemberships
      // which the refresh endpoint may not return.
      const meRes = await api.get('/auth/me');
      const userData = meRes.data.data ?? refreshedUser;

      const enriched = {
        ...userData,
        name: `${userData.firstName} ${userData.lastName}`.trim(),
        avatar: userData.avatarUrl ?? undefined,
      };
      set({ user: enriched, accessToken, isAuthenticated: true });

      // Populate school store from the restored session
      syncSchoolMemberships(enriched);
    } catch {
      setAccessToken(null);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } finally {
      set({ isLoading: false });
    }
  },

  updateUser: (updates) => {
    const current = get().user;
    if (current) {
      const updated = { ...current, ...updates };
      set({ user: updated });
      // Re-sync memberships if they were updated
      if (updates.schoolMemberships) syncSchoolMemberships(updated);
    }
  },
}));
