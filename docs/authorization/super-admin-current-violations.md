# SUPER_ADMIN Current Violations Register

**Audit date:** 2026-08-26  
**Status:** READ-ONLY — violations documented, not fixed.  
**Authority:** These findings are cross-referenced in [SUPER-ADMIN-MASTER-SPEC.md](./SUPER-ADMIN-MASTER-SPEC.md)

---

## Violation Classification

| Severity | Meaning |
|----------|---------|
| CRITICAL | SUPER_ADMIN receives content participant role with full LiveKit access |
| HIGH | SUPER_ADMIN receives elevated content access or bypasses school isolation |
| MEDIUM | SUPER_ADMIN receives partial content access or socket room bypass |
| LOW | SUPER_ADMIN receives minor unintended access; mitigated by other layers |

---

## LCSV-001 — SUPER_ADMIN Receives HOST Role in Live Class

**ID:** LCSV-001  
**Severity:** CRITICAL  
**System:** Live Class  
**Category:** Content Participation Violation  
**Status:** NOT FIXED

### Current Behavior

```javascript
// backend/src/controllers/live-class.controller.js: joinLiveClass() ~line 793
const isTeacher = req.user.role === 'TEACHER'
               || req.user.role === 'SCHOOL_ADMIN'
               || req.user.role === 'SUPER_ADMIN';   // ← VIOLATION

const isStaff   = ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(effectiveRole); // ← VIOLATION

const role = (isTeacher || isStaff || isPublicHost) ? 'HOST' : 'STUDENT';
```

When a SUPER_ADMIN joins any live class (school stream or public stream not created by them):
- `isTeacher = true` because of the SUPER_ADMIN platform role check
- `role = 'HOST'` is assigned in the `live_class_participants` table
- A `LiveClassParticipant` record with `role = 'HOST'` is created in the database

### Expected Behavior

SUPER_ADMIN platform role must NOT automatically grant HOST status in live classes.

For a PUBLIC stream the SUPER_ADMIN did NOT create: role should be `'STUDENT'`.  
For a PUBLIC stream the SUPER_ADMIN DID create: HOST is correct (via `isPublicHost` check).  
For a SCHOOL stream: join should be DENIED entirely (no school membership).

### Evidence

- File: `backend/src/controllers/live-class.controller.js`
- Lines: ~793–801
- Referenced in: [known-gaps.md](./known-gaps.md), [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md), [participant-lifecycle.md](./participant-lifecycle.md)

### Impact

1. SUPER_ADMIN obtains a `LiveClassParticipant` record with `role = 'HOST'`
2. SUPER_ADMIN can obtain a LiveKit participant token (`POST /live-classes/:id/token`)
3. SUPER_ADMIN joins the `liveclass:{id}` Socket.IO room
4. SUPER_ADMIN auto-starts any SCHEDULED live class they join
5. SUPER_ADMIN has host-level DB privileges (delete messages, mute/kick)
6. SUPER_ADMIN appears in the participant list and attendance records
7. SUPER_ADMIN's presence pollutes gift leaderboards, analytics, and attendance

### Affected Systems
- `live_class_participants` table
- LiveKit SFU (participant token issued)
- Socket.IO `liveclass:{id}` room membership
- Attendance records
- Gift leaderboard for live class
- Admin audit trail (no record that an admin joined a class)

### Recommended Fix (do not implement — document only)

Remove `'SUPER_ADMIN'` from `isTeacher` and `isStaff` checks in `joinLiveClass()`:

```javascript
// PROPOSED — not implemented
const isTeacher = req.user.role === 'TEACHER' || req.user.role === 'SCHOOL_ADMIN';
const isStaff   = ['TEACHER', 'SCHOOL_ADMIN'].includes(effectiveRole);
// SUPER_ADMIN who also has a school staff membership will still pass via effectiveRole
```

---

## LCSV-002 — SUPER_ADMIN Treated as Staff in Multiple Live Class Controller Functions

**ID:** LCSV-002  
**Severity:** HIGH  
**System:** Live Class  
**Category:** Content Participation Violation  
**Status:** NOT FIXED

### Current Behavior

