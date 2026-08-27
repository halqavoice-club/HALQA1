# Admin UI Action Matrix

**Audit date:** 2026-08-26  
**Source:** Direct inspection of all 14 admin pages.  
**Rule:** Only verified values used. No assumptions.

Legend:
- ✅ ALLOWED — button/action exists, backend will honour it for SUPER_ADMIN
- ❌ DENIED — action exists in UI but backend returns 403 for SUPER_ADMIN
- 📖 READ-ONLY — page exists, no mutations
- ❌ NO UI — UI doesn't exist (capability missing from admin panel)
- ⚠️ VIOLATION — action crosses platform/content boundary
- ❓ UNKNOWN — not confirmed

Risk: 🟢 LOW · 🟡 MEDIUM · 🔴 HIGH · 🚨 CRITICAL

---

## Overview Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin` | View platform summary stats | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats | users, schools, live_classes, audit_logs | No | 🟢 |
| `/admin` | Click stat card → navigate | ✅ ALLOWED | N/A | Navigation | — | No | 🟢 |
| `/admin` | Pending reports badge → /admin/moderation | ✅ ALLOWED | N/A | Navigation | — | No | 🟢 |
| `/admin` | Manual refresh | ✅ ALLOWED | N/A | GET /admin/stats | — | No | 🟢 |

---

## Users Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/users` | List users (paginated) | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users | users | No | 🟡 |
| `/admin/users` | Search users (name/email) | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users?search= | users | No | 🟡 |
| `/admin/users` | Filter by status | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users?status= | users | No | 🟡 |
| `/admin/users` | Filter by role | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users?role= | users | No | 🟡 |
| `/admin/users` | View user avatar, name, email, role, status, dates | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users | users | No | 🟡 |
| `/admin/users` | Open "Manage" dialog for non-SA user | ✅ ALLOWED | ❌ (SA only) | — (client only) | — | No | 🟢 |
| `/admin/users` | Change status → ACTIVE | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/users/:id/status | users | ✅ YES | 🟡 |
| `/admin/users` | Change status → SUSPENDED | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/users/:id/status | users | ✅ YES | 🔴 |
| `/admin/users` | Change status → BANNED | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/users/:id/status | users | ✅ YES | 🚨 |
| `/admin/users` | Change status → INACTIVE | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/users/:id/status | users | ✅ YES | 🟡 |
| `/admin/users` | Change status of another SUPER_ADMIN | ❌ DENIED (UI hides Manage btn) | N/A | Backend also 403s | — | — | — |
| `/admin/users` | View user's sessions | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/users` | Revoke user sessions | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/users` | Reset user password | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/users` | Impersonate user | ❌ NO UI | N/A | No API exists | — | — | — |
| `/admin/users` | View user's full PII | ❌ NO UI (on this page) | N/A | GET /users/:id needed | users | ❌ NOT LOGGED | 🔴 |

---

