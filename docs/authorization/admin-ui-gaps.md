# Admin UI Gaps — Complete Findings

**Audit date:** 2026-08-26  
**Rule:** Documentation only. No code was modified.

---

## Gap Inventory

### UIGAP-001 — Client-Side-Only Route Guard

**Severity:** MEDIUM  
**Page:** All `/admin/*` pages  
**File:** `frontend/src/app/(dashboard)/admin/layout.tsx`

**Current behavior:**
```typescript
if (!user || user.role !== 'SUPER_ADMIN') {
  return <div>Platform Admin Only</div>
}
```

The admin layout guard is client-side only. All data fetching uses `enabled: isAdmin` which prevents queries from firing before auth is known. However, between Next.js server render and client hydration, there is a brief window where the page shell may be visible.

**Backend protection:** The actual data is protected by `authorize('SUPER_ADMIN')` on all admin API endpoints. The backend will return 403 even if the UI guard is bypassed.

**Risk:** LOW — data is safe; only the page shell/skeleton could momentarily flash.

---

### UIGAP-002 — No SUPER_ADMIN Session Management

**Severity:** HIGH  
**Page:** `/admin/security` (expected), not present  
**Files:** No admin session page exists

**Current behavior:** No UI exists to:
- List a user's active sessions
- Revoke specific sessions
- Force-logout a user (only suspension achieves this indirectly)

**Backend gap:** No admin session management API (`GET/DELETE /admin/users/:id/sessions`, etc.)

**Impact:** Platform admin cannot immediately revoke a compromised user's sessions. Must suspend the account, which is a coarser instrument.

---

### UIGAP-003 — No User Profile Deep-Dive Page

**Severity:** MEDIUM  
**Page:** `/admin/users` — no drill-down  
**File:** `frontend/src/app/(dashboard)/admin/users/page.tsx`

**Current behavior:** The user list shows name, email, role, status, join date, last login. There is no `/admin/users/:id` page for a full user profile view.

Full PII is available via `GET /users/:id` for SUPER_ADMIN, but there is no admin UI page that presents it.

**Impact:** Admins must navigate to the regular user profile page (`/social/profile/[id]`) to see more info, which is not an admin context.

---

### UIGAP-004 — No Payout Management UI (CRITICAL)

**Severity:** CRITICAL  
**Page:** `/admin/payments` — no payout section  
**Files:** `admin/payments/page.tsx`

**Current behavior:** The Payments page shows wallet stats and recent wallet transactions only. No payout management exists.

**What is missing:**
- No payout request list
- No approve/reject controls
- No payout status tracking
- No payout history

**Backend gap:** No payout management API exists (`GET/PATCH /admin/payouts`).

**Impact:** Payout requests from hosts accumulate in `payout_requests` table with no admin UI or API to process them. Processing requires direct database access.

The `payout_requests.accountDetails` field contains sensitive financial information (bank account numbers, PayPal addresses) that is currently inaccessible through any admin interface — which is correct from a security perspective until a proper secure admin payout UI is built.

---

### UIGAP-005 — No Admin Coin Grant UI

**Severity:** HIGH  
**Page:** `/admin/payments`, `/admin/gifts` — not present  
**Files:** Both payments and gifts pages

**Current behavior:** No UI to grant coins to a user. The `WalletTransaction.type` enum supports `ADMIN_GRANT` in the schema, but no API endpoint and no admin UI implement it.

**Impact:** Cannot credit compensation, refunds, or promotional coins without direct database access.

---

### UIGAP-006 — Transaction Type Styling Mismatch

**Severity:** LOW  
**Page:** `/admin/payments`  
**File:** `admin/payments/page.tsx` line ~20

**Current behavior:**
```typescript
const TX_TYPE_STYLE: Record<string, string> = {
  PURCHASE:   '...',
  SPEND:      '...',
  EARN:       '...',
  REFUND:     '...',
  WITHDRAWAL: '...',
}
```

The actual `WalletTransaction.type` values in the schema are:
`STRIPE_PURCHASE`, `GIFT_SEND`, `TIP_SEND`, `SUBSCRIPTION`, `ADMIN_GRANT`, `REFUND`

None of the style keys match the actual DB values (`PURCHASE` vs `STRIPE_PURCHASE`, etc.). All transactions will render with the fallback `bg-gray-100 text-gray-600` styling.

---

### UIGAP-007 — Dead "End" Buttons in Live & Voice (CRITICAL UI FINDING)

