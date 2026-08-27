# Database Model Inventory — SUPER_ADMIN Access

**Audit date:** 2026-08-26  
**Source:** `backend/prisma/schema.prisma`  
**Rule:** SUPER_ADMIN = Platform Administration ONLY. Content-participation models are out of scope unless the SUPER_ADMIN has also been provisioned a content role through normal paths.

Legend for CRUD columns:
- ✅ ALLOWED — currently accessible via a SUPER_ADMIN API
- ⚠️ VIOLATION — accessible but should not be
- ❌ DENIED — not accessible via any SUPER_ADMIN API
- 🔒 SENSITIVE — contains PII or secrets
- 📋 AUDIT — every write must be audit-logged

---

## 1. Identity & Authentication Models

### `users` (User)

**Purpose:** Core identity record. Every platform member.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (list, search) | ✅ | `GET /admin/stats/users` | Paginated; field-limited to non-secret fields |
| Read (full PII) | ✅ | `GET /users/:id` | isSuperAdmin check grants full profile |
| Create | ❌ | Not available | Users self-register |
| Update status | ✅ | `PATCH /admin/stats/users/:id/status` | ACTIVE/SUSPENDED/BANNED/INACTIVE only |
| Update role | ✅ (SUPER_ADMIN only) | `POST /internal/admin/provision` | Only provisions SUPER_ADMIN ↔ MEMBER |
| Update profile fields | ❌ | Not available | Platform admin cannot edit user profiles |
| Delete / soft-delete | ❌ | Not available | |
| Read `passwordHash` | ❌ | Never returned by any API | |
| Read `twoFactorSecret` | ❌ | Never returned by any API | |
| Read `twoFactorEnabled` | ✅ (view only) | Admin stats user view | |

**Sensitive fields:** `passwordHash`, `twoFactorSecret`, `fcmToken`, `phone`, `dateOfBirth`, `address`, `emailVerified`  
**Audit requirement:** All status changes → `audit_logs` (entity=`user_status`, action=UPDATE)  
**Related APIs:** `/admin/stats/users`, `/users/:id`, `/internal/admin/provision`

---

### `school_memberships` (SchoolMembership)

**Purpose:** School-scoped education roles. Authoritative source for school access.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (own school) | ✅ (if has membership) | School membership APIs | Only if SUPER_ADMIN also has a SchoolMembership |
| Read (all schools) | ❌ | No platform-admin list endpoint | |
| Create / assign | ❌ | Not via platform admin APIs | Only school admins can manage memberships |
| Update role | ❌ | Not via platform admin APIs | `SUPER_ADMIN` cannot be assigned as a membership role (roleGuard.js blocks it) |
| Delete | ❌ | Not via platform admin APIs | |

**Sensitive fields:** None beyond userId/schoolId/role  
**Audit requirement:** Role changes require audit trail  
**Note:** SUPER_ADMIN is NOT a valid `school_memberships.role` value — enforced by DB CHECK constraint and `roleGuard.js`

---

### `refresh_tokens` (RefreshToken)

**Purpose:** JWT refresh token storage for session management.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No API | Token values are secrets |
| Revoke user's tokens | ✅ (indirect) | Suspending/banning user triggers cache invalidation | Actual revocation is via cache invalidation |
| Delete | ❌ | No platform admin API | |

**Sensitive fields:** `token` — never returned by any API  
**Audit requirement:** Implicit via user status change

---

### `otp_codes` (OtpCode)

**Purpose:** One-time passwords for email verification and password reset.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No API | OTP values are secrets |
| Create | ❌ | Not a platform admin function | |
| Delete | ❌ | No platform admin API | |

**Sensitive fields:** `code` — never returned by any API  
**Audit requirement:** N/A

---

### `sessions` (Session)

**Purpose:** Per-device session tracking for concurrent session management.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read user sessions | ✅ (indirect) | User profile includes session count | Full session list: no direct API |
| Terminate a session | ✅ (indirect) | Suspending/banning user terminates sessions | |
| Read session details | ❌ | No platform admin session list API | Sessions are user-owned |

**Sensitive fields:** `deviceFingerprint`, `ipAddress`, `userAgent`  
**Audit requirement:** User suspension which terminates sessions → audit log via user status change

---

### `auth_providers` (AuthProvider)

