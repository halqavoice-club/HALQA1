/**
 * HALQA Mobile — Offline Mutation Queue
 *
 * Requirements 16.3, 16.4:
 * - Queue is capped at 500 mutations. New mutations are dropped (with a log)
 *   when the cap is reached.
 * - Each failed action tracks a `failCount`. After 3 consecutive failures
 *   the action is discarded and the user is notified.
 */
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { showMessage } from 'react-native-flash-message';
import api from './api';
import { getStoredJSON, setStoredJSON, deleteStoredItem } from './storage';
import { logEvent } from './analytics';

const PENDING_ACTIONS_KEY = 'halqa_pending_actions';

/** Maximum number of pending mutations allowed in the queue (Req 16.3). */
const MAX_QUEUE_SIZE = 500;

/** Number of consecutive replay failures before an action is discarded (Req 16.4). */
const MAX_FAIL_COUNT = 3;

export type OfflineAction = {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: any;
  headers?: Record<string, string>;
  createdAt: number;
  /** REQ-16.4: Tracks how many consecutive replay failures this action has. */
  failCount?: number;
};

export async function getNetworkState(): Promise<NetInfoState> {
  return NetInfo.fetch();
}

export async function isOnline(): Promise<boolean> {
  const state = await getNetworkState();
  return Boolean(state.isConnected && state.isInternetReachable);
}

/**
 * Queue a mutation for later replay.
 * REQ-16.3: If the queue already has 500+ actions, drop the new one and log.
 */
export async function queueOfflineAction(action: Omit<OfflineAction, 'id' | 'createdAt'>) {
  const existing = (getStoredJSON<OfflineAction[]>(PENDING_ACTIONS_KEY) ?? []);

  // REQ-16.3: Hard cap at 500 pending mutations
  if (existing.length >= MAX_QUEUE_SIZE) {
    await logEvent('offline_queue_full', { url: action.url, method: action.method, queueSize: existing.length });
    return; // drop silently — caller should inform user that sync is maxed
  }

  const next: OfflineAction[] = [
    ...existing,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      failCount: 0,
      ...action,
    },
  ];
  setStoredJSON(PENDING_ACTIONS_KEY, next);
  await logEvent('offline_action_queued', { url: action.url, method: action.method });
}

/**
 * Replay all queued mutations in creation order.
 * REQ-16.4: Failed actions are re-queued with failCount+1.
 *           If failCount reaches MAX_FAIL_COUNT, the action is discarded
 *           and a notification is shown to the user.
 */
export async function syncPendingActions(): Promise<boolean> {
  const actions = getStoredJSON<OfflineAction[]>(PENDING_ACTIONS_KEY) ?? [];
  if (actions.length === 0) return false;
  if (!(await isOnline())) return false;

  const remaining: OfflineAction[] = [];

  for (const action of actions) {
    try {
      await api.request({
        url: action.url,
        method: action.method,
        data: action.body,
        headers: action.headers,
      });
      await logEvent('offline_action_synced', { url: action.url, method: action.method });
    } catch (error) {
      const newFailCount = (action.failCount ?? 0) + 1;

      if (newFailCount >= MAX_FAIL_COUNT) {
        // REQ-16.4: Discard after 3 failures and notify user
        await logEvent('offline_action_discarded', { url: action.url, method: action.method, failCount: newFailCount });
        showMessage({
          message: 'Action could not be completed',
          description: `A pending ${action.method} request could not be synced after ${MAX_FAIL_COUNT} attempts and was discarded.`,
          type: 'warning',
          duration: 5000,
        });
      } else {
        // Re-queue with incremented fail count
        remaining.push({ ...action, failCount: newFailCount });
        await logEvent('offline_action_failed', { url: action.url, method: action.method, failCount: newFailCount });
      }
    }
  }

  if (remaining.length === 0) {
    deleteStoredItem(PENDING_ACTIONS_KEY);
  } else {
    setStoredJSON(PENDING_ACTIONS_KEY, remaining);
  }

  return remaining.length === 0;
}
