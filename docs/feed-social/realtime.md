# Feed + Social — Realtime (Socket.IO)

**Source:** `backend/src/app.js`, `backend/src/controllers/post.controller.js`, `frontend/src/hooks/useSocial.ts`  
**Audit date:** 2026-08-26

---

## Socket.IO Room Taxonomy for Feed/Social

| Room | Who joins | When joined |
|------|-----------|------------|
| `feed:public` | All authenticated users | On `feed:join` event |
| `feed:{userId}` | Own personal room | On `feed:join` event |
| `feed:school:{schoolId}` | Users matching JWT schoolId | On `feed:join:school` event |
| `community:{id}` | Active community members (DB-verified) | On `community:join` event |

---

## Client → Server Join Events

### `feed:join` / `feed:leave`

```javascript
socket.on('feed:join', () => {
  if (userId) socket.join(`feed:${userId}`);
  socket.join('feed:public');
});

socket.on('feed:leave', () => {
  if (userId) socket.leave(`feed:${userId}`);
  socket.leave('feed:public');
});
```

No authorization check — any authenticated user joins these rooms.

### `feed:join:school` — ⚠️ SVSV-001 VIOLATION

```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  if (!schoolId) return;
  // SUPER_ADMIN global bypass (legacy)  ← VIOLATION
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);
    return;
  }
  // Normal users: JWT schoolId must match
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

**SUPER_ADMIN can join any school's feed room** via this legacy bypass. See [gaps.md](./gaps.md).

---

## Server → Client Events

### Post Events (from `post.controller.js`)

| Event | Target room | Payload | When |
|-------|------------|---------|------|
| `post:create` | `feed:public` or `feed:school:{id}` or `community:{id}` | `{ post: fullPost }` | On `createPost` (non-draft, non-PRIVATE) |
| `post:update` | `feed:public` | `{ post: updatedPost }` | On `updatePost` |
| `post:delete` | `feed:public` | `{ postId }` | On `deletePost` |
| `post:like` | `feed:public` | `{ postId, userId, type, action }` | On `reactToPost` |

**Routing rules for `post:create`:**
- Community post (PRIVATE/INVITE_ONLY community) → `community:{communityId}` only
- Community post (PUBLIC community) → `community:{communityId}` + `feed:public` (if PUBLIC/FOLLOWERS visibility)
- Regular PUBLIC/FOLLOWERS post → `feed:public`
- SCHOOL_ONLY post → `feed:school:{schoolId}`
- PRIVATE post → not broadcast (no socket emit)

### Live Card Events (from `feedLive.js`)

| Event | Target room | Payload | When |
|-------|------------|---------|------|
| `feed:live` | `feed:public` + `feed:school:{schoolId}` | full `liveCard` object | Voice room or live class goes LIVE |
| `feed:live_ended` | `feed:public` | `{ refEntityType, refEntityId, postId }` | Session ends |
| `feed:live_update` | `feed:public` | `{ refEntityType, refEntityId, participantCount }` | Participant count changes |

### Social Events (from `social.controller.js`)

| Event | Target room | Payload | When |
|-------|------------|---------|------|
| `social:followed` | `user:{followedId}` | `{ followerId, firstName, lastName }` | On follow |
| `social:friend_request` | `user:{receiverId}` | `{ senderId, firstName, lastName }` | On friend request sent |
| `social:request_accepted` | `user:{senderId}` | `{ acceptorId, firstName, lastName }` | On friend request accepted |

### Community Events (from `community.controller.js`)

| Event | Target room | Payload |
|-------|------------|---------|
| `community:updated` | `community:{id}` | `{ community }` |
| `community:deleted` | `community:{id}` | `{ communityId }` |
| `community:member_joined` | `community:{id}` | `{ communityId, user }` |
| `community:member_left` | `community:{id}` | `{ communityId, userId }` |
| `community:member_role_changed` | `community:{id}` | `{ communityId, userId, role }` |
| `community:member_kicked` | `community:{id}` + `user:{kicked}` | `{ communityId, userId }` |
| `community:banned` | `user:{banned}` | `{ communityId, reason }` |
| `community:join_request` | `user:{ownerId}` | `{ communityId, requestId }` |
| `community:join_accepted` | `user:{userId}` | `{ communityId, communityName }` |
| `community:join_declined` | `user:{userId}` | `{ communityId, communityName }` |
| `community:invite` | `user:{invitedUserId}` | `{ communityId, communityName, ... }` |

---

## Frontend Social Socket Hook

File: `frontend/src/hooks/useSocial.ts`

```typescript
export function useSocialSocket() {
  // Mounted once in the dashboard layout
  const socket = getSocket()
  
  socket.on('social:followed',        handler)  // someone followed me
  socket.on('social:friend_request',  handler)  // incoming friend request
  socket.on('social:request_accepted', handler) // my request was accepted
  socket.on('social:notification',    handler)  // general social notification
}
```

Also subscribes to `feed:live`, `feed:live_ended`, `feed:live_update` for the live session section of the feed.

---

## Community Socket Authorization

The `community:join` socket event uses a multi-step DB authorization:

```javascript
socket.on('community:join', async (communityId) => {
  // Step 1: Load community from DB (never trust client fields)
  const community = await prisma.community.findUnique({ where: { id } });
  if (!community || community.deletedAt) → emit 'community:join_rejected' { reason: 'not_found' }

  // Step 2: Ban check — Redis cache first, then DB
  if (isBanned) → emit 'community:join_rejected' { reason: 'banned' }

  // Step 3: Membership check
  const membership = await prisma.communityMember.findUnique();

  // Step 4: PRIVATE/INVITE_ONLY requires membership
  if (!membership) → emit 'community:join_rejected' { reason: 'membership_required' }

  // Step 5: PUBLIC also requires membership for real-time subscription
  if (!membership) → return silently (no real-time access)

  socket.join(`community:${id}`);
});
```

SUPER_ADMIN has no bypass in the `community:join` handler.
