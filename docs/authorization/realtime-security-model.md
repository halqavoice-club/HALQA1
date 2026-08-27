# Realtime Security Model — Socket.IO and LiveKit

**Audit date:** 2026-08-26  
**Rule:** Read-only audit. No code modified.

---

## Defense Layers

### 1. JWT Authentication (Connection)

```javascript
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  const decoded = verifyAccessToken(token);
  socket.userId      = decoded.userId;
  socket.userRole    = decoded.role;
  socket.userSchoolId = decoded.schoolId ?? null;
  next();
});
```

- All sockets must authenticate with a valid JWT before any events are processed
- Identity fields are immutable for the socket's lifetime
- Client payloads CANNOT override `socket.userId` — every relay uses `socket.userId` (JWT-verified)

### 2. DB-Authoritative Room Membership

Socket room joins that grant access to private content require a database verification:

| Room type | DB check |
|-----------|---------|
| `voice:{roomId}` | `VoiceParticipant.isActive` |
| `liveclass:{id}` | `LiveClassParticipant.isActive` |
| `community:{id}` | `CommunityMember` (active) + ban check (Redis cache → DB fallback) |
| `class:{classId}` | `SchoolMembership` (active) for the class's school |
| `conversation:{convId}` | `GroupMember` (active) |
| `pk:{matchId}` | `PKParticipant` or LIVE/ENDED state |

**Fail-closed:** Any DB error during authorization prevents room access.

### 3. Server-Side Event Relay (Never Trust Client Identity)

Events where clients would benefit from spoofing their userId are intercepted and rewritten:

| Event | Problem prevented | How |
|-------|-----------------|-----|
| `liveclass:speaking` | User spoofing another's speaking state | Server uses `socket.userId` exclusively |
| `liveclass:video_changed` | User spoofing another's video state | Server uses `socket.userId` exclusively |
| `liveclass:reaction` | Display name spoofing | Server strips `firstName`/`targetName` from relay payload |
| `voice:speaking` | Speaking indicator spoofing | Server uses `socket.userId` exclusively |
| `group:typing_start` | Typing indicator spoofing | Server uses `socket.userId` exclusively |

### 4. Action Authorization via DB Role Re-Read

For events that change state, the server re-reads the role from DB — never from client-supplied values:

| Event | DB re-read |
|-------|-----------|
| `liveclass:viewmode_changed` | Fetches `LiveClassParticipant WHERE role='HOST'` — only HOST can change view mode |
| `liveclass:screen_share_started` | Fetches participant + checks `screenShareEnabled` — only HOST or enabled flag |

### 5. Rate Limiting

Per-socket sliding-window rate limiters prevent event flooding. See rates in `realtime-architecture.md`.

---

## Kicked User Re-Entry Prevention

### Voice Room
1. `VoiceParticipant.isActive = false` (DB)
2. LiveKit SFU removal via `RoomServiceClient.removeParticipant()`
3. Existing sockets force-leave the voice room: `io.in('user:X').fetchSockets().forEach(s => s.leave('voice:Y'))`
4. `voice:join_room` check: `isActive` must be `true` → refused
5. Token endpoint check: active participant required → 403
6. Token TTL: 1h (reduced from 8h) — any cached token expires within 1h

### Live Class
1. `LiveClassParticipant.isActive = false`, `wasKicked = true` (DB)
2. LiveKit SFU removal via `RoomServiceClient.removeParticipant()`
3. `liveclass:join_room` check: active participant required → refused
4. Token endpoint check: active participant required → 403
5. `joinLiveClass` join attempt: `wasKicked = true` → 403 "You have been removed from this class"

---

## Identity Spoofing Prevention

### What a Malicious Client Can Attempt

A malicious client controls:
- The payload of any socket event it emits
- The `socket.handshake.auth.token` field (but this must be a valid JWT)
- The LiveKit room connection if it has a token

### What the Server Prevents

