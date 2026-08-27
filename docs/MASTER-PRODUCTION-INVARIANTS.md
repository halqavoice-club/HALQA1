# HALQA — Master Production Invariants

**Version:** 1.0  
**Audit date:** 2026-08-26  
**Authority:** These rules must never be broken in any future development.  
**Evidence base:** Derived from all 89 documentation files and direct source inspection.

---

## INVARIANT-001 — SUPER_ADMIN Cannot Participate in Content

**Rule:** SUPER_ADMIN platform privilege must never automatically grant content participation rights in any system: feed, live class, live stream, voice club, direct messages, group chat, communities, or stories.

**Corollary:** If SUPER_ADMIN needs to manage a content space, the mechanism must be a dedicated administrative API — not by joining the content space as a participant.

**Current violations:** LCSV-001, LCSV-002, SVSV-001

---

## INVARIANT-002 — SUPER_ADMIN Cannot Receive Content-Participant LiveKit Tokens Via Platform Privilege

**Rule:** SUPER_ADMIN must not receive a LiveKit token granting `roomJoin: true` for any content space (voice room or live class) through their platform role alone. Token issuance requires an active `VoiceParticipant` or `LiveClassParticipant` DB record obtained through normal content participation.

**Current violations:** LCSV-001 enables this as a side effect

---

## INVARIANT-003 — School Isolation Must Be Enforced Server-Side

**Rule:** All school-scoped data access must be verified on the server against `SchoolMembership` or `User.schoolId`. Client-supplied school IDs must never be trusted for authorization decisions.

**Evidence:** `requireSchoolMember()`, `assertSchoolAccess()`, `resolveStreamAccess()` all enforce this. SA-FIX-10 and SA-FIX-11 removed socket-level bypasses.

**Current gap:** `visibilityFilter()` uses legacy `User.schoolId` instead of `SchoolMembership` (FS-GAP-002)

---

## INVARIANT-004 — Client-Side Permissions Are Never Authoritative

**Rule:** All authorization decisions must be re-verified on the server. Frontend guards (isAdmin, isHost, isStaffRole) are UI optimizations only. The backend must independently verify every operation regardless of what the client sends.

**Evidence:** Socket events use `socket.userId` from JWT, never client payload. `liveclass:viewmode_changed` re-reads HOST role from DB.

---

## INVARIANT-005 — Every Privileged Administrative Action Must Be Audited

**Rule:** The following categories of actions must always write to `audit_logs`:
- User status changes (SUSPEND/BAN/ACTIVATE)
- Platform role changes (SUPER_ADMIN grant/revoke)
- School status changes (activate/deactivate)
- Any future financial admin mutations (coin grants, payout approvals, refunds)

**Current gap:** Report reviews, PII reads, backup mutations not logged (UIGAP-013, FS-GAP-003)

---

## INVARIANT-006 — Every Financial Mutation Must Be Transactional

**Rule:** All operations that modify wallet balances (coins, diamonds) must execute inside a `prisma.$transaction` to ensure atomicity. Partial states must never be possible.

**Evidence:** `sendGift()`, `sendGiftToAll()`, Stripe webhook credit all use `prisma.$transaction`.

**Corollary:** Idempotency keys must be used for all financial operations to prevent double-charging on network retries. `GiftTransaction.idempotencyKey` and `WalletTransaction.stripeSessionId` enforce this at DB level.

---

## INVARIANT-007 — Every Realtime Event Must Have Server-Side Authorization

**Rule:** No socket event relay may forward a message without server-side verification. Client-supplied identity values in payloads must never be used for authorization — `socket.userId` from JWT is authoritative.

**Evidence:**
- `liveclass:speaking` relay uses `socket.userId` (P0-02 fix)
- `liveclass:viewmode_changed` re-reads HOST from DB before relay (P1-02 fix)
- `liveclass:screen_share_started` verifies participation + screenShareEnabled (GAP-02 fix)
- `voice:join_room` verifies active `VoiceParticipant` in DB (SOC-P1-05 fix)
- `liveclass:join_room` verifies active `LiveClassParticipant` in DB (P0-04 fix)

---

## INVARIANT-008 — Kick/Ban Must Prevent Unauthorized Reconnect

**Rule:** When a user is kicked or banned from any content space, the enforcement must prevent reconnection through all three layers:
1. DB: `isActive = false` or `isBanned = true` (authoritative)
2. LiveKit SFU: `RoomServiceClient.removeParticipant()` (immediate eviction)
3. Socket.IO: force-remove sockets from the content room

**Evidence:** `kickParticipant()` in both voice and live class controllers implements all three layers. Token endpoint checks `isActive` — kicked user cannot get new token.

