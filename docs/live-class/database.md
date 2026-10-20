# Live Class — Database Models

**Source:** `backend/prisma/schema.prisma`  
**Audit date:** 2026-08-26  
**Rule:** Read-only audit. No code modified.

---

## Model 1 — `LiveClass` (`live_classes`)

**Purpose:** Central live session record. Covers both SCHOOL and PUBLIC stream types.

### Fields

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | String (UUID) | No | uuid() | Primary key |
| `streamType` | String | No | `'SCHOOL'` | `'SCHOOL'` or `'PUBLIC'`. Stored as `stream_type` column |
| `schoolId` | String | Yes | — | FK → `schools.id`. Null for PUBLIC streams |
| `classId` | String | Yes | — | FK → `classes.id`. Null for PUBLIC streams |
| `teacherId` | String | Yes | — | FK → `teachers.id`. Null for PUBLIC streams |
| `hostUserId` | String | Yes | — | FK → `users.id`. Used for PUBLIC streams; also set for SCHOOL streams for consistency. Stored as `host_user_id` |
| `title` | String | No | — | Required, max 100 chars (validator) |
| `description` | String (Text) | Yes | — | Max 500 chars (validator) |
| `scheduledAt` | DateTime | Yes | — | When the class is scheduled to start |
| `duration` | Int | Yes | — | Planned duration in minutes. Null = unlimited |
| `status` | `LiveClassStatus` | No | `SCHEDULED` | State machine — see lifecycle.md |
| `livekitRoomName` | String | Yes | — | Set on class start: `'liveclass-{id}'` |
| `recordingUrl` | String | Yes | — | Set when recording is stopped |
| `coverImageUrl` | String | Yes | — | Uploaded cover image URL |
| `maxParticipants` | Int | No | 100 | Capacity cap (1–1000) |
| `isRecorded` | Boolean | No | false | Whether recording is enabled |
| `recordingStartedAt` | DateTime | Yes | — | When recording started |
| `chatEnabled` | Boolean | No | true | Room feature flag |
| `handRaiseEnabled` | Boolean | No | true | Room feature flag |
| `whiteboardEnabled` | Boolean | No | true | Room feature flag |
| `quranPanelEnabled` | Boolean | No | false | Room feature flag |
| `isOpenMic` | Boolean | No | false | If true, all participants join unmuted |
| `screenShareEnabled` | Boolean | No | true | SFU-level enforcement when false |
| `startedAt` | DateTime | Yes | — | Actual start timestamp |
| `endedAt` | DateTime | Yes | — | Actual end timestamp |
| `deletedAt` | DateTime | Yes | — | Soft delete |
| `createdAt` | DateTime | No | now() | |
| `updatedAt` | DateTime | No | updatedAt | |

### Enums

```
LiveClassStatus: SCHEDULED | LIVE | ENDED | CANCELLED
LiveClassParticipantRole: HOST | STUDENT | OBSERVER
LiveClassMessageType: TEXT | SYSTEM | POLL | QUESTION
LiveClassHandStatus: WAITING | APPROVED | REJECTED | CANCELLED
LiveClassAttendanceStatus: PRESENT | PARTIAL | ABSENT
```

### Relations

| Relation | Type | Target |
|----------|------|--------|
| `school` | Many-to-one | `School` (onDelete: Cascade) |
| `class` | Many-to-one | `Class` (onDelete: Cascade) |
| `teacher` | Many-to-one | `Teacher` (onDelete: Cascade) |
| `hostUser` | Many-to-one | `User` via "LiveClassHost" (onDelete: SetNull) |
| `participants` | One-to-many | `LiveClassParticipant[]` |
| `messages` | One-to-many | `LiveClassMessage[]` |
| `handQueue` | One-to-many | `LiveClassHandQueue[]` |
| `attendance` | One-to-many | `LiveClassAttendance[]` |

### Indexes

```
@@index([streamType])
@@index([schoolId])
@@index([classId])
@@index([teacherId])
@@index([hostUserId])
@@index([status])
@@index([scheduledAt])
```

### CRUD Authorization

| Operation | Who | Via |
|-----------|-----|-----|
| CREATE (SCHOOL) | TEACHER / SCHOOL_ADMIN (school membership) | `POST /live-classes` + `eduStaff` |
| CREATE (PUBLIC) | Any authenticated user | `POST /live-classes` + `authenticate` only |
| READ | School members (SCHOOL) / Any auth user (PUBLIC) | `GET /live-classes/:id` + `resolveStreamAccess` |
| UPDATE | HOST of stream | `PATCH /live-classes/:id` + `resolveStreamStaffAccess` |
| DELETE (soft) | HOST of stream | `DELETE /live-classes/:id` + `resolveStreamStaffAccess` |
| READ (admin) | SUPER_ADMIN | `GET /admin/stats/live-voice` (aggregate counts only) |

**Sensitive fields:** None (metadata only)  
**Audit:** No audit log currently written for live class mutations (gap)

---

## Model 2 — `LiveClassParticipant` (`live_class_participants`)

**Purpose:** Tracks every user who has joined a live class, their role, audio/video state, and kick status.

