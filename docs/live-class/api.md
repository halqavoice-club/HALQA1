# Live Class — API Endpoint Inventory

**Source:** `backend/src/routes/live-class.routes.js`, `backend/src/controllers/live-class.controller.js`  
**Mounted at:** `/api/v1/live-classes`  
**Base auth:** `authenticate` middleware applied to all routes

---

## Route Guard Helpers

### `resolveStreamAccess`
Determines access based on stream type:
- `PUBLIC` → passes through (any authenticated user)
- `SCHOOL` → applies `eduMember` (requireSchoolMember())

### `resolveStreamStaffAccess`
Determines staff-level access:
- `PUBLIC` → requires `hostUserId === req.user.id`
- `SCHOOL` → applies `eduStaff` (requireSchoolMember + requireSchoolRole('TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'))

### `checkLiveClassSchool`
Gift endpoint school isolation:
- `PUBLIC` → any authenticated user
- `SCHOOL` → user's schoolId must match class's schoolId (SUPER_ADMIN bypass removed — ARCH-02)

---

## Endpoints

### GET `/` — List Live Classes

| Field | Value |
|-------|-------|
| Auth | `authenticate` |
| Controller | `listLiveClasses` |
| Parameters | `?page`, `?limit` (max 100), `?classId`, `?status`, `?streamType` |
| DB | Raw SQL on `live_classes` + counts |
| Returns | Paginated list with participant counts |

Filtering:
- Default: school streams for user's school + all PUBLIC streams
- `streamType=PUBLIC` → public only
- `streamType=SCHOOL` → school only (requires school context)
- All counts and ordering by status then scheduledAt DESC

---

### GET `/:id` — Get One Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Controller | `getLiveClass` |
| DB | `live_classes`, `live_class_participants`, `live_class_messages` (count) |
| Returns | Full class object + active participants + message count |
| 403 | Cross-school access (assertSchoolAccess) |
| 404 | Class not found or soft-deleted |

---

### POST `/` — Create Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + conditional `eduStaff` (SCHOOL only) |
| Controller | `createLiveClass` |
| Validator | `createLiveClassSchema` (Zod) |
| Body | `title` (req), `streamType`, `classId`, `duration`, `maxParticipants`, `scheduledAt`, `teacherId`, `isPublic` |
| DB | `live_classes` CREATE (raw SQL), `teachers` (auto-create if admin has none) |
| Realtime | `liveclass:scheduled` → `school:{schoolId}` (SCHOOL) or `feed:public` (PUBLIC) |

**SCHOOL stream:**
- Requires `eduStaff` — school staff membership
- `classId` required
- Teacher auto-resolved from: caller's teacher record → explicit `teacherId` → lead teacher of class → fallback teacher in school → auto-created teacher profile

**PUBLIC stream:**
- Only `authenticate` required (any user)
- `hostUserId` = `req.user.id`
- `isOpenMic: true`, `screenShareEnabled: true` by default

---

### PATCH `/:id` — Update Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| Controller | `updateLiveClass` |
| Validator | `updateLiveClassSchema` (Zod) |
| Updatable fields | `title`, `description`, `scheduledAt`, `duration`, `chatEnabled`, `handRaiseEnabled`, `whiteboardEnabled`, `quranPanelEnabled`, `maxParticipants`, `isRecorded`, `isOpenMic`, `screenShareEnabled` |
| DB | Raw SQL UPDATE with column allowlist (P3-002) |
| Realtime | `liveclass:updated` → `liveclass:{id}` |
| 400 | ENDED or CANCELLED class cannot be edited |

---

### DELETE `/:id` — Delete Live Class (Soft)

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| Controller | `deleteLiveClass` |
| DB | `status = 'CANCELLED'`, `deletedAt = now()` (raw SQL) |
| 400 | Cannot delete a LIVE class |

---

### POST `/:id/start` — Start Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| Controller | `startLiveClass` |
| DB | `status = 'LIVE'`, `startedAt = now()`, `livekitRoomName = 'liveclass-{id}'` |
| Realtime | `liveclass:started` → `school:{schoolId}` + `class:{classId}` + `feed:public` (if PUBLIC) |
| Side effect | Schedules in-process auto-end timer if `duration` is set |
| Notifications | `_notifyStudentsLiveClassStart()` — fire-and-forget LIVE_CLASS_START push to enrolled students |

