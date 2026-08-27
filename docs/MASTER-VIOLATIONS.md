# HALQA — Master Violation Register

**Version:** 1.0  
**Audit date:** 2026-08-26  
**Status:** Consolidated from all documentation phases. No application code modified.  
**Rule:** Every violation listed here is documented only. No fix has been applied.

---

## How to Use This Register

Before any code change, search this register for violations in the affected area. If a fix is being planned, reference the violation ID in the PR description and update the `Status` field.

Severity scale: 🚨 CRITICAL · 🔴 HIGH · 🟡 MEDIUM · 🟢 LOW

---

## LCSV-001 — SUPER_ADMIN Receives HOST Role in Any Live Class

**ID:** LCSV-001  
**Severity:** 🚨 CRITICAL  
**Domain:** Live Class / Live Stream  
**Status:** ✅ FIXED — Sprint 1 (commit d642e28)

| Field | Value |
|-------|-------|
| File | `backend/src/controllers/live-class.controller.js` |
| Function | `joinLiveClass()` ~line 793 |
| Current behavior | `isTeacher = user.role === 'SUPER_ADMIN'` and `isStaff = ['SUPER_ADMIN'...].includes(effectiveRole)` cause HOST role to be assigned to SUPER_ADMIN |
| Expected behavior | SUPER_ADMIN joining a stream they did not create should receive STUDENT role |
| Security impact | SA obtains LiveKit participant token, auto-starts SCHEDULED classes, has DB host-level privileges |
| Database impact | `live_class_participants` record created with `role = 'HOST'` |
| API impact | Host-only endpoints callable by SA |
| Realtime impact | SA joins `liveclass:{id}` socket room as HOST |
| LiveKit impact | SA receives LiveKit token with `roomJoin: true, canPublish: true` |
| UI impact | Frontend partially mitigates: `isStaffRole` excludes SA — host controls not shown unless SA is `hostUserId` |
| Required fix | Remove `'SUPER_ADMIN'` from `isTeacher`/`isStaff` checks in `joinLiveClass()` |
| Regression test | `live-class-p1-reliability.test.js: SUPER_ADMIN without school membership is denied` |
| Related docs | [live-class/gaps.md](./live-class/gaps.md), [authorization/super-admin-current-violations.md](./authorization/super-admin-current-violations.md) |

---

## LCSV-002 — SUPER_ADMIN Treated as Staff in Multiple Live Class Controller Functions

**ID:** LCSV-002  
**Severity:** 🔴 HIGH  
**Domain:** Live Class  
**Status:** ✅ FIXED — Sprint 1 (commit d642e28)

| Field | Value |
|-------|-------|
| File | `backend/src/controllers/live-class.controller.js` |
| Functions | `createLiveClass` (~567), `deleteMessage` (~1610), `sendMessage` (~1268) |
| Current behavior | `['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(getEffectiveRole(req))` grants school live class creation and chat privileges to SA |
| Expected behavior | School live class creation and in-class chat management requires school staff membership |
| Security impact | SA can create school sessions, delete any chat message |
| Required fix | Remove `'SUPER_ADMIN'` from all three `isAdmin`/`isHost` checks |

---

## LCSV-003 — SUPER_ADMIN Bypasses Self-Only Check in `setVideoState`

**ID:** LCSV-003  
**Severity:** 🟢 LOW  
**Domain:** Live Class  
**Status:** ✅ FIXED — Sprint 1 (commit d642e28)

| Field | Value |
|-------|-------|
| File | `backend/src/controllers/live-class.controller.js` |
| Function | `setVideoState()` ~line 1701 |
| Current behavior | `if (req.user.id !== userId && getEffectiveRole(req) !== 'SUPER_ADMIN')` — SA bypasses self-only rule |
| Expected behavior | Video state is self-managed only; no role should override |
| Security impact | Low — video indicator only, not mic or kick |
| Required fix | Remove SUPER_ADMIN condition entirely |

---

## SVSV-001 — SUPER_ADMIN Legacy Bypass for `feed:join:school`

