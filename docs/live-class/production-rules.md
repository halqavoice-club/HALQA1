# Live Class — Production Rules

**Audit date:** 2026-08-26  
**Rule:** These are the current production requirements derived from the codebase. Do not modify application code.

---

## Required Environment Variables

| Variable | Purpose | Required |
|----------|---------|---------|
| `DATABASE_URL` | MySQL connection string | ✅ Yes |
| `REDIS_URL` | Redis for caching and queues | ⚠️ Soft — fallback mode available |
| `LIVEKIT_URL` | LiveKit WebSocket URL (`wss://...`) | ✅ Yes for audio/video |
| `LIVEKIT_API_KEY` | LiveKit API key | ✅ Yes for audio/video |
| `LIVEKIT_API_SECRET` | LiveKit API secret | ✅ Yes for audio/video |
| `JWT_SECRET` | JWT signing secret | ✅ Yes |
| `CLIENT_URL` | Allowed CORS origins | ✅ Yes |
| `STORAGE_TYPE` | `local` or `r2` (for cover images) | ⚠️ Defaults to local |
| `FCM_SERVICE_ACCOUNT` | Firebase push notifications | ⚠️ Soft — push disabled if missing |

---

## Infrastructure Dependencies

| Service | Used for | Failure behavior |
|---------|---------|-----------------|
| **MySQL** | All data persistence | Fatal — service unavailable |
| **Redis** | Auth cache, whiteboard/poll state, schedule reminders | Soft — DB fallback for auth; in-process timers for crons |
| **LiveKit SFU** | Audio/video tracks | Graceful — class continues without media |
| **Socket.IO** | All real-time events | Fatal for real-time — REST API still works |
| **Push (FCM)** | Notifications | Soft — fire-and-forget, failures logged |

---

## Cron Jobs

All cron jobs are registered via the `jobScheduler` utility after Redis connects, with a fallback registration if Redis is unavailable:

| Cron name | Schedule | Purpose |
|-----------|---------|---------|
| `live-class-schedule-reminder` | Every minute | Send push notification to teacher/students when `scheduledAt` passes |
| `live-class-duration-auto-end` | Every minute | End LIVE classes that have exceeded their `duration` |

Both are registered with `{ persist: false }` — they are in-process only, not persisted to the DB.

---

## In-Process Timer Recovery

`scheduleAutoEnd()` stores `setTimeout` handles in a `Map`. These are lost on server restart.

**Recovery:** On `app.listen`, a `setImmediate` block queries all LIVE classes with unexpired durations and re-registers their auto-end timers. Failures are non-fatal (logged only).

**Multi-process note:** In-process timers are per-process. In a clustered or Kubernetes deployment, only one process per class should own the timer. The `live-class-duration-auto-end` cron provides a backup that works across all processes.

---

## Authorization Rules (Must Never Be Violated)

1. `resolveStreamAccess` must be on every route that reads class data (SCHOOL: school membership; PUBLIC: authenticate)
2. `resolveStreamStaffAccess` must be on every host-only operation
3. `assertSchoolAccess` must be called inside controllers for SCHOOL streams
4. `checkLiveClassSchool` must guard all gift endpoints for SCHOOL streams
5. `LiveClassParticipant` record must exist before issuing a LiveKit token
6. `wasKicked = true` must block rejoin for the duration of the session
7. Socket `liveclass:join_room` must verify active `LiveClassParticipant` in DB

---

## School Isolation Rules

1. SCHOOL stream `schoolId` must equal `req.user.schoolId` (assertSchoolAccess)
2. Students must have an active `Enrollment` for the class's `classId`
3. School gift endpoint: user's schoolId must match `lc.schoolId`
4. Cross-school access must return 403 for ALL roles including SUPER_ADMIN
5. SchoolMembership is the authoritative source for school roles (not `User.role`)

---

## SUPER_ADMIN Rules (P0 Invariant)

1. SUPER_ADMIN must never receive HOST role via platform role checks
2. SUPER_ADMIN must not be included in `isTeacher`/`isStaff` checks in live class controllers
3. SUPER_ADMIN administrative access must use dedicated admin APIs, not the content participation APIs
4. The `assertSchoolAccess` check must not have a SUPER_ADMIN bypass
5. The `checkLiveClassSchool` gift check must not have a SUPER_ADMIN bypass (ARCH-02 — fixed)

**Current violations:** LCSV-001, LCSV-002, LCSV-003 — documented in [gaps.md](./gaps.md)

---

## LiveKit Rules

1. All participants receive `canPublish: true` — mic control is application-level
2. Screen share must be restricted at SFU level via `canPublishSources` when `screenShareEnabled=false`
3. Token TTL must remain `1h`
4. Kicked participants must be evicted from the SFU via `RoomServiceClient.removeParticipant()`
5. LiveKit eviction failure must be best-effort — DB kick state must persist regardless

---

## SQL Injection Prevention

1. `updateLiveClass` uses a column allowlist — only known-safe column names reach raw SQL (P3-002)
2. `listLiveClasses` WHERE clause uses hardcoded literals + parameterized `?` placeholders (P3-003)
3. All `$queryRawUnsafe` calls bind dynamic values as `?` parameters — never string interpolation

---

## Deployment Checklist

Before deploying changes to the live class system:

```
[ ] Database migration applied (npx prisma migrate deploy)
[ ] Prisma client regenerated (npx prisma generate)
[ ] LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET set
[ ] Redis available or fallback tested
[ ] Auto-end cron registered (verify in startup logs)
[ ] Push notification service configured (or fire-and-forget failures accepted)
[ ] CORS origins include frontend URL
[ ] All authorization tests passing (platform-admin-scope.test.js, live-class-p0-security.test.js)
```

---

## Health Checks

`GET /health/detailed` reports:
- `database.status` — MySQL latency
- `redis.status` — Redis connectivity
- `livekit.status` — LiveKit server reachability (`wss://` ping)

If LiveKit is `not_configured`, token endpoints return 503. Classes can still be created/joined and chat works, but no audio/video.

---

## Storage (Cover Images)

Cover images are uploaded via `POST /live-classes/:id/cover`:
- Max size: 2 MB
- Content type: images only (MIME type validated by `file-type` magic bytes — not just Content-Type header)
- Stored via `STORAGE_TYPE`: `local` (backend/uploads/) or `r2` (Cloudflare R2)

---

## Monitoring

Recommended alerts:
- `live-class-duration-auto-end` cron failures (logged at WARN level)
- LiveKit token endpoint 503 rate
- `liveclass:join_room` refusal rate (indicates kicked users trying to reconnect)
- Auto-end timer recovery failures on startup
