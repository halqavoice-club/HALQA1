import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'halqa_mobile' });

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
  if (value === '1') return true;
  if (value === '0') return false;
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
