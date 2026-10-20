# Live Stream — API Reference

**Audit date:** 2026-08-26  
**Note:** Live Streams share the same API as Live Classes at `/api/v1/live-classes`. The distinction is in the `streamType` field and the authorization layer.

---

## Endpoint Behavior for `streamType = 'PUBLIC'`

### `POST /api/v1/live-classes` — Create Public Stream

**Auth:** `authenticate` only (no school requirement)  
**Body:**
```json
{
  "streamType": "PUBLIC",
  "title": "Arabic Conversation Practice",
  "description": "Optional description",
  "duration": 60,
  "scheduledAt": "2026-08-27T10:00:00Z",
  "maxParticipants": 100,
  "chatEnabled": true,
  "handRaiseEnabled": true,
  "screenShareEnabled": true,
  "isRecorded": false,
  "isPublic": true
}
```

**Note:** `classId` is not required (and ignored) for PUBLIC streams.  
**On success:** Emits `liveclass:scheduled` to `feed:public` socket room.

---

### `GET /api/v1/live-classes` — List Streams

**Auth:** `authenticate`  
**Query params:**
- `streamType=PUBLIC` — returns only public streams
- `streamType=SCHOOL` — returns only school streams
- (none) — returns school streams for user's school + all PUBLIC streams

---

### `GET /api/v1/live-classes/:id` — Get One Stream

**Auth:** `authenticate` + `resolveStreamAccess`  
**PUBLIC behavior:** `resolveStreamAccess` passes through for PUBLIC — any authenticated user.

---

### `POST /api/v1/live-classes/:id/start` — Start Stream

**Auth:** `authenticate` + `resolveStreamStaffAccess`  
**PUBLIC behavior:** Only `hostUserId === req.user.id` passes.

---

### `POST /api/v1/live-classes/:id/join` — Join Stream

**Auth:** `authenticate` + `resolveStreamAccess` (passes for PUBLIC)  
**PUBLIC behavior:**
- No school membership check
- No enrollment check
- `wasKicked` check still applies
- Capacity check still applies
- Role: `isPublicHost = lc.hostUserId === userId` → HOST; else STUDENT
- ⚠️ LCSV-001: SUPER_ADMIN also gets HOST via `isTeacher`/`isStaff`

---

### `POST /api/v1/live-classes/:id/token` — Get LiveKit Token

**Auth:** `authenticate` + `resolveStreamAccess` (passes for PUBLIC)  
**PUBLIC behavior:** Requires active `LiveClassParticipant` record (same as school).

---

### `POST /api/v1/live-classes/:id/end` — End Stream

**Auth:** `authenticate` + `resolveStreamStaffAccess`  
**PUBLIC behavior:** Only `hostUserId === req.user.id`.  
**On success:** Emits `liveclass:ended` to `liveclass:{id}` and calls `broadcastLiveEnd()` for feed.

---

### `PATCH /api/v1/live-classes/:id` — Update Stream

**Auth:** `authenticate` + `resolveStreamStaffAccess`  
**PUBLIC behavior:** Only `hostUserId === req.user.id`.

---

### `DELETE /api/v1/live-classes/:id` — Delete Stream

**Auth:** `authenticate` + `resolveStreamStaffAccess`  
**PUBLIC behavior:** Only `hostUserId === req.user.id`. Cannot delete a LIVE stream.

---

### `POST /api/v1/live-classes/:id/gifts` — Send Gift

**Auth:** `authenticate` + `checkLiveClassSchool`  
**PUBLIC behavior:** `checkLiveClassSchool` returns `next()` immediately for PUBLIC — any authenticated user can send gifts.

---

### All Other Endpoints

All remaining endpoints (`/mute`, `/kick`, `/hand/*`, `/messages`, `/whiteboard`, `/poll`, `/recording`, etc.) behave identically to school live classes. The only difference is the authorization layer:

- **Staff operations** (`resolveStreamStaffAccess`): for PUBLIC → `hostUserId === req.user.id`
- **Participant operations** (`resolveStreamAccess`): for PUBLIC → any authenticated user

---

## Request/Response for Create (PUBLIC)

**Request:**
```http
POST /api/v1/live-classes
Authorization: Bearer <token>
Content-Type: application/json

{
  "streamType": "PUBLIC",
  "title": "My Live Stream",
  "duration": null,
  "maxParticipants": 500,
  "chatEnabled": true,
  "screenShareEnabled": true
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "streamType": "PUBLIC",
    "hostUserId": "creator-user-id",
    "schoolId": null,
    "classId": null,
    "teacherId": null,
    "title": "My Live Stream",
    "status": "SCHEDULED",
    "livekitRoomName": null,
    "isOpenMic": true,
    "screenShareEnabled": true,
    "maxParticipants": 500,
    "chatEnabled": true,
    "createdAt": "..."
  }
}
```

---

## Feed Events Triggered

| Action | Socket.IO event | Target room |
|--------|----------------|------------|
| Create PUBLIC stream | `liveclass:scheduled` | `feed:public` |
| Start stream | `liveclass:started` + `feed:live` | `feed:public` |
| End stream | `liveclass:ended` + `feed:live_ended` | `liveclass:{id}` + `feed:public` |
| Participant join | `liveclass:user_joined` | `liveclass:{id}` |

---

## Admin Endpoint (SUPER_ADMIN)

**`GET /api/v1/admin/stats/live-voice`** — Returns aggregate counts for all live classes including PUBLIC streams.

**No dedicated admin termination endpoint exists.** This is documented as a gap. See [gaps.md](./gaps.md).
