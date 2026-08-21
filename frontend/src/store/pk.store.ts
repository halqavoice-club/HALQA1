'use client'

import { create } from 'zustand'

// ─── PK Types ─────────────────────────────────────────────────────────────────

export type PKMatchType = 'ONE_V_ONE' | 'ROOM_V_ROOM' | 'TEAM_V_TEAM' | 'CLUB_V_CLUB' | 'TOURNAMENT'
export type PKState    = 'IDLE' | 'MATCHMAKING' | 'INVITED' | 'PENDING_ACCEPTANCE' | 'ACCEPTED' |
                         'PREPARING' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'FINISHING' |
                         'COMPLETED' | 'CANCELLED' | 'ABORTED' | 'DISPUTED'
export type PKSide     = 'A' | 'B'
export type PKRank     = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'MASTER' | 'GRANDMASTER'

export interface PKUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export interface PKParticipant {
  userId: string
  side:   PKSide
  role:   string
  user?:  PKUser
}

export interface PKMatch {
  id:             string
  type:           PKMatchType
  state:          PKState
  scoreA:         number
  scoreB:         number
  giftScoreA:     number
  giftScoreB:     number
  voteScoreA:     number
  voteScoreB:     number
  peakComboA:     number
  peakComboB:     number
  durationSeconds: number
  startedAt:      string | null
  endedAt:        string | null
  winnerId:       string | null
  winnerSide:     PKSide | 'DRAW' | null
  participants:   PKParticipant[]
  isRematch:      boolean
  previousMatchId: string | null
}

export interface PKTimerState {
  startedAt:       string
  durationSeconds: number
  pausedAt:        string | null
  pausedDuration:  number
  remainingSeconds: number
}

export interface PKGiftFeedItem {
  id:              string
  side:            PKSide
  beneficiaryId:   string
  giftScore:       number
  bonusScore:      number
  finalScore:      number
  comboLevel:      number
  isComebackBonus: boolean
  timestamp:       number
}

export interface PKComboState {
  side:      PKSide
  level:     number
  multiplier: number
}

export interface PKInvitation {
  id:              string
  senderId:        string
  receiverId:      string
  type:            PKMatchType
  status:          string
  durationSeconds: number
  expiresAt:       string
  sender?: PKUser
}

export interface PKUserStats {
  userId:         string
  totalPKs:       number
  wins:           number
  losses:         number
  draws:          number
  winRate:        number
  currentStreak:  number
  bestStreak:     number
  rating:         number
  rank:           PKRank
  totalScore:     number
  highestScore:   number
}

export interface PKLeaderboardEntry {
  userId:  string
  rank:    number
  score:   number
  wins:    number
  rating:  number
  user?:   PKUser
}

// ─── PK Store ─────────────────────────────────────────────────────────────────

interface PKStoreState {
  // Active match
  activeMatch:      PKMatch | null
  setActiveMatch:   (m: PKMatch | null) => void
  updateMatchScore: (scoreA: number, scoreB: number, giftScoreA?: number, giftScoreB?: number) => void
  setMatchState:    (state: PKState) => void
  setWinner:        (winnerId: string | null, winnerSide: PKSide | 'DRAW' | null) => void

  // Timer (server-authoritative)
  timer:            PKTimerState | null
  setTimer:         (t: PKTimerState | null) => void
  remainingSeconds: number
  setRemaining:     (s: number) => void

  // Votes
  voteScoreA:  number
  voteScoreB:  number
  setVotes:    (a: number, b: number) => void

  // Combo
  comboA:      PKComboState | null
  comboB:      PKComboState | null
  setCombo:    (side: PKSide, level: number, mult: number) => void
  clearCombos: () => void

  // Comeback indicator
  comebackSide: PKSide | null
  setComebackSide: (s: PKSide | null) => void

  // Leader
  leadingSide: PKSide | 'DRAW'
  setLeadingSide: (s: PKSide | 'DRAW') => void

  // Gift feed (last 10 gifts in PK)
  giftFeed:    PKGiftFeedItem[]
  addGiftFeed: (g: PKGiftFeedItem) => void

  // Invitation (pending)
  pendingInvitation:    PKInvitation | null
  setPendingInvitation: (inv: PKInvitation | null) => void

