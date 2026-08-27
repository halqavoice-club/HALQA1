# Live Class + Live Stream — Moderation & Control Audit

**Date:** August 22, 2026  
**Scope:** Backend (Express/Prisma), Database (MySQL/Prisma schema), Website (Next.js), React Native Mobile (Expo Router)

---

## Executive Summary

The moderation/control surface is well-built with multiple defence-in-depth layers. A number of historical security bugs have already been fixed (P0-01 through P0-05 series). What remains are **4 confirmed gaps** (one medium-severity, three low) and **3 design inconsistencies** worth hardening. No critical-severity issues were found.

---

## 1. Feature Coverage Matrix

| Control Action | Backend Route | Web Frontend | Mobile |
|---|---|---|---|
| Start class | `POST /:id/start` | ✅ HostControls | ✅ Controls tab |
| End class | `POST /:id/end` | ✅ HostControls | ✅ Controls tab |
| Kick participant | `DELETE /:id/participants/:userId` | ✅ ParticipantRow | ✅ ParticipantsModal |
| Mute single | `PATCH /:id/participants/:userId/mute` | ✅ ParticipantRow | ✅ ParticipantsModal |
| Mute all | `PATCH /:id/mute-all` | ✅ HostControls | ✅ Controls tab |
| Unmute all | `PATCH /:id/unmute-all` | ✅ HostControls | ✅ Controls tab |
| Toggle video state | `PATCH /:id/participants/:userId/video` | ✅ LiveClassRoomImpl | ✅ Camera button |
| Raise hand | `POST /:id/hand/raise` | ✅ | ✅ |
| Lower own hand | `POST /:id/hand/lower` | ✅ | ✅ |
| Lower all hands | `POST /:id/hand/lower-all` | ✅ HostControls | ✅ Controls tab |
| Approve hand (speak) | `POST /:id/hand/approve/:userId` | ✅ HostControls | ✅ HandQueueModal |
| Reject hand | `POST /:id/hand/reject/:userId` | ✅ HostControls | ✅ HandQueueModal |
| Toggle open mic | `POST /:id/open-mic` | ✅ HostControls | ✅ Controls tab |
| Start recording | `POST /:id/recording/start` | ✅ HostControls | ✅ Controls tab |
| Stop recording | `POST /:id/recording/stop` | ✅ HostControls | ✅ Controls tab |
| Broadcast whiteboard draw | `POST /:id/whiteboard` | ✅ LiveClassWhiteboard | ✅ LiveClassWhiteboard |
| Sync Quran position | `POST /:id/quran-position` | ✅ LiveClassQuranPanel | ✅ LiveClassQuranPanel |
| Create/vote/close poll | `POST /:id/poll` | ✅ LiveClassPoll | ✅ LiveClassPollPanel |
| Delete chat message | `DELETE /:id/messages/:messageId` | ✅ (host + own) | ✅ (long-press) |
| Toggle chat | `PATCH /:id` (chatEnabled) | ✅ HostControls | ✅ Controls tab |
| Toggle hand-raise feature | `PATCH /:id` (handRaiseEnabled) | ✅ HostControls | ✅ Controls tab |
| Toggle whiteboard | `PATCH /:id` (whiteboardEnabled) | ✅ HostControls | ✅ Controls tab |
| Toggle Quran panel | `PATCH /:id` (quranPanelEnabled) | ✅ HostControls | ✅ Controls tab |
| Toggle screen share permission | `PATCH /:id` (screenShareEnabled) | ✅ HostControls | ⚠️ UI only — not enforced at join |
| Switch view mode (video/audio) | Socket relay only | ✅ LiveClassRoomImpl | ✅ Controls tab |
| View hand queue | `GET /:id/hand/queue` | ✅ HostControls | ✅ Controls tab |
| View participants | `GET /:id/participants` | ✅ HostControls | ✅ ParticipantsModal |
| Attendance report | `GET /:id/attendance` | Staff only | ❌ Not exposed |
| Gift leaderboard | `GET /:id/gifts/leaderboard` | ✅ GiftEarningsWidget | ❌ Not exposed |
| Auto-end on duration | In-process `setTimeout` | — | — |

---

## 2. Security Architecture

### 2.1 Authentication Flow

Every route applies `authenticate` middleware (JWT verification). Socket connections verify the JWT on handshake and attach `socket.userId`, `socket.userSchoolId`, `socket.userRole` — these are **never overridable** from client payloads.

### 2.2 Authorization Layers (Defence in Depth)

Five independent checks must all pass for a moderation action:

