# Group Chat

**Source:** `backend/src/routes/groupChat.routes.js`, `backend/src/controllers/groupChat.controller.js`  
**Mounted at:** `/api/v1/group-chat`  
**Audit date:** 2026-08-26

---

## Database Models

### `GroupConversation` (`group_conversations`)

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `schoolId?` | Optional school context |
| `classId?` | Optional class context |
| `name` | Required, max 100 |
| `description?` | Max 500 |
| `avatarUrl?` | |
| `privacy` | PUBLIC / PRIVATE / SCHOOL_ONLY / CLASS_ONLY |
| `maxMembers` | Default 100 |
| `isMuted` | When true, only admins can send |
| `slowMode` | 1 message per 5s per user |
| `memberCount` | Denormalized |
| `messageCount` | Denormalized |
| `lastMessage?` | Last message preview |
| `lastMessageAt?` | For sorting |
| `createdBy` | Creator userId |
| `deletedAt?` | Soft delete |

### `GroupMember` (`group_members`)

| Field | Notes |
|-------|-------|
| `conversationId` | FK → `group_conversations.id` |
| `userId` | FK → `users.id` |
| `role` | OWNER / ADMIN / MODERATOR / MEMBER |
| `isMuted` | Personal mute setting |
| `joinedAt` | |
| `leftAt?` | |
| `unreadCount` | |
| `lastReadAt?` | |
| `deletedAt?` | |

```
@@unique([conversationId, userId])
@@index([conversationId])
@@index([userId])
@@index([role])
```

### `GroupMessage` (`group_messages`)

| Field | Notes |
|-------|-------|
| `conversationId` | FK |
| `senderId` | FK → `users.id` |
| `type` | TEXT / IMAGE / VIDEO / AUDIO / DOCUMENT / POLL / SYSTEM |
| `body?` | Max 4000 chars |
| `mediaUrl?` | |
| `mimeType?` | |
| `fileSize?` | |
| `replyToId?` | FK → `group_messages.id` — message replies |
| `isPinned` | |
| `pinnedAt?` | |
| `pinnedBy?` | userId |
| `deletedBy?` | JSON array of userIds who deleted |
| `deletedAt?` | Global delete (admin/mod) |

### `GroupMessageReaction` (`group_message_reactions`)

```
@@unique([messageId, userId])
```

### `GroupMessageRead` (`group_message_reads`)

```
@@unique([messageId, userId])
```

---

## Group Chat Roles

| Role | Privileges |
|------|-----------|
| `OWNER` | Full control — delete group, manage all members |
| `ADMIN` | Add/remove members, pin messages, kick |
| `MODERATOR` | Delete messages, kick members |
| `MEMBER` | Send messages, react |

---

## Privacy Modes

| Privacy | Access |
|---------|--------|
| `PUBLIC` | Anyone can join |
| `PRIVATE` | Invite-only |
| `SCHOOL_ONLY` | School members only |
| `CLASS_ONLY` | Class members only |

---

## API Endpoints

### Conversations

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/conversations` | ✅ | Create a new group conversation |
| GET | `/conversations` | ✅ | List user's conversations |
| GET | `/conversations/:id` | ✅ | Get conversation details |

### Members

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/conversations/:conversationId/members` | ✅ | Add a member |
| DELETE | `/conversations/:conversationId/members/:userId` | ✅ | Remove a member |

### Messages

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|-----------|-------|
| POST | `/conversations/:conversationId/messages` | ✅ | 60/min | Send message (content filter applied) |
| GET | `/conversations/:conversationId/messages` | ✅ | — | Get messages (`?before=ISO&limit=100`) |
| DELETE | `/messages/:messageId` | ✅ | — | Delete message |
| POST | `/conversations/:conversationId/messages/:messageId/pin` | ✅ | — | Pin/unpin a message |

### Interactions

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/messages/:messageId/reactions` | ✅ | Add/toggle reaction |
| POST | `/conversations/:conversationId/read` | ✅ | Mark messages as read |

---

## Socket.IO Integration

Group chat joins the `conversation:{convId}` socket room after DB membership verification:

```javascript
socket.on('group:join', async (convId) => {
  const member = await prisma.groupMember.findFirst({
    where: { conversationId: convId, userId, isActive: true }
  });
  if (!member) return; // silently reject
  socket.join(`conversation:${convId}`);
});
```

### Events

| Event | Direction | Notes |
|-------|-----------|-------|
| `group:join` | C→S | DB-verified membership |
| `group:leave` | C→S | Leave socket room |
| `group:typing_start` | C→S relay | Rate-limited; server uses `socket.userId` |
| `group:typing_stop` | C→S relay | Same |

New messages are emitted to `conversation:{convId}` by the controller after DB write.

---

## Authorization Rules

1. Users must be active `GroupMember` to send messages
2. Socket room join requires active `GroupMember` in DB
3. Message deletion: author can delete their own; ADMIN/MODERATOR can delete any
4. Pinning requires OWNER/ADMIN role
5. `GROUP_ONLY` and `CLASS_ONLY` privacy — membership enforced at join time

---

## Content Filter

Group chat messages pass through `filterMiddleware('body', 'group-chat')` before DB write.
