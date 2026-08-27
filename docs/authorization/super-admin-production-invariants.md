# SUPER_ADMIN Production Invariants

**Version:** 1.0  
**Audit date:** 2026-08-26  
**Authority:** These rules must NEVER be broken in any future development.  
**Enforcement:** All SUPER_ADMIN changes must be verified against this list before deployment.

---

## What is a Production Invariant

A production invariant is an architectural rule that is:
1. Non-negotiable — it cannot be relaxed without a full security and architecture review
2. Permanently documented — all teams must know it exists
3. Test-covered — automated tests must verify it
4. Change-controlled — any modification requires deliberate, documented decision-making

---

## The Invariants

### INV-001 — SUPER_ADMIN Cannot Participate in the Social Feed

**Rule:** SUPER_ADMIN platform privilege must never automatically grant the ability to:
- Post content to the feed
- Comment on posts
- React to posts
- Appear in feed participant lists
- Receive content-participant feed socket events for schools they are not a member of

**Current status of `feed:school:{schoolId}`:** ⚠️ VIOLATED (SVSV-001)  
**Correct behavior:** SUPER_ADMIN subscribes to school feed rooms only if JWT schoolId matches

---

### INV-002 — SUPER_ADMIN Cannot Join a Live Class

**Rule:** SUPER_ADMIN platform privilege must never automatically create a `LiveClassParticipant` record or grant access to any live class content space.

Specifically:
- SUPER_ADMIN must not be assigned HOST, TEACHER, STUDENT, or any other live class role by virtue of their platform role
- SUPER_ADMIN must not auto-start a SCHEDULED live class by joining it
- SUPER_ADMIN must not appear in live class attendance records
- SUPER_ADMIN must not receive a LiveKit participant token for a live class

**Current status:** ⚠️ VIOLATED (LCSV-001) — SUPER_ADMIN receives HOST role on join

---

### INV-003 — SUPER_ADMIN Cannot Join a Live Stream as a Content Participant

**Rule:** A SUPER_ADMIN acting in their administrative capacity must not become a content participant in any live stream (PUBLIC or otherwise) that they did not personally create as a regular user.

The distinction:
- SUPER_ADMIN creates their own public stream (personal user action) → OK as `hostUserId` holder
- SUPER_ADMIN joins someone else's stream as admin → DENIED as participant

**Current status:** ⚠️ VIOLATED (LCSV-001) — SUPER_ADMIN joins and receives HOST role on any public stream

---

### INV-004 — SUPER_ADMIN Cannot Join a Voice Room in Administrative Capacity

**Rule:** SUPER_ADMIN platform privilege must never automatically grant voice room access. If a SUPER_ADMIN joins a voice room, they do so as a regular user (same as MEMBER role) — not through any platform admin bypass.

Corollaries:
- SUPER_ADMIN must not automatically become HOST of voice rooms
- SUPER_ADMIN must not have speaker queue admin privilege without being a HOST/MOD participant (SA-FIX-09)
- SUPER_ADMIN must not bypass the `VoiceParticipant` record requirement for LiveKit tokens

**Current status:** ✅ CORRECT — no bypass exists in voice room join

---

### INV-005 — SUPER_ADMIN Must Never Become HOST by Platform Role

**Rule:** The HOST role in any content space (Live Class, Live Stream, Voice Room) must be earned through:
- Creating the room (becomes hostUserId or room creator)
- Being explicitly assigned by another HOST (for voice room MODERATOR)
- Having a school staff membership (TEACHER/SCHOOL_ADMIN via SchoolMembership)

Never through SUPER_ADMIN platform privilege alone.

**Current status:** ⚠️ VIOLATED (LCSV-001) for Live Class

---

### INV-006 — SUPER_ADMIN Must Never Become TEACHER or STUDENT

**Rule:** Education roles (TEACHER, STUDENT, GUARDIAN, SCHOOL_ADMIN) are school-scoped and stored in `school_memberships`. SUPER_ADMIN platform role must not be treated as an implicit education role.

**Current status:** ⚠️ PARTIALLY VIOLATED (LCSV-001, LCSV-002) — SUPER_ADMIN included in `isTeacher`/`isStaff` checks

---

