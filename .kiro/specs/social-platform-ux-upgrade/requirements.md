# Requirements Document

## Introduction

The Social Platform UX Upgrade redesigns the three social surfaces of the HALQA platform — Feed, Communities, and Group Chat — to match the interaction standards of established social platforms. The Feed surface adopts a Facebook News Feed style with inline comments, animated reaction pickers, media mosaics, link previews, and an upgraded composer with emoji and @mention support. The Communities surface adopts a Facebook Groups style with a four-tab detail page and an admin control panel. The Group Chat surface adopts a Telegram-style interface with message bubbles, context menus, read receipts, reply-to threads, reaction pills, message clusters, and typing indicators.

All changes are frontend-only. No new backend routes are introduced. The existing Next.js 14 / React / TypeScript / TailwindCSS stack and existing APIs are used throughout.

---

## Glossary

- **Feed_Surface**: The `/feed` page and all components composing the social news feed.
- **PostCard**: The card component that renders a single feed post and its inline interactions.
- **PostCard_v2**: The redesigned version of PostCard that replaces the modal-based comment flow with an inline comment section.
- **PostComposer_v2**: The upgraded post creation form that adds an emoji picker, @mention dropdown, and location tag.
- **CommentsSection**: The new inline expandable comment thread rendered below a PostCard, replacing the CommentsModal.
- **MediaGrid**: The component that renders post media attachments in a layout determined by attachment count (1, 2, 3, or 4+).
- **ReactionPicker**: The animated emoji-picker popover for reacting to posts, triggered by hovering the Like button.
- **ShareMenu**: The dropdown offering share actions — repost to feed, copy link, share to group.
- **Communities_Surface**: The `/communities` and `/communities/[slug]` pages.
- **CommunityDetailPage_v2**: The redesigned community detail page with four tabs: Feed, Members, About, Media.
- **AdminPanel**: The slide-in drawer for community owners and admins, exposing pending requests and member management.
- **GroupChat_Surface**: The `/group-chat` page.
- **MessageBubble_v2**: The redesigned chat bubble with context menu, read receipts, reply-to context, and reaction pills.
- **ContextMenu**: The long-press / right-click context menu that appears over a MessageBubble.
- **TypingIndicator**: The animated dots shown when other group members are typing.
- **MessageCluster**: A consecutive sequence of messages from the same sender within a 5-minute window; the sender avatar is shown only on the first bubble of the cluster.
- **ReplyQuote**: The quoted snippet rendered above a bubble body when a message was sent as a reply.
- **ReadReceipt**: The tick icon shown on sent messages indicating delivery and read status.
- **PinnedMessage**: A banner shown at the top of the chat window when a message is pinned in the group.
- **postsApi**: The existing frontend API client in `lib/posts.ts` used for all post operations.
- **communitiesApi**: The existing frontend API client in `lib/communities.ts` used for all community operations.
- **groupChatApi**: The existing frontend API client in `lib/groupChat.ts` used for all group chat operations.
- **TanStack_Query**: The server-state management library (TanStack Query v5) used for data fetching and caching.
- **Zustand_Store**: Client-side state stores (`useFeedStore`, `useGroupChatStore`) used for real-time updates.

---

## Requirements

### Requirement 1: Feed Surface — PostCard v2 with Inline Comments

**User Story:** As a student or teacher, I want each post in my feed to show reactions, comments, and sharing options directly on the card without opening a modal, so that I can interact with content without losing my place in the feed.

#### Acceptance Criteria