```
Request
  │
  ├─ 1. authenticate()          — JWT required for every route
  │
  ├─ 2. resolveStreamAccess /   — Route-level:
  │     resolveStreamStaffAccess   PUBLIC: any auth user / host-only
  │                               SCHOOL: requireSchoolMember + requireSchoolRole
  │
  ├─ 3. assertSchoolAccess()    — Controller-level IDOR guard
  │                               Rejects lc.schoolId ≠ user.schoolId (P0-01 fix)
  │                               Auto-skips for PUBLIC streams
  │
  ├─ 4. liveclass:join_room     — Socket room guard
  │                               DB verifies active participant before socket join
  │                               (P0-04 RT-05 fix)
  │
  └─ 5. wasKicked check         — joinLiveClass returns 403 if wasKicked=true
                                  (Task 3 fix)
```

### 2.3 Socket Identity Enforcement

| Socket Event | Fix Applied | How |
|---|---|---|
| `liveclass:speaking` | ✅ | Uses `socket.userId` (JWT-verified), not payload |
| `liveclass:video_changed` | ✅ | Uses `socket.userId` (JWT-verified), not payload |
| `liveclass:reaction` | ✅ | Uses `socket.userId`; strips firstName/targetName from relay |
| `liveclass:viewmode_changed` | ✅ | Server re-verifies role = HOST in DB before relaying |

### 2.4 LiveKit SFU Enforcement

Kick is enforced at **two levels**:
1. DB: `wasKicked=true` → 403 on next `joinLiveClass`
2. SFU: `RoomServiceClient.removeParticipant()` immediately evicts from LiveKit room
3. Token TTL: 1h (reduced from 4h) limits the gap if SFU call fails

---

## 3. Identified Gaps

### GAP-01 — `muteAll` / `unmuteAll` miss the PUBLIC-stream host check (Medium)

**Location:** `backend/src/controllers/live-class.controller.js` → `muteAll()` / `unmuteAll()`

**Issue:** Both functions call `assertSchoolAccess(lc, req.user)` which **throws** for PUBLIC streams when a user who is not in the same school tries to mute (correct), but it does **not verify** that the caller is actually the stream's host. Any authenticated user who somehow passes school isolation can call mute-all on a school stream.

More importantly: for PUBLIC streams `assertSchoolAccess` is a no-op (it returns immediately when `lc.streamType === 'PUBLIC'`), meaning **any authenticated user can call `PATCH /live-classes/:id/mute-all` on a PUBLIC stream**. The route is gated by `resolveStreamStaffAccess` which checks `hostUserId === req.user.id` for PUBLIC streams — but that check happens in the route middleware, and the controller re-opens the door by not verifying it again.

Wait — the route uses `resolveStreamStaffAccess`, which **does** correctly enforce `hostUserId === req.user.id` for PUBLIC streams. So the route guard closes the gap for the mute-all routes. However, the controller itself contains no host-ownership check, meaning if the middleware is ever reordered or reused on a different route, the protection evaporates.

**Recommendation:** Add an explicit `assertHostAccess(lc, req.user)` check inside `muteAll` / `unmuteAll` / `lowerAllHands` controllers as defence-in-depth, matching what `kickParticipant` does with `assertSchoolAccess`.

---

### GAP-02 — `screen_share_started` / `screen_share_stopped` are client-relay-only socket events (Low)

**Location:** Mobile `mobile/app/live-class/[id].tsx`, Web `LiveClassRoomImpl.tsx`

**Issue:** Both clients emit `liveclass:screen_share_started` and `liveclass:screen_share_stopped` directly via socket. The server (`app.js`) has **no handler** for these events — they are not relayed server-side. There is no server validation that:
- The sender is an active participant in the room
- The sender is the host (or has `screenShareEnabled` permission)
- Rate limiting is applied

Any socket client can emit these events to any room name, potentially triggering the "Teacher is sharing their screen" notification on all clients in any room.

**Recommendation:** Add a `liveclass:screen_share_started` handler in `app.js` that verifies:
1. Active participant (`liveClassParticipant.isActive = true`)
2. Caller is host OR `screenShareEnabled = true` on the live class
3. Relay using `socket.userId`, not client identity
4. Add to socket rate limiter config

---

### GAP-03 — `screenShareEnabled` toggle is not enforced at the LiveKit token grant level (Low)

**Location:** `getLiveKitToken` in `live-class.controller.js`

**Issue:** The `getLiveKitToken` function always grants `canPublish: true` to all participants regardless of the `screenShareEnabled` setting on the live class. The LiveKit token's `canPublish` flag covers all track types (camera, mic, screen share). There is no separate `canPublishSources` restriction (a LiveKit v1.x feature that allows restricting to specific track types).

This means a student can start a screen share track in the LiveKit room even if `screenShareEnabled = false` — the DB toggle only affects the UI presentation and the unimplemented socket relay.

