# Feed + Social — Database Models

**Source:** `backend/prisma/schema.prisma`  
**Audit date:** 2026-08-26

---

## 1. `Post` (`posts`)

**Purpose:** The central content unit — text, images, videos, polls, reposts, quotes, live shares.

### Key Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `authorId` | String | FK → `users.id` |
| `body` | String (Text) | Up to 5000 chars |
| `type` | String | `TEXT / IMAGE / VIDEO / AUDIO / DOCUMENT / POLL / MULTI_IMAGE / LIVE_ROOM_SHARE / LIVE_CLASS_SHARE / REPOST / QUOTE` |
| `visibility` | String | `PUBLIC / FOLLOWERS / PRIVATE / SCHOOL_ONLY` |
| `schoolId` | String? | Set when `visibility = SCHOOL_ONLY`; `viewer.schoolId` must match |
| `isDraft` | Boolean | Default false |
| `scheduledAt` | DateTime? | Scheduled publication |
| `isExclusive` | Boolean? | Creator economy — subscribers only |
| `tierRequired` | String? | FK → `creator_tiers.id` for exclusive posts |
| `communityId` | String? | FK → `communities.id` for community posts |
| `originalPostId` | String? | FK → `posts.id` for REPOST/QUOTE |
| `quotedBody` | String? | Extra body on a QUOTE post |
| `refEntityType` | String? | `voice_room / live_class` for live share cards |
| `refEntityId` | String? | The referenced entity's ID |
| `likeCount` | Int | Denormalized count |
| `commentCount` | Int | Denormalized count |
| `shareCount` | Int | Denormalized count |
| `viewCount` | Int | Denormalized count |
| `bookmarkCount` | Int | Denormalized count |
| `isPinned` | Boolean | Pinned on user's profile |
| `isArchived` | Boolean | Archived by author |
| `deletedAt` | DateTime? | Soft delete |

**Indexes:** `authorId`, `visibility`, `schoolId`, `communityId`, `createdAt`, `scheduledAt`, `deletedAt`, composite indexes for feed queries

### CRUD Authorization

