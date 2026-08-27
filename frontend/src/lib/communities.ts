/**
 * Communities API client — Phase B-4 + Invite System
 */
import api from './api'

export interface CommunityOwner {
  id: string; firstName: string; lastName: string; avatarUrl: string | null
}

export interface Community {
  id: string
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  coverUrl: string | null
  privacy: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY'
  memberCount: number
  postCount: number
  isVerified: boolean
  category: string | null
  rules: string | null
  createdAt: string
  owner: CommunityOwner
  myRole?: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | null
  _count?: { members: number; posts: number }
}

export interface CommunityMember {
  id: string
  role: string
  joinedAt: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }
}

export interface CommunityInvite {
  id: string
  invitedUser: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  invitedBy: { id: string; firstName: string; lastName: string }
  status: string
  expiresAt: string
  createdAt: string
}

export const COMMUNITY_CATEGORIES = [
  { value: 'education',   label: '📚 Education'   },
  { value: 'religion',    label: '🕌 Religion'    },
  { value: 'technology',  label: '💻 Technology'  },
  { value: 'sports',      label: '⚽ Sports'      },
  { value: 'arts',        label: '🎨 Arts'        },
  { value: 'other',       label: '💬 Other'       },
]

export const communitiesApi = {
  list:   (q?: string, category?: string, page = 1, limit = 20) =>
    api.get<{ data: { items: Community[]; pagination: any } }>('/communities', { params: { q, category, page, limit } }),

  mine:   () => api.get<{ data: { items: Community[]; nextCursor: string | null; hasMore: boolean } }>('/communities/mine'),

  get:    (idOrSlug: string) =>
    api.get<{ data: Community }>(`/communities/${idOrSlug}`),

  create: (data: {
    name: string; description?: string; privacy?: string
    category?: string; rules?: string; avatarUrl?: string; coverUrl?: string
  }) => api.post<{ data: Community }>('/communities', data),

  update: (idOrSlug: string, data: Partial<Community>) =>
    api.patch<{ data: Community }>(`/communities/${idOrSlug}`, data),

  remove: (idOrSlug: string) => api.delete(`/communities/${idOrSlug}`),

  join:   (idOrSlug: string) => api.post(`/communities/${idOrSlug}/join`),
  leave:  (idOrSlug: string) => api.post(`/communities/${idOrSlug}/leave`),

  getMembers: (idOrSlug: string, page = 1) =>
    api.get<{ data: { items: CommunityMember[]; pagination: any } }>(`/communities/${idOrSlug}/members`, { params: { page } }),

  updateMemberRole: (idOrSlug: string, userId: string, role: string) =>
    api.patch(`/communities/${idOrSlug}/members/${userId}/role`, { role }),

  kickMember: (idOrSlug: string, userId: string) =>
    api.delete(`/communities/${idOrSlug}/members/${userId}`),

  banMember: (idOrSlug: string, userId: string, reason?: string) =>
    api.post(`/communities/${idOrSlug}/members/${userId}/ban`, { reason }),

  unbanMember: (idOrSlug: string, userId: string) =>
    api.delete(`/communities/${idOrSlug}/members/${userId}/ban`),

  getFeed: (idOrSlug: string, cursor?: string, limit = 20) =>
    api.get(`/communities/${idOrSlug}/feed`, { params: { cursor, limit } }),

  getMedia: (idOrSlug: string, cursor?: string, limit = 20) =>
    api.get(`/communities/${idOrSlug}/media`, { params: { cursor, limit } }),

  getPendingRequests: (idOrSlug: string) =>
    api.get<{ data: { items: any[]; pagination: any } }>(`/communities/${idOrSlug}/join-requests`),

  acceptRequest: (idOrSlug: string, userId: string) =>
    api.post(`/communities/${idOrSlug}/join-requests/${userId}/accept`),

  declineRequest: (idOrSlug: string, userId: string) =>
    api.post(`/communities/${idOrSlug}/join-requests/${userId}/decline`),

  // ── Invite system ───────────────────────────────────────────────────────────
  /** OWNER/ADMIN: invite a user by their userId */
  sendInvite: (idOrSlug: string, userId: string) =>
    api.post<{ data: any }>(`/communities/${idOrSlug}/invites`, { userId }),

  /** OWNER/ADMIN: list pending invites (no token exposed) */
  listInvites: (idOrSlug: string, page = 1) =>
    api.get<{ data: { items: CommunityInvite[]; pagination: any } }>(`/communities/${idOrSlug}/invites`, { params: { page } }),

  /** OWNER/ADMIN: revoke a pending invite by its id */
  revokeInvite: (idOrSlug: string, inviteId: string) =>
    api.delete(`/communities/${idOrSlug}/invites/${inviteId}`),

  /** Invitee: accept invite via token */
  acceptInvite: (token: string) =>
    api.post<{ data: { role: string; communitySlug: string } }>(`/communities/invites/${token}/accept`),

  /** Invitee: decline invite via token */
  declineInvite: (token: string) =>
    api.post(`/communities/invites/${token}/decline`),
}
