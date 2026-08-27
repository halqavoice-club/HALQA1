# Admin UI — Per-Page Documentation

Full inventory of every admin page. Read-only audit — no code was modified.

---

## Page 1 — Overview (`/admin`)

**File:** `frontend/src/app/(dashboard)/admin/page.tsx`  
**Purpose:** Platform administration dashboard. Summary statistics and quick navigation to all admin sections.

### Permission Check
```typescript
const isAdmin = user?.role === 'SUPER_ADMIN'
if (!isAdmin) return <div>Access restricted to platform administrators.</div>
```

### API Calls
| Method | Endpoint | Purpose | Interval |
|--------|----------|---------|----------|
| GET | `/api/v1/admin/stats` | Platform summary stats | 60s auto-refresh |

### Statistics Displayed

**Users section:**
- Total Users (`users.total`)
- Active Users (`users.active`)
- Suspended/Banned (`users.suspended`)
- New in 30 days (`users.newLast30d`) + sub-label for 7 days (`users.newLast7d`)

**Schools section:**
- Total Schools (`schools.total`) — links to `/admin/schools`
- Active Schools (`schools.active`)
- Total Members (`schools.totalMembers`)
- Total Classes (`schools.totalClasses`)

**Platform Activity section:**
- Live Now (`liveClasses.active`) + sub-label total streams
- Pending Reports (`moderation.pendingReports`) — links to `/admin/moderation`; shows red alert badge if > 0
- Audit Logs (7d) (`audit.last7d`) — links to `/admin/audit-logs`
- Total Audit Logs (`audit.total`)

### Behavior
- Pending reports badge in header links to `/admin/moderation`
- Manual refresh button (spinner when refetching)
- On API error: shows error details with checklist (backend running, memory, prisma generate)
- On error: still shows 6 section quick-access cards for navigation
- `generatedAt` timestamp from API shown in subtitle

### Quick Access Cards
6 cards shown: User Management, School Management, Content Moderation, Audit Logs, Announcements, Admin Provisioning

### Dangerous Actions: None on this page

---

## Page 2 — User Management (`/admin/users`)

**File:** `frontend/src/app/(dashboard)/admin/users/page.tsx`  
**Purpose:** Search, filter, view, and change the status of any platform user.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/users` | Paginated user list (search, filter by status/role) |
| PATCH | `/api/v1/admin/stats/users/:id/status` | Change user account status |

### Filters Available
- Free-text search (matches firstName, lastName, email)
- Status filter: All / ACTIVE / SUSPENDED / BANNED / INACTIVE / PENDING
- Role filter: All / SUPER_ADMIN / SCHOOL_ADMIN / TEACHER / STUDENT / GUARDIAN / MEMBER
- Pagination: 20 per page

### Columns Displayed
- User (avatar + name + email)
- Role (badge with color coding)
- Status (badge with color coding)
- Joined date
- Last Login date
- "Manage" button (hidden for SUPER_ADMIN rows)

### "Manage" Action — Status Change Dialog
Opens a modal for the selected user showing:
- User avatar + name + email
- Status picker: ACTIVE / INACTIVE / SUSPENDED / BANNED
- Reason text area (optional, max 500 chars — "for audit trail")
- Submit: `PATCH /admin/stats/users/:id/status { status, reason }`

**Protection in UI:**
- `Manage` button does NOT appear on rows where `u.role === 'SUPER_ADMIN'`
- Submit disabled when `newStatus === selected.status` (no-op change blocked)

**On success:** invalidates `admin-users` and `admin-stats` queries, closes dialog

### Dangerous Actions
| Action | Risk | Audit |
|--------|------|-------|
| Change status to SUSPENDED | HIGH — locks user out | ✅ YES (backend writes audit log) |
| Change status to BANNED | HIGH — permanent lock | ✅ YES (backend writes audit log) |

### Platform Administration vs Content Participation
This page MANAGES users (account status, role display). It does NOT provide:
- Login as user
- View user's private content
- Access user's sessions or tokens

---

## Page 3 — School Management (`/admin/schools`)

**File:** `frontend/src/app/(dashboard)/admin/schools/page.tsx`  
**Purpose:** List all schools on the platform and activate/deactivate them.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/schools` | Paginated school list |
| PATCH | `/api/v1/admin/stats/schools/:id/status` | Activate or deactivate school |

### Filters
- Free-text search (matches name, slug, city, country)
- Status filter: All / Active / Inactive
- Pagination: 20 per page

