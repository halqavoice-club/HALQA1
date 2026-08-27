# School Management — SUPER_ADMIN Capabilities

---

## What is Platform-Level School Administration

SUPER_ADMIN can manage schools **as platform entities** — activating, deactivating, and monitoring them. They cannot manage the internal operations of a school (classes, students, teachers, curriculum, messaging) without an explicit SchoolMembership in that school.

---

## School Listing and Search

**API:** `GET /api/v1/admin/stats/schools`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Parameters:**
- `page`, `limit` (max 100 per page)
- `search` — matches name, slug, city, country
- `isActive` — `true` | `false`

**Returns per school:**
```json
{
  "id": "uuid",
  "name": "...",
  "slug": "...",
  "type": "school",
  "city": "...",
  "country": "...",
  "isActive": true,
  "logoUrl": "...",
  "createdAt": "...",
  "_count": {
    "memberships": 145,   // active members
    "classes": 12          // non-deleted classes
  }
}
```

**Does NOT return:** individual user details, grades, attendance, messages, financial data

---

## School Activation / Deactivation

**API:** `PATCH /api/v1/admin/stats/schools/:id/status`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Body:** `{ "isActive": true | false }`

**Effect of deactivating a school:**
- `schools.isActive = false`
- No immediate user lockout — isActive is used for filtering in listing/analytics only
- Users at the school can still log in (their user account status is unchanged)
- School no longer appears in "active schools" counts

**Audit log written:**
```json
{
  "action": "UPDATE",
  "entity": "school_status",
  "entityId": "<schoolId>",
  "oldValues": {},
  "newValues": { "isActive": false }
}
```

**Note:** Deactivating a school does NOT suspend its users. To prevent users from accessing the platform, their individual `user.status` must be changed via the user management endpoint.

---

## School Analytics

**Aggregate counts available to SUPER_ADMIN:**

| Data point | API | Granularity |
|-----------|-----|-------------|
| Total schools | `GET /admin/stats/` | Count only |
| Active schools | `GET /admin/stats/` | Count only |
| Total school members | `GET /admin/stats/` | Count only |
| Total classes | `GET /admin/stats/` | Count only |
| Schools by status (active/inactive) | `GET /admin/stats/schools` | Per-school `isActive` |
| Member/class counts per school | `GET /admin/stats/schools` | Per-school aggregate |
| Total students | `GET /admin/stats/analytics` | Count only |
| Total teachers | `GET /admin/stats/analytics` | Count only |

---

## What SUPER_ADMIN CANNOT Do for Schools

These are internal school operations that require SchoolMembership:

| Operation | Status | Reason |
|-----------|--------|--------|
| View individual students or teachers | ❌ | Requires school membership |
| View classes, grades, attendance | ❌ | Requires school membership |
| Create or edit classes | ❌ | Requires TEACHER/SCHOOL_ADMIN membership |
| Create announcements | ❌ | Requires TEACHER/SCHOOL_ADMIN membership |
| Manage school settings (grading scale, notifications) | ❌ | Requires SCHOOL_ADMIN membership |
| Invite users to a school | ❌ | Requires SCHOOL_ADMIN membership |
| View school messages | ❌ | Requires school membership |
| Access the school's live classes (as participant) | ❌ | Requires school membership (ARCH-01) |
| Access the school's socket feed | ❌ | SA-FIX-10/11 |
| View per-school financial data (fees, payments) | ❌ | No platform admin API for school-scoped finances |

---

## School Administrator Management

SUPER_ADMIN cannot directly assign school administrators. School admin roles are managed through the SchoolMembership system:

| Action | Who can do it |
|--------|--------------|
| Create initial school with admin | School creation flow (creates SchoolMembership with SCHOOL_ADMIN role) |
| Add a SCHOOL_ADMIN | Existing SCHOOL_ADMIN via membership management |
| View who the school admins are | Not available in platform admin API |
| Remove a school admin | Not available in platform admin API |

If a SUPER_ADMIN needs to manage a specific school (e.g., a school has no admins), they must:
1. Use the internal provisioning flow to create a SchoolMembership with SCHOOL_ADMIN role for themselves or a designated operator
2. This is an operational procedure, not an automated platform feature

---

## School Moderation

When a school is reported for abuse:

**Recommended platform admin approach:**
1. View school details via `GET /admin/stats/schools` (name, member count, city)
2. View recent audit logs involving that school via `GET /admin/stats/audit?schoolId=...`
3. View social reports from users of that school via `GET /social/reports`
4. Suspend individual bad actors via `PATCH /admin/stats/users/:id/status`
5. Deactivate the school if necessary via `PATCH /admin/stats/schools/:id/status`

**What is NOT possible (and correct):**
- SUPER_ADMIN cannot enter the school's private spaces (classes, messages, voice rooms)
- SUPER_ADMIN cannot view individual student records
- SUPER_ADMIN cannot see school-scoped private content

---

## Gaps in School Administration

| Gap | Risk | Notes |
|-----|------|-------|
| No endpoint to list a school's members from admin API | MEDIUM | Platform admin cannot see who belongs to a school without going through school-scoped endpoints (requires membership) |
| No endpoint to view school financial records (fee payments, etc.) | LOW | School-internal, not platform revenue |
| No endpoint to create a school from the admin API | LOW | Schools are self-registered |
| No endpoint to fully delete a school (hard delete) | LOW | Soft-delete available only from school admin side |
| School deactivation does not lock out users | MEDIUM | Admins must also suspend individual users if they want to immediately deny access |
