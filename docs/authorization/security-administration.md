# Security Administration — SUPER_ADMIN Capabilities

---

## Security Event Summary

**API:** `GET /api/v1/admin/stats/security`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

Returns:
```json
{
  "stats": {
    "suspensions7d": 3,
    "bans7d": 1,
    "roleChanges7d": 2,
    "totalSuspended": 12,
    "totalBanned": 5
  },
  "recentEvents": [
    {
      "id": "...",
      "action": "UPDATE",
      "entity": "user_status",
      "entityId": "<userId>",
      "oldValues": { "status": "ACTIVE" },
      "newValues": { "status": "SUSPENDED", "reason": "..." },
      "createdAt": "...",
      "user": { "firstName": "Admin", "lastName": "User", "email": "..." }
    }
  ]
}
```

Sources: `audit_logs` where `entity IN ('user_status', 'user_platform_role', 'user_moderation', 'school_status')` and `createdAt >= 7 days ago`.

---

## Audit Log Access

**API:** `GET /api/v1/admin/stats/audit`  
**Auth:** IP allowlist + authenticate + authorize('SUPER_ADMIN')

**Parameters:**
- `entity` — filter by entity type (e.g., `user_status`, `school_status`, `user_platform_role`)
- `action` — CREATE | UPDATE | DELETE | LOGIN | LOGOUT | EXPORT | IMPORT | VIEW
- `userId` — filter by acting user
- `startDate`, `endDate` — date range filter
- `page`, `limit` (max 100)

**Returns:** Full audit log records including `oldValues`, `newValues`, `ipAddress`, `userAgent`.

**Note:** The `ipAddress` field in audit logs is the IP of the admin who performed the action, not the target user's IP. There is no "user login history by IP" endpoint.

---

## Session Administration

### What SUPER_ADMIN can see:
- User's last login time (`lastLoginAt`) via user profile
- Whether a user account is currently active/suspended/banned

### What SUPER_ADMIN cannot see:
- List of a user's active sessions
- Device information for a user's sessions
- IP addresses a user has logged in from
- Per-device session history

**No platform admin session management API exists.**

To immediately invalidate a user's access:
1. Suspend their account via `PATCH /admin/stats/users/:id/status`
2. This triggers `invalidateUserCache(userId)` — next API call returns 403
3. Refresh tokens are not proactively revoked but the 401/403 on next use prevents access

**Gap:** Refresh tokens remain valid in the database until they expire or are used. There is no admin endpoint to force-revoke all refresh tokens for a user. Suspension is the practical enforcement mechanism.

---

## IP Controls

### IP Allowlist (Platform Admin Protection)

The `ipAllowlist` middleware protects all admin-tier routes:
- `/api/v1/admin/stats/*`
- `/api/v1/backups/*`
- `/api/v1/internal/*`

**Configuration:** `ADMIN_IP_ALLOWLIST` environment variable (comma-separated CIDRs or IPs).

**Gap:** If `ADMIN_IP_ALLOWLIST` is empty or unset, the middleware passes all requests through. This is documented in `known-gaps.md` as GAP-001.

**No admin API exists to manage the IP allowlist.** It is a server-side environment variable.

---

## Authentication Event Monitoring

There is no dedicated authentication event log in the current API surface. Auth events (logins, failed attempts, token refreshes) are not written to `audit_logs`.

**Available indirectly:**
- `users.lastLoginAt` — last successful login timestamp
- `audit_logs` — admin actions, not user login events

**Gap:** No security event log for:
- Failed login attempts
- 2FA failures
- Password reset requests
- OAuth link/unlink events

---

## 2FA Administration

| Operation | Status | Notes |
|-----------|--------|-------|
| View whether a user has 2FA enabled | ✅ | Via `GET /users/:id` — `twoFactorEnabled` field returned |
| View a user's 2FA secret | ❌ | `twoFactorSecret` is never returned by any API |
| Disable a user's 2FA | ❌ | No admin 2FA endpoint |
| Reset a user's 2FA | ❌ | No admin 2FA endpoint |
| Bypass a user's 2FA | ❌ | Not possible |

**Note:** If a user has locked themselves out with 2FA, there is no platform admin override. This must be resolved through an out-of-band identity verification process (not in scope of the current system).

---

## Suspicious Activity Detection

No automated suspicious activity detection exists in the current codebase. The `security` stats endpoint aggregates historical events from the audit log but does not perform real-time anomaly detection.

**PK system anti-cheat flags (not admin-visible):**
The `pk_config` table has `suspiciousRatingThreshold` and `maxGiftVelocityPerMinute` fields, but there is no admin API to view or act on flagged accounts.

---

## Security Settings

No system-wide security settings API exists for SUPER_ADMIN. Security configuration is managed through:
1. Environment variables (`ADMIN_IP_ALLOWLIST`, `JWT_SECRET`, etc.)
2. Database direct access (for `pk_config`, feature flags)
3. Code-level constants

---

## What SUPER_ADMIN Must Never Access

| Item | Status | Reason |
|------|--------|--------|
| `passwordHash` values | ❌ BLOCKED | Never returned by any API |
| `twoFactorSecret` values | ❌ BLOCKED | Never returned by any API |
| Refresh token values | ❌ BLOCKED | Never returned by any API |
| OTP codes | ❌ BLOCKED | Never returned by any API |
| Private encryption keys | ❌ BLOCKED | Not in DB; in environment variables only |
| `accountDetails` in PayoutRequest | ⚠️ NO API | Contains bank/PayPal info; no admin endpoint currently |

---

## Audit Log Coverage for SUPER_ADMIN Actions

| Admin Action | Audit Logged | Entity / Action |
|-------------|-------------|----------------|
| Change user status | ✅ YES | `user_status` / UPDATE |
| Change school active status | ✅ YES | `school_status` / UPDATE |
| Provision SUPER_ADMIN role | ✅ YES | `user_platform_role` / UPDATE |
| Revoke SUPER_ADMIN role | ✅ YES | `user_platform_role` / UPDATE |
| Review social report | ❌ NO | **Gap** — no audit log for report reviews |
| Read user profile (PII access) | ❌ NO | **Gap** — admin reads of PII not logged |
| Read audit logs | ❌ NO | Meta-gap — viewing logs is not itself logged |
| Backup metadata mutations | ❌ NO | **Gap** — backup route mutations not audit-logged |
| Payout approval | N/A | No endpoint exists yet |

---

## Recommendations (Documentation Only — Do Not Implement)

1. Audit-log all admin reads of sensitive PII (`GET /users/:id` by SUPER_ADMIN)
2. Audit-log social report review actions
3. Implement a dedicated payout management API with full audit trail
4. Require `ADMIN_IP_ALLOWLIST` to be set in production (reject empty)
5. Add session revocation endpoint (invalidate all refresh tokens for a user)
6. Add login/auth event audit log for security monitoring