### Columns Displayed
- School (logo + name + slug)
- Type
- Location (city, country)
- Members count (from `_count.memberships`)
- Classes count (from `_count.classes`)
- Status (Active / Inactive badge)
- Activate/Deactivate button

### Action — Toggle School Status
Confirm dialog: "Are you sure you want to deactivate/activate [School Name]?"
Deactivation shows warning: "Deactivating will prevent school members from using school features."
Calls: `PATCH /admin/stats/schools/:id/status { isActive: boolean }`

**On success:** invalidates `admin-schools` and `admin-stats` queries

### What this page CANNOT do (correct by design)
- View school members
- View school classes, grades, attendance
- Create a new school
- Delete a school
- Edit school name, address, settings

---

## Page 4 — Moderation (`/admin/moderation`)

**File:** `frontend/src/app/(dashboard)/admin/moderation/page.tsx`  
**Purpose:** Review user reports and take enforcement actions.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/report-block/reports?status=PENDING&limit=50` | Load reports by status | 30s auto-refresh |
| PATCH | `/report-block/reports/:id/review` | Submit review decision |

**Note:** Uses `/report-block/reports` path, NOT `/social/reports`. This is a discrepancy — the social.routes.js mounts the reports at `/api/v1/social/reports` but this page calls `/api/v1/report-block/reports`. One of these is the wrong path. See admin-ui-gaps.md.

### Status Filter
PENDING / REVIEWED / ACTION_TAKEN / DISMISSED

### Report List Columns
- Reporter → Reported (names)
- Reason (mapped to human label)
- Description preview (50 chars)
- Created date
- Status badge

### Review Panel (appears when a report is selected)
Shows: Reporter, Reported, Reason, Status, Description

**Step 1 — Review outcome (3 choices):**
- REVIEWED (blue) — marks reviewed, no action
- DISMISSED (gray) — dismisses report
- ACTION_TAKEN (red) — triggers Step 2

**Step 2 — Enforcement action (only when ACTION_TAKEN selected):**
- WARN — status stays ACTIVE, audit log only
- SUSPEND — sets user status → SUSPENDED
- BAN — sets user status → BANNED

Warning shown: "This action is server-enforced and creates an audit log. It takes effect immediately and cannot be undone from this screen."

**Internal note:** Optional text area (max 500 chars)

**Submit:** `PATCH /report-block/reports/:id/review { status, action?, adminNote }`

- For ACTION_TAKEN: both `status` and `action` are required in UI before submit enabled
- Submit button label changes dynamically: "Apply: SUSPEND" / "Mark as reviewed" etc.
- BANNED submit uses `variant="destructive"` (red button)

**On success:** invalidates `moderation-reports` and `admin-stats` queries

### Dangerous Actions
| Action | Risk | Audit |
|--------|------|-------|
| WARN user | LOW | ✅ YES (backend) |
| SUSPEND user | HIGH | ✅ YES (backend) |
| BAN user | CRITICAL | ✅ YES (backend) |

### Platform vs Participation
This page reviews reports. The admin does NOT:
- Enter the room where the incident occurred
- View private messages
- Appear in any participant list

---

## Page 5 — Live & Voice (`/admin/live-voice`)

**File:** `frontend/src/app/(dashboard)/admin/live-voice/page.tsx`  
**Purpose:** Operational view of active live classes and voice rooms. Emergency termination buttons.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/live-voice` | Active sessions and rooms | 30s auto-refresh |
| POST | `/api/v1/live-classes/:id/end` | Emergency end a live class |
| PATCH | `/api/v1/voice/:id/end` | Emergency end a voice room |

### Statistics Displayed
- Active Live Classes
- Live Participants
- Active Voice Rooms  
- Voice Listeners

### Live Classes Table
| Column | Source |
|--------|--------|
| Session title | `sessions[].title` |
| ID (first 8 chars) | `sessions[].id` |
| Participants | `sessions[]._count.participants` |
| Started | `sessions[].createdAt` |
| End button | Emergency termination |

### Voice Rooms Table
| Column | Source |
|--------|--------|
| Room title | `rooms[].title` |
| ID (first 8 chars) | `rooms[].id` |
| Host name | `rooms[].host.firstName + lastName` |
| Listeners | `rooms[]._count.participants` |
| Privacy | `rooms[].privacy` badge |
| End button | Emergency termination |

### "End" Button — Critical Finding

