# Live Stream — Architecture and Overview

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation audit. No application code modified.

---

## Architectural Position

A Live Stream is **not a separate system**. It is a `LiveClass` record where `stream_type = 'PUBLIC'`.

```
live_classes table
├── stream_type = 'SCHOOL'  →  School Live Class (school-isolated, enrollment required)
└── stream_type = 'PUBLIC'  →  Public Live Stream (open to any authenticated user)
```

Every Live Stream uses:
- The same `live_classes` DB table
- The same API routes at `/api/v1/live-classes/*`
- The same `live-class.controller.js`
- The same Socket.IO events (`liveclass:*`)
- The same LiveKit token endpoint
- The same frontend room UI (`LiveClassRoomImpl.tsx`)
- The same mobile screen (`mobile/app/live-class/[id].tsx`)

The only meaningful differences are at the **authorization layer** and **feature defaults**.

---

## Schema Additions (Migration `20260819_add_public_livestream`)

The migration added these columns to `live_classes`:

| Column | Type | Purpose |
|--------|------|---------|
| `stream_type` | VARCHAR(20) DEFAULT 'SCHOOL' | Distinguishes stream type |
| `host_user_id` | VARCHAR(191) NULL | FK → `users.id`. The creator's userId for PUBLIC streams |

And made these columns nullable (previously required):
- `schoolId` — null for PUBLIC streams
- `classId` — null for PUBLIC streams
- `teacherId` — null for PUBLIC streams

All existing rows retained `stream_type = 'SCHOOL'` (fully backward-compatible).

---

## PUBLIC vs SCHOOL: Feature Comparison

| Feature | PUBLIC Stream | SCHOOL Stream |
|---------|--------------|---------------|
| `schoolId` | null | required |
| `classId` | null | required |
| `teacherId` | null | required |
| `hostUserId` | = `req.user.id` (creator) | = creator userId (for consistency) |
| Access | Any authenticated user | Active school members |
| Student enrollment check | None | Yes (active Enrollment required) |
| Attendance tracking | No `LiveClassAttendance` created | Yes |
| Default `isOpenMic` | `true` | `false` |
| Default `screenShareEnabled` | `true` | `true` |
| Quran panel | Optional | Optional |
| Whiteboard | Optional | Optional |
| Feed card | `LIVE_CLASS_SHARE` (PUBLIC visibility) | `LIVE_CLASS_SHARE` (SCHOOL_ONLY visibility) |
| Gift sending | Any authenticated user | Same-school users only |

---

## Creation Flow

```
Any authenticated user
  ↓
POST /api/v1/live-classes
  { streamType: 'PUBLIC', title: '...', ... }
  ↓
Route middleware: authenticate only (no eduStaff for PUBLIC)
  ↓
createLiveClass():
  resolvedStreamType === 'PUBLIC'
  ├── hostUserId = req.user.id
  ├── schoolId   = null
  ├── classId    = null
  ├── teacherId  = null
  ├── isOpenMic  = true
  ├── screenShareEnabled = true
  ├── status     = 'SCHEDULED'
  └── rawCreateLiveClass(data)
  ↓
Optional: POST /live-classes/:id/cover  (cover image upload)
  ↓
Realtime: io.to('feed:public').emit('liveclass:scheduled', { liveClass })
  ↓
broadcastLiveStart() → upserts LIVE_CLASS_SHARE post in DB
                      → io.to('feed:public').emit('feed:live', liveCard)
```

---

## Join Flow (Viewer)

