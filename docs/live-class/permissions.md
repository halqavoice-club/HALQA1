# Live Class — Role Model and Permission Matrix

**Source:** `backend/src/controllers/live-class.controller.js`, `backend/src/routes/live-class.routes.js`, `frontend/src/components/live-class/LiveClassRoomImpl.tsx`, `mobile/app/live-class/[id].tsx`  
**Audit date:** 2026-08-26

---

## Roles That Exist

There are exactly **two** live class participant roles in the database:

| Role | Value | Assigned to |
|------|-------|-------------|
| `HOST` | `LiveClassParticipantRole.HOST` | School staff (TEACHER, SCHOOL_ADMIN) for SCHOOL streams; stream creator for PUBLIC streams |
| `STUDENT` | `LiveClassParticipantRole.STUDENT` | All other participants |

`OBSERVER` exists in the enum but is not used anywhere in the current codebase.

---

## Role Assignment Logic (Server-Side)

```javascript
// backend/src/controllers/live-class.controller.js: joinLiveClass()
const effectiveRole  = req.schoolMembership?.role || req.user.role;
const isTeacher      = user.role === 'TEACHER' || user.role === 'SCHOOL_ADMIN' || user.role === 'SUPER_ADMIN'; // ← LCSV-001 violation
const isStaff        = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);                     // ← LCSV-001 violation
const isPublicHost   = streamType === 'PUBLIC' && lc.hostUserId === userId;
const role           = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

**Expected behavior** (per the platform specification):

| Condition | Expected role | Current role | Correct? |
|-----------|--------------|--------------|---------|
| SCHOOL stream + TEACHER/SCHOOL_ADMIN membership | HOST | HOST | ✅ |
| SCHOOL stream + STUDENT membership (enrolled) | STUDENT | STUDENT | ✅ |
| PUBLIC stream + stream creator (hostUserId match) | HOST | HOST | ✅ |
| PUBLIC stream + other authenticated user | STUDENT | STUDENT | ✅ |
| PUBLIC stream + SUPER_ADMIN (not creator) | STUDENT | HOST | ⚠️ LCSV-001 |
| SCHOOL stream + SUPER_ADMIN | DENIED | HOST (if bypass) | ⚠️ LCSV-001 / blocked at route level |

---

## Permission Matrix

| Capability | HOST | STUDENT | Implementation |
|-----------|------|---------|---------------|
| **Create SCHOOL stream** | ✅ | ❌ | `resolveStreamStaffAccess` (eduStaff) |
| **Create PUBLIC stream** | ✅ | ✅ (any auth user) | `authenticate` only |
| **Schedule class** | ✅ | ❌ | Part of create |
| **Join SCHOOL stream** | ✅ | ✅ (enrolled) | `resolveStreamAccess` + enrollment check |
| **Join PUBLIC stream** | ✅ | ✅ (any auth user) | `resolveStreamAccess` |
| **Leave** | ✅ | ✅ | `resolveStreamAccess` |
| **Start class** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **End class** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Update class settings** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Delete class** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Receive LiveKit token** | ✅ | ✅ | Active participant record required |
| **Publish camera** | ✅ | ✅ | `canPublish: true` (all participants) |
| **Publish microphone** | ✅ | ✅ (if unmuted) | `canPublish: true`; mic state client-controlled |
| **Screen share** | ✅ always | ✅ if `screenShareEnabled=true` | SFU-enforced via `canPublishSources` |
| **Send chat** | ✅ | ✅ | `resolveStreamAccess` |
| **Delete own message** | ✅ | ✅ | Author check |
| **Delete any message** | ✅ | ❌ | HOST check in controller |
| **Raise hand** | ❌ | ✅ | `resolveStreamAccess` (HOST already has mic) |
| **Lower own hand** | ❌ | ✅ | `resolveStreamAccess` |
| **Approve hand raise** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Reject hand raise** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Lower all hands** | ✅ | ❌ | `resolveStreamStaffAccess` + `assertHostAccess` |
| **Mute participant** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Mute all** | ✅ | ❌ | `resolveStreamStaffAccess` + `assertHostAccess` |
| **Unmute all** | ✅ | ❌ | `resolveStreamStaffAccess` + `assertHostAccess` |
| **Kick participant** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **View attendance** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Request to speak** | ✅ | ✅ | `resolveStreamAccess` |
| **Toggle open mic** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Start/stop recording** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Broadcast whiteboard** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **View whiteboard state** | ✅ | ✅ | `resolveStreamAccess` |
| **Broadcast poll** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **View poll state** | ✅ | ✅ | `resolveStreamAccess` |
| **Broadcast Quran position** | ✅ | ❌ | `resolveStreamStaffAccess` |
| **Set view mode** | ✅ | ❌ | Socket: DB re-reads HOST role |
| **Send screen share** | ✅ | ✅ if enabled | Socket + SFU enforcement |
| **Send gifts (PUBLIC stream)** | ✅ | ✅ (any auth user) | `checkLiveClassSchool` |
| **Send gifts (SCHOOL stream)** | ✅ | ✅ (same school) | `checkLiveClassSchool` |
| **Change class view mode** | ✅ | ❌ | Socket `liveclass:viewmode_changed` — HOST DB check |
| **Upload cover image** | ✅ | ❌ | `resolveStreamStaffAccess` |

---

## SUPER_ADMIN and Live Class (Platform Rule)

```
SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY
SUPER_ADMIN MUST NOT become a live class participant.
```

| Capability | Rule | Current status |
|-----------|------|---------------|
| Join SCHOOL stream | ❌ DENIED | ✅ Blocked (no school membership → 403) |
| Join PUBLIC stream | ❌ DENIED (admin capacity) | ⚠️ Accessible + receives HOST role (LCSV-001) |
| Receive HOST role | ❌ DENIED | ⚠️ Assigned by `isTeacher`/`isStaff` check (LCSV-001) |
| Receive LiveKit token | ❌ DENIED | ⚠️ Accessible if joined (LCSV-001 enables this) |
| Create school live class | ❌ DENIED | ⚠️ `isAdmin` check includes SUPER_ADMIN (LCSV-002) |
| Delete any chat message as "host" | ❌ DENIED | ⚠️ `isHost` check includes SUPER_ADMIN (LCSV-002) |
| View live session list (admin) | ✅ ALLOWED | `GET /admin/stats/live-voice` |
| View participant counts (admin) | ✅ ALLOWED | `GET /admin/stats/live-voice` |
| Terminate session (admin) | ❌ MISSING | No dedicated admin termination endpoint |

---

## Frontend Role Detection

### Web (`LiveClassRoomImpl.tsx`)

```typescript
// SUPER_ADMIN deliberately excluded
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')

