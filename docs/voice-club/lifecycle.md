# Voice Club — Room Lifecycle

**Source:** `backend/src/controllers/voice.controller.js`  
**Audit date:** 2026-08-26

---

## States

```
VoiceRoomStatus: SCHEDULED | LIVE | IDLE | ENDED
```

---

## The Permanent Room Contract

Voice rooms are **permanent**. Unlike live classes, they do NOT end when participants leave.

```
SCHEDULED ──(first join or auto-live)──→ LIVE
    │                                      │
    │                                      │ (all participants leave)
    │                                      ↓
    │                                    IDLE ←─── (re-join)
    │                                      │
    └──(archived by SUPER_ADMIN)───────────┤
                                           ↓
                                        ENDED  (terminal — no re-entry)
```

- **SCHEDULED** → room created with a future `scheduledAt` date
- **LIVE** → at least one active participant  
- **IDLE** → no active participants but room still accessible and joinable
- **ENDED** → permanently archived; no new joins allowed; only reachable by SUPER_ADMIN

---

## State Transitions

### CREATE → SCHEDULED or LIVE

```
Any user → POST /voice/
  └─ createRoom():
     ├─ If scheduledAt in future → status = 'SCHEDULED'
     ├─ Else                     → status = 'LIVE' (first participant = host)
     ├─ Creates VoiceParticipant for host (role=HOST, isMuted=false)
     ├─ If scheduled: scheduleRoomReminder() → push notification at scheduledAt
     └─ Emit: voice:room_created → voice:lobby + school:{schoolId} (null)
```

The host is automatically created as the first participant in the same DB transaction.

### JOIN → LIVE (room re-activation)

```
Any user → POST /voice/:id/join
  └─ joinRoom():
     ├─ Privacy check (PRIVATE/INVITE_ONLY: must have active VoiceRoomMember)
     ├─ Ban check (VoiceRoomMember.isBanned)
     ├─ Capacity check (by roomLevel tier)
     ├─ Upsert VoiceParticipant (isActive=true, role=HOST or AUDIENCE)
     ├─ Auto-create VoiceRoomMember on first join
     ├─ syncRoomStatus() → sets status='LIVE' if active participants > 0
     ├─ broadcastLiveUpdate() → updates feed card participant count
     └─ Emit: voice:user_joined → voice:{roomId}
            voice:status_changed (if IDLE→LIVE) → voice:{roomId}
            voice:member_joined (new member) → voice:{roomId}
```

### LEAVE → IDLE (if last participant)

```
User → POST /voice/:id/leave
  └─ leaveRoom():
     ├─ VoiceParticipant.isActive = false, leftAt = now
     ├─ autoPromoteNext() if user was SPEAKER or MODERATOR
     ├─ syncRoomStatus() → if no active participants → status='IDLE'
     ├─ broadcastLiveUpdate() → updates feed card
     └─ Emit: voice:user_left → voice:{roomId}
     
     If status becomes IDLE:
       broadcastLiveEnd('voice_room', roomId) → feed card marked ended
```

**Key difference from Live Class:** The room stays IDLE (not ENDED) when last participant leaves. The room is still joinable.

### ENDED (Archive — SUPER_ADMIN only)

```
SUPER_ADMIN → PATCH /voice/:id/end
  └─ endRoom():
     ├─ if req.user.role !== 'SUPER_ADMIN' → 403
     ├─ All VoiceParticipant.isActive = false, leftAt = now
     ├─ VoiceRoom.status = 'ENDED', endedAt = now
     ├─ upsertDailyStats for host
     ├─ voiceMinutes credited to all active participants (L-8 fix)
     └─ Emit: voice:room_ended → voice:{roomId}
              voice:room_deleted → voice:lobby + school:{schoolId}
```

No user except SUPER_ADMIN can call this. Regular hosts use `DELETE /voice/:id` to soft-delete instead.

### DELETE (Soft-delete — HOST only)

```
HOST → DELETE /voice/:id
  └─ deleteRoom():
     ├─ Must be HOST or active VoiceParticipant (SA-FIX-03)
     ├─ VoiceRoom.deletedAt = now, status = 'ENDED'
     ├─ All VoiceParticipant.isActive = false
     └─ Emit: voice:room_ended, voice:room_deleted → voice:lobby
```

---

## Scheduled Room Auto-Live

The `voice-scheduled-rooms-auto-live` cron (every minute) auto-transitions rooms:

```
Cron: every minute
  └─ Find SCHEDULED rooms where scheduledAt <= now
  └─ For each: syncRoomStatus() → sets LIVE if host participant exists
  └─ Emit: voice:status_changed, voice:room_updated → voice:lobby + room
  └─ _notifyFollowers() → push notifications to followers
```

---

## syncRoomStatus

```javascript
async function syncRoomStatus(roomId, schoolId) {
  const activeCount = await countActive(roomId);
  const room = await prisma.voiceRoom.findUnique({ where: { id: roomId } });
  
  if (room.status === 'ENDED') return; // terminal, never change
  
  let newStatus;
  if (activeCount > 0) {
    newStatus = 'LIVE';
  } else if (room.status === 'LIVE') {
    newStatus = 'IDLE'; // was live, now empty → idle
  } else {
    return; // already IDLE or SCHEDULED with no participants
  }
  
  if (newStatus !== room.status) {
    await prisma.voiceRoom.update({ where: { id: roomId }, data: { status: newStatus, startedAt: ... } });
    await invalidateRoomCache(roomId, schoolId);
    // Emit voice:status_changed if IDLE→LIVE
  }
}
```

---

## voiceMinutes Tracking (L-8 Fix)

When a room is archived via `endRoom()`, the system credits `voiceMinutes` to all active participants via `DailyUserStats`. This is fire-and-forget. Participants who leave normally via `leaveRoom()` do NOT currently have minutes credited (gap — see [gaps.md](./gaps.md)).

---

## LiveKit Room Name

Voice rooms use the room's UUID directly as the LiveKit room name (not `voice-{id}` prefix):

```javascript
// livekit.controller.js: getLiveKitToken() for voice rooms
at.addGrant({
  room: roomId,  // the voice room UUID directly
  ...
})
```

The generic `/livekit/token` endpoint detects voice rooms by looking up the `roomId` in the `voice_rooms` table.
