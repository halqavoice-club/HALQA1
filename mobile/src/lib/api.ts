/**
 * HALQA Mobile — API client
 *
 * URL resolution order:
 *   1. Runtime override stored in SecureStore (set via Settings screen)
 *   2. EXPO_PUBLIC_API_URL baked into the APK at build time
 *   3. Fallback: http://localhost:5000/api/v1 (dev only)
 */
import axios from 'axios';

// ─── HTTPS enforcement ────────────────────────────────────────────────────────

/**
 * Validates that a URL uses HTTPS in production builds.
 *
 * In __DEV__ mode, `http://` is permitted only for localhost and 127.0.0.1.
 * All other http:// targets are rejected in both dev and production.
 *
 * Requirement 15.1: Production builds must never transmit data over http://.
 * Requirement 15.2: __DEV__ mode allows http://localhost and http://127.0.0.1 only.
 */
export function assertHttps(url: string): void {
  if (!url.startsWith('http://')) {
    // https:// or any other scheme — always allowed
    return;
  }

  if (__DEV__) {
    // Allow localhost, loopback, and LAN IPs in dev mode
    const devPattern = /^http:\/\/(localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/;
    if (devPattern.test(url)) {
      return;
    }
    throw new Error(
      `[assertHttps] Insecure URL blocked in __DEV__ mode: "${url}". ` +
        'Only http://localhost, loopback, or LAN IPs are allowed in development.'
    );
  }

  // Production: reject all http:// URLs
  throw new Error(
    `[assertHttps] Insecure URL blocked in production: "${url}". ` +
      'The mobile API client requires https:// URLs in non-dev builds.'
  );
}

// ─── Build-time URL (injected by EAS via eas.json preview.env) ────────────────

// Validate build-time URLs at module load time (production only — __DEV__ check is inside assertHttps)
const _rawBuildApiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const _rawBuildSocketUrl = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:5000';

assertHttps(_rawBuildApiUrl);
assertHttps(_rawBuildSocketUrl);

export const BUILD_API_URL = _rawBuildApiUrl;

export const BUILD_SOCKET_URL = _rawBuildSocketUrl;

// SecureStore key for runtime URL override
export const API_URL_OVERRIDE_KEY = 'halqa_api_url_override';

// Active base URL — starts with build-time value, overridden at runtime if set
let _baseURL = BUILD_API_URL;
let _socketURL = BUILD_SOCKET_URL;

export function getBaseURL()   { return _baseURL; }
export function getSocketURL() { return _socketURL; }

/**
 * Apply a runtime URL override.
 * Called once during app startup (after SecureStore is read).
 * Also used by the Settings screen to change URLs without rebuilding.
 */
export function applyURLOverride(apiUrl: string) {
  _baseURL   = apiUrl.endsWith('/api/v1') ? apiUrl : `${apiUrl.replace(/\/$/, '')}/api/v1`;
  _socketURL = apiUrl.replace('/api/v1', '').replace(/\/$/, '');
  api.defaults.baseURL = _baseURL;
}

// ─── Axios instance ───────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: _baseURL,
  timeout: 30000,
  // Note: Content-Type is NOT set globally here.
  // For JSON requests (default), axios sets 'application/json' automatically.
  // For FormData requests (file uploads), React Native's FormData sets
  // 'multipart/form-data; boundary=...' automatically when Content-Type is unset.
  // Setting it globally to application/json breaks all file uploads.
});

// ─── Token storage ────────────────────────────────────────────────────────────
let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

// ─── Single-flight refresh ────────────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  refreshQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!)
  );
  refreshQueue = [];
}

// ─── Request interceptor ─────────────────────────────────────────────────────
api.interceptors.request.use(config => {
  if (_accessToken) config.headers.Authorization = `Bearer ${_accessToken}`;

  // Attach active school context so the backend resolveSchoolId() picks it up
  // without needing schoolId in params/body. This is required for education
  // endpoints that use requireSchoolMember() middleware.
  try {
    const { useSchoolStore } = require('@/store/school.store');
    const activeSchoolId = useSchoolStore.getState().activeSchoolId;
    if (activeSchoolId) {
      config.headers['x-school-id'] = activeSchoolId;
    }
  } catch {
    // School store not yet loaded — skip header
  }

  return config;
});

// ─── Response interceptor — auto-refresh on 401 ─────────────────────────────
api.interceptors.response.use(
  r => r,
  async error => {
    const original = error.config;

    // Skip refresh loop for auth endpoints to avoid infinite recursion
    if (
      original?.url?.includes('/auth/refresh') ||
      original?.url?.includes('/auth/logout') ||
      original?.url?.includes('/users/fcm-token')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original?._retry) {
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      isRefreshing = true;
      try {
        // Mobile can't use httpOnly cookies — read stored refresh token
        const { default: SecureStore } = await import('expo-secure-store');
        const storedRefresh = await SecureStore.getItemAsync('halqa_refresh_token');
        if (!storedRefresh) {
          // No refresh token — force logout
          authEventEmitter.emit('logout');
          return Promise.reject(error);
        }

        const res = await api.post('/auth/refresh', { refreshToken: storedRefresh });
        const { accessToken, refreshToken: newRefresh } = res.data.data;

        setAccessToken(accessToken);
        if (newRefresh) {
          await SecureStore.setItemAsync('halqa_refresh_token', newRefresh);
        }

        processQueue(null, accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        setAccessToken(null);
        authEventEmitter.emit('logout');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Auth event emitter ───────────────────────────────────────────────────────
type AuthListener = (event: string) => void;
const listeners: AuthListener[] = [];

export const authEventEmitter = {
  emit: (event: string) => listeners.forEach(l => l(event)),
  on: (cb: AuthListener) => {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i > -1) listeners.splice(i, 1);
    };
  },
};

export default api;
