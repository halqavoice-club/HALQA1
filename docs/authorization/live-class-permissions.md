# Live Class Permissions

---

## Stream Types

| Type | Who can access | Access mechanism |
|------|---------------|-----------------|
| `SCHOOL` | Active members of the school that owns the class | `requireSchoolMember()` via `resolveStreamAccess` |
| `PUBLIC` | Any authenticated user | `authenticate` only |

---

## Role Assignment (Server-Side)

Roles are assigned when a user calls `POST /live-classes/:id/join`. The assignment logic in `joinLiveClass()`:

```javascript
const effectiveRole = getEffectiveRole(req);  // schoolMembership.role || user.role
const isTeacher   = user.role === 'TEACHER' || user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN';
const isStaff     = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);
const isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId;

const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

⚠️ **SCOPE VIOLATION:** `SUPER_ADMIN` is included in `isTeacher` and `isStaff`. This grants `HOST` role to a platform admin when they join any live class. See [known-gaps.md](./known-gaps.md) — violation `LCSV-001`.

---

## Capability Matrix

| Capability | HOST | STUDENT | Middleware / Guard |
|-----------|------|---------|-------------------|
| View live class details | ✅ | ✅ | `resolveStreamAccess` |
| Join live class | ✅ | ✅ | `resolveStreamAccess` |
| Leave live class | ✅ | ✅ | `resolveStreamAccess` |
| Send chat messages | ✅ | ✅ | `resolveStreamAccess` |
| Receive LiveKit token | ✅ | ✅ | `resolveStreamAccess` + active participant record |
| Raise hand | ❌ | ✅ | `resolveStreamAccess` |
| Publish camera | ✅ | ✅* | LiveKit `canPublish: true` for all; mic control via socket |
| Publish microphone | ✅ | ✅* | LiveKit `canPublish: true`; mute state enforced by frontend |
| Screen share | ✅ | ✅ if `screenShareEnabled` | GAP-03: SFU-level restriction on non-hosts |
| Start live class | ✅ | ❌ | `resolveStreamStaffAccess` |
| End live class | ✅ | ❌ | `resolveStreamStaffAccess` |
| Mute a participant | ✅ | ❌ | `resolveStreamStaffAccess` |
| Mute all | ✅ | ❌ | `resolveStreamStaffAccess` |
| Unmute all | ✅ | ❌ | `resolveStreamStaffAccess` |
| Kick a participant | ✅ | ❌ | `resolveStreamStaffAccess` |
| Approve/reject hand raise | ✅ | ❌ | `resolveStreamStaffAccess` |
| Lower all hands | ✅ | ❌ | `resolveStreamStaffAccess` |
| View attendance | ✅ | ❌ | `resolveStreamStaffAccess` |
| Toggle open mic | ✅ | ❌ | `resolveStreamStaffAccess` |
| Start/stop recording | ✅ | ❌ | `resolveStreamStaffAccess` |
| Broadcast whiteboard | ✅ | ❌ | `resolveStreamStaffAccess` |
| Broadcast poll | ✅ | ❌ | `resolveStreamStaffAccess` |
| Broadcast Quran position | ✅ | ❌ | `resolveStreamStaffAccess` |
| Delete any message | ✅ | ❌ | `getEffectiveRole` check in `deleteMessage` |
| Delete own message | ✅ | ✅ | Owner check in `deleteMessage` |
| Send gifts (school stream) | ✅ | ✅ | `checkLiveClassSchool` — same-school users only |
| Send gifts (public stream) | ✅ | ✅ | `checkLiveClassSchool` — any authenticated user |

*Mic/camera publish: LiveKit token grants `canPublish: true` to ALL participants. The mute state is enforced by the frontend via socket events (`liveclass:you_can_speak`, `liveclass:mute_changed`). This is an intentional design choice to avoid LiveKit reconnects on role changes.

---

## LiveKit Token Grants (Live Class)

Endpoint: `POST /live-classes/:id/token` or `POST /live-classes/:id/livekit-token`

Requirements:
- Active `liveClassParticipant` record in DB (`isActive: true`)
- Class must not be ENDED or CANCELLED

Grants (all participants):
```javascript
{
  roomJoin:             true,
  room:                 lc.livekitRoomName,
  canPublish:           true,        // ALL participants
  canSubscribe:         true,
  canPublishData:       true,
  canUpdateOwnMetadata: true,
  // canPublishSources restricted for non-hosts when screenShareEnabled = false
}
```

Screen share restriction (GAP-03 fix — SFU-level):
- HOST: always allowed to screen share
- Non-HOST + `screenShareEnabled = false`: token explicitly excludes `screen_share` and `screen_share_audio` from `canPublishSources`

Token TTL: `1h` (reduced from 8h to limit post-kick token reuse)

---

## Enrollment Gate (School Streams Only)

For SCHOOL streams, non-staff participants must pass an enrollment check before joining:

```javascript
// Non-staff joining a SCHOOL stream:
const student = await prisma.student.findFirst({ where: { userId } });
if (!student) return 403; // no student profile

const enrolled = await prisma.enrollment.findFirst({
  where: { studentId: student.id, classId: lc.classId, isActive: true }
});
if (!enrolled) return 403; // not enrolled in this class

// Was-kicked check
const existingRecord = await prisma.liveClassParticipant.findFirst({ where: { liveClassId, userId } });
if (existingRecord?.wasKicked) return 403;

// Capacity check
if (currentCount >= lc.maxParticipants) return 403;
```

---

## Socket.IO Room Events

Users can join the `liveclass:{id}` socket room only if they have an active `liveClassParticipant` DB record (SA fix: `liveclass:join_room` event verifies participation).

Host-only socket events are re-verified server-side:
- `liveclass:viewmode_changed`: server reads `role: 'HOST'` from DB before relaying
- `liveclass:screen_share_started`: server verifies participation + `screenShareEnabled`