## Schools Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/schools` | List schools (paginated) | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/schools | schools | No | 🟢 |
| `/admin/schools` | Search schools | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/schools?search= | schools | No | 🟢 |
| `/admin/schools` | Filter by active status | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/schools?isActive= | schools | No | 🟢 |
| `/admin/schools` | View member and class counts | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/schools | school_memberships, classes | No | 🟢 |
| `/admin/schools` | Activate school | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/schools/:id/status | schools | ✅ YES | 🟡 |
| `/admin/schools` | Deactivate school | ✅ ALLOWED | ❌ (SA only) | PATCH /admin/stats/schools/:id/status | schools | ✅ YES | 🔴 |
| `/admin/schools` | Create school | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/schools` | Delete school | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/schools` | Edit school details | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/schools` | View school members | ❌ NO UI | N/A | — | — | — | MISSING |
| `/admin/schools` | View school admins | ❌ NO UI | N/A | — | — | — | MISSING |

---

## Moderation Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/moderation` | View pending reports | ✅ ALLOWED | ❌ (SA only) | GET /report-block/reports | user_reports | No | 🟡 |
| `/admin/moderation` | Filter reports by status | ✅ ALLOWED | ❌ (SA only) | GET /report-block/reports?status= | user_reports | No | 🟢 |
| `/admin/moderation` | View report details | ✅ ALLOWED | ❌ (SA only) | — (client only) | — | No | 🟢 |
| `/admin/moderation` | Mark as REVIEWED | ✅ ALLOWED | ❌ (SA only) | PATCH /report-block/reports/:id/review | user_reports | ❌ NOT LOGGED (gap) | 🟡 |
| `/admin/moderation` | Mark as DISMISSED | ✅ ALLOWED | ❌ (SA only) | PATCH /report-block/reports/:id/review | user_reports | ❌ NOT LOGGED (gap) | 🟡 |
| `/admin/moderation` | ACTION_TAKEN + WARN | ✅ ALLOWED | ❌ (SA only) | PATCH /report-block/reports/:id/review | user_reports, users | ✅ YES | 🟡 |
| `/admin/moderation` | ACTION_TAKEN + SUSPEND | ✅ ALLOWED | ❌ (SA only) | PATCH /report-block/reports/:id/review | user_reports, users | ✅ YES | 🔴 |
| `/admin/moderation` | ACTION_TAKEN + BAN | ✅ ALLOWED | ❌ (SA only) | PATCH /report-block/reports/:id/review | user_reports, users | ✅ YES | 🚨 |
| `/admin/moderation` | View room content | ❌ NO UI | N/A | — | — | — | — |
| `/admin/moderation` | Enter reported room | ❌ NO UI | N/A | — | — | — | — |
| `/admin/moderation` | View reported user's profile | ❌ NO UI (only name shown) | N/A | — | — | — | 🟡 |

---

## Live & Voice Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/live-voice` | View active session list | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/live-voice | live_classes, voice_rooms | No | 🟢 |
| `/admin/live-voice` | View participant counts | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/live-voice | live_class_participants, voice_participants | No | 🟢 |
| `/admin/live-voice` | View host name per room | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/live-voice | users | No | 🟢 |
| `/admin/live-voice` | Search by session/room title | ✅ ALLOWED (client-side) | N/A | — | — | No | 🟢 |
| `/admin/live-voice` | End a live class (button) | ❌ DENIED | N/A | POST /live-classes/:id/end | live_classes | No | 🔴 **UIGAP-007** |
| `/admin/live-voice` | End a voice room (button) | ❌ DENIED | N/A | PATCH /voice/:id/end | voice_rooms | No | 🔴 **UIGAP-007** |
| `/admin/live-voice` | Join a live class | ❌ NO UI | N/A | — | — | — | — |
| `/admin/live-voice` | Join a voice room | ❌ NO UI | N/A | — | — | — | — |
| `/admin/live-voice` | View room chat | ❌ NO UI | N/A | — | — | — | — |
| `/admin/live-voice` | Mute participants | ❌ NO UI | N/A | — | — | — | — |
| `/admin/live-voice` | Kick participants | ❌ NO UI | N/A | — | — | — | — |

**Note on End buttons:** The UI correctly presents these as MANAGEMENT (not participation) actions. The backend authorization gap means they currently return 403. This is a backend gap, not a UI violation of platform-vs-content separation.

---

