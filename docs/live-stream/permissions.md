# Live Stream — Permissions

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation audit. No application code modified.

---

## Who Can Create a Public Live Stream

**Answer:** Any authenticated platform user.

No school membership, no Teacher record, no SCHOOL_ADMIN role required.

```javascript
// live-class.routes.js — POST /
router.post('/',
  (req, res, next) => {
    const isPublic = req.body?.streamType === 'PUBLIC' || req.body?.isPublic === true;
    if (isPublic) return next(); // only authenticate() already applied — no school check
    // SCHOOL stream: require school staff role
    const middlewares = eduStaff;
    ...
  },
  validateZod(createLiveClassSchema),
  ...
  ctrl.createLiveClass
);
```

The `CreateLiveClassModal` UI reflects this: the "Public Live Stream" option is shown to all users; the "School Live Class" option is greyed out for users without a school staff role.

---

## Roles in a Public Live Stream

| Role | Who receives it | How assigned |
|------|----------------|--------------|
| `HOST` | Stream creator (`lc.hostUserId === userId`) | Assigned in `joinLiveClass()` via `isPublicHost` check |
| `HOST` | School staff (TEACHER/SCHOOL_ADMIN) | Assigned via `isTeacher`/`isStaff` checks (note: LCSV-001 also includes SUPER_ADMIN) |
| `STUDENT` | All other viewers | Default role for everyone else |

There is no MODERATOR role in live classes (that is a voice room concept). No co-host feature.

---

## Permission Matrix (PUBLIC Stream)

| Capability | HOST (creator) | STUDENT (viewer) | Notes |
|-----------|---------------|-----------------|-------|
| Create stream | ✅ | ✅ (any auth user) | `authenticate` only |
| View stream | ✅ | ✅ (any auth user) | `resolveStreamAccess` passes for PUBLIC |
| Join stream | ✅ | ✅ (any auth user) | No enrollment check |
| Leave stream | ✅ | ✅ | |
| Get LiveKit token | ✅ | ✅ | Requires active participant record |
| Publish audio/camera | ✅ | ✅ (if not muted) | `canPublish: true` for all |
| Screen share | ✅ | ✅ (if `screenShareEnabled=true`) | SFU-enforced restriction |
| Start stream | ✅ | ❌ | `resolveStreamStaffAccess` → checks `hostUserId === req.user.id` |
| End stream | ✅ | ❌ | Same |
| Update stream settings | ✅ | ❌ | Same |
| Delete stream | ✅ | ❌ | Same |
| Mute a viewer | ✅ | ❌ | Same |
| Mute all | ✅ | ❌ | Same + `assertHostAccess` |
| Kick a viewer | ✅ | ❌ | Same |
| Raise hand | ✅ | ✅ | `resolveStreamAccess` |
| Approve/reject hand | ✅ | ❌ | `resolveStreamStaffAccess` |
| Toggle open mic | ✅ | ❌ | `resolveStreamStaffAccess` |
| Send chat | ✅ | ✅ | `resolveStreamAccess` |
| Delete any message | ✅ | ❌ | HOST check in controller |
| Start/stop recording | ✅ | ❌ | `resolveStreamStaffAccess` |
| Broadcast whiteboard | ✅ | ❌ | `resolveStreamStaffAccess` |
| Broadcast poll | ✅ | ❌ | `resolveStreamStaffAccess` |
| Send gifts | ✅ | ✅ (any auth user) | `checkLiveClassSchool` passes for PUBLIC |
| View attendance | N/A | N/A | No attendance for PUBLIC streams |
| View stream list | ✅ | ✅ | `GET /live-classes?streamType=PUBLIC` |

---

## `resolveStreamStaffAccess` for PUBLIC Streams

```javascript
async function resolveStreamStaffAccess(req, res, next) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT id, stream_type as streamType, host_user_id as hostUserId FROM live_classes WHERE id = ? LIMIT 1',
    id
  );
  const streamType = lc.streamType || 'SCHOOL';
  const hostUserId = lc.hostUserId || null;

  if (streamType === 'PUBLIC') {
    if (!req.user) return 401;
    if (hostUserId !== req.user.id) return 403; // Only the creator can manage
    req._isPublicStream = true;
    return next();
  }
  // SCHOOL → eduStaff
}
```

**Result:** For PUBLIC streams, only `hostUserId === req.user.id` passes staff-level operations. No school check needed.

---

## Gift Sending (PUBLIC Streams)

```javascript
// checkLiveClassSchool middleware
async function checkLiveClassSchool(req, res, next) {
  const streamType = lc.streamType || 'SCHOOL';
  // PUBLIC streams: any authenticated user can send gifts
  if (streamType === 'PUBLIC') return next();
  // SCHOOL streams: user must belong to that school
  if (lc.schoolId !== userSchoolId) return 403;
  next();
}
```

Any authenticated user can send gifts to a PUBLIC live stream, regardless of school affiliation.

---

## Capacity and Rejoin Rules

Same as school live classes:
- `maxParticipants` enforced on join (default 100, max 1000)
- `wasKicked = true` permanently blocks rejoin for the session
- No enrollment check → viewers can join/rejoin freely (unless kicked)

---

## SUPER_ADMIN Permission Summary

| Action | Status | Notes |
|--------|--------|-------|
| Create a public stream (personal action) | ✅ ALLOWED | Any auth user can create |
| Join stream they created as HOST | ✅ ALLOWED | `isPublicHost` check works correctly |
| Join someone else's PUBLIC stream as STUDENT | ✅ SHOULD BE | Intended behavior |
| Join someone else's PUBLIC stream as HOST | ⚠️ VIOLATION | LCSV-001: SUPER_ADMIN receives HOST via `isTeacher`/`isStaff` |
| Send gifts to a PUBLIC stream | ✅ ALLOWED | Same as any user |
| View PUBLIC stream list | ✅ ALLOWED | Same as any user |
| Terminate PUBLIC stream (admin API) | ❌ MISSING | No dedicated admin endpoint |
| Use content moderation on PUBLIC stream | ❌ DENIED | Requires HOST participant role |
