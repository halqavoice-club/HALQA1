/**
 * Feed store — Phase B-1
 * Manages real-time feed updates from Socket.IO (post:create/update/delete/like)
 */
import { create } from 'zustand'
import type { Post } from '@/lib/posts'

interface FeedState {
  // Live posts injected by socket (prepended to feed)
  incomingPosts: Post[]
  addIncoming:   (post: Post) => void
  clearIncoming: () => void
  removePost:    (postId: string) => void
  updatePost:    (post: Post) => void
}

export const useFeedStore = create<FeedState>((set) => ({
  incomingPosts: [],

  addIncoming: (post) =>
    set((s) => ({
      incomingPosts: [post, ...s.incomingPosts.filter(p => p.id !== post.id)]
    })),

  clearIncoming: () => set({ incomingPosts: [] }),

  removePost: (postId) =>
    set((s) => ({ incomingPosts: s.incomingPosts.filter(p => p.id !== postId) })),

  updatePost: (post) =>
    set((s) => ({
      incomingPosts: s.incomingPosts.map(p => p.id === post.id ? post : p)
    })),
}))
