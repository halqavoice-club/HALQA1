/**
 * Mobile Voice Store — Zustand
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the web voice.store.ts structure but keeps it mobile-appropriate.
 * Shared between:
 *   - (tabs)/voice.tsx        — lobby list, active-room badge
 *   - voice/[id].tsx          — full room screen
 *   - feed cards              — live indicators
 *
 * State is intentionally minimal: the heavy per-room state (participants,
 * chat, gifts) stays local in the room screen for performance. Only state
 * that needs to cross screen boundaries lives here.
 */
import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceRoomStatus   = 'LIVE' | 'IDLE' | 'ENDED' | 'SCHEDULED';
export type VoiceRoomPrivacy  = 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
export type VoiceParticipantRole = 'HOST' | 'MODERATOR' | 'SPEAKER' | 'AUDIENCE';

export interface VoiceUser {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

/** Lightweight room summary — used in the lobby list and feed cards */
export interface VoiceRoomSummary {
  id: string;
  title: string;
  status: VoiceRoomStatus;
  privacy: VoiceRoomPrivacy;
  coverEmoji: string | null;
  coverImageUrl: string | null;
  topic: string | null;
  hostId: string;
  participantCount: number;
  isOpenMic: boolean;
  micLocked: boolean;
  roomLevel: number;
  schoolId: string | null;
  scheduledAt: string | null;
}

/** Active room identity — set when the user enters a room */
export interface ActiveVoiceRoom {
  id: string;
  title: string;
  status: VoiceRoomStatus;
  privacy: VoiceRoomPrivacy;
  coverEmoji: string | null;
  coverImageUrl: string | null;
  topic: string | null;
  hostId: string;
  isOpenMic: boolean;
  micLocked: boolean;
  commentsEnabled: boolean;
  slowMode: boolean;
  messageType: 'all' | 'followers' | 'none';
  reactionsEnabled: boolean;
  roomLevel: number;
  schoolId: string | null;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface VoiceState {
  // ── Lobby rooms (fetched by the tab screen) ─────────────────────────────
  rooms: VoiceRoomSummary[];
  setRooms: (rooms: VoiceRoomSummary[]) => void;
  updateRoomSummary: (roomId: string, patch: Partial<VoiceRoomSummary>) => void;
  removeRoom: (roomId: string) => void;
  addRoom: (room: VoiceRoomSummary) => void;

  // ── Active room (set when entering, cleared when leaving) ────────────────
  // Enables the tab bar to show an "IN ROOM" badge and prevents double-join.
  activeRoomId: string | null;
  activeRoom: ActiveVoiceRoom | null;
  setActiveRoom: (room: ActiveVoiceRoom | null) => void;
  updateActiveRoom: (patch: Partial<ActiveVoiceRoom>) => void;
  clearActiveRoom: () => void;

  // ── Speaking state — used by the room screen stage grid ──────────────────
  speakingUsers: Record<string, boolean>;
  setSpeaking: (userId: string, speaking: boolean) => void;
  clearSpeaking: () => void;

  // ── Unread chat count — shown on the chat button badge ───────────────────
  unreadChatCount: number;
  incrementUnread: () => void;
  clearUnread: () => void;

  // ── Queue position — shown on the "In Queue" indicator ───────────────────
  myQueuePosition: number; // 0 = not in queue
  setQueuePosition: (pos: number) => void;
  clearQueuePosition: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useVoiceStore = create<VoiceState>((set, get) => ({
  // ── Lobby rooms ─────────────────────────────────────────────────────────
  rooms: [],
  setRooms: (rooms) => set({ rooms }),

  updateRoomSummary: (roomId, patch) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    })),

  removeRoom: (roomId) =>
    set((s) => ({ rooms: s.rooms.filter((r) => r.id !== roomId) })),

  addRoom: (room) =>
    set((s) => {
      // Avoid duplicates
      if (s.rooms.some((r) => r.id === room.id)) return s;
      return { rooms: [room, ...s.rooms] };
    }),

  // ── Active room ─────────────────────────────────────────────────────────
  activeRoomId: null,
  activeRoom: null,

  setActiveRoom: (room) =>
    set({
      activeRoomId: room?.id ?? null,
      activeRoom: room,
      // Reset per-room UI state when entering a room
      unreadChatCount: 0,
      myQueuePosition: 0,
      speakingUsers: {},
    }),

  updateActiveRoom: (patch) => {
    const room = get().activeRoom;
    if (!room) return;
    set({ activeRoom: { ...room, ...patch } });
  },

  clearActiveRoom: () =>
    set({
      activeRoomId: null,
      activeRoom: null,
      speakingUsers: {},
      unreadChatCount: 0,
      myQueuePosition: 0,
    }),

  // ── Speaking indicators ─────────────────────────────────────────────────
  speakingUsers: {},

  setSpeaking: (userId, speaking) =>
    set((s) => ({
      speakingUsers: speaking
        ? { ...s.speakingUsers, [userId]: true }
        : Object.fromEntries(
            Object.entries(s.speakingUsers).filter(([k]) => k !== userId)
          ),
    })),

  clearSpeaking: () => set({ speakingUsers: {} }),

  // ── Unread chat ─────────────────────────────────────────────────────────
  unreadChatCount: 0,
  incrementUnread: () => set((s) => ({ unreadChatCount: s.unreadChatCount + 1 })),
  clearUnread: () => set({ unreadChatCount: 0 }),

  // ── Queue position ───────────────────────────────────────────────────────
  myQueuePosition: 0,
  setQueuePosition: (pos) => set({ myQueuePosition: pos }),
  clearQueuePosition: () => set({ myQueuePosition: 0 }),
}));
