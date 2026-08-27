# Participant Lifecycle — Voice Club and Live Class

**Audit date:** 2026-08-26  
**Rule:** Read-only audit. No code modified.

---

## Voice Room Participant Lifecycle

### 1. Join (`POST /voice/:id/join`)

**File:** `backend/src/controllers/voice.controller.js: joinRoom`

```
Client → POST /voice/:id/join
  └─ authenticate → req.user
  └─ Controller:
     ├─ Load room from DB (+ Redis cache)
     ├─ Check room.status ≠ ENDED (archived rooms reject joins)
     ├─ Check NOT banned (voiceParticipant.isBanned check)
     ├─ Check NOT already active (idempotent — returns existing record)
     ├─ Determine role:
     │    if room.hostId === userId → HOST
     │    else                     → AUDIENCE
     ├─ If IDLE → set status = LIVE (room re-activates on first join)
     ├─ upsert VoiceParticipant { role, isMuted: true, isActive: true }
     │    HOST: isMuted = false
     ├─ Emit: voice:user_joined → voice:{roomId}
     └─ Return: { participant, room }
```

**After joining, client:**
1. Calls `POST /voice/:id/livekit-token` — gets LiveKit token
2. Calls `socket.emit('voice:join_room', roomId)` — joins Socket.IO room (DB-verified)
3. `useLiveKit.connect()` — connects to LiveKit SFU

### 2. Role Assignment on Join

| Condition | Role assigned |
|-----------|--------------|
| `room.hostId === userId` | HOST |
| All others | AUDIENCE |

SUPER_ADMIN is treated identically to AUDIENCE unless they created the room (i.e., are the `hostId`). There is no SUPER_ADMIN bypass in `joinRoom`.

### 3. Promotion from AUDIENCE

| Path | Mechanism | Role result |
|------|-----------|------------|
| HOST/MOD approves queue | `voice-queue: approveUser` / `approveNext` | AUDIENCE → SPEAKER |
| HOST/MOD directly promotes | `PATCH /voice/:id/promote` | AUDIENCE → SPEAKER |
| Open mic mode + `grabMic` | `POST /voice/:id/grab-mic` | AUDIENCE → SPEAKER (if not at limit) |
| Mic pass acceptance | `POST /voice/:id/mic-pass/:offerId/accept` | AUDIENCE → SPEAKER |

Each promotion:
- Updates `VoiceParticipant.role` in DB
- Sets `isMuted = false` (speakers can publish)
- Emits `voice:role_changed` to room
- Emits personal notification to user

### 4. Demotion

| Path | Mechanism | Role result |
|------|-----------|------------|
| Drop mic (self) | `POST /voice/:id/drop-mic` | SPEAKER → AUDIENCE |
| HOST/MOD demotes | `PATCH /voice/:id/promote { role: 'AUDIENCE' }` | SPEAKER → AUDIENCE |
| Mic pass (passer role change) | accept offer by other | SPEAKER → AUDIENCE (passer) |

### 5. Moderator Assignment

```
HOST → POST /voice/:id/moderator/:userId
  └─ checkVoiceRole([HOST]) — route-level guard
  └─ assignModerator:
     ├─ Target must be SPEAKER or AUDIENCE (not already HOST or MOD)
     ├─ Update VoiceParticipant: role=MODERATOR, isMuted=false
     ├─ Emit: voice:moderator_assigned → voice:{roomId}
     ├─ Emit: voice:role_changed → voice:{roomId}
     └─ Emit: voice:you_are_moderator → user:{targetId}
```

### 6. Ownership Transfer

```
HOST → POST /voice/:id/transfer/:userId
  └─ checkVoiceRole([HOST]) — route-level guard
  └─ transferAdmin:
     ├─ prisma.$transaction:
     │    old HOST → MODERATOR
     │    target → HOST
     │    VoiceRoom.hostId → targetUserId (WHERE hostId = prevHostId — race protection)
     ├─ Emit: voice:admin_transferred → voice:{roomId}
     ├─ Emit: voice:role_changed (x2) → voice:{roomId}
     └─ Emit: voice:you_are_host → user:{targetId}
```

### 7. Kick

