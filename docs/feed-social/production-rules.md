# Feed + Social — Production Rules

**Audit date:** 2026-08-26

---

## Required Environment Variables

| Variable | Purpose | Required |
|----------|---------|---------|
| `DATABASE_URL` | MySQL | ✅ |
| `REDIS_URL` | Trending hashtag cache, community ban sets | ⚠️ Soft |
| `STORAGE_TYPE` | `local` or `r2` for media | ✅ |
| `CLIENT_URL` | CORS origins | ✅ |
| `JWT_SECRET` | Token signing | ✅ |
| `FCM_SERVICE_ACCOUNT` | Push notifications | ⚠️ Soft |
| `ELASTICSEARCH_URL` | Full-text search | ⚠️ Falls back to MySQL LIKE |

---

## Authorization Rules (Never Violate)

1. All feed/social routes require valid JWT (`authenticate`)
2. Post ownership must be verified before update/delete (except admin moderation)
3. `visibilityFilter()` must be applied to all feed queries
4. SCHOOL_ONLY posts must only be returned to users with matching `schoolId`
5. Blocked users' posts must be excluded from the blocker's feed
6. PRIVATE posts must never be returned to non-authors
7. Report moderation routes require `authorize('SUPER_ADMIN')`
8. Community PRIVATE/INVITE_ONLY feeds require active membership check
9. Content filter must run before post/comment creation

---

## SUPER_ADMIN Rules

1. SUPER_ADMIN can delete posts as a moderation action — this is the correct administrative mechanism
2. SUPER_ADMIN can view and review social reports — this is the correct administrative mechanism
3. SUPER_ADMIN must not use content participation APIs in their administrative capacity
4. SUPER_ADMIN should not create posts/stories/comments as a platform admin action
5. **SVSV-001 must be fixed before production hardening** — legacy `feed:join:school` bypass allows SUPER_ADMIN to subscribe to any school's feed room

---

## Caching Rules

1. Trending hashtags use Redis cache (5 min TTL) with DB fallback
2. Community ban sets use Redis for fast join checks; DB is source of truth
3. Feed queries are NOT cached (cursor pagination with live data requirements)

---

## Media Rules

1. All media uploads require authentication
2. Magic byte validation required — not just Content-Type
3. ClamAV scan recommended in production (soft dependency)
4. Max upload sizes enforced by multer
5. Files must be served with `X-Content-Type-Options: nosniff`

---

## Content Filter

1. `contentFilter` middleware must remain on `POST /posts` and `POST /posts/:id/comments`
2. If content filter is disabled in production, document the decision
3. HTML sanitization via `sanitize` middleware in `app.js` is global — must not be removed

---

## Rate Limits

All rate limits are per-user (by `req.user.id` or IP). They must remain in place to prevent:
- Spam posting (20/min)
- Comment flooding (30/min)
- Story spam (30/hour)
- Follow farming (30/min follow)
- Report spam (10/hour)

---

## Realtime

1. `feed:public` room is joined automatically by all authenticated users — must remain a global room
2. `feed:school:{schoolId}` join must validate `socket.userSchoolId === schoolId`
3. **SVSV-001 bypass in `feed:join:school` must be addressed**
4. Community ban checks must use DB as source of truth (not Redis alone)

---

## Account Deletion Impact

When a user account is soft-deleted (`DELETE /users/me`):
- Own posts are soft-deleted (removed from all feeds)
- Own stories are soft-deleted
- Follows are deleted (both directions)
- Community memberships removed
- DM conversations preserved (for the other party)
- Gift transactions preserved (financial records)

---

## Tests

Feed/social tests are located in:
- `backend/src/tests/p3-security-fixes.test.js` — post visibility, school isolation
- `backend/src/tests/architecture-separation.test.js` — separation of concerns
- `backend/src/tests/p0-security-fixes.test.js` — general security tests
