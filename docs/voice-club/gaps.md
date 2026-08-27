# Voice Club — Known Gaps

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation. No fixes applied.

---

## SUPER_ADMIN Notes

### VC-SA-001 — `endRoom()` is SUPER_ADMIN-Only (Correct by Design)

`PATCH /voice/:id/end` requires `req.user.role === 'SUPER_ADMIN'`. This is intentional — the permanent room contract prevents regular users including HOST from terminating rooms. Only a platform admin can archive a room for policy/moderation reasons.

**This is correct behavior**, not a violation. It is the one legitimate use of SUPER_ADMIN in the voice system.

### VC-SA-002 — `getScheduledRooms` has SUPER_ADMIN School Bypass

**Severity:** LOW  
**File:** `backend/src/controllers/voice.controller.js: getScheduledRooms()`

```javascript
// getScheduledRooms() ~line 1718
if (req.user.role === 'SUPER_ADMIN') {
  schoolWhere = {};  // shows rooms across all schools
} else if (req.user.schoolId) {
  schoolWhere = { schoolId: req.user.schoolId };
}
```

Since all voice rooms have `schoolId = null`, this SUPER_ADMIN bypass is currently **inert** — there are no school-scoped voice rooms to reveal. If school-scoped voice rooms were ever added, this would become a real isolation bypass.

**Do not fix.** Document only.

---

## Missing Features

### VC-GAP-001 — voiceMinutes Not Credited on Normal Leave

**Severity:** LOW  
`voiceMinutes` in `DailyUserStats` is only updated when a room is archived via `endRoom()`. When participants leave normally via `leaveRoom()`, no minutes are credited to their daily stats.

---

### VC-GAP-002 — Whiteboard/Notes Not Implemented

**Severity:** LOW  
Voice rooms do not have whiteboard or note features. This is correct (voice rooms are audio-only), not a gap.

---

### VC-GAP-003 — No Admin Room Inspection Endpoint

**Severity:** MEDIUM  
The admin stats endpoint (`GET /admin/stats/live-voice`) returns voice room aggregate counts and recent room list, but no way to inspect a specific room's participant list from the admin side without having a `VoiceParticipant` record.

**Platform admin cannot view a private room's participants without joining it** — which contradicts the platform-vs-content separation principle.

---

### VC-GAP-004 — Kick Does Not Force-Leave Socket Room

**Severity:** LOW  
`kickParticipant()` emits `voice:kicked` to the room and the user's personal room. It also calls `io.in(`user:${userId}`).fetchSockets().forEach(s => s.leave(`voice:${roomId}`))` to force the socket out.

However, if the user has multiple browser tabs or connections, only the sockets in `user:{userId}` room are removed. A second connection that joined `voice:{roomId}` via a different identity would not be removed.

---

### VC-GAP-005 — No Audit Logging for Voice Room Moderation

**Severity:** MEDIUM  
`voiceAudit()` exists and is called in `voice-roles.controller.js` (assignModerator, removeModerator, transferAdmin, muteAll, unmutedAll). However, kick, ban, and unban do not call `voiceAudit()`. Actions taken by HOST/MOD against participants are not fully audit-trailed.

---

### VC-GAP-006 — Speaker Queue Persistence on Redis Flush

**Severity:** LOW  
The FIFO speaker queue lives in Redis. If Redis flushes (restart, OOM), the queue is lost. The DB fallback (`VoiceParticipant.handRaised`) provides a degraded ordered view but loses exact FIFO ordering (sorts by `handRaisedAt` instead).

---

## Summary Table

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| VC-SA-001 | N/A | endRoom is SUPER_ADMIN-only (correct) | ✅ By design |
| VC-SA-002 | LOW | getScheduledRooms SUPER_ADMIN school bypass (inert) | ❌ Not fixed (inert) |
| VC-GAP-001 | LOW | voiceMinutes not credited on normal leave | ✅ Already fixed (L-8 FIX in leaveRoom) |
| VC-GAP-003 | MEDIUM | No admin room inspection without participation | ✅ Fixed Sprint 12 |
| VC-GAP-004 | LOW | Kick socket eviction may miss multi-tab users | ❌ |
| VC-GAP-005 | MEDIUM | Kick/ban not audit-logged | ✅ Already implemented (voiceAudit called) |
| VC-GAP-006 | LOW | Speaker queue lost on Redis flush | ❌ (DB fallback exists) |