#### Live Class "End" button:
```typescript
onClick={() => { if(confirm('End this live class?')) endLiveMutation.mutate(s.id) }}
mutationFn: (id: string) => api.post(`/live-classes/${id}/end`)
```
This calls `POST /api/v1/live-classes/:id/end` — the **same endpoint that a teacher/host uses to end their own class**.

**This is a VIOLATION.** The backend's `resolveStreamStaffAccess` middleware requires either:
- PUBLIC stream: `hostUserId === req.user.id`
- SCHOOL stream: `eduStaff` school membership

A SUPER_ADMIN calling this endpoint will fail the authorization check unless they are the actual host or school staff member. **The button exists in the UI but the backend will return 403** unless the admin is already the host (which would be a separate violation via LCSV-001).

See admin-ui-gaps.md: `UIGAP-007`.

#### Voice Room "End" button:
```typescript
mutationFn: (id: string) => api.patch(`/voice/${id}/end`)
```
This calls `PATCH /api/v1/voice/:id/end`. The voice `endRoom` controller checks:
```javascript
// inside controller: verifies caller is the room HOST
```
**Same issue:** SUPER_ADMIN will receive 403 from the backend unless they are the room HOST.

### What this page MANAGES vs PARTICIPATES

| Action | Type | Backend allows? |
|--------|------|----------------|
| View session list with participant counts | MANAGEMENT | ✅ YES |
| View room host names | MANAGEMENT | ✅ YES |
| Search sessions by title | MANAGEMENT | ✅ (client-side filter only) |
| End a live class | ⚠️ MANAGEMENT INTENT | ❌ Backend returns 403 unless admin is host |
| End a voice room | ⚠️ MANAGEMENT INTENT | ❌ Backend returns 403 unless admin is host |
| View chat messages | NOT IN UI | N/A |
| View participant details | NOT IN UI | N/A |
| Join a room | NOT IN UI | N/A (no join button) |

**The "End" buttons are dead buttons for a SUPER_ADMIN who is not also the room host.**

---

## Page 6 — Payments (`/admin/payments`)

**File:** `frontend/src/app/(dashboard)/admin/payments/page.tsx`  
**Purpose:** View wallet statistics and recent transaction history.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/payments` | Wallet stats + last 50 transactions | 60s auto-refresh |

### Statistics Displayed
- Total Wallets
- Total Transactions
- Transactions (Last 30 days)

### Transactions Table
- User name + email
- Transaction type (badge)
- Amount (signed integer with currency)
- Description
- Date

Client-side search filters the returned 50 transactions by user name/email.
Client-side pagination (20 per page) of the 50-record window.

### Dangerous Actions: NONE
This page is read-only. No mutations. No refund button. No payout button.

### Gaps
- No payout management UI exists at all (confirmed CRITICAL gap from prior audit)
- No way to view a specific user's full transaction history
- Transaction list is capped at 50 most recent (no pagination beyond backend's 50-record window)
- `TX_TYPE_STYLE` includes keys `PURCHASE`, `SPEND`, `EARN`, `REFUND`, `WITHDRAWAL` but the actual `WalletTransaction.type` field uses `STRIPE_PURCHASE`, `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `ADMIN_GRANT`, `REFUND`. The styling map won't match most actual transaction types.

---

## Page 7 — Gifts & Coins (`/admin/gifts`)

**File:** `frontend/src/app/(dashboard)/admin/gifts/page.tsx`  
**Purpose:** View gift economy statistics, gift catalog, and recent gift transactions.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/gifts` | Gift stats + catalog + recent transactions | 60s auto-refresh |

### Statistics Displayed
- Total Gifts Sent (all-time)
- Gifts Sent (Last 7 days)
- Gifts Sent (Last 30 days)
- Gift Catalog Size

### Gift Catalog Grid
Displays all catalog items: emoji/image, name, `coinCost` (note: the model field is `priceCoins` — `coinCost` may be a field name discrepancy)

### Recent Gift Transactions
Scrollable list (max height 320px): sender → receiver, gift emoji/name, count, date

### Dangerous Actions: NONE
Read-only page.

### Gaps
- No ability to add, edit, or deactivate gift catalog items
- No admin coin grant UI
- `g.coinCost` reference may be a field name discrepancy vs `gifts.priceCoins` in schema

---

## Page 8 — Security (`/admin/security`)

**File:** `frontend/src/app/(dashboard)/admin/security/page.tsx`  
**Purpose:** View security event summary (suspensions, bans, role changes) and recent audit events.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/security` | Security stats + recent events | 30s auto-refresh |

