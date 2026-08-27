# Feed + Social — Architecture

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation. No code modified.

---

## System Overview

```
Client (Web / Mobile)
       │
       ▼
API Layer (/api/v1/posts, /social, /stories, /explore, /notifications, /report-block)
       │
       ├── Authentication (JWT Bearer token — authenticate middleware)
       ├── Rate Limiting (per-endpoint, per-user)
       ├── Input Validation (express-validator + Zod where present)
       ├── Content Filter (contentFilter utility — toxicity/profanity)
       │
       ▼
Controllers (post.controller, social.controller, story.controller, explore.controller)
       │
       ├── Database (MySQL via Prisma)
       │       ├── posts, post_media, post_reactions, post_comments, comment_reactions
       │       ├── post_hashtags, hashtags, post_mentions, post_bookmarks, post_views
       │       ├── stories, story_views, story_reactions
       │       ├── follows, friend_requests
       │       ├── communities, community_members, community_join_requests, community_bans, community_invites
       │       ├── user_reports, user_blocks
       │       └── notifications, trending_hashtags, search_index
       │
       ├── Redis Cache (optional — falls back to DB if unavailable)
       │       ├── Trending hashtags (TRENDING_TTL = 5 minutes)
       │       ├── Feed cursor state
       │       └── Community ban sets
       │
       ├── Socket.IO (real-time events)
       │       ├── feed:public room (all connected users)
       │       ├── feed:{userId} room (personal events)
       │       ├── feed:school:{schoolId} room (school-scoped feed)
       │       └── community:{id} room (community events)
       │
       └── Notifications (push + in-app via queue.service)
```

---

## Route Mounting

| Route prefix | File | Purpose |
|-------------|------|---------|
| `/api/v1/posts` | `post.routes.js` | Posts, comments, reactions, bookmarks, feed |
| `/api/v1/social` | `social.routes.js` | Follow, friends, social counts, reports (admin) |
| `/api/v1/stories` | `story.routes.js` | Stories CRUD and views |
| `/api/v1/explore` | `explore.routes.js` | Discovery, search, hashtag feeds |
| `/api/v1/notifications` | `notification.routes.js` | Notification inbox |
| `/api/v1/report-block` | `report-block.routes.js` | User reports and blocks |
| `/api/v1/search` | `search.routes.js` | Unified search |

---

## Feed Architecture

The feed is a **cursor-paginated reverse-chronological list** of posts filtered by visibility rules.

```
GET /api/v1/posts/feed?cursor=...&limit=20&filter=all

getFeed():
  1. Resolve viewer identity (req.user.id)
  2. Build visibility filter (visibilityFilter helper):
     a. Load viewer's schoolId
     b. Load viewer's following list
     c. Load viewer's active creator subscriptions
     d. Build OR condition:
        - PUBLIC non-exclusive posts
        - FOLLOWERS non-exclusive posts by followed users
        - Own posts
        - SCHOOL_ONLY posts matching viewer's schoolId
        - isExclusive posts where viewer has active subscription
  3. Apply cursor (createdAt < cursor) and limit
  4. Fetch posts with includes (author, media, reactions count, comments count, own reaction)
  5. Build next cursor from last item's createdAt + id
```

**No algorithmic ranking.** Posts are returned in reverse-chronological order only.

---

## Key Design Decisions

1. **Cursor pagination** — uses `createdAt + id` as composite cursor to handle posts with identical timestamps
2. **Visibility filter** — computed at query time, not stored in a separate visibility table
3. **School isolation** — `Post.schoolId` is set when `visibility = 'SCHOOL_ONLY'`; filter checks `schoolId = viewer.schoolId`
4. **Blocking** — blocked users' posts are filtered out via `authorId NOT IN blockedIds` (implemented in `visibilityFilter`)
5. **Content filter** — posts and comments pass through `contentFilter` middleware before DB write
6. **Real-time** — new posts broadcast to `feed:public` or `feed:school:{schoolId}` socket rooms
7. **No server-side recommendations** — feed is strictly chronological; no ML ranking

---

## Media Storage

Media for posts and stories uses the upload system:
- `POST /api/v1/uploads` — single file upload
- `POST /api/v1/uploads/multiple` — up to 10 files
- Files stored locally (`STORAGE_TYPE=local`) or Cloudflare R2 (`STORAGE_TYPE=r2`)
- Magic byte validation (file-type library) — not just Content-Type header
- ClamAV virus scan (optional — graceful degradation if unavailable)
- Returned URL stored in `PostMedia.url`

---

## Dependencies

| Service | Role | Required |
|---------|------|---------|
| MySQL | Primary data store | ✅ Yes |
| Redis | Trending hashtag cache, community ban sets | ⚠️ Soft |
| Socket.IO | Real-time feed events | ✅ For realtime |
| FCM/Push | Push notifications for social events | ⚠️ Soft |
| R2/Local storage | Media file storage | ✅ For media posts |
| Elasticsearch | Full-text search (optional) | ⚠️ Falls back to MySQL LIKE |