**Purpose:** OAuth identity links (Google, Apple, etc.).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API | |
| Create / Delete | ❌ | User-only action | |

**Sensitive fields:** `providerAccountId`  
**Audit requirement:** N/A

---

## 2. School & Academic Structure Models

### `schools` (School)

**Purpose:** School entity — the organizational container for all education data.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (list, search) | ✅ | `GET /admin/stats/schools` | Paginated; returns metadata + member/class counts |
| Read (full details) | ❌ | No full school detail endpoint in admin API | |
| Create | ❌ | Not a platform admin function — schools are created by their admins | |
| Update `isActive` | ✅ | `PATCH /admin/stats/schools/:id/status` | Activate or deactivate |
| Update name/address/settings | ❌ | Not a platform admin function | |
| Delete | ❌ | Not available via platform admin | |

**Sensitive fields:** None (public metadata)  
**Audit requirement:** Activation/deactivation → `audit_logs` (entity=`school_status`, action=UPDATE)  
**Related APIs:** `/admin/stats/schools`, `/admin/stats/schools/:id/status`

---

### `school_settings` (SchoolSettings)

**Purpose:** Per-school configuration (grading scales, notification preferences, etc.).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API | School-scoped only |
| Update | ❌ | No platform admin API | |

---

### `classes`, `terms`, `grade_categories`, `grades` (Class, Term, GradeCategory, Grade)

**Purpose:** Academic structure — classes, terms, grade records.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API | School-scoped only |
| Write | ❌ | No platform admin API | |

**Note:** SUPER_ADMIN sees aggregate counts (totalClasses) via `/admin/stats` but cannot read individual records.

---

### `students`, `teachers`, `guardians` (Student, Teacher, Guardian)

**Purpose:** Profile extensions for people in education roles.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API for individual records | |
| Aggregate counts | ✅ | `/admin/stats/analytics` (totalStudents, totalTeachers) | Counts only |
| Write | ❌ | No platform admin API | |

---

### `enrollments`, `attendance`, `behavior_logs` (Enrollment, Attendance, BehaviorLog)

**Purpose:** Student academic records — enrollment, attendance, behavior.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API | |
| Write | ❌ | No platform admin API | |

---

## 3. Moderation Models

### `user_reports` (UserReport)

**Purpose:** Social reports filed by users against other users.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (list all) | ✅ | `GET /social/reports` | Paginated; all platform reports |
| Read (filtered) | ✅ | Query params: status, reporter, reported | |
| Update status (review) | ✅ | `PATCH /social/reports/:id/review` | Sets status: REVIEWED / DISMISSED / ACTION_TAKEN |
| Create | ❌ | Not applicable — reports are user-to-user | |
| Delete | ❌ | No delete endpoint for reports | |

**Sensitive fields:** `description` (may contain sensitive content)  
**Audit requirement:** Review actions should be audit-logged (currently uses Socket.IO alert only — see known-gaps.md)  
**Related APIs:** `/social/reports`, `/social/reports/:id/review`

---

### `user_blocks` (UserBlock)

**Purpose:** User-to-user blocks.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin API | User-private data |
| Write | ❌ | Not a platform admin function | |

---

## 4. Live Class Models

### `live_classes` (LiveClass)

**Purpose:** Live class/stream session records.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (aggregate counts) | ✅ | `GET /admin/stats/live-voice` | Count of active/total sessions |
| Read (live session list) | ✅ | `GET /admin/stats/live-voice` | Returns recent active sessions with participant counts |
| Read (full details) | ❌ | No individual record access in admin API | Must join as participant (violation LCSV-001 exists) |
| Create | ⚠️ VIOLATION | Via `POST /live-classes` with SUPER_ADMIN role | Should require school membership — LCSV-002 |
| Update | ⚠️ VIOLATION | Via `PATCH /live-classes/:id` with SUPER_ADMIN role | LCSV-002 |
| Delete | ⚠️ VIOLATION | Via `DELETE /live-classes/:id` with SUPER_ADMIN role | LCSV-002 |
| Start / End (platform admin) | ❌ | No admin endpoint to terminate a class | Platform admin terminates by suspending the host user |

**Sensitive fields:** None  
**Audit requirement:** No audit trail for live class mutations currently  
**Violations:** LCSV-001 (receives HOST role on join), LCSV-002 (treated as staff)

---

### `live_class_participants` (LiveClassParticipant)

