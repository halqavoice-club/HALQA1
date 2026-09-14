# Live Class — Known Gaps and Violations

**Audit date:** 2026-08-26  
**Rule:** Read-only — no fixes applied. All findings documented only.  
**Cross-reference:** [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md)

---

## SUPER_ADMIN Scope Violations

### LCSV-001 — SUPER_ADMIN Receives HOST Role When Joining Any Live Class

**Severity:** CRITICAL  
**File:** `backend/src/controllers/live-class.controller.js`  
**Function:** `joinLiveClass()`  
**Status:** ✅ FIXED

SUPER_ADMIN is now blocked at the top of `joinLiveClass()` with HTTP 403 before any role computation, participant record creation, attendance tracking, or auto-start logic. They also cannot call `leaveLiveClass()` or `getLiveKitToken()`.

---

### LCSV-002 — SUPER_ADMIN Treated as Staff in Multiple Controller Functions

**Severity:** HIGH  
**File:** `backend/src/controllers/live-class.controller.js`

| Function | Line | Violation |
|----------|------|-----------|
| `createLiveClass` | ~567 | `['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req))` — admin can create school live classes |
| `deleteMessage` | ~1610 | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` — admin can delete any chat message |
| `sendMessage` | ~1268 | `['TEACHER','SCHOOL_ADMIN','SUPER_ADMIN'].includes(getEffectiveRole(req))` — admin can send messages without participant record |

**Do not fix.** Document only.

---

### LCSV-003 — SUPER_ADMIN Bypasses Self-Only Rule in `setVideoState`

**Severity:** LOW  
**File:** `backend/src/controllers/live-class.controller.js`  
**Line:** ~1701

**Current code:**
```javascript
if (req.user.id !== userId && getEffectiveRole(req) !== 'SUPER_ADMIN') {
  return errorResponse(res, 'You can only update your own video state', 403);
}
```

**Effect:** SUPER_ADMIN can set the `isVideoOn` state for any participant in any live class.  
**Do not fix.** Document only.

---

### UILEAK-001 — Backend/Frontend Role Discrepancy

**Severity:** MEDIUM  
**Files:** 
- `backend/src/controllers/live-class.controller.js` (assigns HOST)
- `frontend/src/components/live-class/LiveClassRoomImpl.tsx` (shows STUDENT UI)
- `mobile/app/live-class/[id].tsx` (shows STUDENT UI)

**Current state:**
- Backend assigns `HOST` role to SUPER_ADMIN (LCSV-001)
- Frontend `isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')` — excludes SUPER_ADMIN ✅
- Mobile `isTeacher = ['TEACHER','SCHOOL_ADMIN'].includes(user?.role || '')` — excludes SUPER_ADMIN ✅
- Result: DB says HOST, frontend shows STUDENT controls (unless `lc.hostUserId === user.id`)
- API calls that read `LiveClassParticipant.role` from DB still see HOST and grant host-level access

**Do not fix.** Document only.

---

## Missing Administrative Capabilities

### LC-ADMIN-001 — No Dedicated Admin Live Class Termination Endpoint

**Severity:** HIGH  
**Impact:** The "End" buttons in `/admin/live-voice` admin UI page call `POST /live-classes/:id/end` (the content-participation endpoint). SUPER_ADMIN receives 403 from `resolveStreamStaffAccess` unless they are the HOST.

**What is needed:**
```
POST /api/v1/admin/live-classes/:id/terminate
  → ipAllowlist + authorize('SUPER_ADMIN')
  → End the class (same logic as endLiveClass)
  → Write audit log entry
  → No LiveClassParticipant record created
```

**Current workaround:** Suspend the host user's account to prevent continuation.  
**Do not implement.** Document only.

---

## Missing Audit Logging

### LC-AUDIT-001 — No Audit Trail for Live Class Operations

**Severity:** HIGH  
**Current state:** Zero `AuditLog` entries are written for any live class operation.

**Operations that should be audited but are not:**
- Class creation
- Class start / end
- Participant kick
- Participant ban (feature not yet present)
- Mute/unmute
- Recording start/stop
- SUPER_ADMIN access to live class

**Do not implement.** Document only.

---

## Missing Features (Schema Supports, No API)

### LC-GAP-001 — `OBSERVER` Role Defined But Unused

The `LiveClassParticipantRole` enum includes `OBSERVER` but no code path assigns it. A read-only observer role for administrators or guardians would be a natural extension.

---

### LC-GAP-002 — No Admin Termination Endpoint

Documented as LC-ADMIN-001 above.

---

### LC-GAP-003 — Recording Storage Not Integrated

`recordingUrl` field exists in the schema and is set by `stopRecording()` endpoint, but the actual recording infrastructure (LiveKit recording, cloud storage) is not implemented. The URL must be supplied by the client in the request body.

---

### LC-GAP-004 — Poll Vote Identity Fixed But History Not Persisted

Poll votes use `req.user.id` for identity (P2-01 fix). However, poll state is stored in Redis only (no DB persistence). Poll results are lost on Redis flush or server restart.

---

### LC-GAP-005 — Whiteboard State in Redis Only

Whiteboard state (`getWhiteboardState`) is served from Redis cache, not a database table. Whiteboard content is lost on Redis flush.

---

## Test Coverage Gaps

### LC-TEST-001 — No Test for LCSV-001

The `platform-admin-scope.test.js` file tests SA-FIX-01 (isStaffRole exclusion in frontend source), but the backend `joinLiveClass()` SUPER_ADMIN HOST assignment is not directly tested as a violation.

The existing `live-class-p0-security.test.js` and `live-class-p1-reliability.test.js` test SUPER_ADMIN cross-school denial (403) but not the HOST role assignment for same-school or PUBLIC streams.

---

### LC-TEST-002 — No Integration Test for Full Join Flow

Unit tests mock Prisma. There is no integration test that verifies the complete join flow end-to-end (authentication → school check → enrollment check → participant creation → token issuance).

---

## Summary Table

| ID | Severity | Category | Description | Fixed? |
|----|---------|---------|-------------|--------|
| LCSV-001 | CRITICAL | SUPER_ADMIN | SA blocked entirely from join/token/leave | ✅ |
| LCSV-002 | HIGH | SUPER_ADMIN | SA treated as staff in 3 controller functions | ❌ |
| LCSV-003 | LOW | SUPER_ADMIN | SA bypasses self-only video state check | ❌ |
| UILEAK-001 | MEDIUM | SUPER_ADMIN | Backend/frontend HOST role discrepancy | ✅ (moot — SA now blocked at join) |
| LC-ADMIN-001 | HIGH | Admin | No dedicated admin termination endpoint | ❌ missing |
| LC-AUDIT-001 | HIGH | Audit | No audit logging for live class operations | ❌ missing |
| LC-GAP-001 | LOW | Feature | OBSERVER role unused | ❌ missing |
| LC-GAP-003 | MEDIUM | Feature | Recording storage not integrated | ❌ missing |
| LC-GAP-004 | LOW | Feature | Poll state not persisted to DB | ❌ missing |
| LC-GAP-005 | LOW | Feature | Whiteboard state not persisted to DB | ❌ missing |
| LC-TEST-001 | MEDIUM | Tests | No test for LCSV-001 HOST assignment | ❌ missing |
| LC-TEST-002 | LOW | Tests | No integration test for full join flow | ❌ missing |
