---
inclusion: fileMatch
fileMatchPattern: "**/{middleware,auth*,admin*,routes}/**,**/*security*,**/*invariant*,**/*permission*,**/*auth*"
description: SUPER_ADMIN boundaries, 16 production invariants, security change-control checklist
---

# Security & Authorization Rules

> **Non-negotiable.** These rules must never be broken. Any code change touching SUPER_ADMIN behavior must be verified against all 16 invariants before deployment.

---

## The Single Most Important Rule

```
SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY

SUPER_ADMIN ≠ HOST
SUPER_ADMIN ≠ TEACHER / STUDENT / GUARDIAN
SUPER_ADMIN ≠ SPEAKER / STREAMER / LISTENER
SUPER_ADMIN ≠ ROOM PARTICIPANT
SUPER_ADMIN ≠ LIVE CLASS PARTICIPANT
SUPER_ADMIN ≠ VOICE ROOM PARTICIPANT
SUPER_ADMIN ≠ CONTENT CHAT PARTICIPANT
```

Administrative access to content spaces must use **dedicated admin APIs**, never content-participation APIs.

See: `docs/authorization/README.md`, `docs/authorization/SUPER-ADMIN-MASTER-SPEC.md`

---

## The 16 Production Invariants (INV-001 — INV-016)

| ID | Rule (one sentence) | Current Status |
|----|---------------------|---------------|
| INV-001 | SUPER_ADMIN platform privilege never grants feed post, comment, react, or school feed socket room access. | ✅ |
| INV-002 | SUPER_ADMIN platform privilege never creates a `LiveClassParticipant` record or grants any live class role. | ✅ FIXED (Sprint 1) |
| INV-003 | SUPER_ADMIN never joins another user's live stream as a content participant. | ✅ FIXED (Sprint 1) |
| INV-004 | SUPER_ADMIN never bypasses the `VoiceParticipant` DB record requirement to join a voice room. | ✅ |
| INV-005 | The HOST role in any content space is earned by creation or explicit assignment — never by SUPER_ADMIN platform role. | ✅ FIXED (Sprint 1) |
| INV-006 | Education roles (TEACHER, STUDENT, SCHOOL_ADMIN, GUARDIAN) are school-scoped via `SchoolMembership` — never implied by SUPER_ADMIN. | ✅ FIXED (Sprint 1) |
| INV-007 | SPEAKER, STREAMER, and LISTENER roles are earned through content participation — SUPER_ADMIN platform role never grants them. | ✅ |
| INV-008 | SUPER_ADMIN never receives a LiveKit `roomJoin`/`canPublish`/`canSubscribe` token without a valid content-participant DB record. | ✅ FIXED (Sprint 1) |
| INV-009 | Content Socket.IO rooms (`voice:*`, `liveclass:*`, `class:*`, `school:*`, `feed:school:*`, `community:*`, `conversation:*`, `pk:*`) require DB participant records — no SUPER_ADMIN bypass. | ✅ FIXED (Sprint 1, SA-FIX-12) |
| INV-010 | `requireSchoolMember()`, `assertSchoolAccess()`, `resolveStreamAccess()`, `checkLiveClassSchool()` contain no unconditional SUPER_ADMIN bypasses. | ✅ (ARCH-01) |
| INV-011 | Administrative content-space management uses dedicated admin APIs (`/api/v1/admin/...`) — never content-join APIs. | ✅ FIXED (Sprint 2) |
| INV-012 | User status changes, school status changes, platform-role grants/revocations, PII reads, and report reviews are always written to `audit_logs`. | ✅ FIXED (Sprint 2) |
| INV-013 | All wallet/coin/diamond mutations execute inside `prisma.$transaction`, write an audit log with before/after values, use an idempotency key, guard against negative balance, and require SUPER_ADMIN + IP allowlist. | ✅ |
| INV-014 | No code path silently promotes SUPER_ADMIN into a content role — every role assignment traces to creation, SchoolMembership, explicit assignment, queue approval, or direct promotion. | ✅ FIXED (Sprint 1) |
| INV-015 | SUPER_ADMIN accounts use the same token TTL as all users: access 15m, refresh 7d, auth cache 30s. | ✅ |
| INV-016 | `User.role = 'SUPER_ADMIN'` can only be set via `POST /api/v1/internal/admin/provision` or emergency DB write — never via registration, profile update, or school membership APIs. | ✅ (`roleGuard.js → assertSafeUserRole()`) |