**Recommendation:** Either:
- Use `canPublishSources` in the `AccessToken` grant to restrict `[TrackSource.CAMERA, TrackSource.MICROPHONE]` when `screenShareEnabled = false`, or  
- Document that `screenShareEnabled` is currently a UI-only advisory (not cryptographically enforced at the SFU)

---

### GAP-04 — Auto-end timers are in-process only (Low / Operational)

**Location:** `live-class.controller.js` → `autoEndTimers` Map + `scheduleAutoEnd()`

**Issue:** Auto-end timers for duration-limited classes are stored in a `Map` in process memory. On server restart, crash, or horizontal scaling (multiple Node processes / Kubernetes pods), all pending timers are lost and classes with a set `duration` that have already started will never auto-end.

**Current mitigation:** The comment in the code acknowledges this and explicitly notes it. There is no silent failure — the class simply stays LIVE past its duration.

**Recommendation:** 
- Short-term: Add a startup recovery job in `app.js` that queries `live_classes WHERE status='LIVE' AND duration IS NOT NULL` and calls `scheduleAutoEnd` for each, recovering timers after restart
- Long-term: Replace with Redis-backed delayed job (Bull/BullMQ) for multi-process safety

---

## 4. Design Inconsistencies

### DI-01 — Attendance report not accessible on mobile

**Web** exposes attendance via the `GET /:id/attendance` endpoint (staff only) and it is surfaced in the admin dashboard. The **mobile app** (`Controls` tab) has no attendance access. For teachers who only use mobile, they cannot review class attendance.

---

### DI-02 — Poll voter identity normalisation inconsistency

**Backend** (`broadcastPoll`) correctly normalises vote events to use `req.user.id` as voter identity (SEC-07 fix). The **mobile** client (`handlePollEvent`) applies votes locally using `ev.userId` from the socket event — which is now server-normalized, so this is technically correct. However the mobile `handlePollEvent` handler directly mutates the `votes` array with the event's `userId` *before* the server echo comes back (optimistic update), while the server echo overwrites the same state. If the two events arrive out of order, a brief UI flicker can occur. Not a security issue; a UX one.

---

### DI-03 — Admin emergency-end HTTP method inconsistency

The frontend admin page references ending a live class via `PATCH /live-class/:id/end` (noted in the subagent audit). The actual backend route is `POST /:id/end`. If the admin page makes a `PATCH` call it will receive a `404` / method not allowed. This should be verified and corrected.

**Action:** Audit `frontend/src/app/(dashboard)/admin/live-voice/page.tsx` and confirm the HTTP method used.

---

## 5. Database Schema Assessment

The schema is comprehensive and well-normalised.

| Field | Verdict |
|---|---|
| `wasKicked BOOLEAN DEFAULT false` | ✅ Correct — session-scoped, never reset within session |
| `isActive BOOLEAN` | ✅ Correct — soft state, allows re-join if not kicked |
| `streamType VARCHAR(20) DEFAULT 'SCHOOL'` | ✅ Correct — stored as raw string not enum to avoid Prisma migration lock-in |
| `host_user_id` with `SET NULL` on delete | ✅ Correct — class record survives user deletion |
| `BANNED` in `users.status` enum | ✅ Added — but **no enforcement in `joinLiveClass`** — banned users can still join |
| `LiveClassHandQueue.status` enum | ✅ Clean state machine: WAITING → APPROVED / REJECTED / CANCELLED |
| `LiveClassAttendance.status` enum | ✅ Three-level PRESENT / PARTIAL / ABSENT with `MIN_PRESENT_MINUTES` threshold |
| No `bannedFromClass` model | ⚠️ Only session-scoped kick — no persistent ban per class or school |

**Missing enforcement:** The `BANNED` user status (migration 20260820) is never checked in `joinLiveClass`, `getLiveKitToken`, or `joinVoiceRoom`. A banned user can still join live sessions as long as their JWT is valid.

---

## 6. Frontend (Web) Assessment

`LiveClassRoomImpl.tsx` and `LiveClassHostControls.tsx` are well-structured.

**Strengths:**
- All socket events consumed match the server-emitted events exactly
- `liveclass:you_were_kicked` triggers immediate redirect for the kicked user
- `liveclass:open_mic_changed` correctly re-enables the LiveKit mic when enabled
- `liveclass:viewmode_changed` server-validated before relay (HOST-only)
- `liveclass:mute_all` / `unmute_all` applied locally for instant feedback
- Hand queue badge in host controls shows unread count
- Recording indicator (pulsing dot) shown to all participants
- Gift earnings widget embedded in host controls
- `ParticipantRow` expands to show contextual actions (approve/reject if hand raised; mute/kick otherwise)

