/**
 * Posts API client — Phase B-1 Social Feed
 * Reuses existing `api` axios instance from lib/api.ts
 */
import api from './api'

export interface PostMedia {
  id: string; url: string; type: string
  mimeType?: string; width?: number; height?: number
  duration?: number; thumbnail?: string; orderIndex: number
}

export interface PostAuthor {
  id: string; firstName: string; lastName: string
  avatarUrl: string | null; role: string; schoolId: string | null
}

export interface PostHashtag {
  hashtag: { id: string; name: string }
}

export interface LiveData {
  title:            string
  description?:     string | null
  coverEmoji?:      string
  coverImageUrl?:   string | null
  participantCount: number
  className?:       string | null
  isLive:           boolean
}

export interface Post {
  id: string
  authorId: string
  author: PostAuthor
  body: string | null
  type: string
  visibility: string
  likeCount: number
  commentCount: number
  shareCount: number
  viewCount: number
  bookmarkCount: number
  isPinned: boolean
  isDraft: boolean
  scheduledAt: string | null
  linkUrl: string | null
  linkTitle: string | null
  linkDescription: string | null
  linkImage: string | null
  pollData: any | null
  refEntityType: string | null
  refEntityId: string | null
  originalPostId: string | null
  originalPost: Post | null
  quotedBody: string | null
  media: PostMedia[]
  hashtags: PostHashtag[]
  reactions: { type: string }[]     // current user's reaction (0 or 1)
  bookmarks: { id: string }[]       // current user's bookmark (0 or 1)
  _count: { reactions: number; comments: number }
  createdAt: string
  updatedAt: string
  location?: string                 // display label for location tag (no GPS required)
  liveData?: LiveData               // present on LIVE_ROOM_SHARE / LIVE_CLASS_SHARE posts
  isFollowing?: boolean             // true if the viewer follows this post's author
}

export interface Comment {
  id: string
  postId: string
  authorId: string
  author: PostAuthor
  parentId: string | null
  body: string
  likeCount: number
  replyCount: number
  reactions: { type: string }[]
  _count: { replies: number; reactions: number }
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface FeedPage {
  items: Post[]
  nextCursor: string | null
  hasMore: boolean
}

export type ReactionType = 'LIKE' | 'LOVE' | 'CELEBRATE' | 'SUPPORT' | 'INSIGHTFUL' | 'FUNNY'

export const postsApi = {
  // Feed
  getFeed:    (cursor?: string, limit = 20, filter: 'all' | 'following' = 'all') =>
    api.get<{ data: FeedPage }>('/posts/feed', { params: { cursor, limit, filter } }),

  // Reels — TikTok-style video-only feed
  getReels:   (cursor?: string, limit = 10) =>
    api.get<{ data: FeedPage }>('/posts/reels', { params: { cursor, limit } }),

  // CRUD
  create: (data: {
    body?: string; type?: string; visibility?: string
    media?: Partial<PostMedia>[]; isDraft?: boolean; scheduledAt?: string
    pollData?: any; linkUrl?: string; linkTitle?: string
    linkDescription?: string; linkImage?: string
    originalPostId?: string; quotedBody?: string
    refEntityType?: string; refEntityId?: string
  }) => api.post<{ data: Post }>('/posts', data),

  getOne:  (id: string)           => api.get<{ data: Post }>(`/posts/${id}`),
  update:  (id: string, data: any) => api.patch<{ data: Post }>(`/posts/${id}`, data),
  remove:  (id: string)           => api.delete(`/posts/${id}`),
  recordView: (id: string)        => api.post(`/posts/${id}/view`),
  recordShare: (id: string)       => api.post(`/posts/${id}/share`),

  // User posts / profile tabs
  getUserPosts: (userId: string, tab = 'posts', cursor?: string, limit = 20) =>
    api.get<{ data: FeedPage }>(`/posts/user/${userId}`, { params: { tab, cursor, limit } }),

  // Reactions
  react:        (id: string, type: ReactionType) => api.post(`/posts/${id}/react`, { type }),
  getReactions: (id: string)                     => api.get(`/posts/${id}/reactions`),

  // Comments
  getComments: (id: string, cursor?: string, parentId?: string) =>
    api.get<{ data: { items: Comment[]; nextCursor: string | null; hasMore: boolean } }>(
      `/posts/${id}/comments`, { params: { cursor, parentId } }
    ),
  addComment:    (id: string, body: string, parentId?: string) =>
    api.post<{ data: Comment }>(`/posts/${id}/comments`, { body, parentId }),
  editComment:   (id: string, commentId: string, body: string) =>
    api.patch(`/posts/${id}/comments/${commentId}`, { body }),
  deleteComment: (id: string, commentId: string) =>
    api.delete(`/posts/${id}/comments/${commentId}`),
  reactComment:  (id: string, commentId: string, type: ReactionType) =>
    api.post(`/posts/${id}/comments/${commentId}/react`, { type }),

  // Bookmark & pin
  bookmark: (id: string) => api.post(`/posts/${id}/bookmark`),
  pin:      (id: string) => api.post(`/posts/${id}/pin`),
  report:   (id: string, reason: string, description?: string) =>
    api.post(`/posts/${id}/report`, { reason, description }),

  // Discovery
  search:   (q: string, cursor?: string) =>
    api.get<{ data: FeedPage }>('/posts/search', { params: { q, cursor } }),
  trending: () => api.get<{ data: { id: string; name: string; postCount: number }[] }>('/posts/trending'),

  // Live sessions (voice rooms + live classes currently LIVE)
  getLiveSessions: () => api.get<{ data: Post[] }>('/posts/live'),

  // Poll voting
  votePoll: (id: string, optionId: string) =>
    api.post(`/posts/${id}/poll/vote`, { optionId }),

  // Link preview scrape
  getLinkPreview: (url: string) =>
    api.get<{ data: { url: string; title: string | null; description: string | null; image: string | null } }>(
      '/posts/link-preview', { params: { url } }
    ),
}