---

### POST `/:id/end` — End Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| Controller | `endLiveClass` |
| DB | `status = 'ENDED'`, `endedAt = now()`, all `LiveClassParticipant.isActive = false`, all `LiveClassAttendance.leftAt = now()` |
| Realtime | `liveclass:ended` → `liveclass:{id}` |
| Side effect | Cancels in-process auto-end timer |
| 400 | Class is not LIVE |

---

### POST `/:id/join` — Join Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Controller | `joinLiveClass` |
| DB | Upsert `LiveClassParticipant`, upsert `LiveClassAttendance` (SCHOOL + STUDENT) |
| Realtime | `liveclass:user_joined` → `liveclass:{id}`, `liveclass:started` if auto-start |

**SCHOOL stream — STUDENT path:**
1. `assertSchoolAccess` — schoolId must match
2. `student.findFirst` — Student profile must exist
3. `enrollment.findFirst` — Active enrollment in the class required
4. `wasKicked` check — 403 if previously kicked this session
5. Capacity check — `currentCount < maxParticipants`

**Role assignment** (⚠️ LCSV-001 violation present):
```javascript
const isTeacher = user.role === 'TEACHER' || user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'; // ← LCSV-001
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);                    // ← LCSV-001
const role      = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

**Auto-start:** If a HOST joins a SCHEDULED class, it auto-starts.

---

### POST `/:id/leave` — Leave Live Class

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Controller | `leaveLiveClass` |
| DB | `LiveClassParticipant.isActive = false`, `leftAt = now()`, `totalDuration += elapsed` |
| Realtime | `liveclass:user_left` → `liveclass:{id}` |

---

### POST `/:id/token` (alias: `/:id/livekit-token`) — Get LiveKit Token

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Controller | `getLiveKitToken` (in live-class.controller.js) |
| Requires | Active `LiveClassParticipant` record (`isActive: true`) |
| Token TTL | `1h` |
| Grants | `roomJoin`, `canPublish: true` (all), `canSubscribe`, `canPublishData`, `canUpdateOwnMetadata` |
| Screen share | `canPublishSources` restricted to `['camera','microphone']` for non-HOST when `screenShareEnabled=false` |
| Returns | `{ token, livekitUrl, roomName, role }` |
| 403 | No active participant record ("Join the class first") |
| 503 | LiveKit not configured |

---

### GET `/:id/participants` — Get Participant List

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Returns | All active participants with user info and roles |

---

### PATCH `/:id/participants/:userId/mute` — Mute Participant

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| Body | `{ muted?: boolean }` |
| DB | `LiveClassParticipant.isMuted = muted` |
| Realtime | `liveclass:mute_changed` → `liveclass:{id}` |

---

### PATCH `/:id/participants/:userId/video` — Set Video State

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamAccess` |
| Body | `{ isVideoOn: boolean }` (required) |
| Note | ⚠️ LCSV-003: SUPER_ADMIN can set any participant's video state |
| DB | `LiveClassParticipant.isVideoOn = isVideoOn` |
| Realtime | `liveclass:video_changed` → `liveclass:{id}` |

---

### PATCH `/:id/mute-all` — Mute All

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` + `assertHostAccess` |
| DB | `LiveClassParticipant.isMuted = true` for all non-HOST |
| Realtime | `liveclass:mute_all` → `liveclass:{id}` |

---

### PATCH `/:id/unmute-all` — Unmute All

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` + `assertHostAccess` |
| Realtime | `liveclass:unmute_all` → `liveclass:{id}` |

---

### DELETE `/:id/participants/:userId` — Kick Participant

| Field | Value |
|-------|-------|
| Auth | `authenticate` + `resolveStreamStaffAccess` |
| DB | `isActive=false`, `wasKicked=true` |
| Realtime | `liveclass:kicked` → `liveclass:{id}` + `liveclass:you_were_kicked` → `user:{kicked}` |
| LiveKit | `RoomServiceClient.removeParticipant()` — force-removes from SFU (P0-05 fix) |
| Note | LiveKit failure is best-effort — DB state is authoritative |

