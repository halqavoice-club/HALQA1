# HALQA Realtime Architecture

**Audit date:** 2026-08-26  
**Status:** READ-ONLY documentation audit. No application code modified.

---

## System Overview

HALQA uses two realtime transports:

| Transport | Purpose | Auth |
|-----------|---------|------|
| **Socket.IO** | Presence, events, notifications, relay of client actions | JWT at connection time (`socket.handshake.auth.token`) |
| **LiveKit** | SFU audio/video tracks for Voice Club and Live Class | Per-session token from backend (`POST /voice/:id/livekit-token`, `POST /live-classes/:id/token`) |

These are independent systems. A user can be in a Socket.IO room without a LiveKit session, and can have a LiveKit session tracked independently of socket room membership.

---

## Socket.IO Server

**File:** `backend/src/app.js`  
**Transport:** WebSocket + polling fallback  
**Server:** `socket.io` Server attached to the Express `httpServer`

### Authentication Middleware

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

- JWT required at connection time — no unauthenticated sockets
- `socket.userId`, `socket.userRole`, `socket.userSchoolId` are set from the JWT and are immutable for the lifetime of the connection
- Client-supplied identity values in event payloads are **never trusted** for authorization

### Per-Socket Rate Limiter

Each socket connection gets its own in-memory sliding-window rate limiter. Limits are enforced before any event relay:

| Event | Limit |
|-------|-------|
| `voice:reaction` | 10 per 2s |
| `voice:join_room` | 5 per 10s |
| `liveclass:reaction` | 10 per 2s |
| `voice:speaking` | 30 per 5s |
| `liveclass:speaking` | 30 per 5s |
| `dm:typing_start` | 20 per 5s |
| `dm:typing_stop` | 20 per 5s |
| `voice:leave_room` | 10 per 5s |
| `liveclass:video_changed` | 15 per 5s |
| `liveclass:screen_share_started` | 5 per 10s |
| `liveclass:screen_share_stopped` | 5 per 10s |

Events that exceed the limit are silently dropped (no disconnect).

---

## Automatic Room Joins on Connection

Every authenticated socket automatically joins these rooms immediately on connect:

| Room | Who | Purpose |
|------|-----|---------|
| `user:{userId}` | All authenticated users | Personal targeted events (DMs, kicks, mic offers, notifications) |
| `voice:lobby` | All authenticated users | Voice room created/updated/deleted broadcasts for all users |
| `role:{userRole}` | All authenticated users | Role-specific broadcasts (e.g., `role:SUPER_ADMIN` for report alerts) |

---

## Socket.IO Room Taxonomy

Complete map of every room and its authorization gate:

| Room | Authorization gate | Content |
|------|-------------------|---------|
| `user:{userId}` | Auto — own userId only | Personal events |
| `voice:lobby` | Auto — all authenticated | Voice room lifecycle broadcasts |
| `role:{role}` | Auto — from JWT role | Role-specific broadcasts |
| `voice:{roomId}` | DB: active `VoiceParticipant.isActive` | Voice room events |
| `liveclass:{id}` | DB: active `LiveClassParticipant.isActive` | Live class events |
| `school:{schoolId}` | JWT: `socket.userSchoolId === schoolId` | School-scoped events |
| `class:{classId}` | DB: active `SchoolMembership` for class's school | Class-room events |
| `feed:{userId}` | Auto (own feed only) | Personal feed events |
| `feed:public` | Auto — all authenticated | Public feed events |
| `feed:school:{schoolId}` | JWT schoolId match — **SUPER_ADMIN BYPASS STILL PRESENT** | School-scoped feed |
| `wallet:{userId}` | Self-join (wallet:join event) | Wallet credit notifications |
| `pk:{pkMatchId}` | DB: active `PKParticipant` or LIVE/ENDED match | PK battle events |
| `community:{id}` | DB: active `CommunityMember` + not banned | Community events |
| `conversation:{convId}` | DB: active `GroupMember` | Group chat events |

---

## SUPER_ADMIN Socket Rooms — Complete Status

| Room | SUPER_ADMIN accesses | Status |
|------|---------------------|--------|
| `user:{userId}` | Own room only | ✅ Correct |
| `voice:lobby` | Global (all users) | ✅ Correct — read-only lobby |
| `role:SUPER_ADMIN` | Own role room | ✅ Correct — receives `admin:user_reported` alerts |
| `voice:{roomId}` | Only if active VoiceParticipant | ✅ Correct — no bypass |
| `liveclass:{id}` | Only if active LiveClassParticipant | ✅ Correct — no bypass |
| `school:{schoolId}` | Only if JWT schoolId matches | ✅ Correct — SA-FIX-10 |
| `class:{classId}` | Only if SchoolMembership active | ✅ Correct — SA-FIX-11 |
| `feed:school:{schoolId}` | **ANY school** | ⚠️ VIOLATION — SVSV-001 (legacy bypass) |
| `feed:public` | Auto | ✅ Same as all users |
| `community:{id}` | Only if CommunityMember | ✅ Correct — no bypass |
| `pk:{matchId}` | Only if participant or LIVE match | ✅ Correct |

---

## CORS Configuration

Socket.IO and HTTP CORS origin validation:
- Allowed origins from `CLIENT_URL` env var (comma-separated)
- Credentials: true
- WebSocket compression: `perMessageDeflate` with 1 KB threshold