### INV-007 — SUPER_ADMIN Must Never Become SPEAKER, STREAMER, or LISTENER as Content Participant

**Rule:** Audio/video publishing roles (SPEAKER in voice rooms, streamer in live streams) must be earned through content participation. SUPER_ADMIN platform privilege must never grant these roles.

**Current status:** ✅ CORRECT — no bypass for speaker promotion

---

### INV-008 — SUPER_ADMIN Must Not Receive Content-Participation LiveKit Tokens

**Rule:** SUPER_ADMIN must not receive LiveKit tokens granting:
- `roomJoin: true` for content participation rooms
- `canPublish: true` for audio/video
- `canSubscribe: true` for receiving audio/video

UNLESS they have a valid content-participant DB record obtained through normal user participation (not through any admin bypass).

**Current status:** ⚠️ VIOLATED via LCSV-001 — if a SUPER_ADMIN joins a live class (which LCSV-001 allows), they can obtain a LiveKit token

---

### INV-009 — SUPER_ADMIN Must Not Join Content Socket.IO Rooms Through Platform Privilege

**Rule:** The following rooms must require a valid content-participant DB record and must have NO SUPER_ADMIN bypass:
- `voice:{roomId}` — requires active `VoiceParticipant`
- `liveclass:{id}` — requires active `LiveClassParticipant`
- `class:{classId}` — requires active `SchoolMembership`
- `school:{schoolId}` — requires JWT schoolId match
- `feed:school:{schoolId}` — requires JWT schoolId match (VIOLATED — SVSV-001)
- `community:{id}` — requires active `CommunityMember`
- `conversation:{convId}` — requires active `GroupMember`
- `pk:{matchId}` — requires participant record or public match state

**Current status:** ⚠️ PARTIALLY VIOLATED (SVSV-001) for `feed:school:{schoolId}`

---

### INV-010 — SUPER_ADMIN Cannot Bypass School Authorization

**Rule:** School isolation checks — `requireSchoolMember()`, `assertSchoolAccess()`, `resolveStreamAccess()`, `checkLiveClassSchool()` — must not contain unconditional SUPER_ADMIN bypasses.

A SUPER_ADMIN who needs access to a specific school's resources must be explicitly provisioned a SchoolMembership for that school. This is ARCH-01.

**Current status:** ✅ CORRECT — ARCH-01 has been applied to the main school auth paths  
**Exception:** LTSV-001 remains (generic LiveKit token skips school check)

---

### INV-011 — Administrative Access Must Not Be Implemented via Content Participation

**Rule:** If SUPER_ADMIN needs to "manage" or "moderate" a content space (e.g., terminate a live class, monitor a voice room), the implementation MUST use dedicated administrative APIs — not by making SUPER_ADMIN a content participant.

**Correct pattern:**
```
Admin UI
  → POST /api/v1/admin/live-classes/:id/terminate
    → ipAllowlist + authorize('SUPER_ADMIN')
      → End class, write audit log
      → No LiveClassParticipant record created
```

**Incorrect pattern:**
```
SUPER_ADMIN
  → POST /api/v1/live-classes/:id/join   (content API)
    → Gets HOST role
      → Has host controls
        → Calls POST /live-classes/:id/end
```

**Current status:** MISSING — no dedicated admin termination endpoints exist (UIGAP-007)

---

### INV-012 — Sensitive SUPER_ADMIN Mutations Must Be Audited

**Rule:** The following actions must always write to `audit_logs`:

| Action | entity | action |
|--------|--------|--------|
| Change user status | `user_status` | `UPDATE` |
| Change school active status | `school_status` | `UPDATE` |
| Grant SUPER_ADMIN | `user_platform_role` | `UPDATE` |
| Revoke SUPER_ADMIN | `user_platform_role` | `UPDATE` |
| Admin coin grant (future) | `wallet_transaction` | `CREATE` |
| Approve/reject payout (future) | `payout_request` | `UPDATE` |
| Review social report (future) | `report_review` | `UPDATE` |
| Read sensitive user PII (future) | `user_profile_access` | `VIEW` |

**Current status:** First four are ✅ AUDITED. Rest are ❌ MISSING (UIGAP-013).

---