---

### Hand Raise Endpoints

| Method | Path | Auth | Action | Realtime |
|--------|------|------|--------|---------|
| POST | `/:id/hand/raise` | resolveStreamAccess | Set handRaised=true, status=WAITING | `liveclass:hand_raised` |
| POST | `/:id/hand/lower` | resolveStreamAccess | Set handRaised=false | `liveclass:hand_lowered` |
| POST | `/:id/hand/lower-all` | resolveStreamStaffAccess + assertHostAccess | Set all hands=false | `liveclass:all_hands_lowered` |
| GET | `/:id/hand/queue` | resolveStreamAccess | List WAITING hands | — |
| POST | `/:id/hand/approve/:userId` | resolveStreamStaffAccess | Set approved + unmute | `liveclass:hand_approved` + `liveclass:you_can_speak` → user |
| POST | `/:id/hand/reject/:userId` | resolveStreamStaffAccess | Set rejected | `liveclass:hand_rejected` |

---

### Chat Endpoints

| Method | Path | Auth | Action |
|--------|------|------|--------|
| GET | `/:id/messages` | resolveStreamAccess | Paginated message history |
| POST | `/:id/messages` | resolveStreamAccess | Send message (participant or teacher/admin — LCSV-002 present) |
| DELETE | `/:id/messages/:messageId` | resolveStreamAccess | Soft-delete (author or HOST — LCSV-002 present) |

---

### Teaching Feature Endpoints

| Method | Path | Auth | Action | Realtime |
|--------|------|------|--------|---------|
| GET | `/:id/whiteboard/state` | resolveStreamAccess | Get persisted whiteboard state | — |
| POST | `/:id/whiteboard` | resolveStreamStaffAccess | Broadcast draw event | `liveclass:draw` → room |
| POST | `/:id/poll` | resolveStreamStaffAccess | Broadcast poll event | `liveclass:poll` → room |
| GET | `/:id/poll/state` | resolveStreamAccess | Get current poll state | — |
| POST | `/:id/quran-position` | resolveStreamStaffAccess | Broadcast Quran position | `liveclass:quran_position` → room |
| POST | `/:id/speak-request` | resolveStreamAccess | Student requests to speak | `liveclass:speak_request` → room |
| POST | `/:id/open-mic` | resolveStreamStaffAccess | Toggle open mic mode | `liveclass:open_mic_changed` → room |

---

### Recording Endpoints

| Method | Path | Auth | Action | Realtime |
|--------|------|------|--------|---------|
| POST | `/:id/recording/start` | resolveStreamStaffAccess | Set `recordingStartedAt`, `isRecorded=true` | `liveclass:recording_started` → room |
| POST | `/:id/recording/stop` | resolveStreamStaffAccess | Set `recordingUrl` | `liveclass:recording_stopped` → room |

---

### Attendance

| Method | Path | Auth | Action |
|--------|------|------|--------|
| GET | `/:id/attendance` | resolveStreamStaffAccess | List attendance records for the session |

---

### Gift Endpoints

| Method | Path | Auth | Action |
|--------|------|------|--------|
| POST | `/:id/gifts` | `authenticate` + `checkLiveClassSchool` + rateLimit (30/10s) | Send gift to one recipient |
| POST | `/:id/gifts/all` | `authenticate` + `checkLiveClassSchool` + rateLimit | Send gift to all active HOSTs |
| GET | `/:id/gifts/leaderboard` | `authenticate` + `checkLiveClassSchool` | Top gifters in session |
| GET | `/:id/gifts/history` | `authenticate` + `checkLiveClassSchool` | Gift transaction history |
| GET | `/:id/gifts/top-supporters` | `authenticate` + `checkLiveClassSchool` | Top 3 supporters |

---

### Cover Image

| Method | Path | Auth | Action |
|--------|------|------|--------|
| POST | `/:id/cover` | resolveStreamStaffAccess | Upload cover image (2MB max, images only, magic byte validated) |
