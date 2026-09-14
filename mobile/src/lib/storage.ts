/**
 * HALQA Mobile — Storage Abstraction
 *
 * Uses react-native-mmkv in native builds (fast C++ storage).
 * Falls back to a simple in-memory Map in Expo Go (where MMKV native
 * module is not available).
 *
 * NOTE: In-memory fallback does NOT persist across app restarts.
 * For Expo Go testing this is acceptable — all features work, data
 * just resets on close. Production APK always uses MMKV.
 */

interface Storage {
  getString(key: string): string | undefined;
  set(key: string, value: string | boolean | number): void;
  delete(key: string): void;
}

// Try to load MMKV — fails gracefully in Expo Go
function createStorage(): Storage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MMKV } = require('react-native-mmkv');
    return new MMKV({ id: 'halqa_mobile' });
  } catch {
    // MMKV not available (Expo Go without native build)
    // Fall back to in-memory map
    const map = new Map<string, string>();
    return {
      getString: (key: string) => map.get(key),
      set: (key: string, value: string | boolean | number) => map.set(key, String(value)),
      delete: (key: string) => { map.delete(key); },
    };
  }
}

const storage = createStorage();

export function getStoredString(key: string): string | null {
  return storage.getString(key) ?? null;
}

export function setStoredString(key: string, value: string): void {
  storage.set(key, value);
}

export function deleteStoredItem(key: string): void {
  storage.delete(key);
}

export function getStoredBoolean(key: string, fallback = false): boolean {
  const value = storage.getString(key);
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

export function setStoredBoolean(key: string, value: boolean): void {
  storage.set(key, value ? '1' : '0');
}

export function getStoredJSON<T>(key: string): T | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredJSON(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}
