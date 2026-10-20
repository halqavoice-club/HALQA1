# Voice Club / Voice Room Permissions

---

## Voice Room Role Hierarchy

Defined in `backend/src/middleware/voiceRole.middleware.js`.

```
HOST (1 per room)
 └── Assigned to room creator
 └── Full control

MODERATOR (0+ per room)
 └── Assigned by HOST
 └── Co-host capabilities (cannot kick HOST or other MODs)

SPEAKER (0+ per room)
 └── Promoted from AUDIENCE by HOST/MOD or via queue approval
 └── Can publish audio; cannot moderate

AUDIENCE (default)
 └── All joining users start here
 └── Can raise hand to enter speaker queue
 └── Cannot publish audio
```

---

## Permission Matrix

| Action | HOST | MODERATOR | SPEAKER | AUDIENCE |
|--------|------|-----------|---------|----------|
| Create room | ✅ | — | — | — |
| End room | ✅ | ❌ | ❌ | ❌ |
| Assign MODERATOR | ✅ | ❌ | ❌ | ❌ |
| Remove MODERATOR | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |
| Approve speaker queue | ✅ | ✅ | ❌ | ❌ |
| Reject from queue | ✅ | ✅ | ❌ | ❌ |
| Promote AUDIENCE → SPEAKER | ✅ | ✅ | ❌ | ❌ |
| Demote SPEAKER → AUDIENCE | ✅ | ✅ | ❌ | ❌ |
| Mute others | ✅ | ✅ | ❌ | ❌ |
| Unmute others | ✅ | ✅ | ❌ | ❌ |
| Mute all | ✅ | ✅ | ❌ | ❌ |
| Unmute all | ✅ | ✅ | ❌ | ❌ |
| Kick participant | ✅ | ✅* | ❌ | ❌ |
| Ban participant | ✅ | ✅* | ❌ | ❌ |
| Pin speaker | ✅ | ✅ | ❌ | ❌ |
| Toggle open mic | ✅ | ✅ | ❌ | ❌ |
| Toggle mic lock | ✅ | ✅ | ❌ | ❌ |
| Toggle seat lock | ✅ | ✅ | ❌ | ❌ |
| Mute self | ✅ | ✅ | ✅ | ❌ |
| Publish audio (speak) | ✅ | ✅ | ✅ | ❌ |
| Raise hand | ❌ | ❌ | ❌ | ✅ |
| Cancel hand | ❌ | ❌ | ❌ | ✅ |
| Drop mic (self-demote to AUDIENCE) | — | — | ✅ | — |
| Grab mic (open-mic mode) | — | — | — | ✅ |
| Send/receive mic pass | ✅ | ✅ | ✅ | ✅ (receive) |
| Send chat | ✅ | ✅ | ✅ | ✅ |
| Send reactions | ✅ | ✅ | ✅ | ✅ |
| Delete own message | ✅ | ✅ | ✅ | ✅ |
| Delete any message | ✅ | ✅ | ❌ | ❌ |
| View room details | ✅ | ✅ | ✅ | ✅ |
| View participants | ✅ | ✅ | ✅ | ✅ |
| View full speaker queue | ✅ | ✅ | ❌ | ❌ |
| View own queue position | ❌ | ❌ | ❌ | ✅ |
| Send gifts | ✅ | ✅ | ✅ | ✅ |
| Receive LiveKit token | ✅ | ✅ | ✅ | ✅ |

*MODERATOR cannot kick/ban HOST or other MODERATORs.

---

## SUPER_ADMIN and Voice Rooms

SUPER_ADMIN has **no special role** in voice rooms. There is no bypass in `checkVoiceRole()`, `voiceRole.middleware.js`, or the voice controllers.

| Action | SUPER_ADMIN | Reason |
|--------|------------|--------|
| Create a voice room | ✅ Yes | Any authenticated user can create |
| Join a voice room as AUDIENCE | ✅ Yes | Any authenticated user can join (if room is PUBLIC) |
| Become HOST | ❌ No | HOST = room creator; SUPER_ADMIN is not automatically the creator |
| Approve speaker queue | ❌ No | `checkVoiceRole([HOST, MODERATOR])` — requires VoiceParticipant record |
| Mute/kick | ❌ No | `checkVoiceRole([HOST, MODERATOR])` |
| View full queue | ❌ No | SA-FIX-09: controller checks `participant.role === HOST/MODERATOR` — SUPER_ADMIN explicitly excluded |
| Receive LiveKit token | ✅ if active participant | Requires active `voiceParticipant` record (same as anyone) |

SA-FIX-09 comment in `voice-queue.controller.js`:
```
// SA-FIX-09: SUPER_ADMIN has no room-level queue admin privilege.
// Full queue is available only to active HOST or MODERATOR participants.
```

---

## LiveKit Token Grants (Voice Room)

Endpoint: `POST /voice/:id/livekit-token`

Requirements:
- Active `voiceParticipant` record (`isActive: true`)
- Room must not be `ENDED`

Grants (all active participants):
```javascript
{
  roomJoin:             true,
  room:                 roomId,
  canPublish:           true,      // ALL participants — mic control via Socket.IO role events
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true
}
```

`micEnabled` field in response:
```javascript
const micEnabled = role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER';
// Frontend uses this to start with mic ON or OFF — not a LiveKit SFU grant
```

Token TTL: `1h` (reduced from 8h to limit post-kick token reuse)

---

## Voice Room Lifecycle

```
SCHEDULED → LIVE → IDLE → ENDED (archived)
                ↑
               IDLE (permanent rooms return here when all leave)
```

- SCHEDULED: upcoming room, not yet started
- LIVE: active, participants present
- IDLE: no active participants but not archived
- ENDED: permanently closed, no new tokens issued

---

## Speaker Queue (FIFO)

Queue is stored in Redis (with DB fallback when Redis unavailable).

Queue operations:
- `raiseHand`: AUDIENCE only; blocked if `micLocked = true`
- `approveNext`: HOST/MODERATOR only; blocked if `micLocked = true`; blocked if speaker limit reached
- `approveUser`: HOST/MODERATOR only
- `rejectUser`: HOST/MODERATOR only
- `cancelHand`: own operation (any participant)

Speaker limit: `room.maxSpeakers` (default 10)

---

## Kick vs Ban

| Operation | Effect | Can rejoin |
|-----------|--------|-----------|
| Kick | Removes from room; marks `isActive = false` | Yes |
| Ban | Removes from room; creates persistent ban record | No |
| Unban | Removes ban record | Yes |