**Severity:** HIGH  
**Page:** `/admin/live-voice`  
**File:** `admin/live-voice/page.tsx`

**Current behavior:**
```typescript
// End live class:
mutationFn: (id: string) => api.post(`/live-classes/${id}/end`)
// End voice room:
mutationFn: (id: string) => api.patch(`/voice/${id}/end`)
```

These buttons will receive HTTP 403 from the backend for a SUPER_ADMIN who is not the host/staff member of that session.

- `POST /live-classes/:id/end` → `resolveStreamStaffAccess` requires `eduStaff` for school streams or `hostUserId === req.user.id` for public streams
- `PATCH /voice/:id/end` → controller verifies caller is the room HOST

**What should happen:** A dedicated platform admin termination endpoint is needed (`POST /admin/live-classes/:id/terminate`, `POST /admin/voice/:id/terminate`) that bypasses content-participation authorization while maintaining proper audit logging.

**What happens today:** The admin clicks "End", `confirm()` dialog appears, API call is made → backend returns 403 → toast shows "Failed" with the error message.

**This is a backend gap, not a UI violation.** The UI correctly presents this as a management action (terminate button, not "join"). The backend simply lacks the admin-specific endpoint.

---

### UIGAP-008 — Report API Path Discrepancy

**Severity:** MEDIUM  
**Page:** `/admin/moderation`  
**File:** `admin/moderation/page.tsx`

**Current behavior:**
```typescript
queryFn: () => api.get(`/report-block/reports?status=${statusFilter}&limit=50`)
reviewMutation: api.patch(`/report-block/reports/${id}/review`, ...)
```

The `social.routes.js` file mounts report endpoints at:
```javascript
router.get('/reports', authorize('SUPER_ADMIN'), listReports)
router.patch('/reports/:id/review', authorize('SUPER_ADMIN'), reviewReport)
```
This is mounted at `/api/v1/social/reports` by `app.js`.

The moderation page calls `/api/v1/report-block/reports` — which may be a different or older route. This needs verification against the actual route mounting in `app.js`.

**Impact:** Reports may not load if the path is wrong. Moderation queue would appear empty for all statuses.

---

### UIGAP-009 — No Audit Date Range Filter in UI

**Severity:** LOW  
**Page:** `/admin/audit-logs`  
**File:** `admin/audit-logs/page.tsx`

**Current behavior:** The audit logs page filters by entity (text) and action type only. The backend `GET /admin/stats/audit` supports `startDate` and `endDate` query parameters, but these are not exposed in the UI.

**Impact:** Cannot narrow audit logs to a specific time window. Must scroll through all records.

---

### UIGAP-010 — Gift Catalog Field Name Discrepancy

**Severity:** LOW  
**Page:** `/admin/gifts`  
**File:** `admin/gifts/page.tsx`

**Current behavior:**
```typescript
<p className="text-xs text-yellow-600">{g.coinCost}c</p>
```

The `Gift` model field is `priceCoins`, not `coinCost`. This will render as `undefinedc` for all gift items.

---

### UIGAP-011 — No Export Functionality

**Severity:** LOW  
**Pages:** `/admin/users`, `/admin/schools`, `/admin/audit-logs`, `/admin/analytics`  
**Impact:** All data must be read from the UI. No CSV/JSON export.

---

### UIGAP-012 — No Platform Announcement Creation

**Severity:** MEDIUM  
**Page:** `/admin/announcements`  
**Current behavior:** Read-only view of school announcements. No ability to create a platform-wide announcement.

**Backend gap:** No platform announcement creation endpoint.

---

### UIGAP-013 — Audit Logs Missing for Several Admin Actions

**Severity:** HIGH  
**Affected actions:**
- SUPER_ADMIN reads full user PII via `GET /users/:id` → not logged
- SUPER_ADMIN reviews a social report → not logged
- SUPER_ADMIN accesses backup metadata → not logged

These admin reads and actions do not generate `audit_log` entries. The audit trail is incomplete.

---

### UIGAP-014 — System Health Endpoint May Not Require SUPER_ADMIN

**Severity:** MEDIUM  
**Page:** `/admin/system-health`  
**File:** `admin/system-health/page.tsx`

**Current behavior:**
```typescript
queryFn: () => api.get('/health/detailed')
```

