# HALQA Mobile App — Integration Guide

## Authentication & Authorization Changes

### Overview

The HALQA backend now uses a **dual-domain architecture**:
- **Social Platform** — available to ALL authenticated users regardless of school
- **Education** — optional, requires an active school membership

### What changed

Previously, the mobile app could determine a user's Education role from `user.role` (e.g. `TEACHER`, `STUDENT`, `GUARDIAN`). This is now **deprecated** for authorization purposes.

The correct source is `schoolMemberships[]` returned by `GET /auth/me`.

---

### GET /auth/me — Updated Response Shape

```json
{
  "id": "...",
  "role": "MEMBER",          // Legacy field — Social platform only
  "schoolId": null,          // Legacy field — may be null for new users
  "schoolMemberships": [     // ← THIS is the authoritative Education source
    {
      "id": "...",
      "schoolId": "school-a",
      "role": "TEACHER",     // School-scoped role
      "status": "ACTIVE",
      "joinedAt": "2026-01-01T00:00:00Z",
      "school": {
        "id": "school-a",
        "name": "Halqa Academy",
        "slug": "halqa-academy",
        "logoUrl": "https://...",
        "type": "academy"
      }
    }
  ]
}
```

### Mobile navigation logic

```swift
// WRONG (legacy — do not use for Education navigation)
if user.role == "TEACHER" {
    showTeacherDashboard()
}

// CORRECT (use schoolMemberships)
if let activeMembership = user.schoolMemberships.first(where: { $0.status == "ACTIVE" }) {
    switch activeMembership.role {
    case "TEACHER":   showTeacherDashboard(schoolId: activeMembership.schoolId)
    case "STUDENT":   showStudentDashboard(schoolId: activeMembership.schoolId)
    case "GUARDIAN":  showGuardianDashboard(schoolId: activeMembership.schoolId)
    default: break
    }
}

// Social is always available regardless of school membership
showSocialDashboard()
```

---

### POST /auth/login — Updated Response

```json
{
  "user": { ... },
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": "15m",
  "mustChangePassword": false,  // ← NEW: true for admin-created accounts
  "requiresTOTP": false         // ← true for 2FA accounts (see below)
}
```

**If `mustChangePassword: true`**: redirect user to the change-password screen before any other navigation. Call `PUT /auth/change-password` with `{ currentPassword, newPassword }`. The flag clears automatically on success.

---

### 2FA Login Flow (Updated — C-1 security fix)

The old flow sent `userId` in the 2FA authenticate request. This is **no longer accepted**.

**New flow:**
1. `POST /auth/login` returns `{ requiresTOTP: true, challengeToken: "..." }`
2. Show TOTP input screen
3. `POST /auth/2fa/authenticate` with `{ challengeToken: "...", code: "123456" }`
4. Returns full tokens on success

```swift
// Step 1
let loginResponse = try await api.login(email: email, password: password)

if loginResponse.requiresTOTP {
    // Step 2: show TOTP screen
    let code = await showTOTPScreen()
    
    // Step 3: complete 2FA (challengeToken, NOT userId)
    let tokens = try await api.authenticate2FA(
        challengeToken: loginResponse.challengeToken,
        code: code
    )
}
```

---

### School Context

When a user belongs to multiple schools, the active school can be switched. The active school only affects **Education** navigation — Social features are unchanged.

Store the active `schoolId` locally and pass it in Education API requests:
- Via `X-School-Id` header, OR
- Via URL params (e.g. `/schools/:schoolId/students`)

```swift
// Setting active school context for Education APIs
var request = URLRequest(url: URL(string: "/api/v1/students")!)
request.setValue(activeSchoolId, forHTTPHeaderField: "X-School-Id")
```

---

### New Endpoints (Mobile should implement)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/v1/school-memberships/me` | Get user's school memberships |
| `POST` | `/api/v1/school-memberships/join` | Request to join a school |
| `POST` | `/api/v1/school-memberships/create-school` | Create a new school |
| `GET`  | `/api/v1/schools/search?search=name` | Search for schools |
| `PUT`  | `/api/v1/school-memberships/:id/role` | Admin: change member role |

---

### Social features — no school required

All these are available without school membership:
- Feed (`/api/v1/posts/feed`)
- Voice Club (`/api/v1/voice/rooms`)
- Communities (`/api/v1/communities`)
- DMs (`/api/v1/dm`)
- Groups (`/api/v1/group-chat`)
- Wallet (`/api/v1/wallet`)
- Gifts (`/api/v1/gifts`)
- Creator (`/api/v1/creators`)
