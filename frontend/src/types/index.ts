/**
 * Central types barrel — re-exports all shared TypeScript interfaces
 * so that components can import from a single canonical location:
 *   import type { Post, GcMessage } from '@/types'
 */

// Feed / Posts surface
export type {
  Post,
  PostMedia,
  PostAuthor,
  PostHashtag,
  Comment,
  FeedPage,
  ReactionType,
} from '@/lib/posts'

// Group Chat surface
export type {
  GcMessage,
  GcUser,
  GcReaction,
  GcReplyTo,
  GcMember,
  GcConversation,
} from '@/store/groupChat.store'