```
Any authenticated user → POST /live-classes/:id/join
  ↓
resolveStreamAccess: stream_type = 'PUBLIC' → passes through (no school check)
  ↓
joinLiveClass():
  ├── assertSchoolAccess: streamType === 'PUBLIC' → returns immediately (no check)
  ├── wasKicked check (prevents kicked viewers from rejoining)
  ├── capacity check (currentCount < maxParticipants)
  ├── Role assignment:
  │     isPublicHost = lc.hostUserId === userId
  │     role = isPublicHost ? 'HOST' : 'STUDENT'
  │     ⚠️ Also: isTeacher/isStaff includes SUPER_ADMIN (LCSV-001 violation)
  ├── upsert LiveClassParticipant { role, isMuted: !isOpenMic, isActive: true }
  └── Auto-start if HOST joins SCHEDULED stream
  ↓
Response: { participant, liveClass } — includes LiveKit token details
```

---

## Host Identity

For PUBLIC streams the host is identified by `lc.hostUserId`, not a `Teacher` record.

**Rule:** `hostUserId === req.user.id` grants HOST role on join.

This means any authenticated user (including `MEMBER` role users with no school) can:
1. Create a public live stream
2. Join it and receive HOST role
3. Get a LiveKit token
4. Have full host controls in the UI

**Frontend host detection:**
```typescript
// LiveClassRoomImpl.tsx
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
// SUPER_ADMIN deliberately excluded ← correct
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
// A MEMBER who created a public stream correctly gets isHost=true
```

**Mobile host detection:**
```typescript
// mobile/app/live-class/[id].tsx
const isTeacher = ['TEACHER','SCHOOL_ADMIN'].includes(user?.role || '');
// SUPER_ADMIN excluded ← correct
const isHost = user?.id === liveClass?.host?.id || isTeacher;
```

---

## Feed Integration

When a public live stream starts, `broadcastLiveStart()` in `feedLive.js` creates a social feed card:

```javascript
broadcastLiveStart({
  refEntityType:    'live_class',
  refEntityId:      lc.id,
  authorId:         req.user.id,
  title:            lc.title,
  description:      lc.description,
  schoolId:         null,           // PUBLIC → no school
  participantCount: 0,
})
```

This:
1. Upserts a `Post` with `type = 'LIVE_CLASS_SHARE'`, `visibility = 'PUBLIC'`
2. Emits `feed:live` to the `feed:public` Socket.IO room → all connected clients see the card
3. When stream ends, emits `feed:live_ended` to update/remove the card

---

## Lifecycle (PUBLIC Streams)

Same as School Live Class. See [docs/live-class/lifecycle.md](../live-class/lifecycle.md).

Key differences:
- `liveclass:started` emits to `feed:public` instead of `school:{schoolId}`
- `liveclass:scheduled` emits to `feed:public`
- No attendance records created for PUBLIC streams
- `broadcastLiveStart()` creates a `PUBLIC` visibility feed post

---

## SUPER_ADMIN and Live Streams

```
SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY
SUPER_ADMIN MUST NOT become a live stream participant.
```

| Scenario | Expected | Current | Violation |
|----------|---------|---------|-----------|
| SUPER_ADMIN creates a public stream (personal action) | HOST (as creator) | HOST ✅ | None |
| SUPER_ADMIN joins stream they created | HOST | HOST ✅ | None |
| SUPER_ADMIN joins someone else's PUBLIC stream | STUDENT | HOST ⚠️ | LCSV-001 |
| SUPER_ADMIN views live stream list (admin) | ALLOWED | ALLOWED ✅ | None |
| SUPER_ADMIN terminate stream (admin) | MISSING | MISSING ❌ | LC-ADMIN-001 |

LCSV-001 root cause: `joinLiveClass()` includes `'SUPER_ADMIN'` in `isTeacher`/`isStaff` checks, granting HOST to any SUPER_ADMIN who joins any PUBLIC stream regardless of whether they created it.

See [gaps.md](./gaps.md).

---

## Deployment Notes

Public live streams require the same infrastructure as school live classes:
- LiveKit (for audio/video)
- Socket.IO (for realtime events)
- Redis (for feed/whiteboard state — soft dependency)
- Push notifications (LIVE_CLASS_START type — if classId is null, student notifications are skipped)

No additional infrastructure is required beyond what school live classes already need.