**Issues:**
- `screenShareEnabled` DB toggle rendered in `LiveClassHostControls` → `onToggleSetting('screenShareEnabled')` calls `PATCH /:id` to update the DB, but the LiveKit token grant ignores it (GAP-03)
- No explicit handling of `liveclass:screen_share_started/stopped` on the web side (the mobile relays via socket emit but no server handler exists — GAP-02)

---

## 7. Mobile (React Native) Assessment

`mobile/app/live-class/[id].tsx` is feature-complete and matches the web implementation.

**Strengths:**
- `BackHandler` intercept correctly prevents silent leave on Android back press
- Platform capability probe before `setScreenShareEnabled` — clear error message in Expo Go vs native build
- LiveKit audio degrades gracefully when `useLiveKitAudio` hook is not connected
- `isJoined` gate prevents actions before API join completes
- Poll state loaded from Redis cache on join (LC-003 fix) — students see polls created before they joined
- Whiteboard state loaded from Redis cache on join
- `liveclass:you_were_kicked` triggers `router.back()` immediately
- `liveclass:ended` auto-navigates non-hosts away

**Issues:**
- Screen share socket events (`liveclass:screen_share_started/stopped`) are emitted directly from the client via `socket.emit` with no server relay handler — any connected socket can broadcast these to any room (GAP-02)
- `handleToggleCamera` notifies via `api.patch(...video...)` AND socket `emit('liveclass:video_changed')` — double notification; the socket relay in `app.js` already handles the server→room fanout from the API call, so the extra `socket.emit` causes duplicate `liveclass:video_changed` events to be received by room members
- Attendance tab not available for teachers (DI-01)

---

## 8. Socket Rate Limiting Coverage

| Event | Limit | Applied |
|---|---|---|
| `liveclass:reaction` | 10/2s | ✅ |
| `liveclass:speaking` | 30/5s | ✅ |
| `liveclass:video_changed` | 15/5s | ✅ |
| `liveclass:screen_share_started` | none | ⚠️ No handler at all |
| `liveclass:screen_share_stopped` | none | ⚠️ No handler at all |
| `liveclass:viewmode_changed` | none (DB check is implicit throttle) | ✅ acceptable |
| `liveclass:join_room` | none (DB check) | ✅ acceptable |

---

## 9. Recommended Actions (Priority Order)

| Priority | ID | Action | Effort | Status |
|---|---|---|---|---|
| High | SEC-BAN-01 | Check `user.status !== 'BANNED'` in `joinLiveClass` and `getLiveKitToken` | 30 min | ✅ Fixed |
| Medium | GAP-02 | Add `liveclass:screen_share_started/stopped` server relay with participant + permission check + rate limit | 2h | ✅ Fixed |
| Medium | DI-03 | Confirm and fix admin emergency-end HTTP method (PATCH → POST) and URL (/live-class → /live-classes) | 30 min | ✅ Fixed |
| Low | GAP-01 | Add `assertHostAccess` inside `muteAll`/`unmuteAll`/`lowerAllHands` as defence-in-depth | 30 min | ✅ Fixed |
| Low | GAP-03 | Enforce `screenShareEnabled` via `canPublishSources` in LiveKit token grant | 1h | ✅ Fixed |
| Low | GAP-04 | Add startup recovery for in-flight auto-end timers after server restart | 1h | ✅ Fixed |
| Low | MOB-DUP | Remove redundant `socket.emit('liveclass:video_changed')` in mobile `handleToggleCamera` | 15 min | ✅ Fixed |
| Low | DI-01 | Expose attendance view in mobile Controls tab for teachers | 2h | ✅ Fixed |
| Low | DI-02 | Add optimistic-update deduplication guard in poll vote handlers (mobile + web) | 30 min | ✅ Fixed |

---

## 10. What's Working Well

- **Dual-mode architecture (SCHOOL / PUBLIC)** is correctly isolated at every layer
- **P0-01 cross-school IDOR** is fixed in both route middleware and controller
- **P0-04 socket room gate** verifies DB participation before admitting to room
- **P0-05 server-side kick** removes participant from LiveKit SFU immediately
- **Session-scoped `wasKicked`** prevents immediate rejoin without persistent ban infrastructure
- **Socket identity spoofing** fixed for speaking, video, and reaction events
- **Host-only relay validation** for `liveclass:viewmode_changed` done server-side
- **Poll voter normalisation** prevents duplicate-vote bypass
- **Whiteboard snapshot size limit** (200KB) prevents Redis memory exhaustion
- **Gift school isolation** removes SUPER_ADMIN bypass
- **Rate limiting** covers all high-frequency socket events
