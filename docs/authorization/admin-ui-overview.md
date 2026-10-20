# Admin UI — Complete Overview

**Audit date:** 2026-08-26  
**Scope:** Web frontend only. No mobile admin UI found (see Step 21 findings).  
**Rule:** READ-ONLY audit. No application code was modified.

---

## Admin UI Architecture

### Entry Point

The admin UI lives at `/admin` and is a segment within the main Next.js `(dashboard)` route group.

```
(dashboard)/
  admin/
    layout.tsx          ← Route guard + sidebar shell
    page.tsx            ← Overview dashboard (/admin)
    users/page.tsx      ← User management
    schools/page.tsx    ← School management
    moderation/page.tsx ← Report moderation
    live-voice/page.tsx ← Live & Voice operational view
    payments/page.tsx   ← Payments & Wallets
    gifts/page.tsx      ← Gifts & Coins
    security/page.tsx   ← Security events
    admins/page.tsx     ← Staff & Perms (SUPER_ADMIN provisioning)
    analytics/page.tsx  ← Platform analytics
    settings/page.tsx   ← Platform Settings
    audit-logs/page.tsx ← Audit Logs
    announcements/page.tsx ← Announcements viewer
    system-health/page.tsx ← System Health
```

### Route Guard — `admin/layout.tsx`

**Guard type:** Client-side only  
**Guard logic:** `user?.role !== 'SUPER_ADMIN'`  
**Unauthorized render:** Inline "Platform Admin Only" message with a link back to `/dashboard`

```typescript
if (!user || user.role !== 'SUPER_ADMIN') {
  return <div>Platform Admin Only — <Link href="/dashboard">Back to Dashboard</Link></div>
}
```

**FIX applied (HALQA-UI-03):** On mount, the layout calls `clearActiveSchool()` to remove any stale school context from localStorage. This prevents a SCHOOL_ADMIN's previous `activeSchoolId` from persisting when the same browser switches to a SUPER_ADMIN session.

**Gap:** The route guard is client-side only. If Next.js pre-renders a page before the auth store hydrates, a split-second flash of the protected page is possible. All actual data is protected server-side by the backend's `authorize('SUPER_ADMIN')` middleware. The UI guard is defense-in-depth only.

---

## The Sidebar — 14 Sections

Defined in `layout.tsx` as the `NAV` array:

| # | Label | Route | Icon |
|---|-------|-------|------|
| 1 | Overview | `/admin` | LayoutDashboard |
| 2 | Users | `/admin/users` | Users |
| 3 | Schools | `/admin/schools` | School |
| 4 | Moderation | `/admin/moderation` | Shield |
| 5 | Live & Voice | `/admin/live-voice` | Radio |
| 6 | Payments | `/admin/payments` | CreditCard |
| 7 | Gifts & Coins | `/admin/gifts` | Gift |
| 8 | Security | `/admin/security` | Lock |
| 9 | Staff & Perms | `/admin/admins` | UserCog |
| 10 | Analytics | `/admin/analytics` | BarChart3 |
| 11 | Platform Settings | `/admin/settings` | Settings |
| 12 | Audit Logs | `/admin/audit-logs` | FileText |
| 13 | Announcements | `/admin/announcements` | AlertTriangle |
| 14 | System Health | `/admin/system-health` | Activity |

Active item is highlighted with `bg-red-700` class. The sidebar is hidden on mobile (`hidden lg:flex`); mobile shows a breadcrumb bar instead.

---

## Route Inventory

| Route | File | Access | Status |
|-------|------|--------|--------|
| `/admin` | `admin/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/users` | `admin/users/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/schools` | `admin/schools/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/moderation` | `admin/moderation/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/live-voice` | `admin/live-voice/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/payments` | `admin/payments/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/gifts` | `admin/gifts/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/security` | `admin/security/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/admins` | `admin/admins/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/analytics` | `admin/analytics/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/settings` | `admin/settings/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/audit-logs` | `admin/audit-logs/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/announcements` | `admin/announcements/page.tsx` | SUPER_ADMIN | ✅ Implemented |
| `/admin/system-health` | `admin/system-health/page.tsx` | SUPER_ADMIN | ✅ Implemented |

**Total admin routes: 14**  
**Total admin pages: 14**  
No sub-pages (no `/admin/users/:id`, no `/admin/schools/:id`, etc.)

---

## Common Patterns Across All Pages

Every admin page shares these patterns:

**Auth guard (each page independently):**
```typescript
const isAdmin = user?.role === 'SUPER_ADMIN'
if (!isAdmin) return <div>Access restricted to platform administrators.</div>
```

**Data fetching:**
- React Query (`useQuery`) for all reads
- React Query (`useMutation`) for all writes
- `enabled: isAdmin` prevents queries from firing before auth is confirmed

**Auto-refresh intervals:**
- Overview: 60s
- Live & Voice: 30s
- Security: 30s
- Moderation: 30s
- Audit Logs: on-demand
- Analytics: 120s
- System Health: 30s

**Error states:** All pages show inline error messages with retry buttons.  
**Loading states:** All pages show skeleton/pulse animations during load.  
**Empty states:** All table pages show icon + message when no results.

---

## Stores Used

| Store | File | Admin Usage |
|-------|------|-------------|
| `useAuthStore` | `store/auth.store.ts` | Used on every page to check `user.role === 'SUPER_ADMIN'` |
| `useSchoolStore` | `store/school.store.ts` | Used in `layout.tsx` to clear school context via `clearActiveSchool()` |

No dedicated admin store exists. All admin state is local React state per page.

---

## API Client

All pages use `api` from `@/lib/api` — a configured Axios instance with base URL pointed at the backend.

No admin-specific API client or separate Axios instance exists for admin routes.

---

## Mobile Admin UI

**Finding:** No dedicated mobile admin UI exists in the React Native (`mobile/`) codebase.

`mobile/app/settings.tsx` has `isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user?.role)` for a "school settings" tab, but this is school-scoped, not platform admin.

The web admin UI at `/admin` is responsive (sidebar hidden on mobile, breadcrumb shown instead) but is not optimized for mobile use.

**Conclusion:** Platform administration is web-only.
