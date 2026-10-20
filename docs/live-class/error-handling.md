# Live Class — Error Handling Reference

**Audit date:** 2026-08-26

---

## HTTP Error Codes

### 400 Bad Request

| Cause | API | Message |
|-------|-----|---------|
| `classId` missing for SCHOOL stream | `POST /` | "classId is required for school live classes" |
| `duration` not a positive integer | `POST /`, `PATCH /:id` | Validator rejection |
| Title empty or > 100 chars | `POST /`, `PATCH /:id` | Validator rejection |
| Editing ENDED or CANCELLED class | `PATCH /:id` | "Cannot edit ended/cancelled class" |
| Deleting a LIVE class | `DELETE /:id` | "End the class before deleting" |
| Start: class already LIVE | `POST /:id/start` | "Class already live" |
| Start: class already ENDED | `POST /:id/start` | "Class already ended" |
| End: class is not LIVE | `POST /:id/end` | "Class is not live" |
| Join: class ENDED | `POST /:id/join` | "Class has already ended" |
| Join: class CANCELLED | `POST /:id/join` | "Class has been cancelled" |
| Join: SCHEDULED + non-HOST | `POST /:id/join` | "Class has not started yet" |

### 401 Unauthorized

| Cause | Message |
|-------|---------|
| No/invalid JWT | "Authentication required" |
| Expired token | "Token expired" |

### 403 Forbidden

| Cause | Message |
|-------|---------|
| Cross-school access (assertSchoolAccess) | "Access denied to this school's resource" |
| No school membership (resolveStreamAccess SCHOOL) | "You are not a member of this school" |
| Not enrolled in the class (SCHOOL + STUDENT) | "You are not enrolled in this class" |
| No Student profile | "Student profile not found" |
| wasKicked = true | "You have been removed from this class by the host" |
| Class full | "Class is full (max {n} participants)" |
| No active participant (token endpoint) | "Join the class first" |
| No active participant (socket room) | Silent refuse |
| Non-HOST for staff-only operations | Route middleware 403 |
| PUBLIC stream: not the host | "Only the host can perform this action" |
| SUPER_ADMIN without school membership | "You are not a member of this school" |

### 404 Not Found

| Cause | Message |
|-------|---------|
| Class ID not found or soft-deleted | "Live class not found" |
| Teacher not found (when `teacherId` explicitly supplied) | "Teacher not found" |
| Participant not found (kick/mute) | Standard 404 |

### 413 Payload Too Large

| Cause | Message |
|-------|---------|
| Whiteboard snapshot > 200,000 chars | "Whiteboard snapshot too large (max 200,000 characters)" |

### 422 Validation Error

| Cause |
|-------|
| Zod schema rejection (createLiveClassSchema, updateLiveClassSchema) |
| express-validator rejections |

### 429 Too Many Requests

| Endpoint | Limit |
|----------|-------|
| `POST /:id/gifts` | 30 requests per 10 seconds per user |
| `POST /:id/gifts/all` | 30 requests per 10 seconds per user |

### 503 Service Unavailable

| Cause | Message |
|-------|---------|
| `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` not set | "LiveKit not configured" or "LiveKit is not configured on this server" |

---

## LiveKit Errors

| Scenario | Behavior |
|----------|----------|
| LiveKit not configured (no env vars) | Token endpoint returns 503 |
| LiveKit connection refused during kick | DB kick still succeeds (best-effort) |
| `RoomServiceClient.removeParticipant` fails | Error logged, response still 200 |
| LiveKit SFU disconnects mid-session | Frontend reconnects via `connectLiveKitRef` → fresh token fetch |
| Token expired (1h TTL) | LiveKit disconnects → frontend fetches new token (if still active participant) |

---

## Socket.IO Errors

| Event | Scenario | Behavior |
|-------|----------|----------|
| `liveclass:join_room` | DB error | `logger.warn()` + silently refuses join |
| `liveclass:join_room` | Not active participant | Silently refuses |
| `liveclass:viewmode_changed` | Not HOST | Silently drops |
| `liveclass:screen_share_started` | Not participant | Silently drops |
| `liveclass:screen_share_started` | Not HOST + screenShareEnabled=false | Silently drops |
| Rate limit exceeded | Any rate-limited event | Silently drops |

---

## Frontend Error States

### Web (`LiveClassRoomImpl.tsx` / `LiveClassRoomWithBoundary.tsx`)

| State | Cause | UI |
|-------|-------|-----|
| Loading | Query pending | Skeleton/spinner |
| 404 | Class not found | "Class not found" message |
| 403 | Not authorized | Error message with reason |
| Error boundary caught | LiveKit/SDK runtime crash | Recovery UI with "Reconnect" and "Leave" buttons |
| Connection error | LiveKit disconnected | Auto-reconnect attempt |
| Kicked | `liveclass:you_were_kicked` socket | Toast + redirect to list |
| Class ended | `liveclass:ended` socket | Toast + redirect to list |

### Error Boundary (`LiveClassRoomWithBoundary.tsx`)

The error boundary wraps `LiveClassRoomPage` and catches React runtime errors:
- Shows a recovery UI with Radio icon
- "Reconnect" button resets boundary and re-mounts the class
- "Leave" button navigates to `/live-class`
- Error is logged to `console.error` (should go to Sentry in production)

### Mobile (`mobile/app/live-class/[id].tsx`)

| State | Behavior |
|-------|----------|
| Network error on join | `showMessage({ message, type: 'danger' })` + `setIsConnecting(false)` |
| Class ended | Toast + `router.back()` |
| Kicked | Toast + `router.back()` |
| Class not started yet | Warning toast, no join attempt |

---

## Network Reconnection

| Platform | Reconnect mechanism |
|----------|-------------------|
| Web | `connectLiveKitRef` fetches fresh token on reconnect |
| Mobile | `useLiveKitAudio` handles reconnect internally |
| Socket.IO | Socket.IO client auto-reconnects; `liveclass:join_room` must be re-emitted by the client after reconnect to rejoin the socket room |

---

## Audit/Logging

No audit log entries are currently written for live class operations. This is documented as a gap — see [gaps.md](./gaps.md).

Errors are logged via the `logger` utility at appropriate severity:
- `logger.warn()` for non-fatal errors (socket DB checks, notification failures)
- `logger.info()` for state transitions (class started, ended, auto-ended)
