# Feed + Social — API Endpoint Inventory

**Audit date:** 2026-08-26  
**All routes require `authenticate` unless noted.**

---

## Posts — `/api/v1/posts`

### Feed & Discovery

| Method | Path | Auth | Rate limit | Controller | Notes |
|--------|------|------|-----------|-----------|-------|
| GET | `/feed` | ✅ | — | `getFeed` | cursor-paginated; `?filter=all\|following` |
| GET | `/live` | ✅ | — | `getLiveSessions` | Active live rooms/classes |
| GET | `/trending` | ✅ | — | `getTrendingHashtags` | Trending hashtags |
| GET | `/search` | ✅ | — | `searchPosts` | Post search |
| GET | `/reels` | ✅ | — | `getReels` | TikTok-style VIDEO posts |
| GET | `/user/:userId` | ✅ | — | `getUserPosts` | Profile posts; `?tab=posts\|replies\|media\|bookmarks` |
| GET | `/link-preview` | ✅ | 30/min | `getLinkPreview` | OG/meta scrape for link preview |

### Post CRUD

| Method | Path | Auth | Rate limit | Controller | Notes |
|--------|------|------|-----------|-----------|-------|
| POST | `/` | ✅ | 20/min | `createPost` | Content filter applied |
| GET | `/:id` | ✅ | — | `getPost` | Visibility-checked |
| PATCH | `/:id` | ✅ | — | `updatePost` | Author only |
| DELETE | `/:id` | ✅ | — | `deletePost` | Author, school admin, SUPER_ADMIN |

### Post Interactions

| Method | Path | Auth | Rate limit | Controller | Notes |
|--------|------|------|-----------|-----------|-------|
| POST | `/:id/react` | ✅ | — | `reactToPost` | Types: LIKE/LOVE/CELEBRATE/SUPPORT/INSIGHTFUL/FUNNY |
| GET | `/:id/reactions` | ✅ | — | `getReactions` | Reaction list |
| GET | `/:id/comments` | ✅ | — | `getComments` | Paginated comments + replies |
| POST | `/:id/comments` | ✅ | 30/min | `addComment` | Content filter applied |
| PATCH | `/:id/comments/:commentId` | ✅ | — | `editComment` | Author only |
| DELETE | `/:id/comments/:commentId` | ✅ | — | `deleteComment` | Author or post owner |
| POST | `/:id/comments/:commentId/react` | ✅ | — | `reactToComment` | Comment reaction |
| POST | `/:id/bookmark` | ✅ | — | `toggleBookmark` | Toggle bookmark |
| POST | `/:id/view` | ✅ | 200/min | `recordView` | Impression tracking |
| POST | `/:id/pin` | ✅ | — | `pinPost` | Author only; pins to profile |
| POST | `/:id/report` | ✅ | — | `reportPost` | Report to platform |
| POST | `/:id/poll/vote` | ✅ | — | `votePoll` | Poll vote |

---

## Social Graph — `/api/v1/social`

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|-----------|-------|
| GET | `/search` | ✅ | — | Search users |
| POST | `/follow/:userId` | ✅ | 30/min | Follow a user |
| DELETE | `/follow/:userId` | ✅ | 30/min | Unfollow |
| GET | `/followers/:userId` | ✅ | — | Follower list |
| GET | `/following/:userId` | ✅ | — | Following list |
| GET | `/counts/:userId` | ✅ | — | Follower/following counts |
| GET | `/friends` | ✅ | — | Friend list |
| GET | `/friends/requests` | ✅ | — | Incoming friend requests |
| GET | `/friends/requests/sent` | ✅ | — | Sent friend requests |
| POST | `/friends/request/:userId` | ✅ | 20/min | Send friend request |
| POST | `/friends/accept/:userId` | ✅ | — | Accept request |
| POST | `/friends/reject/:userId` | ✅ | — | Reject request |
| DELETE | `/friends/request/:userId` | ✅ | — | Cancel sent request |
| DELETE | `/friends/:userId` | ✅ | — | Remove friend |
| POST | `/report/:userId` | ✅ | 10/hour | Report user |
| GET | `/reports` | SUPER_ADMIN | — | **Admin: list all reports** |
| PATCH | `/reports/:id/review` | SUPER_ADMIN | — | **Admin: review report** |
| POST | `/block/:userId` | ✅ | — | Block user |
| DELETE | `/block/:userId` | ✅ | — | Unblock |
| GET | `/blocked` | ✅ | — | My blocked users list |
| GET | `/block/:userId/status` | ✅ | — | Check block status |

---

## Stories — `/api/v1/stories`

| Method | Path | Auth | Rate limit | Controller | Notes |
|--------|------|------|-----------|-----------|-------|
| GET | `/feed` | ✅ | — | `getStoriesFeed` | Stories from followed users, grouped by author |
| GET | `/user/:userId` | ✅ | — | `getUserStories` | One user's active stories |
| POST | `/` | ✅ | 30/hour | `createStory` | Creates story with 24h expiry |
| POST | `/:id/view` | ✅ | — | `viewStory` | Mark as seen (upserts StoryView) |
| GET | `/:id/viewers` | ✅ | — | `getStoryViewers` | Author only |
| POST | `/:id/react` | ✅ | — | `reactToStory` | React to story |
| DELETE | `/:id` | ✅ | — | `deleteStory` | Author only; soft-deletes |

---

## Explore — `/api/v1/explore`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | ✅ | Aggregated explore feed: trending + communities + people + live |
| GET | `/search` | ✅ | Global search across all content types |
| GET | `/hashtag/:tag` | ✅ | Posts tagged with a specific hashtag |

---

## Notifications — `/api/v1/notifications`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | ✅ | List notifications (`?unreadOnly=true`) |
| GET | `/unread-count` | ✅ | Unread count |
| PUT | `/read-all` | ✅ | Mark all as read |
| PUT | `/:id/read` | ✅ | Mark one as read |

---

## Report & Block — `/api/v1/report-block`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/report/:userId` | ✅ | Report a user |
| GET | `/reports` | SUPER_ADMIN | List all reports |
| PATCH | `/reports/:id/review` | SUPER_ADMIN | Review/resolve report |
| POST | `/block/:userId` | ✅ | Block a user |
| DELETE | `/block/:userId` | ✅ | Unblock |
| GET | `/blocked` | ✅ | My blocked users |
| GET | `/block/:userId/status` | ✅ | Check block status |

---

## Post Deletion Authorization (F-2 Fix)

```javascript
// post.controller.js: deletePost()
const isAuthor       = post.authorId === req.user.id;
const isSuperAdmin   = req.user.role === 'SUPER_ADMIN';
const isSchoolAdmin  = req.user.role === 'SCHOOL_ADMIN';
const sameSchool     = post.schoolId && post.schoolId === req.user.schoolId;

if (!isAuthor && !isSuperAdmin && !(isSchoolAdmin && sameSchool)) {
  return 403;
}
```

SUPER_ADMIN can delete any post as a moderation action.  
SCHOOL_ADMIN can delete posts belonging to their school.  
Author can always delete their own post.
