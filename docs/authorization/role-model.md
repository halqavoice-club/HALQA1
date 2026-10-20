# HALQA Role Model

---

## Role Domains

HALQA has **three distinct role domains**. A user's identity in one domain has no automatic implication in another.

```
┌─────────────────────────────────────────────────────┐
│  DOMAIN 1: Platform Role (User.role)                │
│  Stored in: users.role column                       │
│  Roles: SUPER_ADMIN, MEMBER, SCHOOL_ADMIN,          │
│         TEACHER, STUDENT, GUARDIAN, REPRESENTATIVE  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  DOMAIN 2: School Membership Role                   │
│  Stored in: school_memberships.role column          │
│  Roles: SCHOOL_ADMIN, TEACHER, STUDENT, GUARDIAN    │
│  Scope: specific school only                        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  DOMAIN 3: Content Participation Role               │
│  Stored in: live_class_participants.role            │
│             voice_participants.role                 │
│  Live Class Roles: HOST, STUDENT                    │
│  Voice Room Roles: HOST, MODERATOR, SPEAKER,        │
│                    AUDIENCE                         │
│  Scope: specific room/session only                  │
└─────────────────────────────────────────────────────┘
```

---

## Domain 1 — Platform Roles

| Role | Description | How assigned |
|------|-------------|-------------|
| `SUPER_ADMIN` | HALQA Platform Administrator. Full platform management access. No automatic school or room access. | Internal provisioning endpoint only (`/api/v1/internal/admin/provision`) |
| `MEMBER` | Social-only platform member. Can follow, post, join voice rooms, join public live streams. | Default role on registration |
| `SCHOOL_ADMIN` | Administrator of a specific school (legacy global role). New users use SchoolMembership. | Registration or role assignment |
| `TEACHER` | Teacher at a school (legacy global role). New users use SchoolMembership. | Registration or role assignment |
| `STUDENT` | Student at a school (legacy global role). New users use SchoolMembership. | Registration or school join |
| `GUARDIAN` | Parent/guardian (legacy global role). New users use SchoolMembership. | Registration |
| `REPRESENTATIVE` | School representative / recruiter role. | Role assignment |

### Legacy vs New Architecture

The codebase is in **migration** from global `User.role` to school-scoped `SchoolMembership.role`:

- **Old architecture:** `User.role` contains the education role (TEACHER, STUDENT, etc.)
- **New architecture:** `User.role` = MEMBER, education role is in `school_memberships.role`
- **Dual-path support:** `getEffectiveRole(req)` returns `req.schoolMembership?.role || req.user.role`

The `useEducationRole()` frontend hook and `educationAuth.js` middleware both handle both paths.

---

## Domain 2 — School Membership Roles

Stored in `school_memberships.role`. Checked by `requireSchoolRole()` in `schoolAuth.middleware.js`.

| Role | Description | Permissions |
|------|-------------|-------------|
| `SCHOOL_ADMIN` | Administrator of the specific school | Full school management: create classes, manage members, create live classes |
| `TEACHER` | Teacher at the specific school | Create live classes, manage class content, host school live sessions |
| `STUDENT` | Student at the specific school | Join classes, attend live sessions, submit assignments |
| `GUARDIAN` | Parent/guardian of a student at the school | View attendance, grades (read-only) |

**SUPER_ADMIN is NOT in this list.** SUPER_ADMIN cannot be assigned as a SchoolMembership role through application APIs (`ALLOWED_MEMBERSHIP_ROLES` in `roleGuard.js` excludes it).

If a SUPER_ADMIN needs to manage a specific school's data, they must be provisioned an explicit `SCHOOL_ADMIN` SchoolMembership for that school via the school management tools.

---

## Domain 3 — Live Class Participation Roles

Stored in `live_class_participants.role`. Assigned at join time by `joinLiveClass()` controller.

| Role | Assigned to | Can do |
|------|-------------|--------|
| `HOST` | School staff (TEACHER/SCHOOL_ADMIN) for school streams, or stream creator for public streams | Mute/unmute participants, kick participants, lower all hands, control recording, whiteboard, polls, Quran panel, screen share |
| `STUDENT` | All other authenticated participants | Raise hand, send chat, publish camera/mic (if not muted), receive host actions |

**Role assignment logic (server-side, `joinLiveClass()`):**

```javascript
const effectiveRole = getEffectiveRole(req);
const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'SUPER_ADMIN';
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole);
const isPublicHost = streamType === 'PUBLIC' && lc.hostUserId === userId;
const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

⚠️ **See [known-gaps.md](./known-gaps.md) — SCOPE VIOLATION:** `SUPER_ADMIN` is included in the `isTeacher`/`isStaff` checks and thus receives `HOST` role when joining any live class (school or public). This contradicts the platform-vs-content separation rule.

---

## Domain 3 — Voice Room Participation Roles

Stored in `voice_participants.role`. Defined in `voiceRole.middleware.js`.

| Role | One per room | Can do |
|------|-------------|--------|
| `HOST` | Yes (room creator) | Everything: create/end room, assign/remove MODERATOR, transfer ownership, approve queue, mute/unmute others, kick, promote/demote, mute self |
| `MODERATOR` | No (assigned by HOST) | Approve queue, mute/unmute others, kick (not HOST/other MOD), promote/demote, mute self |
| `SPEAKER` | No (promoted by HOST/MOD or via queue) | Mute/unmute self only, send chat and reactions |
| `AUDIENCE` | No (default on join) | Raise hand to join speaker queue, send chat and reactions |

**Role assignment:**
- HOST: user who calls `POST /voice/` (createRoom)
- MODERATOR: assigned by HOST via `POST /voice/:id/moderator/:userId`
- SPEAKER: via queue approval (`approveUser/approveNext`) or direct promotion (`promoteParticipant`)
- AUDIENCE: default on `POST /voice/:id/join`

SUPER_ADMIN has no special voice room role. A SUPER_ADMIN joining a voice room joins as AUDIENCE.

---

## Role Hierarchy Summary

```
PLATFORM          SCHOOL              LIVE CLASS     VOICE ROOM
─────────         ──────────          ──────────     ──────────
SUPER_ADMIN       SCHOOL_ADMIN        HOST           HOST
                  TEACHER             STUDENT        MODERATOR
MEMBER            STUDENT                            SPEAKER
                  GUARDIAN                           AUDIENCE
```

These hierarchies are **independent**. A SUPER_ADMIN is not automatically a HOST. A HOST in a live class is not a MODERATOR in a voice room.
