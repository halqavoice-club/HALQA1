# User Management — SUPER_ADMIN Capabilities

**Scope:** What SUPER_ADMIN can do to and about users, and the hard boundary between managing users and acting as users.

---

## The Core Distinction

```
MANAGE USER                         ACT AS USER
────────────────────────────────    ────────────────────────────────
View account details                Log in as that user
Change account status               Post on their behalf
View reports about them             Join rooms as them
Change their platform role          Send messages as them
Inspect their sessions              Appear in their participant list
View their audit history            Receive gifts as them
                                    Become their class HOST
```

**SUPER_ADMIN can only MANAGE users.  
SUPER_ADMIN must never ACT AS a user.**

There is no impersonation feature in HALQA. No API exists to authenticate as another user. If one were to be added in the future, it would require a dedicated audit trail, explicit consent mechanisms, and a separate session type.

---

## View Users

### List users with search/filter

**API:** `GET /api/v1/admin/stats/users`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Parameters:**
- `page`, `limit` (max 100 per page)
- `search` — matches firstName, lastName, email
- `status` — ACTIVE | SUSPENDED | BANNED | INACTIVE | PENDING
- `role` — SUPER_ADMIN | SCHOOL_ADMIN | TEACHER | STUDENT | MEMBER | etc.

**Returns:**
```json
{
  "id": "uuid",
  "email": "...",
  "firstName": "...", "lastName": "...",
  "role": "MEMBER",
  "status": "ACTIVE",
  "avatarUrl": "...",
  "lastLoginAt": "...",
  "createdAt": "...",
  "_count": { "schoolMemberships": 2 }
}
```

**Does NOT return:** `passwordHash`, `twoFactorSecret`, `phone`, `dateOfBirth`, `address`, `fcmToken`

---

### Get full user profile

**API:** `GET /api/v1/users/:id`  
**Auth:** authenticate (SUPER_ADMIN check in controller)

**Returns (SUPER_ADMIN):** Full PII including `email`, `phone`, `dateOfBirth`, `gender`, `address`, `lastLoginAt`, `emailVerified`

**Does NOT return:** `passwordHash`, `twoFactorSecret`, `fcmToken`

**Risk:** MEDIUM — full PII access. Auditing not currently implemented for admin profile reads.

---

## Change Account Status

**API:** `PATCH /api/v1/admin/stats/users/:id/status`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Allowed status values:** `ACTIVE` | `SUSPENDED` | `BANNED` | `INACTIVE`

**Effect of SUSPENDED:**
- User receives 403 "Account suspended" on next authenticated request
- Redis auth cache invalidated immediately (30s maximum propagation)
- User's active sessions remain until next request is rejected

**Effect of BANNED:**
- Same as SUSPENDED but semantically permanent

**Protections:**
- Cannot change the status of another SUPER_ADMIN
- Audit log always written (even if status doesn't change)

**Audit log entry written:**
```json
{
  "action": "UPDATE",
  "entity": "user_status",
  "entityId": "<targetUserId>",
  "oldValues": { "status": "ACTIVE" },
  "newValues": { "status": "SUSPENDED", "reason": "..." },
  "userId": "<actingAdminId>",
  "ipAddress": "...",
  "userAgent": "..."
}
```

**Risk:** HIGH — immediately locks out a real user. No undo confirmation UI currently. Reversible by setting status back to ACTIVE.

---

## Manage Platform Roles (SUPER_ADMIN only)

**API:** `POST /api/v1/internal/admin/provision`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Actions:**
- `grant` — elevates a user to SUPER_ADMIN
- `revoke` — demotes a SUPER_ADMIN back to MEMBER

**Protections:**
- Actor cannot modify their own role
- Cannot revoke the last SUPER_ADMIN (minimum 1 must remain)
- Target must not already be SUPER_ADMIN (for grant) or must be SUPER_ADMIN (for revoke)
- Full audit log written with `requestId` field for traceability

**What this does NOT do:**
- Does not change SchoolMembership records
- Does not grant school admin privileges
- Does not accept a role value from the request body (hardcodes `SUPER_ADMIN` / `MEMBER`)

---

## Inspect User Accounts

### Available via admin stats:
- Account status and role
- Registration date
- Last login timestamp
- School membership count
- Email (in full profile view)

### NOT available via any API:
- Login history / session list
- IP addresses used for login (no dedicated admin IP history endpoint)
- Password reset history
- 2FA status (visible in full profile but cannot be administered)
- Device tokens (FCM)
- OAuth provider links

---

## Inspect Reports

**API:** `GET /api/v1/social/reports`  
**Auth:** authenticate + authorize('SUPER_ADMIN')

Returns all user reports filed on the platform, including:
- Reporter and reported user IDs
- Reason and description
- Room context (if report came from a voice room)
- Current status (PENDING / REVIEWED / DISMISSED / ACTION_TAKEN)

**Review a report:**  
`PATCH /api/v1/social/reports/:id/review`  
Sets status and records `reviewedBy` = admin's userId.

---

## Manage Roles — Scope Limitations

SUPER_ADMIN can only manage one role value: `SUPER_ADMIN` ↔ `MEMBER`.

| Role change | Possible via admin? | API |
|------------|-------------------|-----|
| Grant SUPER_ADMIN | ✅ | `/internal/admin/provision { action: "grant" }` |
| Revoke SUPER_ADMIN | ✅ | `/internal/admin/provision { action: "revoke" }` |
| Set user as SCHOOL_ADMIN | ❌ | Requires school admin to create a SchoolMembership |
| Set user as TEACHER | ❌ | Requires school admin |
| Set user as STUDENT | ❌ | Requires school admin |
| Assign any education role | ❌ | Not a platform admin function |

---

## What SUPER_ADMIN Cannot Do to Users

| Action | Status | Reason |
|--------|--------|--------|
| Log in as a user | ❌ NOT POSSIBLE | No impersonation API exists |
| Read a user's DMs | ❌ NOT POSSIBLE | No admin DM read endpoint |
| Read a user's private posts | ❌ NOT POSSIBLE | No admin post read endpoint |
| Join a live class as that user | ❌ NOT POSSIBLE | Not impersonation — would join as admin |
| Reset a user's password | ❌ NOT POSSIBLE | No admin password reset endpoint |
| Disable a user's 2FA | ❌ NOT POSSIBLE | No admin 2FA endpoint |
| View a user's session tokens | ❌ NOT POSSIBLE | Token values never returned by any API |
| View a user's wallet balance | ❌ NOT POSSIBLE | No per-user wallet endpoint in admin API |
| Send notifications to a user | ❌ NOT POSSIBLE | No admin notification send endpoint |
| Edit a user's profile | ❌ NOT POSSIBLE | No admin profile edit endpoint |

---

## Security Considerations

1. **Suspend is immediate via cache invalidation.** The `invalidateUserCache` call in the status endpoint forces the next request to re-read from DB. Maximum 30-second propagation time even without cache invalidation.

2. **Status changes are the only enforcement tool.** Platform admin has no session revocation endpoint. Suspension is the mechanism for immediate access denial.

3. **Full PII is available in profile lookup.** SUPER_ADMIN accessing full user profiles is not currently audit-logged. This is a gap — admin reads of sensitive PII should generate audit events.

4. **No impersonation.** The architecture contains no server-side mechanism for "login as user." Any future feature of this kind would require a completely separate implementation with its own audit trail, explicit consent, and legal review.
