# HALQA Permission Model

How permissions are checked throughout the stack.

---

## Backend Permission Layers

### Layer 1 — IP Allowlist

File: `backend/src/middleware/ipAllowlist.js`  
Applied to: `/api/v1/admin/stats/*`, `/api/v1/backups/*`, `/api/v1/internal/*`

Rejects requests not originating from `ADMIN_IP_ALLOWLIST` env var. Passes through if the list is empty.

---

### Layer 2 — Authentication (`authenticate`)

File: `backend/src/middleware/auth.middleware.js`

- Verifies Bearer JWT token
- Loads user from Redis cache (30s TTL) or database
- Enforces account status: SUSPENDED → 403, BANNED → 403, INACTIVE → 403, deleted → 401
- Attaches `req.user` with: `{ id, email, role, status, schoolId, firstName, lastName, avatarUrl, deletedAt }`

Applied to: all protected routes (`router.use(authenticate)`)

---

### Layer 3 — Platform Role Authorization (`authorize`)

File: `backend/src/middleware/auth.middleware.js`

```javascript
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return 403;
    next();
  };
}
```

Used for:
- `authorize('SUPER_ADMIN')` — admin stats, backups, social reports, internal provisioning
- Checks `User.role` (platform role) — not school membership role

---

### Layer 4 — School Membership (`requireSchoolMember` / `requireSchoolRole`)

File: `backend/src/middleware/schoolAuth.middleware.js`

`requireSchoolMember(schoolIdParam?)`:
- Resolves school ID from: `req.params`, `x-school-id` header, `req.body`, `req.query`, `req.user.schoolId`
- Loads SchoolMembership from Redis (30s TTL) or database
- Requires `status === 'ACTIVE'` (SUSPENDED → 403, PENDING → 403)
- Attaches `req.schoolMembership` and `req.schoolId`
- SUPER_ADMIN must also have an explicit SchoolMembership (ARCH-01 — legacy bypass removed)

`requireSchoolRole(...roles)`:
- Must be used after `requireSchoolMember`
- Checks `req.schoolMembership.role` against allowed roles
- Used for education staff gates

**Composites** (`educationAuth.js`):

| Composite | Middleware chain | Who passes |
|-----------|-----------------|------------|
| `eduMember` | `requireSchoolMember()` | Any active school member |
| `eduStaff` | `requireSchoolMember()` + `requireSchoolRole('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN')` | Teaching staff |
| `eduAdmin` | `requireSchoolMember()` + `requireSchoolRole('SCHOOL_ADMIN', 'SUPER_ADMIN')` | School admins |
| `eduSuperAdmin` | `requireSchoolMember()` + `requireSchoolRole('SUPER_ADMIN')` | SUPER_ADMIN school members only |

---

### Layer 5 — Live Class Access (`resolveStreamAccess` / `resolveStreamStaffAccess`)

File: `backend/src/routes/live-class.routes.js`

`resolveStreamAccess`:
- Loads `streamType` from DB
- PUBLIC → passes through (any authenticated user)
- SCHOOL → applies `eduMember` (school member required)

`resolveStreamStaffAccess`:
- PUBLIC → checks `hostUserId === req.user.id` (host only)
- SCHOOL → applies `eduStaff` (teacher/admin required)

`checkLiveClassSchool` (gift endpoints):
- PUBLIC → any authenticated user
- SCHOOL → user's schoolId must match class's schoolId
- SUPER_ADMIN bypass removed (ARCH-02)

---

### Layer 6 — Voice Room Role (`checkVoiceRole`)

File: `backend/src/middleware/voiceRole.middleware.js`

```javascript
function checkVoiceRole(allowedRoles) {
  return async (req, res, next) => {
    const participant = await prisma.voiceParticipant.findUnique({ where: { roomId_userId } });
    if (!participant?.isActive) return 403;
    if (!allowedRoles.includes(participant.role)) return 403;
    req.voiceParticipant = participant;
    next();
  };
}
```

Checks the DB `VoiceParticipant.role` — never trusts client-supplied role values. SUPER_ADMIN has no bypass.

---

### Layer 7 — Controller Guards

Individual controller functions apply additional guards:

**`assertSchoolAccess(lc, user)`** — live-class.controller.js
- PUBLIC streams: open to all
- SCHOOL streams: `lc.schoolId === user.schoolId`
- SUPER_ADMIN bypass removed (ARCH-01)

**`assertHostAccess(lc, user)`** — live-class.controller.js
- PUBLIC: `lc.hostUserId === user.id` required
- SCHOOL: SCHOOL_ADMIN or matching schoolId required
- SUPER_ADMIN bypass removed (ARCH-01)

**`getEffectiveRole(req)`** — live-class.controller.js
```javascript
function getEffectiveRole(req) {
  return req.schoolMembership?.role || req.user.role;
}
```
Returns school-scoped role if available, otherwise falls back to platform role.

---

## Frontend Permission Checks

Frontend permission checks are **UI gating only** — they control visibility of buttons and sections. The backend re-validates all operations server-side.

### `useEducationRole()` hook

File: `frontend/src/hooks/useEducationRole.ts`

```typescript
const schoolRole = activeRole || userRole   // SchoolMembership.role preferred
const isAdmin    = schoolRole === 'SUPER_ADMIN' || schoolRole === 'SCHOOL_ADMIN'
const isTeacher  = isAdmin || schoolRole === 'TEACHER'
const isStudent  = schoolRole === 'STUDENT'
```

`isSuperAdminPlatform` is separate from school-level `isAdmin`.

### Live Class host detection — `LiveClassRoomImpl.tsx`

```typescript
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
// SUPER_ADMIN deliberately excluded

const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

### Voice room moderation detection — `useVoiceRoom.ts`

```typescript
export const canModerate = (role?) => role === 'HOST' || role === 'MODERATOR'
export const canSpeak    = (role?) => role === 'HOST' || role === 'MODERATOR' || role === 'SPEAKER'
```

---

## Role Guard — Privilege Escalation Prevention

File: `backend/src/utils/roleGuard.js`

```javascript
const ALLOWED_MEMBERSHIP_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN']
// SUPER_ADMIN excluded — cannot be assigned via API

const ALLOWED_USER_ROLES_APP   = ['MEMBER', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN', 'REPRESENTATIVE']
// SUPER_ADMIN excluded — cannot be assigned via application code

function assertSafeUserRole(role) {
  if (role === 'SUPER_ADMIN') throw new Error('SUPER_ADMIN role cannot be assigned through this operation');
}

function sanitizeUserData(data) {
  // Strips: role, passwordHash, deletedAt, status, schoolId, emailVerified, mustChangePassword, twoFactorSecret
}
```

All user-facing write operations that touch `User.role` must pass through `assertSafeUserRole()`. SUPER_ADMIN can only be assigned via the internal provisioning endpoint.
