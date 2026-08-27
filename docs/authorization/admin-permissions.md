# Admin Permissions — SUPER_ADMIN Platform API Surface

Complete inventory of every API endpoint accessible to SUPER_ADMIN in their capacity as platform administrator.

All routes below require three guards unless stated otherwise:
1. IP Allowlist (`ipAllowlist` middleware)
2. Authentication (`authenticate`)
3. Role check (`authorize('SUPER_ADMIN')`)

---

## `/api/v1/admin/stats/*` — Platform Statistics

File: `backend/src/routes/admin-stats.routes.js`

| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| GET | `/` | Platform summary (users, schools, live classes, moderation, audit counts) | Aggregated counts only |
| GET | `/users` | Paginated user list with search/filter (by status, role, name, email) | Returns id, email, name, role, status, avatarUrl, lastLoginAt, schoolMembership count |
| PATCH | `/users/:id/status` | Change a user's account status: ACTIVE / SUSPENDED / BANNED / INACTIVE | Writes audit log. Blocks changing another SUPER_ADMIN's status |
| GET | `/schools` | Paginated school list with search/filter | Returns id, name, slug, type, city, country, isActive, counts |
| PATCH | `/schools/:id/status` | Activate or deactivate a school | Writes audit log |
| GET | `/audit` | Platform-wide audit logs (paginated, filterable by entity, action, userId, date range) | No school filter — all platform events |
| GET | `/announcements` | Platform-wide announcements (paginated) | |
| GET | `/live-voice` | Operational overview: active live classes and voice rooms, participant counts, recent sessions | Aggregated; no participant PII |
| GET | `/gifts` | Gift economy stats: total gifts, last 7d/30d, catalog size, recent transactions, full catalog | |
| GET | `/payments` | Wallet stats: total wallets, total/recent transactions, recent transaction list | |
| GET | `/analytics` | Platform analytics: DAU/WAU/MAU approximations, new users, social activity, education counts | |
| GET | `/security` | Security event summary: suspensions, bans, role changes last 7d; recent security audit events | |

---

## `/api/v1/backups/*` — Backup Metadata Management

File: `backend/src/routes/backup.routes.js`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create a backup metadata record |
| PUT | `/:id/status` | Update backup status |
| GET | `/` | List backups |
| GET | `/:id` | Get a specific backup |
| DELETE | `/:id` | Delete a backup record |
| GET | `/stats` | Backup statistics |
| POST | `/prune` | Prune old backup records |

---

## `/api/v1/internal/*` — SUPER_ADMIN Provisioning

File: `backend/src/routes/internal.routes.js`

| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| POST | `/admin/provision` | Provision or revoke SUPER_ADMIN status | Only SUPER_ADMIN can call this. Cannot self-modify. Prevents revoking last SUPER_ADMIN. Fully audited. |
| GET | `/admin/list` | List all current SUPER_ADMIN users | |

---

## `/api/v1/social/reports` — Social Report Moderation

File: `backend/src/routes/social.routes.js`

Only these two endpoints require SUPER_ADMIN — the rest of `/social/*` is accessible to all authenticated users.

| Method | Path | Description | Guard |
|--------|------|-------------|-------|
| GET | `/reports` | List all platform social reports | `authorize('SUPER_ADMIN')` |
| PATCH | `/reports/:id/review` | Review/resolve a social report | `authorize('SUPER_ADMIN')` |

---

## `/api/v1/users/*` — User Management (Partial Admin Access)

File: `backend/src/routes/user.routes.js`

SUPER_ADMIN does not own this entire route namespace, but has elevated access to certain operations:

| Method | Path | Description | SUPER_ADMIN privilege |
|--------|------|-------------|----------------------|
| GET | `/:id` | Get user profile | Receives full PII (email, phone, dateOfBirth, gender, address, emailVerified, lastLoginAt) — same as own-profile view |
| GET | `/` | List users | Can see across schools (via `isGlobalSuperAdmin` check — shows all users when no school filter applied) |

---

## Socket.IO Rooms

| Room | Purpose | How a SUPER_ADMIN joins |
|------|---------|------------------------|
| `role:SUPER_ADMIN` | Receives report alert notifications from `report-block.controller.js` | Automatically on socket connection (userRole from JWT) |
| `user:{userId}` | Personal room (DMs, personal events) | Automatically on socket connection |
| `voice:lobby` | Voice room created/deleted/updated broadcasts | Automatically on socket connection (all authenticated users) |

---

## What is NOT in the SUPER_ADMIN API Surface

The following route groups are explicitly NOT accessible to SUPER_ADMIN by virtue of platform role alone:

| Route group | Why not accessible |
|------------|-------------------|
| `/api/v1/live-classes/*` (staff operations) | Requires `eduStaff` — school membership with TEACHER/SCHOOL_ADMIN/SUPER_ADMIN role |
| `/api/v1/voice/*` (moderation operations) | Requires active `VoiceParticipant` record via `checkVoiceRole` |
| `/api/v1/schools/:id/*` (school management) | Requires school membership via `requireSchoolMember` |
| `/api/v1/classes/*` | Requires school membership |
| `/api/v1/school-memberships/*` | Requires SCHOOL_ADMIN school membership |
| `/api/v1/livekit/token` | Generic token: live class rooms require active participant; voice rooms require active participant |
