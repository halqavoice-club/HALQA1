---
inclusion: manual
description: HALQA master engineering constitution — 45 rules, all 16 invariants, violation register, domain index, change-control process
---

# HALQA Master Engineering Constitution

> Load this file manually (`#constitution`) for broad architectural tasks, feature design, or full platform reviews.
> For tech stack → `tech.md` | Project structure → `structure.md` | Product overview → `product.md`
> For focused rules: `security.md` | `realtime.md` | `payments.md` | `testing.md`

**Test suite baseline:** 985/985 passing ✅ — no code change may reduce this count.

---

## 1. HALQA Product Identity — Absolute Rule

HALQA is a **general-purpose, multi-purpose platform**.

> HALQA is a place where people connect, talk, learn, create, teach, share, build communities, participate in live experiences, and earn.

HALQA is NOT:
- An Islamic-only platform
- A school-management-only product
- A social-only, live-stream-only, voice-only, or creator-only product

HALQA supports Islamic education, Islamic communities, schools, and related use cases — but those are **specialized domains within the broader platform**.

Never introduce assumptions that every user belongs to a school, every community is Islamic, every live feature belongs to a school, or every creator needs an education relationship.

---

## 2. Architecture — Independently Scoped Domains

Treat these as independent product domains with separate permission systems:

| Domain | Authorization Scope |
|--------|-------------------|
| Social | Social permissions |
| Communities | Community membership |
| Messaging | Conversation membership |
| Voice Club | `VoiceParticipant` + role |
| Public Live | Creator/host ownership |
| Live Class | School domain authorization |
| Education | `SchoolMembership` |
| School Management | School admin scope |
| Creator | Creator tier |
| Monetization | Wallet ownership |
| Payments | Stripe + wallet |
| Notifications | User-owned |
| Discovery | Public |
| Platform Administration | SUPER_ADMIN only |

A user account is the **identity layer**. Domain relationships determine domain permissions. Do not merge domain permissions merely because the same user account is involved.

---

## 3. Authorization Constitution

### 3.1 Normal User Identity
All users authenticate as normal HALQA users. Do not attach SCHOOL_ADMIN identity to login merely because the user administers a school — school administration is scoped.

### 3.2 Independent Role Systems
These are separate capability systems that must never be conflated:

- School role (via `SchoolMembership`)
- Live Class role (via `LiveClassParticipant`)
- Public Live role (via host ownership)
- Voice Club role (via `VoiceParticipant`)
- Community role (via `CommunityMember`)
- Creator role (via creator tier)
- Social permissions
- Platform Admin permissions (SUPER_ADMIN)

**Forbidden assumptions:**
- School Admin = Live Host
- School Admin = Voice Moderator
- Teacher = Community Admin
- SUPER_ADMIN = School Admin
- SUPER_ADMIN = Live Host

### 3.3 Social Access
Social functionality does not require school membership. Never add `if (!schoolMembership) deny social access` unless a specific feature explicitly requires it.

### 3.4 Public Live vs Live Class
These are separate product experiences with separate authorization:
- **Public Live** (`/live-streams`) — not school-scoped, no school membership required, creator/host ownership, `schoolId = null`
- **Live Class** (`/live-classes`) — school-scoped, requires school domain authorization

Never merge Public Live permissions into Live Class permissions.

### 3.5 Route Authorization
Every protected endpoint must have: authentication → resource lookup → domain authorization → ownership/membership validation → operation-specific permission validation.

Do not rely on frontend visibility, route naming, or UI roles for security.

---

## 4. SUPER_ADMIN Constitution

SUPER_ADMIN is a **platform administration capability only**.

SUPER_ADMIN does NOT automatically become: school member, teacher, student, school administrator, live host, live class participant, voice club member/moderator, social content operator.

The 16 production invariants are enumerated in full in `security.md`. Summary:

| INV | One-line rule |
|-----|--------------|
| INV-001 | No feed participation via platform privilege |
| INV-002 | No live class join via platform privilege |
| INV-003 | No live stream join as content participant |
| INV-004 | No voice room join bypass |
| INV-005 | HOST role earned — never from SA privilege |
| INV-006 | Education roles via SchoolMembership only |
| INV-007 | SPEAKER/STREAMER earned through participation |
| INV-008 | No LiveKit token without content-participant DB record |
| INV-009 | No content Socket.IO room bypass |
| INV-010 | No school authorization bypass |
| INV-011 | Admin access via dedicated APIs, not content-join APIs |
| INV-012 | Sensitive mutations always audit-logged |
| INV-013 | Financial mutations: atomic + audited + idempotent + balance-guarded |
| INV-014 | No silent content role conversion |
| INV-015 | Same token TTL as all users (15m access, 7d refresh) |
| INV-016 | SUPER_ADMIN role only via `/internal/admin/provision` or DB |