**Purpose:** Tracks who is in a live class with what role.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (participant list) | ⚠️ VIOLATION | Via `GET /live-classes/:id/participants` | Requires school access |
| Create (join class) | ⚠️ VIOLATION | Via `POST /live-classes/:id/join` | Grants HOST role — LCSV-001 |
| Update (mute, kick) | ⚠️ VIOLATION | Via staff endpoints | Requires school membership but SUPER_ADMIN bypasses — LCSV-002 |

---

### `live_class_messages`, `live_class_hand_queue`, `live_class_attendance` (LiveClassMessage, LiveClassHandQueue, LiveClassAttendance)

**Purpose:** Live class chat, hand-raise queue, attendance records.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ⚠️ VIOLATION | Via class endpoints with SUPER_ADMIN role | Should require school membership |
| Write | ⚠️ VIOLATION | Delete messages as "host" — LCSV-002 | |

---

## 5. Voice Room Models

### `voice_rooms` (VoiceRoom)

**Purpose:** Voice club room sessions.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (aggregate counts) | ✅ | `GET /admin/stats/live-voice` | Count of active/total, recent room list |
| Read (list, search) | ✅ (same as any user) | `GET /voice/` | No special admin access — same as MEMBER |
| Read (individual) | ✅ (same as any user) | `GET /voice/:id` | No special admin access |
| Create | ✅ (same as any user) | `POST /voice/` | Any authenticated user can create |
| Update | ❌ | Only room HOST can update | |
| Delete | ❌ | Only room HOST can delete | |
| Terminate (platform admin) | ❌ | No admin endpoint | Suspend host user instead |

**Audit requirement:** None for read operations  
**Note:** SUPER_ADMIN joining a voice room is treated identically to any MEMBER — no privilege escalation in voice rooms (SA-FIX-09 confirmed)

---

### `voice_participants` (VoiceParticipant)

**Purpose:** Active participants with roles in a voice room.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ (elevated) | Same as any user: `GET /voice/:id/participants` | No special admin view |
| Create (join) | ✅ (same as any user) | `POST /voice/:id/join` | Joins as AUDIENCE |
| Update role (promote/kick) | ❌ | Requires HOST/MOD VoiceParticipant record | No platform-admin bypass |
| View full queue | ❌ | SA-FIX-09: requires HOST/MOD participant record | |

---

### `voice_messages`, `voice_room_members`, `voice_host_stats` (VoiceMessage, VoiceRoomMember, VoiceHostStats)

**Purpose:** Voice chat, permanent members, host statistics.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ (same as any user) | `GET /voice/:id/messages` | No special admin access |
| Write | ✅ (same as any user) | `POST /voice/:id/messages` | No special admin access |
| Host stats | ❌ | Own stats only | |

---

## 6. Financial Models

### `wallets` (Wallet)

**Purpose:** Per-user coin and diamond balances.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (aggregate) | ✅ | `GET /admin/stats/payments` | Total wallet count only |
| Read (individual) | ❌ | No per-user wallet view in admin API | |
| Update balance | ❌ | No admin endpoint for balance mutations | |
| Admin grant | ❌ | `ADMIN_GRANT` transaction type exists in schema but no admin endpoint currently | |

**Sensitive fields:** `coins`, `diamonds`, `totalSpent`, `totalEarned` — financial PII  
**Audit requirement:** Any balance mutation would require audit log  
**Risk:** HIGH — any admin balance write must be transactionally safe and fully audited

---

### `wallet_transactions` (WalletTransaction)

**Purpose:** Immutable ledger of all coin credits and debits.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (recent list) | ✅ | `GET /admin/stats/payments` | Last 50 transactions with user info |
| Read (aggregate) | ✅ | `GET /admin/stats/payments` | Total/recent counts |
| Create | ❌ | No admin endpoint for creating transactions | |
| Update / Delete | ❌ | Ledger is immutable — never modified | |

**Sensitive fields:** `stripeSessionId`, `coins`  
**Audit requirement:** N/A — this IS the audit trail for wallet operations

---

### `coin_packages` (CoinPackage)

**Purpose:** Purchasable coin packages (catalog).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ | `GET /admin/stats/gifts` returns catalog | |
| Create / Update / Delete | ❌ | No admin catalog management endpoint currently | |

