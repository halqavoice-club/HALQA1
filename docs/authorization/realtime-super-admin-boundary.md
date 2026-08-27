# SUPER_ADMIN Realtime Boundary — Definitive Reference

**Audit date:** 2026-08-26  
**This is the authoritative statement of what SUPER_ADMIN can and cannot do in the realtime layer.**

---

## The Non-Negotiable Rule

```
SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY

SUPER_ADMIN must NEVER:
  - Hold a participant role in any content space
  - Receive a LiveKit room token as a content participant
  - Appear in any participant list
  - Publish audio, video, or screen share
  - Become HOST, TEACHER, SPEAKER, STREAMER, MODERATOR, or VIEWER in a room
  - Join a content Socket.IO room (voice:{id}, liveclass:{id}) except as a verified participant

Administrative access to content spaces must be implemented through
dedicated admin APIs, not by making SUPER_ADMIN a content participant.
```

---

## Current Status — Complete Assessment

### Socket.IO — What SUPER_ADMIN Can Access

| Room | Status | Authorization | Note |
|------|--------|-------------|------|
| `user:{userId}` | ✅ CORRECT | Own room auto-joined | Personal events only |
| `voice:lobby` | ✅ CORRECT | All authenticated users | Read-only voice room list updates |
| `role:SUPER_ADMIN` | ✅ CORRECT | Own role room | Receives `admin:user_reported`, `creator:payout_requested` |
| `feed:public` | ✅ CORRECT | All authenticated users (on `feed:join`) | Public feed events |
| `feed:{userId}` | ✅ CORRECT | Own feed only | Personal feed events |

### Socket.IO — What SUPER_ADMIN Must NOT Access (and current status)

| Room | Current status | Gate | Finding |
|------|---------------|------|---------|
| `voice:{roomId}` | ✅ BLOCKED | DB: active VoiceParticipant required | Correct |
| `liveclass:{id}` | ✅ BLOCKED | DB: active LiveClassParticipant required | Correct |
| `school:{schoolId}` | ✅ BLOCKED (SA-FIX-10) | JWT schoolId must match | Correct |
| `class:{classId}` | ✅ BLOCKED (SA-FIX-11) | DB: SchoolMembership required for class's school | Correct |
| `community:{id}` | ✅ BLOCKED | DB: active CommunityMember required | Correct |
| `pk:{matchId}` | ✅ BLOCKED | DB: participant or LIVE/ENDED match | Correct |
| `conversation:{convId}` | ✅ BLOCKED | DB: active GroupMember required | Correct |
| `feed:school:{schoolId}` | ⚠️ **VIOLATION** | **Legacy bypass: SUPER_ADMIN joins ANY school's feed** | **SVSV-001** |

---

## LiveKit — What SUPER_ADMIN Can Access

| Token type | Status | Condition |
|-----------|--------|-----------|
| Voice room token | ✅ If active VoiceParticipant | Same as any user — no bypass |
| Live class token (school stream) | ❌ BLOCKED | resolveStreamAccess requires school membership |
| Live class token (public stream) | ✅ If active LiveClassParticipant | Any auth user can join public streams |
| Generic token for liveclass-* room | ⚠️ School check bypassed | But participant check still blocks — LTSV-001 |
| Generic token for voice room | ✅ If active VoiceParticipant | Same as any user — no bypass |

---

## Content Participation — SUPER_ADMIN Status by System

### Voice Club

| Capability | SUPER_ADMIN gets | Correct? |
|-----------|-----------------|---------|
| Join as AUDIENCE | ✅ Yes (same as any user) | ✅ Correct — joining as AUDIENCE is valid |
| Receive HOST role | ✅ Only if they created the room | ✅ Correct |
| Receive MODERATOR role | ✅ Only if assigned by HOST | ✅ Correct |
| Approve speaker queue | ❌ Only if HOST/MOD participant | ✅ Correct |
| Mute/kick | ❌ Only if HOST/MOD participant | ✅ Correct |
| LiveKit token | ✅ If active participant | ✅ Correct |
| View full speaker queue | ❌ SA-FIX-09: blocked | ✅ Correct |

**Voice Club has no SUPER_ADMIN bypass.** Platform role is irrelevant inside a voice room.

