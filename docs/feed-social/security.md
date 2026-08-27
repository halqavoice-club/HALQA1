# Feed + Social — Security

**Audit date:** 2026-08-26

---

## Authentication

All feed/social routes require a valid JWT Bearer token via `authenticate` middleware. No public (unauthenticated) feed endpoints exist.

---

## Authorization — Post Operations

### Ownership Check

Post updates and deletes check `post.authorId === req.user.id`:
```javascript
// updatePost
if (post.authorId !== req.user.id) return 403;

// deletePost (F-2 fix — allows admin deletion as moderation)
const isAuthor      = post.authorId === req.user.id;
const isSuperAdmin  = req.user.role === 'SUPER_ADMIN';
const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';
const sameSchool    = post.schoolId && post.schoolId === req.user.schoolId;
if (!isAuthor && !isSuperAdmin && !(isSchoolAdmin && sameSchool)) return 403;
```

### Visibility Enforcement

The `visibilityFilter()` helper ensures that:
- `PRIVATE` posts are only visible to their author
- `FOLLOWERS` posts only reach users who follow the author
- `SCHOOL_ONLY` posts only reach users with matching `schoolId`
- `isExclusive` posts only reach active subscribers

This filter is applied on `getFeed()` and `getUserPosts()`. Individual `getPost()` calls also check visibility:
```javascript
// getPost — checks blocked status and visibility
```

---

## School Isolation

### Post Data

`SCHOOL_ONLY` visibility uses `Post.schoolId = req.user.schoolId` at creation. The `visibilityFilter` enforces `schoolId = viewer.schoolId` at query time.

**Gap:** Uses legacy `User.schoolId` field, not `SchoolMembership`. See [gaps.md](./gaps.md).

### Socket Feed Rooms

`feed:school:{schoolId}` requires `socket.userSchoolId === schoolId` (from JWT).

**SVSV-001:** SUPER_ADMIN bypasses this check via a legacy `if (userRole === 'SUPER_ADMIN')` condition. See [gaps.md](./gaps.md).

---

## Blocked Users

Blocked users' content is excluded from the blocker's feed via:
```javascript
// In getFeed / getUserPosts
const blockedByMe = await prisma.userBlock.findMany({ where: { blockerId: viewerId } });
const blockedIds = blockedByMe.map(b => b.blockedId);
where.authorId = { notIn: blockedIds };
```

Blocking is symmetric in effect but asymmetric in implementation — block records are directional (blocker → blocked).

---

## Content Filter (XSS / Profanity)

File: `backend/src/utils/contentFilter.js`

Applied as middleware before `createPost` and `addComment`:
- Checks `body` field for profanity/toxic content
- Rejects if flagged (400/422)
- Input is also HTML-sanitized by the global `sanitize` middleware in `app.js`

---

## Input Validation

| Field | Max length | Validator |
|-------|-----------|-----------|
| Post body | 5,000 chars | express-validator |
| Comment body | Required, no max | express-validator |
| Story text | 500 chars | express-validator |
| Story caption | 280 chars | express-validator |
| Location | 120 chars | express-validator |
| Post visibility | Enum | isIn(['PUBLIC','FOLLOWERS','PRIVATE','SCHOOL_ONLY']) |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /posts | 20 per minute |
| POST /posts/:id/comments | 30 per minute |
| POST /stories | 30 per hour |
| GET /posts/link-preview | 30 per minute |
| POST /posts/:id/view | 200 per minute |
| POST /social/follow/:userId | 30 per minute |
| POST /social/friends/request/:userId | 20 per minute |
| POST /social/report/:userId | 10 per hour |

---

## SUPER_ADMIN Feed/Social Boundary

### Permitted (Platform Administration)
- Delete posts as moderation action (`DELETE /posts/:id`)
- View and review social reports (`GET/PATCH /social/reports`)
- Suspend/ban users from reports
- Receive `admin:user_reported` socket alerts in `role:SUPER_ADMIN` room

### Violations (Content Participation — not blocked by code)
- Create posts: ❌ not blocked — SUPER_ADMIN can post (FS-GAP-001)
- React to posts: ❌ not blocked (FS-GAP-001)
- Comment: ❌ not blocked (FS-GAP-001)
- Follow users: ❌ not blocked (FS-GAP-001)
- Join `feed:school:{id}` via SVSV-001 bypass: ⚠️ VIOLATION
- Create stories: ❌ not blocked (FS-GAP-004)

See [gaps.md](./gaps.md) for the complete list.

---

## Media Security

- File uploads require authentication
- MIME type validated via magic bytes (file-type library) — not just Content-Type header
- File size enforced by multer
- Optional ClamAV virus scan (graceful degradation if unavailable)
- Filenames sanitized before storage
- Local storage served with `X-Content-Type-Options: nosniff`