### Fields

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | String (UUID) | No | uuid() | |
| `liveClassId` | String | No | — | FK → `live_classes.id` (onDelete: Cascade) |
| `userId` | String | No | — | FK → `users.id` (onDelete: Cascade) |
| `role` | `LiveClassParticipantRole` | No | `STUDENT` | HOST or STUDENT (OBSERVER unused) |
| `isMuted` | Boolean | No | true | Mic mute state — frontend-enforced only |
| `isVideoOn` | Boolean | No | false | Camera state |
| `handRaised` | Boolean | No | false | Hand raised for speaking |
| `handRaisedAt` | DateTime | Yes | — | When hand was raised |
| `joinedAt` | DateTime | No | now() | Most recent join time |
| `leftAt` | DateTime | Yes | — | Most recent leave time |
| `totalDuration` | Int | No | 0 | Cumulative time in seconds |
| `isActive` | Boolean | No | true | Currently in the room |
| `wasKicked` | Boolean | No | false | Prevents rejoin in same session |
| `createdAt` | DateTime | No | now() | |
| `updatedAt` | DateTime | No | updatedAt | |

### Constraints

```
@@unique([liveClassId, userId])
@@index([liveClassId])
@@index([userId])
@@index([isActive])
```

### wasKicked Flag

Added in migration `20260816_add_was_kicked_to_live_class_participants`.

- Set to `true` when a HOST kicks a participant
- Prevents the participant from calling `POST /live-classes/:id/join` in the same session
- Never reset within the same `LiveClass` session
- Only cleared by the creation of a new `LiveClass` (fresh records)

### Role Assignment (⚠️ Contains SUPER_ADMIN violation)

```javascript
// live-class.controller.js: joinLiveClass()
const isTeacher = user.role === 'TEACHER' || user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'; // ← LCSV-001
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole); // ← LCSV-001
const isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId;
const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

See [gaps.md](./gaps.md) — LCSV-001.

---

## Model 3 — `LiveClassMessage` (`live_class_messages`)

**Purpose:** Chat messages within a live class session.

### Fields

| Field | Type | Nullable | Default |
|-------|------|----------|---------|
| `id` | String (UUID) | No | uuid() |
| `liveClassId` | String | No | — |
| `userId` | String | No | — |
| `body` | String (Text) | No | — |
| `type` | `LiveClassMessageType` | No | `TEXT` |
| `deletedAt` | DateTime | Yes | — |
| `createdAt` | DateTime | No | now() |

### CRUD Authorization

| Operation | Who |
|-----------|-----|
| CREATE | Active participant OR teacher/admin (role check in controller — LCSV-002) |
| READ | School members (SCHOOL) / Any auth user (PUBLIC) |
| DELETE (soft) | Message author OR HOST role |

---

## Model 4 — `LiveClassHandQueue` (`live_class_hand_queue`)

**Purpose:** Tracks hand-raise requests in the queue.

### Fields

| Field | Type | Nullable | Default |
|-------|------|----------|---------|
| `id` | String (UUID) | No | uuid() |
| `liveClassId` | String | No | — |
| `userId` | String | No | — |
| `raisedAt` | DateTime | No | now() |
| `status` | `LiveClassHandStatus` | No | `WAITING` |
| `createdAt` | DateTime | No | now() |

```
@@unique([liveClassId, userId])
@@index([liveClassId])
```

---

## Model 5 — `LiveClassAttendance` (`live_class_attendance`)

**Purpose:** Formal attendance record per student per session. Distinct from the `LiveClassParticipant` record.

### Fields

| Field | Type | Nullable | Default |
|-------|------|----------|---------|
| `id` | String (UUID) | No | uuid() |
| `liveClassId` | String | No | — |
| `studentId` | String | No | — |
| `joinedAt` | DateTime | No | now() |
| `leftAt` | DateTime | Yes | — |
| `totalMinutes` | Int | No | 0 |
| `status` | `LiveClassAttendanceStatus` | No | `PRESENT` |
| `createdAt` | DateTime | No | now() |
| `updatedAt` | DateTime | No | updatedAt |

```
@@unique([liveClassId, studentId])
@@index([liveClassId])
@@index([studentId])
```

**Attendance Status Logic:**
- `PRESENT` — joined and spent ≥ 10 minutes (MIN_PRESENT_MINUTES constant)
- `PARTIAL` — joined but spent < 10 minutes
- `ABSENT` — never joined (not created in this case)

---

## Supporting Models (Indirect)

| Model | Role in Live Class |
|-------|-------------------|
| `User` | All participants, hosts, teachers |
| `School` | School isolation key — `lc.schoolId` |
| `Class` | Enrollment source — required for SCHOOL streams |
| `Student` | Profile required for SCHOOL stream join |
| `Enrollment` | Gate for SCHOOL stream student join |
| `Teacher` | Associated teacher record |
| `GiftTransaction` | Gifts sent in the room (`roomType='live_class'`) |
| `RoomGiftLeaderboard` | Per-session gift totals |
| `Notification` | `LIVE_CLASS_START` type push notifications |

---

## Raw SQL Usage

The live class controller extensively uses `prisma.$queryRawUnsafe` to work around Prisma client binary staleness after schema migrations. All dynamic values are bound as parameterized `?` placeholders — never string-interpolated into SQL.

Key raw SQL operations:
- `rawFindLiveClass(id)` — loads a single class by ID
- `rawCreateLiveClass(data)` — creates with explicit column bindings
- `rawUpdateLiveClassStatus(id, data)` — targeted status/timestamp updates
- `listLiveClasses()` — builds WHERE clause from hardcoded literals + parameterized `?`

The `updateLiveClass` function uses a column **allowlist** to prevent SQL injection via user-supplied field names:
```javascript
const allowed = ['title','description','scheduledAt','duration','chatEnabled',
  'handRaiseEnabled','whiteboardEnabled','quranPanelEnabled','maxParticipants',
  'isRecorded','isOpenMic','screenShareEnabled'];
```
(P3-002 verified in tests)
