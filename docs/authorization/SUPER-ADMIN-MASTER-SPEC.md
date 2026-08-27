# HALQA SUPER_ADMIN MASTER SPECIFICATION

**Version:** 1.0  
**Audit date:** 2026-08-26  
**Status:** Authoritative canonical specification — derived from full codebase audit  
**Rule:** This document is the contract for all future SUPER_ADMIN development.

---

## 1. Role Definition

| Field | Value |
|-------|-------|
| **Role name** | `SUPER_ADMIN` |
| **Purpose** | HALQA Platform Administrator — manages, monitors, configures, moderates, and audits the HALQA platform itself |
| **Authority domain** | Platform administration |
| **Non-authority domains** | School content, live classes, live streams, voice rooms, social feed, direct messages, communities, creator economy, marketplace, transport |
| **Security classification** | Platform administrator — highest privilege tier |
| **Stored in** | `users.role` column — value `'SUPER_ADMIN'` |
| **How assigned** | Internal provisioning endpoint only: `POST /api/v1/internal/admin/provision` |
| **How revoked** | Same endpoint with `action: 'revoke'` |
| **Self-modification** | Blocked — cannot modify own role |
| **Last admin protection** | Cannot revoke the last SUPER_ADMIN |

---

## 2. The P0 Architectural Invariant

```
┌─────────────────────────────────────────────────────────────────────┐
│  P0 INVARIANT — NEVER VIOLATE                                       │
│                                                                     │
│  SUPER_ADMIN = PLATFORM ADMINISTRATION ONLY                         │
│                                                                     │
│  SUPER_ADMIN IS NOT A CONTENT PARTICIPANT.                          │
│                                                                     │
│  Administrative access to content spaces must be implemented        │
│  through dedicated administrative APIs and interfaces.              │
│  It must NOT be implemented by making SUPER_ADMIN a content         │
│  participant.                                                       │
│                                                                     │
│  CORRECT:                                                           │
│    Admin UI → Admin API → Inspect/Manage Live Class                 │
│    No participant record. No LiveKit token.                         │
│                                                                     │
│  INCORRECT:                                                         │
│    joinLiveClass() → HOST role → LiveKit participant                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. What SUPER_ADMIN IS

SUPER_ADMIN is the HALQA platform operations role. It exists to:

- **Manage users** — view, search, suspend, ban, restore accounts
- **Manage schools** — activate, deactivate schools; view school metadata and counts
- **Moderate content** — review social reports, take enforcement actions (warn, suspend, ban)
- **Monitor live systems** — view operational state of live classes and voice rooms
- **Administer payments** — view transaction history and wallet statistics
- **Administer gifts** — view gift economy statistics and catalog
- **Administer security** — view security event logs, provision/revoke other admins
- **Inspect audit logs** — read the platform-wide audit trail
- **View announcements** — read school announcements across the platform
- **Monitor system health** — view database, Redis, LiveKit, memory, event loop status
- **Provision admins** — grant and revoke SUPER_ADMIN status (with reason, fully audited)
- **Receive alerts** — receive `admin:user_reported` and `creator:payout_requested` via Socket.IO `role:SUPER_ADMIN` room

---

## 4. What SUPER_ADMIN IS NOT

SUPER_ADMIN is explicitly NOT:

| Role | System | Status |
|------|--------|--------|
| HOST | Live Class | ❌ DENIED (unless also created the public stream — see exceptions) |
| TEACHER | Live Class | ❌ DENIED |
| STUDENT | Live Class | ❌ DENIED |
| PARTICIPANT | Live Class | ❌ DENIED (no LiveClassParticipant record should exist for admin actions) |
| STREAMER | Live Stream | ❌ DENIED (unless also created the stream) |
| VIEWER | Live Stream | ❌ DENIED |
| HOST | Voice Room | ❌ DENIED (unless also created the room) |
| MODERATOR | Voice Room | ❌ DENIED (unless assigned by room HOST after joining) |
| SPEAKER | Voice Room | ❌ DENIED (unless promoted by HOST after joining) |
| AUDIENCE | Voice Room | ❌ DENIED (SUPER_ADMIN should not join voice rooms in admin capacity) |
| POSTER | Social Feed | ❌ DENIED |
| COMMENTER | Social Feed | ❌ DENIED |
| REACTOR | Social Feed | ❌ DENIED |
| COMMUNITY MEMBER | Communities | ❌ DENIED (in admin capacity) |
| CHAT PARTICIPANT | Any room chat | ❌ DENIED (in admin capacity) |
| GIFT SENDER | Any room | ❌ DENIED (in admin capacity) |

---

## 5. The Permitted Exception

SUPER_ADMIN users are still human beings who may also be:
- Teachers at a school (holding a SchoolMembership)
- Hosts of their own public live streams
- Members of voice rooms they create personally

These are **personal user activities**, not administrative activities. When a SUPER_ADMIN performs these actions, they do so as a regular user — not by virtue of their SUPER_ADMIN role. The authorization system should treat their content access identically to any other user.

**The rule:** SUPER_ADMIN platform privilege must NEVER automatically grant content participation rights.

---

## 6. Authority Scope Summary

```
SUPER_ADMIN AUTHORITY SCOPE
│
├── PLATFORM ADMINISTRATION (full authority)
│   ├── User accounts (view, status change)
│   ├── Schools (view, activate/deactivate)
│   ├── Social reports (view, review, enforce)
│   ├── Audit logs (read)
│   ├── Backup metadata (CRUD)
│   ├── Admin provisioning (grant/revoke)
│   ├── Payment statistics (read)
│   ├── Gift statistics (read)
│   ├── Analytics (read)
│   ├── Security events (read)
│   ├── Announcements (read)
│   └── System health (read)
│
├── CONTENT ADMINISTRATION (limited — admin view only, no participation)
│   ├── Live session operational counts (read via admin stats)
│   ├── Voice room operational counts (read via admin stats)
│   └── Gift transaction history (read via admin stats)
│
└── CONTENT PARTICIPATION (NO AUTHORITY)
    ├── Live Class — DENIED
    ├── Live Stream — DENIED
    ├── Voice Club / Room — DENIED
    ├── Social Feed — DENIED
    ├── Communities — DENIED
    ├── Direct Messages — DENIED (in admin capacity)
    └── Group Chat — DENIED (in admin capacity)
