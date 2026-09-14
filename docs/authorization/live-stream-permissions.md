# Live Stream Permissions (Public Streams)

Public live streams (`streamType = 'PUBLIC'`) are a sub-type of the live class system where any authenticated platform user can participate.

---

## What is a Public Live Stream

- Created by any authenticated user via `POST /live-classes` with `streamType: 'PUBLIC'`
- Not associated with any school or class
- Open to all authenticated HALQA users
- The creator becomes the HOST; everyone else joins as STUDENT

---

## Who Can Create

Any authenticated user. No school membership required.

```javascript
// Route guard for POST /live-classes
if (isPublic) return next(); // only authenticate() already applied
// SCHOOL streams require eduStaff
```

The creating user is recorded as `hostUserId` in the `live_classes` table.

---

## Who Can Join

Any authenticated user.

```javascript
// resolveStreamAccess for PUBLIC streams:
if (streamType === 'PUBLIC') {
  req._isPublicStream = true;
  return next();  // no school membership check
}
```

Capacity is still enforced (`maxParticipants`). Previously-kicked users cannot rejoin (`wasKicked` flag).

---

## Role Assignment in Public Streams

```javascript
// LCSV-001 FIX: SUPER_ADMIN removed — platform admin is not a live class host.
const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN';
const isStaff = ['TEACHER', 'SCHOOL_ADMIN'].includes(effectiveRole);
const isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId;
const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

- Creator (`hostUserId === userId`) → `HOST`
- School staff (TEACHER / SCHOOL_ADMIN) → `HOST`
- Everyone else, including SUPER_ADMIN → `STUDENT`

---

## Staff Access Gates in Public Streams

For host-only operations on a PUBLIC stream, `resolveStreamStaffAccess` checks:

```javascript
if (streamType === 'PUBLIC') {
  if (hostUserId !== req.user.id) return 403; // only the original host
  req._isPublicStream = true;
  return next();
}
```

Only the original creator can: start, end, update, delete, mute participants, kick, manage hand raises, recording, whiteboard, poll, Quran sync.

---

## SUPER_ADMIN and Public Streams

| Action | Granted to SUPER_ADMIN | Reason |
|--------|----------------------|--------|
| Join a public stream (as STUDENT) | ✅ Yes | Any authenticated user can join |
| Create a public stream | ✅ Yes | Any authenticated user can create |
| Become HOST of their own public stream | ✅ Yes | `isPublicHost` check (hostUserId === user.id) |
| Receive HOST role in someone else's public stream | ❌ No (fixed) | `SUPER_ADMIN` removed from `isTeacher`/`isStaff` — LCSV-001 fixed |
| Host controls on someone else's public stream | ❌ No | `resolveStreamStaffAccess` checks `hostUserId` for PUBLIC streams |
| Send gifts in a public stream | ✅ Yes | `checkLiveClassSchool` passes for PUBLIC streams (any auth user) |

---

## Capability Matrix (Public Streams)

| Capability | Creator (HOST) | Participant (STUDENT) |
|-----------|---------------|----------------------|
| View stream | ✅ | ✅ |
| Join stream | ✅ | ✅ |
| Leave stream | ✅ | ✅ |
| Start stream | ✅ | ❌ |
| End stream | ✅ | ❌ |
| Receive LiveKit token | ✅ | ✅ |
| Publish camera/mic | ✅ | ✅ (mute-controlled) |
| Screen share | ✅ | ✅ if `screenShareEnabled` |
| Mute participants | ✅ | ❌ |
| Kick participants | ✅ | ❌ |
| Toggle open mic | ✅ | ❌ |
| Start/stop recording | ✅ | ❌ |
| Whiteboard / poll / Quran sync | ✅ | ❌ |
| Send chat | ✅ | ✅ |
| Send gifts | ✅ | ✅ |
| Delete any message | ✅ | ❌ |
| Delete own message | ✅ | ✅ |
