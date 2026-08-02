# Implementation Plan: Social Platform UX Upgrade

## Overview

Incremental implementation of the three social surfaces — Feed, Communities, and Group Chat — in the existing Next.js 14 / React / TypeScript / TailwindCSS stack. All changes are frontend-only. Tasks are ordered so each step builds on the previous, with shared utilities and types established first, followed by individual surface components, and finally wiring everything together.

---

## Tasks

- [x] 1. Establish shared types, utilities, and helper functions
  - [x] 1.1 Extend `Post` and `GcMessage` TypeScript interfaces with new fields
    - Add `location?: string` to `Post`
    - Add `readBy: string[]`, `isPinned?: boolean`, and `forwardedFrom?: string` to `GcMessage`
    - Export updated types from `types/index.ts` (or the project's central types file)
    - _Requirements: 1.1, 8.1, 8.6–8.8_

  - [x] 1.2 Implement `resolveMediaLayout()` pure helper function
    - Implement the four layout branches: single, sideBySide, leftPlusStack, mosaic
    - Export from `lib/mediaUtils.ts`
    - _Requirements: 1.10–1.13_

  - [ ]* 1.3 Write property test for `resolveMediaLayout()`
    - **Property 2: Media grid layout is always valid**
    - For any `media` array of length 1–10, `resolveMediaLayout(media).type` is always one of the four valid layout types
    - **Validates: Requirements 1.10–1.13**

  - [x] 1.4 Implement `resolveReadReceipt()` pure helper function
    - Return `'sent'`, `'delivered'`, or `'read'` based on `msg.readBy` vs `conversationMemberIds`
    - Export from `lib/chatUtils.ts`
    - _Requirements: 8.6–8.9_

  - [ ]* 1.5 Write property test for `resolveReadReceipt()`
    - **Property 10: Read receipt is accurate for own messages**
    - `resolveReadReceipt` returns `'read'` iff every member id (excluding sender) is in `msg.readBy`
    - **Validates: Requirements 8.6–8.9**

  - [x] 1.6 Implement `buildMessageClusters()` pure helper function
    - Group consecutive messages by sender within a 5-minute window
    - Export from `lib/chatUtils.ts`
    - _Requirements: 8.2_

  - [ ]* 1.7 Write property test for `buildMessageClusters()`
    - **Property 9: Message cluster count matches message count**
    - For any `messages` array, `buildMessageClusters(messages).length === messages.length`
    - **Validates: Requirements 8.2**

  - [x] 1.8 Implement `filterMentionCandidates()` pure helper function
    - Return at most 5 users whose `firstName + lastName` contains the query (case-insensitive)
    - Export from `lib/mentionUtils.ts`
    - _Requirements: 4.3–4.6_

  - [x] 1.9 Implement `buildShareUrl()` and `renderBodyText()` pure helper functions
    - `buildShareUrl(postId)` → `${window.location.origin}/feed/post/${postId}`
    - `renderBodyText(body, expanded)` → truncate at 3 lines when not expanded
    - Export from `lib/postUtils.ts`
    - _Requirements: 1.2, 3.3_

- [x] 2. Checkpoint — Ensure all utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Build Feed Surface — core PostCard v2 and media components
  - [x] 3.1 Create `MediaGrid` component
    - Implement all four layout branches using `resolveMediaLayout()`
    - `+N` overflow overlay on last mosaic cell
    - `loading="lazy"` on all `<img>` tags
    - Wire `onClick` to `onOpen(index)` callback
    - _Requirements: 1.10–1.14_

  - [x] 3.2 Create `LinkPreviewCard` component
    - Render `post.linkUrl`, `post.linkTitle`, `post.linkDescription`, `post.linkImage`
    - Render only when `post.linkUrl` and `post.linkTitle` are both set
    - _Requirements: 1.15_

  - [x] 3.3 Create `ReactionPicker` component
    - Render emoji options in a portal attached to `document.body`
    - Animate open after 300 ms hover on Like button
    - Call `postsApi.react(postId, type)` on emoji click; close picker
    - Optimistic update on button; roll back on failure with toast
    - Toggle off active reaction when same emoji is clicked again
    - _Requirements: 2.1–2.6_

  - [ ]* 3.4 Write property test for feed deduplication
    - **Property 4: Feed deduplication is guaranteed**
    - For any list of incoming posts merged with cached posts, no `post.id` appears more than once
    - **Validates: Requirements 5.6**

  - [x] 3.5 Create `CommentsSection` inline component
    - Lazy-fetch comments only on first `open === true` using `postsApi.getComments(postId)`
    - Optimistic prepend on Enter submit; `postsApi.addComment` call
    - Shift+Enter inserts newline instead of submitting
    - _Requirements: 1.5–1.9_

  - [x] 3.6 Create `ShareMenu` dropdown component
    - Three actions: "Share to feed" (repost), "Copy link", "Share to group"
    - Auto-close after any action; toast on repost failure
    - `buildShareUrl` for copy link; success toast on copy
    - _Requirements: 3.1–3.6_

  - [x] 3.7 Assemble `PostCard v2` component
    - Author header: avatar, full name, relative timestamp, visibility icon
    - Pinned indicator and ring border when `isPinned === true`
    - REPOST banner above header for `type === 'REPOST'`
    - Inset quoted block for `type === 'QUOTE'`
    - Body text with `renderBodyText()`, "See more" toggle at 3 lines
    - Inline `@mention` (indigo) and `#hashtag` → `/explore/hashtag/{token}` link rendering
    - `MediaGrid`, `LinkPreviewCard`, action bar (ReactionPicker, Comment toggle, ShareMenu, Bookmark)
    - `CommentsSection` below action bar (collapsed by default)
    - _Requirements: 1.1–1.18_

  - [ ]* 3.8 Write property test for hashtag link rendering
    - **Property 3: Hashtag links are rendered for all hashtag tokens**
    - If `post.body` contains any `#token`, at least one `<Link>` pointing to `/explore/hashtag/...` is rendered
    - **Validates: Requirements 1.3**

- [x] 4. Build Feed Surface — PostComposer v2 and real-time updates
  - [x] 4.1 Upgrade `PostComposer` to v2
    - Emoji picker popover (Tailwind emoji grid, no new dependency) triggered by 😊 button
    - Insert emoji at cursor position in textarea
    - `@mention` dropdown: query `filterMentionCandidates()` on `@` trigger; replace `@query` token on selection
    - Location button: text-label input, no GPS
    - 5000-character max enforcement
    - Up to 10 media items upload; toast "Upload failed" on upload error
    - Optimistic prepend to feed cache on success; preserve body text on failure with toast
    - _Requirements: 4.1–4.12_

  - [x] 4.2 Add real-time feed update handling in `FeedPage`
    - Socket.IO `post:create` listener: show "N new posts — tap to refresh" banner for other users' posts; skip banner for own posts
    - Banner tap: scroll to top, prepend posts, clear banner
    - `post:delete` listener: remove post from list immediately
    - `post:update` listener: update post data in list
    - Deduplicate merged post list by `post.id` using `filterMentionCandidates`-style logic
    - `fetchNextPage` trigger on scroll-to-bottom sentinel; "You're all caught up ✓" when `!hasNextPage && allPosts.length > 0`
    - Feed API failure: inline error state with retry button
    - _Requirements: 5.1–5.8, 11.1_

  - [ ]* 4.3 Write property test for "all caught up" condition
    - **Property 5: "All caught up" state condition is exact**
    - Message renders if and only if `!hasNextPage && allPosts.length > 0`
    - **Validates: Requirements 5.8**

- [x] 5. Checkpoint — Ensure all Feed Surface tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build Communities Surface — CommunityDetailPage v2
  - [x] 6.1 Redesign `CommunityDetailPage` to v2 shell and header
    - Cover photo full-bleed with overlay gradient
    - Avatar badge overlapping cover bottom-left corner
    - Name, member count, privacy badge, join/leave button in header row
    - Hide join/leave button when `community.privacy === 'INVITE_ONLY'` and user is not owner
    - Toast + re-enable button on join/leave failure
    - _Requirements: 6.1–6.3, 11.4_

  - [ ]* 6.2 Write property test for join button visibility
    - **Property 6: Join button is hidden for invite-only communities**
    - For any community where `privacy === 'INVITE_ONLY'`, join/leave button is never rendered
    - **Validates: Requirements 6.3**

  - [x] 6.3 Implement the four-tab bar (Feed, Members, About, Media)
    - Feed tab: render community posts with `PostCard_v2` and `PostComposer_v2` for members
    - Members tab: searchable list (case-insensitive filter on full name) with role badges (Admin, Moderator, Member)
    - About tab: description, rules, creation date, creator profile link
    - Media tab: photo/video grid filtered to `IMAGE` or `VIDEO` type items only
    - _Requirements: 6.2, 6.4–6.10_

  - [ ]* 6.4 Write property test for member search completeness
    - **Property 8: Members tab search is case-insensitive and complete**
    - Every member whose lowercased full name contains the lowercased query is included; none are omitted
    - **Validates: Requirements 6.6, 6.10**

- [x] 7. Build Communities Surface — AdminPanel
  - [x] 7.1 Create `AdminPanel` slide-in drawer component
    - Render trigger button only when `myRole === 'OWNER' || myRole === 'ADMIN'`
    - Fetch pending join requests via `communitiesApi.getPendingRequests(slug)` on open (and on reopen)
    - Accept: call accept API, invalidate `['community-pending', slug]` query
    - Decline: call decline API, remove request from visible list
    - Remove member: confirmation prompt before calling `communitiesApi.kickMember`; toast "Failed to remove member" on failure
    - Hide "Remove" button for `OWNER` role members and for the current user's own entry
    - Show empty list silently when pending requests fail to load
    - _Requirements: 7.1–7.10, 11.8_

  - [ ]* 7.2 Write property test for AdminPanel role gating
    - **Property 7: Admin Panel is gated to admins and owners**
    - For any community where `myRole !== 'OWNER' && myRole !== 'ADMIN'`, the trigger button is absent from the DOM
    - **Validates: Requirements 7.1–7.2**

- [x] 8. Checkpoint — Ensure all Communities Surface tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Build Group Chat Surface — MessageBubble v2 and ContextMenu
  - [x] 9.1 Create `ContextMenu` component
    - Render near pointer on long-press (≥500 ms) or right-click
    - Always include Reply, React, Copy actions
    - Include Delete and Forward only when `isMe === true`
    - Close on outside click/tap
    - Only one instance visible at a time (singleton via shared state)
    - _Requirements: 9.1–9.10_

  - [ ]* 9.2 Write property test for ContextMenu singleton constraint
    - **Property 11: Context menu is a singleton**
    - At most one `ContextMenu` is non-null in `contextMenu` state across the entire chat window
    - **Validates: Requirements 9.9**

  - [x] 9.3 Create `MessageBubble v2` component
    - Own messages: indigo background, right-aligned; others: white background, left-aligned
    - Use `buildMessageClusters()` to show avatar only on first bubble of each cluster
    - `ReplyQuote` block above bubble body when `msg.replyTo` is set
    - Reaction pills row below bubble, grouped by emoji with count; highlight own reaction in indigo
    - Read receipt ticks from `resolveReadReceipt()` on own-message bubbles only
    - Wire long-press / right-click to `ContextMenu`
    - _Requirements: 8.1–8.9_

  - [x] 9.4 Implement `PinnedMessage` banner component
    - Render at the top of the chat window when any message has `isPinned === true`
    - _Requirements: 8.10_

- [x] 10. Build Group Chat Surface — real-time features and TypingIndicator
  - [x] 10.1 Create `TypingIndicator` component and wire typing events
    - Display animated dots and first name(s) of typing members (excluding self)
    - Emit `group:typing_start` at most once per 2.5-second window
    - Emit `group:typing_stop` after 2.5 seconds of inactivity
    - _Requirements: 10.1–10.5_

  - [ ]* 10.2 Write property test for typing indicator self-exclusion
    - **Property 13: Typing indicators exclude self**
    - Typing indicator names are derived only from members whose `userId !== currentUser.id`
    - **Validates: Requirements 10.2–10.3**

  - [x] 10.3 Implement reply-to flow in `GroupChatPage`
    - ContextMenu "Reply" sets `replyTo`; shows `QuoteBar` above message input
    - On send with `replyTo` set, call `groupChatApi.send` with `replyToId`
    - Clear `replyTo` to `null` after successful send
    - Restore typed message and toast "Failed to send" on failure
    - _Requirements: 9.5, 10.6–10.7, 11.5_

  - [ ]* 10.4 Write property test for reply-to state clearing
    - **Property 12: Reply-to state is cleared after send**
    - After a successful message send, `replyTo` is always `null` regardless of message content
    - **Validates: Requirements 10.7**

  - [x] 10.5 Implement message loading, read receipts, and unread badges in `GroupChatPage`
    - On conversation load: call `groupChatApi.markRead` with last 20 message IDs
    - On `group:message` event for active conversation: scroll to bottom, call `groupChatApi.markRead`
    - On `group:message` event for non-active conversation: increment unread badge
    - On conversation switch: reset unread count to zero
    - "Load more" button at top: call `groupChatApi.messages` with oldest `createdAt` as before-cursor
    - Toast "Failed to load history" on load more failure; keep button enabled
    - Toast "Failed to leave group" on leave failure
    - Silently ignore reaction failures
    - _Requirements: 10.8–10.13, 11.6–11.7_

  - [x] 10.6 Wire ContextMenu actions (Copy, Forward, Delete) in `GroupChatPage`
    - Copy: `navigator.clipboard.writeText(msg.body)`
    - Forward: open group-picker, call send API with `forwardedFrom`
    - Delete: call delete API, remove message from local list
    - _Requirements: 9.6–9.8_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration and wiring
  - [x] 12.1 Wire all three surfaces into their respective page files
    - Replace old `PostCard` with `PostCard_v2` in `FeedPage`
    - Replace old `CommentsModal` references with `CommentsSection` inside `PostCard_v2`
    - Replace old `PostComposer` with `PostComposer_v2` in `FeedPage` and `CommunityDetailPage`
    - Replace old `CommunityDetailPage` with `CommunityDetailPage_v2`
    - Replace old group chat page with `GroupChatPage v2`
    - _Requirements: 1.1–11.8_

  - [ ]* 12.2 Write integration tests for feed Socket.IO events
    - Mock socket, emit `post:create` from another user → verify "N new posts" banner appears
    - Emit own `post:create` → verify no banner
    - Emit `post:delete` → verify post removed from list
    - _Requirements: 5.1–5.4_

  - [ ]* 12.3 Write integration tests for Group Chat send + reply flow
    - Submit message with `replyTo` set → verify `groupChatApi.send` called with `replyToId`
    - Verify `replyTo` is `null` after successful send
    - _Requirements: 10.6–10.7_

  - [ ]* 12.4 Write integration tests for Community join/leave and AdminPanel flows
    - Mock join API failure → verify toast and button re-enabled
    - Mock `kickMember` failure → verify toast "Failed to remove member" and list unchanged
    - _Requirements: 7.5–7.7, 11.4_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The design uses TypeScript throughout; all code examples should follow the TypeScript interfaces in `design.md`
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each surface boundary
- Property tests use **fast-check** (already listed as the PBT library in the design)
- No new npm dependencies are required — all libraries listed in `design.md` are already installed
- The three surfaces (Feed, Communities, Group Chat) are independent and can be developed in parallel once Task 1 (shared utilities) is complete

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6", "1.8", "1.9"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3", "3.5", "3.6", "6.1", "9.1"] },
    { "id": 4, "tasks": ["3.4", "3.7", "3.8", "6.2", "6.3", "9.2", "9.3", "9.4"] },
    { "id": 5, "tasks": ["4.1", "6.4", "7.1", "10.1", "10.3"] },
    { "id": 6, "tasks": ["4.2", "7.2", "10.2", "10.4", "10.5"] },
    { "id": 7, "tasks": ["4.3", "10.6"] },
    { "id": 8, "tasks": ["12.1"] },
    { "id": 9, "tasks": ["12.2", "12.3", "12.4"] }
  ]
}
```