---

## Change-Control Checklist

Run this checklist before merging **any** SUPER_ADMIN-related code change:

```
[ ] INV-001  Feed participation check
[ ] INV-002  Live class join check
[ ] INV-003  Live stream join check
[ ] INV-004  Voice room join check
[ ] INV-005  HOST role assignment check
[ ] INV-006  TEACHER/STUDENT role check
[ ] INV-007  SPEAKER/STREAMER/LISTENER check
[ ] INV-008  LiveKit token check
[ ] INV-009  Socket.IO room membership check
[ ] INV-010  School authorization bypass check
[ ] INV-011  Admin API vs participation API check
[ ] INV-012  Audit requirement check
[ ] INV-013  Financial transaction safety check
[ ] INV-014  Silent role conversion check
[ ] INV-015  Token TTL check
[ ] INV-016  Role assignment path check
```

If any invariant would be violated: **stop, redesign using dedicated admin APIs, get a second review.**

---

## Correct vs Prohibited Patterns (INV-011)

**✅ Correct — dedicated admin API:**
```
Admin UI
  → POST /api/v1/admin/actions/live-classes/:id/terminate
    → ipAllowlist + authorize('SUPER_ADMIN')
      → End class, write audit_log
      → No LiveClassParticipant record created
```

**❌ Prohibited — content-participation path:**
```
SUPER_ADMIN
  → POST /api/v1/live-classes/:id/join   ← FORBIDDEN
    → Receives HOST role
      → Calls POST /live-classes/:id/end
```

---

## Regression Test

`backend/src/tests/platform-admin-scope.test.js` — must pass after every SUPER_ADMIN boundary change.

Also relevant: `backend/src/tests/p0-security-fixes.test.js`, `backend/src/tests/super-admin-scope.test.js`

---

## ERP Platform Oversight

SUPER_ADMIN has intentional platform-level read and write oversight access across school-management (ERP) domains. This is a **dedicated platform-admin capability** — not a generic authorization bypass.

### Where ERP oversight is implemented (confirmed by investigation)

| Domain | Controller | Access type |
|--------|-----------|-------------|
| Attendance | `attendance.controller.js` | Read (analytics, reports) + Write (bulk mark, QR check-in) cross-school |
| Grades | `grade.controller.js` | Read + Write cross-school |
| Classes | `class.controller.js` | Read + Write cross-school |
| Behavior | `behavior.controller.js` | Read + Write cross-school |
| Exams | `exam.controller.js` | Read + Write (as admin role) |
| Assignments | `assignment.controller.js` | Read + Write (as admin role) |
| Analytics | `analytics.controller.js` | Read any school's stats + any user's stats |
| Dashboard | `dashboard.controller.js` | Read cross-school aggregates |

### Hard boundary — ERP oversight does NOT grant

ERP platform oversight is strictly separate from content-participation authorization. It does NOT automatically grant:

- `SchoolMembership` or any school role
- Live Class HOST, TEACHER, or STUDENT role
- Live Class participation of any kind
- Public Live HOST or participation
- Voice Club HOST, MODERATOR, or SPEAKER
- Social content participation (post, comment, react, bookmark)
- Community membership
- Any content-space role governed by INV-001 through INV-016

### Auditability

Cross-school ERP write operations by SUPER_ADMIN (e.g. bulk attendance, grade updates) are traced via domain-specific logs (e.g. `AttendanceLog`, `performedBy: req.user.id`). They are privileged platform-admin operations. Future work should log these to the central `audit_logs` table with explicit SUPER_ADMIN cross-school context.

Do not remove ERP oversight patterns from controllers without an explicit architectural decision and platform-admin capability replacement.

---

## Cross-References

- Project structure & key architecture rules → `structure.md`
- User roles definitions → `product.md`
- Full invariant text with violation history → `docs/authorization/super-admin-production-invariants.md`
- All 39 platform violations with fix status → `docs/MASTER-VIOLATIONS.md`
