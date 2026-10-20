/**
 * HALQA Mobile — Notifications Store (Zustand)
 *
 * Tracks the unread notification count for the tab badge.
 * The actual notification list is fetched by TanStack Query.
 * This store only holds client-side state that survives screen transitions.
 */
import { create } from 'zustand';
import { getStoredString, setStoredString } from '@/lib/storage';

const STORAGE_KEY = 'halqa:unread_notifications';

interface NotificationsState {
  /** Unread count shown on the tab badge */
  unreadCount: number;

  /** Set the current unread count (called after fetching /notifications) */
  setUnreadCount: (count: number) => void;

  /** Decrement count when user opens the notifications tab */
  markAllRead: () => void;

  /** Increment when a new push notification arrives */
  incrementUnread: () => void;
}

function loadPersistedCount(): number {
  try {
    const val = getStoredString(STORAGE_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  unreadCount: loadPersistedCount(),

  setUnreadCount: (count) => {
    try { setStoredString(STORAGE_KEY, String(count)); } catch {}
    set({ unreadCount: count });
  },

  markAllRead: () => {
    try { setStoredString(STORAGE_KEY, '0'); } catch {}
    set({ unreadCount: 0 });
  },

  incrementUnread: () => {
    const next = get().unreadCount + 1;
    try { setStoredString(STORAGE_KEY, String(next)); } catch {}
    set({ unreadCount: next });
  },
}));