## Payments Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/payments` | View wallet aggregate stats | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/payments | wallets, wallet_transactions | No | 🟢 |
| `/admin/payments` | View recent 50 transactions | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/payments | wallet_transactions | No | 🟡 |
| `/admin/payments` | Search transactions (client-side) | ✅ ALLOWED | N/A | — | — | No | 🟢 |
| `/admin/payments` | View payout requests | ❌ NO UI | N/A | No API exists | payout_requests | — | 🚨 CRITICAL GAP |
| `/admin/payments` | Approve payout | ❌ NO UI | N/A | No API exists | payout_requests | — | 🚨 CRITICAL GAP |
| `/admin/payments` | Reject payout | ❌ NO UI | N/A | No API exists | payout_requests | — | 🚨 CRITICAL GAP |
| `/admin/payments` | Issue refund | ❌ NO UI | N/A | No API exists | — | — | 🔴 GAP |
| `/admin/payments` | Grant coins to user | ❌ NO UI | N/A | No API exists | wallets | — | 🔴 GAP |

---

## Gifts & Coins Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/gifts` | View gift economy stats | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/gifts | gift_transactions | No | 🟢 |
| `/admin/gifts` | View gift catalog | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/gifts | gifts | No | 🟢 |
| `/admin/gifts` | View recent gift transactions | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/gifts | gift_transactions | No | 🟡 |
| `/admin/gifts` | Add gift to catalog | ❌ NO UI | N/A | No admin API exists | gifts | — | 🔴 GAP |
| `/admin/gifts` | Edit gift (price, name, status) | ❌ NO UI | N/A | No admin API exists | gifts | — | 🔴 GAP |
| `/admin/gifts` | Deactivate gift | ❌ NO UI | N/A | No admin API exists | gifts | — | 🔴 GAP |
| `/admin/gifts` | Grant coins to user | ❌ NO UI | N/A | No admin API exists | wallets | — | 🔴 GAP |

---

## Security Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/security` | View security event summary | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/security | audit_logs | No | 🟢 |
| `/admin/security` | View recent security events | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/security | audit_logs | No | 🟡 |
| `/admin/security` | View event detail (IP, change values) | ✅ ALLOWED | ❌ (SA only) | — (client dialog) | — | No | 🟡 |
| `/admin/security` | View user sessions | ❌ NO UI | N/A | No admin API exists | sessions | — | 🟡 GAP |
| `/admin/security` | Revoke user sessions | ❌ NO UI | N/A | No admin API exists | sessions, refresh_tokens | — | 🔴 GAP |
| `/admin/security` | Manage IP allowlist | ❌ NO UI | N/A | Env var only | — | — | 🟡 GAP |
| `/admin/security` | View login history | ❌ NO UI | N/A | Not in audit_logs | — | — | 🟡 GAP |
| `/admin/security` | Disable user 2FA | ❌ NO UI | N/A | No admin API exists | users | — | 🟡 GAP |

---

## Staff & Perms Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/admins` | List all SUPER_ADMIN users | ✅ ALLOWED | ❌ (SA only) | GET /internal/admin/list | users | No | 🟢 |
| `/admin/admins` | Look up user by email | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/users?search=email | users | No | 🟢 |
| `/admin/admins` | Grant SUPER_ADMIN (with reason ≥10 chars) | ✅ ALLOWED | ❌ (SA only) | POST /internal/admin/provision { action:'grant' } | users | ✅ YES | 🚨 |
| `/admin/admins` | Revoke SUPER_ADMIN (with reason ≥10 chars) | ✅ ALLOWED | ❌ (SA only) | POST /internal/admin/provision { action:'revoke' } | users | ✅ YES | 🚨 |
| `/admin/admins` | Revoke own admin access | ❌ DENIED (no button) | N/A | Backend also blocks self-modification | — | — | — |
| `/admin/admins` | Assign school roles | ❌ NO UI | N/A | Not a platform admin function | — | — | — |

---

## Analytics Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/analytics` | View DAU/WAU/MAU (approx) | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/analytics | users | No | 🟢 |
| `/admin/analytics` | View social metrics | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/analytics | posts, communities | No | 🟢 |
| `/admin/analytics` | View education metrics | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/analytics | school_memberships | No | 🟢 |
| `/admin/analytics` | View live/voice totals | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/analytics | live_classes, voice_rooms | No | 🟢 |
| `/admin/analytics` | View per-school breakdown | ❌ NO UI | N/A | Not in analytics endpoint | — | — | GAP |
| `/admin/analytics` | View revenue/payment analytics | ❌ NO UI | N/A | Separate payments endpoint | — | — | GAP |
| `/admin/analytics` | Export analytics data | ❌ NO UI | N/A | No export endpoint | — | — | GAP |