**ID:** SVSV-001  
**Severity:** 🟡 MEDIUM  
**Domain:** Feed / Socket.IO  
**Status:** ✅ FIXED — Sprint 1 (commit d642e28, SA-FIX-12)

| Field | Value |
|-------|-------|
| File | `backend/src/app.js` |
| Function | `socket.on('feed:join:school', ...)` ~line 561 |
| Current behavior | `if (userRole === 'SUPER_ADMIN') { socket.join(`feed:school:${schoolId}`); }` — SA joins any school's feed room |
| Expected behavior | SA subject to same `socket.userSchoolId === schoolId` check as all users |
| Security impact | SA receives real-time SCHOOL_ONLY post events from any school |
| Realtime impact | SA in `feed:school:{anySchoolId}` receives `post:create` events for school-private posts |
| Required fix | Delete the 4-line SUPER_ADMIN bypass block |
| Related docs | [feed-social/gaps.md](./feed-social/gaps.md) |

---

## LTSV-001 — SUPER_ADMIN Bypasses School Check in Generic LiveKit Token

**ID:** LTSV-001  
**Severity:** 🟢 LOW (mitigated)  
**Domain:** LiveKit  
**Status:** PARTIALLY MITIGATED

| Field | Value |
|-------|-------|
| File | `backend/src/controllers/livekit.controller.js` |
| Function | `generateToken()` ~line 114 |
| Current behavior | `if (req.user.role !== 'SUPER_ADMIN')` skips school isolation check for `liveclass-*` rooms |
| Expected behavior | All users including SA should pass school isolation |
| Mitigation | Participant record check still blocks — SA cannot get token without `liveClassParticipant.isActive` |
| Net impact | Low — school check bypassed but blocked by participant check |

---

## UIGAP-004 — No Payout Management Admin UI

**ID:** UIGAP-004  
**Severity:** 🚨 CRITICAL  
**Domain:** Payments / Admin UI  
**Status:** ✅ FIXED — Sprint 3 (commit 219df3f)
Payout management section added to `/admin/payments` page. Wired to existing backend API: `GET /wallet/payout/admin/list` + `PATCH /wallet/payout/admin/:id`.

| Field | Value |
|-------|-------|
| Current behavior | Admin `/admin/payments` page shows wallet stats only; no payout section |
| Backend API | `/wallet/payout/admin/list` and `/wallet/payout/admin/:id` exist and work |
| Database impact | `payout_requests.accountDetails` contains sensitive bank/PayPal info with no admin delivery mechanism |
| Security impact | Platform admin cannot process payouts without direct DB access |
| Required fix | Add payout management section to admin UI wired to the existing API |

---

## UIGAP-005 — No Admin Coin Grant API

**ID:** UIGAP-005  
**Severity:** 🔴 HIGH  
**Domain:** Payments  
**Status:** SCHEMA SUPPORTS — NO API OR UI

| Field | Value |
|-------|-------|
| Current behavior | `WalletTransaction.type = 'ADMIN_GRANT'` exists in schema; no API implements it |
| Database impact | Cannot credit coins to a user without direct DB access |
| Required fix | `POST /admin/users/:id/credits { coins, reason }` with audit log |

---

## UIGAP-007 — "End" Buttons in Admin Live & Voice Page Return 403

**ID:** UIGAP-007  
**Severity:** 🔴 HIGH  
**Domain:** Admin UI / Live & Voice  
**Status:** ✅ FIXED — Sprint 2 (commit 8303b99)

| Field | Value |
|-------|-------|
| File | `frontend/src/app/(dashboard)/admin/live-voice/page.tsx` |
| Current behavior | Buttons call `POST /live-classes/:id/end` and `PATCH /voice/:id/end` — SA is not the host, returns 403 |
| Expected behavior | Dedicated admin termination endpoints bypassing content auth |
| Required fix | `POST /admin/live-classes/:id/terminate` + `POST /admin/voice/:id/terminate` |

---

## UIGAP-008 — Moderation Page May Use Wrong API Path