### Live Class

| Capability | SUPER_ADMIN gets | Correct? |
|-----------|-----------------|---------|
| Join a school live class | ❌ BLOCKED (no school membership) | ✅ Correct |
| Join a public live class | ✅ Yes (same as any user) | ✅ Correct |
| Receive HOST role in school class | ❌ BLOCKED at route level | ✅ Correct |
| Receive HOST role in public class (own) | ✅ Yes (hostUserId check) | ✅ Correct |
| Receive HOST role in public class (other's) | ⚠️ **YES — VIOLATION LCSV-001** | ❌ **VIOLATION** |
| LiveKit token for school class | ❌ BLOCKED (route + participant check) | ✅ Correct |
| LiveKit token for public class (if joined) | ✅ Yes | ✅ Correct |
| Auto-start a SCHEDULED class | ⚠️ Yes if HOST role was assigned (via LCSV-001) | ❌ Side effect of LCSV-001 |

### Feed

| Capability | SUPER_ADMIN gets | Correct? |
|-----------|-----------------|---------|
| Receive public feed events | ✅ Yes (all users) | ✅ Correct |
| Receive personal feed events | ✅ Yes (own feed) | ✅ Correct |
| Receive school-scoped feed events (own school) | ✅ Yes (if JWT schoolId matches) | ✅ Correct |
| Receive school-scoped feed events (any school) | ⚠️ **YES — VIOLATION SVSV-001** | ❌ **VIOLATION** |

### Communities

| Capability | SUPER_ADMIN gets | Correct? |
|-----------|-----------------|---------|
| Join community socket room | ✅ Only if CommunityMember | ✅ Correct |
| Receive community events | ✅ Only as member | ✅ Correct |

---

## Violations — Realtime Layer (Summary)

### LCSV-001 — SUPER_ADMIN Receives HOST Role in Live Class

**Severity:** HIGH  
**File:** `backend/src/controllers/live-class.controller.js: joinLiveClass`  
**Lines:** ~793–801

**Current code:**
```javascript
const isTeacher = req.user.role === 'TEACHER'
               || req.user.role === 'SCHOOL_ADMIN'
               || req.user.role === 'SUPER_ADMIN';  // ← VIOLATION
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);  // ← VIOLATION
const role      = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

**Consequence chain:**
1. SUPER_ADMIN calls `POST /live-classes/:id/join` on a PUBLIC stream they did not create
2. `isTeacher = true` (because of platform role check)
3. `role = 'HOST'` assigned in DB
4. `LiveClassParticipant` record created with `role = 'HOST'`
5. LiveKit token can be obtained
6. SUPER_ADMIN receives host controls in the room
7. If class is SCHEDULED, SUPER_ADMIN's join auto-starts it
8. SUPER_ADMIN appears in the participant list with HOST role
9. SUPER_ADMIN appears in attendance records

**What should happen:** SUPER_ADMIN joining a PUBLIC stream they did not create should receive `'STUDENT'` role.

**Do not fix.** Record only.

---

### LCSV-002 — SUPER_ADMIN Treated as Staff in Live Class Controllers

**Severity:** MEDIUM  
**File:** `backend/src/controllers/live-class.controller.js`

Multiple controller functions include `'SUPER_ADMIN'` in staff role checks:

| Function | Code | Effect |
|----------|------|--------|
| `createLiveClass` (~line 567) | `['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req))` | SUPER_ADMIN can create school live classes |
| `deleteMessage` (~line 1610) | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` | SUPER_ADMIN can delete any chat message as "host" |
| `sendMessage` (~line 1268) | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` | SUPER_ADMIN can send messages without active participant record |

**Do not fix.** Record only.

---

### SVSV-001 — SUPER_ADMIN Legacy Bypass for `feed:join:school`

**Severity:** MEDIUM  
**File:** `backend/src/app.js`  
**Line:** ~561–565

**Current code:**
```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  if (!schoolId) return;
  // SUPER_ADMIN global bypass (legacy)
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);  // joins ANY school's feed room
    return;
  }
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

**Consequence:** A SUPER_ADMIN can call `socket.emit('feed:join:school', { schoolId: anySchoolId })` and receive real-time school-scoped feed events (new posts, announcements, etc.) from ANY school on the platform.

SA-FIX-10 and SA-FIX-11 fixed the equivalent patterns for `school:join` and `class:join`. This socket event was missed.

**Do not fix.** Record only.

---

### LTSV-001 — SUPER_ADMIN Bypasses School Check in Generic LiveKit Token

**Severity:** LOW (mitigated by participant record check)  
**File:** `backend/src/controllers/livekit.controller.js: generateToken`

**Current code:**
```javascript
if (req.user.role !== 'SUPER_ADMIN') {
  // school isolation checks...
}
// Step 3 still applies to all:
const participant = await prisma.liveClassParticipant.findFirst({ where: { liveClassId, userId, isActive: true } });
if (!participant) return 403;
```

SUPER_ADMIN skips the school isolation check but is still blocked by the participant record requirement. Net effect: minimal — a SUPER_ADMIN cannot get a token for a school live class they haven't joined.

**Do not fix.** Record only.

---

### UILEAK-001 — Frontend Partially Mitigates LCSV-001

**Severity:** LOW (UI-side)  
**File:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

```typescript
// SUPER_ADMIN deliberately excluded from isStaffRole
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

The frontend correctly excludes SUPER_ADMIN from `isStaffRole`. A SUPER_ADMIN joining a public live class they did not create would:
- Backend assigns them `HOST` role (LCSV-001)
- Frontend does NOT show host controls (because `isStaffRole = false` and `lc.hostUserId ≠ user.id`)
- Result: DB says HOST, UI shows STUDENT controls — inconsistent state

The database participant record still has `role = 'HOST'`, which means the LiveKit token is issued and other backend operations that check the DB role (e.g., `deleteMessage`) would grant host-level access.

**Do not fix.** Record only.

---

## SA-Fixes Applied (Confirmed Correct)

| Fix ID | Event/System | What was fixed | File |
|--------|-------------|---------------|------|
| SA-FIX-09 | Voice speaker queue | SUPER_ADMIN no longer has implicit queue admin privilege — requires HOST/MOD VoiceParticipant | `voice-queue.controller.js` |
| SA-FIX-10 | `school:join` socket | SUPER_ADMIN bypass removed — must match JWT schoolId | `app.js` |
| SA-FIX-11 | `class:join` socket | SUPER_ADMIN bypass removed — must have active SchoolMembership | `app.js` |
| ARCH-01 | School isolation | SUPER_ADMIN global bypass removed from requireSchoolMember, assertSchoolAccess | `schoolAuth.middleware.js`, `live-class.controller.js` |
| ARCH-02 | Gift endpoint school check | SUPER_ADMIN bypass removed from checkLiveClassSchool | `live-class.routes.js` |
| SOC-P0-03 | Report alert socket | Emits to `role:SUPER_ADMIN` only, not SCHOOL_ADMIN | `report-block.controller.js` |
| SOC-P1-05 | voice:join_room | DB participation verified before socket room join | `app.js` |
| P0-04/RT-05 | liveclass:join_room | DB participation verified before socket room join | `app.js` |

---

## Security Model Summary

The realtime security model has three enforcement layers:

### Layer 1 — Socket.IO Room Membership (DB-verified)
Prevents a user from receiving room events without being a legitimate participant.
- `voice:join_room` → DB check: active `VoiceParticipant`
- `liveclass:join_room` → DB check: active `LiveClassParticipant`
- `community:join` → DB check: active `CommunityMember` + not banned
- `class:join` → DB check: active `SchoolMembership`
- `school:join` → JWT: `socket.userSchoolId === schoolId`

### Layer 2 — LiveKit Token Gate
Prevents a user from obtaining SFU credentials without a DB participant record.
- All token endpoints require the user to already be in the `VoiceParticipant` or `LiveClassParticipant` table with `isActive: true`

### Layer 3 — Server-Side Relay Authorization
Prevents a user from broadcasting impersonated or unauthorized events.
- `socket.userId` from JWT used — never client-supplied userId
- `liveclass:viewmode_changed` → DB re-reads HOST role before relaying
- `liveclass:screen_share_started` → DB verifies participant + screenShareEnabled permission
- Display names stripped from reaction events
- Rate limiting on all high-frequency events