1. THE PostCard_v2 SHALL render an author header containing the author avatar, full name, relative timestamp, and visibility icon for every post.
2. WHEN a post body exceeds 3 lines, THE PostCard_v2 SHALL display only the first 3 lines with a "See more" toggle that expands the full body when clicked.
3. WHEN a post body contains tokens beginning with `#`, THE PostCard_v2 SHALL render each such token as a clickable link navigating to `/explore/hashtag/{token}`.
4. WHEN a post body contains tokens beginning with `@`, THE PostCard_v2 SHALL render each such token with a distinct visual style (indigo colour).
5. WHEN the Comment button is clicked, THE PostCard_v2 SHALL expand the CommentsSection inline below the action bar without opening a modal.
6. WHEN the CommentsSection is opened for the first time for a given post, THE CommentsSection SHALL fetch comments from `postsApi.getComments(postId)` exactly once per page load.
7. WHEN a user submits a comment by pressing Enter (without Shift), THE CommentsSection SHALL call `postsApi.addComment` and optimistically prepend the new comment to the list.
8. WHEN the user presses Shift+Enter in the comment input, THE CommentsSection SHALL insert a newline instead of submitting.
9. WHILE the CommentsSection is closed, THE PostCard_v2 SHALL NOT fetch comment data for that post.
10. THE MediaGrid SHALL render 1-item media as a single full-width cell with a 16:9 aspect ratio.
11. THE MediaGrid SHALL render 2-item media as two equal 50/50 side-by-side cells with a 1:1 aspect ratio.
12. THE MediaGrid SHALL render 3-item media as a left column spanning full height and a right column with 2 stacked cells.
13. WHEN a post has 4 or more media items, THE MediaGrid SHALL render a 2×2 mosaic of the first 4 items and show a `+N` overlay on the last cell indicating the hidden count.
14. WHEN a media cell is clicked, THE MediaGrid SHALL open the MediaViewer modal at the corresponding index.
15. WHEN `post.linkUrl` and `post.linkTitle` are set, THE PostCard_v2 SHALL render a LinkPreviewCard below the post body.
16. WHEN a post has type `REPOST`, THE PostCard_v2 SHALL render a repost banner above the author header.
17. WHEN a post has type `QUOTE`, THE PostCard_v2 SHALL render the original post content as an inset quoted block below the body.
18. WHEN a post has `isPinned === true`, THE PostCard_v2 SHALL render a pinned indicator above the author header and apply a ring border to the card.

---

### Requirement 2: Feed Surface — ReactionPicker Animation

**User Story:** As a user, I want to choose from multiple emoji reactions on a post, so that I can express different emotions beyond a simple like.

#### Acceptance Criteria

1. WHEN a user hovers the Like button for 300 milliseconds, THE ReactionPicker SHALL animate open to display the available reaction emoji options.
2. WHEN a user clicks a reaction emoji, THE ReactionPicker SHALL call `postsApi.react(postId, type)` and close the picker.
3. WHEN `postsApi.react` succeeds, THE ReactionPicker SHALL display the selected emoji as the active reaction on the button and update the reaction count.
4. IF `postsApi.react` fails, THE ReactionPicker SHALL display a toast with the error message and roll back the optimistic state.
5. THE ReactionPicker SHALL be rendered in a portal attached to `document.body` to avoid layout issues inside scrollable containers.
6. WHEN a user clicks their currently active reaction, THE ReactionPicker SHALL toggle the reaction off by calling `postsApi.react` again with the same type.

---

### Requirement 3: Feed Surface — ShareMenu

**User Story:** As a user, I want to share posts to my feed, copy a post link, or share to a group, so that I can distribute content I find valuable.

#### Acceptance Criteria

1. WHEN the Share button is clicked, THE ShareMenu SHALL display a dropdown with at least three options: "Share to feed", "Copy link", and "Share to group".
2. WHEN "Share to feed" is selected, THE ShareMenu SHALL call `postsApi.create({ type: 'REPOST', originalPostId, visibility: 'PUBLIC' })`.
3. WHEN "Copy link" is selected, THE ShareMenu SHALL call `navigator.clipboard.writeText(buildShareUrl(post.id))` and show a success toast.
4. WHEN "Share to group" is selected, THE ShareMenu SHALL open a group-picker sheet allowing the user to select a group destination.
5. THE ShareMenu SHALL close automatically after any action is taken.
6. IF `postsApi.create` for a repost fails, THEN THE ShareMenu SHALL display a toast with the server error message.

---

### Requirement 4: Feed Surface — PostComposer v2

**User Story:** As a user, I want to write posts with emoji, @mention people, and add a location label, so that I can create richer content directly from the feed.

#### Acceptance Criteria