| Op | Who |
|----|-----|
| CREATE | Any authenticated user |
| READ PUBLIC | Any authenticated user |
| READ FOLLOWERS | Author + followers |
| READ SCHOOL_ONLY | Users with matching `schoolId` |
| READ PRIVATE | Author only |
| UPDATE | Author only |
| DELETE (soft) | Author, SCHOOL_ADMIN (of author's school), SUPER_ADMIN |
| PIN | Author only |

---

## 2. `PostMedia` (`post_media`)

**Purpose:** Media items attached to a post.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `postId` | String | FK → `posts.id` |
| `url` | String | Storage URL |
| `type` | String | IMAGE / VIDEO / AUDIO / DOCUMENT |
| `mimeType` | String? | |
| `size` | Int? | Bytes |
| `width` | Int? | |
| `height` | Int? | |
| `duration` | Int? | Seconds (video/audio) |
| `thumbnail` | String? | Video thumbnail URL |
| `orderIndex` | Int | Display order |

---

## 3. `PostReaction` (`post_reactions`)

**Purpose:** User reactions to posts (LIKE, LOVE, etc.).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `postId` | String | FK → `posts.id` |
| `userId` | String | FK → `users.id` |
| `type` | String | `LIKE / LOVE / CELEBRATE / SUPPORT / INSIGHTFUL / FUNNY` |

```
@@unique([postId, userId])   // one reaction per user per post
```

---

## 4. `PostComment` (`post_comments`)

**Purpose:** Comments and replies on posts.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `postId` | String | FK → `posts.id` |
| `authorId` | String | FK → `users.id` |
| `parentId` | String? | FK → `post_comments.id` for replies |
| `body` | String (Text) | |
| `likeCount` | Int | |
| `replyCount` | Int | |
| `deletedAt` | DateTime? | |

---

## 5. `CommentReaction` (`comment_reactions`)

**Purpose:** Reactions on comments.

```
@@unique([commentId, userId])
```

---

## 6. `PostHashtag` / `Hashtag`

**Purpose:** Many-to-many between posts and hashtags.

`Hashtag`: `name` (unique), `postCount`  
`PostHashtag`: composite PK `[postId, hashtagId]`

---

## 7. `PostMention` (`post_mentions`)

**Purpose:** @mention records for posts and comments.

| Field | Notes |
|-------|-------|
| `postId?` | Post context |
| `commentId?` | Comment context |
| `userId` | Mentioned user FK |

Triggers `MENTION` notification to the mentioned user.

---

## 8. `PostBookmark` (`post_bookmarks`)

**Purpose:** User saves/bookmarks.

```
@@unique([postId, userId])
```

---

## 9. `PostView` (`post_views`)

**Purpose:** Feed impression tracking (one view per user per post).

```
@@unique([postId, userId])
```

---

## 10. `Story` (`stories`)

**Purpose:** Ephemeral 24-hour content.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | |
| `authorId` | String | FK → `users.id` |
| `type` | String | IMAGE / VIDEO / TEXT |
| `mediaUrl` | String? | |
| `text` | String? | Max 500 chars (text stories) |
| `caption` | String? | Max 280 chars |
| `bgColor` / `textColor` | String? | Text story styling |
| `duration` | Int | Seconds to display (default 5) |
| `expiresAt` | DateTime | `createdAt + 24h` |
| `viewCount` | Int | |
| `reactionCount` | Int | |
| `deletedAt` | DateTime? | |

**No `visibility` field** — stories are always visible to followers (and anyone who can view the author's profile).

### `StoryView` (`story_views`)

```
@@unique([storyId, viewerId])
```

### `StoryReaction` (`story_reactions`)

```
@@unique([storyId, userId])
```

---

## 11. `Follow` (`follows`)

**Purpose:** One-way follow (TikTok-style).

| Field | Notes |
|-------|-------|
| `followerId` | Who is following |
| `followingId` | Who is being followed |

```
@@unique([followerId, followingId])
```

No approval required. Instantaneous.

---

## 12. `FriendRequest` (`friend_requests`)

**Purpose:** Two-way friend request (IMO-style).

| Field | Notes |
|-------|-------|
| `senderId` | |
| `receiverId` | |
| `status` | `PENDING / ACCEPTED / REJECTED` |

```
@@unique([senderId, receiverId])
```

---

## 13. `UserReport` (`user_reports`)

**Purpose:** Social report filed against a user.

| Field | Notes |
|-------|-------|
| `reporterId` | Who filed the report |
| `reportedId` | Who was reported |
| `roomId?` | Voice room context if applicable |
| `reason` | spam/harassment/hate_speech/sexual_content/scam/other |
| `description` | Optional text |
| `status` | PENDING / REVIEWED / DISMISSED / ACTION_TAKEN |
| `reviewedBy` | Admin userId |
| `reviewedAt` | |

```
@@unique([reporterId, reportedId])   // one PENDING report per pair
```

**Authorization:** CREATE — any user; READ/UPDATE — SUPER_ADMIN only

---

## 14. `UserBlock` (`user_blocks`)

**Purpose:** User-to-user blocks.

```
@@unique([blockerId, blockedId])
```

**Effect on feed:** Blocked users' posts are excluded from the blocker's feed via `authorId NOT IN blockedIds`.

---

## 15. `Community` (`communities`)

**Purpose:** Groups/clubs/topic spaces.

| Field | Notes |
|-------|-------|
| `slug` | Unique URL-safe name |
| `name` | Display name |
| `privacy` | PUBLIC / PRIVATE / INVITE_ONLY |
| `ownerId` | FK → `users.id` |
| `memberCount` | Denormalized |
| `isVerified` | Platform-verified badge |
| `category` | education/religion/technology/sports/arts/other |
| `deletedAt` | |

### `CommunityMember` (`community_members`)

`role`: OWNER / ADMIN / MODERATOR / MEMBER  
```
@@unique([communityId, userId])
```

### `CommunityJoinRequest` (`community_join_requests`)

For PRIVATE/INVITE_ONLY communities. Status: PENDING / ACCEPTED / DECLINED.

### `CommunityBan` (`community_bans`)

Persistent ban record. Also cached in Redis: `community:ban:{communityId}` set.

### `CommunityInvite` (`community_invites`)

Token-based invite (UUID v4). Status: PENDING / ACCEPTED / DECLINED / EXPIRED.

---

## 16. `Notification` (`notifications`)

**Purpose:** In-app notification inbox.

| Field | Notes |
|-------|-------|
| `userId` | Recipient FK |
| `schoolId?` | Optional school context |
| `type` | See NotificationType enum |
| `title` | Notification title |
| `body` | Notification body |
| `data` | JSON — entity IDs for deep linking |
| `isRead` | |
| `readAt` | |
| `sentVia` | JSON array: `["push","email","sms"]` |

**NotificationType social values:** `FOLLOW, LIKE, COMMENT, COMMENT_REPLY, FRIEND_REQUEST, FRIEND_ACCEPTED, COMMUNITY_JOIN, COMMUNITY_INVITE, GIFT_RECEIVED, TIP_RECEIVED, NEW_SUBSCRIBER, MENTION, VOICE_ROOM_LIVE, LIVE_CLASS_START, COINS_PURCHASED`

---

## 17. `TrendingHashtag` (`trending_hashtags`)

**Purpose:** Pre-computed trending hashtag rankings.

| Field | Notes |
|-------|-------|
| `hashtag` | Unique tag string |
| `count` | Post count |
| `rank` | Current rank |
| `previousRank` | For trend arrows |
| `period` | HOURLY / DAILY / WEEKLY |

Updated by `recalculateLeaderboard()` in the leaderboard controller.

---

## 18. `SearchIndex` (`search_index`)

**Purpose:** Unified search index for full-text search when Elasticsearch is unavailable.

| Field | Notes |
|-------|-------|
| `entityType` | user / post / community / product |
| `entityId` | |
| `title` | |
| `content` | Text content |
| `tags` | JSON array |
| `popularity` | Float for relevance ranking |