**ID:** UIGAP-008  
**Severity:** 🟡 MEDIUM  
**Domain:** Admin UI / Moderation  
**Status:** ✅ RESOLVED — Sprint 1 verification confirmed /report-block routes ARE mounted at /api/v1/report-block (app.js line 1004). Not a bug.

| Field | Value |
|-------|-------|
| File | `frontend/src/app/(dashboard)/admin/moderation/page.tsx` |
| Current behavior | Page calls `/report-block/reports`; social.routes.js mounts at `/social/reports` |
| Risk | If `/report-block/reports` is not mounted, moderation queue always appears empty |
| Required action | Verify the exact mounting in `app.js` for `/report-block` routes |

---

## UIGAP-013 — Audit Logs Missing for Several Admin Actions

**ID:** UIGAP-013  
**Severity:** 🔴 HIGH  
**Domain:** Audit / Compliance  
**Status:** ✅ FIXED — Sprint 2 (commit 8303b99)
- SUPER_ADMIN PII reads now logged (entity=user_profile_access)
- Report reviews now logged (entity=report_review)

---

## FS-GAP-002 — School Feed Uses Legacy `User.schoolId`

**ID:** FS-GAP-002  
**Severity:** 🟡 MEDIUM  
**Domain:** Feed / School Isolation  
**Status:** ✅ FIXED — Sprint 6 (commit dbaf7c5)
`visibilityFilter()` now loads `SchoolMembership.schoolId` as fallback. `createPost()` resolves schoolId from membership for MEMBER users. Socket broadcast uses `post.schoolId`.

| Field | Value |
|-------|-------|
| File | `backend/src/controllers/post.controller.js: visibilityFilter()` |
| Current behavior | `SCHOOL_ONLY` posts filtered by `viewer.schoolId` (from `User.schoolId`) |
| Expected behavior | Should use `SchoolMembership` for new architecture users |
| User impact | Users with `MEMBER` role + active SchoolMembership but no `User.schoolId` cannot see `SCHOOL_ONLY` posts |

---

## FS-GAP-003 — No Audit Logging for Moderation Actions

**ID:** FS-GAP-003  
**Severity:** 🔴 HIGH  
**Domain:** Feed / Moderation  
**Status:** ✅ FIXED — Sprint 2 (commit 8303b99)
All report review decisions now logged via `report-block.controller.js`.

---

## LS-GAP-001 — No Admin Termination Endpoint for Live Sessions

**ID:** LS-GAP-001  
**Severity:** 🔴 HIGH  
**Domain:** Live Class / Live Stream  
**Status:** ✅ FIXED — Sprint 2 (commit 8303b99)
New dedicated admin endpoints in `backend/src/routes/admin-actions.routes.js`:
- `POST /api/v1/admin/actions/live-classes/:id/terminate`
- `POST /api/v1/admin/actions/voice/:id/terminate`
Admin UI "End" buttons updated to call these endpoints.

---

## PAY-GAP-001 — No Refund API

**ID:** PAY-GAP-001  
**Severity:** 🔴 HIGH  
**Domain:** Payments  
**Status:** ✅ FIXED — Sprint 8 (commit TBD)