Change-control checklist and full invariant text → `security.md`.

---

## 5. Data Authority

**MySQL is the durable source of truth** for: users, schools, memberships, posts, comments, reactions, messages, communities, financial records, wallet records, gifts, payouts, live metadata, permissions, audit records.

**Redis is NOT** the permanent source of truth. Redis is for: cache, Socket.IO adapter, presence, typing state, ephemeral live state, viewer counters, rate limiting, distributed locks, pub/sub, queues, temporary coordination.

Never use unsafe in-memory fallback for financial transactions, wallet balances, payouts, or authorization decisions.

---

## 6. Realtime Constitution

Socket.IO is a transport mechanism — not the durable database.

Every important realtime flow must account for: duplicate events, delayed/out-of-order events, lost events, reconnects, backgrounding, network changes, server restarts, stale auth, stale room state.

LiveKit is media infrastructure — not authorization authority. Backend remains authoritative for all role decisions.

Full patterns, room taxonomy, rate limits, and token structures → `realtime.md`.

---

## 7. Financial Constitution

Financial operations are **server authoritative**. Never trust client values for balances, gift values, payment status, or transaction totals.

Payment systems must be idempotent. Protect against: duplicate webhooks, duplicate payments, replayed requests, race conditions, partial failures, client manipulation.

Full flow, Stripe webhook pattern, gift idempotency, refund rules → `payments.md`.

---

## 8. Security — Defense in Depth

Never weaken authorization or security to simplify implementation.

Check: authentication, authorization, ownership, validation, rate limiting, input handling, file uploads, storage permissions, secrets, webhook verification, SSRF, injection, XSS, privilege escalation, IDOR, race conditions, realtime authorization.

File uploads must validate: auth, authorization, file size, content type, extension, actual file characteristics. Never trust client-provided MIME types alone.

---

## 9. Web/Mobile Parity

Where a feature is supported on both Web and Mobile: behavior, authorization, API contracts, realtime semantics, error handling, and state transitions must be equivalent. UI does not need to be pixel-identical. UX must respect platform conventions.

Mobile import alias: `@/` pointing to `mobile/` root. Never `@/src/`.

---

## 10. State Transitions

For important resources, define legal states and validate transitions server-side:

- Live session: `SCHEDULED → LIVE → ENDED`
- Payout request: `REQUESTED → APPROVED/REJECTED`
- Payment: `PENDING → COMPLETED/FAILED`

Do not permit arbitrary client-driven state changes.

---

## 11. Preserve Working Implementation

If existing implementation works, do NOT rewrite it, rename large structures, migrate frameworks, replace working libraries, reorganize folders cosmetically, or replace Socket.IO/LiveKit architecture without evidence.

Prefer: **small change + clear reason + targeted test + regression verification** over large rewrite + uncertain side effects.

---

## 12. No Speculative Features

Do not implement features not required by existing product requirements, current spec, explicit user request, documented architecture, or security requirement. Record them as future recommendations instead.

---

## 13. Code Change Discipline — Implementation Gate

Before changing code, answer:
1. What requirement requires this?
2. What existing behavior is affected?
3. What files are affected?
4. What authorization rules apply?
5. What database changes are required?
6. What realtime effects exist?
7. What Web/Mobile effects exist?
8. What tests cover this?
9. What regression risks exist?
10. What is the smallest safe implementation?

If these cannot be answered, remain in audit/planning mode.

---

## 14. Change-Control Process

```
1.  READ   → docs/authorization/SUPER-ADMIN-MASTER-SPEC.md
2.  CHECK  → super-admin-api-matrix.md
3.  CHECK  → database-model-inventory.md
4.  CHECK  → admin-ui-action-matrix.md
5.  CHECK  → realtime-super-admin-boundary.md
6.  CHECK  → livekit-architecture.md
7.  UPDATE → Relevant documentation FIRST
8.  REVIEW → Get a second opinion
9.  CODE   → Implement the change
10. TEST   → Run platform-admin-scope.test.js
11. AUDIT  → Verify audit logging is in place
12. DEPLOY
```

**Anti-pattern — never do this:** `CODE → BREAK → DOCUMENT`

---

## 15. Documentation Phases Index

| Phase | Domain | Key files |
|-------|--------|-----------|
| 1–5 | Authorization | `docs/authorization/` (31 files) |
| 6 | Live Class | `docs/live-class/` |
| 7 | Live Stream | `docs/live-stream/` |
| 8 | Voice Club | `docs/voice-club/` (implied) |
| 9 | Feed + Social | `docs/feed-social/` |
| 10 | Chat/DM | `docs/chat-dm/` |
| 11 | Gifts/Payments | `docs/gifts-payments/` |
| 12 | Notifications | `docs/notifications/` |
| 13 | Web/Mobile | `docs/web-mobile/` |
| 14 | Deployment | `docs/deployment/` |

