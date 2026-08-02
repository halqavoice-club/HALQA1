import { create } from 'zustand'

export interface SocialUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: string
  schoolId: string | null
  bio?: string | null
  // enrichment fields (optional — only present in certain API responses)
  isFollowing?: boolean
  iFollowThem?: boolean
  followedAt?: string
  friendStatus?: 'none' | 'pending_sent' | 'pending_received' | 'friends'
}

export interface FriendRequest {
  requestId: string
  user: SocialUser
  sentAt: string
}

interface SocialState {
  // Pending incoming requests badge count
  pendingCount: number
  setPendingCount: (n: number) => void
  incrementPending: () => void
  decrementPending: () => void
}

export const useSocialStore = create<SocialState>((set) => ({
  pendingCount: 0,
  setPendingCount: (n) => set({ pendingCount: n }),
  incrementPending: () => set(s => ({ pendingCount: s.pendingCount + 1 })),
  decrementPending: () => set(s => ({ pendingCount: Math.max(0, s.pendingCount - 1 ) })),
}))