```
HOST/MOD → DELETE /voice/:id/kick/:userId
  └─ Controller: kickParticipant
     ├─ VoiceParticipant.isActive = false
     ├─ Emit: voice:kicked → voice:{roomId}
     ├─ Emit: voice:kicked → user:{kicked}
     ├─ Force-remove kicked user's sockets from voice:{roomId} room:
     │    io.in(`user:${userId}`).fetchSockets()
     │    .forEach(s => s.leave(`voice:${roomId}`))
     └─ LiveKit: RoomServiceClient.removeParticipant() (if configured)
```

Kicked user's `isActive = false` means:
- Cannot get a new LiveKit token (participant check fails)
- Cannot rejoin socket room (voice:join_room check fails)

### 8. Ban

Persistent kick — adds `VoiceParticipant.isBanned = true` (stored in DB). User cannot rejoin unless unbanned.

### 9. Leave

```
Client → POST /voice/:id/leave
  └─ VoiceParticipant: isActive=false, leftAt=now
  └─ Emit: voice:user_left → voice:{roomId}
  └─ Force-remove user's sockets from voice:{roomId}:
       io.in(`user:${userId}`).fetchSockets()
       .forEach(s => s.leave(`voice:${roomId}`))
  └─ If last participant → room.status = IDLE (permanent rooms) or ENDED
```

### 10. Room End

```
HOST → PATCH /voice/:id/end
  └─ VoiceRoom.status = ENDED
  └─ All VoiceParticipant: isActive=false
  └─ Emit: voice:room_ended → voice:{roomId}
  └─ Emit: voice:room_deleted → voice:lobby + school:{schoolId}
  └─ Redis cache deleted
```

ENDED rooms cannot issue new LiveKit tokens.

---

## Live Class Participant Lifecycle

### 1. Join (`POST /live-classes/:id/join`)

**File:** `backend/src/controllers/live-class.controller.js: joinLiveClass`

```
Client → POST /live-classes/:id/join
  └─ authenticate → req.user
  └─ resolveStreamAccess:
     │   PUBLIC → pass
     │   SCHOOL → requireSchoolMember() + active membership
  └─ joinLiveClass controller:
     ├─ Load live class (raw SQL)
     ├─ assertSchoolAccess (school isolation)
     ├─ Check lc.status ≠ ENDED and ≠ CANCELLED
     ├─ Determine role:
     │    effectiveRole = req.schoolMembership?.role || req.user.role
     │    isTeacher = user.role ∈ ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN']  ← ⚠️ VIOLATION
     │    isStaff   = effectiveRole ∈ ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN']  ← ⚠️ VIOLATION
     │    isPublicHost = streamType='PUBLIC' && lc.hostUserId===userId
     │    role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT'
     ├─ If STUDENT (SCHOOL stream):
     │    Check Student profile exists
     │    Check active Enrollment
     │    Check wasKicked = false
     │    Check capacity (< maxParticipants)
     ├─ If STUDENT (PUBLIC stream):
     │    Check wasKicked = false
     │    Check capacity
     ├─ upsert LiveClassParticipant { role, isMuted, isActive:true }
     │    HOST: isMuted = false (or lc.isOpenMic)
     │    STUDENT: isMuted = true (or lc.isOpenMic)
     ├─ Auto-start: if isHost && lc.status='SCHEDULED' → set status='LIVE'
     ├─ Emit: liveclass:user_joined → liveclass:{id}
     ├─ Emit: liveclass:started (if auto-started) → school/class/feed rooms
     └─ Return: { participant, liveKit: { token, url } (included in same response)
```

### 2. Role Assignment (⚠️ SUPER_ADMIN Scope Violation)

```javascript
const isTeacher = user.role === 'TEACHER' || user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN';
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);
const role      = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

**LCSV-001:** SUPER_ADMIN receives `HOST` role when joining any live class. This creates a `LiveClassParticipant` record with `role = 'HOST'`, which:
- Enables the admin to receive LiveKit token
- Enables the admin to auto-start a SCHEDULED class
- Enables the admin to receive host controls in the room
- Pollutes attendance records

### 3. Leave

```
Client → POST /live-classes/:id/leave
  └─ LiveClassParticipant: isActive=false, leftAt=now
  └─ Emit: liveclass:user_left → liveclass:{id}