1. WHEN the user clicks the emoji button (😊) in the composer toolbar, THE PostComposer_v2 SHALL open an emoji picker popover.
2. WHEN an emoji is selected from the picker, THE PostComposer_v2 SHALL insert the emoji character at the current cursor position in the textarea.
3. WHEN the user types `@` in the textarea, THE PostComposer_v2 SHALL open a @mention dropdown that queries `/users/search` with the text following `@`.
4. WHEN a mention candidate is selected, THE PostComposer_v2 SHALL replace the `@query` token with the selected user's display name in the textarea.
5. THE PostComposer_v2 SHALL return at most 5 mention candidates matching the query string in a case-insensitive manner.
6. WHEN the query after `@` is empty, THE PostComposer_v2 SHALL display the first 5 users from the search results.
7. WHEN the location button is clicked, THE PostComposer_v2 SHALL allow the user to enter a text label for the location without requiring GPS.
8. THE PostComposer_v2 SHALL enforce a maximum body length of 5000 characters.
9. WHEN a post is successfully created, THE PostComposer_v2 SHALL optimistically prepend the new post to the feed cache and clear the composer body and media fields.
10. IF post creation fails, THEN THE PostComposer_v2 SHALL preserve the typed body text in the textarea and display a toast with the error message.
11. THE PostComposer_v2 SHALL support uploading up to 10 media items per post.
12. IF a media upload fails, THEN THE PostComposer_v2 SHALL clear the failed file input and display a toast reading "Upload failed".

---

### Requirement 5: Feed Surface — Real-Time Feed Updates

**User Story:** As a user, I want to see new posts from others without manually refreshing the page, so that my feed stays current during active sessions.

#### Acceptance Criteria

1. WHEN a `post:create` Socket.IO event is received for a post authored by another user, THE Feed_Surface SHALL display a "N new posts — tap to refresh" banner at the top of the feed.
2. WHEN the banner is tapped, THE Feed_Surface SHALL scroll to the top, prepend the incoming posts, and clear the banner.
3. WHEN a `post:create` event is received for a post authored by the current user, THE Feed_Surface SHALL NOT show the banner (the post is already optimistically prepended by PostComposer_v2).
4. WHEN a `post:delete` Socket.IO event is received, THE Feed_Surface SHALL remove the corresponding post from the visible list immediately.
5. WHEN a `post:update` Socket.IO event is received, THE Feed_Surface SHALL update the corresponding post's data in the list.
6. THE Feed_Surface SHALL combine incoming posts and cached feed posts and deduplicate by `post.id` so that no post appears more than once.
7. WHEN the user scrolls to the bottom of the feed and more pages exist, THE Feed_Surface SHALL call `fetchNextPage` to load the next page.
8. WHEN all pages have been loaded and at least one post is visible, THE Feed_Surface SHALL display the message "You're all caught up ✓".

---

### Requirement 6: Communities Surface — CommunityDetailPage v2

**User Story:** As a student or teacher, I want to see a community detail page with distinct sections for posts, members, about info, and media, so that I can engage with the community in a structured way.

#### Acceptance Criteria

1. THE CommunityDetailPage_v2 SHALL render a cover photo (full-bleed with overlay gradient), an avatar badge overlapping the cover bottom-left corner, the community name, member count, privacy badge, and a join/leave button in a header row.
2. THE CommunityDetailPage_v2 SHALL render exactly 4 tabs: Feed, Members, About, and Media.
3. WHEN `community.privacy === 'INVITE_ONLY'` and the user is not the owner, THE CommunityDetailPage_v2 SHALL NOT render the join/leave button.
4. WHEN the Feed tab is active, THE CommunityDetailPage_v2 SHALL render community posts using PostCard_v2 and render a PostComposer_v2 for members.
5. WHEN the Members tab is active, THE CommunityDetailPage_v2 SHALL render a searchable member list with role badges (Admin, Moderator, Member).
6. WHEN the members search input changes, THE CommunityDetailPage_v2 SHALL filter the visible member list in a case-insensitive manner so that every displayed member's full name contains the query string.
7. WHEN the About tab is active, THE CommunityDetailPage_v2 SHALL display the community description, rules, creation date, and creator profile link.
8. WHEN the Media tab is active, THE CommunityDetailPage_v2 SHALL display a photo and video grid sourced from the community's posts.
9. WHEN the Media tab grid is rendered, THE Media_Tab SHALL display only items whose type is `IMAGE` or `VIDEO`.
10. WHEN a member's full name satisfies the search predicate, THE CommunityDetailPage_v2 SHALL include that member in the visible list without omission.