**Corollary:** Token TTL of 1h is the maximum post-kick token reuse window.

---

## INVARIANT-009 — Database Ownership Must Be Verified Server-Side

**Rule:** Before any update or delete operation, the server must verify the requesting user owns the record (or has explicit permission). It must never rely on client-supplied ownership claims.

Examples:
- `updatePost`: `if (post.authorId !== req.user.id) return 403`
- `updateRoom`: HOST or active MODERATOR VoiceParticipant record required
- `deleteStory`: `story.authorId === req.user.id` required
- `deleteMessage`: author OR post owner can delete

---

## INVARIANT-010 — Public Live Stream Viewer Access Must Remain Distinct from Live Class Participation

**Rule:** PUBLIC live streams (`streamType='PUBLIC'`) are accessible to any authenticated user, but participation must follow the same token/participant-record flow as SCHOOL streams. Being an authenticated user does not bypass the `LiveClassParticipant` requirement for LiveKit tokens.

**Evidence:** `resolveStreamAccess` passes for PUBLIC streams, but `getLiveKitToken` still requires `liveClassParticipant.isActive`. Joining a PUBLIC stream creates a participant record before the token is issued.

---

## INVARIANT-011 — Content Filter Must Run Before Persistence

**Rule:** All user-generated text content (posts, comments, group chat messages) must pass through `contentFilter` middleware before being written to the database. This filter may not be removed or bypassed.

**Evidence:** `postFilter('body', 'post')` and `filterMiddleware('body', 'group-chat')` on all create routes.

---

## INVARIANT-012 — Rate Limits Must Protect High-Frequency Endpoints

**Rule:** The following endpoints must maintain rate limits to prevent abuse:
- Post creation: 20/min
- Comment creation: 30/min
- Story creation: 30/hour
- Gift sending: 30/10s
- Payout requests: 5/hour
- User following: 30/min
- Friend requests: 20/min
- Social reports: 10/hour

---

## INVARIANT-013 — Database Migrations Must Run Before New Backend Starts

**Rule:** Prisma migrations must be applied before the backend container starts with the new code. Running migrations after the backend starts risks schema mismatch crashes.

**Evidence:** DO-004 fix in CI/CD pipeline establishes the correct order: `migrate deploy` → `up --build`.

---

## INVARIANT-014 — ADMIN_IP_ALLOWLIST Must Be Set in Production

**Rule:** The `ADMIN_IP_ALLOWLIST` environment variable must be set to a non-empty value in production. An empty allowlist allows any IP to call admin routes — defeating the IP-level access control layer for sensitive admin APIs.

**Evidence:** GAP-001 documents that the `ipAllowlist` middleware passes through when the env var is empty.

---

## INVARIANT-015 — Report Moderation is Platform Administration Only

**Rule:** Social report moderation (`GET/PATCH /social/reports`) must be restricted to SUPER_ADMIN only. SCHOOL_ADMIN must not access reports about users from other schools.

**Evidence:** F-1 fix in `social.routes.js` and `report-block.routes.js` both use `authorize('SUPER_ADMIN')`.

---

## INVARIANT-016 — SUPER_ADMIN Role Cannot Be Assigned Through Application Code

**Rule:** `User.role = 'SUPER_ADMIN'` can only be assigned via `POST /api/v1/internal/admin/provision` or direct DB emergency write. No registration, profile update, or school membership API may set this role.

**Evidence:** `assertSafeUserRole()` in `roleGuard.js` blocks all application code paths from setting SUPER_ADMIN.

---

## Change Control Checklist

Before any code change that touches authorization or permissions, verify:

```
[ ] INVARIANT-001  SUPER_ADMIN content participation
[ ] INVARIANT-002  SUPER_ADMIN LiveKit token
[ ] INVARIANT-003  School isolation server-side
[ ] INVARIANT-004  Client permissions not authoritative
[ ] INVARIANT-005  Admin actions audited
[ ] INVARIANT-006  Financial mutations transactional
[ ] INVARIANT-007  Realtime events server-authorized
[ ] INVARIANT-008  Kick/ban prevents reconnect
[ ] INVARIANT-009  Ownership verified server-side
[ ] INVARIANT-010  Public stream vs live class distinction
[ ] INVARIANT-011  Content filter before persistence
[ ] INVARIANT-012  Rate limits maintained
[ ] INVARIANT-013  Migrations before backend restart
[ ] INVARIANT-014  ADMIN_IP_ALLOWLIST set in production
[ ] INVARIANT-015  Report moderation SA only
[ ] INVARIANT-016  SUPER_ADMIN role assignment path
```
