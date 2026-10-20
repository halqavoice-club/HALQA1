# Direct Messages (DM)

**Source:** `backend/src/routes/dm.routes.js`, `backend/src/controllers/dm.controller.js`  
**Mounted at:** `/api/v1/dm`  
**Audit date:** 2026-08-26

---

## Database Models

### `DmConversation` (`dm_conversations`)

**Purpose:** Container for a 1:1 private conversation between two users.

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `userAId` | FK → `users.id` — canonical ordering: userAId < userBId (alphabetical) |
| `userBId` | FK → `users.id` |
| `lastMessage` | Snapshot of last message text (for conversation list) |
| `lastMessageAt` | For sorting |
| `lastSenderId` | For "you: ..." prefix in list |
| `unreadA` | Unread count for userA |
| `unreadB` | Unread count for userB |

```
@@unique([userAId, userBId])
@@index([userAId])
@@index([userBId])
@@index([lastMessageAt])
```

The canonical ordering (smaller userId first) prevents duplicate conversations. `getOrStartConversation()` sorts the two userIds before looking up or creating.

### `DirectMessage` (`direct_messages`)

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `conversationId` | FK → `dm_conversations.id` |
| `senderId` | FK → `users.id` |
| `receiverId` | FK → `users.id` |
| `body` | Text |
| `status` | SENT / DELIVERED / READ |
| `deliveredAt` | |
| `readAt` | |
| `deletedBySender` | Soft-delete for sender |
| `deletedByReceiver` | Soft-delete for receiver |
| `storyId?` | FK → `stories.id` — story reply context |

```
@@index([conversationId])
@@index([senderId])
@@index([receiverId])
@@index([conversationId, createdAt])   // cursor pagination
@@index([receiverId, status, createdAt])
@@index([storyId])
```

---

## API Endpoints

| Method | Path | Auth | Controller | Notes |
|--------|------|------|-----------|-------|
| GET | `/unread-count` | ✅ | `getUnreadCount` | Total unread message count across all conversations |
| GET | `/conversations` | ✅ | `getConversations` | List all conversations sorted by `lastMessageAt DESC` |
| GET | `/conversations/:userId/with` | ✅ | `getOrStartConversation` | Get or create conversation with a specific user |
| GET | `/conversations/:convId/messages` | ✅ | `getMessages` | Cursor-paginated message history (`?before=ISO&limit=50`) |
| POST | `/conversations/:convId/messages` | ✅ | `sendMessage` | Send a message (60/min rate limit) |
| PATCH | `/conversations/:convId/read` | ✅ | `markRead` | Mark conversation as read (resets unread count) |
| DELETE | `/messages/:msgId` | ✅ | `deleteMessage` | Soft-delete for sender (hides from sender view) |

---

## Authorization

All DM operations require only `authenticate`. The controllers enforce:

- `getConversations`: returns only conversations where `userAId = req.user.id OR userBId = req.user.id`
- `getMessages`: verifies the requesting user is a participant in the conversation before returning messages
- `sendMessage`: verifies the requesting user is a participant
- `deleteMessage`: `deletedBySender = true` if sender deletes; `deletedByReceiver = true` if receiver deletes

**Blocked users:** If user A has blocked user B, `sendMessage` from B to A should be blocked (implementation depends on the block check in `dm.controller.js`).

---

## Realtime

### Delivery Flow

```
Sender → POST /dm/conversations/:convId/messages
  └─ sendMessage():
     ├─ Creates DirectMessage record
     ├─ Updates DmConversation.lastMessage, lastMessageAt, unreadB (or unreadA)
     ├─ Emit: dm:message → user:{receiverId}
     │    { convId, message: { ...msg, sender: { id, firstName, lastName, avatarUrl } } }
     ├─ If receiver is online (has sockets):
     │    status = 'DELIVERED', deliveredAt = now
     │    Emit: dm:delivered → user:{senderId}
     │    { convId, messageIds: [msg.id] }
     └─ Return created message
```

### Read Receipt

```
PATCH /dm/conversations/:convId/read
  └─ markRead():
     ├─ Update unread count to 0 for this user
     ├─ Update message statuses to READ
     └─ Emit: dm:read → user:{otherUserId}
          { convId, readBy: meId, readAt: now }
```

### Typing Indicators

Handled by Socket.IO relay (no DB write):

```javascript
// Client → Server
socket.emit('dm:typing_start', { convId, receiverId })
socket.emit('dm:typing_stop',  { convId, receiverId })

// Server → Client (relayed to receiver)
socket.on('dm:typing_start', ...) → io.to(`user:${receiverId}`).emit('dm:typing_start', { convId, userId })
socket.on('dm:typing_stop',  ...) → io.to(`user:${receiverId}`).emit('dm:typing_stop',  { convId, userId })
```

Rate limited: 20 per 5 seconds per socket.

---

## Story Replies

When a user replies to a story via DM (`POST /dm/conversations/:convId/messages` with `storyId`):
- `DirectMessage.storyId` is set
- The DM is shown with a story preview above the message
- Creates a `StoryReaction`-like notification to the story author

---

## DM Access Control

There is no admin endpoint to read private DMs. No SUPER_ADMIN endpoint reads DM conversations. Private messages remain private.

Even for legal/compliance purposes, accessing private DMs would require out-of-band mechanisms (direct DB access with appropriate authorization) not implemented in the application.

---

## Pagination

Messages use cursor pagination via `?before=ISO8601timestamp`. Fetches messages older than the cursor. Default limit: 50. Maximum limit: 100.