  // Matchmaking
  inQueue:      boolean
  queueType:    PKMatchType
  setInQueue:   (v: boolean, type?: PKMatchType) => void

  // Countdown overlay
  countdownSeconds: number | null
  setCountdown:     (s: number | null) => void

  // UI
  showWinnerOverlay:    boolean
  setShowWinnerOverlay: (v: boolean) => void
  showRematchPrompt:    boolean
  setShowRematchPrompt: (v: boolean) => void

  // User stats
  myStats: PKUserStats | null
  setMyStats: (s: PKUserStats | null) => void

  // Leaderboard
  leaderboard: PKLeaderboardEntry[]
  setLeaderboard: (l: PKLeaderboardEntry[]) => void

  // Reset
  reset: () => void
}

const initialState = {
  activeMatch:       null,
  timer:             null,
  remainingSeconds:  0,
  voteScoreA:        0,
  voteScoreB:        0,
  comboA:            null,
  comboB:            null,
  comebackSide:      null,
  leadingSide:       'DRAW' as PKSide | 'DRAW',
  giftFeed:          [],
  pendingInvitation: null,
  inQueue:           false,
  queueType:         'ONE_V_ONE' as PKMatchType,
  countdownSeconds:  null,
  showWinnerOverlay: false,
  showRematchPrompt: false,
  myStats:           null,
  leaderboard:       [],
}

export const usePKStore = create<PKStoreState>((set, get) => ({
  ...initialState,

  setActiveMatch: (m) => set({ activeMatch: m }),

  updateMatchScore: (scoreA, scoreB, giftScoreA, giftScoreB) => {
    const m = get().activeMatch
    if (!m) return
    set({
      activeMatch: {
        ...m,
        scoreA,
        scoreB,
        ...(giftScoreA !== undefined && { giftScoreA }),
        ...(giftScoreB !== undefined && { giftScoreB }),
      },
      leadingSide: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'DRAW',
    })
  },

  setMatchState: (state) => {
    const m = get().activeMatch
    if (!m) return
    set({ activeMatch: { ...m, state } })
  },

  setWinner: (winnerId, winnerSide) => {
    const m = get().activeMatch
    if (!m) return
    set({ activeMatch: { ...m, winnerId, winnerSide, state: 'COMPLETED' } })
  },

  setTimer:    (t) => set({ timer: t, remainingSeconds: t?.remainingSeconds ?? 0 }),
  setRemaining: (s) => set({ remainingSeconds: s }),

  setVotes:    (a, b) => set({ voteScoreA: a, voteScoreB: b }),

  setCombo:    (side, level, mult) => {
    if (side === 'A') set({ comboA: { side, level, multiplier: mult } })
    else              set({ comboB: { side, level, multiplier: mult } })
    // Auto-clear after 3s
    setTimeout(() => {
      if (side === 'A') set(s => s.comboA?.level === level ? { comboA: null } : {})
      else              set(s => s.comboB?.level === level ? { comboB: null } : {})
    }, 3000)
  },
  clearCombos: () => set({ comboA: null, comboB: null }),

  setComebackSide: (s) => {
    set({ comebackSide: s })
    if (s) setTimeout(() => set({ comebackSide: null }), 4000)
  },

  setLeadingSide: (s) => set({ leadingSide: s }),

  addGiftFeed: (g) => {
    set(s => ({ giftFeed: [...s.giftFeed.slice(-9), g] }))
    setTimeout(() => {
      set(s => ({ giftFeed: s.giftFeed.filter(f => f.id !== g.id) }))
    }, 5000)
  },

  setPendingInvitation: (inv) => set({ pendingInvitation: inv }),
  setInQueue:           (v, type) => set({ inQueue: v, ...(type && { queueType: type }) }),
  setCountdown:         (s) => set({ countdownSeconds: s }),
  setShowWinnerOverlay: (v) => set({ showWinnerOverlay: v }),
  setShowRematchPrompt: (v) => set({ showRematchPrompt: v }),
  setMyStats:           (s) => set({ myStats: s }),
  setLeaderboard:       (l) => set({ leaderboard: l }),

  reset: () => set(initialState),
}))