Master index: `docs/HALQA-MASTER.md`

---

## 16. Violation Register Summary

All 39 platform violations tracked in `docs/MASTER-VIOLATIONS.md`. Current status: **all resolved** ✅

Key violations and fix sprints:

| ID | Severity | Description | Fixed |
|----|---------|-------------|-------|
| LCSV-001 | 🚨 CRITICAL | SUPER_ADMIN received HOST role in live class join | Sprint 1 |
| LCSV-002 | 🔴 HIGH | SUPER_ADMIN in staff checks in live class controller | Sprint 1 |
| LCSV-003 | 🟢 LOW | SUPER_ADMIN bypassed self-only video state check | Sprint 1 |
| SVSV-001 | 🟡 MEDIUM | Legacy SA bypass for `feed:school:{schoolId}` socket room | Sprint 1 |
| LTSV-001 | 🟢 LOW | SA bypassed school check in generic LiveKit token (mitigated) | Mitigated |
| UIGAP-004 | 🚨 CRITICAL | No payout management admin UI | Sprint 3 |
| UIGAP-007 | 🔴 HIGH | Admin "End" buttons returned 403 | Sprint 2 |
| UIGAP-013 | 🔴 HIGH | Audit logs missing for PII reads, report reviews | Sprint 2 |
| UIGAP-014 | 🟡 MEDIUM | `/health/detailed` exposed without auth | Sprint 7 |
| PAY-GAP-001 | 🔴 HIGH | No refund API | Sprint 8 |
| PAY-GAP-002 | 🔴 HIGH | No Stripe refund integration | Sprint 8 |
| FS-GAP-002 | 🟡 MEDIUM | School feed used legacy `User.schoolId` | Sprint 6 |
| GAP-001 | 🟡 MEDIUM | IP allowlist silent pass-through in production | Sprint 7 (mitigated) |

---

## 17. Infrastructure Dependency Table

| Service | Failure mode | Fallback |
|---------|-------------|---------|
| MySQL | Fatal — all data ops fail | None |
| Redis | Soft — in-memory fallback acceptable for ephemeral state | In-memory (dev only) |
| LiveKit SFU | Graceful — REST API still works | REST-only mode |
| Socket.IO | Fatal for realtime features | None |
| Push/FCM | Soft — fire-and-forget | Silent failure |

Redis fallback rule: log at `warn` level in dev, not `error`. Never use in-memory fallback for financial transactions or authorization decisions.

---

## 18. School Isolation Rules

- `resolveStreamAccess()` — required on every route reading class data
- `assertSchoolAccess()` — required inside controllers
- `checkLiveClassSchool()` — required on gift endpoints for school live classes
- Cross-school access returns **403 for ALL roles including SUPER_ADMIN**
- `SchoolMembership` is the authoritative source for school roles

---

## 19. SQL Injection Prevention

- `updateLiveClass` — column allowlist enforced before any dynamic SQL
- `listLiveClasses` — hardcoded column literals with parameterized `?` placeholders
- String interpolation in `$queryRawUnsafe` calls is **prohibited**
- Use `$queryRaw` with tagged template literals or fully parameterized `$queryRawUnsafe`

---

## 20. Engineering Priority Order

```
Correctness
  ↓ Security
  ↓ Authorization
  ↓ Data integrity
  ↓ Reliability
  ↓ Compatibility
  ↓ Testing
  ↓ Performance
  ↓ Maintainability
  ↓ Feature expansion
```

Do not sacrifice a higher-level invariant for a lower-level convenience. HALQA should become more capable without becoming less predictable.

---

## 21. Evidence-First Engineering

Every audit must produce: **Findings** (what was found) → **Evidence** (exact files/functions/routes) → **Risk** (why it matters) → **Recommendation** (what should change) → **Scope** (what must not change) → **Validation** (which tests prove the change).

Classify findings: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL. Do not invent severity.

---

## 22. Kiro Agent Behavior on HALQA

**DO:** inspect before editing, preserve working behavior, use existing abstractions, follow existing naming conventions, write focused changes, test continuously, report evidence, identify uncertainty, protect authorization boundaries, preserve domain separation.

**DO NOT:** guess, fabricate implementations, invent database fields, invent APIs, invent permissions, assume school membership, grant SUPER_ADMIN universal access, treat LiveKit as authorization, treat Redis as durable storage, trust client ownership, bypass tests, rewrite working systems without evidence.
