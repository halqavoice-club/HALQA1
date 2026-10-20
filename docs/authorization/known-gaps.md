# Known Gaps — Authorization Audit Findings

**Audit date:** 2026-08-26  
**Auditor:** Automated codebase audit (read-only)  
**Scope:** Full codebase — backend, frontend, mobile  

> **IMPORTANT:** This document records findings only. No application code was modified as part of this audit. All items below require deliberate engineering decisions before any fix is applied.

---

## SUPER_ADMIN SCOPE VIOLATIONS

Findings where the SUPER_ADMIN platform role grants content-participation privileges that violate the platform-vs-content separation principle.

---

### LCSV-001 — SUPER_ADMIN Receives HOST Role When Joining a Live Class

**Severity:** HIGH  
**Category:** SUPER_ADMIN Scope Violation  
**Status:** ✅ FIXED

**File:** `backend/src/controllers/live-class.controller.js`  
**Function:** `joinLiveClass()`

**Fix applied:**

```javascript
// LCSV-001 FIX: SUPER_ADMIN removed — platform admin is not a live class teacher/host.
const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN';
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN'].includes(effectiveRole);
const role      = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

SUPER_ADMIN joining any live stream now receives `STUDENT` role unless they are the actual stream creator (`isPublicHost`) or hold a school staff membership (`TEACHER` / `SCHOOL_ADMIN` via `req.schoolMembership.role`).

---

### LCSV-002 — SUPER_ADMIN Treated as Staff in Multiple Live Class Controller Functions

**Severity:** MEDIUM  
**Category:** SUPER_ADMIN Scope Violation  
**Status:** NOT FIXED

**File:** `backend/src/controllers/live-class.controller.js`

Several controller functions check `getEffectiveRole(req)` against a list that includes `'SUPER_ADMIN'`, granting staff-level content access:

| Function | Line (approx) | Code | Grants |
|----------|--------------|------|--------|
| `createLiveClass` | ~567 | `['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req))` | Can create a school live class, auto-create teacher profile |
| `deleteMessage` | ~1610 | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` | Can delete any chat message in a live class |
| `sendMessage` | ~1268 | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` | Can send message without active participant record |

**Expected behavior:**  
- Creating school live classes requires school staff membership, not platform admin role.
- Deleting live class chat messages requires being an active participant with HOST role.
- Sending messages requires being an active participant.

**Security impact:** Platform admin can manipulate content in school live class sessions.

**Recommended fix:**  
Remove `'SUPER_ADMIN'` from content-participation checks. The effective role already resolves `schoolMembership.role || user.role`, so a SUPER_ADMIN who also holds a SCHOOL_ADMIN school membership will still pass correctly.

---

### LCSV-003 — SUPER_ADMIN Bypasses School Isolation in `setVideoState`

**Severity:** LOW  
**Category:** SUPER_ADMIN Scope Violation  
**Status:** NOT FIXED

**File:** `backend/src/controllers/live-class.controller.js`  
**Function:** `setVideoState()`  
**Line:** ~1701

**Current behavior:**

```javascript
if (req.user.id !== userId && getEffectiveRole(req) !== 'SUPER_ADMIN') {
  return errorResponse(res, 'You can only update your own video state', 403);
}
```

SUPER_ADMIN can set the `isVideoOn` state for any participant in any live class — including classes at other schools.

**Expected behavior:**  
Video state is self-managed only. No role, including SUPER_ADMIN, should be able to change another participant's video state.

**Security impact:** Low (video state only, not mic or kick). Platform admin can force-toggle another user's video indicator.

**Recommended fix:** Remove the SUPER_ADMIN bypass entirely. Self-only update is the correct and sufficient rule.

```javascript
// PROPOSED (do not apply without review):
if (req.user.id !== userId) {
  return errorResponse(res, 'You can only update your own video state', 403);
}
```

---

### SVSV-001 — SUPER_ADMIN Socket Legacy Bypass for School Feed Room

**Severity:** MEDIUM  
**Category:** SUPER_ADMIN Scope Violation  
**Status:** NOT FIXED

**File:** `backend/src/app.js`  
**Event:** `feed:join:school`  
**Lines:** ~561–565

**Current behavior:**

```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  // SUPER_ADMIN global bypass (legacy)
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);
    return;
  }
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

SUPER_ADMIN can subscribe to the school-scoped feed Socket.IO room for ANY school, receiving real-time feed events (new posts, announcements, etc.) from every school on the platform.

**Expected behavior:**  
SUPER_ADMIN should be subject to the same school-isolation rule as all other users for socket subscriptions. The comment itself labels this "legacy". SA-FIX-10 and SA-FIX-11 fixed the equivalent patterns for `school:join` and `class:join` — this one was missed.

**Security impact:** Platform admin can monitor real-time feed activity of any school without being a member. Potential privacy concern for school communities.

**Recommended fix:**  
Apply the same school isolation as `school:join`:

```javascript
// PROPOSED (do not apply without review):
socket.on('feed:join:school', ({ schoolId } = {}) => {
  if (!schoolId) return;
  if (socket.userSchoolId !== schoolId) return; // no global bypass
  socket.join(`feed:school:${schoolId}`);
});
```

---

### LTSV-001 — SUPER_ADMIN Bypasses School Isolation in Generic LiveKit Token Endpoint

**Severity:** LOW (mitigated by participant check)  
**Category:** SUPER_ADMIN Scope Violation  
**Status:** PARTIALLY MITIGATED

**File:** `backend/src/controllers/livekit.controller.js`  
**Function:** `generateToken()`  
**Lines:** ~114–153

**Current behavior:**

```javascript
if (req.user.role !== 'SUPER_ADMIN') {
  // school isolation checks...
}
// Step 3: must have active liveClassParticipant (applies to all)
```

The school isolation check (verifying the user belongs to the same school as the live class) is skipped for SUPER_ADMIN. However, step 3 — the active `liveClassParticipant` record requirement — still applies to all users including SUPER_ADMIN.

**Net impact:**  
SUPER_ADMIN cannot obtain a token for a school live class they haven't joined (participant check still blocks them). However, if they have somehow been added as a participant (e.g., via LCSV-001 — by joining the class), the school isolation layer provides no additional defense.

**Expected behavior:**  
All users, including SUPER_ADMIN, should pass the school isolation check when requesting tokens for school-scoped resources.

**Recommended fix:**  
Remove the `req.user.role !== 'SUPER_ADMIN'` condition.

---

### UISV-001 — `useEducationRole` Grants `isAdmin` to SUPER_ADMIN via School Role Fallback

**Severity:** LOW (UI only — backend re-validates)  
**Category:** SUPER_ADMIN Scope Violation (frontend only)  
**Status:** PARTIALLY ADDRESSED

**File:** `frontend/src/hooks/useEducationRole.ts`  
**Lines:** ~50–54

**Current behavior:**

```typescript
const schoolRole = activeRole || userRole  // falls back to userRole (= 'SUPER_ADMIN')
const isAdmin    = schoolRole === 'SUPER_ADMIN' || schoolRole === 'SCHOOL_ADMIN'
```

When `activeRole` is null/undefined (SUPER_ADMIN has no SchoolMembership for the current school), `schoolRole` falls back to `userRole = 'SUPER_ADMIN'`, making `isAdmin = true`. This shows admin UI controls (manage students, edit classes, etc.) to a platform admin with no school membership.

**Expected behavior:**  
`isAdmin` for school-level UI should only be true if the user has an explicit `SCHOOL_ADMIN` SchoolMembership. Platform role should not leak into school-level admin UI.

**Security impact:** UI-only — backend returns 403 for any actual admin operations. Risk is confusion and potential CSRF-style UX attacks (admin sees and clicks a button that the backend will reject).

The file already contains a comment (HALQA-ARCH-04) noting this issue. The fix has been partially addressed by adding the `isSuperAdminPlatform` flag, but the `isAdmin` derivation still falls back through `userRole`.

**Recommended fix:**  
```typescript
// PROPOSED (do not apply without review):
const isAdmin = schoolRole === 'SCHOOL_ADMIN'
// Do not include 'SUPER_ADMIN' platform role — school admin requires school membership
```

---

## GAPS (Non-SUPER_ADMIN)

Issues found that are not SUPER_ADMIN scope violations but are worth documenting.

---

### GAP-001 — IP Allowlist Passes Through When `ADMIN_IP_ALLOWLIST` Is Empty

**Severity:** MEDIUM  
**Category:** Configuration gap  
**Status:** NOT FIXED

The `ipAllowlist` middleware used to protect admin routes passes through when `ADMIN_IP_ALLOWLIST` is unset or empty. This means admin routes are accessible from any IP in environments where the allowlist has not been configured.

**Affected routes:** `/api/v1/admin/stats/*`, `/api/v1/backups/*`, `/api/v1/internal/*`

**Recommended fix:** Require the allowlist to be explicitly set in production; reject if empty.

---

### GAP-002 — `assertSchoolAccess` Uses Legacy `user.schoolId` Field

**Severity:** MEDIUM  
**Category:** School isolation gap  
**Status:** NOT FIXED

`assertSchoolAccess()` in `live-class.controller.js` checks `lc.schoolId !== user.schoolId` — the legacy `User.schoolId` field. It does not consult the `SchoolMembership` table. A user whose `User.schoolId` still points to an old school but whose membership has been revoked/suspended would pass this check.

The `resolveStreamAccess` middleware correctly uses `requireSchoolMember()` which does check the membership table. This is defence-in-depth — `assertSchoolAccess` is a secondary check called inside controllers.

**Recommended fix:** Consult `req.schoolMembership` (set by `requireSchoolMember`) in `assertSchoolAccess` instead of `user.schoolId`.

---

### GAP-003 — `eduStaff` Composite Includes `'SUPER_ADMIN'` as a School Role

**Severity:** LOW (requires explicit SchoolMembership)  
**Category:** Role definition gap

**File:** `backend/src/middleware/educationAuth.js`  
**Line:** ~27

```javascript
const eduStaff = [
  requireSchoolMember(),
  requireSchoolRole('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'),
];
```

`SUPER_ADMIN` is listed as an allowed role in `eduStaff`. This means a user with a SchoolMembership where `role = 'SUPER_ADMIN'` passes the staff gate. However, `SUPER_ADMIN` cannot be assigned as a SchoolMembership role through application APIs (`ALLOWED_MEMBERSHIP_ROLES` in `roleGuard.js` excludes it).

This is only reachable via direct DB write. Documenting for completeness.

**Impact:** Low — only exploitable via direct DB manipulation or emergency provisioning, not via any API.

---

### GAP-004 — Deprecated `requireSchoolAccess` in `auth.middleware.js` Still Referenced

**Severity:** LOW  
**Category:** Technical debt

The deprecated `requireSchoolAccess` in `auth.middleware.js` checks only `user.schoolId` and does not consult the SchoolMembership table. It is marked `@deprecated` in the code but may still be referenced by legacy routes not yet migrated to `schoolAuth.middleware.js`.

---

## Summary Table

| ID | Title | Severity | Domain | Status |
|----|-------|---------|--------|--------|
| LCSV-001 | SUPER_ADMIN receives HOST role when joining live class | HIGH | Content Participation | ✅ FIXED |
| LCSV-002 | SUPER_ADMIN treated as staff in live class controllers | MEDIUM | Content Participation | NOT FIXED |
| LCSV-003 | SUPER_ADMIN bypasses school isolation in setVideoState | LOW | Content Participation | NOT FIXED |
| SVSV-001 | SUPER_ADMIN legacy bypass for school feed socket room | MEDIUM | Real-Time / Socket | NOT FIXED |
| LTSV-001 | SUPER_ADMIN bypasses school check in generic LiveKit token | LOW | LiveKit | PARTIALLY MITIGATED |
| UISV-001 | useEducationRole grants isAdmin via SUPER_ADMIN role fallback | LOW | Frontend UI | PARTIALLY ADDRESSED |
| GAP-001 | IP allowlist passes through when env var is empty | MEDIUM | Configuration | NOT FIXED |
| GAP-002 | assertSchoolAccess uses legacy user.schoolId | MEDIUM | School Isolation | NOT FIXED |
| GAP-003 | eduStaff includes 'SUPER_ADMIN' as school role | LOW | Role Definition | INFORMATIONAL |
| GAP-004 | Deprecated requireSchoolAccess still in codebase | LOW | Technical Debt | INFORMATIONAL |

---

## Previously Fixed Violations

The following were identified as violations and have already been addressed in prior work. Listed here for traceability.

| Fix ID | Description | File |
|--------|------------|------|
| LCSV-001 | SUPER_ADMIN removed from `isTeacher`/`isStaff` in `joinLiveClass()` — receives STUDENT role instead of HOST | `live-class.controller.js` |
| ARCH-01 | SUPER_ADMIN global school bypass removed from `requireSchoolMember`, `requireSchoolAccess`, `assertSchoolAccess`, `listLiveClasses` | `schoolAuth.middleware.js`, `live-class.controller.js` |
| ARCH-02 | SUPER_ADMIN bypass removed from `checkLiveClassSchool` gift endpoint guard | `live-class.routes.js` |
| ARCH-04 | `isStaffRole` in `LiveClassRoomImpl.tsx` excludes SUPER_ADMIN | `LiveClassRoomImpl.tsx` |
| SA-FIX-09 | SUPER_ADMIN removed from voice queue admin check | `voice-queue.controller.js` |
| SA-FIX-10 | SUPER_ADMIN global bypass removed from `school:join` socket event | `app.js` |
| SA-FIX-11 | SUPER_ADMIN global bypass removed from `class:join` socket event | `app.js` |
| SOC-P0-03 | Report alert socket emits to `role:SUPER_ADMIN` only (not all admins) | `report-block.controller.js` |