`POST /api/v1/admin/actions/transactions/:id/refund` added to `admin-actions.routes.js`.
- Refundable types: `STRIPE_PURCHASE`, `ADMIN_GRANT`
- Non-refundable: `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `REFUND` (returns 400)
- Atomic: coin deduction + REFUND ledger entry in single DB transaction
- Idempotency: duplicate refund attempt returns 409
- Balance guard: refund blocked if user has insufficient coins
- Full audit log written per INVARIANT-005/006
- User notified via socket + UI

---

## PAY-GAP-002 — No Stripe Refund Integration

**ID:** PAY-GAP-002  
**Severity:** 🔴 HIGH  
**Domain:** Payments / Stripe  
**Status:** ✅ FIXED — Sprint 8 (commit TBD)

Integrated into same `POST /transactions/:id/refund` endpoint:
- Retrieves Stripe Checkout Session to get `payment_intent` ID
- Calls `stripe.refunds.create({ payment_intent })` after DB commit
- Fire-and-forget: Stripe failure is non-fatal (coins still refunded, error logged)
- `stripeRefund: false` body param skips Stripe call (coins-only refund)
- Stripe refund ID returned in response for operator confirmation
- Admin UI: "Refund" button added to STRIPE_PURCHASE/ADMIN_GRANT transaction rows

---

## VC-SA-002 — `getScheduledRooms` SUPER_ADMIN School Bypass (Inert)

**ID:** VC-SA-002  
**Severity:** 🟢 LOW (inert — all rooms have `schoolId=null`)  
**Domain:** Voice Club  
**Status:** INERT — no impact currently

`if (req.user.role === 'SUPER_ADMIN') { schoolWhere = {} }` shows SA all schools' scheduled rooms. Since all voice rooms have `schoolId=null`, this is a no-op today.

---

## UILEAK-001 — Backend/Frontend Role Discrepancy from LCSV-001

**ID:** UILEAK-001  
**Severity:** 🔴 HIGH  
**Domain:** Live Class / Frontend  
**Status:** ✅ RESOLVED — Sprint 1 fixed LCSV-001. Backend no longer assigns HOST to SUPER_ADMIN. Frontend `isStaffRole` exclusion was already correct. No longer a discrepancy.

---

## UIGAP-014 — `/health/detailed` Exposed Without Authentication

**ID:** UIGAP-014  
**Severity:** 🟡 MEDIUM  
**Domain:** System Health / Security  
**Status:** ✅ FIXED — Sprint 7 (commit TBD)

| Field | Value |
|-------|-------|
| File | `backend/src/app.js` |
| Current behavior | `GET /health/detailed` returned full infrastructure diagnostics (DB latency, Redis state, memory, circuit breakers, LiveKit) without any authentication |
| Expected behavior | Requires `HEALTH_TOKEN` via `Authorization: Bearer <token>` or `?token=` param |
| Security impact | Attacker could fingerprint stack, identify degraded dependencies for timing attacks, or confirm Redis is down |
| Required fix | Token-gate `/health/detailed` following same pattern as `/metrics`. Kubernetes probes (`/liveness`, `/readiness`, `/startup`) remain public. |
| Fix applied | Inline token guard in `app.js`. `HEALTH_TOKEN` env var added to `.env.example` and `.env.production.example`. Production startup warns if unset. |
| Regression test | `sprint7-security.test.js: UIGAP-014` (11 tests) |

---

## GAP-001 — IP Allowlist Silent Pass-Through in Production

**ID:** GAP-001  
**Severity:** 🟡 MEDIUM  
**Domain:** Security / Admin Routes  
**Status:** ✅ MITIGATED — Sprint 7 (commit TBD)

| Field | Value |
|-------|-------|
| File | `backend/src/middleware/ipAllowlist.js`, `backend/src/app.js` |
| Current behavior | When `ADMIN_IP_ALLOWLIST` is empty/unset, all IPs are allowed through (intentional for dev). No warning in production if unset. |
| Expected behavior | Pass-through in dev is correct. Production should warn loudly at startup so ops teams notice the misconfiguration. |
| Risk | If `ADMIN_IP_ALLOWLIST` is forgotten in a production deployment, admin routes have no IP restriction. No runtime indication that protection is absent. |
| Fix applied | Production startup warning logged when `ADMIN_IP_ALLOWLIST` is empty (NODE_ENV=production). Checklist updated in `.env.production.example`. |
| Note | Behavior unchanged — pass-through is intentional. The fix adds visibility only. A hard block would break cloud deployments with dynamic IPs. |
| Regression test | `sprint7-security.test.js: GAP-001` (4 tests) |

---

## GAP-002 — `assertSchoolAccess` Uses Legacy `user.schoolId`

**ID:** GAP-002  
**Severity:** 🟡 MEDIUM  
**Domain:** School Isolation  
**Status:** ✅ RESOLVED — Already Fixed (pre-Sprint 7)

`requireSchoolAccess` in `schoolAuth.middleware.js` already checks `SchoolMembership` as the authoritative source. Legacy `user.schoolId` is only used as a fallback for pre-migration users who have no `SchoolMembership` record yet (documented transition path). The violation register entry was outdated. Confirmed by Sprint 7 regression tests.

---

| ID | Severity | Domain | Description |
|----|---------|--------|-------------|
| LC-GAP-003 | MEDIUM | Live Class | Recording storage not integrated |
| LC-GAP-004 | LOW | Live Class | Poll state not persisted to DB (Redis only) |
| LC-GAP-005 | LOW | Live Class | Whiteboard state not persisted to DB |
| LC-TEST-001 | MEDIUM | Tests | No test for LCSV-001 HOST assignment in joinLiveClass |
| LS-GAP-002 | LOW | Live Stream | `privacy` field in create UI silently ignored by backend |
| LS-GAP-003 | MEDIUM | Live Stream | No host transfer for PUBLIC streams |
| VC-GAP-001 | LOW | Voice Club | voiceMinutes not credited on normal leave |
| VC-GAP-003 | MEDIUM | Voice Club | No admin room inspection without participation |
| VC-GAP-005 | MEDIUM | Voice Club | Kick/ban not audit-logged |
| FS-GAP-001 | MEDIUM | Feed | SUPER_ADMIN can create posts/react as regular user (by design?) |
| FS-GAP-004 | LOW | Feed | SUPER_ADMIN can create stories |
| FS-GAP-006 | LOW | Feed | No post/user muting feature |
| CHAT-GAP-002 | LOW | Chat/DM | No DM message editing |
| CHAT-GAP-003 | MEDIUM | Chat/DM | ALLOW_DM_NON_FRIENDS not verified at API level |
| UIGAP-001 | MEDIUM | Admin UI | Route guard is client-side only |
| UIGAP-002 | HIGH | Admin UI | ✅ FIXED Sprint 5 — Session management (view + revoke) |
| UIGAP-003 | MEDIUM | Admin UI | No user profile drill-down |
| UIGAP-011 | LOW | Admin UI | No export functionality |
| UIGAP-012 | MEDIUM | Admin UI | No platform announcement creation |
| UIGAP-014 | MEDIUM | System Health | `/health/detailed` may not require auth |
| GAP-001 | MEDIUM | Security | IP allowlist passes through when env var empty |
| GAP-002 | MEDIUM | School | `assertSchoolAccess` uses legacy `user.schoolId` |

---

## Summary Counts

| Severity | Open | Fixed/Resolved |
|---------|------|---------------|
| 🚨 CRITICAL | 0 | 3 (LCSV-001, UIGAP-004✅, LS-GAP-001) |
| 🔴 HIGH | 2 | 9 (LCSV-002, UIGAP-007, UIGAP-013, UIGAP-005, LS-GAP-001, FS-GAP-003, UILEAK-001, UIGAP-002✅) |
| 🟡 MEDIUM | 6 | 5 (SVSV-001, UIGAP-008✅, FS-GAP-002✅, UIGAP-014✅, GAP-001✅mitigated, GAP-002✅resolved) |
| 🟢 LOW | 13 | 2 (LCSV-003, VC-SA-002 inert) |

**Sprints 1–8 closed:** LCSV-001, LCSV-002, LCSV-003, SVSV-001, UIGAP-007, UIGAP-008 (confirmed not a bug), UIGAP-013, FS-GAP-003, LS-GAP-001, UILEAK-001, UIGAP-004, UIGAP-005, UIGAP-002, FS-GAP-002, UIGAP-014, GAP-001 (mitigated), GAP-002 (already resolved), PAY-GAP-001, PAY-GAP-002

**Still open (MEDIUM):**
- UIGAP-003 — No user profile drill-down page
- UIGAP-012 — No platform announcement creation
- CHAT-GAP-003 — ALLOW_DM_NON_FRIENDS not verified at API level
- VC-GAP-003 — No admin room inspection without participation
- LTSV-001 — Generic LiveKit token school bypass (LOW/mitigated)
