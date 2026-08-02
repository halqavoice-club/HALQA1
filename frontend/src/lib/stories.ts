/**
 * Stories API client — Phase B-3
 */
import api from './api'

export interface StoryAuthor {
  id: string; firstName: string; lastName: string; avatarUrl: string | null
}

export interface Story {
  id: string
  authorId: string
  author: StoryAuthor
  type: 'IMAGE' | 'VIDEO' | 'TEXT'
  mediaUrl: string | null
  mimeType: string | null
  thumbnail: string | null
  text: string | null
  textColor: string | null
  bgColor: string | null
  bgGradient: string | null
  caption: string | null
  duration: number
  expiresAt: string
  viewCount: number
  reactionCount: number
  seen: boolean
  createdAt: string
  _count?: { views: number; reactions: number }
}

export interface StoryGroup {
  author: StoryAuthor
  isOwn: boolean
  hasUnseen: boolean
  stories: Story[]
}

export const storiesApi = {
  getFeed:      ()                          => api.get<{ data: StoryGroup[] }>('/stories/feed'),
  getUserStories: (userId: string)          => api.get<{ data: Story[] }>(`/stories/user/${userId}`),

  create: (data: {
    type: 'IMAGE' | 'VIDEO' | 'TEXT'
    mediaUrl?: string; mimeType?: string; thumbnail?: string
    text?: string; textColor?: string; bgColor?: string; bgGradient?: string
    caption?: string; duration?: number
  }) => api.post<{ data: Story }>('/stories', data),

  view:       (id: string)              => api.post(`/stories/${id}/view`),
  react:      (id: string, type: string) => api.post(`/stories/${id}/react`, { type }),
  getViewers: (id: string)              => api.get(`/stories/${id}/viewers`),
  remove:     (id: string)              => api.delete(`/stories/${id}`),
}