---

### Requirement 7: Communities Surface — AdminPanel

**User Story:** As a community admin or owner, I want a dedicated admin panel to manage join requests and members, so that I can maintain the community effectively.

#### Acceptance Criteria

1. WHEN `myRole` is `OWNER` or `ADMIN`, THE CommunityDetailPage_v2 SHALL render a button to open the AdminPanel drawer.
2. WHEN `myRole` is neither `OWNER` nor `ADMIN`, THE CommunityDetailPage_v2 SHALL NOT render the AdminPanel trigger button.
3. WHEN the AdminPanel is opened, THE AdminPanel SHALL fetch pending join requests via `communitiesApi.getPendingRequests(slug)`.
4. WHEN an admin clicks "Accept" on a pending request, THE AdminPanel SHALL call the accept API and invalidate the `['community-pending', slug]` query.
5. WHEN an admin clicks "Decline" on a pending request, THE AdminPanel SHALL call the decline API and remove the request from the visible list.
6. WHEN an admin clicks "Remove" for a member, THE AdminPanel SHALL display a confirmation prompt before calling `communitiesApi.kickMember`.
7. IF `communitiesApi.kickMember` fails, THEN THE AdminPanel SHALL display a toast reading "Failed to remove member" and leave the member list unchanged.
8. THE AdminPanel SHALL NOT render a "Remove" button for members with the `OWNER` role regardless of the requesting admin's role.
9. THE AdminPanel SHALL NOT render a "Remove" button for the currently logged-in user's own entry.
10. WHEN the AdminPanel is closed and reopened, THE AdminPanel SHALL re-fetch pending requests.

---

### Requirement 8: Group Chat Surface — MessageBubble v2

**User Story:** As a student or teacher using group chat, I want visually distinct chat bubbles with rich interactions like reactions, reply context, and read receipts, so that conversations feel engaging and informative.

#### Acceptance Criteria

1. THE MessageBubble_v2 SHALL render messages sent by the current user with an indigo background aligned to the right, and messages from others with a white background aligned to the left.
2. WHEN consecutive messages are sent by the same sender within a 5-minute window, THE MessageBubble_v2 SHALL show the sender avatar only on the first bubble of the cluster.
3. WHEN `msg.replyTo` is set, THE MessageBubble_v2 SHALL render a ReplyQuote block above the bubble body showing the original sender's name and a truncated body.
4. WHEN reaction pills exist for a message, THE MessageBubble_v2 SHALL render grouped reaction pills below the bubble body, each showing the emoji and count.
5. WHEN the current user's own reaction matches a pill, THE MessageBubble_v2 SHALL highlight that pill with an indigo style.
6. WHEN `resolveReadReceipt(msg, memberIds)` returns `'sent'`, THE MessageBubble_v2 SHALL display a single grey tick on the own-message bubble.
7. WHEN `resolveReadReceipt(msg, memberIds)` returns `'delivered'`, THE MessageBubble_v2 SHALL display double grey ticks on the own-message bubble.
8. WHEN `resolveReadReceipt(msg, memberIds)` returns `'read'`, THE MessageBubble_v2 SHALL display double blue ticks on the own-message bubble.
9. Read receipt ticks SHALL be rendered only on own-message bubbles, never on bubbles from other senders.
10. WHEN `msg.isPinned` is `true`, THE GroupChat_Surface SHALL display a PinnedMessage banner at the top of the chat window.

---

### Requirement 9: Group Chat Surface — ContextMenu

**User Story:** As a user, I want to access message actions (reply, react, copy, forward, delete) via a context menu triggered by long-press or right-click, so that common chat actions are accessible without cluttering the UI.

#### Acceptance Criteria