### Statistics Displayed
- Suspensions (last 7 days)
- Bans (last 7 days)
- Role Changes (last 7 days)
- Total Currently Suspended
- Total Currently Banned

### Events Table
- Timestamp
- Actor (admin who performed the action) + email
- Action type badge (UPDATE/DELETE/CREATE)
- Entity type (with icon) — `user_status`, `user_platform_role`, `user_moderation`, `school_status`
- Info button → opens Detail dialog

### Event Detail Dialog
Shows: Date, Actor, Action, Entity, Entity ID, IP, Change (newValues JSON)

### Note displayed in page:
"Security events are sourced from the audit log. Only administrative actions (status changes, role changes, moderation) are shown. Passwords, tokens, and private messages are never exposed."

### Dangerous Actions: NONE
Read-only page.

### Gaps
- No session management (cannot view or revoke user sessions)
- No login event history (auth events not written to audit_logs)
- No suspicious activity detection
- No 2FA administration
- No IP allowlist management UI

---

## Page 9 — Staff & Perms (`/admin/admins`)

**File:** `frontend/src/app/(dashboard)/admin/admins/page.tsx`  
**Purpose:** Grant and revoke SUPER_ADMIN platform access. View all current admins.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/internal/admin/list` | List all current SUPER_ADMIN users |
| GET | `/api/v1/admin/stats/users` | User lookup by email (for grant flow) |
| POST | `/api/v1/internal/admin/provision { action: 'grant' }` | Grant SUPER_ADMIN |
| POST | `/api/v1/internal/admin/provision { action: 'revoke' }` | Revoke SUPER_ADMIN |

### Admin List
Shows all SUPER_ADMIN users: avatar, name, email, "Admin since" date, last login date
- "You" badge on current user's row
- "Revoke" button on all rows except current user's own row

### Grant Flow
1. Enter target email → click "Find"
2. System calls `GET /admin/stats/users?search={email}` and matches by email
3. Confirms the found user: avatar, name, email, current role
4. Admin enters reason (min 10 chars, max 500)
5. Submit: `POST /internal/admin/provision { targetUserId, action: 'grant', reason }`

**Validations:**
- User must be found (lookup required)
- Reason minimum 10 chars
- Submit disabled until both conditions met

### Revoke Flow
1. Click "Revoke" on target admin row
2. Shows confirmation dialog: "Revoking access from [Name] ([email]). They will become a regular MEMBER."
3. Admin enters reason (min 10 chars)
4. Submit: `POST /internal/admin/provision { targetUserId, action: 'revoke', reason }`

**Warning shown:** "SUPER_ADMIN has full platform access — manage users, schools, and all data. Only grant to trusted operators. All changes are permanently audited."

### Protections in UI
- Cannot revoke own admin access (own row has no "Revoke" button)
- Backend also prevents: self-modification, revoking the last admin

### Dangerous Actions
| Action | Risk | Audit |
|--------|------|-------|
| Grant SUPER_ADMIN | CRITICAL | ✅ YES (backend) |
| Revoke SUPER_ADMIN | CRITICAL | ✅ YES (backend) |

---

## Page 10 — Analytics (`/admin/analytics`)

**File:** `frontend/src/app/(dashboard)/admin/analytics/page.tsx`  
**Purpose:** Platform-wide aggregated analytics metrics.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/analytics` | Aggregated platform analytics | 120s auto-refresh |

### Metrics Displayed (4 sections)

**User Activity:**
- DAU (approx) — `users.dau` (from `lastLoginAt >= today`)
- WAU (approx) — `users.wau` (from `lastLoginAt >= 7 days ago`)
- MAU (approx) — `users.mau` (from `lastLoginAt >= 30 days ago`)
- New Today, New This Week, New This Month
- Note: "DAU/WAU/MAU are approximated from lastLoginAt — users without recent logins are not counted."

**Social Activity:**
- Total Posts, Posts This Week, Communities

**Education:**
- Total Schools, Active Schools, Students, Teachers (from active memberships)

**Live & Voice:**
- Total Live Classes (all-time), Total Voice Rooms (all-time)

### Dangerous Actions: NONE
Read-only page.

### Gap
No time-series charts, no breakdown by school, no gift/revenue analytics.

---

## Page 11 — Platform Settings (`/admin/settings`)

**File:** `frontend/src/app/(dashboard)/admin/settings/page.tsx`  
**Purpose:** Document the platform configuration surface. Read-only display.

