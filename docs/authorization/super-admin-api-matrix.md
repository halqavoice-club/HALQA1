# SUPER_ADMIN API Matrix

**Audit date:** 2026-08-26  
**Rule:** Every API listed here has been verified against the codebase. No undocumented API may be considered production-safe.

Legend:
- ✅ ALLOWED — by design; accessible via SUPER_ADMIN role
- ❌ DENIED — blocked by middleware, guard, or controller check
- ⚠️ VIOLATION — accessible but violates platform-vs-content separation
- ❌ NO API — functionality does not exist; would require implementation
- ❓ UNKNOWN — route file exists but authorization level not confirmed

Risk levels: 🟢 LOW · 🟡 MEDIUM · 🔴 HIGH · 🚨 CRITICAL

---

## Platform Administration APIs (SUPER_ADMIN only)

All routes in this section require: `ipAllowlist` + `authenticate` + `authorize('SUPER_ADMIN')`

| Method | API | SUPER_ADMIN | Purpose | Risk | Audit Required |
|--------|-----|-------------|---------|------|----------------|
| GET | `/api/v1/admin/stats/` | ✅ | Platform summary (users, schools, live, audit counts) | 🟢 | No |
| GET | `/api/v1/admin/stats/users` | ✅ | Paginated user list with search/filter | 🟡 | No |
| PATCH | `/api/v1/admin/stats/users/:id/status` | ✅ | Suspend / ban / activate / deactivate user | 🔴 | ✅ YES |
| GET | `/api/v1/admin/stats/schools` | ✅ | Paginated school list with search/filter | 🟢 | No |
| PATCH | `/api/v1/admin/stats/schools/:id/status` | ✅ | Activate or deactivate a school | 🟡 | ✅ YES |
| GET | `/api/v1/admin/stats/audit` | ✅ | Platform-wide audit logs (paginated, filterable) | 🟡 | No |
| GET | `/api/v1/admin/stats/announcements` | ✅ | Platform-wide announcements list | 🟢 | No |
| GET | `/api/v1/admin/stats/live-voice` | ✅ | Active live classes and voice rooms operational view | 🟢 | No |
| GET | `/api/v1/admin/stats/gifts` | ✅ | Gift economy stats and recent transactions | 🟡 | No |
| GET | `/api/v1/admin/stats/payments` | ✅ | Wallet stats and recent transactions | 🟡 | No |
| GET | `/api/v1/admin/stats/analytics` | ✅ | Platform analytics (DAU/WAU/MAU, engagement) | 🟢 | No |
| GET | `/api/v1/admin/stats/security` | ✅ | Security event summary (suspensions, bans, role changes) | 🟡 | No |
| POST | `/api/v1/backups/` | ✅ | Create backup metadata record | 🟡 | ✅ YES (gap) |
| PUT | `/api/v1/backups/:id/status` | ✅ | Update backup status | 🟡 | ✅ YES (gap) |
| GET | `/api/v1/backups/` | ✅ | List backups | 🟡 | No |
| GET | `/api/v1/backups/:id` | ✅ | Get specific backup | 🟡 | No |
| DELETE | `/api/v1/backups/:id` | ✅ | Delete backup metadata record | 🟡 | ✅ YES (gap) |
| GET | `/api/v1/backups/stats` | ✅ | Backup statistics | 🟢 | No |
| POST | `/api/v1/backups/prune` | ✅ | Prune old backup records | 🟡 | ✅ YES (gap) |
| POST | `/api/v1/internal/admin/provision` | ✅ | Grant or revoke SUPER_ADMIN status | 🚨 | ✅ YES |
| GET | `/api/v1/internal/admin/list` | ✅ | List all SUPER_ADMIN users | 🟡 | No |

---

## Elevated Access APIs (SUPER_ADMIN has elevated but not exclusive access)

These routes are accessible to other roles too, but SUPER_ADMIN has additional privileges.