### INV-013 — Financial Administrative Actions Must Be Transactional and Auditable

**Rule:** Any operation that modifies wallet balances, coin balances, diamond balances, or payout records must:
1. Execute inside a database transaction (atomic — no partial state)
2. Write an audit log entry with before/after values
3. Be idempotency-keyed (prevent double-execution)
4. Validate that the resulting balance cannot go negative
5. Require SUPER_ADMIN role + IP allowlist

**Current status:** ❌ NOT IMPLEMENTED (no admin financial mutation API exists)

---

### INV-014 — SUPER_ADMIN Must Never Be Silently Converted Into a Content Role

**Rule:** Any code path that assigns a user to a content-participation role (HOST, TEACHER, STUDENT, SPEAKER, STREAMER, VIEWER) must never automatically promote SUPER_ADMIN platform privilege into that content role.

Every content role assignment must trace back to one of:
- A legitimate school membership
- A room creation action (hostId)
- An explicit host assignment (transferAdmin, assignModerator)
- A queue approval (AUDIENCE → SPEAKER)
- A direct promotion (promoteParticipant)

**Current status:** ⚠️ VIOLATED (LCSV-001) — `isTeacher/isStaff` checks silently promote SUPER_ADMIN to HOST

---

### INV-015 — SUPER_ADMIN Session and Token TTL Must Not Exceed Platform Standard

**Rule:** SUPER_ADMIN accounts must use the same token TTL as all other users:
- Access token: 15m (JWT_EXPIRES_IN)
- Refresh token: 7d (JWT_REFRESH_EXPIRES_IN)
- Auth cache: 30s (Redis TTL)

SUPER_ADMIN accounts must not receive longer-lived tokens that would allow bypassing account suspension.

**Current status:** ✅ CORRECT — no special TTL for SUPER_ADMIN

---

### INV-016 — SUPER_ADMIN Role Cannot Be Assigned Through Application Code

**Rule:** `User.role = 'SUPER_ADMIN'` must only be set through:
1. `POST /api/v1/internal/admin/provision { action: 'grant' }` (authenticated, IP-allowlisted, audited)
2. Direct database write for emergency bootstrap

It must never be assignable through:
- Registration API
- Profile update API
- School membership API
- Any other application-code path

`assertSafeUserRole()` in `roleGuard.js` enforces this by throwing on any attempt to set SUPER_ADMIN through application code.

**Current status:** ✅ CORRECT — `roleGuard.js` blocks all application code paths

---

## Change Control Checklist

Before any code change affecting SUPER_ADMIN behavior, verify all invariants:

```
[ ] INV-001  Feed participation check
[ ] INV-002  Live class join check  
[ ] INV-003  Live stream join check
[ ] INV-004  Voice room join check
[ ] INV-005  HOST role assignment check
[ ] INV-006  TEACHER/STUDENT role check
[ ] INV-007  SPEAKER/STREAMER/LISTENER check
[ ] INV-008  LiveKit token check
[ ] INV-009  Socket.IO room membership check
[ ] INV-010  School authorization bypass check
[ ] INV-011  Admin API vs participation API check
[ ] INV-012  Audit requirement check
[ ] INV-013  Financial transaction safety check
[ ] INV-014  Silent role conversion check
[ ] INV-015  Token TTL check
[ ] INV-016  Role assignment path check
```

If any invariant would be violated by the change:
1. Stop
2. Redesign the feature using administrative APIs instead of content participation APIs
3. Document the new design
4. Get a second review before proceeding

---

## Testing Requirements

The file `backend/src/tests/platform-admin-scope.test.js` must cover:
- SUPER_ADMIN cannot join a school live class
- SUPER_ADMIN cannot join a school voice room with elevated privileges
- SUPER_ADMIN `joinLiveClass` on a public stream they did not create assigns STUDENT role (pending fix of LCSV-001)
- SUPER_ADMIN cannot bypass `requireSchoolMember()` in school endpoints
- SUPER_ADMIN cannot get a LiveKit token without an active participant record
- SUPER_ADMIN `feed:join:school` is blocked for non-matching schools (pending fix of SVSV-001)
- SUPER_ADMIN role cannot be set through registration or profile update APIs