1. WHEN a message bubble is long-pressed (mobile: ≥ 500 ms) or right-clicked (desktop), THE ContextMenu SHALL appear positioned near the pointer with available actions.
2. THE ContextMenu SHALL always include Reply, React, and Copy actions.
3. WHEN `isMe === true`, THE ContextMenu SHALL additionally include Delete and Forward actions.
4. WHEN `isMe === false`, THE ContextMenu SHALL NOT include the Delete action.
5. WHEN "Reply" is selected, THE ContextMenu SHALL set `replyTo` to the selected message and display a QuoteBar above the message input.
6. WHEN "Copy" is selected, THE ContextMenu SHALL call `navigator.clipboard.writeText(msg.body)` and close the menu.
7. WHEN "Delete" is selected, THE ContextMenu SHALL call the delete API and remove the message from the local list.
8. WHEN "Forward" is selected, THE ContextMenu SHALL open a group-picker to select a destination group and call the send API with `forwardedFrom` set.
9. AT MOST one ContextMenu SHALL be visible at any time in the chat window.
10. WHEN anywhere outside the ContextMenu is clicked or tapped, THE ContextMenu SHALL close.

---

### Requirement 10: Group Chat Surface — Real-Time Chat Features

**User Story:** As a group chat participant, I want to see typing indicators, send replies, react to messages, and have my read state tracked, so that the chat experience feels live and responsive.

#### Acceptance Criteria

1. WHEN another member starts typing in the active conversation, THE GroupChat_Surface SHALL display a TypingIndicator with animated dots and the member's first name.
2. THE TypingIndicator SHALL display only names of members whose `userId` is not equal to the current user's `userId`.
3. WHEN the current user is the only person typing, THE GroupChat_Surface SHALL NOT display any TypingIndicator.
4. WHEN the user has been typing and stops for 2.5 seconds, THE GroupChat_Surface SHALL emit `group:typing_stop` to the Socket.IO server.
5. THE GroupChat_Surface SHALL emit `group:typing_start` at most once per 2.5-second window regardless of how many characters are typed.
6. WHEN a message is sent with `replyTo` set, THE GroupChat_Surface SHALL call `groupChatApi.send` with the `replyToId` parameter set to `replyTo.id`.
7. AFTER a message is successfully sent, THE GroupChat_Surface SHALL set `replyTo` to `null` regardless of message content.
8. WHEN messages are loaded for a conversation, THE GroupChat_Surface SHALL call `groupChatApi.markRead` with the IDs of the last 20 messages.
9. WHEN a `group:message` Socket.IO event is received for the active conversation, THE GroupChat_Surface SHALL scroll the message list to the bottom and call `groupChatApi.markRead` for the new message.
10. WHEN a `group:message` event is received for a non-active conversation, THE GroupChat_Surface SHALL increment the unread badge count for that conversation in the sidebar.
11. WHEN the user switches to a conversation, THE GroupChat_Surface SHALL reset the unread count for that conversation to zero.
12. WHEN the user clicks "Load more" at the top of the message list, THE GroupChat_Surface SHALL call `groupChatApi.messages` with the oldest message's `createdAt` as the before-cursor.
13. IF `groupChatApi.messages` fails on load more, THEN THE GroupChat_Surface SHALL display a toast reading "Failed to load history" and leave the "Load more" button enabled.

---

### Requirement 11: Error Handling Across All Surfaces

**User Story:** As a user, I want clear feedback when an action fails, so that I know what happened and can try again.

#### Acceptance Criteria

1. IF the feed API fetch fails, THEN THE Feed_Surface SHALL display an inline error state with a retry button that re-triggers `fetchNextPage`.
2. IF a reaction mutation fails, THEN THE Feed_Surface SHALL display a toast with the server error message and roll back the optimistic reaction state.
3. IF post creation fails, THEN THE PostComposer_v2 SHALL preserve the body text in the textarea and display a toast with the error message.
4. IF a community join or leave request fails, THEN THE CommunityDetailPage_v2 SHALL display a toast with the server error message and re-enable the join/leave button.
5. IF `groupChatApi.send` fails, THEN THE GroupChat_Surface SHALL restore the typed message to the input field and display a toast reading "Failed to send".
6. IF leaving a group fails, THEN THE GroupChat_Surface SHALL display a toast reading "Failed to leave group" and leave the user as a member.
7. IF a reaction on a message fails, THE GroupChat_Surface SHALL silently ignore the failure without displaying a toast or changing the displayed reaction state.
8. WHEN pending requests fail to load in the AdminPanel, THE AdminPanel SHALL display an empty list silently and allow the panel to be closed and reopened to retry.
