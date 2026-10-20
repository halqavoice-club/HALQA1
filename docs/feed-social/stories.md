# Feed + Social — Stories

**Audit date:** 2026-08-26

---

## Overview

Stories are ephemeral 24-hour content items. They appear in a bar at the top of the feed. Once the 24-hour `expiresAt` time passes, stories are no longer visible (they are not hard-deleted, just filtered by expiry).

---

## Story Types

| Type | Description |
|------|-------------|
| `IMAGE` | Photo with optional caption |
| `VIDEO` | Video with optional caption |
| `TEXT` | Text-only story with background color |

---

## Lifecycle

### 1. Create

```
POST /api/v1/stories
Rate limit: 30 per hour
Body: { type, mediaUrl?, text?, caption?, duration, bgColor?, textColor? }

createStory():
  └─ Creates Story record with:
     expiresAt = createdAt + 24 hours
     viewCount = 0, reactionCount = 0
  └─ No socket event (stories are batch-loaded, not streamed)
  └─ Returns created story
```

### 2. View (Mark as Seen)

```
POST /api/v1/stories/:id/view

viewStory():
  └─ Check: story must not be expired (expiresAt > now)
  └─ Check: story must not be deleted
  └─ Upsert StoryView { storyId, viewerId }
  └─ Increment story.viewCount
  └─ No notification (views are silent)
```

### 3. React

```
POST /api/v1/stories/:id/react
Body: { type: string (emoji) }

reactToStory():
  └─ Check: story not expired, not deleted
  └─ Upsert StoryReaction { storyId, userId, type }
  └─ Increment story.reactionCount if new
  └─ Send DM reply to author with the reaction
  └─ Trigger MENTION-style notification to author
```

### 4. Delete

```
DELETE /api/v1/stories/:id

deleteStory():
  └─ Author only check
  └─ Soft-delete: story.deletedAt = now
```

### 5. Expiry

Stories are not hard-deleted on expiry. The feed query filters by:
```javascript
WHERE expiresAt > NOW() AND deletedAt IS NULL
```

Expired stories remain in the DB as historical records.

---

## Feed Query

```
GET /api/v1/stories/feed

getStoriesFeed():
  └─ Load viewer's following list
  └─ Query active stories:
     WHERE authorId IN (followingIds + viewerId)
       AND expiresAt > now
       AND deletedAt IS NULL
  └─ Group by authorId
  └─ For each group, include: story count, first unviewed story first
  └─ Own stories always first in the list
```

---

## Visibility

Stories have **no explicit visibility field**. They are visible to:
- Users who follow the author
- The author themselves

There is no `SCHOOL_ONLY` or `PRIVATE` option for stories. Close friends / archive features are not implemented.

---

## Story Viewers

```
GET /api/v1/stories/:id/viewers
Auth: authenticate (author only)

getStoryViewers():
  └─ Only the story author can see who viewed their story
  └─ Returns paginated list of StoryView with viewer info
```

---

## Database

`Story` model fields: see [database.md](./database.md#10-story-stories)

`StoryView`:
```
@@unique([storyId, viewerId])
@@index([storyId])
```

`StoryReaction`:
```
@@unique([storyId, userId])
@@index([storyId])
```

---

## Mobile Integration

Mobile creates stories via `POST /api/v1/stories` with media uploaded first to `/api/v1/uploads`. Story display uses the `StoriesBar` component pattern.

Stories can be replied to via DM: `DirectMessage.storyId` creates a DM message that references the story, shown with a story preview above the message in the DM conversation.

---

## SUPER_ADMIN and Stories

SUPER_ADMIN can create stories as a regular user. There is no gate preventing this. Under the canonical rule, SUPER_ADMIN should not participate in social content. This is documented as a gap (FS-GAP-004 in [gaps.md](./gaps.md)).