**Risk:** MEDIUM — changing coin package prices affects revenue

---

### `gift_transactions` (GiftTransaction)

**Purpose:** Immutable record of every gift sent.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (recent) | ✅ | `GET /admin/stats/gifts` | Last 50 transactions with sender/receiver info |
| Read (aggregate) | ✅ | `GET /admin/stats/gifts` | Counts by period |
| Create | ❌ | Gifts are sent by users — no admin gifting API | |
| Update / Delete | ❌ | Immutable ledger | |

**Sensitive fields:** `senderId`, `receiverId`, `coinsSpent`  
**Audit requirement:** N/A — record itself is the audit trail

---

### `gifts` (Gift — the catalog)

**Purpose:** Gift catalog items (definitions).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ | `GET /admin/stats/gifts` returns full catalog | |
| Create / Update / Delete | ❌ | No admin gift catalog management endpoint currently | |

**Risk:** MEDIUM — modifying active gifts affects ongoing transactions

---

### `payout_requests` (PayoutRequest)

**Purpose:** Diamond withdrawal requests from hosts.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No admin payout management endpoint currently | Gap — payout approval requires a dedicated admin API |
| Approve / Reject | ❌ | No admin endpoint currently | |

**Sensitive fields:** `accountDetails` (bank/PayPal info) — HIGH sensitivity  
**Risk:** CRITICAL — payout operations involve real money  
**Audit requirement:** Every payout state change must be audit-logged  
**Gap:** No admin payout management API exists in the current codebase

---

### `room_gift_leaderboard` (RoomGiftLeaderboard)

**Purpose:** Per-room gift totals for leaderboard display.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ (same as any user) | `GET /voice/:id/gifts/leaderboard` | No special admin access |
| Write | ❌ | System-managed via gift transactions | |

---

## 7. Security & Audit Models

### `audit_logs` (AuditLog)

**Purpose:** Immutable platform-wide audit trail.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (all) | ✅ | `GET /admin/stats/audit` | Paginated; filterable by entity, action, userId, date range |
| Create | ✅ (system) | Automatically created by admin actions | SUPER_ADMIN actions write here |
| Update / Delete | ❌ | Audit logs are immutable | |

**Related APIs:** `/admin/stats/audit`

---

### `backup_metadata` (BackupMetadata)

**Purpose:** Records of database backups (metadata only — not the actual backup files).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ | `GET /backups`, `GET /backups/:id`, `GET /backups/stats` | |
| Create | ✅ | `POST /backups` | Creates metadata record |
| Update status | ✅ | `PUT /backups/:id/status` | |
| Delete | ✅ | `DELETE /backups/:id` | Deletes metadata record only — not actual file |
| Prune old records | ✅ | `POST /backups/prune` | Removes old metadata |

**Sensitive fields:** `filePath`, `checksum` — reveal backup storage locations  
**Audit requirement:** All mutations should be logged  
**Risk:** MEDIUM — backup paths could be used to find and exfiltrate backup files

---

### `sessions` (Session)

Already documented in section 1.

---

## 8. Notification & Communication Models

### `notifications` (Notification)

**Purpose:** In-app notifications for users.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | User-private — no admin notification read API | |
| Create (platform broadcast) | ❌ | No admin notification broadcast endpoint currently | Gap |
| Update / Delete | ❌ | No admin endpoint | |

---

### `announcements` (Announcement)

**Purpose:** School-wide announcements (scoped to a school).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read (list) | ✅ | `GET /admin/stats/announcements` | Platform-wide list, paginated |
| Read (details) | ✅ | Same endpoint | Full announcement content |
| Create platform-wide announcement | ❌ | No platform-announcement endpoint | Gap |
| Create school announcement | ❌ | Requires school membership | |
| Update / Delete | ❌ | No admin announcement write endpoint | |

---

### `messages`, `message_recipients` (Message, MessageRecipient)

**Purpose:** School broadcast messages (teacher-to-class/school).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin access | School-scoped, private |
| Write | ❌ | No platform admin access | |

---

### `direct_messages`, `dm_conversations` (DirectMessage, DmConversation)

**Purpose:** Private 1:1 messages between users.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin access | Private messages — legal/privacy implications |
| Write | ❌ | No platform admin access | |

**Note:** Even for moderation purposes, accessing private DMs without a legal process would be a privacy violation.

---

## 9. Analytics Models

