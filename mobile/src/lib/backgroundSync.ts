/**
 * HALQA Mobile — Background Sync with Exponential Backoff
 *
 * Requirement 16.1: When a sync attempt fails, wait before retrying using
 * exponential backoff starting at 30 seconds and doubling up to 1800 seconds
 * (30 minutes). Reset to 30 seconds on success.
 *
 * Backoff state is persisted in SecureStore so it survives app restarts and
 * process termination between background task invocations.
 */
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { syncPendingActions } from './offline';

export const BACKGROUND_SYNC_TASK = 'HALQA_BACKGROUND_SYNC';

// ─── Backoff constants ────────────────────────────────────────────────────────
const BACKOFF_KEY     = 'halqa_sync_backoff_seconds';
const MIN_INTERVAL_S  = 30;      // 30 seconds minimum
const MAX_INTERVAL_S  = 1800;    // 30 minutes maximum

/**
 * Read the current backoff interval from SecureStore.
 * Falls back to MIN_INTERVAL_S if the key is missing or unreadable.
 */
export async function getSyncBackoffSeconds(): Promise<number> {
  try {
    const stored = await SecureStore.getItemAsync(BACKOFF_KEY);
    if (!stored) return MIN_INTERVAL_S;
    const value = parseInt(stored, 10);
    return isNaN(value) ? MIN_INTERVAL_S : Math.min(Math.max(value, MIN_INTERVAL_S), MAX_INTERVAL_S);
  } catch {
    return MIN_INTERVAL_S;
  }
}

/**
 * Called after a successful sync.
 * Resets the backoff interval to the minimum (30 s).
 */
export async function onSyncSuccess(): Promise<void> {
  try {
    await SecureStore.setItemAsync(BACKOFF_KEY, String(MIN_INTERVAL_S));
  } catch {
    // Non-fatal — backoff will recover on next success
  }
}

/**
 * Called after a failed sync.
 * Doubles the current backoff interval, capped at MAX_INTERVAL_S.
 */
export async function onSyncFailed(): Promise<void> {
  try {
    const current = await getSyncBackoffSeconds();
    const next = Math.min(current * 2, MAX_INTERVAL_S);
    await SecureStore.setItemAsync(BACKOFF_KEY, String(next));
  } catch {
    // Non-fatal
  }
}

// ─── Background task definition ───────────────────────────────────────────────
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const synced = await syncPendingActions();

    if (synced) {
      // Req 16.1: success → reset backoff
      await onSyncSuccess();
      return BackgroundFetch.Result.NewData;
    } else {
      // No pending actions — not a failure, keep current backoff
      return BackgroundFetch.Result.NoData;
    }
  } catch {
    // Req 16.1: failure → increase backoff
    await onSyncFailed();
    return BackgroundFetch.Result.Failed;
  }
});

// ─── Registration ─────────────────────────────────────────────────────────────
export async function registerBackgroundSync() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.Status.Available) {
      const tasks = await TaskManager.getRegisteredTasksAsync();
      if (!tasks.some(task => task.taskName === BACKGROUND_SYNC_TASK)) {
        // Use the current backoff interval as the minimum fetch interval
        const intervalS = await getSyncBackoffSeconds();
        await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
          minimumInterval: intervalS,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }
    }
  } catch {
    // Background fetch not available or not permitted.
  }
}
