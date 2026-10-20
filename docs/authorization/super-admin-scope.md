# SUPER_ADMIN — Permanent Scope Declaration

**This document is the authoritative definition of what SUPER_ADMIN is and is not.**

---

## Canonical Definition

> **SUPER_ADMIN is the HALQA Platform Administrator role.**
>
> It grants the ability to manage, monitor, configure, moderate, and audit the HALQA platform itself.
>
> It does NOT grant participation rights in any content space (live class, live stream, voice room, school community) unless the SUPER_ADMIN has also obtained the appropriate content-level role through the normal participation path.

---

## SUPER_ADMIN IS

| Capability | Granted | Source |
|-----------|---------|--------|
| View platform-wide statistics (users, schools, classes, live sessions, payments, gifts) | ✅ YES | `GET /api/v1/admin/stats/` |
| List all users (paginated, searchable) | ✅ YES | `GET /api/v1/admin/stats/users` |
| Change any user's account status (ACTIVE / SUSPENDED / BANNED / INACTIVE) | ✅ YES | `PATCH /api/v1/admin/stats/users/:id/status` |
| View full user PII (email, phone, etc.) in profile lookup | ✅ YES | `GET /api/v1/users/:id` |
| List and activate/deactivate schools | ✅ YES | `GET /api/v1/admin/stats/schools`, `PATCH /api/v1/admin/stats/schools/:id/status` |
| View platform-wide audit logs | ✅ YES | `GET /api/v1/admin/stats/audit` |
| View platform-wide announcements | ✅ YES | `GET /api/v1/admin/stats/announcements` |
| View live & voice room operational overview | ✅ YES | `GET /api/v1/admin/stats/live-voice` |
| View gift economy stats and catalog | ✅ YES | `GET /api/v1/admin/stats/gifts` |
| View payment/wallet stats | ✅ YES | `GET /api/v1/admin/stats/payments` |
| View platform analytics (DAU/WAU/MAU, engagement) | ✅ YES | `GET /api/v1/admin/stats/analytics` |
| View security event summary | ✅ YES | `GET /api/v1/admin/stats/security` |
| Manage backup metadata (create, list, delete, prune) | ✅ YES | `/api/v1/backups/*` |
| Moderate social reports (list + review) | ✅ YES | `GET/PATCH /api/v1/social/reports` |
| Provision or revoke other SUPER_ADMIN accounts | ✅ YES | `POST /api/v1/internal/admin/provision` |
| List all current SUPER_ADMIN users | ✅ YES | `GET /api/v1/internal/admin/list` |
| Receive real-time report alerts via Socket.IO | ✅ YES | `role:SUPER_ADMIN` socket room |

---

## SUPER_ADMIN IS NOT

| Capability | Granted | Reason |
|-----------|---------|--------|
| Join a Live Class as HOST | ❌ NO | Host role requires teacher/staff membership in the school |
| Join a Live Class as STUDENT | ❌ NO | Student participation requires school enrollment |
| Join a Live Class as any participant | ❌ NO | Live class access requires school membership or public stream auth |
| Receive LiveKit token for a Live Class | ❌ NO | Token requires active `liveClassParticipant` DB record |
| Start/end a Live Class | ❌ NO | Requires staff role via `eduStaff` middleware |
| Mute participants in a Live Class | ❌ NO | Host controls require staff role |
| Start a Voice Room | ❌ NO | Any authenticated user can start a voice room — not a SUPER_ADMIN privilege |
| Join a Voice Room as HOST | ❌ NO | HOST is the room creator; is assigned at room creation |
| Approve/reject speaker queue | ❌ NO | Requires HOST or MODERATOR `VoiceParticipant` record |
| Mute/kick in Voice Room | ❌ NO | Requires HOST or MODERATOR `VoiceParticipant` record |
| Get Voice Room LiveKit token | ❌ NO | Token requires active `voiceParticipant` DB record |
| Access a school's data without SchoolMembership | ❌ NO | ARCH-01: school isolation applies to all roles |
| Subscribe to another school's Socket.IO room | ❌ NO | SA-FIX-10/11: SUPER_ADMIN school socket bypass removed |
| Send gifts to a school live class | ❌ NO | ARCH-02: SUPER_ADMIN bypass removed from gift endpoints |

---

## SUPER_ADMIN CAPABILITY MATRIX (Full)

### Platform Administration