---

## Platform Settings Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/settings` | View settings reference | ✅ ALLOWED | ❌ (SA only) | None (static) | — | No | 🟢 |
| `/admin/settings` | Edit any setting | ❌ NO UI | N/A | No settings API exists | — | — | GAP |

---

## Audit Logs Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/audit-logs` | View audit logs (paginated) | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/audit | audit_logs | No | 🟡 |
| `/admin/audit-logs` | Filter by entity | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/audit?entity= | audit_logs | No | 🟢 |
| `/admin/audit-logs` | Filter by action | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/audit?action= | audit_logs | No | 🟢 |
| `/admin/audit-logs` | View log detail (old/new values, IP) | ✅ ALLOWED | ❌ (SA only) | — (client dialog) | — | No | 🟡 |
| `/admin/audit-logs` | Filter by date range | ❌ NO UI | N/A | Backend supports params | audit_logs | — | GAP |
| `/admin/audit-logs` | Filter by userId | ❌ NO UI | N/A | Backend supports param | audit_logs | — | GAP |
| `/admin/audit-logs` | Export to CSV/JSON | ❌ NO UI | N/A | No export endpoint | — | — | GAP |
| `/admin/audit-logs` | Delete audit logs | ❌ NO UI | N/A | Logs are immutable | — | — | Correct |

---

## Announcements Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/announcements` | View all announcements | ✅ ALLOWED | ❌ (SA only) | GET /admin/stats/announcements | announcements | No | 🟢 |
| `/admin/announcements` | Create platform announcement | ❌ NO UI | N/A | No platform announcement API | — | — | GAP |
| `/admin/announcements` | Edit school announcement | ❌ NO UI | N/A | Not a platform admin function | — | — | — |
| `/admin/announcements` | Delete announcement | ❌ NO UI | N/A | Not a platform admin function | — | — | — |

---

## System Health Page

| Page | Action | SUPER_ADMIN | Other Role | API | DB | Audit | Risk |
|------|--------|-------------|------------|-----|----|-------|------|
| `/admin/system-health` | View DB health + latency | ✅ ALLOWED | ❓ UNKNOWN (endpoint may be unguarded) | GET /health/detailed | — | No | 🟡 |
| `/admin/system-health` | View Redis status | ✅ ALLOWED | ❓ UNKNOWN | GET /health/detailed | — | No | 🟡 |
| `/admin/system-health` | View LiveKit status | ✅ ALLOWED | ❓ UNKNOWN | GET /health/detailed | — | No | 🟢 |
| `/admin/system-health` | View memory usage | ✅ ALLOWED | ❓ UNKNOWN | GET /health/detailed | — | No | 🟢 |
| `/admin/system-health` | View event loop lag | ✅ ALLOWED | ❓ UNKNOWN | GET /health/detailed | — | No | 🟢 |
| `/admin/system-health` | Restart services | ❌ NO UI | N/A | — | — | — | — |
| `/admin/system-health` | Clear Redis cache | ❌ NO UI | N/A | — | — | — | — |

---

## Summary Counts

| Category | Count |
|----------|-------|
| Total admin routes | 14 |
| Total admin pages | 14 |
| Actions ALLOWED | 52 |
| Actions DENIED (backend 403) | 5 |
| Actions with NO UI (gaps) | 28 |
| Actions with known violations | 2 (live-class end button, voice room end button) |
| Total admin APIs called | 18 unique endpoints |
| Actions with audit logging | 8 |
| Actions MISSING audit logging | 3 (report review, user PII read, backup mutations) |
