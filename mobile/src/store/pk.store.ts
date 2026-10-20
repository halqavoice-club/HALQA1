/**
 * HALQA Mobile — PK Battle Store (Zustand)
 *
 * Holds real-time PK battle state that needs to persist across navigation
 * (e.g. when briefly leaving the PK screen to check a gift panel).
 *
 * Socket events are handled in the PK screen; this store is the single
 * source of truth for the current match state.
 */
import { create } from 'zustand';

type PKMatchState = 'PREPARING' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'FINISHING' | 'COMPLETED' | 'ABORTED';

export interface PKParticipant {
  userId: string;
  side: 'A' | 'B';
  role: string;
  user?: { firstName: string; lastName: string; avatarUrl?: string | null };
}

export interface PKMatch {
  id: string;
  state: PKMatchState;
  scoreA: number;
  scoreB: number;
  giftScoreA: number;
  giftScoreB: number;
  voteScoreA: number;
  voteScoreB: number;
  durationSeconds: number;
  winnerId: string | null;
  winnerSide: string | null;
  participants: PKParticipant[];
}

interface PKState {
  /** Active match — null when not in a battle */
  activeMatch: PKMatch | null;

  /** Whether user is currently in matchmaking queue */
  inQueue: boolean;

  /** Duration preference for next battle (seconds) */
  preferredDuration: number;

  // Actions
  setActiveMatch: (match: PKMatch | null) => void;
  updateMatch: (patch: Partial<PKMatch>) => void;
  updateScores: (scoreA: number, scoreB: number) => void;
  setMatchState: (state: PKMatchState) => void;
  setInQueue: (v: boolean) => void;
  setPreferredDuration: (seconds: number) => void;
  clearMatch: () => void;
}

export const usePKStore = create<PKState>((set, get) => ({
  activeMatch: null,
  inQueue: false,
  preferredDuration: 300, // 5 minutes default

  setActiveMatch: (match) => set({ activeMatch: match }),

  updateMatch: (patch) => {
    const current = get().activeMatch;
    if (!current) return;
    set({ activeMatch: { ...current, ...patch } });
  },

  updateScores: (scoreA, scoreB) => {
    const current = get().activeMatch;
    if (!current) return;
    set({ activeMatch: { ...current, scoreA, scoreB } });
  },

  setMatchState: (state) => {
    const current = get().activeMatch;
    if (!current) return;
    set({ activeMatch: { ...current, state } });
  },

  setInQueue: (v) => set({ inQueue: v }),

  setPreferredDuration: (seconds) => set({ preferredDuration: seconds }),

  clearMatch: () => set({ activeMatch: null, inQueue: false }),
}));
