# Feed + Social — Known Gaps and Violations

**Audit date:** 2026-08-26  
**Rule:** Documentation only. No fixes applied.

---

## SVSV-001 — SUPER_ADMIN Legacy Bypass for `feed:join:school`

**ID:** SVSV-001  
**Severity:** MEDIUM  
**System:** Socket.IO / Social Feed  
**File:** `backend/src/app.js`  
**Lines:** ~561–565

### Current Behavior

```javascript
socket.on('feed:join:school', ({ schoolId } = {}) => {
  if (!schoolId) return;
  // SUPER_ADMIN global bypass (legacy)  ← VIOLATION
  if (userRole === 'SUPER_ADMIN') {
    socket.join(`feed:school:${schoolId}`);  // joins ANY school's feed room
    return;
  }
  // Normal users: JWT schoolId must match
  if (socket.userSchoolId !== schoolId) return;
  socket.join(`feed:school:${schoolId}`);
});
```

### Trace

| Element | Value |
|---------|-------|
| File | `backend/src/app.js` |
| Function | `socket.on('feed:join:school', ...)` |
| Condition | `if (userRole === 'SUPER_ADMIN')` |
| Room joined | `feed:school:{anySchoolId}` — any school the admin specifies |
| School isolation | Bypassed completely |

### Current behavior
SUPER_ADMIN can call `socket.emit('feed:join:school', { schoolId: 'any-school-uuid' })` and subscribe to that school's real-time feed events (`post:create`, etc.).

### Expected behavior
SUPER_ADMIN should be subject to the same `socket.userSchoolId === schoolId` check as all other users. The equivalent fixes (SA-FIX-10 for `school:join`, SA-FIX-11 for `class:join`) have been applied — this one was missed.

### Security Impact
Platform admin can receive real-time notifications of `SCHOOL_ONLY` posts from any school without being a member. Privacy concern for school communities.

### Related Documentation
- [docs/authorization/realtime-super-admin-boundary.md](../authorization/realtime-super-admin-boundary.md)
- [docs/authorization/super-admin-current-violations.md](../authorization/super-admin-current-violations.md)

**Do not fix. Document only.**

---

## FS-GAP-001 — SUPER_ADMIN Can Create Posts and React as a Regular User

**ID:** FS-GAP-001  
**Severity:** MEDIUM  
**System:** Feed / Posts  
**Category:** Content Participation Violation

### Current Behavior

There is no authorization check preventing a SUPER_ADMIN from calling:
- `POST /posts` — create a post
- `POST /posts/:id/react` — react to a post
- `POST /posts/:id/comments` — comment on a post
- `POST /social/follow/:userId` — follow a user
- `POST /social/friends/request/:userId` — send friend request

All these endpoints require only `authenticate`, not `authorize(NOT_SUPER_ADMIN)`.

### Expected Behavior
Under the canonical SUPER_ADMIN specification, SUPER_ADMIN should not participate in social content as a normal user. Platform administration and content participation are separate domains.

### Impact
LOW in practice — SUPER_ADMIN accounts are operated by humans who may legitimately want personal social interactions. The risk is SUPER_ADMIN mixing administrative and personal actions.

**Do not fix. Document only.**

---

## FS-GAP-002 — School Feed Visibility Uses Legacy `User.schoolId`

**ID:** FS-GAP-002  
**Severity:** MEDIUM  
**System:** Feed / School Isolation

### Current Behavior

```javascript
// visibilityFilter() in post.controller.js
const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { schoolId: true } });
// ...
...(viewer?.schoolId
  ? [{ visibility: 'SCHOOL_ONLY', isExclusive: false, schoolId: viewer.schoolId }]
  : []),
```

The feed filter uses `User.schoolId` (legacy global field) to determine school membership for `SCHOOL_ONLY` posts. It does NOT check the `SchoolMembership` table.

### Expected Behavior

For new architecture users (MEMBER role with school membership), `User.schoolId` may not be set. These users cannot see `SCHOOL_ONLY` posts even if they have an active `SchoolMembership`.

**Do not fix. Document only.**

---

## FS-GAP-003 — No Audit Logging for Feed/Social Moderation Actions

**ID:** FS-GAP-003  
**Severity:** HIGH  
**System:** Moderation

### Current Behavior

The following actions do NOT write to `audit_logs`:
- SUPER_ADMIN reviews a social report (`PATCH /social/reports/:id/review`)
- SUPER_ADMIN deletes a post as moderation (`DELETE /posts/:id`)
- Community ADMIN bans a member

### Expected Behavior
All moderation actions should be audit-logged.

**Do not fix. Document only.**

---

## FS-GAP-004 — SUPER_ADMIN Can Create Stories

**ID:** FS-GAP-004  
**Severity:** LOW  
**System:** Stories

`POST /stories` requires only `authenticate`. SUPER_ADMIN can create stories as a regular user. Under the canonical rule this is a content participation action.

**Do not fix. Document only.**

---

## FS-GAP-005 — No Story Visibility Options

**ID:** FS-GAP-005  
**Severity:** LOW  
**System:** Stories

Stories have no `visibility` field. They are always visible to followers. There is no `SCHOOL_ONLY`, `PRIVATE`, or "close friends" option for stories.

---

## FS-GAP-006 — No Post Muting

**ID:** FS-GAP-006  
**Severity:** LOW  
**System:** Feed

There is no post/user muting feature. Users can only block (which affects more than just feed visibility) or unfollow. A mute feature (hide posts without unfollowing or blocking) does not exist.

---

## FS-GAP-007 — Trending Hashtags Not Auto-Updated

**ID:** FS-GAP-007  
**Severity:** LOW  
**System:** Trending

`TrendingHashtag` records are updated via `recalculateLeaderboard()` which must be called explicitly. There is no cron job or background job that auto-updates trending hashtags at a regular interval.

---

## Summary Table

| ID | Severity | Description | Fixed? |
|----|---------|-------------|--------|
| SVSV-001 | MEDIUM | SUPER_ADMIN can join any school's feed socket room | ❌ |
| FS-GAP-001 | MEDIUM | SUPER_ADMIN can create posts/react as a regular user | ❌ (by design?) |
| FS-GAP-002 | MEDIUM | School feed uses legacy User.schoolId | ❌ |
| FS-GAP-003 | HIGH | No audit logging for moderation actions | ❌ |
| FS-GAP-004 | LOW | SUPER_ADMIN can create stories | ❌ (by design?) |
| FS-GAP-005 | LOW | No story visibility options | ❌ missing |
| FS-GAP-006 | LOW | No post/user muting | ❌ missing |
| FS-GAP-007 | LOW | Trending hashtags not auto-updated | ❌ missing |