The page uses `/health/detailed`, not `/admin/stats/health`. Health check routes in Express typically do not require authentication (they're used by load balancers, uptime monitors, etc.).

If `/health/detailed` is publicly accessible without authentication, it exposes:
- Memory usage (heap size)
- Event loop lag
- Circuit breaker states
- Redis connection status
- LiveKit connection status
- DB connection latency

**This needs verification.** If the health endpoint is unprotected, it leaks infrastructure information to unauthenticated callers.

---

### UIGAP-015 — No Webhook Management

**Severity:** LOW  
**Current behavior:** No admin webhook management page.  
**Backend gap:** No webhook management API for SUPER_ADMIN.

---

### UIGAP-016 — Settings Page Is Static Display Only

**Severity:** LOW  
**Page:** `/admin/settings`  
**Current behavior:** The Platform Settings page documents environment variable names but provides no editing capability. All settings changes require SSH access to modify `.env` and restart the backend.

---

### UIGAP-017 — No PK System Admin Page

**Severity:** LOW  
**Current behavior:** The `/api/v1/admin/pk` route exists in `app.js` routing, but there is no admin UI page for it.

---

## Permission Leaks — UI Treating SUPER_ADMIN as Content Role

These are cases where the frontend incorrectly grants content-participation access based on SUPER_ADMIN role.

### UILEAK-001 — `LiveClassRoomImpl.tsx` does NOT include SUPER_ADMIN in `isStaffRole`

**File:** `frontend/src/components/live-class/LiveClassRoomImpl.tsx`

```typescript
// CORRECTLY excludes SUPER_ADMIN
const isStaffRole = ['TEACHER', 'SCHOOL_ADMIN'].includes(user?.role || '')
const isHost = isStaffRole || (!!lc && !!user && lc.hostUserId === user.id)
```

**This is CORRECT.** A SUPER_ADMIN is not treated as a live class host in the frontend unless they are the actual creator (`hostUserId === user.id`).

**However:** The backend `joinLiveClass()` controller assigns HOST role to SUPER_ADMIN users (LCSV-001 from known-gaps.md). So even though the frontend doesn't give host controls based on role, a SUPER_ADMIN who joins receives HOST role from the backend. This creates a discrepancy: backend says HOST, frontend only shows host controls if `hostUserId === user.id`.

**Net effect:** A SUPER_ADMIN joining a class gets HOST role in the DB (backend violation) but the frontend only shows host controls if they are the declared creator. The backend violation is not fully exposed in the UI — the frontend partially mitigates it.

### UILEAK-002 — `mobile/app/settings.tsx` uses SUPER_ADMIN for school UI gate

**File:** `mobile/app/settings.tsx`

```typescript
const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role)
```

This shows a "school settings" tab to SUPER_ADMIN in the mobile app. If the SUPER_ADMIN has no school membership, the backend will reject requests from that tab (403). This is a UI leak that shows inaccessible functionality.

---

## Summary Table

| ID | Description | Severity | Type |
|----|-------------|---------|------|
| UIGAP-001 | Client-side-only route guard | MEDIUM | Security gap |
| UIGAP-002 | No session management UI | HIGH | Missing feature |
| UIGAP-003 | No user profile drill-down | MEDIUM | Missing feature |
| UIGAP-004 | No payout management UI | CRITICAL | Missing feature |
| UIGAP-005 | No admin coin grant UI | HIGH | Missing feature |
| UIGAP-006 | Transaction type style mismatch | LOW | UI bug |
| UIGAP-007 | Dead "End" buttons for SA without host role | HIGH | Backend gap |
| UIGAP-008 | Report API path discrepancy | MEDIUM | Possible routing bug |
| UIGAP-009 | No audit date range filter | LOW | Missing feature |
| UIGAP-010 | Gift catalog `coinCost` field name wrong | LOW | UI bug |
| UIGAP-011 | No export functionality | LOW | Missing feature |
| UIGAP-012 | No platform announcement creation | MEDIUM | Missing feature |
| UIGAP-013 | Audit logs missing for PII reads, report reviews, backup | HIGH | Compliance gap |
| UIGAP-014 | /health/detailed may not require auth | MEDIUM | Security gap |
| UIGAP-015 | No webhook management | LOW | Missing feature |
| UIGAP-016 | Settings page is display-only | LOW | Missing feature |
| UIGAP-017 | No PK admin page | LOW | Missing feature |
| UILEAK-001 | Backend grants HOST role to SA but UI partially mitigates | HIGH | Cross-layer discrepancy |
| UILEAK-002 | Mobile shows school settings tab to SUPER_ADMIN | LOW | UI permission leak |