```

### 4. Kick

```
HOST → DELETE /live-classes/:id/participants/:userId
  └─ resolveStreamStaffAccess (school staff or public host)
  └─ kickParticipant:
     ├─ LiveClassParticipant: isActive=false, wasKicked=true
     ├─ Emit: liveclass:kicked → liveclass:{id}
     ├─ Emit: liveclass:you_were_kicked → user:{kicked}
     └─ LiveKit: RoomServiceClient.removeParticipant() (P0-05 fix)
```

`wasKicked = true` prevents the user from rejoining the same session.

### 5. Hand Raise → Speaking Permission

```
Student → POST /live-classes/:id/hand/raise
  └─ Sets LiveClassParticipant.handRaised=true
  └─ Emit: liveclass:hand_raised → liveclass:{id}

HOST → POST /live-classes/:id/hand/approve/:userId
  └─ Sets isMuted=false in DB
  └─ Emit: liveclass:hand_approved → liveclass:{id}
  └─ Emit: liveclass:you_can_speak → user:{userId}
     └─ Client: room.localParticipant.setMicrophoneEnabled(true)  [no reconnect]
```

### 6. End Live Class

```
HOST → POST /live-classes/:id/end
  └─ resolveStreamStaffAccess
  └─ endLiveClass:
     ├─ lc.status = 'ENDED'
     ├─ All LiveClassParticipant: isActive=false, leftAt=now
     ├─ All LiveClassAttendance: leftAt=now, totalMinutes=calculated
     ├─ Emit: liveclass:ended → liveclass:{id}
     └─ Cancel auto-end timer
```

---

## Token Revocation on Kick

When a participant is kicked:

1. `LiveClassParticipant.isActive = false` or `VoiceParticipant.isActive = false`
2. LiveKit `RoomServiceClient.removeParticipant()` called — removes from SFU immediately
3. Kicked user's sockets are force-removed from the socket room
4. Existing 1h LiveKit token remains technically valid at the SFU level until TTL expires
5. **Post-kick token reuse window:** up to 1h (reduced from 8h in a prior fix)

The primary protection against post-kick re-entry is the DB participant check on `POST /voice/:id/livekit-token` and `POST /live-classes/:id/token`. Without an active participant record, no new token can be obtained.

---

## Reconnect Behavior

### Voice Club (useLiveKit.ts)

| Disconnect reason | Auto-reconnect |
|------------------|---------------|
| `CLIENT_INITIATED` | ❌ No |
| `ROOM_DELETED` | ❌ No |
| `PARTICIPANT_REMOVED` | ❌ No (kicked) |
| Network loss, timeout | ✅ Yes — up to 5 attempts, exponential backoff |
| Token expiry (1h) | ✅ Yes — proactive reconnect at 55 min |

Each reconnect fetches a **fresh token** from the backend. If the participant has been kicked, the token endpoint returns 403 and reconnect stops.

### Live Class (LiveClassRoomImpl.tsx)

Similar reconnect policy. `liveclass:you_can_speak` no longer triggers a reconnect — it simply calls `setMicrophoneEnabled(true)` on the existing connection.

---

## wasKicked Flag (Live Class)

Added in migration `20260816_add_was_kicked_to_live_class_participants`:

```sql
ALTER TABLE live_class_participants ADD COLUMN wasKicked BOOLEAN NOT NULL DEFAULT false;
```

When set to `true`:
- User cannot call `POST /live-classes/:id/join` for the same session (403 returned)
- Only resets when a new `LiveClass` is created (fresh records)
- This is session-scoped kick protection

---

## School Isolation in Participant Lifecycle

### Voice Rooms
Voice rooms have an optional `schoolId`. No school isolation check is enforced at the join level — any authenticated user can join a PUBLIC voice room. PRIVATE/INVITE_ONLY rooms are enforced by `VoiceRoom.privacy` checks in `joinRoom`.

### Live Classes (SCHOOL type)
School isolation is enforced at two levels:
1. `resolveStreamAccess` → `requireSchoolMember()` — requires active SchoolMembership
2. `assertSchoolAccess(lc, user)` inside controller — checks `lc.schoolId === user.schoolId`

For PUBLIC live classes: no school isolation — any authenticated user can join.
