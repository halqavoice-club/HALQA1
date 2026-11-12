/**
 * HALQA Mobile — LowDataMode Store
 *
 * Persists the user's data-saver preference via MMKV and merges it with
 * the automatic network-quality signal from useNetworkQuality.
 *
 * Logic:
 *   - userPreference === null  → auto mode: isEnabled follows setAutoEnabled calls
 *   - userPreference === true  → always on, ignores auto signals
 *   - userPreference === false → always off, ignores auto signals
 *
 * Only `userPreference` is persisted. `isEnabled` is derived at runtime so it
 * always reflects the latest auto signal after a fresh launch.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

// ─── MMKV storage adapter ─────────────────────────────────────────────────────
const mmkv = new MMKV({ id: 'halqa-low-data-mode' });

const mmkvStorage = createJSONStorage(() => ({
  getItem:    (name: string) => mmkv.getString(name) ?? null,
  setItem:    (name: string, value: string) => mmkv.set(name, value),
  removeItem: (name: string) => mmkv.delete(name),
}));

// ─── Types ────────────────────────────────────────────────────────────────────
export interface LowDataModeState {
  /** User's explicit preference. null = auto (follow network quality). */
  userPreference: boolean | null;
  /** Effective low-data flag used by UI components. */
  isEnabled: boolean;
  /**
   * Called by useNetworkQuality consumers to signal automatic enable/disable.
   * Has no effect when userPreference is explicitly set (true or false).
   */
  setAutoEnabled: (on: boolean) => void;
  /**
   * Called when the user toggles the Data Saver setting.
   * Pass null to reset to automatic mode.
   */
  setUserPreference: (pref: boolean | null) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useLowDataMode = create<LowDataModeState>()(
  persist(
    (set, get) => ({
      userPreference: null,
      isEnabled: false,

      setAutoEnabled: (on: boolean) => {
        // Only update isEnabled when in auto mode (userPreference === null)
        if (get().userPreference === null) {
          set({ isEnabled: on });
        }
      },

      setUserPreference: (pref: boolean | null) => {
        set({
          userPreference: pref,
          // When resetting to auto (null), keep current isEnabled as-is until
          // the next setAutoEnabled call resolves it from live network state.
          // When setting an explicit value, apply it immediately.
          ...(pref !== null ? { isEnabled: pref } : {}),
        });
      },
    }),
    {
      name: 'halqa-low-data-mode',
      storage: mmkvStorage,
      // Only persist the user's explicit preference — isEnabled is derived at runtime
      partialize: (state) => ({ userPreference: state.userPreference }),
    }
  )
);

/**
 * Convenience selector: returns only the effective isEnabled boolean.
 * Use this in components that only need to branch on low-data mode.
 *
 * @example
 *   const isLowData = useLowData();
 *   return isLowData ? <Text>{initials}</Text> : <Image source={...} />;
 */
export function useLowData(): boolean {
  return useLowDataMode((s) => s.isEnabled);
}
