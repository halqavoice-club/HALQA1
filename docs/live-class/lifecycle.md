# Live Class — Room Lifecycle

**Source:** `backend/src/controllers/live-class.controller.js`, `backend/src/app.js`  
**Audit date:** 2026-08-26

---

## States

The `LiveClass.status` field follows the `LiveClassStatus` enum:

```
LiveClassStatus: SCHEDULED | LIVE | ENDED | CANCELLED
```

---

## State Machine

```
[SCHEDULED]──────────────────────────────────→[CANCELLED]
     │                                              (delete before start)
     │  start() or auto-start on HOST join
     ↓
  [LIVE]──────────────────────────────────────→[ENDED]
     │  end() or duration auto-end cron               (manual or automatic)
     │
     └──(HOST re-joins IDLE? no — LIVE stays LIVE until explicit end)
```

No state can be reversed. ENDED and CANCELLED are terminal.

---

## Transition Details

### `SCHEDULED → LIVE`

**Trigger A: Manual start by HOST**
```
HOST → POST /live-classes/:id/start
  └─ resolveStreamStaffAccess
  └─ startLiveClass():
     ├─ status = 'LIVE'
     ├─ startedAt = now()
     ├─ livekitRoomName = 'liveclass-{id}'
     ├─ Emit: liveclass:started → school:{schoolId} + class:{classId} + feed:public
     ├─ broadcastLiveStart() → social feed card
     ├─ _notifyStudentsLiveClassStart() — fire-and-forget push notifications
     └─ scheduleAutoEnd(id, now, duration) if duration set
```

**Trigger B: Auto-start on HOST join**
```
HOST → POST /live-classes/:id/join (when status = 'SCHEDULED')
  └─ joinLiveClass():
     ├─ isHost = true
     ├─ lc.status === 'SCHEDULED'
     ├─ rawUpdateLiveClassStatus: status='LIVE', startedAt, livekitRoomName
     ├─ Emit: liveclass:started → school + class + feed:public rooms
     └─ _notifyStudentsLiveClassStart() + scheduleAutoEnd()
```

**Trigger C: Schedule reminder cron** (every minute)
- When `scheduledAt` time passes and the teacher hasn't joined, the cron sends reminder notifications to the teacher (once per class session, tracked in a `_sentReminders` Set).
- Does NOT auto-start the class — teacher must initiate.

---

### `LIVE → ENDED`

**Trigger A: Manual end by HOST**
```
HOST → POST /live-classes/:id/end
  └─ resolveStreamStaffAccess
  └─ endLiveClass():
     ├─ cancelAutoEnd(id)
     ├─ status = 'ENDED', endedAt = now()
     ├─ All LiveClassParticipant: isActive=false, leftAt, totalDuration+=elapsed
     ├─ All LiveClassAttendance: leftAt, totalMinutes, status (PRESENT/PARTIAL per 10min threshold)
     ├─ Emit: liveclass:ended → liveclass:{id}
     └─ broadcastLiveEnd('live_class', id)
```

**Trigger B: Duration auto-end cron** (every minute)
```
Cron: 'live-class-duration-auto-end' (every minute)
  └─ Raw SQL: SELECT LIVE classes WHERE (startedAt + duration minutes) < now
  └─ For each overdue class:
     ├─ _endLiveClassById(lc)  ← same logic as manual end
     └─ Emit: liveclass:ended { liveClassId, reason: 'duration_exceeded' }
```

The cron runs regardless of Redis availability (registered in both Redis-available and Redis-fallback paths).

**Trigger C: In-process timer** (`scheduleAutoEnd`)
- A `setTimeout` is set when a class starts with a duration
- Calls `_endLiveClassById()` on expiry
- Lost on server restart → recovered by startup scan on `app.listen`

**Startup recovery:**
```javascript
setImmediate(async () => {
  const activeDurationClasses = await prisma.$queryRaw`
    SELECT id, startedAt, duration FROM live_classes
    WHERE status = 'LIVE' AND deletedAt IS NULL
      AND startedAt IS NOT NULL AND duration IS NOT NULL
      AND DATE_ADD(startedAt, INTERVAL duration MINUTE) > NOW()
  `;
  for (const lc of activeDurationClasses) {
    scheduleAutoEnd(lc.id, lc.startedAt, lc.duration);
  }
});
```

---

### `SCHEDULED → CANCELLED`

**Trigger: Soft-delete by HOST**
```
HOST → DELETE /live-classes/:id
  └─ resolveStreamStaffAccess
  └─ deleteLiveClass():
     ├─ 400 if status = 'LIVE'
     └─ status = 'CANCELLED', deletedAt = now()
```

---

## Scheduling

### Schedule Reminder Cron

- **Name:** `live-class-schedule-reminder`
- **Schedule:** Every minute (`* * * * *`)
- **Logic:**
  1. Find SCHEDULED classes where `scheduledAt <= now` and class not in `_sentReminders` Set
  2. Send push notification to teacher: "Your class is starting now!"
  3. Send push notification to enrolled students: "{teacherName} is starting class now"
  4. Add class ID to `_sentReminders` to prevent re-sending
- **Does NOT auto-start** — teacher must click join/start

### Duration Auto-End Cron

- **Name:** `live-class-duration-auto-end`
- **Schedule:** Every minute (`* * * * *`)
- **SQL:**
```sql
SELECT id, schoolId, classId, startedAt, duration FROM live_classes
WHERE status = 'LIVE'
  AND deletedAt IS NULL
  AND startedAt IS NOT NULL
  AND duration IS NOT NULL
  AND DATE_ADD(startedAt, INTERVAL duration MINUTE) < NOW()
```
- **On match:** Ends the class exactly as if HOST called POST /:id/end
- Runs in both Redis-available and no-Redis modes

### Attendance Status Threshold

`MIN_PRESENT_MINUTES = 10`

- `totalMinutes >= 10` → `PRESENT`
- `totalMinutes < 10` → `PARTIAL`
- Applied consistently by both manual end, auto-end cron, and leaveLiveClass

---

## LiveKit Room Name

Format: `liveclass-{liveClassId}`

Set in `livekitRoomName` column when the class transitions to LIVE.
Used by:
- `getLiveKitToken()` — room name in the token grant
- `kickParticipant()` — `RoomServiceClient.removeParticipant(livekitRoomName, userId)`
- Generic `/livekit/token` endpoint — detects `liveclass-*` prefix for participant validation

---

## Capacity Enforcement

`maxParticipants` (default 100, max 1000) is checked on JOIN only:

```javascript
const currentCount = await prisma.liveClassParticipant.count({
  where: { liveClassId: lc.id, isActive: true }
});
if (currentCount >= lc.maxParticipants) return 403;
```

Not re-checked after join. If capacity decreases via settings update, currently active participants are not ejected.

---

## wasKicked Lifecycle

```
kickParticipant():
  └─ LiveClassParticipant.isActive = false
  └─ LiveClassParticipant.wasKicked = true
  └─ LiveKit SFU: removeParticipant()
  └─ Socket: liveclass:kicked + liveclass:you_were_kicked

Future joinLiveClass() by same user:
  └─ findFirst({ liveClassId, userId })
  └─ if (existingRecord?.wasKicked) → 403
```

`wasKicked` is session-scoped. It is never reset within the same `LiveClass` session. A new session (new `LiveClass` record) starts fresh.
