# Feed + Social — Feed Generation, Visibility, School Isolation

**Audit date:** 2026-08-26

---

## Visibility Modes

Four visibility modes are implemented in the codebase:

| Value | Who can see |
|-------|-------------|
| `PUBLIC` | Any authenticated user |
| `FOLLOWERS` | Author + users who follow the author |
| `PRIVATE` | Author only |
| `SCHOOL_ONLY` | Users whose `User.schoolId === Post.schoolId` |

**Important:** `SCHOOL_ONLY` uses the legacy `User.schoolId` field, not `SchoolMembership`. This means users in the new membership system may not see school posts if their `User.schoolId` doesn't match, even if they have an active `SchoolMembership`.

---

## `visibilityFilter()` — The Core Filter

```javascript
// post.controller.js
async function visibilityFilter(viewerId) {
  const [viewer, following, activeSubs] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } }),
    prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
    prisma.creatorSubscription.findMany({ where: { subscriberId: viewerId, status: 'ACTIVE' } }),
  ]);

  return {
    deletedAt: null,
    isDraft:   false,
    OR: [
      { visibility: 'PUBLIC',      isExclusive: false },
      { visibility: 'FOLLOWERS',   isExclusive: false, authorId: { in: followingIds } },
      { authorId: viewerId },   // own posts always visible
      ...(viewer?.schoolId
        ? [{ visibility: 'SCHOOL_ONLY', isExclusive: false, schoolId: viewer.schoolId }]
        : []),
      // Exclusive posts: only for active subscribers
      ...exclusiveFilter,
    ]
  };
}
```

This filter is applied to every `getFeed()` and `getUserPosts()` query.

**Blocked users:** The controller also adds `authorId: { notIn: blockedByMe }` to exclude posts from users the viewer has blocked. This requires loading the blocked list before each query.

---

## Feed Query Flow

```
GET /posts/feed?cursor=...&limit=20&filter=all

1. viewerId = req.user.id
2. filter = 'all' (default) or 'following'

If filter = 'following':
  where = {
    deletedAt: null, isDraft: false,
    OR: [
      { authorId: { in: followingIds } },  // posts from people you follow
      { authorId: viewerId }               // own posts
    ]
  }

If filter = 'all':
  where = await visibilityFilter(viewerId)
  // Adds: blocked users exclusion
  // Adds: NOT IN blockedByMe authors

3. Apply cursor: if cursor provided → where.createdAt = { lte: cursorDate }
4. Query posts with includes:
   - author (id, firstName, lastName, avatarUrl, role)
   - media (ordered by orderIndex)
   - _count of reactions and comments
   - own reaction (where userId = viewerId)
   - own bookmark (where userId = viewerId)
   - originalPost (for REPOSTs)
5. Return items + nextCursor (last item's createdAt_id)
```

---

## Pagination

**Type:** Cursor-based  
**Cursor format:** `{createdAt.toISOString()}_{postId}` — composite to handle duplicate timestamps  
**Default limit:** 20  
**Maximum limit:** Not explicitly capped in the controller (uses req.query.limit)  
**Ordering:** `createdAt DESC`, `id DESC` (stable ordering)

---

## School Feed Isolation

### Post Creation

When `visibility = 'SCHOOL_ONLY'`:
```javascript
schoolId: visibility === 'SCHOOL_ONLY' ? req.user.schoolId : null,
```

The post's `schoolId` is set from `req.user.schoolId`. Users without a school cannot create `SCHOOL_ONLY` posts.

### Post Query

```javascript
{ visibility: 'SCHOOL_ONLY', isExclusive: false, schoolId: viewer.schoolId }
```

Only users whose `User.schoolId` matches `Post.schoolId` see school posts.

### Socket.IO Real-time

New `SCHOOL_ONLY` posts broadcast to `feed:school:{schoolId}`:
```javascript
io.to(`feed:school:${req.user.schoolId}`).emit('post:create', { post: full });
```

### Who Can Join `feed:school:{schoolId}`?

```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  // SUPER_ADMIN global bypass (legacy) ← SVSV-001 VIOLATION
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);
    return;
  }
  // Normal users: JWT schoolId must match
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

**SVSV-001:** SUPER_ADMIN can join ANY school's feed socket room. See [gaps.md](./gaps.md).

---

## Feed Socket Rooms

| Room | Who joins | Events received |
|------|-----------|----------------|
| `feed:public` | Auto on `feed:join` | `post:create`, `post:update`, `post:delete`, `post:like`, `feed:live`, `feed:live_ended`, `feed:live_update` |
| `feed:{userId}` | Auto on `feed:join` | Personal feed events |
| `feed:school:{schoolId}` | On `feed:join:school` | School-scoped `post:create` events |

---

## Post Types

| Type | Description |
|------|-------------|
| `TEXT` | Text-only post |
| `IMAGE` | Post with images |
| `VIDEO` | Post with video |
| `AUDIO` | Post with audio |
| `DOCUMENT` | Post with document |
| `POLL` | Poll post (options in `pollData` JSON) |
| `MULTI_IMAGE` | Carousel of images |
| `LIVE_ROOM_SHARE` | Auto-created when a voice room goes live (via `feedLive.js`) |
| `LIVE_CLASS_SHARE` | Auto-created when a live class starts (via `feedLive.js`) |
| `REPOST` | Repost of another post (references `originalPostId`) |
| `QUOTE` | Quote post (references `originalPostId` + adds `quotedBody`) |

---

## Trending Hashtags

The `GET /posts/trending` endpoint returns trending hashtags.

Storage: `trending_hashtags` table with period (HOURLY/DAILY/WEEKLY).  
Update: `recalculateLeaderboard()` in leaderboard controller.  
Cache: Redis with `TRENDING_TTL` (5 minutes) — falls back to DB.

---

## Post Content Filter

Posts and comments pass through `filterMiddleware` from `contentFilter.js` before DB write:

```javascript
router.post('/', createLimit, [...validators], validate, postFilter('body', 'post'), ctrl.createPost);
```

The filter checks for profanity/toxicity. If triggered, the request is rejected before the post is created.

---

## Who Can Create Posts

Any authenticated user can create posts. There is no role restriction on post creation.  
School-related restrictions apply only to `visibility = 'SCHOOL_ONLY'` — requires a non-null `User.schoolId`.

**SUPER_ADMIN can create posts as a regular user.** This is content participation — it is not blocked. The platform spec says SUPER_ADMIN should not participate in feed as a regular user (see [gaps.md](./gaps.md)).