### API Calls: NONE
This page makes no API calls. It is a static reference page documenting the environment variables and their purposes.

### Sections Documented
- Authentication (JWT secrets, token expiry)
- Storage (STORAGE_TYPE, R2 config)
- Realtime & Media (LiveKit, Redis)
- Payments (Stripe keys, webhook secret)
- Email (SMTP config)
- Security (ADMIN_IP_ALLOWLIST, CORS, DM permissions)
- Feature Flags (code-controlled)

### Status Indicators
- `CheckCircle` (green) = "configured" — all env vars shown as configured
- `AlertTriangle` (yellow) = "not-configured"
- `Code` (blue) = "code-controlled"

### Warning Shown
"Most platform settings are controlled by environment variables. Changing them requires restarting the backend. Secrets are never displayed in this UI."

**Note on ADMIN_IP_ALLOWLIST:** Page shows description "Empty = all IPs allowed" — this documents the known gap (GAP-001 from previous audit).

### Dangerous Actions: NONE
No mutations. No edits. Display only.

---

## Page 12 — Audit Logs (`/admin/audit-logs`)

**File:** `frontend/src/app/(dashboard)/admin/audit-logs/page.tsx`  
**Purpose:** Browse the platform-wide audit log with filtering.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/audit` | Paginated audit logs | On-demand |

### Filters
- Entity search (free text — filters by entity field: e.g., "user_status", "school")
- Action filter: All / CREATE / UPDATE / DELETE / VIEW
- Pagination: 50 per page

### Columns
- Timestamp
- Actor (admin/user who performed action) + email
- Action badge (CREATE/UPDATE/DELETE/VIEW)
- Entity type + Entity ID (first 12 chars)
- IP address (hidden on small screens)
- Info button → opens Detail dialog

### Detail Dialog
Shows all audit log fields: ID, Date, Actor, Action, Entity, Entity ID, School ID, IP, Old Values (JSON), New Values (JSON)

`schoolId = null` shown as "— (platform-level)"

### Dangerous Actions: NONE
Read-only page.

### Gap: No Export
No CSV/JSON export functionality. No date range filter in UI (backend supports `startDate`/`endDate` params but they are not exposed in the UI).

---

## Page 13 — Announcements (`/admin/announcements`)

**File:** `frontend/src/app/(dashboard)/admin/announcements/page.tsx`  
**Purpose:** View all school announcements across the platform (read-only).

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/admin/stats/announcements` | Paginated announcements | On-demand |

### List Display
Each announcement shows:
- Title (with pin icon if `isPinned`)
- School name (from `school.name`)
- Created date
- Expiry date (if set)
- Target roles (badges: teacher, student, guardian, etc.)
- Content preview (2-line clamp)

### Dangerous Actions: NONE

### Gap: Read-Only Only
No ability to create, edit, delete, or broadcast platform-wide announcements. Only displays school-owned announcements.

---

## Page 14 — System Health (`/admin/system-health`)

**File:** `frontend/src/app/(dashboard)/admin/system-health/page.tsx`  
**Purpose:** Real-time infrastructure health monitoring.

### API Calls
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/health/detailed` | Detailed health checks | 30s auto-refresh |

**Note:** This endpoint is `/health/detailed` — NOT under `/admin/`. It may be accessible without SUPER_ADMIN auth. The page guard is client-side only.

### Health Checks Displayed
| Check | Metrics Shown |
|-------|---------------|
| Database (MySQL) | Status, latency (ms) |
| Cache (Redis) | Status, latency (ms), message |
| LiveKit | Status, message |
| Memory | Heap Used/Total (MB), heap usage %, visual bar |
| Event Loop | Status, lag (ms) |
| Circuit Breakers | Status, open breakers list |

### Status Values
`ok` (green) / `warning` (yellow) / `critical` (red) / `error` (red) / `disconnected` (orange) / `not_configured` (gray) / `degraded` (yellow) / `unknown` (gray)

### Summary Section
- Uptime (hours + minutes)
- Startup Duration (seconds)
- Startup Complete (boolean)

### Error State
If health endpoint is unreachable: "Failed to fetch health status. The health endpoint may be unreachable."

### Dangerous Actions: NONE
Read-only monitoring page.

### Gap
`/health/detailed` may not be protected by SUPER_ADMIN authorization. If it returns sensitive system info (memory, circuit breaker state), it should be gated. This needs verification — see admin-ui-gaps.md `UIGAP-014`.