### `daily_school_stats` (DailySchoolStats)

**Purpose:** Pre-aggregated per-school daily statistics.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No direct access in admin API | Used internally by analytics controller |
| Write | ❌ | System-managed | |

---

### `daily_user_stats` (DailyUserStats)

**Purpose:** Pre-aggregated per-user daily statistics.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No direct per-user stats in admin API | |
| Aggregate view | ✅ | `GET /admin/stats/analytics` | Platform-level aggregations only |

---

### `global_leaderboard`, `school_leaderboard` (GlobalLeaderboard, SchoolLeaderboard)

**Purpose:** Pre-computed rankings.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ✅ (same as any user) | `GET /voice/stats/leaderboard` | No special admin access |
| Recalculate | ✅ (UI only, school admin) | Frontend admin button | `isAdmin` check via `useEducationRole` |

---

## 10. System Configuration Models

### `webhooks`, `webhook_deliveries` (Webhook, WebhookDelivery)

**Purpose:** Outbound webhook configuration and delivery history.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin webhook management API currently | Gap |
| Create / Update / Delete | ❌ | No platform admin webhook management API | |

**Risk:** HIGH — webhooks can exfiltrate data to arbitrary URLs  
**Audit requirement:** All webhook CRUD requires audit logging

---

### `scheduled_jobs`, `job_executions` (ScheduledJob, JobExecution)

**Purpose:** Background job scheduling and execution history.

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin job management API | |
| Write | ❌ | No platform admin API | |

---

### `pk_config` (PKConfig)

**Purpose:** Single-row PK system configuration (matchmaking, scoring, feature flags).

| Operation | SUPER_ADMIN | Via | Notes |
|-----------|-------------|-----|-------|
| Read | ❌ | No platform admin PK config endpoint currently | |
| Update | ❌ | No platform admin API | Gap — PK config changes affect all users |

---

## 11. Social / Content Models (SUPER_ADMIN has no special access)

The following models are accessible to SUPER_ADMIN only as a regular authenticated user — no elevated platform privileges apply:

| Model | SUPER_ADMIN access |
|-------|-------------------|
| `posts` | Same as any MEMBER |
| `post_reactions`, `post_comments`, `post_bookmarks`, `post_views` | Same as any MEMBER |
| `stories`, `story_views`, `story_reactions` | Same as any MEMBER |
| `communities`, `community_members` | Same as any MEMBER |
| `follows`, `friend_requests` | Same as any MEMBER |
| `creator_profiles`, `creator_tiers`, `creator_subscriptions`, `creator_tips` | Same as any MEMBER |
| `group_conversations`, `group_members`, `group_messages` | Same as any MEMBER |
| `hashtags`, `trending_hashtags`, `search_index` | Same as any MEMBER |

---

## 12. PK Battle System (SUPER_ADMIN has partial platform access)

| Model | SUPER_ADMIN | Notes |
|-------|-------------|-------|
| `pk_matches` | Read (admin PK routes) | `/api/v1/admin/pk` routes exist (no auth found — assumed SUPER_ADMIN by pattern) |
| `pk_participants` | Read | Via admin PK routes |
| `pk_seasons`, `pk_config` | Read | Via admin PK routes |
| `pk_invitations`, `pk_votes` | ❌ | User-private |
| `pk_history`, `pk_audit_logs` | Read | Via admin PK routes |

**Note:** `/api/v1/admin/pk` route file was not found in the codebase audit — authorization level assumed but not confirmed. Treat as UNKNOWN until reviewed.

---

## Summary: Models SUPER_ADMIN Should NOT Access

| Model | Current state | Risk |
|-------|--------------|------|
| `live_class_participants` (join as HOST) | ⚠️ VIOLATION | HIGH |
| `live_class_messages` (delete as host) | ⚠️ VIOLATION | MEDIUM |
| `live_classes` (create/update school streams) | ⚠️ VIOLATION | MEDIUM |
| `refresh_tokens` (read) | ✅ BLOCKED | — |
| `twoFactorSecret` (read) | ✅ BLOCKED | — |
| `passwordHash` (read) | ✅ BLOCKED | — |
| `direct_messages` (read) | ✅ BLOCKED | — |
| `payout_requests` (manage) | ❌ NO API | GAP |
| `notifications` (broadcast) | ❌ NO API | GAP |
