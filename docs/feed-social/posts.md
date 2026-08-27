# Feed + Social — Posts Complete Reference

**Audit date:** 2026-08-26

---

## Post Lifecycle

```
DRAFT (isDraft=true, scheduledAt=null)
   ↓ publish (PATCH /posts/:id { isDraft: false })

SCHEDULED (isDraft=false, scheduledAt=future)
   ↓ scheduledAt arrives
   → No auto-publish cron exists — publishing is manual (gap)

PUBLISHED (isDraft=false, deletedAt=null)
   ↓ author edits
UPDATED
   ↓ author/admin deletes
SOFT-DELETED (deletedAt=now)
```

**Note:** There is no auto-publish cron for scheduled posts. Scheduled posts remain as `isDraft=false, scheduledAt=future` but are not broadcast until the author manually publishes or the client detects the scheduled time.

---

## Post Creation Flow

```
Client → POST /api/v1/posts
  └─ authenticate
  └─ createLimit (20/min)
  └─ express-validator
  └─ postFilter('body', 'post')  ← content filter
  └─ createPost():
     ├─ Set schoolId = req.user.schoolId IF visibility='SCHOOL_ONLY'
     ├─ Create Post in DB
     ├─ Create PostMedia records (from media[] array)
     ├─ Extract and create Hashtags + PostHashtag
     ├─ Extract and create @mention PostMention records
     ├─ Queue mention notifications
     ├─ Socket.IO broadcast:
     │    if communityId + PRIVATE community → community:{id} only
     │    if communityId + PUBLIC community → community:{id} + feed:public
     │    if PUBLIC/FOLLOWERS → feed:public
     │    if SCHOOL_ONLY → feed:school:{schoolId}
     │    if PRIVATE → no broadcast
     └─ Return created post with full includes
```

---

## Reactions

6 reaction types: `LIKE | LOVE | CELEBRATE | SUPPORT | INSIGHTFUL | FUNNY`

**Toggle behavior:** If the user has already reacted with the same type → removes the reaction. If reacted with a different type → updates to new type.

```javascript
// reactToPost:
const existing = await prisma.postReaction.findUnique({
  where: { postId_userId: { postId, userId } }
});
if (existing?.type === type) {
  // Remove reaction (toggle off)
  await prisma.postReaction.delete(...);
  action = 'removed';
} else if (existing) {
  // Change reaction type
  await prisma.postReaction.update(...);
  action = 'changed';
} else {
  // New reaction
  await prisma.postReaction.create(...);
  action = 'added';
}
// Update post.likeCount accordingly
// Emit: post:like → feed:public
// Send LIKE notification to post author (if action = 'added')
```

---

## Comments

Comments support one level of threading via `parentId`:
- Top-level comment: `parentId = null`
- Reply: `parentId = commentId` of the parent comment

```
GET /posts/:id/comments?cursor=...&limit=20
  └─ Returns top-level comments
  └─ Each comment includes first 3 replies + replyCount
  └─ cursor-paginated
```

Comment reactions use the same 6 types as post reactions.

**Delete authorization:**
```javascript
// deleteComment:
const canDelete = comment.authorId === req.user.id || post.authorId === req.user.id;
if (!canDelete) return 403;
```

Comment author OR post author can delete.

---

## Bookmarks

```javascript
// toggleBookmark:
const existing = await prisma.postBookmark.findUnique({ where: { postId_userId } });
if (existing) {
  await prisma.postBookmark.delete(...);
  await prisma.post.update({ data: { bookmarkCount: { decrement: 1 } } });
  return { bookmarked: false };
} else {
  await prisma.postBookmark.create(...);
  await prisma.post.update({ data: { bookmarkCount: { increment: 1 } } });
  return { bookmarked: true };
}
```

Bookmarks are private — only the bookmarking user can see their bookmarks via `GET /posts/user/:userId?tab=bookmarks` (requires `isOwner` check).

---

## Reposts and Quotes

**Repost:** `type='REPOST'`, `originalPostId` set. Body is typically null.

**Quote:** `type='QUOTE'`, `originalPostId` set, `quotedBody` = the quoting user's commentary.

Both are created via `POST /posts` with `originalPostId` in the body. The original post is fetched and embedded in the response.

```javascript
// createPost with type='REPOST':
payload: { type: 'REPOST', originalPostId: post.id, visibility: 'PUBLIC' }
```

---

## Polls

```
type = 'POLL'
pollData = {
  question: "...",
  options: [
    { id: "opt1", text: "Option A", votes: 0 },
    { id: "opt2", text: "Option B", votes: 0 }
  ],
  totalVotes: 0,
  expiresAt: "2026-08-28T00:00:00Z",
  allowMultiple: false
}
```

**Vote:** `POST /posts/:id/poll/vote { optionId }`

The vote identity uses `req.user.id` — never a client-supplied userId (P2-01 fix applied in live class context; same pattern used here).

---

## Link Preview

`GET /posts/link-preview?url=...`

Scrapes OG meta tags from external URLs for link card previews. Rate-limited (30/min). URL is fetched server-side — client never makes the request directly.

---

## View Tracking

`POST /posts/:id/view` — records one view per user per post (upsert `PostView`). Rate-limited to 200/min. Increments `post.viewCount`. Fire-and-forget from the frontend (errors ignored).

---

## Pin

`POST /posts/:id/pin` — toggles `post.isPinned`. Author only. Pinned posts appear at the top of the user's profile feed.