| Attack vector | Prevention |
|-------------|-----------|
| Send `liveclass:speaking { userId: 'victim' }` | Server ignores client-supplied userId; uses `socket.userId` |
| Send `voice:speaking { userId: 'victim' }` | Server ignores client-supplied userId; uses `socket.userId` |
| Join `liveclass:X` without being a participant | DB check: `liveClassParticipant` with `isActive: true` required |
| Join `voice:X` after being kicked | `isActive = false` → join refused |
| Change view mode without being HOST | DB re-read: `role === 'HOST'` required |
| Start screen share without permission | DB re-read: HOST or `screenShareEnabled = true` required |
| Broadcast to school without membership | `socket.userSchoolId` must match (from JWT) |
| Join community after being banned | Redis ban cache + DB ban record checked |
| Get PK state before match starts | Match must be LIVE, ENDED, or PAUSED, OR user must be a participant |

---

## School Isolation in Realtime

### JWT-Based (No DB Query)
- `school:join` — `socket.userSchoolId` from JWT must match requested `schoolId`
- `feed:join:school` — same check (⚠️ SUPER_ADMIN bypass exists — SVSV-001)

### DB-Based
- `class:join` — `SchoolMembership.status = 'ACTIVE'` for the class's school (SA-FIX-11)
- `community:join` — `CommunityMember` record required (not school-scoped but membership-gated)

### Server-Side Emit Targeting (Broadcasting)
Controllers emit to school rooms by looking up `schoolId` from the DB record, never from client input:
- `liveclass:started` → `school:{lc.schoolId}` (from DB)
- `voice:room_created` → `school:{room.schoolId}` (from DB)
- `community:*` events → `community:{community.id}` (from DB)

---

## Community Socket Security (Detailed)

The community join flow is the most comprehensive example of fail-closed socket authorization:

```javascript
socket.on('community:join', async (communityId) => {
  // Step 1: Load from DB — never trust client-provided fields
  const community = await prisma.community.findUnique({ where: { id } });
  if (!community || community.deletedAt) {
    socket.emit('community:join_rejected', { reason: 'not_found' });
    return;
  }

  // Step 2: Ban check — Redis cache first, DB as source of truth
  // Redis miss ≠ unbanned — always verify DB if Redis says "not banned"
  isBanned = checkRedisCache() || await checkDB();
  if (isBanned) {
    socket.emit('community:join_rejected', { reason: 'banned' });
    return;
  }

  // Step 3: Membership check — required for all privacy types
  const membership = await prisma.communityMember.findUnique({ where: { communityId_userId } });

  // Step 4: PRIVATE/INVITE_ONLY requires membership
  if (privacy === 'PRIVATE' || privacy === 'INVITE_ONLY') {
    if (!membership) { return; /* rejected */ }
  }

  // Step 5: PUBLIC also requires membership for real-time room
  if (!membership) return; // non-member gets no real-time events

  // All checks passed
  socket.join(`community:${id}`);
});
```

---

## Voice Reaction Enforcement (`reactionsEnabled`)

```javascript
socket.on('voice:reaction', async ({ roomId, emoji }) => {
  // Check reactionsEnabled from Redis cache (set when room is created/updated)
  const cached = await getCache(`voice:room:${roomId}`);
  const enabled = cached ? cached.reactionsEnabled !== false : true;
  if (!enabled) return;  // silently drop — no relay
  socket.to(`voice:${roomId}`).emit('voice:reaction', { userId, emoji });
});
```

If `reactionsEnabled = false` on the room, emoji reactions are silently dropped at the server level — not just hidden in the UI.

---

## Presence and `voice:lobby`

The `voice:lobby` room is subscribed to by ALL authenticated users on connection. This means:
- Any authenticated user receives `voice:room_created`, `voice:room_updated`, `voice:room_deleted` events
- This is by design — the voice room list is public to all platform users (school isolation is room-level, not lobby-level)
- SUPER_ADMIN is in this room, same as everyone else — this is correct behavior

---

## Redis Role in Realtime Security

Redis is used as a cache, never as the authoritative source for security decisions:

| Use case | Redis role | Source of truth |
|---------|-----------|----------------|
| Room state (participants, status) | Cache (30s TTL) | `voice_rooms` DB table |
| Community ban | Cache (hot path optimization) | `community_bans` DB table |
| Speaker queue (FIFO) | Primary store (fast operations) | `voice_participants.handRaised` DB (fallback) |
| Auth user cache | Cache (30s TTL) | `users` DB table |
| School membership | Cache (30s TTL) | `school_memberships` DB table |

Redis failure is graceful: DB fallback is always used. Redis is never the only gate.
