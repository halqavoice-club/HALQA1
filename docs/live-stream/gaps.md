# Live Stream — Known Gaps and Violations

**Audit date:** 2026-08-26  
**Last updated:** 2026-09-01 — LS-GAP-001 verified fixed; LCSV-002 verified fixed (MASTER-VIOLATIONS.md Sprint 1)

---

## Inherited Violations from Live Class System

Public live streams share the live class infrastructure, so all live class violations apply:

### LCSV-001 — SUPER_ADMIN Blocked from PUBLIC Stream Participation

**Severity:** CRITICAL  
**Status:** ✅ FIXED

SUPER_ADMIN now receives HTTP 403 from `joinLiveClass()` before any role assignment, participant record creation, or LiveKit token issuance. This applies to both SCHOOL and PUBLIC streams regardless of whether the admin created the stream.

---

### LCSV-002 — SUPER_ADMIN Treated as Staff in Controller Functions

Same as in school live classes. SUPER_ADMIN can create PUBLIC streams and delete messages as "host" via the `isAdmin`/`isHost` checks that include `'SUPER_ADMIN'`.

**Status:** ✅ FIXED — Sprint 1 (commit d642e28). See MASTER-VIOLATIONS.md.

**Cross-reference:** [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md#lcsv-002)

---

## Public Stream-Specific Gaps

### LS-GAP-001 — Admin Termination Endpoint for PUBLIC Streams

**Severity:** HIGH  
**Status:** ✅ FIXED — Sprint 2 (verified 2026-09-01)

`POST /api/v1/admin/actions/live-classes/:id/terminate` is implemented in `backend/src/routes/admin-actions.routes.js` and **IS mounted** in `backend/src/app.js` at line 1052:

```javascript
app.use('/api/v1/admin/actions', adminActionsRoutes);
```

The endpoint:
- Requires SUPER_ADMIN role + IP allowlist
- Ends the class, marks all participants inactive, emits `liveclass:ended` socket event
- Writes a full audit log entry
- Works for both SCHOOL and PUBLIC streams regardless of `hostUserId`

---

### LS-GAP-002 — `privacy` Field UI Mismatch

**Severity:** LOW  
**Impact:** The `CreateLiveClassModal` includes a "Visibility" selector (Public / Private), setting `privacy: 'PUBLIC' | 'PRIVATE'`. However, the `LiveClass` schema has no `privacy` field. The `createLiveClass` controller ignores this field entirely. PUBLIC streams are always accessible to any authenticated user regardless of UI privacy selection.

**Current behavior:** `privacy` field in request body is silently ignored.  
**Do not fix.** Document only.

---

### LS-GAP-003 — No Host Transfer for PUBLIC Streams

**Severity:** MEDIUM  
**Status:** ✅ FIXED — 2026-09-01

Implemented `POST /api/v1/live-classes/:id/transfer/:userId`:
- Backend: `transferHost()` in `live-class.controller.js`, route in `live-class.routes.js`
- Atomic DB transaction: demote old host → STUDENT, promote target → HOST, update `host_user_id` for PUBLIC streams
- Race protection: `updateMany WHERE host_user_id = callerId` returns 0 rows if another transfer already happened
- Socket events: `liveclass:host_transferred`, `liveclass:role_changed`, `liveclass:you_are_host`
- Frontend: `LiveClassHostControls` shows "Make host" button per participant (HOST-only); `LiveClassRoomImpl` handles socket events and API call
- Works for both SCHOOL and PUBLIC streams

---

### LS-GAP-004 — Feed Card Post Persists After Stream Ends

**Severity:** LOW  
**Status:** ✅ ALREADY FIXED (pre-audit)

`broadcastLiveEnd()` in `backend/src/utils/feedLive.js`:
1. Emits `feed:live_ended` socket event immediately so connected clients update their card UI
2. Soft-deletes the `LIVE_CLASS_SHARE` post after a **10-minute grace period** (`LIVE_POST_TTL_MS = 10 * 60 * 1000`) so users loading the feed later don't see stale ended cards

The gap doc was outdated — the fix was already in place.

---

### LS-GAP-005 — No Test Coverage for PUBLIC Stream Authorization

**Severity:** MEDIUM  
**Status:** ✅ FIXED — 2026-09-01

New test file: `backend/src/tests/live-class-public-stream.test.js` — **21/21 passing**

Covers:
- MEMBER user who is `hostUserId` gets HOST role on join
- MEMBER who is NOT `hostUserId` gets STUDENT role
- PUBLIC stream join skips school isolation (any auth user can join)
- PUBLIC stream skips enrollment check (no classId)
- SUPER_ADMIN joins as STUDENT viewer (not HOST) when not the creator
- SUPER_ADMIN who IS the creator can join as HOST
- Kicked viewer (`wasKicked = true`) blocked with 403 on rejoin
- Kicked user cannot get LiveKit token
- Cross-user gifting: `checkLiveClassSchool` passes for PUBLIC streams
- School-scoped gifting: blocked for cross-school SCHOOL streams
- Host transfer: all 6 paths (success, non-host, self-transfer, ended, not-found, race condition)
- Token endpoint: active participant gets token; kicked/inactive participant denied

---

## Summary

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| LCSV-001 | CRITICAL | SUPER_ADMIN blocked entirely from joining any stream | ✅ Sprint 1 |
| LCSV-002 | HIGH | SUPER_ADMIN included in staff checks | ✅ Sprint 1 |
| LS-GAP-001 | HIGH | No admin termination for PUBLIC streams | ✅ Sprint 2 (verified mounted) |
| LS-GAP-002 | LOW | `privacy` field silently ignored | ❌ informational only |
| LS-GAP-003 | MEDIUM | No host transfer for PUBLIC streams | ✅ Fixed 2026-09-01 |
| LS-GAP-004 | LOW | Feed card never deleted after stream ends | ✅ Already fixed (10-min grace soft-delete) |
| LS-GAP-005 | MEDIUM | No PUBLIC stream specific authorization tests | ✅ Fixed 2026-09-01 (21/21) |