```

---

## 7. Complete Capability Matrix

### Platform Administration

| Domain | Capability | SUPER_ADMIN | Notes |
|--------|-----------|-------------|-------|
| Users | List all users (paginated, searchable) | ALLOWED | `GET /admin/stats/users` |
| Users | View full user PII | ALLOWED | `GET /users/:id` — returns full profile |
| Users | Change user status (ACTIVE/SUSPENDED/BANNED/INACTIVE) | ALLOWED | `PATCH /admin/stats/users/:id/status` + audit log |
| Users | Cannot change another SUPER_ADMIN's status | DENIED | Backend enforces 403 |
| Users | View user's sessions | MISSING | No admin session endpoint |
| Users | Revoke user sessions | MISSING | No session revocation API |
| Users | Reset user password | MISSING | No admin password reset endpoint |
| Users | Edit user profile | DENIED | No admin profile edit endpoint |
| Users | Impersonate user | DENIED | No impersonation feature exists |
| Schools | List all schools | ALLOWED | `GET /admin/stats/schools` |
| Schools | Activate / deactivate school | ALLOWED | `PATCH /admin/stats/schools/:id/status` + audit log |
| Schools | View school member/class counts | ALLOWED | Aggregate only |
| Schools | View school internal data (students, grades, etc.) | DENIED | Requires SchoolMembership |
| Schools | Create school | DENIED | Not a platform admin function |
| Schools | Delete school | DENIED | Not a platform admin function |
| Moderation | View social reports | ALLOWED | `GET /social/reports` |
| Moderation | Review report (mark/dismiss/warn/suspend/ban) | ALLOWED | `PATCH /social/reports/:id/review` |
| Moderation | Enter reported room | DENIED | Not an admin function |
| Analytics | Platform analytics (DAU/WAU/MAU, social, education, live) | ALLOWED | `GET /admin/stats/analytics` |
| Analytics | Per-school analytics | MISSING | No endpoint |
| Analytics | Revenue/payment analytics | MISSING | Separate payments endpoint only |
| Analytics | Export data | MISSING | No export endpoint |
| Announcements | View all school announcements | ALLOWED | `GET /admin/stats/announcements` |
| Announcements | Create platform announcement | MISSING | No endpoint |
| System Health | View DB, Redis, LiveKit, memory, event loop status | ALLOWED | `GET /health/detailed` |

### Security & Staff

| Domain | Capability | SUPER_ADMIN | Notes |
|--------|-----------|-------------|-------|
| Staff | List all SUPER_ADMIN users | ALLOWED | `GET /internal/admin/list` |
| Staff | Grant SUPER_ADMIN to user | ALLOWED | `POST /internal/admin/provision { action: 'grant' }` + audit log |
| Staff | Revoke SUPER_ADMIN from user | ALLOWED | `POST /internal/admin/provision { action: 'revoke' }` + audit log |
| Staff | Assign school roles | DENIED | Not a platform admin function |
| Security | View security events (suspensions, bans, role changes) | ALLOWED | `GET /admin/stats/security` |
| Security | View login history | MISSING | Auth events not in audit_logs |
| Security | Manage IP allowlist | MISSING | Env var only |
| Security | Disable user 2FA | MISSING | No admin 2FA endpoint |
| Security | View user's 2FA status | ALLOWED | Visible in `GET /users/:id` |
| Audit | View platform-wide audit logs | ALLOWED | `GET /admin/stats/audit` |
| Audit | Filter audit logs by entity, action | ALLOWED | |
| Audit | Filter audit logs by date range | MISSING | Backend supports params; no UI |
| Audit | Export audit logs | MISSING | No export endpoint |
| Backup | Create/list/update/delete/prune backup metadata | ALLOWED | `/api/v1/backups/*` |

### Financial

| Domain | Capability | SUPER_ADMIN | Notes |
|--------|-----------|-------------|-------|
| Payments | View wallet aggregate stats | ALLOWED | `GET /admin/stats/payments` |
| Payments | View recent transactions (last 50) | ALLOWED | `GET /admin/stats/payments` |
| Payments | View per-user wallet balance | MISSING | No per-user wallet endpoint |
| Payments | Grant coins to user | MISSING | Schema supports ADMIN_GRANT; no API |
| Payments | Issue refund | MISSING | No admin refund endpoint |
| Payouts | View payout requests | MISSING | **CRITICAL GAP** — no admin payout API |
| Payouts | Approve/reject payouts | MISSING | **CRITICAL GAP** |
| Gifts | View gift economy stats | ALLOWED | `GET /admin/stats/gifts` |
| Gifts | View gift catalog | ALLOWED | `GET /admin/stats/gifts` |
| Gifts | View recent gift transactions | ALLOWED | `GET /admin/stats/gifts` |
| Gifts | Add/edit/deactivate gifts | MISSING | No admin gift catalog management |
| Coins | View coin packages | ALLOWED | Via gifts endpoint |
| Coins | Create/edit coin packages | MISSING | No admin endpoint |

### Live Systems

| Domain | Capability | SUPER_ADMIN | Notes |
|--------|-----------|-------------|-------|
| Live Class | View active session count + list | ALLOWED | `GET /admin/stats/live-voice` |
| Live Class | View participant counts | ALLOWED | Aggregate only |
| Live Class | Terminate a live class (admin) | MISSING | No admin termination endpoint; "End" button returns 403 |
| Live Class | View class chat | MISSING | No admin endpoint |
| Live Class | Join as any role | DENIED | Must not join as participant |
| Live Class | Receive LiveKit token | DENIED | Requires active participant record |
| Voice Room | View active room count + list | ALLOWED | `GET /admin/stats/live-voice` |
| Voice Room | View host names + participant counts | ALLOWED | Via admin stats |
| Voice Room | Terminate a voice room (admin) | MISSING | No admin termination endpoint; "End" button returns 403 |
| Voice Room | Join as any role | DENIED | Must not join as participant |
| Voice Room | Receive LiveKit token | DENIED | Requires active participant record |

### Content Participation (ALL DENIED)

| Domain | Capability | SUPER_ADMIN |
|--------|-----------|-------------|
| Feed | Post content | DENIED |
| Feed | Comment on posts | DENIED |
| Feed | React to posts | DENIED |
| Feed | Subscribe to school feed | CONDITIONAL — VIOLATION exists (SVSV-001) |
| Live Class | Join as HOST | DENIED — VIOLATION exists (LCSV-001) for public streams |
| Live Class | Join as STUDENT | DENIED |
| Live Class | Receive LiveKit token | DENIED (correct if not joined) |
| Live Class | Appear in participant list | DENIED |
| Live Stream | Watch as viewer | DENIED |
| Live Stream | Stream as creator | DENIED |
| Voice Room | Join as AUDIENCE | DENIED (in admin capacity) |
| Voice Room | Become SPEAKER | DENIED |
| Voice Room | Become HOST | DENIED (unless created the room personally) |
| Voice Room | Receive LiveKit voice token | DENIED (unless joined as personal user) |
| Communities | Join community socket room | DENIED (in admin capacity) |
| DM | Send direct messages (in admin capacity) | DENIED |
| Group Chat | Join group chat rooms | DENIED (in admin capacity) |
| Gifts | Send gifts (in admin capacity) | DENIED |

---

## 8. Administration vs Participation — Permanent Distinction

```
ADMINISTRATION                          PARTICIPATION
─────────────────────────────────────   ─────────────────────────────────────
View live session list         ALLOWED  Join live session            DENIED
View participant counts        ALLOWED  Become a participant         DENIED
Suspend the room host          ALLOWED  Take host controls           DENIED
View social reports            ALLOWED  Enter the reported room      DENIED
Review and ban a reporter      ALLOWED  Appear in room participant   DENIED
View gift transaction stats    ALLOWED  Send gifts as participant    DENIED
View voice room list           ALLOWED  Join as audience             DENIED
Terminate room (admin API)     MISSING  End room as HOST             DENIED
Moderate reported content      ALLOWED  Participate in content       DENIED
View school announcement list  ALLOWED  Create school announcement   DENIED
Manage user accounts           ALLOWED  Act as / impersonate user    DENIED
View audit logs                ALLOWED  Alter audit logs             DENIED
```

---

## 9. API Access Rules

All SUPER_ADMIN administrative APIs require:
1. **IP Allowlist** (`ADMIN_IP_ALLOWLIST` env var) — passes through if empty (GAP-001)
2. **Authentication** (`authenticate` middleware) — valid JWT + active account
3. **Authorization** (`authorize('SUPER_ADMIN')`) — `users.role = 'SUPER_ADMIN'`

### Administrative APIs (SUPER_ADMIN Only)

| Method | Endpoint | Purpose | Audit |
|--------|----------|---------|-------|
| GET | `/api/v1/admin/stats/` | Platform summary stats | No |
| GET | `/api/v1/admin/stats/users` | User list | No |
| PATCH | `/api/v1/admin/stats/users/:id/status` | Change user status | ✅ YES |
| GET | `/api/v1/admin/stats/schools` | School list | No |
| PATCH | `/api/v1/admin/stats/schools/:id/status` | Activate/deactivate school | ✅ YES |
| GET | `/api/v1/admin/stats/audit` | Audit logs | No |
| GET | `/api/v1/admin/stats/announcements` | Announcements | No |
| GET | `/api/v1/admin/stats/live-voice` | Live session overview | No |
| GET | `/api/v1/admin/stats/gifts` | Gift economy stats | No |
| GET | `/api/v1/admin/stats/payments` | Payment stats | No |
| GET | `/api/v1/admin/stats/analytics` | Platform analytics | No |
| GET | `/api/v1/admin/stats/security` | Security events | No |
| POST | `/api/v1/internal/admin/provision` | Grant/revoke SUPER_ADMIN | ✅ YES |
| GET | `/api/v1/internal/admin/list` | List admins | No |
| * | `/api/v1/backups/*` | Backup metadata CRUD | ❌ MISSING (gap) |
| GET | `/api/v1/social/reports` | Social reports | No |
| PATCH | `/api/v1/social/reports/:id/review` | Review report | ❌ MISSING (gap) |

→ Cross-reference: [super-admin-api-matrix.md](./super-admin-api-matrix.md)

---

## 10. Database Access Rules

SUPER_ADMIN has read/write access to these models via administrative APIs:

| Model | Read | Write | Audit required |
|-------|------|-------|---------------|
| `users` | ✅ List + PII | ✅ Status update only | YES — status changes |
| `schools` | ✅ | ✅ isActive toggle | YES — status changes |
| `audit_logs` | ✅ | ✅ System-written on admin actions | N/A — this is the audit |
| `backup_metadata` | ✅ | ✅ CRUD | MISSING |
| `user_reports` | ✅ | ✅ Status + reviewedBy | MISSING |
| `wallet_transactions` | ✅ Last 50 | ❌ | N/A |
| `gift_transactions` | ✅ Last 50 | ❌ | N/A |
| `gifts` | ✅ Catalog | ❌ | N/A |

SUPER_ADMIN must NEVER directly access (no API exists or should exist):

| Model | Reason |
|-------|--------|
| `live_class_participants` | Content participation — no admin endpoint |
| `voice_participants` | Content participation — no admin endpoint |
| `payout_requests.accountDetails` | Sensitive financial data — requires dedicated secure endpoint |
| `users.passwordHash` | Never exposed by any API |
| `users.twoFactorSecret` | Never exposed by any API |
| `refresh_tokens.token` | Never exposed by any API |
| `direct_messages` | Private communications |

→ Cross-reference: [database-model-inventory.md](./database-model-inventory.md)

---

## 11. Admin UI Rules

The Admin UI (`/admin/*`) is a client-side route group guarded by:
```typescript
if (!user || user.role !== 'SUPER_ADMIN') return <div>Platform Admin Only</div>
```

**14 sections — all administrative only:**

| Section | Purpose | Actions | Content participation |
|---------|---------|---------|----------------------|
| Overview | Platform stats dashboard | View stats, navigate | NONE |
| Users | User management | View, search, change status | NONE |
| Schools | School management | View, activate/deactivate | NONE |
| Moderation | Report moderation | Review, warn/suspend/ban | NONE |
| Live & Voice | Session monitoring | View sessions, attempted terminate | NONE (End buttons currently 403) |
| Payments | Transaction view | View only | NONE |
| Gifts & Coins | Gift economy view | View only | NONE |
| Security | Security event log | View, inspect events | NONE |
| Staff & Perms | Admin provisioning | Grant/revoke SUPER_ADMIN | NONE |
| Analytics | Platform analytics | View only | NONE |
| Platform Settings | Settings reference | View only (display) | NONE |
| Audit Logs | Audit trail | View, filter | NONE |
| Announcements | Announcement viewer | View only | NONE |
| System Health | Infrastructure status | View, refresh | NONE |

**No Admin UI page creates a content participant record.**  
**No Admin UI page issues a LiveKit token.**  
**No Admin UI page joins a content Socket.IO room.**

→ Cross-reference: [admin-ui-pages.md](./admin-ui-pages.md), [admin-ui-action-matrix.md](./admin-ui-action-matrix.md)

---

## 12. Realtime Access Rules

### Automatic Rooms (on connection — all users)
- `user:{userId}` — personal events
- `voice:lobby` — voice room lifecycle broadcasts
- `role:SUPER_ADMIN` — admin alert notifications

### Permitted Room Joins
- `school:{schoolId}` — only if JWT `schoolId` matches
- `class:{classId}` — only with active SchoolMembership (SA-FIX-11)
- `voice:{roomId}` — only with active `VoiceParticipant` record
- `liveclass:{id}` — only with active `LiveClassParticipant` record
- `feed:public` — same as all users
- `feed:{userId}` — own feed only
- `community:{id}` — only with active `CommunityMember` record
- `wallet:{userId}` — own wallet room only

### Forbidden Room Joins (Admin Capacity)
- `voice:{roomId}` — must not join as admin action (requires participant record)
- `liveclass:{id}` — must not join as admin action
- `community:{id}` — must not join as admin action
- `feed:school:{schoolId}` — **VIOLATION SVSV-001: legacy bypass currently present**

→ Cross-reference: [realtime-architecture.md](./realtime-architecture.md), [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md)

---

## 13. LiveKit Access Rules

**SUPER_ADMIN must not receive a LiveKit participant token for content participation.**

| Token type | Rule | Current status |
|-----------|------|---------------|
| Voice room token | Requires active `VoiceParticipant` — same as any user | ✅ Correct |
| Live class token (school) | Requires school membership + active `LiveClassParticipant` | ✅ Correct |
| Live class token (public) | Requires active `LiveClassParticipant` — but LCSV-001 lets SUPER_ADMIN join and create that record | ⚠️ VIOLATION via LCSV-001 |
| Generic token (liveclass-*) | School check bypassed for SUPER_ADMIN | ⚠️ Partially violated — LTSV-001 |

**The correct state:** SUPER_ADMIN should never obtain any of these grants for content participation:
- `roomJoin: true` for content rooms
- `canPublish: true`
- `canSubscribe: true`

If content participation is needed for administrative purposes (e.g., emergency room observation), a dedicated admin-observer mechanism must be built — not by making SUPER_ADMIN a regular participant.

→ Cross-reference: [livekit-architecture.md](./livekit-architecture.md)

---

## 14. Audit Requirements

### Actions That ARE Currently Audited

| Action | Entity in audit_log | Required |
|--------|-------------------|---------|
| Change user status | `user_status` | ✅ |
| Activate/deactivate school | `school_status` | ✅ |
| Grant SUPER_ADMIN | `user_platform_role` | ✅ |
| Revoke SUPER_ADMIN | `user_platform_role` | ✅ |

### Actions That ARE NOT Currently Audited (Gaps)

| Action | Gap ID | Risk |
|--------|--------|------|
| Admin reads full user PII (`GET /users/:id`) | UIGAP-013 | HIGH |
| Review a social report | UIGAP-013 | HIGH |
| Backup metadata mutations | UIGAP-013 | MEDIUM |
| Admin coin grant (not yet implemented) | N/A | CRITICAL when implemented |
| Payout approval (not yet implemented) | N/A | CRITICAL when implemented |

### Required Audit Fields (for every admin mutation)

```
userId      — acting SUPER_ADMIN
action      — CREATE / UPDATE / DELETE
entity      — model name
entityId    — record ID
oldValues   — previous state
newValues   — new state + reason
ipAddress   — caller IP
userAgent   — caller user agent
createdAt   — timestamp
```

---

## 15. Security Rules

1. SUPER_ADMIN accounts must never have `passwordHash` or `twoFactorSecret` exposed via any API
2. SUPER_ADMIN actions on sensitive APIs must originate from the IP allowlist (when configured)
3. SUPER_ADMIN role assignment requires a justification reason (min 10 chars)
4. SUPER_ADMIN cannot grant SUPER_ADMIN to themselves
5. The last SUPER_ADMIN cannot be revoked
6. All role changes are permanently recorded in `audit_logs`
7. SUPER_ADMIN tokens follow the same 1h access token TTL as all users
8. SUPER_ADMIN session cache follows the same 30s Redis TTL as all users (invalidated on suspend)

---

## 16. Known Current Violations

See [super-admin-current-violations.md](./super-admin-current-violations.md) for the full register.

Critical violations:
- **LCSV-001** — SUPER_ADMIN receives HOST role when joining any live class via platform role checks
- **SVSV-001** — SUPER_ADMIN can subscribe to any school's feed Socket.IO room (legacy bypass)
- **LCSV-002** — SUPER_ADMIN included in staff checks in several live class controller functions

---

## 17. Production Invariants

See [super-admin-production-invariants.md](./super-admin-production-invariants.md) for the complete set.

Core invariants:
1. SUPER_ADMIN must never be automatically made a content participant
2. SUPER_ADMIN must never receive a content-participation LiveKit token through platform privilege alone
3. SUPER_ADMIN must never join content Socket.IO rooms through platform privilege alone
4. Administrative content management must use separate admin APIs, not content participation APIs

---

## 18. Change Control Rule

**Before changing any SUPER_ADMIN behavior:**

```
DOCUMENT → REVIEW → IMPLEMENT → TEST → AUDIT → DEPLOY
```

Required steps:
1. Read this specification
2. Check [super-admin-api-matrix.md](./super-admin-api-matrix.md)
3. Check [database-model-inventory.md](./database-model-inventory.md)
4. Check [admin-ui-action-matrix.md](./admin-ui-action-matrix.md)
5. Check [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md)
6. Check [livekit-architecture.md](./livekit-architecture.md)
7. Update this specification and relevant sub-documents
8. Update or add tests (`backend/src/tests/platform-admin-scope.test.js`)
9. Run authorization tests and realtime tests
10. Record the change in git with a descriptive commit message

**Never:** CODE → BREAK → DOCUMENT

---

## 19. Documentation Cross-Reference Index

| Topic | Document |
|-------|---------|
| Role model and domains | [role-model.md](./role-model.md) |
| Permission middleware chain | [permission-model.md](./permission-model.md) |
| Platform vs content distinction | [platform-vs-content.md](./platform-vs-content.md) |
| Complete API matrix | [super-admin-api-matrix.md](./super-admin-api-matrix.md) |
| Database model inventory | [database-model-inventory.md](./database-model-inventory.md) |
| User management | [user-management.md](./user-management.md) |
| School management | [school-management.md](./school-management.md) |
| Live/voice administration | [live-voice-administration.md](./live-voice-administration.md) |
| Payment administration | [payment-administration.md](./payment-administration.md) |
| Security administration | [security-administration.md](./security-administration.md) |
| Admin UI overview | [admin-ui-overview.md](./admin-ui-overview.md) |
| Admin UI per-page | [admin-ui-pages.md](./admin-ui-pages.md) |
| Admin UI action matrix | [admin-ui-action-matrix.md](./admin-ui-action-matrix.md) |
| Admin UI gaps | [admin-ui-gaps.md](./admin-ui-gaps.md) |
| Admin UI backend trace | [admin-ui-backend-trace.md](./admin-ui-backend-trace.md) |
| Socket.IO architecture | [realtime-architecture.md](./realtime-architecture.md) |
| Socket.IO event catalog | [realtime-event-catalog.md](./realtime-event-catalog.md) |
| SUPER_ADMIN realtime boundary | [realtime-super-admin-boundary.md](./realtime-super-admin-boundary.md) |
| Realtime security model | [realtime-security-model.md](./realtime-security-model.md) |
| LiveKit architecture | [livekit-architecture.md](./livekit-architecture.md) |
| Participant lifecycle | [participant-lifecycle.md](./participant-lifecycle.md) |
| Live class permissions | [live-class-permissions.md](./live-class-permissions.md) |
| Live stream permissions | [live-stream-permissions.md](./live-stream-permissions.md) |
| Voice permissions | [voice-permissions.md](./voice-permissions.md) |
| Admin permissions | [admin-permissions.md](./admin-permissions.md) |
| API permissions (all routes) | [api-permissions.md](./api-permissions.md) |
| Realtime permissions | [realtime-permissions.md](./realtime-permissions.md) |
| LiveKit permissions | [livekit-permissions.md](./livekit-permissions.md) |
| Known gaps | [known-gaps.md](./known-gaps.md) |
| Current violations | [super-admin-current-violations.md](./super-admin-current-violations.md) |
| Production invariants | [super-admin-production-invariants.md](./super-admin-production-invariants.md) |
