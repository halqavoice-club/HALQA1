/**
 * Explore API client — Phase B-5: Global Discovery
 */
import api from './api'
import type { Post } from './posts'
import type { Community } from './communities'

export interface ExploreUser {
  id: string; firstName: string; lastName: string
  avatarUrl: string | null; role: string; schoolId: string | null
  bio?: string | null; isFollowing?: boolean
  _count?: { followers: number }
}

export interface LiveVoiceRoom {
  id: string; title: string; coverEmoji: string | null
  privacy: string; status: string
  description?: string | null
  coverImageUrl?: string | null
  startedAt?: string | null
  createdAt?: string
  updatedAt?: string
  host: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  _count: { participants: number }
}

export interface ExploreLiveClass {
  id: string; title: string; description?: string | null
  coverImageUrl?: string | null
  startedAt?: string | null; createdAt?: string; updatedAt?: string
  teacher?: { user: { id: string; firstName: string; lastName: string; avatarUrl: string | null } } | null
  class?: { id: string; name: string } | null
  _count?: { participants: number }
}

export interface ExploreFeed {
  trendingPosts:        Post[]
  trendingHashtags:     { id: string; name: string; postCount: number }[]
  suggestedCommunities: (Community & { myRole?: string | null })[]
  liveVoiceRooms:       LiveVoiceRoom[]
  liveLiveClasses:      ExploreLiveClass[]
  suggestedPeople:      ExploreUser[]
}

export interface SearchResults {
  posts:       Post[]
  people:      ExploreUser[]
  communities: (Community & { myRole?: string | null })[]
  hashtags:    { id: string; name: string; postCount: number }[]
}

export type SearchType = 'all' | 'posts' | 'people' | 'communities' | 'hashtags'

export const exploreApi = {
  getFeed: () =>
    api.get<{ data: ExploreFeed }>('/explore'),

  search: (q: string, type: SearchType = 'all', limit = 20) =>
    api.get<{ data: SearchResults }>('/explore/search', { params: { q, type, limit } }),

  getHashtagFeed: (tag: string, cursor?: string, limit = 20) =>
    api.get<{ data: { hashtag: { id: string; name: string; postCount: number } | null; items: Post[]; nextCursor: string | null; hasMore: boolean } }>(
      `/explore/hashtag/${encodeURIComponent(tag)}`, { params: { cursor, limit } }
    ),
}
