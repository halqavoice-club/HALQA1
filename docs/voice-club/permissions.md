# Voice Club — Role Model and Permission Matrix

**Source:** `backend/src/middleware/voiceRole.middleware.js`, `backend/src/controllers/voice.controller.js`  
**Audit date:** 2026-08-26

---

## Roles That Exist

Four content-participation roles in `VoiceParticipant.role`:

```
HOST (1 per room)
 └─ Room creator; has full control
    Assigned at room creation

MODERATOR (0+ per room)
 └─ Assigned by HOST
    Can moderate; cannot end room or transfer ownership

SPEAKER (0+ per room, max = room.maxSpeakers)
 └─ Promoted from AUDIENCE (queue, direct, mic pass, grab mic)
    Can publish audio

AUDIENCE (default for all joiners)
 └─ Listen only; can raise hand to join speaker queue
```

There is also a **permanent member role** in `VoiceRoomMember.role`:  
`OWNER | CO_OWNER | ADMIN | MODERATOR | VIP | OFFICIAL | MEMBER | BLOCKED`  
This is for the room's persistent membership registry, distinct from the session participation role.

---

## Permission Matrix

| Action | HOST | MODERATOR | SPEAKER | AUDIENCE |
|--------|------|-----------|---------|----------|
| Create room | ✅ (becomes HOST) | — | — | — |
| End/archive room | ❌ (platform admin only) | ❌ | ❌ | ❌ |
| Delete room (soft) | ✅ | ❌ | ❌ | ❌ |
| Update room settings | ✅ | ✅ | ❌ | ❌ |
| Upload room cover | ✅ | ❌ | ❌ | ❌ |
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
| Unban participant | ✅ | ✅ | ❌ | ❌ |
| Pin speaker | ✅ | ✅ | ❌ | ❌ |
| Toggle open mic | ✅ | ✅ | ❌ | ❌ |
| Toggle mic lock | ✅ | ✅ | ❌ | ❌ |
| Toggle seat lock | ✅ | ✅ | ❌ | ❌ |
| Mute self | ✅ | ✅ | ✅ | ❌ |
| Publish audio | ✅ | ✅ | ✅ | ❌ |
| Raise hand (queue entry) | ❌ | ❌ | ❌ | ✅ |
| Cancel hand | ❌ | ❌ | ❌ | ✅ |
| Drop mic (self-demote) | — | — | ✅ | — |
| Grab mic (open mic mode) | — | — | — | ✅ |
| Send/receive mic pass | ✅ | ✅ | ✅ | ✅ (receive only) |
| Send chat | ✅ | ✅ | ✅ | ✅ |
| Delete own message | ✅ | ✅ | ✅ | ✅ |
| Delete any message | ✅ | ✅ | ❌ | ❌ |
| Send reactions | ✅ | ✅ | ✅ | ✅ |
| Send gifts | ✅ | ✅ | ✅ | ✅ |
| View participants | ✅ | ✅ | ✅ | ✅ |
| View speaker queue (full) | ✅ | ✅ | ❌ | ❌ |
| View own queue position | ❌ | ❌ | ❌ | ✅ |
| Get LiveKit token | ✅ | ✅ | ✅ | ✅ |

*MODERATOR cannot kick/ban HOST or other MODERATORs.

---

## Access to PRIVATE and INVITE_ONLY Rooms

For PRIVATE rooms:
- `getRoom()`: requires active `VoiceParticipant` or be the host (SA-FIX-07)
- `getMessages()`: same check (SA-FIX-08)
- `joinRoom()`: requires active `VoiceRoomMember.status === 'ACTIVE'`

For INVITE_ONLY rooms: same as PRIVATE plus user must have been explicitly invited.

---

## SUPER_ADMIN and Voice Club

**The permanent room end/archive (`PATCH /voice/:id/end`) is intentionally SUPER_ADMIN-only.**

This is correct by design — it is a platform administration action, not a content participation action:

```javascript
// voice.controller.js: endRoom()
// PERMANENT ROOM CONTRACT: Only SUPER_ADMIN can set status=ENDED.
if (req.user.role !== 'SUPER_ADMIN') {
  return errorResponse(res, 'Rooms are permanent. Use the Leave button...', 403);
}
```

This is the **one legitimate use** of SUPER_ADMIN role in the voice system.

**All other voice operations require active `VoiceParticipant` or `VoiceRoomMember` records:**

| Action | SUPER_ADMIN rule | Current status |
|--------|-----------------|---------------|
| Archive room (ENDED) | ✅ ALLOWED by design | ✅ Correct |
| Join room as AUDIENCE | ✅ Same as any user | ✅ No bypass |
| View PUBLIC room | ✅ Same as any user | ✅ Correct |
| View PRIVATE room | ❌ Must be participant | ✅ SA-FIX-07 applied |
| Read PRIVATE room messages | ❌ Must be participant | ✅ SA-FIX-08 applied |
| Approve speaker queue | ❌ Must be HOST/MOD participant | ✅ SA-FIX-09 applied |
| Update room settings | ❌ Must be HOST/MOD participant | ✅ SA-FIX-02 applied |
| Delete room | ❌ Must be HOST | ✅ SA-FIX-03 applied |
| Upload cover image | ❌ Must be HOST | ✅ SA-FIX-06 applied |
| Get scheduled rooms | ✅ Sees all schools' rooms | ⚠️ `getScheduledRooms` has SUPER_ADMIN bypass — see gaps.md |

### Verified SA-Fixes (All Confirmed via Tests)

| Fix | Behavior |
|-----|----------|
| SA-FIX-02 | `updateRoom()`: SUPER_ADMIN cannot edit without being HOST/MOD |
| SA-FIX-03 | `deleteRoom()`: SUPER_ADMIN cannot delete without being HOST |
| SA-FIX-04 | `unbanParticipant()`: SUPER_ADMIN has no room-level unban privilege |
| SA-FIX-06 | `uploadRoomCover()`: Only HOST can upload |
| SA-FIX-07 | `getRoom()`: PRIVATE rooms deny non-participants (SUPER_ADMIN included) |
| SA-FIX-08 | `getMessages()`: PRIVATE room messages deny non-participants |
| SA-FIX-09 | Speaker queue: SUPER_ADMIN has no queue admin privilege |

---

## School Isolation

Voice rooms are **global** — not school-scoped. `schoolId` is always set to `null` in `createRoom()`:

```javascript
// voice.controller.js: createRoom()
// Voice Club is a global Social feature — rooms are NOT school-scoped.
const schoolId = null;
```

This means:
- Users from any school (or no school) can see and join PUBLIC rooms
- No school membership check for voice rooms
- `school:join` socket room is still isolated (SA-FIX-10), but `voice:lobby` is global

The `getScheduledRooms` function has a SUPER_ADMIN check that shows all rooms across schools. For other users, it shows the user's school rooms + public global rooms. Since `schoolId = null` for all voice rooms, this distinction is currently inert.
