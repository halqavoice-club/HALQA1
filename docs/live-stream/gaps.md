# Live Stream — Known Gaps and Violations

**Audit date:** 2026-08-26  
**Rule:** Read-only documentation. No fixes applied.

---

## Inherited Violations from Live Class System

Public live streams share the live class infrastructure, so all live class violations apply:

### LCSV-001 — SUPER_ADMIN Receives HOST Role in PUBLIC Stream

**Severity:** CRITICAL  
**Specific to PUBLIC streams:** Unlike SCHOOL streams (which block SUPER_ADMIN at the school membership gate), PUBLIC streams allow any authenticated user to join. SUPER_ADMIN can call `POST /live-classes/:id/join` on a PUBLIC stream and receives HOST role due to the `isTeacher`/`isStaff` checks in `joinLiveClass()`.

**Current behavior:**
- SUPER_ADMIN joins a PUBLIC stream they did not create
- `isTeacher = true` (because `user.role === 'SUPER_ADMIN'`)
- `role = 'HOST'` assigned in `live_class_participants`
- SUPER_ADMIN gets LiveKit token, host controls, appears in participant list

**Expected behavior:**
- SUPER_ADMIN who is NOT the creator should receive `'STUDENT'` role
- Only `isPublicHost = lc.hostUserId === userId` should grant HOST

**File:** `backend/src/controllers/live-class.controller.js` ~line 793  
**Cross-reference:** [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md#lcsv-001)

---

### LCSV-002 — SUPER_ADMIN Treated as Staff in Controller Functions

Same as in school live classes. SUPER_ADMIN can create PUBLIC streams and delete messages as "host" via the `isAdmin`/`isHost` checks that include `'SUPER_ADMIN'`.

**Cross-reference:** [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md#lcsv-002)

---

## Public Stream-Specific Gaps

### LS-GAP-001 — No Admin Termination Endpoint for PUBLIC Streams

**Severity:** HIGH  
**Impact:** Platform admin cannot forcibly end a PUBLIC live stream that violates platform rules without suspending the host's account.

The "End" button in `/admin/live-voice` calls `POST /live-classes/:id/end`, which requires `hostUserId === req.user.id`. SUPER_ADMIN is not the `hostUserId` for streams they didn't create, so the call returns 403.

**Needed:** `POST /api/v1/admin/live-classes/:id/terminate` (IP-allowlisted + SUPER_ADMIN only)  
**Do not implement.** Document only.

---

### LS-GAP-002 — `privacy` Field UI Mismatch

**Severity:** LOW  
**Impact:** The `CreateLiveClassModal` includes a "Visibility" selector (Public / Private), setting `privacy: 'PUBLIC' | 'PRIVATE'`. However, the `LiveClass` schema has no `privacy` field. The `createLiveClass` controller ignores this field entirely. PUBLIC streams are always accessible to any authenticated user regardless of UI privacy selection.

**Current behavior:** `privacy` field in request body is silently ignored.  
**Do not fix.** Document only.

---

### LS-GAP-003 — No Host Transfer for PUBLIC Streams

**Severity:** MEDIUM  
**Impact:** PUBLIC streams cannot transfer ownership. If the creator leaves or loses connection, there is no mechanism to assign another participant as host. The stream continues but no one has host controls.

Voice rooms have `POST /voice/:id/transfer/:userId`. Live class has no equivalent.

---

### LS-GAP-004 — Feed Card Post Persists After Stream Ends

**Severity:** LOW  
**Impact:** `broadcastLiveEnd()` does NOT soft-delete the `LIVE_CLASS_SHARE` post. It emits `feed:live_ended` via socket (so connected clients see "ended" state), but users who load the feed later may still see the card in "ended" state indefinitely.

Whether this is a gap or intentional (stream history) depends on product requirements. Current behavior: posts are never deleted.

---

### LS-GAP-005 — No Test Coverage for PUBLIC Stream Authorization

**Severity:** MEDIUM  
**Impact:** The existing test files (`live-class-p0-security.test.js`, `live-class-p1-reliability.test.js`) use `streamType = 'SCHOOL'` fixtures throughout. There are no tests specifically verifying PUBLIC stream authorization:
- MEMBER user creates PUBLIC stream → receives HOST role
- SUPER_ADMIN joins PUBLIC stream (not creator) → should get STUDENT, currently gets HOST
- Kicked viewer cannot rejoin
- Cross-user gifting on PUBLIC stream

---

## Summary

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| LCSV-001 | CRITICAL | SUPER_ADMIN receives HOST when joining any PUBLIC stream | ❌ |
| LCSV-002 | HIGH | SUPER_ADMIN included in staff checks | ❌ |
| LS-GAP-001 | HIGH | No admin termination for PUBLIC streams | ❌ missing |
| LS-GAP-002 | LOW | `privacy` field silently ignored | ❌ (informational) |
| LS-GAP-003 | MEDIUM | No host transfer for PUBLIC streams | ❌ missing |
| LS-GAP-004 | LOW | Feed card never deleted after stream ends | ❌ (informational) |
| LS-GAP-005 | MEDIUM | No PUBLIC stream specific authorization tests | ❌ missing |