Three controller functions include `'SUPER_ADMIN'` in staff/host role checks that grant content privileges:

**1. `createLiveClass` (~line 567):**
```javascript
const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req));
if (!teacher && !isAdmin) return errorResponse(res, '...', 403);
```
SUPER_ADMIN can create school live classes, auto-create a teacher profile, and is set as the stream's `hostUserId`.

**2. `deleteMessage` (~line 1610):**
```javascript
const isHost = ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req));
// ... if (msg.userId !== userId && !isHost) → 403
```
SUPER_ADMIN can delete any chat message in any live class as if they were the host.

**3. `sendMessage` (~line 1268):**
```javascript
const isTeacherOrAdmin = ['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req));
if (!isTeacherOrAdmin) {
  // requires active participant check
}
```
SUPER_ADMIN can send messages in a live class without being an active participant.

### Expected Behavior

These operations require school staff membership or active live class host status — not the SUPER_ADMIN platform role.

### Evidence

- File: `backend/src/controllers/live-class.controller.js`
- Lines: ~567, ~1268, ~1610
- Referenced in: [known-gaps.md](./known-gaps.md), [live-class-permissions.md](./live-class-permissions.md)

### Impact

SUPER_ADMIN can manipulate school live class content (create sessions, delete messages, send messages) without school authorization.

---

## LCSV-003 — SUPER_ADMIN Bypasses Self-Only Check in `setVideoState`

**ID:** LCSV-003  
**Severity:** LOW  
**System:** Live Class  
**Category:** Content Participation Violation  
**Status:** NOT FIXED

### Current Behavior

```javascript
// backend/src/controllers/live-class.controller.js: setVideoState() ~line 1701
if (req.user.id !== userId && getEffectiveRole(req) !== 'SUPER_ADMIN') {
  return errorResponse(res, 'You can only update your own video state', 403);
}
```

SUPER_ADMIN can set the `isVideoOn` state for any participant in any live class — including classes at other schools.

### Expected Behavior

Video state is self-managed only. No role, including SUPER_ADMIN, should change another participant's video state.

### Impact

Low — video state only (not mic or kick). Platform admin can force-toggle another user's camera indicator.

---

## SVSV-001 — SUPER_ADMIN Legacy Bypass for `feed:join:school` Socket Event

**ID:** SVSV-001  
**Severity:** MEDIUM  
**System:** Socket.IO / Social Feed  
**Category:** School Isolation Violation  
**Status:** NOT FIXED

### Current Behavior

