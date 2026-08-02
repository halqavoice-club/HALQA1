/**
 * Creator Economy API client — Phase B-6
 */
import api from './api'

export interface CreatorTier {
  id: string; name: string; description: string | null
  priceCoins: number; perks: string[] | null; sortOrder: number; isActive: boolean
}

export interface CreatorProfile {
  id: string; userId: string; displayName: string | null; tagline: string | null
  isActive: boolean; isVerified: boolean
  totalEarned: number; subscriberCount: number; tipCount: number
  links: Record<string, string> | null; createdAt: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null; bio?: string | null }
  tiers?: CreatorTier[]
  isSubscribed?: boolean
  mySubscription?: CreatorSubscription | null
}

export interface CreatorSubscription {
  id: string; subscriberId: string; creatorId: string; tierId: string
  status: string; startedAt: string; expiresAt: string
  coinsCharged: number
  tier?: CreatorTier
  creator?: CreatorProfile
  subscriber?: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

export interface CreatorTip {
  id: string; senderId: string; amount: number; diamondsEarned: number
  message: string | null; postId: string | null; createdAt: string
  sender?: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

export const creatorApi = {
  // Become a creator
  become: (data?: { displayName?: string; tagline?: string; links?: Record<string, string> }) =>
    api.post<{ data: CreatorProfile }>('/creators/me/become', data || {}),

  updateProfile: (data: { displayName?: string; tagline?: string; links?: Record<string, string> }) =>
    api.patch<{ data: CreatorProfile }>('/creators/me', data),

  getDashboard: () => api.get<{ data: {
    profile: CreatorProfile
    wallet: { coins: number; diamonds: number }
    stats: { activeSubs: number; tipsLast30d: number; tipsTotal30d: number; totalEarned: number; totalTips: number; subscriberCount: number }
    recentTips: CreatorTip[]
    recentSubs: CreatorSubscription[]
  } }>('/creators/me/dashboard'),

  // Tiers
  createTier: (data: { name: string; description?: string; priceCoins: number; perks?: string[] }) =>
    api.post<{ data: CreatorTier }>('/creators/me/tiers', data),

  updateTier: (tierId: string, data: Partial<CreatorTier>) =>
    api.patch<{ data: CreatorTier }>(`/creators/me/tiers/${tierId}`, data),

  // Public profile
  getProfile: (userId: string) =>
    api.get<{ data: CreatorProfile }>(`/creators/${userId}`),

  // Subscribe / unsubscribe
  subscribe:   (userId: string, tierId: string) =>
    api.post(`/creators/${userId}/subscribe`, { tierId }),
  unsubscribe: (userId: string) =>
    api.post(`/creators/${userId}/unsubscribe`),

  // Tips
  sendTip: (userId: string, amount: number, message?: string, postId?: string) =>
    api.post(`/creators/${userId}/tip`, { amount, message, postId }),

  // My subscriptions
  mySubscriptions: () =>
    api.get<{ data: CreatorSubscription[] }>('/creators/my/subscriptions'),
}