| Method | API | SUPER_ADMIN | Elevated privilege | Risk | Audit Required |
|--------|-----|-------------|-------------------|------|----------------|
| GET | `/api/v1/social/reports` | ✅ | Only SUPER_ADMIN can access (other users cannot) | 🟡 | ✅ YES (gap) |
| PATCH | `/api/v1/social/reports/:id/review` | ✅ | Only SUPER_ADMIN can access | 🟡 | ✅ YES (gap) |
| GET | `/api/v1/users/:id` | ✅ | Full PII returned (vs public profile for others) | 🔴 | ✅ YES (gap) |
| GET | `/api/v1/users/` | ✅ | Can view users across schools (`isGlobalSuperAdmin` check) | 🟡 | No |

---

## Standard User APIs (SUPER_ADMIN = same as any authenticated user)

SUPER_ADMIN has no special privileges on these routes. They are accessible to any authenticated user.

| Method | API | SUPER_ADMIN | Same as | Risk |
|--------|-----|-------------|---------|------|
| GET | `/api/v1/voice/` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/voice/search` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/voice/:id` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/voice/` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/voice/:id/join` | ✅ | MEMBER (joins as AUDIENCE) | 🟡 |
| POST | `/api/v1/voice/:id/leave` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/voice/:id/participants` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/voice/:id/messages` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/voice/:id/messages` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/voice/:id/queue/raise` | ✅ | MEMBER (AUDIENCE role required) | 🟢 |
| POST | `/api/v1/voice/:id/livekit-token` | ✅ | MEMBER (if active participant) | 🟡 |
| POST | `/api/v1/voice/:id/gifts` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/live-classes/` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/live-classes/:id` | ✅ | MEMBER (PUBLIC only without school membership) | 🟢 |
| GET | `/api/v1/livekit/token` | ✅ | MEMBER (subject to room participant checks) | 🟡 |
| GET | `/api/v1/voice/stats/leaderboard` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/voice/stats/me` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/social/follow/:userId` | ✅ | MEMBER | 🟢 |
| GET | `/api/v1/social/followers/:userId` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/social/report/:userId` | ✅ | MEMBER | 🟢 |
| POST | `/api/v1/social/block/:userId` | ✅ | MEMBER | 🟢 |

---

## Content Participation APIs — SUPER_ADMIN SHOULD NOT Access

These routes are blocked for SUPER_ADMIN by correct enforcement, or represent violations where they are incorrectly accessible.

| Method | API | Status | Issue | Risk |
|--------|-----|--------|-------|------|
| POST | `/api/v1/live-classes/:id/join` (school stream) | ❌ DENIED | `resolveStreamAccess` requires school membership | 🔴 |
| POST | `/api/v1/live-classes/:id/join` (public stream) | ⚠️ VIOLATION | Accessible + receives HOST role (LCSV-001) | 🔴 |
| POST | `/api/v1/live-classes/:id/token` (school stream) | ❌ DENIED | Requires school membership + active participant | 🔴 |
| POST | `/api/v1/live-classes/:id/token` (public stream) | ⚠️ VIOLATION | Accessible if joined (LCSV-001 enables this) | 🔴 |
| POST | `/api/v1/live-classes/` (school stream) | ⚠️ VIOLATION | `isAdmin` check includes SUPER_ADMIN (LCSV-002) | 🟡 |
| PATCH | `/api/v1/live-classes/:id/mute-all` | ⚠️ VIOLATION | `resolveStreamStaffAccess` + SUPER_ADMIN in `isStaff` | 🟡 |
| DELETE | `/api/v1/live-classes/:id/participants/:userId` | ⚠️ VIOLATION | `resolveStreamStaffAccess` + SUPER_ADMIN in `isStaff` | 🟡 |
| POST | `/api/v1/voice/:id/moderator/:userId` | ❌ DENIED | `checkVoiceRole([HOST])` — requires VoiceParticipant | 🔴 |
| POST | `/api/v1/voice/:id/queue/approve` | ❌ DENIED | Controller checks HOST/MOD VoiceParticipant | 🔴 |
| PATCH | `/api/v1/voice/:id/mute-all` | ❌ DENIED | `checkVoiceRole([HOST, MODERATOR])` | 🔴 |
| DELETE | `/api/v1/voice/:id/kick/:userId` | ❌ DENIED | Controller checks HOST/MOD VoiceParticipant | 🔴 |
| GET | `/api/v1/voice/:id/queue` (full) | ❌ DENIED | SA-FIX-09: requires HOST/MOD participant | 🟡 |

---

## APIs That Do Not Exist But Should (Gaps)

| Intended function | SUPER_ADMIN | Risk | Priority |
|------------------|-------------|------|----------|
| `GET /admin/payouts` — list payout requests | ❌ NO API | 🚨 CRITICAL | HIGH |
| `PATCH /admin/payouts/:id/status` — approve/reject payout | ❌ NO API | 🚨 CRITICAL | HIGH |
| `POST /admin/users/:id/credits` — admin coin grant | ❌ NO API | 🔴 HIGH | MEDIUM |
| `POST /admin/live-classes/:id/terminate` — force-end a class | ❌ NO API | 🟡 MEDIUM | LOW |
| `POST /admin/voice/:id/terminate` — force-end a voice room | ❌ NO API | 🟡 MEDIUM | LOW |
| `GET /admin/users/:id/sessions` — view user sessions | ❌ NO API | 🟡 MEDIUM | MEDIUM |
| `DELETE /admin/users/:id/sessions` — revoke all sessions | ❌ NO API | 🔴 HIGH | HIGH |
| `GET /admin/coin-packages` — manage coin catalog | ❌ NO API | 🔴 HIGH | MEDIUM |
| `PATCH /admin/coin-packages/:id` — update coin package | ❌ NO API | 🔴 HIGH | MEDIUM |
| `GET /admin/webhooks` — manage webhooks | ❌ NO API | 🔴 HIGH | LOW |
| `POST /admin/notifications/broadcast` — platform announcement | ❌ NO API | 🟡 MEDIUM | LOW |
| `GET /admin/pk/config` — view/edit PK configuration | ❌ NO API | 🟡 MEDIUM | LOW |

---

## Socket.IO Events — SUPER_ADMIN Access

| Room / Event | SUPER_ADMIN | Notes |
|-------------|-------------|-------|
| `role:SUPER_ADMIN` (receive) | ✅ | Report alert notifications |
| `user:{userId}` (receive) | ✅ | Own personal events |
| `voice:lobby` (receive) | ✅ | Voice room created/updated/deleted |
| `school:{schoolId}` (join) | ❌ DENIED | SA-FIX-10: no cross-school socket |
| `feed:school:{schoolId}` (join) | ⚠️ VIOLATION | SVSV-001: legacy bypass still present |
| `class:{classId}` (join) | ❌ DENIED | SA-FIX-11: requires school membership |
| `liveclass:{id}` (join) | ❌ DENIED | Requires active liveClassParticipant |
| `voice:{roomId}` (join) | ❌ DENIED | Requires active voiceParticipant |

---

## Violation Summary

| ID | API / Event | Violation | Severity |
|----|-------------|-----------|---------|
| LCSV-001 | `POST /live-classes/:id/join` (public) | SUPER_ADMIN receives HOST role | 🔴 HIGH |
| LCSV-002 | `POST /live-classes/` (school) | SUPER_ADMIN bypasses eduStaff via isAdmin check | 🟡 MEDIUM |
| LCSV-002 | `DELETE /live-classes/:id/messages/:id` | SUPER_ADMIN can delete chat as "host" | 🟡 MEDIUM |
| LCSV-003 | `PATCH /live-classes/:id/participants/:userId/video` | SUPER_ADMIN can set other user's video state | 🟢 LOW |
| SVSV-001 | `feed:join:school` socket event | SUPER_ADMIN can join any school's feed room | 🟡 MEDIUM |
| LTSV-001 | `POST /livekit/token` (liveclass rooms) | SUPER_ADMIN skips school isolation check | 🟢 LOW (mitigated) |

---

## Audit Log Coverage

| Admin Action | Currently Logged | Entity |
|-------------|-----------------|--------|
| User status change | ✅ | `user_status` |
| School activation change | ✅ | `school_status` |
| SUPER_ADMIN role grant | ✅ | `user_platform_role` |
| SUPER_ADMIN role revoke | ✅ | `user_platform_role` |
| Social report review | ❌ GAP | Should be `report_review` |
| Admin reads user PII | ❌ GAP | Should be `user_profile_access` |
| Backup mutations | ❌ GAP | Should be `backup_metadata` |
| Payout actions | N/A (no API) | Should be `payout_request` |
| Admin coin grant | N/A (no API) | Should be `wallet_transaction` |
