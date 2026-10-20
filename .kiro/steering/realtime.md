---
inclusion: fileMatch
fileMatchPattern: "**/{sockets,hooks}/**,**/*socket*,**/*livekit*,**/*voice*,**/*live-class*,**/*live_class*,**/*useLiveKit*,**/*useLiveKitAudio*"
description: Socket.IO patterns, LiveKit token structure, event naming, reconnect policy, rate limits
---

# Realtime Architecture Rules

> See `structure.md` Key Architecture Rule 4 for the transport order rule (polling → websocket).
> See `security.md` for SUPER_ADMIN socket room boundaries.

Two independent transports:
- **Socket.IO** — presence, events, notifications, relay. Auth: JWT at connect time.
- **LiveKit** — SFU audio/video tracks. Auth: per-session token from backend.

A LiveKit room connection **never grants application authorization**. The backend remains authoritative for all role decisions.

---

## Socket.IO Authentication

JWT required at connection time via `socket.handshake.auth.token`. After successful verification, three fields are set on the socket and are **immutable for the lifetime of the connection**:

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

- Client-supplied identity values in event payloads are **never trusted** for authorization.
- Transport order: `['polling', 'websocket']` — polling must be listed first. Starting with `websocket` only is prohibited.

---

## Automatic Room Joins on Connect

Every authenticated socket automatically joins these three rooms:

| Room | Who | Purpose |
|------|-----|---------|
| `user:{userId}` | All users | Personal targeted events (DMs, kicks, mic offers, notifications) |
| `voice:lobby` | All users | Voice room lifecycle broadcasts |
| `role:{userRole}` | All users | Role-specific broadcasts (e.g., `role:SUPER_ADMIN` for report alerts) |

---

## Socket.IO Room Taxonomy (14 Rooms)

| Room | Authorization Gate |
|------|--------------------|
| `user:{userId}` | Auto — own userId only |
| `voice:lobby` | Auto — all authenticated users |
| `role:{role}` | Auto — from JWT role |
| `voice:{roomId}` | DB: active `VoiceParticipant.isActive` |
| `liveclass:{id}` | DB: active `LiveClassParticipant.isActive` |
| `school:{schoolId}` | JWT: `socket.userSchoolId === schoolId` |
| `class:{classId}` | DB: active `SchoolMembership` for class's school |
| `feed:{userId}` | Auto — own feed only |
| `feed:public` | Auto — all authenticated users |
| `feed:school:{schoolId}` | JWT schoolId match — **no SUPER_ADMIN bypass** (SVSV-001 removed, Sprint 1) |
| `wallet:{userId}` | Self-join via `wallet:join` event |
| `pk:{pkMatchId}` | DB: active `PKParticipant` or LIVE/ENDED match state |
| `community:{id}` | DB: active `CommunityMember` + not banned |
| `conversation:{convId}` | DB: active `GroupMember` |

---

## Per-Socket Rate Limits

Each socket gets its own in-memory sliding-window limiter. Events exceeding limits are silently dropped (no disconnect).

| Event | Limit |
|-------|-------|
| `voice:reaction` | 10 / 2s |
| `voice:join_room` | 5 / 10s |
| `liveclass:reaction` | 10 / 2s |
| `voice:speaking` | 30 / 5s |
| `liveclass:speaking` | 30 / 5s |
| `dm:typing_start` | 20 / 5s |
| `dm:typing_stop` | 20 / 5s |
| `voice:leave_room` | 10 / 5s |
| `liveclass:video_changed` | 15 / 5s |
| `liveclass:screen_share_started` | 5 / 10s |
| `liveclass:screen_share_stopped` | 5 / 10s |

---

## Event Naming Conventions

| Namespace prefix | Domain |
|-----------------|--------|
| `voice:` | Voice Club events |
| `liveclass:` | Live Class events |
| `dm:` | Direct messages |
| `group:` | Group chat |
| `community:` | Community events |
| `feed:` | Social feed |
| `wallet:` | Wallet / coin credits |
| `gift:` | Gift sending / animations |
| `admin:` | Admin alerts |
| `pk:` | PK battle events |

Directional convention:
- `C→S` — client emits, server receives (e.g., `voice:join_room`)
- `S→C` — server emits to `user:{userId}` personal room (e.g., `wallet:coins_credited`)
- `S→room` — server emits to a named room (e.g., `voice:reaction` to `voice:{roomId}`)

---

## LiveKit Token — Voice Club

**Endpoint:** `POST /api/v1/voice/:id/livekit-token`  
**Prerequisite:** Active `VoiceParticipant` DB record (checked server-side before token issuance)

```javascript
// Grant structure
{
  roomJoin: true,
  room: roomName,           // LiveKit room identifier
  canPublish: true,         // All participants — see note below
  canSubscribe: true,
  canPublishData: true,
  canUpdateOwnMetadata: true,
}
// TTL: 1 hour
// micEnabled field: advisory only — NOT a LiveKit grant (client-side mic control)
```

**Why all participants get `canPublish: true`:** Role changes (HOST/MODERATOR/SPEAKER/AUDIENCE) arrive via `voice:role_changed` Socket.IO events. The frontend calls `setMicrophoneEnabled(false/true)` without token reissue. Issuing `canPublish: false` for non-speakers would require a full token reissue + 1–2 second reconnect gap on every role change.

---

## LiveKit Token — Live Class

**Endpoint:** `POST /api/v1/live-classes/:id/token`  
**Prerequisite:** Active `LiveClassParticipant` DB record

```javascript
// Grant structure (same as Voice Club, plus screen share restriction)
{
  roomJoin: true,
  room: roomName,
  canPublish: true,         // All participants
  canSubscribe: true,
  canPublishData: true,
  canUpdateOwnMetadata: true,
  // Screen share: restricted at SFU level via canPublishSources
  // when screenShareEnabled=false AND role !== HOST
}
// TTL: 1 hour
```

Role-based mic control arrives via `liveclass:you_can_speak` / `liveclass:mute` Socket.IO events — no token reissue required.

---

## Voice Club Reconnect Policy

| Parameter | Value |
|-----------|-------|
| Max attempts | 5 |
| Initial backoff | 1.5s (exponential) |
| No reconnect on | `CLIENT_INITIATED`, `ROOM_DELETED`, `PARTICIPANT_REMOVED` |
| Token refresh | 55 min (proactive, 5 min before TTL expiry) |

---

## Realtime Reconnect Model

Every important realtime flow must account for: duplicate events, delayed events, out-of-order events, lost events, reconnects, backgrounding/foregrounding, network changes, server restarts, duplicate joins, stale auth.

```
Authenticate
  ↓
Reconnect
  ↓
Identify last known state / sequence
  ↓
Recover missed events
  ↓
Deduplicate
  ↓
Reconcile authoritative server state
  ↓
Resume realtime
```

Socket.IO delivery alone does **not** guarantee business-state correctness. Clients must be able to reconcile against authoritative server state.

---

## Cross-References

- Transport order rule → `structure.md` Key Architecture Rule 4
- SUPER_ADMIN socket boundaries → `security.md` INV-009
- Full room taxonomy source → `docs/authorization/realtime-architecture.md`
- LiveKit token details → `docs/authorization/livekit-architecture.md`
- Complete event catalog → `docs/authorization/realtime-event-catalog.md`
