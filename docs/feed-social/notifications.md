# Feed + Social — Notifications

**Audit date:** 2026-08-26

---

## Notification Types (Social)

From the `NotificationType` enum in `schema.prisma`:

| Type | Trigger | Target |
|------|---------|--------|
| `FOLLOW` | User A follows User B | User B |
| `LIKE` | User reacts to a post | Post author |
| `COMMENT` | User comments on a post | Post author |
| `COMMENT_REPLY` | User replies to a comment | Comment author |
| `FRIEND_REQUEST` | User sends friend request | Receiver |
| `FRIEND_ACCEPTED` | Friend request accepted | Sender |
| `COMMUNITY_JOIN` | User joins your community | Community owner |
| `COMMUNITY_INVITE` | Admin invites you to community | Invitee |
| `GIFT_RECEIVED` | Gift sent in a room | Receiver |
| `TIP_RECEIVED` | Creator tip received | Creator |
| `NEW_SUBSCRIBER` | New creator subscription | Creator |
| `MENTION` | @mention in post or comment | Mentioned user |
| `VOICE_ROOM_LIVE` | Host you follow starts a voice room | Followers |
| `LIVE_CLASS_START` | Teacher starts live class | Enrolled students |
| `COINS_PURCHASED` | Stripe payment confirmed | Purchasing user |

---

## Notification Delivery

Notifications are created via the `queueBulkNotifications()` service which:
1. Creates `Notification` records in the DB (in-app inbox)
2. Sends FCM push notifications to devices with valid `fcmToken`
3. Sends SMS/email if configured

The queue service is fire-and-forget — notification failures do not fail the originating request.

---

## In-App Notification API

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/notifications` | Paginated inbox (`?unreadOnly=true`) |
| GET | `/notifications/unread-count` | Badge count |
| PUT | `/notifications/read-all` | Mark all read |
| PUT | `/notifications/:id/read` | Mark one read |

**No real-time socket event for notifications** — clients poll the unread count. New notifications are fetched on next `GET /notifications`.

---

## Mention System

When a post or comment is created with `@username` patterns, `extractMentions()` parses the body:

```javascript
async function extractMentions(body, authorId, tx) {
  if (!body) return [];
  const atMentions = [...body.matchAll(/@(\w{3,30})/g)].map(m => m[1].toLowerCase());
  
  const users = await tx.user.findMany({
    where: {
      username: { in: atMentions },
      id: { not: authorId },      // don't notify author of their own mention
      status: 'ACTIVE',
      deletedAt: null
    },
    select: { id: true, firstName: true, username: true }
  });
  return users;
}
```

Found users receive a `MENTION` notification.

`PostMention` records are created for each mention in both posts and comments.

---

## Push Notification Categories

From `backend/src/utils/push.js`:

```javascript
if (SOCIAL_TYPES.includes(type)) return 'social';
if (['ATTENDANCE','GRADE','BEHAVIOR'].includes(type)) return 'education';
if (['LIVE_CLASS_START','VOICE_ROOM_LIVE'].includes(type)) return 'live';
if (type === 'COINS_PURCHASED') return 'wallet';
return 'general';
```

Social types go to the 'social' notification channel on mobile.
