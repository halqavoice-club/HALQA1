# Feed + Social — Moderation

**Audit date:** 2026-08-26

---

## Content Moderation Mechanisms

### 1. Content Filter (Pre-creation)

File: `backend/src/utils/contentFilter.js`

Applied to post body and comments before DB write:
```javascript
router.post('/', createLimit, [...validators], validate, postFilter('body', 'post'), ctrl.createPost);
```

If content is flagged as toxic/profane, the request is rejected before the post is created (422 or 400).

### 2. User Reports

Users can report other users, posts, and content.

**Report flow:**
```
User → POST /social/report/:userId  { reason, description?, roomId? }
     → Creates UserReport record
     → Emits admin:user_reported → role:SUPER_ADMIN socket room
     → SUPER_ADMIN sees alert in admin dashboard

SUPER_ADMIN → GET /social/reports  (or /report-block/reports)
           → PATCH /social/reports/:id/review  { status, action?, adminNote }
             action: WARN | SUSPEND | BAN
```

**Post report:**
```
User → POST /posts/:id/report  { reason }
     → Creates a post-level report (stored via reportPost controller)
```

### 3. Post Deletion by Admin

SUPER_ADMIN and SCHOOL_ADMIN can delete posts as a moderation action:
```javascript
// post.controller.js: deletePost()
const isSuperAdmin  = req.user.role === 'SUPER_ADMIN';
const isSchoolAdmin = req.user.role === 'SCHOOL_ADMIN';
const sameSchool    = post.schoolId && post.schoolId === req.user.schoolId;

if (!isAuthor && !isSuperAdmin && !(isSchoolAdmin && sameSchool)) return 403;
```

### 4. Community Moderation

Community ADMIN/MODERATOR can:
- Delete posts within their community
- Kick members
- Ban members (persistent + Redis cache)
- Approve/reject join requests

### 5. Blocking

User blocks prevent the blocked user's content from appearing in the blocker's feed.

---

## Administration vs Content Participation (Moderation)

| Action | Type | SUPER_ADMIN access |
|--------|------|-------------------|
| View all social reports | ADMINISTRATION | ✅ ALLOWED |
| Review/resolve reports | ADMINISTRATION | ✅ ALLOWED |
| Warn a user (from report) | ADMINISTRATION | ✅ ALLOWED |
| Suspend a user (from report) | ADMINISTRATION | ✅ ALLOWED |
| Ban a user (from report) | ADMINISTRATION | ✅ ALLOWED |
| Delete a post as moderator | ADMINISTRATION | ✅ ALLOWED (F-2 fix) |
| Enter a community to moderate | PARTICIPATION | ❌ SHOULD NOT |
| Create posts for moderation | PARTICIPATION | ❌ SHOULD NOT |
| Comment in content spaces | PARTICIPATION | ❌ SHOULD NOT |

---

## Report Moderation Routes (SUPER_ADMIN Only)

Both of these route prefixes point to the same controller:

```
GET  /api/v1/social/reports           → authorize('SUPER_ADMIN')
PATCH /api/v1/social/reports/:id/review → authorize('SUPER_ADMIN')

GET  /api/v1/report-block/reports     → authorize('SUPER_ADMIN')
PATCH /api/v1/report-block/reports/:id/review → authorize('SUPER_ADMIN')
```

F-1 fix comment in `social.routes.js`:
> Social report moderation is a PLATFORM-LEVEL operation. SCHOOL_ADMIN should NOT have access to reports filed about users at other schools. Only SUPER_ADMIN should moderate platform-wide social reports.

---

## Audit Logging for Moderation

Report review actions do NOT currently write to `audit_logs`. This is documented as a gap (FS-GAP-005 in [gaps.md](./gaps.md)).

User suspension/ban triggered by report review goes through `PATCH /admin/stats/users/:id/status` which DOES write an audit log entry.