// isHost: true for school staff OR for the creator of a PUBLIC stream
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

The frontend correctly excludes SUPER_ADMIN from `isStaffRole`. However, the backend assigns HOST role to SUPER_ADMIN (LCSV-001), creating an inconsistency where the DB says HOST but the frontend shows STUDENT controls (unless SUPER_ADMIN is also the `hostUserId`).

### Mobile (`mobile/app/live-class/[id].tsx`)

```typescript
// SUPER_ADMIN is platform-admin only — they must NOT automatically become host.
const isTeacher = ['TEACHER','SCHOOL_ADMIN'].includes(user?.role || '');
const isHost = user?.id === liveClass?.host?.id || isTeacher;
```

Mobile also correctly excludes SUPER_ADMIN from `isTeacher`.

---

## School Isolation Rules

For SCHOOL streams:

| Check | Location | What it enforces |
|-------|----------|-----------------|
| `resolveStreamAccess` | Route middleware | School membership required to access the stream at all |
| `assertSchoolAccess(lc, user)` | Controller | `lc.schoolId === user.schoolId` (legacy fallback check) |
| `checkLiveClassSchool` | Gift route middleware | Same-school users only for gift sending |
| Socket `liveclass:join_room` | `app.js` | Active `LiveClassParticipant.isActive` required |
| `class:join` socket | `app.js` | Active `SchoolMembership` for class's school |

**Can school A student join school B class?** ❌ NO — `resolveStreamAccess` applies `requireSchoolMember()` which checks SchoolMembership. `assertSchoolAccess` also checks `schoolId` match.

**Can an unauthorized user join?** ❌ NO — all routes require `authenticate`. SCHOOL streams additionally require school membership.

**Can SUPER_ADMIN join?** ❌ SHOULD NOT — but LCSV-001 allows it for PUBLIC streams.