```javascript
// backend/src/app.js ~line 561
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

A SUPER_ADMIN can call `socket.emit('feed:join:school', { schoolId: anySchoolId })` and receive all real-time school-scoped feed events from ANY school on the platform. The equivalent patterns for `school:join` (SA-FIX-10) and `class:join` (SA-FIX-11) have been fixed — this one was missed.

### Expected Behavior

SUPER_ADMIN should be subject to the same school isolation rule as all other users for the `feed:join:school` socket event. JWT `socket.userSchoolId` must match.

### Evidence

- File: `backend/src/app.js`
- Lines: ~561–565
- Comment in code: "SUPER_ADMIN global bypass (legacy)"
- Referenced in: [realtime-architecture.md](./realtime-architecture.md), [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md)

### Impact

Platform admin can subscribe to real-time feed updates (new posts, announcement notifications) from any school without being a member. Privacy concern for school communities.

### Recommended Fix (do not implement — document only)

```javascript
// PROPOSED — not implemented
socket.on('feed:join:school', ({ schoolId } = {}) => {
  if (!schoolId) return;
  if (socket.userSchoolId !== schoolId) return; // no global bypass
  socket.join(`feed:school:${schoolId}`);
});
```

---

## LTSV-001 — SUPER_ADMIN Bypasses School Isolation in Generic LiveKit Token Endpoint

**ID:** LTSV-001  
**Severity:** LOW (mitigated)  
**System:** LiveKit (generic token)  
**Category:** School Isolation Violation  
**Status:** PARTIALLY MITIGATED

### Current Behavior

```javascript
// backend/src/controllers/livekit.controller.js: generateToken() ~line 114
if (req.user.role !== 'SUPER_ADMIN') {
  // school isolation checks (SchoolMembership verification)
}
// Step 3: participant check applies to ALL including SUPER_ADMIN
const participant = await prisma.liveClassParticipant.findFirst({ where: { liveClassId, userId, isActive: true } });
if (!participant) return 403;
```

SUPER_ADMIN skips the school isolation check for `liveclass-*` room names. However, the active `LiveClassParticipant` record check still applies.

### Expected Behavior

All users, including SUPER_ADMIN, should pass the school isolation check when requesting tokens for school-scoped resources.

### Impact

Mitigated: a SUPER_ADMIN cannot get a token for a school live class they haven't joined (participant check still blocks them). If LCSV-001 is exploited first (joining a class and getting HOST role), LTSV-001 becomes irrelevant because the participant record already exists.

---

## UIGAP-002 — No User Session Management

**ID:** UIGAP-002  
**Severity:** HIGH  
**System:** Admin UI + Backend  
**Category:** Missing Administrative Capability

### Current Behavior

No admin API or UI exists to:
- List a user's active sessions
- Revoke specific sessions
- Force-logout a user (only account suspension achieves this indirectly)

### Expected Behavior

Platform admin should be able to immediately invalidate all sessions for a compromised account.

### Impact

Platform admin cannot immediately revoke a specific user's sessions. Must suspend the entire account, which is a coarser instrument.

---

## UIGAP-004 — No Payout Management (CRITICAL)

**ID:** UIGAP-004  
**Severity:** CRITICAL  
**System:** Admin UI + Backend  
**Category:** Missing Administrative Capability

### Current Behavior

No admin API or UI exists to:
- List payout requests
- Approve or reject payout requests
- Process diamond withdrawals

The `payout_requests` table accumulates records with no admin interface to process them.

### Expected Behavior

`GET /admin/payouts` — list requests  
`PATCH /admin/payouts/:id/status` — approve/reject with reason + audit + wallet transaction

### Impact

Payout requests require direct database access to process. The `accountDetails` field contains sensitive bank/PayPal information with no secure admin delivery mechanism.

---

## UIGAP-005 — No Admin Coin Grant API

**ID:** UIGAP-005  
**Severity:** HIGH  
**System:** Admin UI + Backend  
**Category:** Missing Administrative Capability

### Current Behavior

The `WalletTransaction.type` enum includes `'ADMIN_GRANT'` in the schema, but no API endpoint implements it. No admin UI can grant coins to a user.

### Expected Behavior

`POST /admin/users/:id/credits` — grant coins with reason, validation, transaction safety, audit log.

---

## UIGAP-007 — Emergency "End" Buttons Return 403

**ID:** UIGAP-007  
**Severity:** HIGH  
**System:** Admin UI — Live & Voice page  
**Category:** Dead/Non-Functional UI

### Current Behavior

```typescript
// admin/live-voice/page.tsx
mutationFn: (id: string) => api.post(`/live-classes/${id}/end`)     // → 403
mutationFn: (id: string) => api.patch(`/voice/${id}/end`)            // → 403
```

The "End" buttons in `/admin/live-voice` call the content-participation endpoints that require HOST/staff role. SUPER_ADMIN is not the HOST/staff of these sessions, so the backend returns 403.

### Expected Behavior

Dedicated admin termination endpoints:
- `POST /api/v1/admin/live-classes/:id/terminate`
- `POST /api/v1/admin/voice/:id/terminate`

These would bypass content-authorization (IP allowlist + SUPER_ADMIN only) while maintaining an admin audit log.

### Impact

Platform admin cannot terminate active sessions without an out-of-band mechanism. Emergency response capability is missing.

---

## UIGAP-008 — Moderation Page Uses Possibly Wrong API Path

**ID:** UIGAP-008  
**Severity:** MEDIUM  
**System:** Admin UI — Moderation page  
**Category:** Possible Routing Bug

### Current Behavior

```typescript
// admin/moderation/page.tsx
api.get(`/report-block/reports?status=${statusFilter}&limit=50`)
api.patch(`/report-block/reports/${id}/review`, ...)
```

The `social.routes.js` mounts at `/api/v1/social/reports`. The moderation page calls `/api/v1/report-block/reports`. If the backend does not have a `/api/v1/report-block/*` route, this would silently fail (reports page shows empty for all statuses).

### Expected Behavior

Path should be `/social/reports` and `/social/reports/:id/review`.

---

## UIGAP-013 — Audit Logs Missing for Several Admin Actions

**ID:** UIGAP-013  
**Severity:** HIGH  
**System:** Audit trail  
**Category:** Compliance Gap

### Current Behavior

The following admin actions do NOT write to `audit_logs`:
1. SUPER_ADMIN reads full user PII via `GET /users/:id`
2. SUPER_ADMIN reviews a social report (`PATCH /social/reports/:id/review`)
3. SUPER_ADMIN creates/updates/deletes backup metadata (`/api/v1/backups/*`)

### Expected Behavior

All admin reads of sensitive PII and all admin mutations should write an audit log entry.

---

## UIGAP-014 — System Health Endpoint May Not Require Authentication

**ID:** UIGAP-014  
**Severity:** MEDIUM  
**System:** System Health  
**Category:** Information Disclosure Risk

### Current Behavior

The admin system health page calls `GET /health/detailed`. Health check routes in Express typically do not require authentication (used by Kubernetes probes, uptime monitors).

If `/health/detailed` is publicly accessible without authentication, it exposes: memory usage, event loop lag, circuit breaker states, Redis connection status, LiveKit connection status, DB latency.

### Expected Behavior

`/health/detailed` should require authentication or be restricted to a trusted network range.

---

## UILEAK-001 — Backend Grants HOST to SUPER_ADMIN; Frontend Partially Mitigates

**ID:** UILEAK-001  
**Severity:** HIGH  
**System:** Frontend — Live Class  
**Category:** Cross-Layer Discrepancy

### Current Behavior

The frontend `LiveClassRoomImpl.tsx` correctly excludes SUPER_ADMIN from `isStaffRole`:
```typescript
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
// SUPER_ADMIN deliberately excluded
```

However, the backend assigns `HOST` role to SUPER_ADMIN in the DB (LCSV-001). This creates an inconsistency:
- DB says: `LiveClassParticipant.role = 'HOST'`
- Frontend shows: STUDENT controls (because `hostUserId ≠ user.id` for non-creator streams)

The frontend mitigation is partial — backend-level authorization checks that read `getEffectiveRole(req)` or check the `LiveClassParticipant.role` column will still see HOST, granting host-level operations via API calls.

---

## Summary Table

| ID | Severity | System | Description | Fixed? |
|----|---------|--------|-------------|--------|
| LCSV-001 | CRITICAL | Live Class | SA receives HOST role on join | ❌ |
| LCSV-002 | HIGH | Live Class | SA treated as staff in controller checks | ❌ |
| LCSV-003 | LOW | Live Class | SA bypasses self-only video state check | ❌ |
| SVSV-001 | MEDIUM | Socket.IO | SA joins any school's feed room (legacy bypass) | ❌ |
| LTSV-001 | LOW | LiveKit | SA bypasses school check in generic token | ❌ (mitigated) |
| UIGAP-002 | HIGH | Admin UI | No user session management | ❌ (missing) |
| UIGAP-004 | CRITICAL | Admin UI | No payout management | ❌ (missing) |
| UIGAP-005 | HIGH | Admin UI | No admin coin grant | ❌ (missing) |
| UIGAP-007 | HIGH | Admin UI | End buttons return 403 | ❌ (missing endpoint) |
| UIGAP-008 | MEDIUM | Admin UI | Moderation page API path discrepancy | ❓ (needs verification) |
| UIGAP-013 | HIGH | Audit | Missing audit logs for PII reads, report reviews, backups | ❌ |
| UIGAP-014 | MEDIUM | Health | /health/detailed may be unauthenticated | ❓ (needs verification) |
| UILEAK-001 | HIGH | Frontend | Backend/frontend role discrepancy from LCSV-001 | ❌ (symptom of LCSV-001) |
