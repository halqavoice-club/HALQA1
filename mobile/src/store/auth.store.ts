/**
 * HALQA Mobile — Auth Store (Zustand + SecureStore)
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import api, { setAccessToken } from '@/lib/api';

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
  lastLoginAt?: string | null;
  emailVerified?: boolean;
  school?: { id: string; name: string } | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login:  (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const REFRESH_TOKEN_KEY = 'halqa_refresh_token';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken, user } = res.data.data;
    setAccessToken(accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    const enriched = { ...user, name: `${user.firstName} ${user.lastName}`.trim(), avatar: user.avatarUrl ?? undefined };
    set({ user: enriched, accessToken, isAuthenticated: true });

    // Register FCM push token after successful login
    try {
      const { default: Notifications } = await import('expo-notifications');
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        if (tokenData?.data) {
          await api.put('/users/fcm-token', { token: tokenData.data }).catch(() => {});
        }
      }
    } catch { /* push not available — no-op */ }
  },

  logout: async () => {
    try {
      // Clear FCM token from server before logging out
      await api.put('/users/fcm-token', { token: null }).catch(() => {});
      await api.post('/auth/logout');
    } catch {}
    setAccessToken(null);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null, isAuthenticated: false });
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

      // Rotate stored refresh token if backend returned a new one
      if (newRefreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);

      // If backend returned user directly, use it; otherwise fetch /auth/me
      let userData = refreshedUser;
      if (!userData) {
        const meRes = await api.get('/auth/me');
        userData = meRes.data.data;
      }

      const enriched = {
        ...userData,
        name: `${userData.firstName} ${userData.lastName}`.trim(),
        avatar: userData.avatarUrl ?? undefined,
      };
      set({ user: enriched, accessToken, isAuthenticated: true });

      // Re-register FCM push token — tokens rotate, so we refresh on every cold start
      try {
        const { default: Notifications } = await import('expo-notifications');
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          const tokenData = await Notifications.getExpoPushTokenAsync();
          if (tokenData?.data) {
            await api.put('/users/fcm-token', { token: tokenData.data }).catch(() => {});
          }
        }
      } catch { /* push not available — no-op */ }
    } catch {
      setAccessToken(null);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } finally {
      set({ isLoading: false });
    }
  },

  updateUser: (updates) => {
    const current = get().user;
    if (current) set({ user: { ...current, ...updates } });
  },
}));
