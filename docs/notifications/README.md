# HALQA Notifications — Documentation

**Audit date:** 2026-08-26  
**Status:** Read-only documentation audit. No application code modified.

---

## Delivery Channels

| Channel | Implementation | Required |
|---------|---------------|---------|
| **In-app** | `Notification` DB table + `/api/v1/notifications` | ✅ Always |
| **Push (FCM)** | Firebase Cloud Messaging via `fcmToken` on `User` | ⚠️ Soft |
| **SMS** | Twilio (optional) | ⚠️ Soft |
| **Email** | SMTP | ⚠️ Soft |

All delivery is fire-and-forget via `queueBulkNotifications()` in `backend/src/services/queue.service.js`. Notification failures never fail the originating request.

---

## Notification Types (Full Enum)

From `schema.prisma NotificationType`:

**Education:** ATTENDANCE, GRADE, BEHAVIOR, MESSAGE, ANNOUNCEMENT, REMINDER, SYSTEM  
**Social:** FOLLOW, LIKE, COMMENT, COMMENT_REPLY, FRIEND_REQUEST, FRIEND_ACCEPTED, COMMUNITY_JOIN, COMMUNITY_INVITE, GIFT_RECEIVED, TIP_RECEIVED, NEW_SUBSCRIBER, MENTION, VOICE_ROOM_LIVE, LIVE_CLASS_START, COINS_PURCHASED  
**PK:** PK_INVITATION, PK_ACCEPTED, PK_STARTING, PK_RESULT, PK_ACHIEVEMENT, PK_MISSION, PK_TOURNAMENT, PK_SEASON

---

## API — `/api/v1/notifications`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Paginated inbox (`?unreadOnly=true`) |
| GET | `/unread-count` | Badge count |
| PUT | `/read-all` | Mark all read |
| PUT | `/:id/read` | Mark one read |

No socket event for new notifications — clients poll `unread-count`.

---

## Push Categories

```javascript
// push.js: getNotificationCategory(type)
'social'    → FOLLOW, LIKE, COMMENT, COMMENT_REPLY, FRIEND_REQUEST, FRIEND_ACCEPTED,
              COMMUNITY_JOIN, COMMUNITY_INVITE, GIFT_RECEIVED, TIP_RECEIVED,
              NEW_SUBSCRIBER, MENTION, VOICE_ROOM_LIVE
'education' → ATTENDANCE, GRADE, BEHAVIOR
'live'      → LIVE_CLASS_START, VOICE_ROOM_LIVE
'wallet'    → COINS_PURCHASED
'general'   → everything else
```

---

## Frontend

- **Web:** `frontend/src/app/(dashboard)/notifications/page.tsx`
- **Unread badge:** Updated via Socket.IO `social:notification` event in `useSocial.ts`

---

## Mobile

Push notifications received via FCM. Deep link data in `Notification.data` JSON field maps to:
- `liveClassId` → `halqa://live-class/{id}`
- `roomId` → `halqa://voice/{id}`
- `postId` → post detail
- etc.

---

## Known Gaps

- No real-time socket event for new notifications (polling only)
- `ALLOW_DM_NON_FRIENDS` flag mentioned in settings but notification delivery for DM is always triggered
- PK notification types exist in enum but PK admin UI is not documented