| Category | Capability | Status |
|----------|-----------|--------|
| Overview | Platform-wide stats | ✅ ALLOWED |
| Users | List all users | ✅ ALLOWED |
| Users | Search/filter users | ✅ ALLOWED |
| Users | View full user PII | ✅ ALLOWED |
| Users | Suspend / ban / activate user | ✅ ALLOWED |
| Users | Cannot suspend another SUPER_ADMIN | ✅ BLOCKED |
| Schools | List all schools | ✅ ALLOWED |
| Schools | Activate / deactivate school | ✅ ALLOWED |
| Moderation | View social reports | ✅ ALLOWED |
| Moderation | Review / resolve social reports | ✅ ALLOWED |
| Live & Voice | View operational live/voice overview | ✅ ALLOWED |
| Payments | View wallet stats and transactions | ✅ ALLOWED |
| Gifts & Coins | View gift economy stats and catalog | ✅ ALLOWED |
| Security | View security event summary | ✅ ALLOWED |
| Staff & Perms | Provision / revoke other SUPER_ADMIN | ✅ ALLOWED |
| Staff & Perms | List SUPER_ADMIN accounts | ✅ ALLOWED |
| Audit Logs | View all platform audit logs | ✅ ALLOWED |
| Announcements | View platform announcements | ✅ ALLOWED |
| System Health | Backup metadata management | ✅ ALLOWED |

### Content Participation

| Category | Capability | Status |
|----------|-----------|--------|
| Live Class | Create a school Live Class | ❌ DENIED (needs eduStaff) |
| Live Class | Create a PUBLIC Live Stream | ⚠️ CONDITIONALLY — if also authenticated (any user can) |
| Live Class | Join a school Live Class | ❌ DENIED (needs school enrollment + staff role) |
| Live Class | Join a PUBLIC Live Stream | ⚠️ CONDITIONALLY — if authenticated (same as any user) |
| Live Class | Become HOST in a school class | ❌ DENIED (needs TEACHER/SCHOOL_ADMIN school role) |
| Live Class | Become HOST in a public stream | ⚠️ CONDITIONALLY — only if they created it (`hostUserId === user.id`) |
| Live Class | Receive LiveKit token (school) | ❌ DENIED (needs active liveClassParticipant record) |
| Live Class | Screen share | ❌ DENIED (needs HOST role or screenShareEnabled) |
| Voice Club | Create a Voice Room | ⚠️ CONDITIONALLY — any authenticated user can |
| Voice Club | Join a Voice Room as HOST | ❌ DENIED (HOST = room creator only) |
| Voice Club | Approve speaker queue | ❌ DENIED (needs HOST/MODERATOR VoiceParticipant) |
| Voice Club | Mute/kick in Voice Room | ❌ DENIED (needs HOST/MODERATOR VoiceParticipant) |
| Voice Club | Receive LiveKit token (voice) | ❌ DENIED (needs active voiceParticipant record) |
| Voice Club | Become SPEAKER | ❌ DENIED (needs to join + be promoted by HOST) |
| Live Stream | Start a public live stream | ⚠️ CONDITIONALLY — any authenticated user can |
| Live Stream | Become STREAMER/HOST | ⚠️ CONDITIONALLY — only if they created it |

---

## SUPER_ADMIN Provisioning

SUPER_ADMIN status is assigned exclusively through:

1. **Production:** `POST /api/v1/internal/admin/provision` — called by an existing SUPER_ADMIN, IP-allowlisted, fully audited
2. **Development/staging:** `node prisma/seed-demo-accounts.js`
3. **Emergency:** Direct database write `UPDATE users SET role='SUPER_ADMIN' WHERE email=?`

SUPER_ADMIN **cannot** be assigned through:
- Registration API
- Profile update API
- School membership API
- Any application-code path (blocked by `assertSafeUserRole()` in `roleGuard.js`)

Self-demotion is blocked. The last SUPER_ADMIN cannot be revoked.

---

## Access Control Guards

All SUPER_ADMIN platform API routes are protected by **three layers**:

```
1. IP Allowlist (ipAllowlist middleware)
   └── Request must originate from ADMIN_IP_ALLOWLIST env var
       (passes through if allowlist is empty/unset — gap, see known-gaps.md)

2. Authentication (authenticate middleware)
   └── Valid JWT access token required
       └── User must be ACTIVE, not BANNED/SUSPENDED/DELETED

3. Authorization (authorize('SUPER_ADMIN'))
   └── req.user.role must === 'SUPER_ADMIN'
```
